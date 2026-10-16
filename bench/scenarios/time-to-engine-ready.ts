import { marks } from "../../src/lib/user-timing.ts";
import type { Scenario } from "../harness/types.ts";

export const timeToEngineReady: Scenario = {
  name: "time-to-engine-ready",
  description:
    "Navigation start until DuckDB-wasm is running in its worker and has answered a first query (the blinkql:engine-ready mark).",
  modes: ["cold", "warm"],
  metrics: { timeToEngineReady: "ms" },
  async run(page, baseURL) {
    await page.goto(new URL("/app/", baseURL).href);
    const mark = await page.waitForFunction(
      (name) => {
        const [entry] = performance.getEntriesByName(name, "mark");
        // Wrapped in an object: a startTime of 0 would be falsy and keep waitForFunction polling.
        return entry && { startTime: entry.startTime };
      },
      marks.engineReady,
      { timeout: 60_000 },
    );
    // waitForFunction only resolves once the callback returns a truthy value.
    const { startTime } = (await mark.jsonValue()) as { startTime: number };
    return { timeToEngineReady: startTime };
  },
};
