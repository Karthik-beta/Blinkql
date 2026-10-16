// The hero replay: the page's one motion sequence (issue #72, Design Language section 8).
// It only moves the page between three phases; CSS turns each phase into the lamp's rhythm.
//
//   loading  0–1.6 s   the lamp breathes while the engine starts (one --lamp-breathe cycle)
//   running  1.6–2.6 s the lamp blinks at 1 Hz while the query runs (one --lamp-blink cycle)
//   done     2.6 s     the rows appear in one step, the lamp flashes once and stays lit

export type Phase = "loading" | "running" | "done";

export const timeline = { running: 1600, done: 2600 } as const;

export interface ReplayOptions {
  /** The element carrying `data-phase` (the page's <body>). */
  root: HTMLElement;
  /** Polite live region, filled only when a person asks for a replay. */
  status?: HTMLElement | null;
  /** The sentence announced when a requested replay finishes. */
  doneMessage: string;
  reducedMotion: () => boolean;
}

export function createReplay({ root, status, doneMessage, reducedMotion }: ReplayOptions) {
  let timers: number[] = [];

  function setPhase(phase: Phase) {
    root.dataset.phase = phase;
  }

  function clear() {
    for (const id of timers) window.clearTimeout(id);
    timers = [];
  }

  /** Runs the sequence. `announce` is for replays a person asked for, not the one on load. */
  function play({ announce = false } = {}) {
    clear();
    if (status) status.textContent = "";
    const finish = () => {
      setPhase("done");
      if (announce && status) status.textContent = doneMessage;
    };
    // With reduced motion, show the final state straight away.
    if (reducedMotion()) {
      finish();
      return;
    }
    setPhase("loading");
    timers.push(
      window.setTimeout(() => setPhase("running"), timeline.running),
      window.setTimeout(finish, timeline.done),
    );
  }

  return { play, stop: clear };
}
