import type { Request } from "@playwright/test";
import { marks } from "../../src/lib/user-timing.ts";
import { waitForMark } from "../harness/page.ts";
import type { Scenario } from "../harness/types.ts";

export const timeToEngineReady: Scenario = {
  name: "time-to-engine-ready",
  description:
    "Navigation start until DuckDB-wasm is running in its worker and has answered a first query (the blinkql:engine-ready mark), and the bytes downloaded until then.",
  modes: ["cold", "warm"],
  metrics: { timeToEngineReady: "ms", bytesTransferred: "bytes" },
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
    return { timeToEngineReady, bytesTransferred: bytes };
  },
};
