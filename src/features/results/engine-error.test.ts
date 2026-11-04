import { describe, expect, it } from "vitest";
import { EngineCrashedError } from "@/engine/errors";
import {
  describeError,
  type EngineError,
  errorSpan,
  lineAt,
  parseEngineError,
} from "./engine-error";

// Real errors from DuckDB-wasm 1.4 with errors_as_json on.
const errors = {
  syntax: `Parser Error: {"exception_type":"Parser","exception_message":"syntax error at or near \\"SELEC\\"","error_subtype":"SYNTAX_ERROR","position":"0"}`,
  endOfInput: `Parser Error: {"exception_type":"Parser","exception_message":"syntax error at end of input","error_subtype":"SYNTAX_ERROR","position":"28"}`,
  missingTable: `{"exception_type":"Catalog","exception_message":"Table with name machnes does not exist!\\nDid you mean \\"machines\\"?","name":"machnes","position":"14","type":"Table","error_subtype":"MISSING_ENTRY","candidates":"machines"}`,
  missingColumn: `{"exception_type":"Binder","exception_message":"Referenced column \\"machine_nam\\" not found in FROM clause!\\nCandidate bindings: \\"machine_name\\", \\"id\\"","name":"machine_nam","position":"7","error_subtype":"COLUMN_NOT_FOUND","candidates":"machine_name,id"}`,
  noMatchingFunction: `{"exception_type":"Binder","exception_message":"No function matches the given name and argument types 'sum(VARCHAR)'. You might need to add explicit type casts.\\n\\tCandidate functions:\\n\\tsum(DECIMAL) -> DECIMAL\\n","call":"sum(VARCHAR)","schema":"main","candidates":"sum(DECIMAL) -> DECIMAL,sum(DOUBLE) -> DOUBLE","catalog":"system","name":"sum","error_subtype":"NO_MATCHING_FUNCTION","position":"7"}`,
  ambiguousTypes: `{"exception_type":"Binder","exception_message":"Could not choose a best candidate function for the function call \\"+(INTEGER_LITERAL, STRING_LITERAL)\\". In order to select one, please add explicit type casts.\\n\\tCandidate functions:\\n\\t+(INTEGER, DATE) -> DATE\\n","position":"9"}`,
  conversion: `{"exception_type":"Conversion","exception_message":"Could not convert string 'a' to INT32","position":"10"}`,
  outOfMemory: `{"exception_type":"Out of Memory","exception_message":"Allocation failure"}`,
  missingFile: `{"exception_type":"IO","exception_message":"No files found that match the pattern \\"nope.csv\\"","position":"14"}`,
  missingSheet: `{"exception_type":"Binder","exception_message":"Sheet \\"Line\\" not found in xlsx file \\"machines.xlsx\\"\\nDid you mean: \\"Lines\\""}`,
  workbookCell: `{"exception_type":"Invalid Input","exception_message":"read_xlsx: Failed to parse cell 'B3': Could not convert string 'n/a' to DOUBLE"}`,
  subquery: `{"exception_type":"Invalid Input","exception_message":"More than one row returned by a subquery used as an expression - scalar subqueries can only return a single row.\\n\\nUse \\"SET scalar_subquery_error_on_multiple_rows=false\\" to revert to previous behavior of returning a random row."}`,
};

const parse = (message: string, sql = "") => parseEngineError(new Error(message), sql);
const describe_ = (message: string, sql = "") => describeError(parse(message, sql));

describe("parseEngineError", () => {
  it("reads DuckDB's JSON errors, with or without a prefix", () => {
    expect(parse(errors.missingTable, "SELECT * FROM machnes")).toEqual({
      type: "Catalog",
      subtype: "MISSING_ENTRY",
      message: 'Table with name machnes does not exist!\nDid you mean "machines"?',
      position: 14,
      name: "machnes",
      entryType: "Table",
      candidates: ["machines"],
      call: undefined,
      crashed: false,
    });
    expect(parse(errors.syntax, "SELEC 1")).toMatchObject({
      type: "Parser",
      subtype: "SYNTAX_ERROR",
      position: 0,
    });
  });

  it("turns DuckDB's byte positions into string positions", () => {
    // DuckDB counts UTF-8 bytes: "é€😀" is 9 bytes but 4 UTF-16 code units.
    const sql = "SELECT 'é€😀', * FROM machnes";
    const json = errors.missingTable.replace('"position":"14"', '"position":"27"');
    const { position } = parse(json, sql);
    expect(sql.slice(position)).toBe("machnes");
  });

  it("leaves out DuckDB's own tables, which it suggests when nothing else is close", () => {
    const json = errors.missingTable.replace(
      '"candidates":"machines"',
      '"candidates":"duckdb_indexes,sqlite_master,machine_log"',
    );
    expect(parse(json).candidates).toEqual(["machine_log"]);
  });

  it("keeps function signatures whole instead of splitting them on commas", () => {
    expect(parse(errors.noMatchingFunction)).toMatchObject({
      name: "sum",
      call: "sum(VARCHAR)",
      candidates: [],
    });
  });

  it("falls back to DuckDB's text errors", () => {
    expect(parse("Catalog Error: Table with name x does not exist!")).toMatchObject({
      type: "Catalog",
      message: "Table with name x does not exist!",
      candidates: [],
    });
  });

  it("keeps errors that aren't DuckDB's as they are", () => {
    expect(parse("Failed to fetch")).toMatchObject({ type: "Engine", message: "Failed to fetch" });
  });

  it("recognises an engine crash", () => {
    const error = parseEngineError(new EngineCrashedError("unreachable"), "SELECT 1");
    expect(error).toMatchObject({ crashed: true, message: "unreachable" });
  });
});

