import { expect, test } from "./fixtures";

/**
 * App shell tests for one system colour scheme. Each `app-shell.<scheme>.spec.ts` file applies
 * `colorSchemeOptions()` at the top level (it sets browser launch options, which Playwright only
 * allows there) and then registers these tests.
 */
export function appShellTests(colorScheme: "light" | "dark") {
  test.describe(`app shell (${colorScheme})`, () => {
    test("shows the top bar and the workspace", async ({ page }) => {
      await page.goto("/app/");

      await expect(page).toHaveTitle("Blinkql");
      await expect(page.getByRole("banner").getByRole("img", { name: "Blinkql" })).toBeVisible();
      await expect(page.getByRole("main", { name: "Workspace" })).toBeAttached();
    });

    test("follows the system colour scheme before first paint", async ({ page }) => {
      await page.goto("/app/");

      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(isDark).toBe(colorScheme === "dark");
    });

    test("puts the Tables actions on the heading's row, clear of it and the sidebar edge", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/app/");

      const sidebar = page.getByRole("complementary", { name: "Tables" });
      const addUrlButton = sidebar.getByRole("button", { name: "Add from URL" });
      const importButton = sidebar.getByRole("button", { name: "Import files" });
      const heading = await sidebar.getByRole("heading", { name: "Tables" }).boundingBox();
      const addUrl = await addUrlButton.boundingBox();
      const importFiles = await importButton.boundingBox();
      const edge = await sidebar.boundingBox();
      if (!heading || !addUrl || !importFiles || !edge) throw new Error("Tables header not shown");

      const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
      expect(Math.abs(middle(addUrl) - middle(heading))).toBeLessThanOrEqual(4);
      expect(Math.abs(middle(importFiles) - middle(heading))).toBeLessThanOrEqual(4);
      expect(addUrl.x - (heading.x + heading.width)).toBeGreaterThanOrEqual(8);
      expect(importFiles.x - (addUrl.x + addUrl.width)).toBeGreaterThanOrEqual(4);
      expect(edge.x + edge.width - (importFiles.x + importFiles.width)).toBeGreaterThanOrEqual(8);

      // The buttons show only icons, so each names itself on hover and on keyboard focus.
      const tooltip = page.getByRole("tooltip");
      await importButton.hover();
      await expect(tooltip.filter({ hasText: /^Import files$/ })).toBeVisible();
      await page.mouse.move(edge.x + edge.width + 200, edge.y + edge.height / 2);
      await expect(tooltip).toHaveCount(0);
      await importButton.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(addUrlButton).toBeFocused();
      await expect(tooltip.filter({ hasText: /^Add from URL$/ })).toBeVisible();
    });

    test("has no detectable accessibility violations", async ({ page, makeAxeBuilder }) => {
      await page.goto("/app/");

      const results = await makeAxeBuilder().analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
