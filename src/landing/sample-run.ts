// Runs the hero's sample on the real engine. The landing page imports this only when a person asks
// for a live run, so the engine never weighs on the page's first load.
import { query } from "@/engine/engine";
import type { LiveResult } from "./live-run.ts";
import { renderGrid } from "./render.ts";
import { type SampleRow, sampleQuery, sampleRows, sampleTableSql } from "./sample.ts";

/** Starts the engine and creates the sample data. */
export async function prepare(): Promise<void> {
  await query(sampleTableSql);
}

/** Runs the sample query and renders its first rows, as many as the static result shows. */
export async function execute(): Promise<LiveResult> {
  const started = performance.now();
  const table = await query(sampleQuery.sql.join("\n"));
  const elapsedMs = Math.round(performance.now() - started);

  const rows: SampleRow[] = [];
  for (let i = 0; i < Math.min(table.numRows, sampleRows.length); i++) {
    const row = table.get(i)?.toJSON() ?? {};
    rows.push([
      String(row.machine_id),
      // Arrow hands DATE values over as milliseconds since the epoch.
      new Date(Number(row.shift_date)).toISOString().slice(0, 10),
      Number(row.availability),
      Number(row.performance),
      nullableNumber(row.quality),
      nullableNumber(row.oee),
    ]);
  }
  return { rowCount: table.numRows, elapsedMs, gridHtml: renderGrid(rows, table.numRows) };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
