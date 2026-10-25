// DuckDB's SQL for CodeMirror: lang-sql's tokenizer with DuckDB's own words (duckdb-words.ts), and
// autocomplete for those words and the imported tables and their columns.
import type { CompletionSource } from "@codemirror/autocomplete";
import { keywordCompletionSource, SQLDialect, schemaCompletionSource } from "@codemirror/lang-sql";
import { LanguageSupport } from "@codemirror/language";
import { type Catalog, getCatalog } from "@/features/catalog/catalog";
import { functions, keywords, signatures, types } from "./duckdb-words";

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

/** Each function's signature, such as `date_trunc(part, timestamp) +3`, by name. */
const signatureOf = new Map(
  signatures
    .trim()
    .split("\n")
    .map((line) => [line.slice(0, line.indexOf("(")), line]),
);

/** Keywords, types and functions. A function shows its signature next to its name. */
const completeWords = keywordCompletionSource(DuckDBDialect, false, (label, type) => {
  const signature = signatureOf.get(label);
  return signature ? { label, type: "function", detail: signature } : { label, type };
});

/** Tables and their columns, also after a table's alias. Rebuilt when the catalog changes. */
let schema: { catalog: Catalog; complete: CompletionSource } | null = null;
const completeSchema: CompletionSource = (context) => {
  const catalog = getCatalog();
  if (schema?.catalog !== catalog) {
    const tables = catalog.tables.map((table) => [
      table.name,
      table.columns.map((column) => ({
        label: column.name,
        type: "property",
        detail: column.type,
      })),
    ]);
    schema = {
      catalog,
      complete: schemaCompletionSource({
        dialect: DuckDBDialect,
        schema: Object.fromEntries(tables),
      }),
    };
  }
  return schema.complete(context);
};

export function duckdbSql() {
  return new LanguageSupport(DuckDBDialect.language, [
    DuckDBDialect.language.data.of({ autocomplete: completeSchema }),
    DuckDBDialect.language.data.of({ autocomplete: completeWords }),
  ]);
}
