// The hero's live run: the page's one motion sequence (issue #72, Design Language section 8).
// It runs only when a person asks, and only moves the page between phases; CSS turns each phase
// into the lamp's rhythm.
//
//   idle     the static result the page ships with, also shown without JavaScript
//   loading  the lamp breathes while the engine starts and the sample data loads
//   running  the lamp blinks at 1 Hz while the query runs
//   done     the live rows appear in one step, the lamp flashes once and stays lit

export type Phase = "idle" | "loading" | "running" | "done";

export interface LiveResult {
  rowCount: number;
  elapsedMs: number;
  /** The results grid, rendered from the first rows. */
  gridHtml: string;
}

export interface LiveRunOptions {
  /** The element carrying `data-phase` (the page's <body>). */
  root: HTMLElement;
  /** Polite live region for the outcome. */
  status?: HTMLElement | null;
  /** Starts the engine and loads the sample data. */
  prepare: () => Promise<void>;
  /** Runs the sample query. */
  execute: () => Promise<LiveResult>;
  /** Puts the result on the page. */
  show: (result: LiveResult) => void;
}

export function createLiveRun({ root, status, prepare, execute, show }: LiveRunOptions) {
  let running: Promise<void> | null = null;

  function setPhase(phase: Phase) {
    root.dataset.phase = phase;
  }

  function announce(message: string) {
    if (status) status.textContent = message;
  }

  async function run() {
    announce("");
    setPhase("loading");
    try {
      await prepare();
      setPhase("running");
      const result = await execute();
      show(result);
      setPhase("done");
      announce(`Query finished, ${result.rowCount} rows in ${result.elapsedMs} ms`);
    } catch {
      setPhase("idle");
      announce("Your browser couldn't run the query, so the sample result is still showing.");
    }
  }

  /** Runs the sample query live. A request while a run is under way joins that run. */
  function start(): Promise<void> {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  }

  return { start };
}
