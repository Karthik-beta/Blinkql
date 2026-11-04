// The hero's sample: a synthetic online shop's orders export, one query over it, and the first rows
// a run of that query returned. The orders, regions and amounts are made up. The page ships those
// rows as static HTML, and a live run replaces them (issue #88).

/** How many orders the sample "file" holds. */
export const sampleOrderCount = 250_000;

/**
 * Creates the sample "file": orders from January to October 2026, generated in SQL so nothing
 * is downloaded. `hash()` makes it the same on every run. One order in fifty has no region, as
 * exports often do, so the result has a real NULL to show.
 */
export const sampleTableSql = `CREATE OR REPLACE TABLE orders AS
WITH draws AS (
  SELECT i, hash(i) AS h,
    h % 1000 / 1000 AS u, h // 1000 % 1000 / 1000 AS v, h // 1000000 % 1000 / 1000 AS w
  FROM range(${sampleOrderCount}) t(i)
)
SELECT
  100001 + i AS order_id,
  DATE '2026-01-01' + CAST(i * 304 // ${sampleOrderCount} AS INTEGER) AS ordered_at,
  CASE
    WHEN u < 0.32 THEN 'Europe'
    WHEN u < 0.60 THEN 'North America'
    WHEN u < 0.79 THEN 'Asia Pacific'
    WHEN u < 0.88 THEN 'Latin America'
    WHEN u < 0.94 THEN 'Middle East'
    WHEN u < 0.98 THEN 'Africa'
  END AS region,
  CAST(9.5 + 140 * v * v + 25 * w AS DECIMAL(10, 2)) AS total,
  w < 0.02 + 0.07 * v + 0.04 * u AS returned
FROM draws`;

export const sampleQuery = {
  tab: "Sales by region",
  sql: [
    "SELECT region,",
    "  date_trunc('month', ordered_at)::DATE AS month,",
    "  count(*) AS orders,",
    "  sum(total) AS revenue,",
    "  round(avg(total), 2) AS avg_order,",
    "  round(avg(returned::INT), 3) AS return_rate",
    "FROM orders",
    "GROUP BY ALL",
    "ORDER BY month DESC, revenue DESC;",
  ],
  /** The static result's size and time, as the results bar reports them. */
  rowCount: 70,
  elapsedMs: 506,
};

export interface SampleColumn {
  name: string;
  /** The type name exactly as the engine reports it. */
  type: "VARCHAR" | "DATE" | "BIGINT" | "DECIMAL(38,2)" | "DOUBLE";
  /** The narrowest screen, in px, that shows this column, so the grid always fits its pane. */
  showFrom?: 480 | 1024;
}

export const sampleColumns: readonly SampleColumn[] = [
  { name: "region", type: "VARCHAR" },
  { name: "month", type: "DATE", showFrom: 1024 },
  { name: "orders", type: "BIGINT", showFrom: 480 },
  { name: "revenue", type: "DECIMAL(38,2)" },
  { name: "avg_order", type: "DOUBLE", showFrom: 1024 },
  { name: "return_rate", type: "DOUBLE", showFrom: 480 },
];

/** One row's cells as the workbench's grid writes them, `null` for SQL NULL. */
export type SampleRow = readonly (string | null)[];

/**
 * The first rows of the static result, exactly as a run returns them (see sample.test.ts): the
 * latest month's, so no region repeats where the month column is hidden.
 */
export const sampleRows: readonly SampleRow[] = [
  ["Europe", "2026-10-01", "8172", "564053.39", "69.02", "0.061"],
  ["North America", "2026-10-01", "7075", "486544.68", "68.77", "0.071"],
  ["Asia Pacific", "2026-10-01", "4925", "338432.06", "68.72", "0.081"],
  ["Latin America", "2026-10-01", "2288", "154561.79", "67.55", "0.078"],
  ["Middle East", "2026-10-01", "1564", "104912.66", "67.08", "0.082"],
  ["Africa", "2026-10-01", "966", "64345.68", "66.61", "0.086"],
  [null, "2026-10-01", "503", "33545.40", "66.69", "0.101"],
];
