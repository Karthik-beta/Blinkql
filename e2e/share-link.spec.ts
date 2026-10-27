import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const SQL = "SELECT machine_id, inspected, rejected FROM quality_checks";
const CHART = "Bar chart of sum(rejected) by machine_id";

async function loadQualityChecks(page: Page) {
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: /^Quality checks/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: ENGINE_TIMEOUT });
}

test.describe("Share links", () => {
  test("share a query and its chart, but no data, and open it on another machine", async ({
    page,
    browser,
    makeAxeBuilder,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/app/");
    await loadQualityChecks(page);
    await page.getByRole("textbox", { name: "SQL editor" }).click();
    await page.keyboard.type(SQL);
    await page.keyboard.press("ControlOrMeta+Enter");
    const firstRow = page.getByRole("grid", { name: "Results" }).getByRole("row").nth(1);
    await expect(firstRow).toBeVisible();
    const values = await firstRow.getByRole("gridcell").allTextContents();

    await page.getByRole("button", { name: "Chart" }).click();
    await page.getByLabel("Chart type").selectOption("bar");
    await page.getByLabel("X", { exact: true }).selectOption("machine_id");
    await page.getByLabel("Aggregate").selectOption("sum");
    await page.getByLabel("Y", { exact: true }).selectOption("rejected");
    await expect(page.getByRole("img", { name: CHART })).toBeVisible();

    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog", { name: "Share query" });
    await expect(dialog.getByText(/holds the query and chart settings, but no data/)).toBeVisible();
    const link = await dialog.getByLabel("Link").inputValue();
    const scan = await makeAxeBuilder().include('[role="dialog"]').analyze();
    expect(scan.violations).toEqual([]);

    // The link carries exactly the query and the chart's settings, and none of the result.
    const fragment = new URL(link).hash;
    expect(fragment).toMatch(/^#share=1\./);
    const shared = JSON.parse(
      Buffer.from(fragment.slice("#share=1.".length), "base64url").toString(),
    );
    expect(shared).toEqual({
      sql: SQL,
      chart: { type: "bar", x: "machine_id", y: "rejected", aggregate: "sum" },
    });
    for (const value of values.filter((text) => text.trim())) {
      expect(JSON.stringify(shared)).not.toContain(value);
    }
    await dialog.getByRole("button", { name: "Close" }).click();

    // Someone else, with nothing loaded yet.
    const context = await browser.newContext();
    const recipient = await context.newPage();
    await recipient.goto(link);
    await expect(
      recipient.getByText("Opened a shared query. Run it once its data is loaded."),
    ).toBeVisible();
    await expect(recipient.getByRole("textbox", { name: "SQL editor" })).toHaveText(SQL);
    expect(new URL(recipient.url()).hash).toBe("");
    await expect(recipient.getByRole("grid", { name: "Results" })).toHaveCount(0);

    await loadQualityChecks(recipient);
    await recipient.getByRole("button", { name: /^Run/ }).click();
    await expect(recipient.getByRole("button", { name: "Chart" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(recipient.getByRole("img", { name: CHART })).toBeVisible();
    await expect(recipient.getByLabel("Aggregate")).toHaveValue("sum");
    await context.close();
  });
});
