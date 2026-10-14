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

export { expect } from "@playwright/test";
