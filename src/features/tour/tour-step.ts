// Which step of the onboarding tour is open, if any, and whether the user has been through it.
// The tour itself is Tour.tsx; startTour() opens it from anywhere, such as a command.

/** Load a sample, run a query on it, chart the result, and the chart shown. */
export type TourStep = "load" | "run" | "chart" | "done";

/** Set once the tour has ended, so the empty results area stops offering it. */
const SEEN_KEY = "blinkql-tour-seen";

let step: TourStep | null = null;
const listeners = new Set<() => void>();

function setStep(next: TourStep | null): void {
  step = next;
  for (const listener of listeners) listener();
}

/** The open step, or null while the tour is closed. */
export function getTourStep(): TourStep | null {
  return step;
}

/** Calls `listener` whenever the tour opens, moves on or ends; returns a function that unsubscribes. */
export function subscribeToTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the user has finished or skipped the tour before, in this browser. */
export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    // Storage can be blocked; the tour is then offered each time.
    return false;
  }
}

/** Opens the tour at its first step; does nothing while it's open. */
export function startTour(): void {
  if (step === null) setStep("load");
}

/** Moves the open tour to `next`. */
export function showTourStep(next: TourStep): void {
  if (step !== null) setStep(next);
}

/** Closes the tour and remembers that the user has been through it. */
export function endTour(): void {
  if (step === null) return;
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to remember it in; it's offered again next time.
  }
  setStep(null);
}
