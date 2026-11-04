import type { ScenarioResult } from "./measure.ts";

/** Scenario → mode → metric → the highest median that passes. */
export type Thresholds = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>
>;

/**
 * One line per threshold the results break: a median above its ceiling, or a scenario, mode or
 * metric missing from the results, so a renamed metric can't pass by going unmeasured.
 */
export function breaches(results: readonly ScenarioResult[], thresholds: Thresholds): string[] {
  const found: string[] = [];
  for (const [scenario, modes] of Object.entries(thresholds)) {
    for (const [mode, metrics] of Object.entries(modes)) {
      const result = results.find((r) => r.scenario === scenario && r.mode === mode);
      for (const [metric, max] of Object.entries(metrics)) {
        const name = `${scenario} (${mode}) ${metric}`;
        const summary = result?.metrics[metric];
        if (!summary) found.push(`${name}: not in the results`);
        else if (summary.median > max) {
          const unit = summary.unit === "count" ? "" : ` ${summary.unit}`;
          found.push(`${name}: median ${summary.median}${unit} > ${max}${unit}`);
        }
      }
    }
  }
  return found;
}
