// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { samples } from "./samples";

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  for (const sample of samples) {
    await connection.run(`CREATE TABLE ${sample.name} AS ${sample.sql}`);
  }
});

afterAll(() => {
  connection.closeSync();
});

async function rows(sql: string): Promise<Record<string, unknown>[]> {
  return (await connection.runAndReadAll(sql)).getRowObjectsJS();
}

async function value(sql: string): Promise<unknown> {
  return (await connection.runAndReadAll(sql)).getRowsJS()[0]?.[0];
}

const columns: Record<string, Record<string, string>> = {
  machine_telemetry: {
    machine_id: "VARCHAR",
    minute_at: "TIMESTAMP",
    planned: "BOOLEAN",
    running: "BOOLEAN",
    ideal_cycle_s: "DOUBLE",
    total_count: "INTEGER",
    good_count: "INTEGER",
  },
  breakdowns: {
    breakdown_id: "INTEGER",
    machine_id: "VARCHAR",
    reason: "VARCHAR",
    started_at: "TIMESTAMP",
    ended_at: "TIMESTAMP",
  },
  shift_output: {
    machine_id: "VARCHAR",
    operator_id: "VARCHAR",
    event_at: "TIMESTAMP",
    units: "INTEGER",
  },
  attendance: {
    operator_id: "VARCHAR",
    shift: "VARCHAR",
    clock_in: "TIMESTAMP",
    clock_out: "TIMESTAMP",
  },
  quality_checks: {
    check_id: "INTEGER",
    machine_id: "VARCHAR",
    checked_at: "TIMESTAMP",
    inspected: "INTEGER",
    rejected: "INTEGER",
    defect_type: "VARCHAR",
  },
  erp_orders: {
    order_id: "VARCHAR",
    item_code: "VARCHAR",
    planned_qty: "INTEGER",
    reported_qty: "INTEGER",
  },
  mes_orders: { work_order: "VARCHAR", part_number: "VARCHAR", good_qty: "INTEGER" },
  item_import: {
    item_code: "VARCHAR",
    description: "VARCHAR",
    uom: "VARCHAR",
    plant_code: "VARCHAR",
  },
  plants: { plant_code: "VARCHAR", plant_name: "VARCHAR" },
};

