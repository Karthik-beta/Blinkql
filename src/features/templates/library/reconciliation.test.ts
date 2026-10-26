// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { reconciliation } from "./reconciliation";

// A small pair shaped like the samples: A agrees, B and C differ, D (split over two rows) is only
// in the ERP, E and F only in the MES.
const SAMPLE = [
  `CREATE TABLE erp_orders AS SELECT * FROM (VALUES
    ('A', 'ITM-1', 10, 10), ('B', 'ITM-2', 20, 20), ('C', 'ITM-3', 5, 5),
    ('D', 'ITM-4', 4, 4), ('D', 'ITM-4', 3, 3)
  ) AS t(order_id, item_code, planned_qty, reported_qty)`,
  `CREATE TABLE mes_orders AS SELECT * FROM (VALUES
    ('A', 'ITM-1', 10), ('B', 'ITM-2', 14), ('C', 'ITM-3', 8), ('E', 'ITM-5', 30), ('F', 'ITM-6', 1)
  ) AS t(work_order, part_number, good_qty)`,
];

const expected = [
  { key: "E", left_qty: null, right_qty: 30n, variance: 30n, status: "Only in second" },
  { key: "D", left_qty: 7n, right_qty: null, variance: -7n, status: "Only in first" },
  { key: "B", left_qty: 20n, right_qty: 14n, variance: -6n, status: "Quantities differ" },
  { key: "C", left_qty: 5n, right_qty: 8n, variance: 3n, status: "Quantities differ" },
  { key: "F", left_qty: null, right_qty: 1n, variance: 1n, status: "Only in second" },
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  for (const sql of SAMPLE) await connection.run(sql);
});

afterAll(() => {
  connection.closeSync();
});

describe("Two-file reconciliation", () => {
  it("runs on the sample, largest variance first", async () => {
    const { rows } = await runTemplate(connection, reconciliation);
    expect(rows).toEqual(
      expected.map((row) => ({
        ...row,
        abs_variance: row.variance < 0n ? -row.variance : row.variance,
      })),
    );
  });

  it("maps both samples to their own table among other tables", async () => {
    await renamedCopy(connection, "erp_orders", { order_id: "work_order" }, "erp_copy");
    const mapping = autoMap(reconciliation, await catalogTables(connection));
    expect(mapping).toEqual({
      left: { table: "erp_orders", columns: { key: "order_id", quantity: "reported_qty" } },
      right: { table: "mes_orders", columns: { key: "work_order", quantity: "good_qty" } },
    });
  });

  it("runs on two of a user's files with other column names, mapped automatically", async () => {
    const first = await renamedCopy(connection, "erp_orders", {
      order_id: "Order No",
      reported_qty: "Confirmed Qty",
    });
    const second = await renamedCopy(connection, "mes_orders", {
      work_order: "Order",
      good_qty: "Produced Qty",
    });
    const mine = (await catalogTables(connection)).filter(
      (table) => table.name === first || table.name === second,
    );
    const mapping = autoMap(reconciliation, mine);
    expect(mapping).toEqual({
      left: { table: first, columns: { key: "Order No", quantity: "Confirmed Qty" } },
      right: { table: second, columns: { key: "Order", quantity: "Produced Qty" } },
    });
    const { rows } = await runTemplate(connection, reconciliation, { mapping });
    expect(rows).toMatchObject(expected);
  });

  it("leaves out differences within the tolerance, but never missing keys", async () => {
    const { rows } = await runTemplate(connection, reconciliation, { params: { tolerance: 3 } });
    expect(rows.map((row) => row.key)).toEqual(["E", "D", "B", "F"]);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, reconciliation);
    expect(columns).toContain(reconciliation.chart?.x);
    expect(columns).toContain(reconciliation.chart?.y);
  });
});

describe("Two-file reconciliation on the sample data", () => {
  it("finds the orders missing from each side and those that differ", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "erp_orders", "mes_orders");
      const { rows } = await runTemplate(db, reconciliation);
      const count = (status: string) => rows.filter((row) => row.status === status).length;
      expect(count("Only in first")).toBe(5);
      expect(count("Only in second")).toBe(4);
      expect(count("Quantities differ")).toBe(13);
      expect(rows).toHaveLength(22);
      const sizes = rows.map((row) => Number(row.abs_variance));
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      expect(sizes.every((size) => size > 0)).toBe(true);
    } finally {
      db.closeSync();
    }
  });
});
