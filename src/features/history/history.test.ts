import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryRun } from "@/features/results/query-run";
import {
  deleteSavedQuery,
  filterHistory,
  getHistory,
  HISTORY_LIMIT,
  renameSavedQuery,
  resetHistory,
  saveQuery,
  startHistory,
} from "./history";
import { memoryStore } from "./storage";

// The query run is a value the tests set, like the one query-run.ts keeps.
const queryRun = vi.hoisted(() => {
  let run: QueryRun = { state: "idle" };
  const listeners = new Set<() => void>();
  return {
    getQueryRun: () => run,
    subscribeToQueryRun: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRun(next: QueryRun) {
      run = next;
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/features/results/query-run", () => queryRun);

/** Lets the store's writes settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("query history", () => {
  afterEach(() => {
    resetHistory();
    queryRun.setRun({ state: "idle" });
  });

  it("records each finished, failed and cancelled run, newest first", async () => {
    await startHistory(memoryStore());

    queryRun.setRun({ state: "running", sql: "SELECT 1", startedAt: 0 });
    queryRun.setRun({ state: "done", sql: "SELECT 1", rowCount: 1, durationMs: 12 });
    queryRun.setRun({ state: "cancelled", sql: "SELECT 2", durationMs: 30 });
    queryRun.setRun({
      state: "failed",
      sql: "SELEC 3",
      error: new Error("Parser Error: syntax error"),
      durationMs: 4,
      editorOffset: 0,
    });

    expect(getHistory().history).toMatchObject([
      { sql: "SELEC 3", outcome: "failed", error: "Parser Error: syntax error", durationMs: 4 },
      { sql: "SELECT 2", outcome: "cancelled", durationMs: 30 },
      { sql: "SELECT 1", outcome: "done", rowCount: 1, durationMs: 12 },
    ]);
  });

  it("keeps history and saved queries after a reload", async () => {
    const store = memoryStore();
    await startHistory(store);
    queryRun.setRun({ state: "done", sql: "SELECT 1", rowCount: 1, durationMs: 1 });
    await saveQuery("One", "SELECT 1");
    await flush();

    resetHistory();
    await startHistory(store);

    expect(getHistory().history).toMatchObject([{ sql: "SELECT 1" }]);
    expect(getHistory().saved).toMatchObject([{ name: "One", sql: "SELECT 1" }]);
  });

  it(`keeps only the last ${HISTORY_LIMIT} runs`, async () => {
    const store = memoryStore();
    await startHistory(store);
    for (let index = 0; index < HISTORY_LIMIT + 2; index++) {
      queryRun.setRun({ state: "done", sql: `SELECT ${index}`, rowCount: 1, durationMs: 1 });
    }
    await flush();

    const { history } = getHistory();
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.sql).toBe(`SELECT ${HISTORY_LIMIT + 1}`);
    expect(history.at(-1)?.sql).toBe("SELECT 2");
    expect(await store.getAll("history")).toHaveLength(HISTORY_LIMIT);
  });

  it("filters by a case-insensitive substring of the SQL", async () => {
    await startHistory(memoryStore());
    queryRun.setRun({ state: "done", sql: "SELECT * FROM orders", rowCount: 1, durationMs: 1 });
    queryRun.setRun({ state: "done", sql: "SELECT * FROM machines", rowCount: 1, durationMs: 1 });

    expect(filterHistory(getHistory().history, "ORDERS").map((entry) => entry.sql)).toEqual([
      "SELECT * FROM orders",
    ]);
    expect(filterHistory(getHistory().history, "  ")).toHaveLength(2);
  });
});

describe("saved queries", () => {
  afterEach(() => resetHistory());

  it("saves, renames and deletes a query", async () => {
    const store = memoryStore();
    await startHistory(store);

    await saveQuery("  Late orders ", "SELECT * FROM orders WHERE late");
    const [saved] = getHistory().saved;
    expect(saved).toMatchObject({ name: "Late orders", sql: "SELECT * FROM orders WHERE late" });
    if (!saved) throw new Error("Not saved");

    await renameSavedQuery(saved.id, "Overdue orders");
    expect(getHistory().saved).toMatchObject([{ name: "Overdue orders" }]);
    expect(await store.getAll("saved")).toMatchObject([{ name: "Overdue orders" }]);

    await deleteSavedQuery(saved.id);
    expect(getHistory().saved).toEqual([]);
    expect(await store.getAll("saved")).toEqual([]);
  });

  it("doesn't save or rename to a blank name", async () => {
    await startHistory(memoryStore());

    await saveQuery("   ", "SELECT 1");
    expect(getHistory().saved).toEqual([]);

    await saveQuery("One", "SELECT 1");
    const id = getHistory().saved[0]?.id ?? "";
    await renameSavedQuery(id, " ");
    expect(getHistory().saved).toMatchObject([{ name: "One" }]);
  });
});
