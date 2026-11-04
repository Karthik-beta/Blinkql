import { marks } from "../../src/lib/user-timing.ts";
import { waitForMark } from "../harness/page.ts";
import type { Scenario } from "../harness/types.ts";

export const timeToAppShell: Scenario = {
  name: "time-to-app-shell",
  description: "Navigation start until the app shell is committed (the blinkql:app-shell mark).",
  modes: ["cold", "warm"],
  metrics: { timeToAppShell: "ms" },
  async run(page, baseURL) {
    await page.goto(new URL("/app/", baseURL).href);
    return { timeToAppShell: await waitForMark(page, marks.appShell) };
  },
};
