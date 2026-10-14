import AxeBuilder from "@axe-core/playwright";
import { test as base } from "@playwright/test";

// WCAG 2.2 A and AA, the level Blinkql targets (see the Design Language page).
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

type Fixtures = {
  /** An axe scan of the current page, limited to Blinkql's WCAG target. */
  makeAxeBuilder: () => AxeBuilder;
};

export const test = base.extend<Fixtures>({
  makeAxeBuilder: async ({ page }, use) => {
    await use(() => new AxeBuilder({ page }).withTags(WCAG_TAGS));
  },
});

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
