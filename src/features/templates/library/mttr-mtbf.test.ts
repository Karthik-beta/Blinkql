// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { mttrMtbf } from "./mttr-mtbf";

// A small breakdown log shaped like the sample. Machine A fails three times, with 30, 60 and 30
// minutes of repair and uptime gaps of 90 minutes and 3 hours, so MTBF is 2.25 hours. Machine B
// fails once, so its MTBF is NULL. The rows are out of order to check the ordering by start.
const SAMPLE = `CREATE TABLE breakdowns AS SELECT * FROM (VALUES
  (3, 'A', 'Jam', TIMESTAMP '2026-01-01 14:00', TIMESTAMP '2026-01-01 14:30'),
  (1, 'A', 'Jam', TIMESTAMP '2026-01-01 08:00', TIMESTAMP '2026-01-01 08:30'),
  (2, 'A', 'Tool wear', TIMESTAMP '2026-01-01 10:00', TIMESTAMP '2026-01-01 11:00'),
  (4, 'B', 'Hydraulic leak', TIMESTAMP '2026-01-01 09:00', TIMESTAMP '2026-01-01 09:20')
) AS t(breakdown_id, machine_id, reason, started_at, ended_at)`;

const expected = [
  { machine_id: "A", failures: 3n, downtime_h: 2, mttr_min: 40, mtbf_h: 2.25 },
  { machine_id: "B", failures: 1n, downtime_h: 0.33, mttr_min: 20, mtbf_h: null },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("MTTR and MTBF per machine", () => {
  it("runs on the sample", async () => {
    const { rows } = await runTemplate(connection, mttrMtbf);
    expect(rows).toMatchObject(expected);
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "breakdowns", {
      machine_id: "Asset ID",
      started_at: "start_time",
      ended_at: "end_time",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(mttrMtbf, mine);
    expect(mapping).toEqual({
      breakdowns: {
        table: name,
        columns: { machine: "Asset ID", started_at: "start_time", ended_at: "end_time" },
      },
    });
    const { rows } = await runTemplate(connection, mttrMtbf, { mapping });
    expect(rows).toMatchObject(expected);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, mttrMtbf);
    expect(columns).toContain(mttrMtbf.chart?.x);
    expect(columns).toContain(mttrMtbf.chart?.y);
  });
});

describe("MTTR and MTBF per machine on the sample data", () => {
  it("measures every sample machine", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "breakdowns");
      const { rows } = await runTemplate(db, mttrMtbf);
      expect(rows).toHaveLength(8);
      expect(rows.every((row) => (row.downtime_h as number) > 0)).toBe(true);
      expect(rows.every((row) => (row.mttr_min as number) > 0)).toBe(true);
      const mtbfs = rows.map((row) => row.mtbf_h as number | null);
      const measured = mtbfs.filter((mtbf): mtbf is number => mtbf !== null);
      expect(measured.length).toBeGreaterThan(0);
      expect(measured.every((mtbf) => mtbf > 0)).toBe(true);
      expect(measured).toEqual([...measured].sort((a, b) => a - b));
    } finally {
      db.closeSync();
    }
  });
});
