import { Int32, Table, Utf8, vectorFromArray } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { measures } from "@/lib/user-timing";
import { clearResult, getResult, readCell, showResult, subscribeToResult } from "./result-store";

const machines = new Table({
  id: vectorFromArray([1, 2, 3], new Int32()),
  machine: vectorFromArray(["press", null, "lathe"], new Utf8()),
});

describe("result store", () => {
  afterEach(() => {
    clearResult();
    performance.clearMeasures();
  });

  it("starts with no result", () => {
    expect(getResult()).toBeNull();
  });

  it("describes the result by its row count and columns, without its data", () => {
    showResult(machines, 1000, 1234);

    const result = getResult();
    expect(result).toEqual({
      rowCount: 3,
      columns: [
        { name: "id", type: expect.any(Int32) },
        { name: "machine", type: expect.any(Utf8) },
      ],
      startedAt: 1000,
      finishedAt: 1234,
    });
    // The same object until the result changes, as useSyncExternalStore needs.
    expect(getResult()).toBe(result);
  });

  it("reads the text of each cell, with null for SQL NULL", () => {
    showResult(machines, 0, 0);

    expect([0, 1, 2].map((row) => [readCell(row, 0), readCell(row, 1)])).toEqual([
      ["1", "press"],
      ["2", null],
      ["3", "lathe"],
    ]);
    expect(() => readCell(0, 2)).toThrow(RangeError);
  });

  it("times setting up the column readers for the benchmark", () => {
    showResult(machines, 0, 0);

    expect(performance.getEntriesByName(measures.resultsConvert, "measure")).toHaveLength(1);
  });

  it("tells subscribers when the result changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToResult(listener);

    showResult(machines, 0, 0);
    clearResult();
    // Nothing to clear, so nothing changes.
    clearResult();
    unsubscribe();
    showResult(machines, 0, 0);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("replaces the previous result", () => {
    showResult(machines, 0, 0);
    const first = getResult();
    showResult(new Table({ n: vectorFromArray([7], new Int32()) }), 1, 1);

    expect(getResult()).not.toBe(first);
    expect(getResult()?.rowCount).toBe(1);
    expect(readCell(0, 0)).toBe("7");
    expect(() => readCell(0, 1)).toThrow(RangeError);
  });

  it("lets go of the result when cleared", () => {
    showResult(machines, 0, 0);
    clearResult();

    expect(getResult()).toBeNull();
    expect(() => readCell(0, 0)).toThrow(RangeError);
  });
});
