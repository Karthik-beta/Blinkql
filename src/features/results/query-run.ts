// The query that's running or last ran, and its result. The Arrow table lives here, outside React
// state (ADR-004); components read this store with useSyncExternalStore.
import type { Table } from "apache-arrow";
import { query } from "@/engine/engine";

export type QueryRun =
  | { state: "idle" }
  | { state: "running"; sql: string; startedAt: number }
  | { state: "done"; sql: string; table: Table; durationMs: number }
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
 * Runs `sql` and records the outcome. Does nothing for empty SQL or while another query is
 * running: the engine has one connection, and a second Run press is almost always a double press.
 */
export async function runQuery(sql: string, editorOffset = 0): Promise<void> {
  if (!sql.trim() || run.state === "running") return;
  const startedAt = performance.now();
  setRun({ state: "running", sql, startedAt });
  try {
    const table = await query(sql);
    setRun({ state: "done", sql, table, durationMs: performance.now() - startedAt });
  } catch (error) {
    setRun({
      state: "failed",
      sql,
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: performance.now() - startedAt,
      editorOffset,
    });
  }
}

/** Back to idle, e.g. after the engine restarts. */
export function resetQueryRun(): void {
  setRun({ state: "idle" });
}
