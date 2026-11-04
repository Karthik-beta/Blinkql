// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { qualityRejects } from "./quality-rejects";

// A small quality_checks table shaped like the sample: m1 rejects 5 of 100, m2 1 of 50 and m3,
// with 10 inspected, 3.
const SAMPLE = `CREATE TABLE quality_checks AS SELECT * FROM (VALUES
  (1, 'm1', TIMESTAMP '2026-01-01 08:00', 60, 3, 'scratch'),
  (2, 'm1', TIMESTAMP '2026-01-02 08:00', 40, 2, 'dent'),
  (3, 'm2', TIMESTAMP '2026-01-01 09:00', 50, 1, 'scratch'),
  (4, 'm3', TIMESTAMP '2026-01-03 10:00', 10, 3, 'crack')
) AS t(check_id, machine_id, checked_at, inspected, rejected, defect_type)`;

const expected = [
  { machine_id: "m3", inspected: 10n, rejected: 3n, reject_rate_pct: 30 },
  { machine_id: "m1", inspected: 100n, rejected: 5n, reject_rate_pct: 5 },
  { machine_id: "m2", inspected: 50n, rejected: 1n, reject_rate_pct: 2 },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("Reject rate by machine", () => {
  it("runs on the sample", async () => {
    const { rows } = await runTemplate(connection, qualityRejects);
    expect(rows).toMatchObject(expected);
    expect(rows[1]).toMatchObject({ first_check: expect.any(Date), last_check: expect.any(Date) });
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "quality_checks", {
      machine_id: "Asset ID",
      checked_at: "timestamp",
      inspected: "qty",
      rejected: "scrap",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(qualityRejects, mine);
    expect(mapping).toEqual({
      checks: {
        table: name,
        columns: {
          machine_id: "Asset ID",
          checked_at: "timestamp",
          inspected: "qty",
          rejected: "scrap",
        },
      },
    });
    const { rows } = await runTemplate(connection, qualityRejects, { mapping });
    expect(rows).toMatchObject(expected);
  });

  it("runs without the optional check time", async () => {
    const { rows } = await runTemplate(connection, qualityRejects, {
      mapping: {
        checks: {
          table: "quality_checks",
          columns: { machine_id: "machine_id", inspected: "inspected", rejected: "rejected" },
        },
      },
    });
    expect(rows).toMatchObject(expected);
    expect(rows[0]).toMatchObject({ first_check: null, last_check: null });
  });

  it("leaves out machines with fewer inspected parts than the minimum", async () => {
    const { rows } = await runTemplate(connection, qualityRejects, {
      params: { min_inspected: 50 },
    });
    expect(rows.map((row) => row.machine_id)).toEqual(["m1", "m2"]);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, qualityRejects);
    expect(columns).toContain(qualityRejects.chart?.x);
    expect(columns).toContain(qualityRejects.chart?.y);
  });
});

describe("Reject rate by machine on the sample data", () => {
  it("ranks every sample machine by its reject rate", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "quality_checks");
      const { rows } = await runTemplate(db, qualityRejects);
      expect(rows).toHaveLength(8);
      const rates = rows.map((row) => row.reject_rate_pct as number);
      expect(rates).toEqual([...rates].sort((a, b) => b - a));
      expect(rates.every((rate) => rate > 0 && rate < 100)).toBe(true);
    } finally {
      db.closeSync();
    }
  });
});
