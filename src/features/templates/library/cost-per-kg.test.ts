// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { costPerKg } from "./cost-per-kg";

// A small shipments table shaped like the sample. From Pune to Delhi, carrier X moves 400 kg for
// 1,400 (3.50 a kg, weighted by weight, not the average of 5.00 and 3.00 per shipment) and Y 200 kg
// for 1,000 (5.00). From Chennai to Kolkata, X moves 1,000 kg for 2,000 (2.00) and Z only a
// weightless envelope, so it has no cost per kg.
const SAMPLE = `CREATE TABLE shipments AS SELECT * FROM (VALUES
  ('S1', 'Y', 'Pune', 'Delhi', 200.0, 1000.0),
  ('S2', 'X', 'Pune', 'Delhi', 100.0, 500.0),
  ('S3', 'X', 'Pune', 'Delhi', 300.0, 900.0),
  ('S4', 'X', 'Chennai', 'Kolkata', 1000.0, 2000.0),
  ('S5', 'Z', 'Chennai', 'Kolkata', 0.0, 150.0)
) AS t(shipment_id, carrier, origin, destination, weight_kg, freight_cost)`;

const expected = [
  {
    lane: "Chennai → Kolkata",
    carrier: "X",
    shipments: 1n,
    weight_kg: 1000,
    cost: 2000,
    cost_per_kg: 2,
  },
  {
    lane: "Chennai → Kolkata",
    carrier: "Z",
    shipments: 1n,
    weight_kg: 0,
    cost: 150,
    cost_per_kg: null,
  },
  {
    lane: "Pune → Delhi",
    carrier: "X",
    shipments: 2n,
    weight_kg: 400,
    cost: 1400,
    cost_per_kg: 3.5,
  },
  { lane: "Pune → Delhi", carrier: "Y", shipments: 1n, weight_kg: 200, cost: 1000, cost_per_kg: 5 },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("Cost per kg by lane and carrier", () => {
  it("runs on the sample", async () => {
    const { rows } = await runTemplate(connection, costPerKg);
    expect(rows).toEqual(expected);
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "shipments", {
      carrier: "Haulier",
      origin: "from_city",
      destination: "to_city",
      weight_kg: "Gross Weight",
      freight_cost: "Freight Charge",
    });
    const mine = (await catalogTables(connection)).filter((table) => table.name === name);
    const mapping = autoMap(costPerKg, mine);
    expect(mapping).toEqual({
      shipments: {
        table: name,
        columns: {
          origin: "from_city",
          destination: "to_city",
          carrier: "Haulier",
          weight_kg: "Gross Weight",
          cost: "Freight Charge",
        },
      },
    });
    const { rows } = await runTemplate(connection, costPerKg, { mapping });
    expect(rows).toEqual(expected);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, costPerKg);
    expect(columns).toContain(costPerKg.chart?.x);
    expect(columns).toContain(costPerKg.chart?.y);
  });
});

describe("Cost per kg by lane and carrier on the sample data", () => {
  it("prices every sample carrier on every lane, cheapest first within a lane", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "shipments");
      const { rows } = await runTemplate(db, costPerKg);
      expect(rows).toHaveLength(40);
      expect(new Set(rows.map((row) => row.lane)).size).toBe(8);
      for (const lane of new Set(rows.map((row) => row.lane))) {
        const costs = rows.filter((row) => row.lane === lane).map((row) => row.cost_per_kg);
        expect(costs).toEqual([...costs].sort((a, b) => (a as number) - (b as number)));
        expect(costs.every((cost) => (cost as number) > 0)).toBe(true);
      }
    } finally {
      db.closeSync();
    }
  });
});
