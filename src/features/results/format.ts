const count = new Intl.NumberFormat();

/** "212 ms" under a second, "3.4 s" from there on. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "1 row", "40 rows", "1,000,000 rows" (in the reader's locale). */
export function formatRows(rows: number): string {
  return `${count.format(rows)} ${rows === 1 ? "row" : "rows"}`;
}
