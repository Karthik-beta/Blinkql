import { describe, expect, it } from "vitest";
import { DuckDBDialect } from "./language";

/** The node names lang-sql gives each word of `sql`, which decide how it's highlighted. */
function tokens(sql: string): Record<string, string> {
  const tree = DuckDBDialect.language.parser.parse(sql);
  const names: Record<string, string> = {};
  tree.iterate({
    enter(node) {
      if (node.node.firstChild) return;
      names[sql.slice(node.from, node.to)] = node.name;
    },
  });
  return names;
}

describe("DuckDB dialect", () => {
  it("knows DuckDB's keywords, types and functions", () => {
    expect(
      tokens(
        "SELECT read_csv, list_aggr, epoch_ms, 42::HUGEINT, true FROM t ASOF JOIN u QUALIFY x",
      ),
    ).toMatchObject({
      SELECT: "Keyword",
      ASOF: "Keyword",
      QUALIFY: "Keyword",
      read_csv: "Builtin",
      list_aggr: "Builtin",
      epoch_ms: "Builtin",
      HUGEINT: "Type",
      true: "Bool",
      "42": "Number",
      t: "Identifier",
    });
  });

  it("keeps UNION a keyword, although it's also a type", () => {
    expect(tokens("SELECT 1 UNION SELECT 2")).toMatchObject({ UNION: "Keyword" });
  });

  it("reads $$dollar-quoted$$ text as a string and // as division", () => {
    expect(tokens("SELECT $$it's$$, 7 // 2")).toMatchObject({
      "$$it's$$": "String",
      "2": "Number",
    });
  });
});
