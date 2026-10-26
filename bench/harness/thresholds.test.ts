import { describe, expect, it } from "vitest";
import type { ScenarioResult } from "./measure.ts";
import { breaches } from "./thresholds.ts";

/** A result with the given medians; `attempts` counts, every other metric is in ms. */
function result(scenario: string, mode: "cold" | "warm", medians: Record<string, number>) {
  return {
    scenario,
    description: "",
    mode,
    metrics: Object.fromEntries(
      Object.entries(medians).map(([metric, median]) => [
        metric,
        {
          unit: metric === "attempts" ? "count" : "ms",
          median,
          p95: median,
          min: median,
          max: median,
          mean: median,
          samples: [],
        },
      ]),
    ),
  } satisfies ScenarioResult;
}

const results = [
  result("time-to-app-shell", "cold", { timeToAppShell: 600 }),
  result("time-to-app-shell", "warm", { timeToAppShell: 500 }),
  result("rerun-while-running", "warm", { rerunMs: 70, attempts: 1 }),
];

describe("breaches", () => {
  it("passes medians at or under their ceilings", () => {
    expect(
      breaches(results, {
        "time-to-app-shell": { cold: { timeToAppShell: 600 }, warm: { timeToAppShell: 3000 } },
        "rerun-while-running": { warm: { attempts: 1 } },
      }),
    ).toEqual([]);
  });

  it("reports a median over its ceiling", () => {
    expect(
      breaches(results, {
        "time-to-app-shell": { cold: { timeToAppShell: 599 } },
        "rerun-while-running": { warm: { rerunMs: 1000, attempts: 0 } },
      }),
    ).toEqual([
      "time-to-app-shell (cold) timeToAppShell: median 600 ms > 599 ms",
      "rerun-while-running (warm) attempts: median 1 > 0",
    ]);
  });

  it("reports a scenario, mode or metric missing from the results", () => {
    expect(
      breaches(results, {
        "chart-line-1m-sql": { warm: { chartRenderMs: 4000 } },
        "rerun-while-running": { cold: { rerunMs: 1000 }, warm: { renamedMs: 1000 } },
      }),
    ).toEqual([
      "chart-line-1m-sql (warm) chartRenderMs: not in the results",
      "rerun-while-running (cold) rerunMs: not in the results",
      "rerun-while-running (warm) renamedMs: not in the results",
    ]);
  });
});
