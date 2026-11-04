import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// A million rows arrive in about 490 batches (P-05); see results.spec.ts.
const MILLION_ROWS_TIMEOUT = 30_000;

test.describe("Charts", () => {
  test("charts a million-row result without blocking the main thread", async ({
    page,
    longWorkDuringQueries,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/app/");
    await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
    await page.getByRole("textbox", { name: "SQL editor" }).click();
    await page.keyboard.type("SELECT range % 7 AS weekday, random() AS v FROM range(1000000)");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("grid", { name: "Results" })).toHaveAttribute(
      "aria-rowcount",
      "1000001",
      { timeout: MILLION_ROWS_TIMEOUT },
    );

    await page.getByRole("button", { name: "Chart" }).click();
    await page.getByLabel("Chart type").selectOption("bar");
    const chart = page.getByRole("img", { name: "Bar chart of count(*) by weekday" });
    await expect(chart).toBeVisible({ timeout: MILLION_ROWS_TIMEOUT });
    expect(await chart.evaluate((element) => element.tagName)).toBe("CANVAS");

    await page.getByLabel("Aggregate").selectOption("avg");
    await page.getByLabel("Y", { exact: true }).selectOption("v");
    await expect(page.getByRole("img", { name: "Bar chart of avg(v) by weekday" })).toBeVisible({
      timeout: MILLION_ROWS_TIMEOUT,
    });

    for (const [type, name] of [
      ["line", "Line chart of avg(v) by weekday"],
      ["scatter", "Scatter chart of v by weekday"],
      ["histogram", "Histogram of weekday"],
      ["pareto", "Pareto chart of count(*) by weekday"],
    ] as const) {
      await page.getByLabel("Chart type").selectOption(type);
      await expect(page.getByRole("img", { name })).toBeVisible({ timeout: MILLION_ROWS_TIMEOUT });
    }
    expect(await longWorkDuringQueries()).toEqual([]);
  });

  test("describes a chart and shows its data as a table", async ({ page, makeAxeBuilder }) => {
    await page.goto("/app/");
    await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
    await page.getByRole("textbox", { name: "SQL editor" }).click();
    await page.keyboard.type("SELECT range % 3 AS weekday FROM range(10)");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.getByRole("button", { name: "Chart" }).click();
    await expect(
      page.getByRole("img", {
        name: "Bar chart of count(*) by weekday, 3 bars, highest 4 (0), lowest 3 (1)",
        exact: true,
      }),
    ).toBeVisible();

    const toggle = page.getByRole("button", { name: "View as table" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const table = page.getByRole("table", { name: "Bar chart of count(*) by weekday" });
    await expect(table.getByRole("columnheader")).toHaveText(["weekday", "count(*)"]);
    await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText(["0", "4"]);

    const scan = await makeAxeBuilder().include('section[aria-label="Chart"]').analyze();
    expect(scan.violations).toEqual([]);
  });
});
