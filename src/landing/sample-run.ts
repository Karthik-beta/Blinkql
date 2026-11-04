// Runs the hero's sample on the real engine. The landing page imports this only when a person asks
// for a live run, so the engine never weighs on the page's first load.
import { query } from "@/engine/engine";
import { resultColumns } from "@/features/results/cells";
import type { LiveResult } from "./live-run.ts";
import { renderGrid } from "./render.ts";
import { sampleQuery, sampleRows, sampleTableSql } from "./sample.ts";

/** Starts the engine and creates the sample data. */
export async function prepare(): Promise<void> {
  await query(sampleTableSql);
}

/**
 * Runs the sample query and renders its first rows, as many as the static result shows, in the
 * workbench's own cell formats.
 */
export async function execute(): Promise<LiveResult> {
  const started = performance.now();
  const table = await query(sampleQuery.sql.join("\n"));
  const elapsedMs = Math.round(performance.now() - started);

  const columns = resultColumns(table);
  const rows = Array.from({ length: Math.min(table.numRows, sampleRows.length) }, (_, i) =>
    columns.map((column) => column.cell(i)),
  );
  return { rowCount: table.numRows, elapsedMs, gridHtml: renderGrid(rows, table.numRows) };
}
