import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly, which the first step
// waits for.
const ENGINE_TIMEOUT = 60_000;

const tour = (page: Page) => page.getByRole("region", { name: "Tour" });
const chart = (page: Page) =>
  page.getByRole("img", { name: /^Bar chart of avg\(reject_rate_pct\) by machine_id, 8 bars/ });

test.describe("Onboarding tour", () => {
  test("takes a new user from the empty workbench to a chart", async ({ page, makeAxeBuilder }) => {
    await page.goto("/app/");

    await page.getByRole("button", { name: "Take the tour" }).click();
    await expect(tour(page)).toContainText("Step 1 of 3");
    const scan = await makeAxeBuilder().analyze();
    expect(scan.violations).toEqual([]);

    await tour(page).getByRole("button", { name: "Load quality checks" }).click();
    await expect(page.getByRole("treeitem", { name: /^quality_checks / })).toBeVisible({
      timeout: ENGINE_TIMEOUT,
    });
    await expect(tour(page)).toContainText("Step 2 of 3");
    await expect(page.getByRole("textbox", { name: "SQL editor" })).toContainText(
      "FROM quality_checks",
    );

    await tour(page).getByRole("button", { name: "Run the query" }).click();
    await expect(tour(page)).toContainText("Step 3 of 3");
    await tour(page).getByRole("button", { name: "Show as a chart" }).click();
    await expect(page.getByRole("button", { name: "Chart" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(chart(page)).toBeVisible();

    await tour(page).getByRole("button", { name: "Done" }).click();
    await expect(tour(page)).toBeHidden();
    // Not offered again, now that the user has been through it.
    await page.reload();
    await expect(page.getByRole("textbox", { name: "SQL editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Take the tour" })).toBeHidden();
  });

  test("can be followed with only the keyboard", async ({ page }) => {
    await page.goto("/app/");
    const invite = page.getByRole("button", { name: "Take the tour" });
    await expect(invite).toBeVisible();

    for (let presses = 0; presses < 30; presses++) {
      await page.keyboard.press("Tab");
      if (await invite.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(invite).toBeFocused();
    await page.keyboard.press("Enter");

    // Each step puts the focus on its button, so Enter carries on.
    await expect(tour(page).getByRole("button", { name: "Load quality checks" })).toBeFocused();
    await page.keyboard.press("Enter");
    const run = tour(page).getByRole("button", { name: "Run the query" });
    await expect(run).toBeFocused({ timeout: ENGINE_TIMEOUT });
    await page.keyboard.press("Enter");
    const show = tour(page).getByRole("button", { name: "Show as a chart" });
    await expect(show).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(chart(page)).toBeVisible();
    await expect(tour(page).getByRole("button", { name: "Done" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(tour(page)).toBeHidden();
    // The editor is in a shadow root (src/features/editor/SqlEditor.tsx), so ask that root.
    const editor = page.getByRole("textbox", { name: "SQL editor" });
    await expect
      .poll(() =>
        editor.evaluate(
          (element) => (element.getRootNode() as ShadowRoot).activeElement === element,
        ),
      )
      .toBe(true);
  });
});
