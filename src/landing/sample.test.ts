// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleColumns, sampleQuery, sampleTableSql } from "./sample.ts";

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(sampleTableSql);
});

afterAll(() => {
  connection.closeSync();
});

describe("sample query", () => {
  it("returns the columns and row count the static result shows", async () => {
    const result = await connection.runAndReadAll(sampleQuery.sql.join("\n"));
    expect(result.columnNames()).toEqual(sampleColumns.map((c) => c.name));
    expect(result.currentRowCount).toBe(sampleQuery.rowCount);
  });

  it("gives plausible ratios, sorted by availability", async () => {
    const result = await connection.runAndReadAll(sampleQuery.sql.join("\n"));
    const rows = result.getRowObjectsJS();
    const availability = rows.map((r) => Number(r.availability));
    expect(availability).toEqual([...availability].sort((a, b) => a - b));
    for (const r of rows) {
      for (const ratio of ["availability", "performance", "quality", "oee"]) {
        expect(Number(r[ratio])).toBeGreaterThan(0.3);
        expect(Number(r[ratio])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is the same on every run", async () => {
    const first = await connection.runAndReadAll("SELECT * FROM production_log");
    await connection.run(sampleTableSql);
    const second = await connection.runAndReadAll("SELECT * FROM production_log");
    expect(second.getRowsJS()).toEqual(first.getRowsJS());
  });
});
