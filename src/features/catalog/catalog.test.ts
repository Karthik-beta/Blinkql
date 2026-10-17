import { afterEach, describe, expect, it, vi } from "vitest";
import { getCatalog, importFiles, reimportTables, resetCatalog } from "./catalog";

// The engine is replaced by a fake that "describes" every view as having three columns.
const engine = vi.hoisted(() => ({
  query: vi.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith("DESCRIBE")) return { numRows: 3 };
    return {};
  }),
  registerFile: vi.fn(async (_name: string, _file: File) => {}),
  unregisterFile: vi.fn(async (_name: string) => {}),
}));
vi.mock("@/engine/engine", () => engine);

const csv = (name: string) => new File(["a,b,c\n1,2,3\n"], name);

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
      { name: "orders", fileName: "Orders.csv", format: "csv", columnCount: 3, file },
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
      { fileName: "notes.txt", message: "Not a CSV, Parquet or JSON file" },
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
});
