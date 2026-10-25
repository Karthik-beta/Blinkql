// The hero's sample: a synthetic factory log, one query over it, and the first rows a run of that
// query returned. The machines, dates and ratios are made up; they follow the shape of a real MES
// export. The page ships those rows as static HTML, and a live run replaces them (issue #88).

/**
 * Creates the sample "file": an hour-by-hour production log of 8 machines over 17 days, generated
 * in SQL so nothing is downloaded. `hash()` makes it the same on every run.
 */
export const sampleTableSql = `CREATE OR REPLACE TABLE production_log AS
WITH hours AS (
  SELECT i, hash(i) % 1000 / 1000 AS u, hash(-1 - i) % 1000 / 1000 AS v
  FROM range(3264) t(i)
),
logged AS (
  SELECT i, u, v, CAST(56 - 2 * (i % 8) - 16 * u AS INTEGER) AS run_min FROM hours
)
SELECT
  ['PRS-01', 'PRS-03', 'CNC-04', 'CNC-07', 'CNC-12', 'WLD-02', 'WLD-05', 'LTH-05'][i % 8 + 1]
    AS machine_id,
  DATE '2026-09-21' + CAST(i // 192 AS INTEGER) AS shift_date,
  60 AS planned_min,
  run_min,
  30 AS ideal_cycle_s,
  CAST(2 * run_min * (0.84 + 0.14 * v) AS INTEGER) AS total_count,
  total_count - CAST(total_count * 0.05 * u AS INTEGER) AS good_count
FROM logged`;

export const sampleQuery = {
  tab: "OEE by machine",
  sql: [
    "SELECT machine_id, shift_date,",
    "  SUM(run_min) / SUM(planned_min) AS availability,",
    "  SUM(ideal_cycle_s * total_count) / 60 / SUM(run_min) AS performance,",
    "  SUM(good_count) / SUM(total_count) AS quality,",
    "  availability * performance * quality AS oee",
    "FROM production_log",
    "WHERE shift_date >= '2026-10-01' -- this month",
    "GROUP BY ALL",
    "ORDER BY availability;",
  ],
  /** The static result's size and time, as the results bar reports them. */
  rowCount: 56,
  elapsedMs: 212,
};

export interface SampleColumn {
  name: string;
  /** The type name exactly as the engine reports it. */
  type: "VARCHAR" | "DATE" | "DOUBLE";
  /** The narrowest screen, in px, that shows this column, so the grid always fits its pane. */
  showFrom?: 480 | 1024;
}

export const sampleColumns: readonly SampleColumn[] = [
  { name: "machine_id", type: "VARCHAR" },
  { name: "shift_date", type: "DATE", showFrom: 1024 },
  { name: "availability", type: "DOUBLE" },
  { name: "performance", type: "DOUBLE", showFrom: 1024 },
  { name: "quality", type: "DOUBLE", showFrom: 480 },
  { name: "oee", type: "DOUBLE" },
];

export type SampleRow = readonly [
  machineId: string,
  shiftDate: string,
  availability: number,
  performance: number,
  quality: number | null,
  oee: number | null,
];

/**
 * The first rows of the static result. `null` is a real NULL, shown the way the grid will show
 * it: a missing quality makes the OEE NULL too, as it would in SQL.
 */
export const sampleRows: readonly SampleRow[] = [
  ["PRS-03", "2026-10-06", 0.612, 0.874, 0.951, 0.509],
  ["CNC-12", "2026-10-05", 0.688, 0.902, 0.968, 0.601],
  ["CNC-07", "2026-10-07", 0.701, 0.913, 0.982, 0.628],
  ["WLD-02", "2026-10-06", 0.734, 0.887, null, null],
  ["LTH-05", "2026-10-05", 0.756, 0.921, 0.973, 0.677],
  ["PRS-01", "2026-10-07", 0.781, 0.896, 0.977, 0.684],
  ["CNC-04", "2026-10-06", 0.802, 0.934, 0.985, 0.738],
  ["WLD-05", "2026-10-07", 0.823, 0.908, 0.989, 0.739],
];
