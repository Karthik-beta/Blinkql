import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveRun, type LiveResult } from "./live-run.ts";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const result: LiveResult = { rowCount: 56, elapsedMs: 9, gridHtml: "<table></table>" };

describe("hero live run", () => {
  let root: HTMLElement;
  let status: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    root.dataset.phase = "idle";
    status = document.createElement("p");
  });

  it("starts the engine, runs the query, then shows the result and announces it", async () => {
    const engine = deferred<void>();
    const answer = deferred<LiveResult>();
    const show = vi.fn();
    const run = createLiveRun({
      root,
      status,
      prepare: () => engine.promise,
      execute: () => answer.promise,
      show,
    });

    const finished = run.start();
    expect(root.dataset.phase).toBe("loading");

    engine.resolve();
    await vi.waitFor(() => expect(root.dataset.phase).toBe("running"));
    expect(show).not.toHaveBeenCalled();

    answer.resolve(result);
    await finished;
    expect(show).toHaveBeenCalledWith(result);
    expect(root.dataset.phase).toBe("done");
    expect(status.textContent).toBe("Query finished, 56 rows in 9 ms");
  });

  it("ignores a second request while a run is under way", async () => {
    const prepare = vi.fn(() => Promise.resolve());
    const run = createLiveRun({
      root,
      status,
      prepare,
      execute: () => Promise.resolve(result),
      show: () => {},
    });

    await Promise.all([run.start(), run.start()]);
    expect(prepare).toHaveBeenCalledTimes(1);

    await run.start();
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("goes back to the static result and says so when the engine fails", async () => {
    const show = vi.fn();
    const run = createLiveRun({
      root,
      status,
      prepare: () => Promise.reject(new Error("no WebAssembly")),
      execute: () => Promise.resolve(result),
      show,
    });

    await run.start();
    expect(root.dataset.phase).toBe("idle");
    expect(show).not.toHaveBeenCalled();
    expect(status.textContent).toMatch(/couldn't run the query/);
  });
});
