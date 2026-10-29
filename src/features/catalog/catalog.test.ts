import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertTable,
  forgetTable,
  getCatalog,
  importFiles,
  importUrl,
  profileSql,
  reimportTables,
  resetCatalog,
  restoreDatasets,
} from "./catalog";
import { NO_CORS_MESSAGE, NO_RANGE_WARNING } from "./remote";
import type { StoredDataset } from "./stored-datasets";

// The engine is replaced by a fake that "describes" every view as having three columns and
// "converts" every file to four bytes of Parquet.
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
  exportQuery: vi.fn(async (_sql: string, _format: string) => new Uint8Array(4)),
}));
vi.mock("@/engine/engine", () => engine);

// Remote servers answer the first-byte check with a range unless a test says otherwise.
const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("P", { status: 206 }));
vi.stubGlobal("fetch", fetch);

// The browser's file storage is replaced by one held in memory.
const storage = vi.hoisted(() => {
  const files = new Map<string, File>();
  const datasets = new Map<string, StoredDataset>();
  return {
    files,
    datasets,
    saveDataset: vi.fn(async (meta: StoredDataset, file: File) => {
      datasets.set(meta.name, meta);
      files.set(meta.name, new File([file], meta.name));
    }),
    listDatasets: vi.fn(async () => [...datasets.values()]),
    loadDataset: vi.fn(async (name: string) => {
      const file = files.get(name);
      if (!file) throw new DOMException(name, "NotFoundError");
      return file;
    }),
    removeDataset: vi.fn(async (name: string) => {
      datasets.delete(name);
      files.delete(name);
    }),
  };
});
vi.mock("./stored-datasets", () => storage);

const csv = (name: string) => new File(["a,b,c\n1,2,3\n"], name);
const remote = new URL("https://example.com/data/Orders.parquet?token=abc");

