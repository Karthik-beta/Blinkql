import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importFiles, resetCatalog } from "@/features/catalog/catalog";
import { DuckDBDialect, duckdbSql } from "./language";

// The engine is replaced by a fake that "describes" every view as having two columns.
const engine = vi.hoisted(() => ({
  query: vi.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith("DESCRIBE")) {
      return {
        toArray: () => [
          { column_name: "id", column_type: "BIGINT" },
          { column_name: "amount", column_type: "DOUBLE" },
        ],
      };
    }
    return {};
  }),
  registerFile: vi.fn(async (_name: string, _file: File) => {}),
  unregisterFile: vi.fn(async (_name: string) => {}),
}));
vi.mock("@/engine/engine", () => engine);

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

describe("DuckDB autocomplete", () => {
  afterEach(() => resetCatalog());

  /** What Ctrl+Space offers at the `|` in `doc`: each option's label and detail. */
  async function complete(doc: string): Promise<Map<string, string | undefined>> {
    const pos = doc.indexOf("|");
    const state = EditorState.create({ doc: doc.replace("|", ""), extensions: duckdbSql() });
    const context = new CompletionContext(state, pos, true);
    const options = new Map<string, string | undefined>();
    for (const source of state.languageDataAt<CompletionSource>("autocomplete", pos)) {
      const result = await source(context);
      for (const option of result?.options ?? []) options.set(option.label, option.detail);
    }
    return options;
  }

  const importOrders = () => importFiles([new File(["id,amount\n1,2.5\n"], "orders.csv")]);

  it("completes imported tables, and keeps up as files are imported", async () => {
    expect((await complete("SELECT * FROM |")).has("orders")).toBe(false);
    await importOrders();
    expect((await complete("SELECT * FROM |")).has("orders")).toBe(true);
  });

  it("completes a table's columns", async () => {
    await importOrders();
    expect([...(await complete("SELECT orders.| FROM orders")).keys()]).toEqual(["id", "amount"]);
  });

  it.each(["SELECT o.| FROM orders o", "SELECT o.| FROM orders AS o"])(
    "completes an aliased table's columns: %s",
    async (doc) => {
      await importOrders();
      expect([...(await complete(doc)).keys()]).toEqual(["id", "amount"]);
    },
  );

  it("shows a DuckDB function's signature", async () => {
    const options = await complete("SELECT date_tr|");
    expect(options.get("date_trunc")).toMatch(/^date_trunc\(part, timestamp\)/);
  });
});
