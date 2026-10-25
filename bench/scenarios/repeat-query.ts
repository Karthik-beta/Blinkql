// Running the same query again and again over a CSV and over Parquet (P-09). A CSV view parses the
// whole file on every query; Parquet is read column by column and only where needed. The CSV
// scenario also converts its table to Parquet through the UI and runs the query on the result.
// Generate the files first with `pnpm bench:data --size m --shape narrow`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { type Dataset, fileName } from "../datasets/generate.ts";
import { importFile, openWorkbench, runQuery } from "../harness/page.ts";
import { quantile } from "../harness/stats.ts";
import type { Scenario } from "../harness/types.ts";
import { DATA_DIR, tableName } from "./datasets.ts";

/** Runs of the query per iteration: the first, then the repeats. */
const RUNS = 5;

/** A filter and a GROUP BY: every row is read, but only 40 come back. */
const SQL = (t: string) =>
  `SELECT machine_id, count(*) AS n, avg(temperature_c) AS temp FROM ${t} WHERE status = 'RUN' GROUP BY machine_id ORDER BY machine_id`;

type StoredDataset = { name: string; format: string; size: number };

/** The datasets the workbench keeps in the browser's Origin Private File System. */
function storedDatasets(page: Page): Promise<StoredDataset[]> {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const datasets = await root.getDirectoryHandle("datasets");
      const manifest = await (await datasets.getFileHandle("manifest.json")).getFile();
      return JSON.parse(await manifest.text());
    } catch {
      return [];
    }
  });
}

/** Waits until the kept datasets are exactly `expected` (table name and format). */
async function waitForStored(page: Page, expected: string[]): Promise<StoredDataset[]> {
  const started = Date.now();
  while (true) {
    const stored = await storedDatasets(page);
    if (stored.map(({ name, format }) => `${name}:${format}`).join() === expected.join()) {
      return stored;
    }
    if (Date.now() - started > 60_000) {
      throw new Error(`Kept datasets didn't become [${expected}]: ${JSON.stringify(stored)}`);
    }
    await page.waitForTimeout(100);
  }
}

/** Runs the query `RUNS` times; the first run's time and the median of the rest. */
async function repeatQuery(page: Page, t: string): Promise<{ first: number; repeat: number }> {
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) times.push((await runQuery(page, SQL(t))).query);
  const [first = Number.NaN, ...rest] = times;
  return {
    first,
    repeat: quantile(
      rest.sort((a, b) => a - b),
      0.5,
    ),
  };
}

function repeatQueryScenario(dataset: Dataset): Scenario {
  const file = fileName(dataset);
  const t = tableName(dataset);
  const converts = dataset.format === "csv";
  return {
    name: `repeat-query-${dataset.format}`,
    description: `${file}: the same filter and GROUP BY run ${RUNS} times${converts ? ", then the table converted to Parquet and the query run again" : ""}, through the UI.`,
    modes: ["warm"],
    metrics: {
      firstQueryMs: "ms",
      repeatQueryMs: "ms",
      ...(converts && {
        convertMs: "ms",
        convertedBytes: "bytes",
        convertedFirstQueryMs: "ms",
        convertedRepeatQueryMs: "ms",
      }),
    },
    async run(page, baseURL) {
      const path = join(DATA_DIR, file);
      if (!existsSync(path))
        throw new Error(`${path} is missing; generate it with pnpm bench:data`);

      await openWorkbench(page, baseURL);
      await importFile(page, path);
      // The copy kept in the browser is written in the background; wait, so it can't slow the
      // queries down.
      await waitForStored(page, [`${t}:${dataset.format}`]);
      const { first, repeat } = await repeatQuery(page, t);
      const values: Record<string, number | undefined> = {
        firstQueryMs: first,
        repeatQueryMs: repeat,
      };

      if (converts) {
        // From the click until the row says Parquet; DuckDB-wasm reports no progress in between.
        const clickedAt = await page.evaluate(() => performance.now());
        await page.getByRole("button", { name: `Convert ${t} to Parquet` }).click();
        const convertedAt = await page.waitForFunction(
          (t) => {
            const row = [...document.querySelectorAll('[role="treeitem"]')].find((item) =>
              item.textContent?.startsWith(`${t}Parquet`),
            );
            if (row) return performance.now();
            const alert = document.querySelector('[role="alert"]');
            if (alert?.textContent) throw new Error(alert.textContent);
            return null;
          },
          t,
          { timeout: 10 * 60_000, polling: "raf" },
        );
        values.convertMs = ((await convertedAt.jsonValue()) as number) - clickedAt;
        const [stored] = await waitForStored(page, [`${t}:parquet`]);
        values.convertedBytes = stored?.size;
        const converted = await repeatQuery(page, t);
        values.convertedFirstQueryMs = converted.first;
        values.convertedRepeatQueryMs = converted.repeat;
      }

      // Forget the table, so the next iteration doesn't start by restoring it.
      await page.getByRole("button", { name: `Forget ${t}` }).click();
      await waitForStored(page, []);
      return values;
    },
  };
}

export const repeatQueryScenarios: readonly Scenario[] = (["csv", "parquet"] as const).map(
  (format) => repeatQueryScenario({ size: "m", shape: "narrow", format }),
);
