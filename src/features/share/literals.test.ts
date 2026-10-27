import { describe, expect, it } from "vitest";
import { literalValues } from "./literals";

describe("literalValues", () => {
  it("lists string and number literals in order, once each", () => {
    expect(
      literalValues(
        "SELECT * FROM orders WHERE customer = 'Acme' AND total > 1250.5 OR customer = 'Acme'",
      ),
    ).toEqual(["'Acme'", "1250.5"]);
  });

  it("keeps escaped quotes inside a string", () => {
    expect(literalValues("SELECT 'O''Brien' AS name")).toEqual(["'O''Brien'"]);
  });

  it("finds none in a query of only names", () => {
    expect(literalValues("SELECT machine_id, avg(v) FROM readings GROUP BY 1")).toEqual(["1"]);
    expect(literalValues("SELECT t1.col2, x3 FROM table_2024 AS t1")).toEqual([]);
  });

  it("ignores comments", () => {
    expect(literalValues("-- customer 'Acme', 42\nSELECT a /* 'b' 7 */ FROM t")).toEqual([]);
  });

  it("ignores quoted identifiers", () => {
    expect(literalValues('SELECT "2024 total", "it\'s" FROM "sales 1"')).toEqual([]);
  });

  it("ignores row counts after LIMIT and OFFSET", () => {
    expect(literalValues("SELECT a FROM t LIMIT 10 OFFSET /* skip */ 20")).toEqual([]);
    expect(literalValues("SELECT a FROM t WHERE b = 3 limit 5")).toEqual(["3"]);
  });

  it("reads numbers with exponents and leading points", () => {
    expect(literalValues("SELECT 1e6, .5, 2.5E-3")).toEqual(["1e6", ".5", "2.5E-3"]);
  });

  it("keeps an unterminated string", () => {
    expect(literalValues("SELECT 'open")).toEqual(["'open"]);
  });
});
