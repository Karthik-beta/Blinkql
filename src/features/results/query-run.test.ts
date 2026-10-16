import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueryRun, resetQueryRun, runQuery, subscribeToQueryRun } from "./query-run";

const engine = vi.hoisted(() => ({
  query: vi.fn(async (_sql: string): Promise<unknown> => ({ numRows: 40 })),
}));
vi.mock("@/engine/engine", () => engine);

describe("query run", () => {
  afterEach(() => {
    resetQueryRun();
    vi.clearAllMocks();
  });

  it("goes from running to done with the result and how long it took", async () => {
    const states: string[] = [];
    const unsubscribe = subscribeToQueryRun(() => states.push(getQueryRun().state));

    await runQuery("SELECT * FROM range(40)");
    unsubscribe();

    expect(engine.query).toHaveBeenCalledWith("SELECT * FROM range(40)");
    expect(states).toEqual(["running", "done"]);
    expect(getQueryRun()).toMatchObject({
      state: "done",
      sql: "SELECT * FROM range(40)",
      table: { numRows: 40 },
      durationMs: expect.any(Number),
    });
  });

  it("records a failure with the engine's message", async () => {
    engine.query.mockRejectedValueOnce(new Error("Parser Error: syntax error at or near SELEC"));

    await runQuery("SELEC 1");

    expect(getQueryRun()).toMatchObject({
      state: "failed",
      error: { message: "Parser Error: syntax error at or near SELEC" },
    });
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
