import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSample, samples } from "./samples";

const engine = vi.hoisted(() => ({
  exportQuery: vi.fn(async (_sql: string, _format: string) => new Uint8Array(4)),
}));
vi.mock("@/engine/engine", () => engine);
const catalog = vi.hoisted(() => {
  const catalog = {
    tables: [] as { name: string }[],
    failures: [] as { fileName: string; message: string }[],
    getCatalog: vi.fn(() => ({ tables: catalog.tables, failures: catalog.failures })),
    importFiles: vi.fn(async (files: readonly File[]) => {
      for (const file of files) catalog.tables.push({ name: file.name.replace(/\.parquet$/, "") });
    }),
  };
  return catalog;
});
vi.mock("@/features/catalog/catalog", () => catalog);

describe("loadSample", () => {
  afterEach(() => {
    catalog.tables = [];
    catalog.failures = [];
    vi.clearAllMocks();
  });

  it("writes the sample as Parquet and imports it as a file named after it", async () => {
    await loadSample("breakdowns");

    const sample = samples.find((other) => other.name === "breakdowns");
    expect(engine.exportQuery).toHaveBeenCalledWith(sample?.sql, "parquet");
    const [[files]] = catalog.importFiles.mock.calls as [[File[]]];
    expect(files.map((file) => [file.name, file.size])).toEqual([["breakdowns.parquet", 4]]);
  });

  it("doesn't load a sample twice", async () => {
    await Promise.all([loadSample("plants"), loadSample("plants")]);
    expect(catalog.importFiles).toHaveBeenCalledTimes(1);

    catalog.tables = [{ name: "plants" }];
    await loadSample("plants");
    expect(catalog.importFiles).toHaveBeenCalledTimes(1);
  });

  it("resolves a second call only once the first has added the table", async () => {
    let finishImport = () => {};
    catalog.importFiles.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishImport = () => {
            catalog.tables.push({ name: "shipments" });
            resolve();
          };
        }),
    );
    const first = loadSample("shipments");
    let secondSettled = false;
    const second = loadSample("shipments").finally(() => {
      secondSettled = true;
    });

    await vi.waitFor(() => expect(catalog.importFiles).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve));
    expect(secondSettled).toBe(false);

    finishImport();
    await Promise.all([first, second]);
    expect(catalog.tables).toEqual([{ name: "shipments" }]);
  });

  it("rejects a second call when the load it waits for fails", async () => {
    engine.exportQuery.mockRejectedValueOnce(new Error("Out of memory"));
    const results = await Promise.allSettled([loadSample("plants"), loadSample("plants")]);
    expect(results).toEqual([
      { status: "rejected", reason: new Error("Out of memory") },
      { status: "rejected", reason: new Error("Out of memory") },
    ]);
  });

  it("rejects with the import's failure when the file wasn't imported", async () => {
    catalog.importFiles.mockImplementationOnce(async (files: readonly File[]) => {
      catalog.failures = files.map(({ name }) => ({
        fileName: name,
        message: "Invalid Parquet file",
      }));
    });
    await expect(loadSample("plants")).rejects.toThrow("Invalid Parquet file");

    await loadSample("plants");
    expect(catalog.tables).toEqual([{ name: "plants" }]);
  });

  it("rejects a name that isn't a sample", async () => {
    await expect(loadSample("nope")).rejects.toThrow("No sample called nope");
    expect(engine.exportQuery).not.toHaveBeenCalled();
  });

  it("rejects when the engine can't build the sample", async () => {
    engine.exportQuery.mockRejectedValueOnce(new Error("Out of memory"));
    await expect(loadSample("plants")).rejects.toThrow("Out of memory");
    expect(catalog.importFiles).not.toHaveBeenCalled();
  });
});
