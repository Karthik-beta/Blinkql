// Sample datasets for templates, onboarding and teaching: a week in a made-up factory and a quarter
// of its shipments. Every table is generated in SQL with `range()`, and `hash()` stands in for
// randomness, so the data is the same on every run and nothing is downloaded. The machines,
// operators, orders, plants, carriers and lanes are synthetic; they follow the shape of real MES,
// ERP and transport management exports (issues #42 and #169).
import { exportQuery } from "@/engine/engine";
import { getCatalog, importFiles } from "@/features/catalog/catalog";

export type Sample = {
  /** The table's name in the catalog. */
  name: string;
  title: string;
  description: string;
  /** A SELECT that produces the table, generated in SQL so nothing is downloaded. */
  sql: string;
};

/**
 * The 8 machines and what sets them apart: how fast they run against their ideal cycle, how often
 * they break down, how long repairs take and how much they scrap, so their OEE ranks differently.
 */
const machines = `machines(m, machine_id, ideal_cycle_s, speed, breakdown_rate, repair_factor, scrap_rate) AS (
  SELECT m, machine_id, CAST(ideal_cycle_s AS DOUBLE), speed, breakdown_rate, repair_factor, scrap_rate
  FROM (VALUES
    (0, 'PRS-01', 4, 0.93, 0.14, 0.7, 0.010),
    (1, 'PRS-03', 5, 0.85, 0.38, 1.1, 0.030),
    (2, 'CNC-04', 12, 0.90, 0.12, 0.6, 0.008),
    (3, 'CNC-07', 15, 0.86, 0.28, 0.9, 0.020),
    (4, 'CNC-12', 10, 0.90, 0.32, 1.0, 0.025),
    (5, 'WLD-02', 8, 0.83, 0.22, 0.8, 0.045),
    (6, 'WLD-05', 9, 0.92, 0.16, 0.7, 0.015),
    (7, 'LTH-05', 10, 0.89, 0.20, 1.0, 0.020)
  ) t(m, machine_id, ideal_cycle_s, speed, breakdown_rate, repair_factor, scrap_rate)
)`;

/** A pseudo-random number in [0, 1) for the given arguments. */
const unit = (...args: string[]) => `(hash(${args.join(", ")}) % 10000 / 10000)`;

/**
 * Production runs from Monday 06:00 to Saturday 14:00, three shifts a day, with a 30-minute break
 * in each. Hours are counted from Monday 00:00.
 */
const firstHour = 6;
const lastHour = 5 * 24 + 14;

// Breakdowns can start in any production hour, more often on some machines. Each reason has a
// share of breakdowns (cumulative, so the first ones dominate, as on a Pareto chart) and a typical
// repair time. A breakdown ends 5 minutes before the machine's next one at the latest.
const breakdownsSql = `WITH ${machines},
reasons(reason, share_from, share_to, repair_min) AS (VALUES
  ('Tool wear', 0.00, 0.30, 25),
  ('Jam', 0.30, 0.52, 12),
  ('Hydraulic leak', 0.52, 0.66, 120),
  ('Electrical fault', 0.66, 0.76, 90),
  ('Material shortage', 0.76, 0.85, 60),
  ('Changeover overrun', 0.85, 0.92, 40),
  ('Sensor fault', 0.92, 0.97, 30),
  ('Operator unavailable', 0.97, 1.00, 45)
),
slots AS (
  SELECT machines.*, h,
    ${unit("h", "m")} AS u, ${unit("h", "m", "1")} AS v, ${unit("h", "m", "2")} AS w
  FROM machines, range(${firstHour}, ${lastHour}) t(h)
),
started AS (
  SELECT machine_id, reason,
    TIMESTAMP '2026-09-21' + to_minutes(h * 60 + CAST(floor(w * 40) AS INTEGER)) AS started_at,
    started_at + to_minutes(CAST(greatest(3, repair_min * repair_factor * (0.4 + 1.2 * w)) AS INTEGER))
      AS repaired_at
  FROM slots JOIN reasons ON v >= share_from AND v < share_to
  WHERE u < breakdown_rate
)
SELECT
  CAST(row_number() OVER (ORDER BY started_at, machine_id) AS INTEGER) AS breakdown_id,
  machine_id,
  reason,
  started_at,
  coalesce(
    least(
      repaired_at,
      lead(started_at) OVER (PARTITION BY machine_id ORDER BY started_at) - INTERVAL 5 MINUTE
    ),
    repaired_at
  ) AS ended_at
FROM started
ORDER BY breakdown_id`;

