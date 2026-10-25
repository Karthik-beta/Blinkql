// Column statistics for the schema browser, read on demand because they scan the whole file.
import { query } from "@/engine/engine";
import type { ImportedTable } from "./catalog";
import { quoteIdentifier } from "./formats";

export type ColumnStats = {
  nullPercentage: number;
  /** Exact when `exact`; otherwise estimated by DuckDB, so it can be a little off. */
  distinctCount: number;
  exact: boolean;
};

/**
 * Columns estimated to have at most this many distinct values are counted exactly: an answer like
 * "how many machines" must be right, and a small count needs only a small hash table.
 */
const EXACT_DISTINCT_LIMIT = 1000;

// Keyed by the table itself, so a table imported again (e.g. after a restart) is read again.
const cache = new WeakMap<ImportedTable, Promise<ReadonlyMap<string, ColumnStats>>>();

async function readColumnStats(table: ImportedTable): Promise<ReadonlyMap<string, ColumnStats>> {
  const result = await query(
    "SELECT column_name, null_percentage::DOUBLE AS null_percentage, " +
      "approx_unique::DOUBLE AS distinct_count " +
      `FROM (SUMMARIZE ${quoteIdentifier(table.name)})`,
  );
  const stats = new Map<string, ColumnStats>(
    result.toArray().map((row) => [
      String(row.column_name),
      {
        nullPercentage: Number(row.null_percentage),
        distinctCount: Number(row.distinct_count),
        exact: false,
      },
    ]),
  );
  const small = [...stats].filter(([, { distinctCount }]) => distinctCount <= EXACT_DISTINCT_LIMIT);
  if (small.length === 0) return stats;
  const counts = await query(
    `SELECT ${small
      .map(([name]) => `count(DISTINCT ${quoteIdentifier(name)}) AS ${quoteIdentifier(name)}`)
      .join(", ")} FROM ${quoteIdentifier(table.name)}`,
  );
  const row = counts.toArray()[0];
  for (const [name, column] of small) {
    stats.set(name, { ...column, distinctCount: Number(row?.[name]), exact: true });
  }
  return stats;
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
