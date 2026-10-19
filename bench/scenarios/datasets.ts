// One scenario per benchmark dataset: import the file, run the query set, show a large result,
// measure memory and run one more query with that result on screen, all through the UI. Generate
// the files first with `pnpm bench:data`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Dataset, datasets, fileName } from "../datasets/generate.ts";
import { importFile, measureMemory, openWorkbench, runQuery } from "../harness/page.ts";
import type { Scenario } from "../harness/types.ts";

const DATA_DIR = resolve("bench", "datasets", "data");

/** Rows in the result that's transferred and rendered, the same for every dataset. */
export const RESULT_ROWS = 10_000;

/**
 * The query set, over table `t`. Each returns at most 40 rows, so its time is the engine's work
 * rather than transferring or rendering the result.
 */
export const querySet = {
  /** Every row of two columns. */
  scan: (t: string) => `SELECT sum(total_count) AS total, avg(temperature_c) AS temp FROM ${t}`,
  filter: (t: string) =>
    `SELECT count(*) AS hot FROM ${t} WHERE status = 'RUN' AND temperature_c > 64`,
  /** OEE-style quality and availability per machine. */
  groupBy: (t: string) =>
    `SELECT machine_id, sum(good_count) / sum(total_count) AS quality, avg(run_seconds) / 60 AS availability
     FROM ${t} GROUP BY machine_id ORDER BY machine_id`,
  /** Against a 40-row machine dimension, as a plant's asset register would be. */
  join: (t: string) =>
    `WITH machines AS (SELECT printf('M%03d', i + 1) AS machine_id, 'Area ' || (i % 4 + 1) AS area FROM range(40) r(i))
     SELECT area, sum(good_count) AS good FROM ${t} JOIN machines USING (machine_id) GROUP BY area ORDER BY area`,
  /** A one-hour rolling average per machine. */
  window: (t: string) =>
    `SELECT machine_id, max(rolling) AS peak FROM (
       SELECT machine_id, avg(temperature_c) OVER (PARTITION BY machine_id ORDER BY ts ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) AS rolling
       FROM ${t}
     ) GROUP BY machine_id ORDER BY machine_id`,
} as const;

/** The view name the workbench gives an imported file (tableNameFor in src/features/catalog). */
const tableName = (dataset: Dataset) =>
  fileName(dataset)
    .replace(/\.\w+$/, "")
    .replaceAll("-", "_");

function datasetScenario(dataset: Dataset): Scenario {
  const file = fileName(dataset);
  const t = tableName(dataset);
  return {
    name: `dataset-${file.replace(/^telemetry-/, "").replace(".", "-")}`,
    description: `${file}: import, the query set, a ${RESULT_ROWS.toLocaleString("en")}-row result, memory and a query after it, through the UI with the engine cached.`,
    // The engine download is measured by time-to-engine-ready; here it would only add noise.
    modes: ["warm"],
    metrics: {
      importMs: "ms",
      firstQueryMs: "ms",
      scanMs: "ms",
      filterMs: "ms",
      groupByMs: "ms",
      joinMs: "ms",
      windowMs: "ms",
      resultQueryMs: "ms",
      resultCountMs: "ms",
      resultConvertMs: "ms",
      resultRenderMs: "ms",
      resultLongestFrameMs: "ms",
      resultCommits: "count",
      resultReactMs: "ms",
      memoryBytes: "bytes",
      workerMemoryBytes: "bytes",
      nextQueryRenderMs: "ms",
      nextQueryLongestFrameMs: "ms",
      nextQueryCommits: "count",
      nextQueryReactMs: "ms",
      nextQueryMemoryBytes: "bytes",
    },
    async run(page, baseURL) {
      const path = join(DATA_DIR, file);
      if (!existsSync(path))
        throw new Error(`${path} is missing; generate it with pnpm bench:data`);

      await openWorkbench(page, baseURL);
      const importMs = await importFile(page, path);
      const firstQuery = await runQuery(page, `SELECT count(*) AS n FROM ${t}`);
      const values: Record<string, number | undefined> = {
        importMs,
        firstQueryMs: firstQuery.query,
      };
      for (const [name, sql] of Object.entries(querySet)) {
        values[`${name}Ms`] = (await runQuery(page, sql(t))).query;
      }

      // The same rows counted in the engine, so the difference is the cost of the transfer.
      const resultSql = `SELECT * FROM ${t} LIMIT ${RESULT_ROWS}`;
      values.resultCountMs = (
        await runQuery(page, `SELECT count(*) AS n FROM (${resultSql})`)
      ).query;
      const result = await runQuery(page, resultSql);
      values.resultQueryMs = result.query;
      values.resultConvertMs = result.convert;
      values.resultRenderMs = result.render;
      values.resultLongestFrameMs = result.longestFrame;
      values.resultCommits = result.resultsCommits;
      values.resultReactMs = result.resultsReactMs;

      // Taken with the large result on screen, which is when the naive table holds the most.
      const memory = await measureMemory(page);
      values.memoryBytes = memory?.total;
      values.workerMemoryBytes = memory?.worker;

      // A one-row query with the large result still on screen: what that result costs the UI
      // while the next query runs and replaces it, and whether its memory is given back.
      const next = await runQuery(page, querySet.scan(t));
      values.nextQueryRenderMs = next.render;
      values.nextQueryLongestFrameMs = next.longestFrame;
      values.nextQueryCommits = next.resultsCommits;
      values.nextQueryReactMs = next.resultsReactMs;
      values.nextQueryMemoryBytes = (await measureMemory(page))?.total;
      return values;
    },
  };
}

export const datasetScenarios: readonly Scenario[] = datasets
  .filter((dataset) => dataset.size !== "l")
  .map(datasetScenario);
