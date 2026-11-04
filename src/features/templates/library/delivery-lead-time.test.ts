// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { deliveryLeadTime } from "./delivery-lead-time";

// A small shipments table shaped like the sample. Pune to Delhi delivers in 1, 2, 2, 3 and 10 days,
// with one more on the road: a median of 2 days, and a 90th percentile of 3 + 0.6 × 7 = 7.2 days.
// Chennai to Kolkata takes 4 and 6 days: 5, and 4 + 0.9 × 2 = 5.8. Hosur to Guwahati has
// delivered nothing yet.
const SAMPLE = `CREATE TABLE shipments AS SELECT * FROM (VALUES
  ('S1', 'Chennai', 'Kolkata', DATE '2026-07-01', DATE '2026-07-05'),
  ('S2', 'Pune', 'Delhi', DATE '2026-07-01', DATE '2026-07-02'),
  ('S3', 'Pune', 'Delhi', DATE '2026-07-01', DATE '2026-07-03'),
  ('S4', 'Pune', 'Delhi', DATE '2026-07-02', DATE '2026-07-04'),
  ('S5', 'Pune', 'Delhi', DATE '2026-07-02', DATE '2026-07-05'),
  ('S6', 'Pune', 'Delhi', DATE '2026-07-03', DATE '2026-07-13'),
  ('S7', 'Pune', 'Delhi', DATE '2026-07-20', NULL),
  ('S8', 'Chennai', 'Kolkata', DATE '2026-07-02', DATE '2026-07-08'),
  ('S9', 'Hosur', 'Guwahati', DATE '2026-07-20', NULL)
) AS t(shipment_id, origin, destination, ship_date, delivered_date)`;

const expected = [
  { lane: "Pune → Delhi", delivered: 5n, in_transit: 1n, median_days: 2, p90_days: 7.2 },
  { lane: "Chennai → Kolkata", delivered: 2n, in_transit: 0n, median_days: 5, p90_days: 5.8 },
  { lane: "Hosur → Guwahati", delivered: 0n, in_transit: 1n, median_days: null, p90_days: null },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("Delivery lead time by lane", () => {
  it("runs on the sample", async () => {
    const { rows } = await runTemplate(connection, deliveryLeadTime);
    expect(rows).toEqual(expected);
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "shipments", {
      origin: "Ship From",
      destination: "Ship To",
      ship_date: "dispatch_date",
      delivered_date: "Delivery Date",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(deliveryLeadTime, mine);
    expect(mapping).toEqual({
      shipments: {
        table: name,
        columns: {
          origin: "Ship From",
          destination: "Ship To",
          ship_date: "dispatch_date",
          delivered_date: "Delivery Date",
        },
      },
    });
    const { rows } = await runTemplate(connection, deliveryLeadTime, { mapping });
    expect(rows).toEqual(expected);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, deliveryLeadTime);
    expect(columns).toContain(deliveryLeadTime.chart?.x);
    expect(columns).toContain(deliveryLeadTime.chart?.y);
  });
});

describe("Delivery lead time by lane on the sample data", () => {
  it("measures every sample lane, slowest first", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "shipments");
      const { rows } = await runTemplate(db, deliveryLeadTime);
      expect(rows).toHaveLength(8);
      const p90s = rows.map((row) => row.p90_days as number);
      expect(p90s).toEqual([...p90s].sort((a, b) => b - a));
      for (const row of rows) {
        expect(row.median_days as number).toBeGreaterThan(0);
        expect(row.p90_days as number).toBeGreaterThanOrEqual(row.median_days as number);
      }
    } finally {
      db.closeSync();
    }
  });
});
