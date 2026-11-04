// Synthetic manufacturing telemetry, defined as DuckDB SQL over `range(rows)`.
//
// One row per machine per minute: 40 machines, starting 2026-01-01 00:00. Every random value is
// a pure function of (seed, row, column), computed with integer arithmetic and IEEE division
// only (no random(), no sin/exp), so the output doesn't depend on thread scheduling, platform
// maths libraries or DuckDB's internal hash function.

export type Shape = "narrow" | "wide";

/** Bump when a change alters generated values, so old result files aren't compared with new data. */
export const GENERATOR_VERSION = 1;

export const MACHINES = 40;

/** Keys are `row * 64 + column`, so this keeps every (row, column) key distinct in 32 bits. */
export const MAX_ROWS = 2 ** 26;

/**
 * Macros the dataset query relies on. lowbias32 is Chris Wellons' 32-bit integer hash
 * (https://nullprogram.com/blog/2018/07/31/); its products stay below 2^64, so UBIGINT never
 * overflows. `u(row, column, seed)` is a uniform double in [0, 1).
 */
export const macros = [
  "CREATE OR REPLACE MACRO bq_m32(x) AS (x & 4294967295)",
  "CREATE OR REPLACE MACRO bq_lb1(x) AS bq_m32(xor(x, x >> 16) * 2146121005)",
  "CREATE OR REPLACE MACRO bq_lb2(x) AS bq_m32(xor(x, x >> 15) * 2221713035)",
  "CREATE OR REPLACE MACRO bq_lowbias32(x) AS xor(bq_lb2(bq_lb1(x)), bq_lb2(bq_lb1(x)) >> 16)",
  `CREATE OR REPLACE MACRO u(i, c, seed) AS
     bq_lowbias32(bq_m32(i::UBIGINT * 64 + c + bq_m32(seed::UBIGINT * 2654435769))) / 4294967296.0`,
];

type Column = { name: string; sql: string };

/** The 8 narrow columns: what an OEE or condition-monitoring export typically holds. */
const narrowColumns: Column[] = [
  { name: "ts", sql: "TIMESTAMP '2026-01-01 00:00:00' + to_minutes(t)" },
  { name: "machine_id", sql: "printf('M%03d', m + 1)" },
  { name: "status", sql: "status" },
  { name: "run_seconds", sql: "run_seconds" },
  { name: "total_count", sql: "total_count" },
  {
    name: "good_count",
    sql: "total_count - round(total_count * 0.08 * u(i, 3, $seed))::INTEGER",
  },
  {
    // ~0.5% sensor dropouts, so null handling is part of every benchmark.
    name: "temperature_c",
    sql: `CASE WHEN u(i, 4, $seed) < 0.005 THEN NULL
          ELSE round(48 + (m % 7) * 2.5 + (status = 'RUN')::INTEGER * 12 + u(i, 5, $seed) * 4, 2) END`,
  },
  {
    name: "vibration_mm_s",
    sql: `CASE WHEN u(i, 6, $seed) < 0.005 THEN NULL
          WHEN status = 'RUN' THEN round(2 + u(i, 7, $seed) * 2.5, 2)
          ELSE round(0.2 + u(i, 7, $seed) * 0.6, 2) END`,
  },
];

/** 42 more columns: production context, process readings and 30 generic sensor channels. */
const wideColumns: Column[] = [
  { name: "line", sql: "'L' || (m // 5 + 1)" },
  {
    name: "shift",
    sql: "CASE WHEN hour_of_day < 6 OR hour_of_day >= 22 THEN 'C' WHEN hour_of_day < 14 THEN 'A' ELSE 'B' END",
  },
  { name: "part_number", sql: "printf('P-%04d', 1000 + (m * 7 + t // 480) % 25)" },
  { name: "operator_id", sql: "printf('OP%03d', 1 + (m * 3 + t // 480) % 120)" },
  {
    name: "spindle_rpm",
    sql: "CASE WHEN status = 'RUN' THEN 1200 + floor(u(i, 8, $seed) * 2400)::INTEGER ELSE 0 END",
  },
  {
    name: "power_kw",
    sql: `CASE WHEN status = 'RUN' THEN round(7 + u(i, 9, $seed) * 8, 2)
          ELSE round(0.5 + u(i, 9, $seed) * 0.5, 2) END`,
  },
  { name: "pressure_bar", sql: "round(5.5 + u(i, 10, $seed) * 1.5, 2)" },
  { name: "coolant_temp_c", sql: "round(18 + u(i, 11, $seed) * 6, 2)" },
  { name: "humidity_pct", sql: "round(35 + u(i, 12, $seed) * 25, 1)" },
  {
    // A daily triangle wave (warmest at 14:00) plus noise.
    name: "ambient_temp_c",
    sql: "round(28 - abs(t % 1440 - 840) / 120.0 + u(i, 13, $seed), 2)",
  },
  {
    name: "cycle_time_s",
    sql: "CASE WHEN total_count > 0 THEN round(run_seconds / total_count, 3) END",
  },
  {
    name: "alarm_code",
    sql: "CASE WHEN status = 'DOWN' THEN printf('E%03d', 100 + floor(u(i, 14, $seed) * 12)::INTEGER) END",
  },
  ...Array.from({ length: 30 }, (_, k) => ({
    name: `sensor_${String(k + 1).padStart(2, "0")}`,
    // Three magnitudes (0–10, 0–100, 0–1000) so columns don't all compress alike.
    sql: `round(u(i, ${20 + k}, $seed) * ${10 ** ((k % 3) + 1)}, 3)`,
  })),
];

export function columns(shape: Shape): readonly Column[] {
  return shape === "narrow" ? narrowColumns : [...narrowColumns, ...wideColumns];
}

/** A SELECT producing `rows` rows of the given shape, in a fixed order. */
export function datasetQuery(shape: Shape, rows: number, seed: number): string {
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new RangeError(`rows must be a whole number from 1 to ${MAX_ROWS}`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) {
    throw new RangeError("seed must be a whole number from 0 to 2^32 - 1");
  }
  const select = columns(shape)
    .map(({ name, sql }) => `  ${sql.replaceAll("$seed", String(seed))} AS ${name}`)
    .join(",\n");
  return `
WITH base AS (
  SELECT
    i,
    i % ${MACHINES} AS m,
    i // ${MACHINES} AS t,
    (i // ${MACHINES} // 60) % 24 AS hour_of_day,
    CASE WHEN u(i, 0, ${seed}) < 0.85 THEN 'RUN' WHEN u(i, 0, ${seed}) < 0.95 THEN 'IDLE' ELSE 'DOWN' END AS status
  FROM range(${rows}) AS r(i)
), running AS (
  SELECT *, CASE WHEN status = 'RUN' THEN 40 + floor(u(i, 1, ${seed}) * 21)::INTEGER ELSE 0 END AS run_seconds
  FROM base
), counted AS (
  -- Ideal cycle time is 2–6 s depending on the machine, slowed by up to 25%.
  SELECT *, floor(run_seconds / ((2 + m % 5) * (1 + 0.25 * u(i, 2, ${seed}))))::INTEGER AS total_count
  FROM running
)
SELECT
${select}
FROM counted
ORDER BY i`;
}
