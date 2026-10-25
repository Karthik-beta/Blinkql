import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCatalog,
  importFiles,
  importUrl,
  profileSql,
  reimportTables,
  resetCatalog,
} from "./catalog";
import { NO_CORS_MESSAGE, NO_RANGE_WARNING } from "./remote";

// The engine is replaced by a fake that "describes" every view as having three columns.
const engine = vi.hoisted(() => ({
  query: vi.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith("DESCRIBE")) {
      return {
        toArray: () =>
          ["a", "b", "c"].map((column_name) => ({ column_name, column_type: "BIGINT" })),
      };
    }
    return {};
  }),
  registerFile: vi.fn(async (_name: string, _file: File) => {}),
  registerUrl: vi.fn(async (_name: string, _url: string) => {}),
  unregisterFile: vi.fn(async (_name: string) => {}),
}));
vi.mock("@/engine/engine", () => engine);

// Remote servers answer the first-byte check with a range unless a test says otherwise.
const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("P", { status: 206 }));
vi.stubGlobal("fetch", fetch);

const csv = (name: string) => new File(["a,b,c\n1,2,3\n"], name);
const remote = new URL("https://example.com/data/Orders.parquet?token=abc");

describe("catalog", () => {
  afterEach(() => {
    resetCatalog();
    vi.clearAllMocks();
  });

  it("registers each file and creates a view named after it", async () => {
    const file = csv("Orders.csv");
    await importFiles([file]);

    expect(engine.registerFile).toHaveBeenCalledWith("orders.csv", file);
    expect(engine.query).toHaveBeenCalledWith(
      `CREATE VIEW "orders" AS SELECT * FROM read_csv('orders.csv')`,
    );
    expect(getCatalog().tables).toEqual([
      {
        name: "orders",
        fileName: "Orders.csv",
        format: "csv",
        columns: [
          { name: "a", type: "BIGINT" },
          { name: "b", type: "BIGINT" },
          { name: "c", type: "BIGINT" },
        ],
        source: file,
      },
    ]);
    expect(getCatalog().importing).toEqual([]);
  });

  it("gives files with the same name separate tables, even when imported at once", async () => {
    await Promise.all([importFiles([csv("data.csv")]), importFiles([csv("data.csv")])]);

    expect(
      getCatalog()
        .tables.map((table) => table.name)
        .sort(),
    ).toEqual(["data", "data_2"]);
  });

  it("shows which files are being imported", async () => {
    const importing = importFiles([csv("a.csv"), csv("b.csv")]);

    expect(getCatalog().importing).toEqual(["a.csv", "b.csv"]);
    await importing;
    expect(getCatalog().importing).toEqual([]);
  });

  it("reports unsupported files without touching the engine", async () => {
    await importFiles([new File(["hi"], "notes.txt")]);

    expect(engine.registerFile).not.toHaveBeenCalled();
    expect(getCatalog().failures).toEqual([
      { fileName: "notes.txt", message: "Not a CSV, TSV, Parquet, JSON or JSON Lines file" },
    ]);
  });

  it.each([
    [
      JSON.stringify({
        exception_type: "Invalid Input",
        exception_message: "File 'broken.parquet' too small to be a Parquet file",
        position: "38",
      }),
      "File 'broken.parquet' too small to be a Parquet file",
    ],
    ["not a Parquet file", "not a Parquet file"],
    ["Invalid Input Error: not a Parquet file", "Invalid Input Error: not a Parquet file"],
  ])("reports a readable import failure for %s", async (message, expected) => {
    engine.query.mockRejectedValueOnce(new Error(message));

    await importFiles([new File(["nope"], "broken.parquet")]);

    expect(getCatalog().failures).toEqual([{ fileName: "broken.parquet", message: expected }]);
    expect(getCatalog().importing).toEqual([]);
    expect(getCatalog().tables).toEqual([]);
  });

  it("preserves failures that aren't Error objects", async () => {
    engine.registerFile.mockRejectedValueOnce("storage unavailable");

    await importFiles([csv("data.csv")]);

    expect(getCatalog().failures).toEqual([
      { fileName: "data.csv", message: "storage unavailable" },
    ]);
  });

  it("cleans up after a file the engine can't read, and frees its name", async () => {
    engine.query.mockRejectedValueOnce(new Error("Invalid Input Error: not a Parquet file"));

    await importFiles([new File(["nope"], "broken.parquet"), csv("broken.csv")]);

    expect(engine.query).toHaveBeenCalledWith('DROP VIEW IF EXISTS "broken"');
    expect(engine.unregisterFile).toHaveBeenCalledWith("broken.parquet");
    expect(getCatalog().failures).toEqual([
      { fileName: "broken.parquet", message: "Invalid Input Error: not a Parquet file" },
    ]);
    // The failed file's name went back into the pool.
    expect(getCatalog().tables.map((table) => table.name)).toEqual(["broken"]);
  });

  it("clears old failures when a new import starts", async () => {
    await importFiles([new File(["hi"], "notes.txt")]);
    await importFiles([csv("ok.csv")]);

    expect(getCatalog().failures).toEqual([]);
  });

  it("imports every file again, in order, so tables keep their names", async () => {
    const first = csv("data.csv");
    const second = csv("data.csv");
    await importFiles([first, second]);
    engine.registerFile.mockClear();

    await reimportTables();

    expect(engine.registerFile.mock.calls).toEqual([
      ["data.csv", first],
      ["data_2.csv", second],
    ]);
    expect(getCatalog().tables.map((table) => table.name)).toEqual(["data", "data_2"]);
  });

  it("reads a remote file by URL into a view named after it", async () => {
    await importUrl(remote);

    expect(fetch).toHaveBeenCalledWith(remote, { headers: { Range: "bytes=0-0" } });
    expect(engine.registerUrl).toHaveBeenCalledWith("orders.parquet", remote.href);
    expect(engine.query).toHaveBeenCalledWith(
      `CREATE VIEW "orders" AS SELECT * FROM read_parquet('orders.parquet')`,
    );
    expect(getCatalog().tables).toEqual([
      expect.objectContaining({
        name: "orders",
        fileName: remote.href,
        format: "parquet",
        source: remote,
      }),
    ]);
    expect(getCatalog().failures).toEqual([]);
    expect(getCatalog().warnings).toEqual([]);
  });

  it("warns when a remote server can't send part of a file", async () => {
    fetch.mockResolvedValueOnce(new Response("the whole file", { status: 200 }));

    await importUrl(remote);

    expect(getCatalog().tables.map((table) => table.name)).toEqual(["orders"]);
    expect(getCatalog().warnings).toEqual([{ fileName: remote.href, message: NO_RANGE_WARNING }]);
  });

  it("explains a remote file it can't read, without touching the engine", async () => {
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await importUrl(remote);

    expect(engine.registerUrl).not.toHaveBeenCalled();
    expect(getCatalog().failures).toEqual([{ fileName: remote.href, message: NO_CORS_MESSAGE }]);
    expect(getCatalog().tables).toEqual([]);
  });

  it("explains the engine's failed range requests in plain words", async () => {
    engine.query.mockRejectedValueOnce(
      new Error(
        JSON.stringify({
          exception_type: "IO",
          exception_message: `Range request for ${remote.href} did returned non-success status: 403`,
        }),
      ),
    );

    await importUrl(remote);

    expect(getCatalog().failures).toEqual([
      { fileName: remote.href, message: "The server answered 403." },
    ]);
  });

  it("reports a remote file in a format it can't read", async () => {
    await importUrl(new URL("https://example.com/report.pdf"));

    expect(fetch).not.toHaveBeenCalled();
    expect(getCatalog().failures).toEqual([
      {
        fileName: "https://example.com/report.pdf",
        message: "Not a CSV, TSV, Parquet, JSON or JSON Lines file",
      },
    ]);
  });

  it("reads local and remote files again, in order", async () => {
    const file = csv("orders.csv");
    await importFiles([file]);
    await importUrl(remote);
    engine.registerFile.mockClear();
    engine.registerUrl.mockClear();

    await reimportTables();

    expect(engine.registerFile.mock.calls).toEqual([["orders.csv", file]]);
    expect(engine.registerUrl.mock.calls).toEqual([["orders_2.parquet", remote.href]]);
    expect(getCatalog().tables.map((table) => table.name)).toEqual(["orders", "orders_2"]);
  });

  it("profiles a table with SUMMARIZE, quoting its name", () => {
    expect(profileSql("orders")).toBe('SUMMARIZE "orders"');
    expect(profileSql('odd "name"')).toBe('SUMMARIZE "odd ""name"""');
  });
});
