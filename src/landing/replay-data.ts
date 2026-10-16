// What the hero replay shows: one query over synthetic factory data, and the first rows it returns.
// The machines, dates and ratios are made up; they follow the shape of a real MES export.

export const replayQuery = {
  tab: "OEE by machine",
  sql: [
    "SELECT machine_id, shift_date,",
    "  SUM(run_min) / SUM(planned_min) AS availability,",
    "  SUM(ideal_cycle_s * total_count) / 60 / SUM(run_min) AS performance,",
    "  SUM(good_count) / SUM(total_count) AS quality,",
    "  availability * performance * quality AS oee",
    "FROM production_log",
    "WHERE shift_date >= '2026-10-01' -- this week",
    "GROUP BY ALL",
    "ORDER BY availability;",
  ],
  /** The result's size and time, as the results bar reports them. */
  rowCount: 40,
  elapsedMs: 212,
};

export interface ReplayColumn {
  name: string;
  /** The type name exactly as the engine reports it. */
  type: "VARCHAR" | "DATE" | "DOUBLE";
  /** The narrowest screen, in px, that shows this column, so the grid always fits its pane. */
  showFrom?: 480 | 1024;
}

export const replayColumns: readonly ReplayColumn[] = [
  { name: "machine_id", type: "VARCHAR" },
  { name: "shift_date", type: "DATE", showFrom: 1024 },
  { name: "availability", type: "DOUBLE" },
  { name: "performance", type: "DOUBLE", showFrom: 1024 },
  { name: "quality", type: "DOUBLE", showFrom: 480 },
  { name: "oee", type: "DOUBLE" },
];

/**
 * The first rows of the result. `null` is a real NULL, shown the way the grid will show it: a
 * missing quality makes the OEE NULL too, as it would in SQL.
 */
export const replayRows: readonly (readonly [
  machineId: string,
  shiftDate: string,
  availability: number,
  performance: number,
  quality: number | null,
  oee: number | null,
])[] = [
  ["PRS-03", "2026-10-06", 0.612, 0.874, 0.951, 0.509],
  ["CNC-12", "2026-10-05", 0.688, 0.902, 0.968, 0.601],
  ["CNC-07", "2026-10-07", 0.701, 0.913, 0.982, 0.628],
  ["WLD-02", "2026-10-06", 0.734, 0.887, null, null],
  ["LTH-05", "2026-10-05", 0.756, 0.921, 0.973, 0.677],
  ["PRS-01", "2026-10-07", 0.781, 0.896, 0.977, 0.684],
  ["CNC-04", "2026-10-06", 0.802, 0.934, 0.985, 0.738],
  ["WLD-05", "2026-10-07", 0.823, 0.908, 0.989, 0.739],
];
