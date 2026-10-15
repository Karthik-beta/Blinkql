// What the hero replay shows: one query over synthetic factory data, and the first rows it returns.
// The machines, dates and ratios are made up; they follow the shape of a real MES export.

export const replayQuery = {
  tab: "OEE by machine",
  sql: [
    "SELECT machine_id, shift_date,",
    "  SUM(run_min) / SUM(planned_min) AS availability,",
    "  SUM(good_count) / SUM(total_count) AS quality",
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
  /** Dropped on narrow screens so the grid still fits a phone. */
  optional?: boolean;
}

export const replayColumns: readonly ReplayColumn[] = [
  { name: "machine_id", type: "VARCHAR" },
  { name: "shift_date", type: "DATE", optional: true },
  { name: "availability", type: "DOUBLE" },
  { name: "quality", type: "DOUBLE" },
];

/** The first rows of the result. `null` is a real NULL, shown the way the grid will show it. */
export const replayRows: readonly (readonly [string, string, number, number | null])[] = [
  ["PRS-03", "2026-10-06", 0.612, 0.951],
  ["CNC-12", "2026-10-05", 0.688, 0.968],
  ["CNC-07", "2026-10-07", 0.701, 0.982],
  ["WLD-02", "2026-10-06", 0.734, null],
  ["LTH-05", "2026-10-05", 0.756, 0.973],
  ["PRS-01", "2026-10-07", 0.781, 0.977],
  ["CNC-04", "2026-10-06", 0.802, 0.985],
  ["WLD-05", "2026-10-07", 0.823, 0.989],
];
