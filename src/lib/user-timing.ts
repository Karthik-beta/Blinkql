// User Timing marks and measures the benchmark harness (bench/) reads from the page.
// Their names are part of the benchmark contract: renaming one breaks comparisons with old results.

export const marks = {
  /** The app shell (top bar and empty workspace) has been committed to the DOM. */
  appShell: "blinkql:app-shell",
  /** DuckDB-wasm is running in its worker, connected, and has answered a first query. */
  engineReady: "blinkql:engine-ready",
} as const;

export type MarkName = (typeof marks)[keyof typeof marks];

/** Spans recorded every time they happen, unlike marks; the harness clears them between steps. */
export const measures = {
  /** Importing one file: registering it with the engine, creating its view and reading its schema. */
  import: "blinkql:import",
  /** One query, from being sent to the engine until its Arrow result is on the main thread. */
  query: "blinkql:query",
  /** Copying a result out of Arrow into row objects for the results table. */
  resultsConvert: "blinkql:results-convert",
  /** From a result reaching the main thread until the frame after its rows are committed. */
  resultsRender: "blinkql:results-render",
} as const;

export type MeasureName = (typeof measures)[keyof typeof measures];

/** Records `name` once per page load; later calls (e.g. StrictMode re-running effects) are ignored. */
export function markOnce(name: MarkName): void {
  if (performance.getEntriesByName(name, "mark").length > 0) return;
  performance.mark(name);
}

/** Records a `name` span from `start` (a `performance.now()` time) until now. */
export function measureSince(name: MeasureName, start: number): void {
  performance.measure(name, { start, end: performance.now() });
}
