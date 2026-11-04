// M1's exit criterion: a 1M-row file imported and queried end to end, in every browser.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { Page } from "@playwright/test";
import {
  type Format,
  fileName,
  openEngine,
  rowsBySize,
  writeDataset,
} from "../bench/datasets/generate.ts";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// Each query scans the whole file: a million rows, read through the browser's File API.
const QUERY_TIMEOUT = 60_000;

// Not the seed `pnpm bench:data` uses, so this file isn't byte for byte the benchmarks' M narrow
// dataset, but it has the same shape and size.
const SEED = 42;
const ROWS = rowsBySize.m;

const COUNT_SQL = "SELECT count(*) AS row_count FROM telemetry_m_narrow";
// One row per machine; sums are cast because DuckDB widens them to HUGEINT.
const AGGREGATE_SQL = `SELECT
  machine_id,
  count(*) AS readings,
  sum(good_count)::BIGINT AS good,
  count(*) FILTER (WHERE temperature_c IS NULL) AS dropouts
FROM telemetry_m_narrow
GROUP BY machine_id
ORDER BY machine_id`;

let dir: string;
let connection: DuckDBConnection;

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "blinkql-e2e-"));
  ({ connection } = await openEngine());
});

test.afterAll(async () => {
  connection?.closeSync();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Writes the 1M-row dataset with native DuckDB, the same way `pnpm bench:data` does. */
async function generate(format: Format): Promise<string> {
  const path = join(dir, fileName({ size: "m", shape: "narrow", format })).replaceAll("\\", "/");
  await writeDataset(connection, { shape: "narrow", rows: ROWS, format, seed: SEED, path });
  return path;
}

/** The rows native DuckDB returns for `sql` over the file at `path`, as the results table shows them. */
async function nativeRows(sql: string, path: string): Promise<string[]> {
  await connection.run(`CREATE OR REPLACE VIEW telemetry_m_narrow AS FROM '${path}'`);
  const reader = await connection.runAndReadAll(sql);
  return reader.getRows().map((row) => row.map(String).join(""));
}

const results = (page: Page) => page.getByRole("grid", { name: "Results" });

/** Replaces the editor's contents with `sql` and runs it. */
async function run(page: Page, sql: string) {
  await page.getByRole("textbox", { name: "SQL editor" }).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

// The grid renders only the rows in view; tall enough to show all 40 of the aggregate's at once.
test.use({ viewport: { width: 1280, height: 1600 } });

for (const format of ["parquet", "csv"] as const) {
  test(`imports and queries a 1M-row ${format === "csv" ? "CSV" : "Parquet"} file`, async ({
    page,
    longWorkDuringQueries,
  }) => {
    test.setTimeout(240_000);
    const path = await generate(format);
    const expectedAggregate = await nativeRows(AGGREGATE_SQL, path);
    expect(expectedAggregate).toHaveLength(40);

    await page.goto("/app/");
    await expect(page.getByRole("status")).toHaveText(/^Engine ready/, {
      timeout: ENGINE_TIMEOUT,
    });

    // Passing a path, not a buffer: Playwright streams large files to the page.
    await page.getByLabel("Import files").setInputFiles(path);
    await expect(page.getByRole("tree", { name: "Tables" }).getByRole("treeitem")).toHaveText(
      [
        new RegExp(
          `^telemetry_m_narrow ${format === "csv" ? "CSV" : "Parquet"} · 8 columns · [\\d.]+ MB · telemetry-m-narrow\\.${format}$`,
        ),
      ],
      { timeout: QUERY_TIMEOUT },
    );
    await expect(page.getByRole("alert")).toHaveCount(0);

    await run(page, COUNT_SQL);
    await expect(results(page).getByRole("row")).toHaveText(["row_count", String(ROWS)], {
      timeout: QUERY_TIMEOUT,
    });

    // The browser's answer matches native DuckDB's, machine by machine.
    await run(page, AGGREGATE_SQL);
    await expect(results(page).getByRole("row")).toHaveText(
      ["machine_idreadingsgooddropouts", ...expectedAggregate],
      { timeout: QUERY_TIMEOUT },
    );
    // The engine scans the file in its worker; the main thread stays free throughout.
    expect(await longWorkDuringQueries()).toEqual([]);
  });
}
