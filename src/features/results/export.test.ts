import { Int32, Table, Utf8, vectorFromArray } from "apache-arrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setShownChartPicture } from "@/features/charts/chart-settings";
import { exportFileName, exportReport, exportResult } from "./export";
import { appendRows, clearResult, finishResult, startResult } from "./result-store";

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
    clearResult();
    setShownChartPicture(null);
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

  /** Shows `table` as the result on screen. */
  function show(table: Table): void {
    startResult(table.schema, 0);
    for (const rows of table.batches) appendRows(rows);
    finishResult(0);
  }

  /** The HTML of the report downloaded last. */
  async function downloadedReport(): Promise<string> {
    const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe("text/html");
    return blob.text();
  }

  it("downloads the result on screen as an HTML report, without running the query again", async () => {
    show(
      new Table({
        id: vectorFromArray([1, 2], new Int32()),
        machine: vectorFromArray(["press", null], new Utf8()),
      }),
    );

    const name = await exportReport("SELECT id, machine FROM machines");

    expect(engine.exportQuery).not.toHaveBeenCalled();
    expect(name).toMatch(/^blinkql-report-\d{4}-\d{2}-\d{2}-\d{6}\.html$/);
    expect(clicked[0]?.download).toBe(name);
    const doc = new DOMParser().parseFromString(await downloadedReport(), "text/html");
    expect(doc.querySelector("pre > code")?.textContent).toBe("SELECT id, machine FROM machines");
    expect([...doc.querySelectorAll("th")].map((th) => [th.textContent, th.className])).toEqual([
      ["id", "number"],
      ["machine", ""],
    ]);
    expect(
      [...doc.querySelectorAll("tbody tr")].map((row) =>
        [...row.children].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["1", "press"],
      ["2", "NULL"],
    ]);
    expect(doc.querySelector("img")).toBeNull();
  });

  it("takes only the first 1,000 rows of a larger result", async () => {
    show(
      new Table({
        n: vectorFromArray(
          Array.from({ length: 1_200 }, (_, i) => i),
          new Int32(),
        ),
      }),
    );

    await exportReport("SELECT n FROM t");

    const doc = new DOMParser().parseFromString(await downloadedReport(), "text/html");
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(1_000);
    expect(doc.querySelector("caption")?.textContent).toBe("Result: first 1,000 of 1,200 rows");
  });

  it("includes the chart on screen", async () => {
    show(new Table({ n: vectorFromArray([1], new Int32()) }));
    setShownChartPicture(async () => ({
      light: "data:image/png;base64,AAAA",
      dark: "data:image/png;base64,BBBB",
      description: "Bar chart of count(*) by n, 1 bar",
    }));

    await exportReport("SELECT 1 AS n");

    const doc = new DOMParser().parseFromString(await downloadedReport(), "text/html");
    expect(doc.querySelector("img.light")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(doc.querySelector("img.dark")?.getAttribute("src")).toBe("data:image/png;base64,BBBB");
    expect(doc.querySelector("img")?.getAttribute("alt")).toBe("Bar chart of count(*) by n, 1 bar");
  });
});
