// User Timing marks the benchmark harness (bench/) reads from the page.
// Mark names are part of the benchmark contract: renaming one breaks comparisons with old results.

export const marks = {
  /** The app shell (top bar and empty workspace) has been committed to the DOM. */
  appShell: "blinkql:app-shell",
  /** DuckDB-wasm is running in its worker, connected, and has answered a first query. */
  engineReady: "blinkql:engine-ready",
} as const;

export type MarkName = (typeof marks)[keyof typeof marks];

/** Records `name` once per page load; later calls (e.g. StrictMode re-running effects) are ignored. */
export function markOnce(name: MarkName): void {
  if (performance.getEntriesByName(name, "mark").length > 0) return;
  performance.mark(name);
}
