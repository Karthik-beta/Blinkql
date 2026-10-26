// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoMap } from "../template";
import { catalogTables, createSamples, renamedCopy, runTemplate } from "../test-utils";
import { dataQuality } from "./data-quality";

// A small import shaped like the sample: A1 appears twice, row 2 has an empty description and an
// unknown plant, row 3 no unit, row 4 no item code and a lowercase plant, row 5 a blank description.
const SAMPLE = `CREATE TABLE item_import AS SELECT * FROM (VALUES
  ('A1', 'Bolt', 'EA', 'P1'),
  ('A2', '', 'KG', 'P9'),
  ('A1', 'Nut', NULL, 'P2'),
  (NULL, 'Gear', 'EA', 'p1'),
  ('A3', '  ', 'M', NULL)
) AS t(item_code, description, uom, plant_code);
CREATE TABLE plants AS SELECT * FROM (VALUES
  ('P1', 'Plant one'),
  ('P2', 'Plant two')
) AS t(plant_code, plant_name)`;

type Issue = {
  issue: string;
  key_value: string | null;
  column_name: string;
  value: string | null;
  row_number: bigint;
};

/** A row of the result, as the template returns it. */
function found(
  issue: string,
  key: string | null,
  column: string,
  value: string | null,
  row: number,
): Issue {
  return { issue, key_value: key, column_name: column, value, row_number: BigInt(row) };
}

const firstA1 = found("Duplicate key", "A1", "item_code", "A1", 1);
const secondA1 = found("Duplicate key", "A1", "item_code", "A1", 3);
const missingKey = found("Missing item_code", null, "item_code", null, 4);

const expected: Issue[] = [
  firstA1,
  found("Broken reference", "A2", "plant_code", "P9", 2),
  found("Missing description", "A2", "description", "", 2),
  secondA1,
  found("Missing uom", "A1", "uom", null, 3),
  found("Broken reference", null, "plant_code", "p1", 4),
  missingKey,
  found("Missing description", "A3", "description", "  ", 5),
];

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(SAMPLE);
});

afterAll(() => {
  connection.closeSync();
});

describe("Data-quality checks for an import file", () => {
  it("runs on the sample", async () => {
    const { rows } = await runTemplate(connection, dataQuality);
    expect(rows).toEqual(expected);
  });

  it("runs on a user's file with other column names, mapped automatically", async () => {
    const name = await renamedCopy(connection, "item_import", {
      item_code: "Item Code",
      description: "Item Description",
      uom: "Unit",
      plant_code: "Plant",
    });
    const tables = (await catalogTables(connection)).filter(
      (table) => table.name !== "item_import",
    );
    const mapping = autoMap(dataQuality, tables);
    expect(mapping).toEqual({
      items: {
        table: name,
        columns: {
          key: "Item Code",
          mandatory_1: "Item Description",
          mandatory_2: "Unit",
          reference: "Plant",
        },
      },
      refs: { table: "plants", columns: { key: "plant_code" } },
    });
    const { rows } = await runTemplate(connection, dataQuality, { mapping });
    const renamed: Record<string, string> = {
      item_code: "Item Code",
      description: "Item Description",
      uom: "Unit",
      plant_code: "Plant",
    };
    expect(rows).toEqual(
      expected.map((row) => {
        const column = renamed[row.column_name] ?? row.column_name;
        return { ...row, column_name: column, issue: row.issue.replace(row.column_name, column) };
      }),
    );
  });

  it("checks only the columns that are mapped", async () => {
    const { rows } = await runTemplate(connection, dataQuality, {
      mapping: {
        items: { table: "item_import", columns: { key: "item_code" } },
        refs: { table: "plants", columns: { key: "plant_code" } },
      },
    });
    expect(rows).toEqual([firstA1, secondA1, missingKey]);
  });

  it("charts a column of its result", async () => {
    const { columns } = await runTemplate(connection, dataQuality);
    expect(columns).toContain(dataQuality.chart?.x);
  });
});

describe("Data-quality checks on the sample data", () => {
  it("finds duplicate keys, missing fields and broken references", async () => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    try {
      await createSamples(db, "item_import", "plants");
      const { rows } = await runTemplate(db, dataQuality);
      expect(new Set(rows.map((row) => row.issue))).toEqual(
        new Set(["Duplicate key", "Missing description", "Missing uom", "Broken reference"]),
      );
      const broken = rows.filter((row) => row.issue === "Broken reference").map((row) => row.value);
      expect(new Set(broken)).toEqual(new Set(["P900", "P250", "p200"]));
      // Four item codes are each repeated once in the sample.
      const duplicates = rows.filter((row) => row.issue === "Duplicate key");
      expect(duplicates).toHaveLength(8);
    } finally {
      db.closeSync();
    }
  });
});
