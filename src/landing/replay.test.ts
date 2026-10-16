import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplay, timeline } from "./replay.ts";

describe("hero replay", () => {
  let root: HTMLElement;
  let status: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    status = document.createElement("p");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function replay(reducedMotion = false) {
    return createReplay({
      root,
      status,
      doneMessage: "Query finished",
      reducedMotion: () => reducedMotion,
    });
  }

  it("moves from loading to running to done, once", () => {
    replay().play();
    expect(root.dataset.phase).toBe("loading");

    vi.advanceTimersByTime(timeline.running);
    expect(root.dataset.phase).toBe("running");

    vi.advanceTimersByTime(timeline.done - timeline.running);
    expect(root.dataset.phase).toBe("done");

    vi.advanceTimersByTime(10_000);
    expect(root.dataset.phase).toBe("done");
  });

  it("finishes in about 3 seconds and blinks for less than 5", () => {
    expect(timeline.done).toBeLessThanOrEqual(3000);
    expect(timeline.done - timeline.running).toBeLessThan(5000);
  });

  it("shows the final state straight away with reduced motion", () => {
    replay(true).play();
    expect(root.dataset.phase).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces only replays a person asked for", () => {
    const r = replay();
    r.play();
    vi.runAllTimers();
    expect(status.textContent).toBe("");

    r.play({ announce: true });
    expect(status.textContent).toBe("");
    vi.runAllTimers();
    expect(status.textContent).toBe("Query finished");
  });

  it("restarts cleanly when replayed mid-sequence", () => {
    const r = replay();
    r.play();
    vi.advanceTimersByTime(timeline.running + 100);
    r.play();
    expect(root.dataset.phase).toBe("loading");
    expect(vi.getTimerCount()).toBe(2);
  });
});
