// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sampleColumns,
  sampleOrderCount,
  sampleQuery,
  sampleRows,
  sampleTableSql,
} from "./sample.ts";

let connection: DuckDBConnection;

// Making the sample's 250,000 orders can take longer than the default timeouts on a busy machine.
const SLOW = 30_000;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(sampleTableSql);
}, SLOW);

afterAll(() => {
  connection.closeSync();
});

async function runSample() {
  return connection.runAndReadAll(sampleQuery.sql.join("\n"));
}

describe("sample query", () => {
  it("returns the columns, types and row count the static result shows", async () => {
    const result = await runSample();
    expect(result.columnNames()).toEqual(sampleColumns.map((c) => c.name));
    expect(result.columnTypes().map(String)).toEqual(sampleColumns.map((c) => c.type));
    expect(result.currentRowCount).toBe(sampleQuery.rowCount);
  });

  it("returns the static result's first rows, NULL included", async () => {
    // For these types the text of a value is what the workbench's grid shows for it.
    const rows = (await runSample())
      .getRows()
      .slice(0, sampleRows.length)
      .map((row) => row.map((value) => (value === null ? null : String(value))));
    expect(rows).toEqual(sampleRows);
  });

  it("covers January to October 2026, with a share of orders missing their region", async () => {
    const summary = await connection.runAndReadAll(
      "SELECT count(*), min(ordered_at), max(ordered_at), count(*) - count(region) FROM orders",
    );
    const [count, first, last, noRegion] = summary.getRows()[0]?.map(String) ?? [];
    expect(Number(count)).toBe(sampleOrderCount);
    expect([first, last]).toEqual(["2026-01-01", "2026-10-31"]);
    expect(Number(noRegion)).toBeGreaterThan(0);
  });

  it("is the same on every run", { timeout: SLOW }, async () => {
    await connection.run("CREATE OR REPLACE TABLE first_run AS FROM orders");
    await connection.run(sampleTableSql);
    const differences = await connection.runAndReadAll(
      "SELECT count(*) FROM ((FROM orders EXCEPT ALL FROM first_run) UNION ALL (FROM first_run EXCEPT ALL FROM orders))",
    );
    expect(differences.getRowsJS()).toEqual([[0n]]);
  });
});
