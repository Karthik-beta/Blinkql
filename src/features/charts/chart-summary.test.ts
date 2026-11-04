import { describe, expect, it } from "vitest";
import type { ChartData } from "./ChartPanel";
import type { ChartSpec } from "./chart-sql";
import { chartSummary, formatValue } from "./chart-summary";

const weekday = { name: "weekday", kind: "other" } as const;
const n = { name: "n", kind: "number" } as const;
const v = { name: "v", kind: "number" } as const;
const at = { name: "at", kind: "temporal" } as const;

function data(spec: ChartSpec, rows: Partial<ChartData["rows"]>): Pick<ChartData, "spec" | "rows"> {
  const length = (rows.x ?? rows.y ?? []).length;
  const empty = Array.from({ length }, () => null);
  return {
    spec,
    rows: { x: empty, y: empty, xEnd: empty, cumulative: empty, ...rows },
  };
}

describe("formatValue", () => {
  it("shows numbers to four significant digits", () => {
    expect(formatValue(0.512345, "number")).toBe("0.5123");
    expect(formatValue(3, "number")).toBe("3");
  });

  it("shows a time axis value as a date, with its time when it has one", () => {
    expect(formatValue(Date.UTC(2026, 0, 2), "temporal")).toBe("2026-01-02");
    expect(formatValue(Date.UTC(2026, 0, 2, 13, 5), "temporal")).toBe("2026-01-02 13:05:00");
  });

  it("shows text and NULL as they are", () => {
    expect(formatValue("press", "other")).toBe("press");
    expect(formatValue(null, "number")).toBe("NULL");
  });
});

describe("chartSummary", () => {
  it("summarises a bar chart by its highest and lowest bars", () => {
    const spec: ChartSpec = { type: "bar", x: weekday, y: v, aggregate: "avg" };
    expect(chartSummary(data(spec, { x: ["3", "1", "5"], y: [0.51, 0.5, 0.49] }))).toBe(
      "3 bars, highest 0.51 (3), lowest 0.49 (5)",
    );
  });

  it("summarises a line chart by its points and the range of x and y", () => {
    const spec: ChartSpec = { type: "line", x: n, y: v, aggregate: "sum" };
    expect(chartSummary(data(spec, { x: [0, 10, 20], y: [4, null, 2] }))).toBe(
      "3 points, x from 0 to 20, y from 2 to 4",
    );
  });

  it("shows a line chart's time axis as dates", () => {
    const spec: ChartSpec = { type: "line", x: at, y: null, aggregate: "count" };
    const x = [Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)];
    expect(chartSummary(data(spec, { x, y: [1, 1] }))).toBe(
      "2 points, x from 2026-01-01 to 2026-02-01, y from 1 to 1",
    );
  });

  it("says when a scatter chart's points are a sample", () => {
    const spec: ChartSpec = { type: "scatter", x: n, y: v, aggregate: "count" };
    expect(chartSummary(data(spec, { x: [1, 2], y: [3, 4] }))).toBe("2 points");
    const many = Array.from({ length: 5000 }, (_, i) => i);
    expect(chartSummary(data(spec, { x: many, y: many }))).toBe("5000 points, a random sample");
  });

  it("summarises a histogram by its bins and its fullest bin", () => {
    const spec: ChartSpec = { type: "histogram", x: n, y: null, aggregate: "count" };
    expect(chartSummary(data(spec, { x: [0, 5], xEnd: [5, 10], y: [3, 7] }))).toBe(
      "2 bins, fullest 5–10 with 7 rows",
    );
  });

  it("says how many of a Pareto chart's categories make up 80%", () => {
    const spec: ChartSpec = { type: "pareto", x: weekday, y: null, aggregate: "count" };
    const rows = { x: ["a", "b", "c"], y: [6, 3, 1], cumulative: [60, 90, 100] };
    expect(chartSummary(data(spec, rows))).toBe("3 categories, 2 make up 80% of rows");
    const short = { x: ["a", "b"], y: [2, 2], cumulative: [20, 40] };
    expect(chartSummary(data(spec, short))).toBe("2 categories, together 40% of rows");
  });

  it("uses the singular for one", () => {
    const spec: ChartSpec = { type: "bar", x: weekday, y: null, aggregate: "count" };
    expect(chartSummary(data(spec, { x: ["a"], y: [1] }))).toBe(
      "1 bar, highest 1 (a), lowest 1 (a)",
    );
  });

  it("says when there's no data", () => {
    const spec: ChartSpec = { type: "bar", x: weekday, y: null, aggregate: "count" };
    expect(chartSummary(data(spec, { x: [], y: [] }))).toBe("no data");
  });
});