// Machines run whenever production is planned and they aren't broken down, at a speed that varies
// a little minute to minute, and now and then scrap a part.
const telemetrySql = `WITH ${machines},
breakdowns AS (${breakdownsSql}),
down AS (
  SELECT DISTINCT machine_id, down_at FROM (
    SELECT machine_id,
      unnest(generate_series(started_at, ended_at - INTERVAL 1 MINUTE, INTERVAL 1 MINUTE)) AS down_at
    FROM breakdowns
  )
),
minutes AS (
  SELECT machines.*, TIMESTAMP '2026-09-21' + to_minutes(i) AS minute_at,
    i >= ${firstHour * 60} AND i < ${lastHour * 60}
      AND (i % 1440) // 30 NOT IN (4, 20, 36) AS planned,
    ${unit("i", "m")} AS u, ${unit("i", "m", "1")} AS v
  FROM machines, range(7 * 1440) t(i)
)
SELECT
  minutes.machine_id,
  minute_at,
  planned,
  planned AND down_at IS NULL AS running,
  ideal_cycle_s,
  CASE WHEN running THEN CAST(round(60 / ideal_cycle_s * speed * (0.85 + 0.3 * u)) AS INTEGER)
    ELSE 0 END AS total_count,
  total_count - CASE WHEN v < scrap_rate * total_count THEN 1 ELSE 0 END AS good_count
FROM minutes LEFT JOIN down ON down.machine_id = minutes.machine_id AND down_at = minute_at
ORDER BY minutes.machine_id, minute_at`;

// Each machine has one operator per shift. The day a shift belongs to starts at 06:00, so the
// hours after midnight count towards the night shift that started the evening before. An operator
// absent from attendance logs no output that shift.
const operator = (shift: string) => `101 + ${shift} * 8 + m`;
const absent = (op: string, day: string) => `hash(${op}, ${day}, 9) % 100 < 6`;

const shiftOutputSql = `WITH ${machines},
reports AS (
  SELECT machines.*, ${unit("s", "m", "3")} AS u, ${unit("s", "m", "4")} AS v,
    s * 15 + CAST(floor(u * 15) AS INTEGER) AS minute,
    (minute - 360) // 1440 AS shift_day,
    CASE WHEN minute % 1440 >= 360 AND minute % 1440 < 840 THEN 0
      WHEN minute % 1440 >= 840 AND minute % 1440 < 1320 THEN 1 ELSE 2 END AS shift_no,
    ${operator("shift_no")} AS op
  FROM machines, range(${(firstHour * 60) / 15}, ${(lastHour * 60) / 15}) t(s)
)
SELECT
  machine_id,
  'OP-' || op AS operator_id,
  TIMESTAMP '2026-09-21' + to_minutes(minute) AS event_at,
  CAST(round(15 * 60 / ideal_cycle_s * speed * (0.5 + 0.4 * v)) AS INTEGER) AS units
FROM reports
WHERE v >= 0.1 AND NOT (${absent("op", "shift_day")})
ORDER BY event_at, machine_id`;

const attendanceSql = `WITH ${machines},
rosters AS (
  SELECT m, shift_no, d, ${operator("shift_no")} AS op, d * 1440 + 360 + shift_no * 480 AS starts
  FROM machines, range(3) s(shift_no), range(6) t(d)
  WHERE d < 5 OR shift_no = 0
)
SELECT
  'OP-' || op AS operator_id,
  ['A', 'B', 'C'][shift_no + 1] AS shift,
  TIMESTAMP '2026-09-21' + to_minutes(starts - 12 + CAST(hash(op, d, 5) % 20 AS INTEGER)) AS clock_in,
  TIMESTAMP '2026-09-21' + to_minutes(starts + 475 + CAST(hash(op, d, 6) % 30 AS INTEGER))
    AS clock_out
FROM rosters
WHERE NOT (${absent("op", "d")})
ORDER BY clock_in, operator_id`;

