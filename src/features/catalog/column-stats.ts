// Column statistics for the schema browser, read on demand because they scan the whole file.
import { query } from "@/engine/engine";
import type { ImportedTable } from "./catalog";
import { quoteIdentifier } from "./formats";

export type ColumnStats = {
  nullPercentage: number;
  /** Estimated by DuckDB, so it can be a little off. */
  distinctCount: number;
};

// Keyed by the table itself, so a table imported again (e.g. after a restart) is read again.
const cache = new WeakMap<ImportedTable, Promise<ReadonlyMap<string, ColumnStats>>>();

async function readColumnStats(table: ImportedTable): Promise<ReadonlyMap<string, ColumnStats>> {
  const result = await query(
    "SELECT column_name, null_percentage::DOUBLE AS null_percentage, " +
      "approx_unique::DOUBLE AS distinct_count " +
      `FROM (SUMMARIZE ${quoteIdentifier(table.name)})`,
  );
  return new Map(
    result
      .toArray()
      .map((row) => [
        String(row.column_name),
        { nullPercentage: Number(row.null_percentage), distinctCount: Number(row.distinct_count) },
      ]),
  );
}

/** Each column's statistics by column name, read once per table. A failed read is retried. */
export function loadColumnStats(table: ImportedTable): Promise<ReadonlyMap<string, ColumnStats>> {
  let stats = cache.get(table);
  if (!stats) {
    stats = readColumnStats(table);
    stats.catch(() => cache.delete(table));
    cache.set(table, stats);
  }
  return stats;
}
