import type { Locator, Page } from "@playwright/test";
import { animationsFinished, expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// Building a sample in the engine, or running a query on it.
const SAMPLE_TIMEOUT = 30_000;

/** A phone in portrait (iPhone 14 class) and a tablet in portrait. */
const screens = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
] as const;

/** Fails if the page is wider than the window, so that it would scroll sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/** Fails unless the whole of `locator` is inside the window, left to right. */
async function expectOnScreen(locator: Locator, width: number): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Not shown");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

/**
 * Layout tests for phone and tablet widths, for one system colour scheme. Each
 * `small-screens.<scheme>.spec.ts` file applies `colorSchemeOptions()` at the top level (it sets
 * browser launch options, which Playwright only allows there) and then registers these tests.
 */
export function smallScreenTests(colorScheme: "light" | "dark") {
  for (const { name, width, height } of screens) {
    test.describe(`${name} at ${width} × ${height} (${colorScheme})`, () => {
      test.use({ viewport: { width, height } });

      test("fits the top bar and the workspace without scrolling sideways", async ({ page }) => {
        await page.goto("/app/");

        // The sidebar waits behind the Tables button, so the workspace has the whole width.
        await expect(page.getByRole("complementary", { name: "Tables" })).toBeHidden();
        const banner = page.getByRole("banner");
        const controls = [
          banner.getByRole("button", { name: "Tables" }),
          banner.getByRole("img", { name: "Blinkql" }).filter({ visible: true }),
          banner.getByRole("button", { name: /^Commands/ }),
          banner.getByRole("button", { name: "Templates" }),
        ];
        let previousRight = 0;
        for (const control of controls) {
          await expectOnScreen(control, width);
          const box = await control.boundingBox();
          if (!box) throw new Error("Top bar control not shown");
          expect(box.x).toBeGreaterThanOrEqual(previousRight);
          previousRight = box.x + box.width;
        }
        await expectOnScreen(page.getByRole("button", { name: /^Run/ }), width);
        await expectOnScreen(page.getByRole("button", { name: "Export as HTML report" }), width);
        await expectOnScreen(page.getByRole("button", { name: "Share" }), width);
        await expectNoSidewaysScroll(page);
      });

      test("opens the sidebar as a sheet over the workspace and closes it", async ({
        page,
        makeAxeBuilder,
      }) => {
        // A full-page axe scan takes a while in Firefox.
        test.setTimeout(60_000);
        await page.goto("/app/");

        const open = page.getByRole("button", { name: "Tables" });
        await open.click();
        const sheet = page.getByRole("dialog", { name: "Tables and queries" });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("complementary", { name: "Tables" })).toBeVisible();
        await expect(sheet.getByRole("region", { name: "Queries" })).toBeVisible();
        await animationsFinished(page);
        // A strip of the page stays in view beside it, and tapping it closes the sheet.
        const box = await sheet.boundingBox();
        if (!box) throw new Error("Sheet not shown");
        expect(box.x).toBe(0);
        expect(box.width).toBeLessThanOrEqual(width - 48);
        const { violations } = await makeAxeBuilder().analyze();
        expect(violations).toEqual([]);

        await sheet.getByRole("button", { name: "Close" }).click();
        await expect(sheet).toBeHidden();
        await expect(open).toBeFocused();

        await open.click();
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();

        await open.click();
        await expect(sheet).toBeVisible();
        await animationsFinished(page);
        await page.mouse.click(width - 16, height / 2);
        await expect(sheet).toBeHidden();
      });

      test("loads sample data, runs a query and shows its result as a table and a chart", async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.goto("/app/");
        await expect(page.getByRole("status")).toHaveText(/^Engine ready/, {
          timeout: ENGINE_TIMEOUT,
        });

        await page.getByRole("button", { name: "Tables" }).click();
        const sheet = page.getByRole("dialog", { name: "Tables and queries" });
        await sheet.getByRole("button", { name: "Load sample data" }).click();
        const samples = page.getByRole("dialog", { name: "Load sample data" });
        await expectOnScreen(samples, width);
        await samples.getByRole("button", { name: /^Quality checks/ }).click();
        await expect(samples).toBeHidden({ timeout: SAMPLE_TIMEOUT });
        await expect(sheet.getByRole("treeitem", { name: /^quality_checks/ })).toBeVisible();
        await sheet.getByRole("button", { name: "Close" }).click();
        await expect(sheet).toBeHidden();

        await page.getByRole("textbox", { name: "SQL editor" }).click();
        await page.keyboard.type(
          "SELECT machine_id, sum(rejected) AS rejected FROM quality_checks GROUP BY 1",
        );
        await page.getByRole("button", { name: /^Run/ }).click();
        const grid = page.getByRole("grid", { name: "Results" });
        await expect(grid).toHaveAttribute("aria-rowcount", "9", { timeout: SAMPLE_TIMEOUT });
        await expectOnScreen(grid, width);
        await expectNoSidewaysScroll(page);

        await page.getByRole("button", { name: "Chart", exact: true }).click();
        const chart = page.getByRole("img", {
          name: /^Bar chart of sum\(rejected\) by machine_id/,
        });
        await expect(chart).toBeVisible({ timeout: SAMPLE_TIMEOUT });
        await expectOnScreen(chart, width);
        await expectOnScreen(page.getByLabel("Chart type"), width);
        await expectNoSidewaysScroll(page);
      });

      test("closes the sheet when a query starts from it, so the result is in view", async ({
        page,
      }) => {
        test.setTimeout(120_000);
        await page.goto("/app/");
        await expect(page.getByRole("status")).toHaveText(/^Engine ready/, {
          timeout: ENGINE_TIMEOUT,
        });

        await page.getByRole("button", { name: "Tables" }).click();
        const sheet = page.getByRole("dialog", { name: "Tables and queries" });
        await sheet.getByRole("button", { name: "Load sample data" }).click();
        const samples = page.getByRole("dialog", { name: "Load sample data" });
        await samples.getByRole("button", { name: /^Plants/ }).click();
        await expect(samples).toBeHidden({ timeout: SAMPLE_TIMEOUT });
        await sheet.getByRole("button", { name: "Show rows of plants" }).click();

        await expect(sheet).toBeHidden();
        await expect(page.getByRole("grid", { name: "Results" })).toBeVisible({
          timeout: SAMPLE_TIMEOUT,
        });
      });
    });
  }
}