// An hourly sample of each machine's parts. Most pass; rejects follow the machine's scrap rate
// and the commonest defects come first.
const qualitySql = `WITH ${machines},
checks AS (
  SELECT machines.*, h, ${unit("h", "m", "7")} AS u, ${unit("h", "m", "8")} AS v,
    ${unit("h", "m", "10")} AS w, 20 +CAST(hash(h, m, 9) % 41 AS INTEGER) AS inspected
  FROM machines, range(${firstHour}, ${lastHour}) t(h)
)
SELECT
  CAST(row_number() OVER (ORDER BY h, machine_id) AS INTEGER) AS check_id,
  machine_id,
  TIMESTAMP '2026-09-21' + to_minutes(h * 60 + 20 + CAST(floor(v * 30) AS INTEGER)) AS checked_at,
  inspected,
  CASE WHEN u < 0.55 THEN 0
    ELSE CAST(floor(inspected * scrap_rate * 6 * v) AS INTEGER) END AS rejected,
  CASE WHEN rejected = 0 THEN NULL
    ELSE ['Dimension out of tolerance', 'Burr', 'Surface scratch', 'Porosity', 'Crack']
      [1 + CAST(floor(w * w * 5) AS INTEGER)] END AS defect_type
FROM checks
ORDER BY check_id`;

// One set of work orders, as the ERP plans them and the MES reports them. Some orders are missing
// from one side or the other, and some report a different quantity.
const orders = `orders AS (
  SELECT i, 'WO-' || (10001 + i) AS order_id, 'ITM-' || (1001 + hash(i, 6) % 40) AS item_code,
    CAST(100 + 10 * (hash(i, 7) % 91) AS INTEGER) AS planned_qty,
    CAST(round(planned_qty * (0.85 + ${unit("i", "8")} * 0.2)) AS INTEGER) AS reported_qty
  FROM range(120) t(i)
)`;
const onlyInMes = "i % 31 = 17";
const onlyInErp = "i % 23 = 5";

const erpOrdersSql = `WITH ${orders}
SELECT order_id, item_code, planned_qty, reported_qty
FROM orders
WHERE NOT (${onlyInMes})
ORDER BY order_id`;

const mesOrdersSql = `WITH ${orders}
SELECT
  order_id AS work_order,
  item_code AS part_number,
  CAST(greatest(0, reported_qty + CASE WHEN i % 9 != 4 THEN 0
    WHEN hash(i, 10) % 2 = 0 THEN -1 - hash(i, 11) % 40
    ELSE 1 + hash(i, 11) % 25 END) AS INTEGER) AS good_qty
FROM orders
WHERE NOT (${onlyInErp})
ORDER BY work_order`;

const plantsSql = `SELECT * FROM (VALUES
  ('P100', 'Pune Press Shop'),
  ('P200', 'Chennai Machining'),
  ('P300', 'Coimbatore Fabrication'),
  ('P400', 'Hosur Assembly')
) t(plant_code, plant_name)
ORDER BY plant_code`;

// An item master import with the faults a data-quality check should catch: repeated codes, missing
// descriptions and units, and plant codes that aren't in \`plants\`.
const itemImportSql = `SELECT
  'ITM-' || (1001 + CASE WHEN i % 17 = 5 THEN i - 1 ELSE i END) AS item_code,
  CASE WHEN i % 19 = 4 THEN NULL WHEN i % 23 = 11 THEN ''
    ELSE ['Bracket', 'Shaft', 'Flange', 'Housing', 'Bush', 'Gear', 'Plate', 'Bolt'][i % 8 + 1]
      || ' ' || (10 + i * 5) || ' mm' END AS description,
  CASE WHEN i % 13 = 6 THEN NULL ELSE ['EA', 'EA', 'KG', 'M', 'SET'][i % 5 + 1] END AS uom,
  CASE WHEN i % 11 = 9 THEN ['P900', 'P250', 'p200'][i // 11 % 3 + 1]
    ELSE ['P100', 'P200', 'P300', 'P400'][i % 4 + 1] END AS plant_code
FROM range(60) t(i)
ORDER BY i`;

