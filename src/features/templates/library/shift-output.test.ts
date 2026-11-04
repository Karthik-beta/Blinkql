// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { shiftOutput } from "./shift-output";

// Events either side of midnight on Monday 21 September. Units are powers of two, so each sum
// shows which events it holds.
const SAMPLE = `CREATE TABLE shift_output AS SELECT * FROM (VALUES
  ('m1', 'OP-1', TIMESTAMP '2026-09-21 12:00', 64),
  ('m1', 'OP-2', TIMESTAMP '2026-09-21 21:59', 1),
  ('m1', 'OP-3', TIMESTAMP '2026-09-21 22:00', 2),
  ('m1', 'OP-3', TIMESTAMP '2026-09-21 23:59', 4),
  ('m1', 'OP-3', TIMESTAMP '2026-09-22 00:00', 8),
  ('m1', 'OP-3', TIMESTAMP '2026-09-22 05:59', 16),
  ('m1', 'OP-1', TIMESTAMP '2026-09-22 06:00', 32)
) AS t(machine_id, operator_id, event_at, units)`;

const expected = [
  { production_day: "2026-09-21", shift: "A", machine: "m1", units: 64n, events: 1n },
  { production_day: "2026-09-21", shift: "B", machine: "m1", units: 1n, events: 1n },
  { production_day: "2026-09-21", shift: "C", machine: "m1", units: 30n, events: 4n },
  { production_day: "2026-09-22", shift: "A", machine: "m1", units: 32n, events: 1n },
];

/** The rows with each production day as YYYY-MM-DD. */
function byDay(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    ...row,
    production_day: (row.production_day as Date).toISOString().slice(0, 10),
  }));
}

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("Output by production day and shift", () => {
  it("reports the night shift on the day it started", async () => {
    const { rows } = await runTemplate(connection, shiftOutput);
    expect(byDay(rows)).toEqual(expected);
  });

  it("follows other shift starts and names", async () => {
    const { rows } = await runTemplate(connection, shiftOutput, {
      params: { shift_starts: "07:00, 19:00", shift_names: "Day, Night" },
    });
    expect(byDay(rows)).toMatchObject([
      { production_day: "2026-09-21", shift: "Day", units: 64n, events: 1n },
      { production_day: "2026-09-21", shift: "Night", units: 63n, events: 6n },
    ]);
  });

  it("names shifts it has no name for by their number", async () => {
    const { rows } = await runTemplate(connection, shiftOutput, {
      params: { shift_starts: "07:00, 19:00", shift_names: "Day" },
    });
    expect(rows.map((row) => row.shift)).toEqual(["Day", "Shift 2"]);
  });

  it("rejects a shift start that isn't a time", async () => {
    await expect(
      runTemplate(connection, shiftOutput, { params: { shift_starts: "06:00, noon" } }),
    ).rejects.toThrow("Shift starts must be times");
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "shift_output", {
      event_at: "Timestamp",
      units: "qty",
      machine_id: "Asset ID",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(shiftOutput, mine);
    expect(mapping).toEqual({
      events: {
        table: name,
        columns: { event_at: "Timestamp", units: "qty", machine: "Asset ID" },
      },
    });
    const { rows } = await runTemplate(connection, shiftOutput, { mapping });
    expect(byDay(rows)).toEqual(expected);
  });

  it("runs without the optional machine", async () => {
    const { rows } = await runTemplate(connection, shiftOutput, {
      mapping: {
        events: { table: "shift_output", columns: { event_at: "event_at", units: "units" } },
      },
    });
    expect(byDay(rows)).toEqual(expected.map((row) => ({ ...row, machine: null })));
  });

  it("charts columns of its result", async () => {
    const { columns } = await runTemplate(connection, shiftOutput);
    expect(columns).toContain(shiftOutput.chart?.x);
    expect(columns).toContain(shiftOutput.chart?.y);
  });
});

describe("Output by production day and shift on the sample data", () => {
  it("puts every event on a shift of its production day", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "shift_output");
      const { rows } = await runTemplate(db, shiftOutput);
      expect(new Set(rows.map((row) => row.shift))).toEqual(new Set(["A", "B", "C"]));
      // The same report worked out from the clock: the day starts at 06:00, and C runs 22:00-06:00.
      const byClock = await db.runAndReadAll(
        `SELECT CAST(event_at - INTERVAL 6 HOUR AS DATE) AS production_day,
           CASE WHEN hour(event_at) BETWEEN 6 AND 13 THEN 'A'
             WHEN hour(event_at) BETWEEN 14 AND 21 THEN 'B' ELSE 'C' END AS shift,
           machine_id AS machine, CAST(sum(units) AS BIGINT) AS units, count(*) AS events
         FROM shift_output GROUP BY ALL ORDER BY ALL`,
      );
      expect(rows).toEqual(byClock.getRowObjectsJS());
    } finally {
      db.closeSync();
    }
  });
});