describe("samples", () => {
  it("are the tables templates are written against", () => {
    expect(samples.map((sample) => sample.name)).toEqual(Object.keys(columns));
    for (const sample of samples) {
      expect(sample.title).not.toBe("");
      expect(sample.description).not.toBe("");
    }
  });

  it.each(samples.map((sample) => sample.name))(
    "%s has the agreed columns and types",
    async (name) => {
      const described = await rows(`DESCRIBE ${name}`);
      expect(
        Object.fromEntries(described.map((row) => [row.column_name, row.column_type])),
      ).toEqual(columns[name]);
      expect(Number(await value(`SELECT count(*) FROM ${name}`))).toBeGreaterThan(0);
    },
  );

  it("are the same on every run", async () => {
    // Each table holds the first run; rows are compared in the engine, as there are many.
    for (const { name, sql } of samples) {
      expect(
        await value(
          `SELECT count(*) FROM (SELECT * FROM (${sql}) EXCEPT ALL SELECT * FROM ${name})`,
        ),
      ).toBe(0n);
      expect(await value(`SELECT count(*) FROM (${sql})`)).toBe(
        await value(`SELECT count(*) FROM ${name}`),
      );
    }
  });

  it("give each machine a plausible OEE, ranked differently", async () => {
    const oee = await rows(`SELECT machine_id,
        count(*) FILTER (running) / count(*) FILTER (planned) AS availability,
        sum(ideal_cycle_s * total_count) / 60 / count(*) FILTER (running) AS performance,
        sum(good_count) / sum(total_count) AS quality,
        availability * performance * quality AS oee
      FROM machine_telemetry GROUP BY ALL ORDER BY oee`);
    expect(oee).toHaveLength(8);
    for (const machine of oee) {
      expect(Number(machine.oee)).toBeGreaterThan(0.5);
      expect(Number(machine.oee)).toBeLessThan(0.9);
    }
    expect(Number(oee.at(-1)?.oee) - Number(oee[0]?.oee)).toBeGreaterThan(0.15);
  });

  it("count parts only while running, and never more good parts than parts", async () => {
    expect(
      await value(`SELECT count(*) FROM machine_telemetry
        WHERE good_count > total_count OR good_count < 0 OR (NOT running AND total_count > 0)
          OR (running AND NOT planned)`),
    ).toBe(0n);
    expect(await value("SELECT count(*) FILTER (NOT planned) > 0 FROM machine_telemetry")).toBe(
      true,
    );
  });

  it("log breakdowns that end after they start, where the machine stops running", async () => {
    expect(await value("SELECT count(*) FROM breakdowns WHERE ended_at <= started_at")).toBe(0n);
    expect(Number(await value("SELECT count(*) FROM breakdowns"))).toBeGreaterThan(150);
    expect(Number(await value("SELECT count(DISTINCT reason) FROM breakdowns"))).toBe(8);
    expect(
      await value(`SELECT count(*) FROM breakdowns b JOIN machine_telemetry t
        ON t.machine_id = b.machine_id AND t.minute_at >= b.started_at AND t.minute_at < b.ended_at
        WHERE t.running`),
    ).toBe(0n);
  });

  it("include night shifts that end the next day, and output either side of midnight", async () => {
    const nights = await rows(`SELECT clock_out::DATE > clock_in::DATE AS next_day, count(*) AS n
      FROM attendance WHERE shift = 'C' GROUP BY ALL`);
    expect(nights).toEqual([{ next_day: true, n: expect.any(BigInt) }]);
    expect(
      await value(`SELECT count(*) FROM attendance
        WHERE clock_out <= clock_in OR (shift != 'C' AND clock_out::DATE != clock_in::DATE)`),
    ).toBe(0n);
    const late = await rows(`SELECT hour(event_at) >= 22 AS before_midnight, count(*) AS n
      FROM shift_output WHERE hour(event_at) >= 22 OR hour(event_at) < 6 GROUP BY ALL
      ORDER BY before_midnight`);
    expect(late.map((row) => row.before_midnight)).toEqual([false, true]);
  });

  it("never reject more parts than were inspected, and name a defect only when rejecting", async () => {
    expect(
      await value(`SELECT count(*) FROM quality_checks
        WHERE rejected > inspected OR rejected < 0 OR (rejected = 0) != (defect_type IS NULL)`),
    ).toBe(0n);
    expect(
      Number(await value("SELECT count(*) FROM quality_checks WHERE rejected > 0")),
    ).toBeGreaterThan(0);
  });

  it("disagree between ERP and MES in every way a reconciliation looks for", async () => {
    const [mismatch] = await rows(`SELECT
        count(*) FILTER (work_order IS NULL) AS only_erp,
        count(*) FILTER (order_id IS NULL) AS only_mes,
        count(*) FILTER (reported_qty != good_qty) AS different,
        count(DISTINCT reported_qty - good_qty) FILTER (reported_qty != good_qty) AS amounts
      FROM erp_orders FULL JOIN mes_orders ON order_id = work_order`);
    expect(Number(mismatch?.only_erp)).toBeGreaterThan(0);
    expect(Number(mismatch?.only_mes)).toBeGreaterThan(0);
    expect(Number(mismatch?.different)).toBeGreaterThan(5);
    expect(Number(mismatch?.amounts)).toBeGreaterThan(5);
  });

  it("put faults in the item import for data-quality checks to find", async () => {
    const [faults] = await rows(`SELECT
        count(*) - count(DISTINCT item_code) AS duplicates,
        count(*) FILTER (description IS NULL) AS no_description,
        count(*) FILTER (description = '') AS empty_description,
        count(*) FILTER (uom IS NULL) AS no_uom,
        count(*) FILTER (i.plant_code NOT IN (SELECT plant_code FROM plants)) AS unknown_plant
      FROM item_import i`);
    for (const fault of Object.values(faults ?? {})) expect(Number(fault)).toBeGreaterThan(0);
  });
});