// A quarter of road freight out of the plants, as a transport management system exports it. Each
// lane has a promised transit time and a rate per kg; each carrier is late more or less often and
// charges more or less, and longer lanes run late more often. Some long-haul loads arrive a day
// early, small loads pay a minimum charge, and shipments still on the road at the end of September
// have no delivery date yet.
const shipmentsSql = `WITH carriers(c, carrier, late_rate, price) AS (VALUES
  (0, 'Arrow Roadways', 0.04, 1.30),
  (1, 'Coastline Cargo', 0.14, 1.00),
  (2, 'Deccan Haulage', 0.36, 0.80),
  (3, 'Kaveri Transport', 0.09, 0.95),
  (4, 'Summit Freight', 0.24, 1.15)
),
lanes(l, origin, destination, transit_days, rate_per_kg, lane_risk) AS (VALUES
  (0, 'Pune', 'Mumbai', 1, 4.0, 0.00),
  (1, 'Pune', 'Delhi', 4, 9.0, 0.05),
  (2, 'Chennai', 'Bengaluru', 1, 4.5, 0.00),
  (3, 'Chennai', 'Kolkata', 4, 10.0, 0.06),
  (4, 'Coimbatore', 'Kochi', 1, 3.5, 0.02),
  (5, 'Coimbatore', 'Hyderabad', 2, 6.0, 0.03),
  (6, 'Hosur', 'Ahmedabad', 4, 9.5, 0.08),
  (7, 'Hosur', 'Guwahati', 7, 14.0, 0.15)
),
booked AS (
  SELECT carriers.*, lanes.*, i, ${unit("i", "3")} AS u, ${unit("i", "4")} AS v,
    ${unit("i", "5")} AS w, ${unit("i", "7")} AS x,
    DATE '2026-07-01' + CAST(hash(i, 6) % 92 AS INTEGER) AS ship_date,
    CASE WHEN u < late_rate + lane_risk THEN 1 + CAST(floor(v * (1 + transit_days)) AS INTEGER)
      WHEN u > 0.8 AND transit_days > 1 THEN -1 ELSE 0 END AS delay_days,
    round(50 + 2450 * w * w, 1) AS weight_kg
  FROM range(1000) t(i)
  JOIN carriers ON c = hash(i, 1) % 5
  JOIN lanes ON l = hash(i, 2) % 8
)
SELECT
  'SHP-' || (100000 + row_number() OVER (ORDER BY ship_date, i)) AS shipment_id,
  carrier,
  origin,
  destination,
  ship_date,
  ship_date + transit_days AS promised_date,
  CASE WHEN ship_date + transit_days + delay_days <= DATE '2026-09-30'
    THEN ship_date + transit_days + delay_days END AS delivered_date,
  weight_kg,
  round(greatest(1500, weight_kg * rate_per_kg * price * (0.9 + 0.2 * x)), 2) AS freight_cost
FROM booked
ORDER BY shipment_id`;

export const samples: readonly Sample[] = [
  {
    name: "machine_telemetry",
    title: "Machine telemetry",
    description:
      "Parts made by 8 machines, minute by minute for a week, with planned and down time.",
    sql: telemetrySql,
  },
  {
    name: "breakdowns",
    title: "Breakdown log",
    description:
      "Each breakdown that week: the machine, the reason, and when it started and ended.",
    sql: breakdownsSql,
  },
  {
    name: "shift_output",
    title: "Shift output",
    description: "Units reported by operators round the clock, night shifts included.",
    sql: shiftOutputSql,
  },
  {
    name: "attendance",
    title: "Attendance",
    description:
      "Operators' clock-ins and clock-outs on three shifts; the night shift ends next day.",
    sql: attendanceSql,
  },
  {
    name: "quality_checks",
    title: "Quality checks",
    description: "Hourly inspections per machine: parts inspected, rejected and the defect found.",
    sql: qualitySql,
  },
  {
    name: "erp_orders",
    title: "ERP work orders",
    description: "Work orders as the ERP plans them, with the quantity reported back.",
    sql: erpOrdersSql,
  },
  {
    name: "mes_orders",
    title: "MES work orders",
    description: "The same orders as the MES counts them, under other column names, with gaps.",
    sql: mesOrdersSql,
  },
  {
    name: "item_import",
    title: "Item import",
    description: "An item master file with duplicates, missing fields and unknown plants.",
    sql: itemImportSql,
  },
  {
    name: "plants",
    title: "Plants",
    description: "The plant codes that items may refer to.",
    sql: plantsSql,
  },
  {
    name: "shipments",
    title: "Shipments",
    description:
      "A quarter's freight from the plants: carrier, lane, promised and delivered dates, weight and cost.",
    sql: shipmentsSql,
  },
];

/** Samples being loaded, so a second click doesn't load one twice. */
const loading = new Set<string>();

/**
 * Builds the sample in the engine, writes it as Parquet and imports it like a dropped file, so it
 * appears in the catalog and survives reloads. Does nothing if a table of that name exists.
 */
export async function loadSample(name: string): Promise<void> {
  const sample = samples.find((other) => other.name === name);
  if (!sample) throw new Error(`No sample called ${name}`);
  if (loading.has(name) || getCatalog().tables.some((table) => table.name === name)) return;
  loading.add(name);
  try {
    const bytes = await exportQuery(sample.sql, "parquet");
    await importFiles([new File([bytes], `${name}.parquet`)]);
  } finally {
    loading.delete(name);
  }
}
