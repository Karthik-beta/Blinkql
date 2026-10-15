import { expect, test } from "./fixtures";

/**
 * App shell tests for one system colour scheme. Each `app-shell.<scheme>.spec.ts` file applies
 * `colorSchemeOptions()` at the top level (it sets browser launch options, which Playwright only
 * allows there) and then registers these tests.
 */
export function appShellTests(colorScheme: "light" | "dark") {
  test.describe(`app shell (${colorScheme})`, () => {
    test("shows the top bar and an empty workspace", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveTitle("Blinkql");
      await expect(page.getByRole("banner").getByRole("img", { name: "Blinkql" })).toBeVisible();
      await expect(page.getByRole("main", { name: "Workspace" })).toBeAttached();
    });

    test("follows the system colour scheme before first paint", async ({ page }) => {
      await page.goto("/");

      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(isDark).toBe(colorScheme === "dark");
    });

    test("has no detectable accessibility violations", async ({ page, makeAxeBuilder }) => {
      await page.goto("/");

      const results = await makeAxeBuilder().analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
