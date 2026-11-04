import { Int32, type RecordBatch, Table, Utf8, vectorFromArray } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { measures } from "@/lib/user-timing";
import {
  appendRows,
  clearResult,
  finishResult,
  getResult,
  REFRESH_MS,
  readCell,
  startResult,
  subscribeToResult,
} from "./result-store";

const machines = new Table({
  id: vectorFromArray([1, 2, 3], new Int32()),
  machine: vectorFromArray(["press", null, "lathe"], new Utf8()),
});

/** A batch of `rows` rows of one column, n, counting from `from`. */
function batch(from: number, rows: number): RecordBatch {
  const n = Array.from({ length: rows }, (_, i) => from + i);
  const [first] = new Table({ n: vectorFromArray(n, new Int32()) }).batches;
  if (!first) throw new Error("No batch");
  return first;
}

/** Receives the whole of `table`: its query sent at `startedAt`, its last rows at `finishedAt`. */
function show(table: Table, startedAt = 0, finishedAt = 0): void {
  startResult(table.schema, startedAt);
  for (const rows of table.batches) appendRows(rows);
  finishResult(finishedAt);
}

describe("result store", () => {
  afterEach(() => {
    clearResult();
    performance.clearMeasures();
    vi.useRealTimers();
  });

  it("starts with no result", () => {
    expect(getResult()).toBeNull();
  });

  it("describes the result by its row count and columns, without its data", () => {
    show(machines, 1000, 1234);

    const result = getResult();
    expect(result).toEqual({
      id: expect.any(Number),
      rowCount: 3,
      columns: [
        { name: "id", type: expect.any(Int32) },
        { name: "machine", type: expect.any(Utf8) },
      ],
      startedAt: 1000,
      firstRowsAt: expect.any(Number),
      finishedAt: 1234,
    });
    // The same object until the result changes, as useSyncExternalStore needs.
    expect(getResult()).toBe(result);
  });

  it("reads the text of each cell, with null for SQL NULL", () => {
    show(machines);

    expect([0, 1, 2].map((row) => [readCell(row, 0), readCell(row, 1)])).toEqual([
      ["1", "press"],
      ["2", null],
      ["3", "lathe"],
    ]);
    expect(() => readCell(0, 2)).toThrow(RangeError);
  });

  it("times setting up the column readers for the benchmark, once per result", () => {
    show(machines);

    expect(performance.getEntriesByName(measures.resultsConvert, "measure")).toHaveLength(1);
  });

  it("tells subscribers when the result changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToResult(listener);

    show(machines);
    clearResult();
    // Nothing to clear, so nothing changes.
    clearResult();
    unsubscribe();
    show(machines);

    // The first rows, the finished result, and clearing it.
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("replaces the previous result", () => {
    show(machines);
    const first = getResult();
    show(new Table({ n: vectorFromArray([7], new Int32()) }));

    expect(getResult()?.id).not.toBe(first?.id);
    expect(getResult()?.rowCount).toBe(1);
    expect(readCell(0, 0)).toBe("7");
    expect(() => readCell(0, 1)).toThrow(RangeError);
  });

  it("lets go of the result when cleared", () => {
    show(machines);
    clearResult();

    expect(getResult()).toBeNull();
    expect(() => readCell(0, 0)).toThrow(RangeError);
  });

  describe("while rows arrive", () => {
    it("keeps the previous result on screen until the next one's first rows arrive", () => {
      show(machines);
      const previous = getResult();

      startResult(batch(0, 1).schema, 0);
      // An empty batch has no rows to show.
      appendRows(batch(0, 1).slice(0, 0));
      expect(getResult()).toBe(previous);

      appendRows(batch(0, 2048));
      expect(getResult()).toMatchObject({ rowCount: 2048, finishedAt: null });
    });

    it("shows the first rows at once and adds later ones every REFRESH_MS", () => {
      vi.useFakeTimers();
      startResult(batch(0, 1).schema, 0);
      appendRows(batch(0, 2048));
      const first = getResult();

      appendRows(batch(2048, 2048));
      appendRows(batch(4096, 2048));
      expect(getResult()).toBe(first);

      vi.advanceTimersByTime(REFRESH_MS);
      const later = getResult();
      expect(later).toMatchObject({ id: first?.id, rowCount: 6144, finishedAt: null });
      // The same columns, so rows already on screen don't read their cells again.
      expect(later?.columns).toBe(first?.columns);
      expect(readCell(6143, 0)).toBe("6143");

      appendRows(batch(6144, 10));
      finishResult(1234);
      expect(getResult()).toMatchObject({ id: first?.id, rowCount: 6154, finishedAt: 1234 });
      expect(getResult()?.columns).toBe(first?.columns);
      expect(readCell(6153, 0)).toBe("6153");
    });

    it("shows a result with no rows once it finishes", () => {
      startResult(batch(0, 1).schema, 0);
      expect(getResult()).toBeNull();

      finishResult(10);
      expect(getResult()).toMatchObject({ rowCount: 0, columns: [{ name: "n" }], finishedAt: 10 });
    });

    it("drops the rows still to be shown when cleared", () => {
      vi.useFakeTimers();
      const listener = vi.fn();
      startResult(batch(0, 1).schema, 0);
      appendRows(batch(0, 2048));
      appendRows(batch(2048, 2048));
      clearResult();
      const unsubscribe = subscribeToResult(listener);

      vi.advanceTimersByTime(REFRESH_MS);
      unsubscribe();
      expect(listener).not.toHaveBeenCalled();
      expect(getResult()).toBeNull();
      expect(() => appendRows(batch(0, 1))).toThrow(/No result is being received/);
    });
  });
});