describe("catalog", () => {
  afterEach(() => {
    resetCatalog();
    storage.files.clear();
    storage.datasets.clear();
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
      {
        fileName: "notes.txt",
        message: "Not a CSV, TSV, Excel (.xlsx), Parquet, JSON or JSON Lines file",
      },
    ]);
  });

  it("imports the first sheet of an Excel workbook", async () => {
    await importFiles([new File(["x"], "Plant.xlsx")]);

    expect(engine.registerFile).toHaveBeenCalledWith("plant.xlsx", expect.any(File));
    expect(engine.query).toHaveBeenCalledWith(
      `CREATE VIEW "plant" AS SELECT * FROM read_xlsx('plant.xlsx')`,
    );
    expect(getCatalog().tables.map((table) => table.format)).toEqual(["xlsx"]);
  });

  it("asks for an old .xls workbook to be saved as .xlsx", async () => {
    await importFiles([new File(["x"], "Plant.xls")]);

    expect(engine.registerFile).not.toHaveBeenCalled();
    expect(getCatalog().failures).toEqual([
      {
        fileName: "Plant.xls",
        message: "Excel 97–2003 workbooks (.xls) can't be read. Save it as .xlsx in Excel first.",
      },
    ]);
  });

  it("explains a workbook that isn't a readable .xlsx, such as a password-protected one", async () => {
    engine.query.mockRejectedValueOnce(
      new Error(
        JSON.stringify({
          exception_type: "IO",
          exception_message: "Failed to open zip for reading",
        }),
      ),
    );

    await importFiles([new File(["x"], "locked.xlsx")]);

    expect(getCatalog().failures).toEqual([
      {
        fileName: "locked.xlsx",
        message:
          "The workbook can't be read. It may be password-protected or an older .xls file: " +
          "remove the password or save it as .xlsx in Excel, then import it again.",
      },
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
        message: "Not a CSV, TSV, Excel (.xlsx), Parquet, JSON or JSON Lines file",
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

  it("keeps a copy of each imported file, but not of a remote one", async () => {
    const file = csv("Orders.csv");
    await importFiles([file]);
    await vi.waitFor(() => expect(storage.saveDataset).toHaveBeenCalledOnce());

    expect(storage.saveDataset).toHaveBeenCalledWith(
      {
        name: "orders",
        fileName: "Orders.csv",
        format: "csv",
        size: file.size,
        savedAt: expect.any(Number),
      },
      file,
    );
    expect(getCatalog().storageUnavailable).toBe(false);

    await importUrl(remote);
    expect(getCatalog().tables).toHaveLength(2);
    expect(storage.saveDataset).toHaveBeenCalledOnce();
  });

  it("still shows the table when its file can't be kept, and says so", async () => {
    storage.saveDataset.mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));

    await importFiles([csv("orders.csv")]);

    expect(getCatalog().tables.map((table) => table.name)).toEqual(["orders"]);
    await vi.waitFor(() => expect(getCatalog().storageUnavailable).toBe(true));
    expect(getCatalog().failures).toEqual([]);
  });

  it("doesn't keep another copy when importing again into a restarted engine", async () => {
    await importFiles([csv("orders.csv")]);
    await vi.waitFor(() => expect(storage.saveDataset).toHaveBeenCalledOnce());

    await reimportTables();

    expect(storage.saveDataset).toHaveBeenCalledOnce();
  });

  it("restores kept files under their old names, once", async () => {
    await importFiles([csv("data.csv"), csv("data.csv"), csv("other.csv")]);
    await vi.waitFor(() => expect(storage.saveDataset).toHaveBeenCalledTimes(3));
    await storage.removeDataset("data");
    resetCatalog();
    engine.registerFile.mockClear();

    await Promise.all([restoreDatasets(), restoreDatasets()]);

    expect(getCatalog().tables.map((table) => [table.name, table.fileName])).toEqual([
      ["data_2", "data.csv"],
      ["other", "other.csv"],
    ]);
    expect(engine.registerFile.mock.calls.map(([path]) => path)).toEqual([
      "data_2.csv",
      "other.csv",
    ]);
    expect(storage.saveDataset).toHaveBeenCalledTimes(3);
  });

  it("restores a kept file in its stored format, whatever its original name", async () => {
    storage.datasets.set("orders", {
      name: "orders",
      fileName: "orders.csv",
      format: "parquet",
      size: 1,
      savedAt: 1,
    });
    storage.files.set("orders", new File(["x"], "orders"));

    await restoreDatasets();

    expect(engine.registerFile).toHaveBeenCalledWith("orders.parquet", expect.any(File));
    expect(getCatalog().tables.map((table) => table.format)).toEqual(["parquet"]);
  });

  it("forgets a kept dataset whose file has gone", async () => {
    storage.datasets.set("gone", {
      name: "gone",
      fileName: "gone.csv",
      format: "csv",
      size: 1,
      savedAt: 1,
    });

    await restoreDatasets();

    expect(getCatalog().tables).toEqual([]);
    expect(storage.removeDataset).toHaveBeenCalledWith("gone");
  });

  it("forgets a table: drops its view and file and deletes its copy", async () => {
    await importFiles([csv("orders.csv"), csv("other.csv")]);

    await forgetTable("orders");

    expect(getCatalog().tables.map((table) => table.name)).toEqual(["other"]);
    expect(engine.query).toHaveBeenCalledWith('DROP VIEW IF EXISTS "orders"');
    expect(engine.unregisterFile).toHaveBeenCalledWith("orders.csv");
    expect(storage.removeDataset).toHaveBeenCalledWith("orders");
    // Its name is free again.
    await importFiles([csv("orders.csv")]);
    expect(getCatalog().tables.map((table) => table.name)).toEqual(["other", "orders"]);
  });

  it("doesn't keep a table forgotten while its copy was still being saved", async () => {
    let finishSaving = () => {};
    storage.saveDataset.mockImplementationOnce(async (meta, file) => {
      await new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
      storage.datasets.set(meta.name, meta);
      storage.files.set(meta.name, file);
    });
    await importFiles([csv("orders.csv")]);

    const forgetting = forgetTable("orders");
    await new Promise((resolve) => setTimeout(resolve));
    finishSaving();
    await forgetting;

    expect(storage.datasets.has("orders")).toBe(false);
  });

  it("converts a CSV table to Parquet, read from then on and kept instead of the CSV", async () => {
    await importFiles([csv("Orders.csv")]);
    await vi.waitFor(() => expect(storage.saveDataset).toHaveBeenCalledOnce());

    const converting = convertTable("orders");
    expect(getCatalog().converting).toEqual(["orders"]);
    await converting;

    expect(engine.exportQuery).toHaveBeenCalledWith(
      "SELECT * FROM read_csv('orders.csv')",
      "parquet",
    );
    expect(engine.registerFile).toHaveBeenLastCalledWith("orders.parquet", expect.any(File));
    expect(engine.query).toHaveBeenCalledWith(
      `CREATE OR REPLACE VIEW "orders" AS SELECT * FROM read_parquet('orders.parquet')`,
    );
    expect(engine.unregisterFile).toHaveBeenCalledWith("orders.csv");
    expect(getCatalog().converting).toEqual([]);
    const [table] = getCatalog().tables;
    expect(table).toMatchObject({ name: "orders", fileName: "Orders.csv", format: "parquet" });
    expect(table?.columns).toHaveLength(3);
    expect(table?.source).toBeInstanceOf(File);
    expect(table?.source).toHaveProperty("size", 4);
    await vi.waitFor(() => expect(storage.saveDataset).toHaveBeenCalledTimes(2));
    expect(storage.saveDataset).toHaveBeenLastCalledWith(
      {
        name: "orders",
        fileName: "Orders.csv",
        format: "parquet",
        size: 4,
        savedAt: expect.any(Number),
      },
      table?.source,
    );

    // After a reload, the table comes back from the Parquet copy.
    resetCatalog();
    engine.registerFile.mockClear();
    await restoreDatasets();
    expect(engine.registerFile).toHaveBeenCalledWith("orders.parquet", expect.any(File));
    expect(getCatalog().tables.map((other) => other.format)).toEqual(["parquet"]);
  });

  it("leaves the CSV table as it was when it can't be converted", async () => {
    await importFiles([csv("Orders.csv")]);
    await vi.waitFor(() => expect(storage.saveDataset).toHaveBeenCalledOnce());
    const [table] = getCatalog().tables;
    engine.exportQuery.mockRejectedValueOnce(new Error("Out of Memory Error: could not allocate"));

    await convertTable("orders");

    expect(getCatalog().tables).toEqual([table]);
    expect(getCatalog().converting).toEqual([]);
    expect(getCatalog().failures).toEqual([
      {
        fileName: "Orders.csv",
        message: "Out of Memory Error: could not allocate",
        during: "conversion",
      },
    ]);
    expect(engine.registerFile).not.toHaveBeenCalledWith("orders.parquet", expect.anything());
    expect(engine.unregisterFile).not.toHaveBeenCalled();
    expect(storage.saveDataset).toHaveBeenCalledOnce();
  });

  it("keeps reading the CSV when the Parquet file can't be read", async () => {
    await importFiles([csv("orders.csv")]);
    const [table] = getCatalog().tables;
    engine.query.mockImplementationOnce(async () => {
      throw new Error("Invalid Input Error: not a Parquet file");
    });

    await convertTable("orders");

    expect(engine.unregisterFile.mock.calls).toEqual([["orders.parquet"]]);
    expect(getCatalog().tables).toEqual([table]);
    expect(getCatalog().failures).toEqual([
      {
        fileName: "orders.csv",
        message: "Invalid Input Error: not a Parquet file",
        during: "conversion",
      },
    ]);
  });

  it("only converts local CSV tables", async () => {
    await importFiles([new File(["x"], "orders.parquet")]);
    await importUrl(new URL("https://example.com/events.csv"));

    await convertTable("orders");
    await convertTable("events");

    expect(engine.exportQuery).not.toHaveBeenCalled();
    expect(getCatalog().tables.map((table) => table.format)).toEqual(["parquet", "csv"]);
  });

  it("profiles a table with SUMMARIZE, quoting its name", () => {
    expect(profileSql("orders")).toBe('SUMMARIZE "orders"');
    expect(profileSql('odd "name"')).toBe('SUMMARIZE "odd ""name"""');
  });
});
