// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { downtimePareto } from "./downtime-pareto";

// A small breakdowns table shaped like the sample: 120 minutes of hydraulic leaks, 50 of jams on
// two machines and 30 of tool wear in two stops, 200 in all.
const SAMPLE = `CREATE TABLE breakdowns AS SELECT * FROM (VALUES
  (1, 'm1', 'Jam', TIMESTAMP '2026-01-01 08:00', TIMESTAMP '2026-01-01 08:10'),
  (2, 'm2', 'Jam', TIMESTAMP '2026-01-01 09:00', TIMESTAMP '2026-01-01 09:40'),
  (3, 'm1', 'Hydraulic leak', TIMESTAMP '2026-01-01 10:00', TIMESTAMP '2026-01-01 12:00'),
  (4, 'm2', 'Tool wear', TIMESTAMP '2026-01-01 12:00', TIMESTAMP '2026-01-01 12:15'),
  (5, 'm2', 'Tool wear', TIMESTAMP '2026-01-01 13:00', TIMESTAMP '2026-01-01 13:15')
) AS t(breakdown_id, machine_id, reason, started_at, ended_at)`;

const expected = [
  { reason: "Hydraulic leak", downtime_min: 120, stops: 1n, share_pct: 60, cumulative_pct: 60 },
  { reason: "Jam", downtime_min: 50, stops: 2n, share_pct: 25, cumulative_pct: 85 },
  { reason: "Tool wear", downtime_min: 30, stops: 2n, share_pct: 15, cumulative_pct: 100 },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("Downtime Pareto", () => {
  it("runs on the sample", async () => {
    const { rows } = await runTemplate(connection, downtimePareto);
    expect(rows).toMatchObject(expected);
    expect(rows.map((row) => row.machines)).toEqual([1n, 2n, 1n]);
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "breakdowns", {
      reason: "Stop reason",
      started_at: "Start time",
      ended_at: "End time",
      machine_id: "Asset",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(downtimePareto, mine);
    expect(mapping).toEqual({
      stops: {
        table: name,
        columns: {
          reason: "Stop reason",
          started_at: "Start time",
          ended_at: "End time",
          machine: "Asset",
        },
      },
    });
    const { rows } = await runTemplate(connection, downtimePareto, { mapping });
    expect(rows).toMatchObject(expected);
  });

  it("runs without the optional machine", async () => {
    const { rows } = await runTemplate(connection, downtimePareto, {
      mapping: {
        stops: {
          table: "breakdowns",
          columns: { reason: "reason", started_at: "started_at", ended_at: "ended_at" },
        },
      },
    });
    expect(rows).toMatchObject(expected);
  });

  it("charts columns of its result", async () => {
    const { columns } = await runTemplate(connection, downtimePareto);
    expect(columns).toContain(downtimePareto.chart?.x);
    expect(columns).toContain(downtimePareto.chart?.y);
  });
});

describe("Downtime Pareto on the sample data", () => {
  it("ranks every sample reason by its downtime, adding up to all of it", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "breakdowns");
      const { rows } = await runTemplate(db, downtimePareto);
      expect(rows).toHaveLength(8);
      const minutes = rows.map((row) => row.downtime_min as number);
      expect(minutes).toEqual([...minutes].sort((a, b) => b - a));
      const cumulative = rows.map((row) => row.cumulative_pct as number);
      expect(cumulative).toEqual([...cumulative].sort((a, b) => a - b));
      expect(cumulative.at(-1)).toBe(100);
    } finally {
      db.closeSync();
    }
  });
});
