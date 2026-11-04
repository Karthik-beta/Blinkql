import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
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

  /**
   * Runs `f` while `Date.now` reads `now`. The parser stops when its time is up, so this decides
   * how far it gets.
   */
  async function withClock<T>(now: () => number, f: () => T | Promise<T>): Promise<T> {
    const clock = vi.spyOn(Date, "now").mockImplementation(now);
    try {
      return await f();
    } finally {
      clock.mockRestore();
    }
  }

  /** An editor's state with `doc`, less its `|`. */
  const stateOf = (doc: string) =>
    EditorState.create({ doc: doc.replace("|", ""), extensions: duckdbSql() });

  /** What Ctrl+Space offers in `state` at the `|` in `doc`: each option's label and detail. */
  async function optionsAt(doc: string, state: EditorState) {
    const pos = doc.indexOf("|");
    const context = new CompletionContext(state, pos, true);
    const options = new Map<string, string | undefined>();
    for (const source of state.languageDataAt<CompletionSource>("autocomplete", pos)) {
      const result = await source(context);
      for (const option of result?.options ?? []) options.set(option.label, option.detail);
    }
    return options;
  }

  /**
   * What Ctrl+Space offers at the `|` in `doc`. The clock stands still meanwhile, so the parser
   * never runs out of time, however busy the machine is.
   */
  function complete(doc: string) {
    const time = Date.now();
    return withClock(
      () => time,
      () => optionsAt(doc, stateOf(doc)),
    );
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

  it("completes an aliased table's columns before the parser has reached the alias", async () => {
    await importOrders();
    // A new state gets 20 ms of parsing. A clock that jumps a second each time it's read stops
    // the parser after the first word, as a slow device can. Then the clock stands still.
    const doc = "SELECT o.| FROM orders AS o";
    let time = Date.now();
    const state = await withClock(
      () => (time += 1000),
      () => stateOf(doc),
    );
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length);
    const options = await withClock(
      () => time,
      () => optionsAt(doc, state),
    );
    expect([...options.keys()]).toEqual(["id", "amount"]);
  });

  it("parses for at most 50 ms in all for a completion", async () => {
    await importOrders();
    // A new state parses only the first 3000 characters. Then each step of the parser moves the
    // clock on a millisecond, so the rest takes far longer than 50 ms.
    const columns = Array.from({ length: 1000 }, (_, i) => `o.column_${i}`).join(", ");
    const doc = `SELECT o.|, ${columns} FROM orders AS o`;
    let time = 0;
    const state = await withClock(
      () => time,
      () => stateOf(doc),
    );
    await withClock(
      () => ++time,
      () => optionsAt(doc, state),
    );
    expect(time).toBeLessThanOrEqual(52);
  });

  it("shows a DuckDB function's signature", async () => {
    const options = await complete("SELECT date_tr|");
    expect(options.get("date_trunc")).toMatch(/^date_trunc\(part, timestamp\)/);
  });
});
