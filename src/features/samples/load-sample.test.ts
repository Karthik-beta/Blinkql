import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSample, samples } from "./samples";

const engine = vi.hoisted(() => ({
  exportQuery: vi.fn(async (_sql: string, _format: string) => new Uint8Array(4)),
}));
vi.mock("@/engine/engine", () => engine);
const catalog = vi.hoisted(() => ({
  tables: [] as { name: string }[],
  getCatalog: vi.fn(() => ({ tables: catalog.tables })),
  importFiles: vi.fn(async (_files: readonly File[]) => {}),
}));
vi.mock("@/features/catalog/catalog", () => catalog);

describe("loadSample", () => {
  afterEach(() => {
    catalog.tables = [];
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
