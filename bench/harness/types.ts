import type { Page } from "@playwright/test";

/**
 * cold: every iteration gets a fresh browser context (empty cache and storage).
 * warm: all iterations share one context with a profile on disk, so the warm-up iterations fill
 * its cache, as for a returning visitor.
 */
export type Mode = "cold" | "warm";

export type Scenario = {
  /** Stable kebab-case id; results are compared across commits by this name. */
  name: string;
  description: string;
  /** Modes the scenario runs in when `--mode` isn't given. */
  modes: readonly Mode[];
  /** Metric name → unit, for every value `run` returns. */
  metrics: Readonly<Record<string, "ms" | "bytes" | "count">>;
  /**
   * One iteration on a page that hasn't navigated yet; returns a value per metric. A metric the
   * browser can't measure (e.g. memory outside Chromium) is undefined in every iteration, and is
   * left out of the result.
   */
  run: (page: Page, baseURL: string) => Promise<Record<string, number | undefined>>;
};
