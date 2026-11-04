import type { Page, Request } from "@playwright/test";
import { marks } from "../../src/lib/user-timing.ts";
import { waitForMark } from "../harness/page.ts";
import type { Scenario } from "../harness/types.ts";

export const timeToEngineReady: Scenario = {
  name: "time-to-engine-ready",
  description:
    "Navigation start until DuckDB-wasm is running in its worker and has answered a first query (the blinkql:engine-ready mark), the bytes downloaded until then, and how long each start-up step took.",
  modes: ["cold", "warm"],
  metrics: {
    timeToEngineReady: "ms",
    bytesTransferred: "bytes",
    engineBootStartMs: "ms",
    workerMs: "ms",
    instantiateMs: "ms",
    openMs: "ms",
    connectMs: "ms",
    readyMs: "ms",
  },
  async run(page, baseURL) {
    // Requests from the engine's worker are reported on the page too. Cached responses count 0.
    const sizes: Promise<number>[] = [];
    const onFinished = (request: Request) =>
      sizes.push(request.sizes().then((s) => s.responseHeadersSize + s.responseBodySize));
    page.on("requestfinished", onFinished);
    await page.goto(new URL("/app/", baseURL).href);
    const timeToEngineReady = await waitForMark(page, marks.engineReady, 60_000);
    page.off("requestfinished", onFinished);
    const bytes = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
    return { timeToEngineReady, bytesTransferred: bytes, ...(await bootSteps(page)) };
  },
};

/**
 * When the engine started, and how long each step of boot() took after the previous one. Builds
 * from before P-13 have no step marks, so the metrics are left out for them.
 */
async function bootSteps(page: Page): Promise<Record<string, number>> {
  const order = [
    marks.engineBootStart,
    marks.engineWorkerCreated,
    marks.engineInstantiated,
    marks.engineOpened,
    marks.engineConnected,
    marks.engineReady,
  ];
  const times = await page.evaluate(
    (names) => names.map((name) => performance.getEntriesByName(name, "mark")[0]?.startTime),
    order,
  );
  const [start, worker, instantiated, opened, connected, ready] = times;
  if (
    start === undefined ||
    worker === undefined ||
    instantiated === undefined ||
    opened === undefined ||
    connected === undefined ||
    ready === undefined
  ) {
    return {};
  }
  return {
    engineBootStartMs: start,
    workerMs: worker - start,
    instantiateMs: instantiated - worker,
    openMs: opened - instantiated,
    connectMs: connected - opened,
    readyMs: ready - connected,
  };
}
