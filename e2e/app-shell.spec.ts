import { expect, test } from "./fixtures";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`app shell (${colorScheme})`, () => {
    test.use({ colorScheme });

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
