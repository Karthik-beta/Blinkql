// DuckDB's SQL for CodeMirror: lang-sql's tokenizer with DuckDB's own words (duckdb-words.ts).
import { SQLDialect, sql } from "@codemirror/lang-sql";
import { functions, keywords, types } from "./duckdb-words";

/** The generated lists are wrapped over several lines; lang-sql wants single spaces. */
const words = (list: string) => list.trim().split(/\s+/).join(" ");

export const DuckDBDialect = SQLDialect.define({
  keywords: words(keywords),
  types: words(types),
  builtin: words(functions),
  // $$dollar-quoted strings$$ are strings. `//` is integer division, so it doesn't start a comment.
  doubleDollarQuotedStrings: true,
  operatorChars: "+-*/<>=~!@#%^&|`?:",
});

export function duckdbSql() {
  return sql({ dialect: DuckDBDialect });
}
