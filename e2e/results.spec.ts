import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const results = (page: Page) => page.getByRole("region", { name: "Results" });

async function runSql(page: Page, sql: string) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
  await page.getByRole("textbox", { name: "SQL editor" }).click();
  await page.keyboard.type(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

test.describe("Results table", () => {
  test("shows every row of the result", async ({ page }) => {
    await runSql(page, "SELECT range AS n, range * 2 AS doubled FROM range(500)");

    await expect(results(page).getByRole("columnheader")).toHaveText(["n", "doubled"]);
    // A header row plus all 500 rows: the baseline renders everything.
    await expect(results(page).getByRole("row")).toHaveCount(501);
    await expect(results(page).getByRole("row").last()).toHaveText("499998");
  });

  test("shows DuckDB's types the way DuckDB writes them", async ({ page }) => {
    await runSql(
      page,
      "SELECT 1 AS x, 2 AS x, NULL AS nothing, 123.45::DECIMAL(10, 2) AS price, " +
        "DATE '2026-10-16' AS day, TIMESTAMP '2026-10-16 05:47:17' AS at, " +
        "[1, 2] AS list, {'a': 'b'} AS struct, 9007199254740993::BIGINT AS big",
    );

    const cells = results(page).getByRole("row").nth(1).getByRole("cell");
    await expect(cells).toHaveText([
      "1",
      "2",
      "NULL",
      "123.45",
      "2026-10-16",
      "2026-10-16 05:47:17",
      "[1,2]",
      '{"a":"b"}',
      "9007199254740993",
    ]);
  });

  test("formats values inside lists, structs and maps by their type", async ({ page }) => {
    await runSql(
      page,
      "SELECT [DATE '2026-10-16', NULL] AS days, [1.5::DECIMAL(3, 1)] AS prices, " +
        "{'at': TIMESTAMP '2026-10-16 05:47:17', 'raw': 'A\\x00'::BLOB} AS struct, " +
        "MAP {'k': 2026} AS map",
    );

    const cells = results(page).getByRole("row").nth(1).getByRole("cell");
    await expect(cells).toHaveText([
      '["2026-10-16",null]',
      "[1.5]",
      '{"at":"2026-10-16 05:47:17","raw":"A\\\\x00"}',
      '{"k":2026}',
    ]);
  });

  test("shows arrays, enums and oddly named struct fields", async ({ page }) => {
    // DuckDB sends an ARRAY as a fixed-size list and an ENUM dictionary-encoded.
    await runSql(
      page,
      "SELECT [1, 2]::INTEGER[2] AS pair, 'b'::ENUM('a', 'b') AS letter, " +
        "{'toString': 7, '__proto__': 8} AS struct",
    );

    const cells = results(page).getByRole("row").nth(1).getByRole("cell");
    await expect(cells).toHaveText(["[1,2]", "b", '{"toString":7,"__proto__":8}']);
  });

  test("has no detectable accessibility issues", async ({ page, makeAxeBuilder }) => {
    await runSql(page, "SELECT range AS n, NULL AS nothing FROM range(20)");
    await expect(results(page).getByRole("row")).toHaveCount(21);

    const scan = await makeAxeBuilder().include('[aria-label="Results"]').analyze();
    expect(scan.violations).toEqual([]);
  });
});
