import type { Browser } from "@playwright/test";
import { type Summary, summarize } from "./stats.ts";
import type { Mode, Scenario } from "./types.ts";

// Browsers coarsen timers to 5 µs or more under cross-origin isolation; finer digits are noise.
const round = (value: number) => Math.round(value * 1000) / 1000;

export type Iterations = { warmup: number; measured: number };

export type ScenarioResult = {
  scenario: string;
  description: string;
  mode: Mode;
  metrics: Record<string, Summary & { unit: string }>;
};

/** Runs `scenario` for the warm-up iterations, then the measured ones, and summarizes them. */
export async function measure(
  browser: Browser,
  scenario: Scenario,
  mode: Mode,
  baseURL: string,
  iterations: Iterations,
): Promise<ScenarioResult> {
  const samples = new Map<string, number[]>(Object.keys(scenario.metrics).map((m) => [m, []]));
  const unsupported = new Set<string>();
  const sharedContext = mode === "warm" ? await browser.newContext() : undefined;

  try {
    for (let i = 0; i < iterations.warmup + iterations.measured; i++) {
      const context = sharedContext ?? (await browser.newContext());
      const page = await context.newPage();
      try {
        const values = await scenario.run(page, baseURL);
        if (i < iterations.warmup) continue;
        for (const [metric, list] of samples) {
          const value = values[metric];
          // An unsupported metric is missing from every iteration; missing from only some is a bug.
          const first = i === iterations.warmup;
          if (value === undefined ? !first && !unsupported.has(metric) : unsupported.has(metric)) {
            throw new Error(`${scenario.name} returned "${metric}" in only some iterations`);
          }
          if (value === undefined) unsupported.add(metric);
          else list.push(round(value));
        }
      } finally {
        await page.close();
        if (!sharedContext) await context.close();
      }
    }
  } finally {
    await sharedContext?.close();
  }

  return {
    scenario: scenario.name,
    description: scenario.description,
    mode,
    metrics: Object.fromEntries(
      [...samples]
        .filter(([metric]) => !unsupported.has(metric))
        .map(([metric, list]) => {
          const { median, p95, min, max, mean, samples: raw } = summarize(list);
          const summary: Summary = {
            median: round(median),
            p95: round(p95),
            min: round(min),
            max: round(max),
            mean: round(mean),
            samples: raw,
          };
          return [metric, { unit: scenario.metrics[metric] as string, ...summary }];
        }),
    ),
  };
}
