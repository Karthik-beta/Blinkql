import { marks } from "../../src/lib/user-timing.ts";
import type { Scenario } from "../harness/types.ts";

export const timeToAppShell: Scenario = {
  name: "time-to-app-shell",
  description: "Navigation start until the app shell is committed (the blinkql:app-shell mark).",
  modes: ["cold", "warm"],
  metrics: { timeToAppShell: "ms" },
  async run(page, baseURL) {
    await page.goto(baseURL);
    const mark = await page.waitForFunction((name) => {
      const [entry] = performance.getEntriesByName(name, "mark");
      // Wrapped in an object: a startTime of 0 would be falsy and keep waitForFunction polling.
      return entry && { startTime: entry.startTime };
    }, marks.appShell);
    // waitForFunction only resolves once the callback returns a truthy value.
    const { startTime } = (await mark.jsonValue()) as { startTime: number };
    return { timeToAppShell: startTime };
  },
};
