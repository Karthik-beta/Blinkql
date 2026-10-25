import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportFileName, exportResult } from "./export";

const engine = vi.hoisted(() => ({
  exportQuery: vi.fn(
    async (_sql: string, _format: "csv" | "parquet") => new Uint8Array([97, 44, 98]),
  ),
}));
vi.mock("@/engine/engine", () => engine);

describe("export", () => {
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    clicked = [];
    // jsdom has no object URLs and doesn't follow links.
    URL.createObjectURL = vi.fn(() => "blob:export");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("names the file after the time of the export", () => {
    expect(exportFileName("csv", new Date(2026, 9, 25, 9, 5, 3))).toBe(
      "blinkql-result-2026-10-25-090503.csv",
    );
    expect(exportFileName("parquet", new Date(2026, 0, 2, 23, 59, 0))).toBe(
      "blinkql-result-2026-01-02-235900.parquet",
    );
  });

  it("exports the query's result without its final semicolon and downloads it", async () => {
    const name = await exportResult("SELECT 1 AS a; -- done\n", "csv");

    expect(engine.exportQuery).toHaveBeenCalledWith("SELECT 1 AS a", "csv");
    expect(name).toMatch(/^blinkql-result-\d{4}-\d{2}-\d{2}-\d{6}\.csv$/);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe(name);
    expect(clicked[0]?.href).toBe("blob:export");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("text/csv");
    expect(await blob.text()).toBe("a,b");
  });

  it("downloads nothing when the export fails", async () => {
    engine.exportQuery.mockRejectedValueOnce(new Error("no such table"));

    await expect(exportResult("SELECT * FROM nope", "parquet")).rejects.toThrow("no such table");
    expect(clicked).toEqual([]);
  });
});
