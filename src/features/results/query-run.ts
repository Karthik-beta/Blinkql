// The query that's running or last ran, and how it went. Its result goes to the result store
// (result-store.ts); this store only says how many rows it had. Components read it with
// useSyncExternalStore.
import { query } from "@/engine/engine";
import { measureSince, measures } from "@/lib/user-timing";
import { clearResult, showResult } from "./result-store";

export type QueryRun =
  | { state: "idle" }
  | { state: "running"; sql: string; startedAt: number }
  | {
      state: "done";
      sql: string;
      rowCount: number;
      durationMs: number;
    }
  | {
      state: "failed";
      sql: string;
      error: Error;
      durationMs: number;
      /** Where `sql` started in the editor, to point at the error there. */
      editorOffset: number;
    };

let run: QueryRun = { state: "idle" };
const listeners = new Set<() => void>();

function setRun(next: QueryRun): void {
  run = next;
  for (const listener of listeners) listener();
}

/** The current run. Returns the same object until it changes. */
export function getQueryRun(): QueryRun {
  return run;
}

/** Calls `listener` whenever the run changes; returns a function that unsubscribes. */
export function subscribeToQueryRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Runs `sql` and records the outcome. Its result replaces the one on screen, which stays there
 * while it runs; a failure clears it. Does nothing for empty SQL or while another query is
 * running: the engine has one connection, and a second Run press is almost always a double press.
 */
export async function runQuery(sql: string, editorOffset = 0): Promise<void> {
  if (!sql.trim() || run.state === "running") return;
  const startedAt = performance.now();
  setRun({ state: "running", sql, startedAt });
  try {
    const table = await query(sql);
    measureSince(measures.query, startedAt);
    const finishedAt = performance.now();
    showResult(table, startedAt, finishedAt);
    setRun({ state: "done", sql, rowCount: table.numRows, durationMs: finishedAt - startedAt });
  } catch (error) {
    clearResult();
    setRun({
      state: "failed",
      sql,
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: performance.now() - startedAt,
      editorOffset,
    });
  }
}

/** Back to idle with no result, e.g. after the engine restarts. */
export function resetQueryRun(): void {
  clearResult();
  setRun({ state: "idle" });
}
