// Driving the workbench the way a user does (import a file, type SQL, press Run) and reading the
// User Timing entries it records (src/lib/user-timing.ts).
import type { Page } from "@playwright/test";
import { type MarkName, type MeasureName, marks, measures } from "../../src/lib/user-timing.ts";

/**
 * Whether the build under test is React's profiling build (`BLINKQL_REACT_PROFILING=1`, which
 * vite.config.ts reads too). Only that build reports renders of the results table.
 */
export const reactProfiling = process.env.BLINKQL_REACT_PROFILING === "1";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// A naive import or query over a 1M-row, 50-column CSV can take minutes.
const STEP_TIMEOUT = 10 * 60_000;

/** The start time of mark `name`, waiting for it to be recorded. */
export async function waitForMark(page: Page, name: MarkName, timeout = 30_000): Promise<number> {
  const mark = await page.waitForFunction(
    (name) => {
      const [entry] = performance.getEntriesByName(name, "mark");
      // Wrapped in an object: a startTime of 0 would be falsy and keep waitForFunction polling.
      return entry && { startTime: entry.startTime };
    },
    name,
    { timeout },
  );
  // waitForFunction only resolves once the callback returns a truthy value.
  const { startTime } = (await mark.jsonValue()) as { startTime: number };
  return startTime;
}

type LongFrames = { observer: PerformanceObserver; durations: number[] };

/**
 * Runs in the page before its own scripts: records the duration of every long animation frame,
 * one in which the main thread was busy for 50 ms or more, rendering included. Only Chromium
 * reports them; elsewhere this records nothing.
 *
 * Not the Long Tasks API: Chromium leaves out tasks that run no script, so a frame spent only on
 * style and layout, such as laying out a large table, wouldn't count.
 */
function recordLongFrames() {
  if (!PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) return;
  const durations: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) durations.push(entry.duration);
  });
  observer.observe({ type: "long-animation-frame" });
  const frames: LongFrames = { observer, durations };
  Object.assign(window, { blinkqlLongFrames: frames });
}

/** Opens the workbench and waits until the engine has answered its first query. */
export async function openWorkbench(page: Page, baseURL: string): Promise<void> {
  await page.addInitScript(recordLongFrames);
  await page.goto(new URL("/app/", baseURL).href);
  await waitForMark(page, marks.engineReady, ENGINE_TIMEOUT);
}

/**
 * Waits for the latest `name` measure and returns its duration, or fails with the text of the
 * first alert (an import or query error) if one appears first. Measures are cleared beforehand by
 * `clearMeasures()`, so the one found belongs to the step just started.
 */
async function waitForMeasure(page: Page, name: MeasureName): Promise<number> {
  const outcome = await page.waitForFunction(
    (name) => {
      const entry = performance.getEntriesByName(name, "measure").at(-1);
      if (entry) return { duration: entry.duration };
      const alert = document.querySelector('[role="alert"]');
      return alert?.textContent ? { error: alert.textContent } : null;
    },
    name,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );
  const result = (await outcome.jsonValue()) as { duration: number } | { error: string };
  if ("error" in result) throw new Error(`The workbench reported: ${result.error}`);
  return result.duration;
}

async function clearMeasures(page: Page): Promise<void> {
  await page.evaluate(() => performance.clearMeasures());
}

/** Imports the file at `path` through the file picker; returns the import time in ms. */
export async function importFile(page: Page, path: string): Promise<number> {
  await clearMeasures(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  return waitForMeasure(page, measures.import);
}

export type QueryTimings = {
  /** Sent to the engine until the Arrow result is on the main thread. */
  query: number;
  /** Preparing the result for the table: row objects until P-02, column readers since. */
  convert: number;
  /** Result on the main thread until the frame after its rows are committed. */
  render: number;
  /**
   * The longest animation frame from pressing Run until the rows are shown: the longest the page
   * went without responding, rendering included. 0 if no frame took 50 ms or more; undefined where
   * the browser doesn't report long animation frames (only Chromium does).
   */
  longestFrame: number | undefined;
  /**
   * In React's profiling build only: how many times React rendered the results table from
   * pressing Run until the rows are shown, and the time it spent doing so.
   */
  resultsCommits: number | undefined;
  resultsReactMs: number | undefined;
};

/** Forgets the long animation frames recorded so far. */
async function clearLongFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames = (window as { blinkqlLongFrames?: LongFrames }).blinkqlLongFrames;
    if (!frames) return;
    frames.observer.takeRecords();
    frames.durations.length = 0;
  });
}

