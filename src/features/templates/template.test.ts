import { describe, expect, it } from "vitest";
import { templates } from "./registry";
import {
  autoMap,
  type CatalogTable,
  columnTypeOf,
  fitsType,
  mappingProblems,
  renderTemplate,
  type Template,
} from "./template";

const downtime: Template = {
  id: "downtime",
  title: "Downtime by machine",
  description: "",
  tables: [
    {
      key: "stops",
      label: "Stops",
      sample: "machine_stops",
      columns: [
        { key: "machine", label: "Machine", type: "text", aliases: ["asset_id"] },
        { key: "minutes", label: "Minutes down", type: "number" },
        { key: "started_at", label: "Started at", type: "temporal", optional: true },
      ],
    },
  ],
  params: [
    { key: "min", label: "Minimum minutes", type: "number", default: 5 },
    { key: "reason", label: "Reason", type: "text", default: "all" },
  ],
  sql: (t) =>
    `SELECT ${t.col("stops", "machine")}, ${t.col("stops", "started_at")}, ${t.param("reason")}
FROM ${t.table("stops")} WHERE ${t.col("stops", "minutes")} >= ${t.param("min")}`,
};

const sample: CatalogTable = {
  name: "machine_stops",
  columns: [
    { name: "machine", type: "VARCHAR" },
    { name: "minutes", type: "INTEGER" },
    { name: "started_at", type: "TIMESTAMP" },
  ],
};

// A user's file: the same data under other names, and a column auto-matching mustn't take.
const mine: CatalogTable = {
  name: "my stops",
  columns: [
    { name: "Notes", type: "VARCHAR" },
    { name: "Asset ID", type: "BIGINT" },
    { name: "Minutes Down", type: "DOUBLE" },
    { name: "STARTED-AT", type: "VARCHAR" },
  ],
};

describe("columnTypeOf", () => {
  it("groups DuckDB's types", () => {
    expect(
      ["INTEGER", "UBIGINT", "DECIMAL(18,3)", "DOUBLE", "DATE", "TIMESTAMP WITH TIME ZONE"].map(
        columnTypeOf,
      ),
    ).toEqual(["number", "number", "number", "number", "temporal", "temporal"]);
    expect(["VARCHAR", "BOOLEAN", "TIME", "INTEGER[]"].map(columnTypeOf)).toEqual([
      "text",
      null,
      null,
      null,
    ]);
  });

  it("lets numbers stand for text, but not text for numbers", () => {
    expect(fitsType("text", "BIGINT")).toBe(true);
    expect(fitsType("number", "VARCHAR")).toBe(false);
    expect(fitsType("temporal", "VARCHAR")).toBe(false);
    expect(fitsType("any", "BOOLEAN")).toBe(true);
  });
});

describe("autoMap", () => {
  it("maps to the sample table when it's loaded", () => {
    expect(autoMap(downtime, [mine, sample])).toEqual({
      stops: {
        table: "machine_stops",
        columns: { machine: "machine", minutes: "minutes", started_at: "started_at" },
      },
    });
  });

  it("matches a user's columns by label and alias, whatever their case and separators", () => {
    expect(autoMap(downtime, [mine])).toEqual({
      stops: { table: "my stops", columns: { machine: "Asset ID", minutes: "Minutes Down" } },
    });
  });

  it("picks the table that matches the most columns", () => {
    const other: CatalogTable = { name: "other", columns: [{ name: "minutes", type: "INTEGER" }] };
    expect(autoMap(downtime, [other, mine]).stops?.table).toBe("my stops");
  });

  it("leaves a table unmapped when nothing matches", () => {
    const unrelated: CatalogTable = { name: "x", columns: [{ name: "a", type: "INTEGER" }] };
    expect(autoMap(downtime, [unrelated])).toEqual({});
  });
});

describe("mappingProblems", () => {
  it("finds none in a complete mapping", () => {
    expect(mappingProblems(downtime, autoMap(downtime, [sample]), [sample])).toEqual([]);
  });

  it("asks for a table and for required columns, but not optional ones", () => {
    expect(mappingProblems(downtime, {}, [mine])).toEqual([
      { table: "stops", message: "Choose a table for Stops." },
    ]);
    expect(
      mappingProblems(downtime, { stops: { table: "my stops", columns: {} } }, [mine]),
    ).toEqual([
      { table: "stops", column: "machine", message: "Choose a column for Machine." },
      { table: "stops", column: "minutes", message: "Choose a column for Minutes down." },
    ]);
  });

  it("reports type mismatches and names that aren't there", () => {
    const mapping = {
      stops: {
        table: "my stops",
        columns: { machine: "Asset ID", minutes: "Notes", started_at: "gone" },
      },
    };
    expect(mappingProblems(downtime, mapping, [mine])).toEqual([
      {
        table: "stops",
        column: "minutes",
        message: "Minutes down needs a number column; Notes is VARCHAR.",
      },
      { table: "stops", column: "started_at", message: "my stops has no column named gone." },
    ]);
    expect(mappingProblems(downtime, { stops: { table: "gone", columns: {} } }, [mine])).toEqual([
      { table: "stops", message: "There's no table named gone." },
    ]);
  });
});

describe("renderTemplate", () => {
  it("quotes the user's names and the parameters, and reads an unmapped optional column as NULL", () => {
    const mapping = {
      stops: { table: 'my "stops"', columns: { machine: "Asset ID", minutes: "Minutes Down" } },
    };
    expect(renderTemplate(downtime, mapping, { reason: "it's late", min: "7.5" })).toBe(
      `-- Downtime by machine
SELECT "Asset ID", NULL, 'it''s late'
FROM "my ""stops""" WHERE "Minutes Down" >= 7.5
`,
    );
  });

  it("takes a parameter's default when it's not given", () => {
    expect(renderTemplate(downtime, autoMap(downtime, [sample]))).toContain(`'all'`);
    expect(renderTemplate(downtime, autoMap(downtime, [sample]))).toContain(">= 5");
  });

  it("rejects a number parameter that isn't a number", () => {
    const mapping = autoMap(downtime, [sample]);
    for (const min of ["", "1; DROP TABLE x", "NaN"]) {
      expect(() => renderTemplate(downtime, mapping, { min })).toThrow(
        "Minimum minutes must be a number.",
      );
    }
  });

  it("throws for an unmapped table or required column", () => {
    expect(() => renderTemplate(downtime, {})).toThrow("Choose a table for Stops.");
    expect(() =>
      renderTemplate(downtime, { stops: { table: "machine_stops", columns: {} } }),
    ).toThrow("Choose a column for Machine.");
  });
});

describe("templates", () => {
  it("collects the library, each with a unique id and its sample's columns declared", () => {
    expect(templates.length).toBeGreaterThan(0);
    expect(new Set(templates.map(({ id }) => id)).size).toBe(templates.length);
    for (const template of templates) {
      expect(template.tables.length).toBeGreaterThan(0);
    }
  });
});
