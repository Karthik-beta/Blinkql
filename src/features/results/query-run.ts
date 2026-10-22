// The query that's running or last ran, and how it went. Its result goes to the result store
// (result-store.ts) a record batch at a time; this store only says how many rows it had.
// Components read it with useSyncExternalStore.
import { streamQuery } from "@/engine/engine";
import { measureSince, measures } from "@/lib/user-timing";
import { appendRows, clearResult, finishResult, startResult } from "./result-store";

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
 * until the new result's first rows arrive; the rest follow as the engine produces them. A
 * failure, even after some rows have arrived, clears it. Does nothing for empty SQL or while
 * another query is running: the engine has one connection, and a second Run press is almost
 * always a double press.
 */
export async function runQuery(sql: string, editorOffset = 0): Promise<void> {
  if (!sql.trim() || run.state === "running") return;
  const startedAt = performance.now();
  const running: QueryRun = { state: "running", sql, startedAt };
  setRun(running);
  // Restarting the engine resets the run (resetQueryRun); this query's rows then don't belong on
  // screen any more.
  const abandoned = () => run !== running;
  try {
    const { schema, batches } = await streamQuery(sql);
    if (abandoned()) return;
    startResult(schema, startedAt);
    let rowCount = 0;
    for await (const batch of batches) {
      if (abandoned()) return;
      appendRows(batch);
      rowCount += batch.numRows;
    }
    if (abandoned()) return;
    measureSince(measures.query, startedAt);
    const finishedAt = performance.now();
    finishResult(finishedAt);
    setRun({ state: "done", sql, rowCount, durationMs: finishedAt - startedAt });
  } catch (error) {
    if (abandoned()) return;
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