/** The longest frame recorded since `clearLongFrames()`, or undefined if the browser can't tell. */
async function longestFrame(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const frames = (window as { blinkqlLongFrames?: LongFrames }).blinkqlLongFrames;
    if (!frames) return undefined;
    // Entries the observer hasn't delivered yet, such as the frame that just ended.
    const pending = frames.observer.takeRecords().map((entry) => entry.duration);
    return Math.max(0, ...frames.durations, ...pending);
  });
}

/** Types `sql` into the editor, replacing what's there, runs it and waits for its rows to show. */
export async function runQuery(page: Page, sql: string): Promise<QueryTimings> {
  await clearMeasures(page);
  await page.getByRole("textbox", { name: "SQL editor" }).click();
  await page.keyboard.press("ControlOrMeta+A");
  // insertText, not type: the editor's bracket and quote auto-closing would mangle typed SQL.
  await page.keyboard.insertText(sql);
  await clearLongFrames(page);
  await page.keyboard.press("ControlOrMeta+Enter");
  const render = await waitForMeasure(page, measures.resultsRender);
  const [query, convert] = await page.evaluate(
    (names) => names.map((name) => performance.getEntriesByName(name, "measure").at(-1)?.duration),
    [measures.query, measures.resultsConvert],
  );
  if (query === undefined || convert === undefined) {
    throw new Error("The results rendered without query and convert measures");
  }
  const commits = reactProfiling ? await resultsCommits(page) : undefined;
  return {
    query,
    convert,
    render,
    longestFrame: await longestFrame(page),
    resultsCommits: commits?.length,
    resultsReactMs: commits?.reduce((sum, duration) => sum + duration, 0),
  };
}

/** How long each render of the results table took, since the measures were cleared. */
async function resultsCommits(page: Page): Promise<number[]> {
  return page.evaluate(
    (name) =>
      performance
        .getEntriesByName(name, "measure")
        .filter((entry) => (entry as PerformanceMeasure).detail?.id === "results")
        .map((entry) => entry.duration),
    measures.reactCommit,
  );
}

export type MemoryUse = {
  /** Everything the page uses: its JavaScript heap, the DOM and the engine's worker. */
  total: number;
  /** The engine's worker, which holds DuckDB's WebAssembly memory. */
  worker: number;
};

type MemoryMeasurement = {
  bytes: number;
  breakdown: { bytes: number; attribution: { scope: string }[] }[];
};

/**
 * The page's memory use, from `performance.measureUserAgentSpecificMemory()`, or undefined where
 * that isn't supported (it needs Chromium's full browser and cross-origin isolation; run.ts
 * launches Chromium accordingly).
 */
export async function measureMemory(page: Page): Promise<MemoryUse | undefined> {
  const measurement = await page.evaluate(async () => {
    const api = performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<unknown>;
    };
    if (!crossOriginIsolated || !api.measureUserAgentSpecificMemory) return undefined;
    return api.measureUserAgentSpecificMemory();
  });
  if (!measurement) return undefined;
  const { bytes, breakdown } = measurement as MemoryMeasurement;
  const worker = breakdown
    .filter(({ attribution }) =>
      attribution.some(({ scope }) => scope === "DedicatedWorkerGlobalScope"),
    )
    .reduce((sum, entry) => sum + entry.bytes, 0);
  return { total: bytes, worker };
}
