import { readFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// A million rows arrive in about 490 batches (P-05); see results.spec.ts.
const MILLION_ROWS_TIMEOUT = 30_000;
const LONG_WORK_MS = 50;

const results = (page: Page) => page.getByRole("grid", { name: "Results" });

async function runSql(page: Page, sql: string, rowCount: number) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
  await page.getByRole("textbox", { name: "SQL editor" }).click();
  await page.keyboard.type(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(results(page)).toHaveAttribute("aria-rowcount", String(rowCount + 1), {
    timeout: MILLION_ROWS_TIMEOUT,
  });
}

/** Clicks `button` and resolves with the download it starts. */
async function download(page: Page, button: string) {
  const started = page.waitForEvent("download");
  await page.getByRole("button", { name: button }).click();
  return started;
}

test.describe("Export", () => {
  test("exports the result as CSV", async ({ page }) => {
    await runSql(page, "SELECT range AS n, 'row ' || range AS label FROM range(3);", 3);

    const file = await download(page, "Export as CSV");

    expect(file.suggestedFilename()).toMatch(/^blinkql-result-[\d-]+\.csv$/);
    expect(await readFile(await file.path(), "utf8")).toBe("n,label\n0,row 0\n1,row 1\n2,row 2\n");
    await expect(page.getByText(`Downloaded ${file.suggestedFilename()}`)).toBeVisible();
  });

  test("exports the result as Parquet", async ({ page }) => {
    await runSql(page, "SELECT range AS n, range * 1.5 AS amount FROM range(100)", 100);

    const file = await download(page, "Export as Parquet");

    expect(file.suggestedFilename()).toMatch(/^blinkql-result-[\d-]+\.parquet$/);
    const path = (await file.path()).replaceAll("\\", "/");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    const reader = await connection.runAndReadAll(
      `SELECT count(*)::INTEGER AS rows, sum(amount)::DOUBLE AS total FROM read_parquet('${path}')`,
    );
    connection.closeSync();
    instance.closeSync();
    expect(reader.getRowObjects()).toEqual([{ rows: 100, total: 7425 }]);
  });

  test("says why a result can't be exported", async ({ page }) => {
    await runSql(page, "CREATE TABLE t AS SELECT 1 AS a", 1);

    await page.getByRole("button", { name: "Export as CSV" }).click();

    await expect(page.getByText(/^Couldn't export: /)).toBeVisible();
  });

  test("exports a million-row result without blocking the main thread", async ({
    page,
    longWorkDuringQueries,
  }) => {
    test.setTimeout(120_000);
    await runSql(page, "SELECT range AS n, random() AS v FROM range(1000000)", 1_000_000);
    expect(await longWorkDuringQueries()).toEqual([]);

    const exportStart = await page.evaluate(() => performance.now());
    const file = await download(page, "Export as CSV");
    await expect(page.getByText(`Downloaded ${file.suggestedFilename()}`)).toBeVisible({
      timeout: MILLION_ROWS_TIMEOUT,
    });
    const longWork = await page.evaluate(
      async ({ since, budget }) => {
        // Long animation frames are reported only after they end.
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
        return (window.blinkqlLongWork ?? []).filter(
          (work) => work.duration > budget && work.startTime + work.duration > since,
        );
      },
      { since: exportStart, budget: LONG_WORK_MS },
    );

    expect(longWork).toEqual([]);
    const lines = (await readFile(await file.path(), "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(1_000_001);
    expect(lines[0]).toBe("n,v");
  });

  test("exports a chart as a PNG", async ({ page }) => {
    await runSql(page, "SELECT range % 3 AS k FROM range(30)", 30);
    await page.getByRole("button", { name: "Chart", exact: true }).click();
    await expect(page.getByRole("img", { name: "Bar chart of count(*) by k" })).toBeVisible();

    const file = await download(page, "Export PNG");

    expect(file.suggestedFilename()).toMatch(/^blinkql-chart-[\d-]+\.png$/);
    const png = await readFile(await file.path());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
