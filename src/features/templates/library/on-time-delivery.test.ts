// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { onTimeDelivery } from "./on-time-delivery";

// A small shipments table shaped like the sample, but with delivery times as many exports have
// them. Carrier A delivers 3 of 4 on time (one late in the evening of the promised day, one a day
// early) and 1 two days late, with one more on the road. Carrier B delivers both late, by 1 and 3
// days. Carrier C has delivered nothing yet.
const SAMPLE = `CREATE TABLE shipments AS SELECT * FROM (VALUES
  ('S1', 'A', DATE '2026-07-03', TIMESTAMP '2026-07-03 18:30'),
  ('S2', 'A', DATE '2026-07-03', TIMESTAMP '2026-07-02 09:00'),
  ('S3', 'A', DATE '2026-07-04', TIMESTAMP '2026-07-06 11:00'),
  ('S4', 'A', DATE '2026-07-05', TIMESTAMP '2026-07-05 08:00'),
  ('S5', 'A', DATE '2026-07-09', NULL),
  ('S6', 'B', DATE '2026-07-03', TIMESTAMP '2026-07-04 10:00'),
  ('S7', 'B', DATE '2026-07-03', TIMESTAMP '2026-07-06 10:00'),
  ('S8', 'C', DATE '2026-07-09', NULL)
) AS t(shipment_id, carrier, promised_date, delivered_date)`;

const expected = [
  {
    carrier: "B",
    shipments: 2n,
    delivered: 2n,
    on_time: 0n,
    late: 2n,
    in_transit: 0n,
    on_time_pct: 0,
    avg_days_late: 2,
  },
  {
    carrier: "A",
    shipments: 5n,
    delivered: 4n,
    on_time: 3n,
    late: 1n,
    in_transit: 1n,
    on_time_pct: 75,
    avg_days_late: 2,
  },
  {
    carrier: "C",
    shipments: 1n,
    delivered: 0n,
    on_time: 0n,
    late: 0n,
    in_transit: 1n,
    on_time_pct: null,
    avg_days_late: null,
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

describe("On-time delivery by carrier", () => {
  it("runs on the sample, leaving shipments in transit out of the rate", async () => {
    const { rows } = await runTemplate(connection, onTimeDelivery);
    expect(rows).toEqual(expected);
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "shipments", {
      carrier: "SCAC",
      promised_date: "Due Date",
      delivered_date: "delivered_at",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(onTimeDelivery, mine);
    expect(mapping).toEqual({
      shipments: {
        table: name,
        columns: { carrier: "SCAC", promised_date: "Due Date", delivered_date: "delivered_at" },
      },
    });
    const { rows } = await runTemplate(connection, onTimeDelivery, { mapping });
    expect(rows).toEqual(expected);
  });

  it("counts deliveries within the days of grace as on time", async () => {
    const { rows } = await runTemplate(connection, onTimeDelivery, { params: { grace_days: 1 } });
    expect(rows.map(({ carrier, on_time_pct }) => ({ carrier, on_time_pct }))).toEqual([
      { carrier: "B", on_time_pct: 50 },
      { carrier: "A", on_time_pct: 75 },
      { carrier: "C", on_time_pct: null },
    ]);
    expect(rows[0]).toMatchObject({ on_time: 1n, late: 1n, avg_days_late: 3 });
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, onTimeDelivery);
    expect(columns).toContain(onTimeDelivery.chart?.x);
    expect(columns).toContain(onTimeDelivery.chart?.y);
  });
});

describe("On-time delivery by carrier on the sample data", () => {
  it("ranks every sample carrier, worst first", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "shipments");
      const { rows } = await runTemplate(db, onTimeDelivery);
      expect(rows).toHaveLength(5);
      const rates = rows.map((row) => row.on_time_pct as number);
      expect(rates).toEqual([...rates].sort((a, b) => a - b));
      expect(rates.every((rate) => rate > 50 && rate < 100)).toBe(true);
      expect(rows.some((row) => (row.in_transit as bigint) > 0n)).toBe(true);
    } finally {
      db.closeSync();
    }
  });
});
