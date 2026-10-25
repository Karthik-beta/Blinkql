// How soon a large result's first rows show: whole files, and a filter that keeps rows from all
// over one, with no LIMIT. DuckDB computes a LIMIT or ORDER BY in full before handing over any
// rows, so the dataset and scroll scenarios, which use LIMIT, can't show first rows early; these
// can (P-05). Generate the files first with `pnpm bench:data`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Dataset, fileName } from "../datasets/generate.ts";
import { importFile, measureMemory, openWorkbench, runQuery } from "../harness/page.ts";
import type { Scenario } from "../harness/types.ts";
import { DATA_DIR, tableName } from "./datasets.ts";

function firstRowsScenario(
  name: string,
  dataset: Dataset,
  description: string,
  sql: (t: string) => string,
): Scenario {
  const file = fileName(dataset);
  const t = tableName(dataset);
  return {
    name: `first-rows-${name}`,
    description: `${file}: ${description}, shown through the UI.`,
    modes: ["warm"],
    metrics: {
      firstRowsMs: "ms",
      firstRowsRenderMs: "ms",
      queryMs: "ms",
      renderMs: "ms",
      longestFrameMs: "ms",
      memoryBytes: "bytes",
    },
    async run(page, baseURL) {
      const path = join(DATA_DIR, file);
      if (!existsSync(path))
        throw new Error(`${path} is missing; generate it with pnpm bench:data`);

      await openWorkbench(page, baseURL);
      await importFile(page, path);
      const result = await runQuery(page, sql(t));
      return {
        firstRowsMs: result.firstRows,
        firstRowsRenderMs: result.firstRowsRender,
        queryMs: result.query,
        renderMs: result.render,
        longestFrameMs: result.longestFrame,
        memoryBytes: (await measureMemory(page))?.total,
      };
    },
  };
}

const mNarrow: Dataset = { size: "m", shape: "narrow", format: "parquet" };

export const firstRowsScenarios: readonly Scenario[] = [
  firstRowsScenario(
    "m-narrow-parquet",
    mNarrow,
    "every row (1,000,000)",
    (t) => `SELECT * FROM ${t}`,
  ),
  firstRowsScenario(
    "m-narrow-csv",
    { ...mNarrow, format: "csv" },
    "every row (1,000,000)",
    (t) => `SELECT * FROM ${t}`,
  ),
  firstRowsScenario(
    "s-wide-parquet",
    { size: "s", shape: "wide", format: "parquet" },
    "every row (100,000 × 50 columns)",
    (t) => `SELECT * FROM ${t}`,
  ),
  firstRowsScenario(
    "m-narrow-parquet-filter",
    mNarrow,
    "the rows of machines that were down (about 5%)",
    (t) => `SELECT * FROM ${t} WHERE status = 'DOWN'`,
  ),
];
