import AxeBuilder from "@axe-core/playwright";
import { test as base, type Page } from "@playwright/test";

// WCAG 2.2 A and AA, the level Blinkql targets (see the Design Language page).
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

// Main-thread work longer than this delays the response to input noticeably.
const LONG_WORK_MS = 50;

type LongWork = { type: string; startTime: number; duration: number };

declare global {
  interface Window {
    /** Main-thread work over 50 ms, collected by the `longWorkDuringQueries` fixture. */
    blinkqlLongWork?: LongWork[];
  }
}

type Fixtures = {
  /** An axe scan of the current page, limited to Blinkql's WCAG target. */
  makeAxeBuilder: () => AxeBuilder;
  /**
   * Main-thread work over 50 ms while the page's queries ran: long tasks, and long
   * animation frames, which also catch layout and rendering that run no script and so never show
   * up as long tasks. Only Chromium reports either, so elsewhere this is always empty.
   */
  longWorkDuringQueries: () => Promise<LongWork[]>;
};

export const test = base.extend<Fixtures>({
  makeAxeBuilder: async ({ page }, use) => {
    await use(() => new AxeBuilder({ page }).withTags(WCAG_TAGS));
  },
  longWorkDuringQueries: async ({ page }, use) => {
    await page.addInitScript(() => {
      const seen: LongWork[] = [];
      window.blinkqlLongWork = seen;
      for (const type of ["longtask", "long-animation-frame"]) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        new PerformanceObserver((list) => {
          for (const { startTime, duration } of list.getEntries()) {
            seen.push({ type, startTime, duration });
          }
        }).observe({ type, buffered: true });
      }
    });
    await use(() => longWorkDuringQueries(page));
  },
});

function longWorkDuringQueries(page: Page): Promise<LongWork[]> {
  return page.evaluate(async (budget) => {
    // Long animation frames are reported only after they end.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    // A query runs from being sent until the frame after its last rows are on screen.
    const spans = ["blinkql:query", "blinkql:results-render"].flatMap((name) =>
      performance.getEntriesByName(name, "measure"),
    );
    if (spans.length === 0) throw new Error("No query has finished on this page.");
    return (window.blinkqlLongWork ?? []).filter(
      (work) =>
        work.duration > budget &&
        spans.some(
          (span) =>
            work.startTime < span.startTime + span.duration &&
            work.startTime + work.duration > span.startTime,
        ),
    );
  }, LONG_WORK_MS);
}

/**
 * Options for `test.use()` that put the page in a light or dark system colour scheme.
 *
 * Playwright's `colorScheme` emulation is lost in Firefox when Cross-Origin-Opener-Policy moves
 * the page into a new browsing context group, so Firefox also gets its own preference, which
 * applies browser-wide. Chromium and WebKit ignore `firefoxUserPrefs`.
 */
export function colorSchemeOptions(colorScheme: "light" | "dark") {
  return {
    colorScheme,
    launchOptions: {
      firefoxUserPrefs: {
        // 0 = dark, 1 = light
        "layout.css.prefers-color-scheme.content-override": colorScheme === "dark" ? 0 : 1,
      },
    },
  };
}

export { expect } from "@playwright/test";
