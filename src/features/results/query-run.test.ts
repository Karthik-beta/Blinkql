import { tableFromArrays } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueryRun, resetQueryRun, runQuery, subscribeToQueryRun } from "./query-run";
import { getResult } from "./result-store";
import { streamOf } from "./test-utils";

const engine = vi.hoisted(() => ({
  streamQuery: vi.fn(async (_sql: string): Promise<unknown> => streamOf(range40)),
}));
vi.mock("@/engine/engine", () => engine);

const range40 = tableFromArrays({ n: Int32Array.from({ length: 40 }, (_, i) => i) });

describe("query run", () => {
  afterEach(() => {
    resetQueryRun();
    vi.clearAllMocks();
  });

  it("goes from running to done with the row count and how long it took", async () => {
    const states: string[] = [];
    const unsubscribe = subscribeToQueryRun(() => states.push(getQueryRun().state));

    await runQuery("SELECT * FROM range(40)");
    unsubscribe();

    expect(engine.streamQuery).toHaveBeenCalledWith("SELECT * FROM range(40)");
    expect(states).toEqual(["running", "done"]);
    expect(getQueryRun()).toEqual({
      state: "done",
      sql: "SELECT * FROM range(40)",
      rowCount: 40,
      durationMs: expect.any(Number),
    });
  });

  it("shows the result, and keeps the previous one on screen while the next query runs", async () => {
    await runQuery("SELECT * FROM range(40)");
    const shown = getResult();
    expect(shown).toMatchObject({ rowCount: 40, columns: [{ name: "n" }] });

    const next = runQuery("SELECT 1");
    expect(getQueryRun().state).toBe("running");
    expect(getResult()).toBe(shown);
    await next;
    expect(getResult()).not.toBe(shown);
  });

  it("records a failure with the engine's message, and clears the result", async () => {
    await runQuery("SELECT * FROM range(40)");
    engine.streamQuery.mockRejectedValueOnce(
      new Error("Parser Error: syntax error at or near SELEC"),
    );

    await runQuery("SELEC 1");

    expect(getQueryRun()).toMatchObject({
      state: "failed",
      error: { message: "Parser Error: syntax error at or near SELEC" },
    });
    expect(getResult()).toBeNull();
  });

  it("shows the rows that have arrived while the rest are still coming", async () => {
    let more!: () => void;
    const held = new Promise<void>((resolve) => (more = resolve));
    const [first] = range40.slice(0, 10).batches;
    const [rest] = range40.slice(10).batches;
    engine.streamQuery.mockResolvedValueOnce({
      schema: range40.schema,
      batches: (async function* () {
        yield first;
        await held;
        yield rest;
      })(),
    });

    const running = runQuery("SELECT * FROM range(40)");
    await vi.waitFor(() => expect(getResult()).toMatchObject({ rowCount: 10, finishedAt: null }));
    expect(getQueryRun().state).toBe("running");

    more();
    await running;
    expect(getResult()).toMatchObject({ rowCount: 40, finishedAt: expect.any(Number) });
    expect(getQueryRun()).toMatchObject({ state: "done", rowCount: 40 });
  });

  it("clears the rows already shown when the query fails part-way", async () => {
    const [first] = range40.slice(0, 10).batches;
    engine.streamQuery.mockResolvedValueOnce({
      schema: range40.schema,
      batches: (async function* () {
        yield first;
        throw new Error("Conversion Error: Could not convert string 'x' to INT32");
      })(),
    });

    await runQuery("SELECT CAST(s AS INT) FROM t");

    expect(getQueryRun()).toMatchObject({
      state: "failed",
      error: { message: expect.stringContaining("Conversion Error") },
    });
    expect(getResult()).toBeNull();
  });

  it("stops showing a query's rows once the run is reset, e.g. by an engine restart", async () => {
    let more!: () => void;
    const held = new Promise<void>((resolve) => (more = resolve));
    const [first] = range40.slice(0, 10).batches;
    engine.streamQuery.mockResolvedValueOnce({
      schema: range40.schema,
      batches: (async function* () {
        yield first;
        await held;
        yield first;
      })(),
    });

    const running = runQuery("SELECT * FROM range(40)");
    await vi.waitFor(() => expect(getResult()).not.toBeNull());
    resetQueryRun();
    more();
    await running;

    expect(getQueryRun()).toEqual({ state: "idle" });
    expect(getResult()).toBeNull();
  });

  it("clears the result when reset", async () => {
    await runQuery("SELECT * FROM range(40)");
    resetQueryRun();

    expect(getQueryRun()).toEqual({ state: "idle" });
    expect(getResult()).toBeNull();
  });

  it("ignores empty SQL", async () => {
    await runQuery("  \n ");

    expect(engine.streamQuery).not.toHaveBeenCalled();
    expect(getQueryRun()).toEqual({ state: "idle" });
  });

  it("ignores a second run while one is in progress", async () => {
    const first = runQuery("SELECT 1");
    await runQuery("SELECT 2");
    await first;

    expect(engine.streamQuery).toHaveBeenCalledTimes(1);
    expect(getQueryRun()).toMatchObject({ state: "done", sql: "SELECT 1" });
  });
});