describe("describeError", () => {
  it("names the token a syntax error is near", () => {
    expect(describe_(errors.syntax)).toEqual({
      title: 'Syntax error near "SELEC"',
      hint: "Check the marked spot for a typo or a missing comma, bracket or quote.",
      label: "Parser error",
    });
  });

  it("says when a query is unfinished", () => {
    expect(describe_(errors.endOfInput).title).toBe("The query ends too soon");
  });

  it("suggests the table DuckDB thinks was meant", () => {
    expect(describe_(errors.missingTable)).toEqual({
      title: 'There\'s no table called "machnes"',
      hint: 'Did you mean "machines"?',
      label: "Catalog error",
    });
  });

  it("points to the table list when there's no suggestion", () => {
    const json = errors.missingTable.replace('"candidates":"machines"', '"candidates":""');
    expect(describe_(json).hint).toBe(
      "Imported files are listed under Tables, with the name to use in SQL.",
    );
  });

  it("suggests a column and lists the others", () => {
    expect(describe_(errors.missingColumn)).toEqual({
      title: 'There\'s no column called "machine_nam"',
      hint: 'Did you mean "machine_name"? Other columns: "id".',
      label: "Binder error",
    });
  });

  it("explains type mismatches with a cast to try", () => {
    expect(describe_(errors.noMatchingFunction)).toMatchObject({
      title: "sum() doesn't accept VARCHAR",
      hint: "Convert the argument to a type it accepts, for example column::DOUBLE.",
    });
    expect(describe_(errors.ambiguousTypes)).toMatchObject({
      title: "The types in this expression don't match",
    });
    expect(describe_(errors.conversion)).toMatchObject({
      title: "Could not convert string 'a' to INT32",
      hint: "Use TRY_CAST instead of CAST to get NULL for values that don't convert.",
    });
  });

  it("suggests doing less in the browser when memory runs out", () => {
    expect(describe_(errors.outOfMemory)).toMatchObject({
      title: "The query ran out of memory",
      label: "Out of Memory error",
    });
  });

  it("recognises the plain-text out-of-memory error too", () => {
    expect(describe_("Out of Memory Error: failed to allocate data of size 256.0 MiB")).toEqual(
      describe_(errors.outOfMemory),
    );
  });

  it("says to import a file before querying it", () => {
    expect(describe_(errors.missingFile).hint).toBe(
      "Import the file first, then query it by its name under Tables.",
    );
  });

  it("suggests the workbook sheet DuckDB thinks was meant", () => {
    expect(describe_(errors.missingSheet)).toEqual({
      title: 'Sheet "Line" not found in xlsx file "machines.xlsx"',
      hint: 'Did you mean "Lines"?',
      label: "Binder error",
    });
  });

  it("names the workbook cell whose text doesn't fit its column's type", () => {
    expect(describe_(errors.workbookCell)).toEqual({
      title: "Cell B3 holds 'n/a', but its column was read as DOUBLE",
      hint:
        "A column's type comes from its first value. Fix the cell in Excel and import the " +
        "workbook again, or read it as text with read_xlsx(…, all_varchar = true).",
      label: "Invalid Input error",
    });
  });

  it("uses the first line of anything else, without a hint", () => {
    expect(describe_(errors.subquery)).toEqual({
      title:
        "More than one row returned by a subquery used as an expression - scalar subqueries can only return a single row.",
      label: "Invalid Input error",
    });
  });

  it("offers a restart after a crash", () => {
    const crash: EngineError = { type: "Engine", message: "x", candidates: [], crashed: true };
    expect(describeError(crash)).toMatchObject({
      title: "The engine stopped",
      label: "Engine crash",
    });
  });
});

describe("errorSpan", () => {
  it("covers the word, number or quoted name at the position", () => {
    const sql = `SELECT "my col", 'a b', 12 FROM machnes`;
    expect(errorSpan(sql, 7)).toEqual({ start: 7, end: 15 });
    expect(errorSpan(sql, 17)).toEqual({ start: 17, end: 22 });
    expect(errorSpan(sql, 24)).toEqual({ start: 24, end: 26 });
    expect(errorSpan(sql, 32)).toEqual({ start: 32, end: 39 });
  });

  it("covers one character of punctuation", () => {
    expect(errorSpan("SELECT 1 +", 9)).toEqual({ start: 9, end: 10 });
  });

  it("covers the last character for an error at the very end", () => {
    expect(errorSpan("SELECT * FROM t WHERE", 21)).toEqual({ start: 20, end: 21 });
  });
});

describe("lineAt", () => {
  it("finds the line, column and line number of a position", () => {
    const sql = "SELECT *\nFROM machnes\nLIMIT 1";
    expect(lineAt(sql, 14)).toEqual({ text: "FROM machnes", column: 5, number: 2 });
    expect(lineAt(sql, 0)).toEqual({ text: "SELECT *", column: 0, number: 1 });
  });
});
