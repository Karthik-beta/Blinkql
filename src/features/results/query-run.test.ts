import { tableFromArrays } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueryRun, resetQueryRun, runQuery, subscribeToQueryRun } from "./query-run";
import { getResult } from "./result-store";

const engine = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string): Promise<unknown> => range40),
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

    expect(engine.query).toHaveBeenCalledWith("SELECT * FROM range(40)");
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
    engine.query.mockRejectedValueOnce(new Error("Parser Error: syntax error at or near SELEC"));

    await runQuery("SELEC 1");

    expect(getQueryRun()).toMatchObject({
      state: "failed",
      error: { message: "Parser Error: syntax error at or near SELEC" },
    });
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

    expect(engine.query).not.toHaveBeenCalled();
    expect(getQueryRun()).toEqual({ state: "idle" });
  });

  it("ignores a second run while one is in progress", async () => {
    const first = runQuery("SELECT 1");
    await runQuery("SELECT 2");
    await first;

    expect(engine.query).toHaveBeenCalledTimes(1);
    expect(getQueryRun()).toMatchObject({ state: "done", sql: "SELECT 1" });
  });
});
