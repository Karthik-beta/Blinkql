// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { oee } from "./oee";

// Two machines over a few minutes. m1: 3 planned minutes, 2 running, ideal 2 s per part, 60 of
// 60 parts made in running minutes, 57 good, so availability 2/3, performance 1 and quality 0.95.
// The unplanned minute is left out. m2: 4 planned minutes, 2 running, ideal 1 s, 60 parts, 56 good,
// so availability 1/2, performance 1/2 and quality 56/60.
const SAMPLE = `CREATE TABLE machine_telemetry AS SELECT * FROM (VALUES
  ('m1', TIMESTAMP '2026-01-01 08:00', true, true, 2.0::DOUBLE, 30, 27),
  ('m1', TIMESTAMP '2026-01-01 08:01', true, true, 2.0::DOUBLE, 30, 30),
  ('m1', TIMESTAMP '2026-01-01 08:02', true, false, 2.0::DOUBLE, 0, 0),
  ('m1', TIMESTAMP '2026-01-01 08:03', false, true, 2.0::DOUBLE, 30, 30),
  ('m2', TIMESTAMP '2026-01-01 08:00', true, true, 1.0::DOUBLE, 40, 36),
  ('m2', TIMESTAMP '2026-01-01 08:01', true, true, 1.0::DOUBLE, 20, 20),
  ('m2', TIMESTAMP '2026-01-01 08:02', true, false, 1.0::DOUBLE, 0, 0),
  ('m2', TIMESTAMP '2026-01-01 08:03', true, false, 1.0::DOUBLE, 0, 0)
) AS t(machine_id, minute_at, planned, running, ideal_cycle_s, total_count, good_count)`;

const expected = [
  {
    machine_id: "m1",
    planned_min: 3n,
    run_min: 2n,
    availability_pct: 66.7,
    performance_pct: 100,
    quality_pct: 95,
    oee_pct: 63.3,
  },
  {
    machine_id: "m2",
    planned_min: 4n,
    run_min: 2n,
    availability_pct: 50,
    performance_pct: 50,
    quality_pct: 93.3,
    oee_pct: 23.3,
  },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("OEE by machine", () => {
  it("computes each machine's availability, performance, quality and OEE", async () => {
    const { rows } = await runTemplate(connection, oee);
    expect(rows).toMatchObject(expected);
    expect(rows[0]).toMatchObject({
      first_minute: expect.any(Date),
      last_minute: expect.any(Date),
    });
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "machine_telemetry", {
      machine_id: "Asset ID",
      minute_at: "timestamp",
      planned: "scheduled",
      running: "is_running",
      ideal_cycle_s: "cycle_time",
      total_count: "total",
      good_count: "good",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(oee, mine);
    expect(mapping).toEqual({
      telemetry: {
        table: name,
        columns: {
          machine_id: "Asset ID",
          minute_at: "timestamp",
          planned: "scheduled",
          running: "is_running",
          ideal_cycle_s: "cycle_time",
          total_count: "total",
          good_count: "good",
        },
      },
    });
    const { rows } = await runTemplate(connection, oee, { mapping });
    expect(rows).toMatchObject(expected);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, oee);
    expect(columns).toContain(oee.chart?.x);
    expect(columns).toContain(oee.chart?.y);
  });
});

describe("OEE by machine on the sample data", () => {
  it("ranks every sample machine by its OEE", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "machine_telemetry");
      const { rows } = await runTemplate(db, oee);
      expect(rows).toHaveLength(8);
      const values = rows.map((row) => row.oee_pct as number);
      expect(values).toEqual([...values].sort((a, b) => b - a));
      expect(values.every((value) => value > 0 && value < 100)).toBe(true);
    } finally {
      db.closeSync();
    }
  });
});
