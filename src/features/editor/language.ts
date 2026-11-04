// DuckDB's SQL for CodeMirror: lang-sql's tokenizer with DuckDB's own words (duckdb-words.ts), and
// autocomplete for those words and the imported tables and their columns.
import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { keywordCompletionSource, SQLDialect, schemaCompletionSource } from "@codemirror/lang-sql";
import { ensureSyntaxTree, LanguageSupport, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
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

/** Each state the sources completed in, or a copy of it with the whole syntax tree. */
const parsed = new WeakMap<EditorState, EditorState>();

/**
 * lang-sql reads a table's alias, and whether the cursor follows a dot, from the syntax tree. The
 * parser stops when its time is up, so on a slow device or in a long query the tree can end
 * before the FROM clause that names the alias. So parse the rest first, for up to 50 ms, and
 * complete in a state that has the whole tree, as `forceParsing` does for a view. Both sources
 * share that state, so a completion never parses for more than 50 ms in all.
 */
function withWholeTree(source: CompletionSource): CompletionSource {
  return (context) => {
    const { state } = context;
    let whole = parsed.get(state);
    if (!whole) {
      const tree = ensureSyntaxTree(state, state.doc.length, 50);
      whole = tree && tree !== syntaxTree(state) ? state.update({}).state : state;
      parsed.set(state, whole);
    }
    if (whole === state) return source(context);
    return source(new CompletionContext(whole, context.pos, context.explicit, context.view));
  };
}

export function duckdbSql() {
  return new LanguageSupport(DuckDBDialect.language, [
    DuckDBDialect.language.data.of({ autocomplete: withWholeTree(completeSchema) }),
    DuckDBDialect.language.data.of({ autocomplete: withWholeTree(completeWords) }),
  ]);
}
