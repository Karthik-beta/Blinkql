// User Timing marks and measures the benchmark harness (bench/) reads from the page.
// Their names are part of the benchmark contract: renaming one breaks comparisons with old results.
import type { ProfilerOnRenderCallback } from "react";

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
  /**
   * Preparing a result for the results table. Until P-02 this copied every row out of Arrow into
   * row objects; now it only sets up a reader per column, and cells are read as they render. The
   * name is kept so results stay comparable with older runs.
   */
  resultsConvert: "blinkql:results-convert",
  /** From a result reaching the main thread until the frame after its rows are committed. */
  resultsRender: "blinkql:results-render",
  /**
   * From sending a query until the frame after its first rows are committed: how long the user
   * waits to see rows. Until P-05 the first rows came with the whole result.
   */
  firstRows: "blinkql:first-rows",
  /** From a result's first rows reaching the main thread until the frame after they're committed. */
  firstRowsRender: "blinkql:first-rows-render",
  /**
   * React rendering a `<Profiler>`'s tree for one commit; `detail` holds the profiler's `id` and
   * the `phase`. Only recorded in development and in React's profiling build, which
   * `BLINKQL_REACT_PROFILING=1` builds (bench/README.md); production builds skip it.
   */
  reactCommit: "blinkql:react-commit",
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

/** A `<Profiler>`'s `onRender`: records the commit as a `reactCommit` measure. */
export const recordCommit: ProfilerOnRenderCallback = (id, phase, actualDuration, _, startTime) => {
  performance.measure(measures.reactCommit, {
    start: startTime,
    duration: actualDuration,
    detail: { id, phase },
  });
};
