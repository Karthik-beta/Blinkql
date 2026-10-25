// What a chart's data says, in words: the end of its accessible name, for screen reader users who
// can't see the canvas.
import type { ChartData } from "./ChartPanel";
import { type ColumnKind, SCATTER_POINTS } from "./chart-sql";

const formatNumber = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format;

/** A chart value as text: a number to four digits, a time axis value as a UTC date and time. */
export function formatValue(value: string | number | null, kind: ColumnKind): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return value;
  if (kind === "temporal") {
    return new Date(value)
      .toISOString()
      .replace(/T00:00:00\.000Z$/, "")
      .replace("T", " ")
      .replace(/\.000Z$/, "");
  }
  return formatNumber(value);
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** The indexes of the smallest and largest of `values`, NULLs aside. */
function extremes(values: (number | null)[]): { min: number; max: number } | null {
  let min = -1;
  let max = -1;
  values.forEach((value, i) => {
    if (value === null) return;
    if (min < 0 || value < (values[min] as number)) min = i;
    if (max < 0 || value > (values[max] as number)) max = i;
  });
  return min < 0 ? null : { min, max };
}

/** A short summary of `data`'s points: "7 bars, highest 0.51 (3), lowest 0.49 (5)". */
export function chartSummary({ spec, rows }: Pick<ChartData, "spec" | "rows">): string {
  const n = rows.x.length;
  if (n === 0) return "no data";
  const y = extremes(rows.y);
  const yValue = (i: number) => formatValue(rows.y[i] ?? null, "number");
  const xValue = (i: number) => formatValue(rows.x[i] ?? null, spec.x.kind);
  switch (spec.type) {
    case "bar":
      return y
        ? `${count(n, "bar")}, highest ${yValue(y.max)} (${xValue(y.max)}), lowest ${yValue(y.min)} (${xValue(y.min)})`
        : count(n, "bar");
    case "line": {
      const x = extremes(rows.x as (number | null)[]);
      const xRange = x ? `, x from ${xValue(x.min)} to ${xValue(x.max)}` : "";
      const yRange = y ? `, y from ${yValue(y.min)} to ${yValue(y.max)}` : "";
      return `${count(n, "point")}${xRange}${yRange}`;
    }
    case "scatter":
      return n >= SCATTER_POINTS ? `${count(n, "point")}, a random sample` : count(n, "point");
    case "histogram": {
      if (!y) return count(n, "bin");
      const bin = `${xValue(y.max)}–${formatValue(rows.xEnd[y.max] ?? null, spec.x.kind)}`;
      return `${count(n, "bin")}, fullest ${bin} with ${count(rows.y[y.max] ?? 0, "row")}`;
    }
    case "pareto": {
      const categories = count(n, "category", "categories");
      const within = rows.cumulative.findIndex((pct) => pct !== null && pct >= 80);
      if (within >= 0)
        return `${categories}, ${within + 1} ${within === 0 ? "makes" : "make"} up 80% of rows`;
      const total = rows.cumulative[n - 1] ?? 0;
      return `${categories}, together ${formatNumber(total)}% of rows`;
    }
  }
}
