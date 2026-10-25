// The SQL behind each chart. A chart aggregates, buckets or samples the last query's result in the
// engine, so however many rows that result has, the chart receives at most a few thousand points.
import { DataType } from "apache-arrow";

export type ChartType = "bar" | "line" | "scatter" | "histogram" | "pareto";
export type Aggregate = "count" | "sum" | "avg" | "min" | "max";
/** How a column can be charted: as a number, on a time axis, or only as a category. */
export type ColumnKind = "number" | "temporal" | "other";
export type ChartColumn = { name: string; kind: ColumnKind };

export type ChartSpec = {
  type: ChartType;
  x: ChartColumn;
  /** What's aggregated (bar, line) or plotted against x (scatter); unused by the others. */
  y: ChartColumn | null;
  /** How y is aggregated per category or bucket; count counts rows and needs no y. */
  aggregate: Aggregate;
};

/** The most categories a bar or Pareto chart shows: the largest ones. */
export const BAR_LIMIT = 50;
/** The most points a line chart shows. */
export const LINE_POINTS = 1000;
/** The most points a scatter chart shows, sampled at random. */
export const SCATTER_POINTS = 5000;
export const HISTOGRAM_BINS = 30;

export function columnKind(type: DataType): ColumnKind {
  if (DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)) return "number";
  if (DataType.isTimestamp(type) || DataType.isDate(type)) return "temporal";
  return "other";
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A column as a DOUBLE: a date or time as milliseconds since 1970, which a time axis reads. */
function numeric(column: ChartColumn): string {
  return column.kind === "temporal"
    ? `CAST(epoch_ms(CAST(${quote(column.name)} AS TIMESTAMP)) AS DOUBLE)`
    : `CAST(${quote(column.name)} AS DOUBLE)`;
}

/** A column as category labels, NULL included. */
function category(column: ChartColumn): string {
  return `coalesce(CAST(${quote(column.name)} AS VARCHAR), 'NULL')`;
}

function counts(spec: ChartSpec): boolean {
  return spec.aggregate === "count" || !spec.y;
}

/** The aggregate of `value` (y, already selected), as a DOUBLE, so sums of integers stay small. */
function measure(spec: ChartSpec, value: string): string {
  return counts(spec) ? "CAST(count(*) AS DOUBLE)" : `CAST(${spec.aggregate}(${value}) AS DOUBLE)`;
}

/** The measure's name, as in "avg(temperature)". */
export function measureName(spec: ChartSpec): string {
  return counts(spec) || !spec.y ? "count(*)" : `${spec.aggregate}(${spec.y.name})`;
}

/** What the chart shows, for its accessible name: "Bar chart of avg(temperature) by machine". */
export function chartLabel(spec: ChartSpec): string {
  const x = spec.x.name;
  switch (spec.type) {
    case "bar":
      return `Bar chart of ${measureName(spec)} by ${x}`;
    case "line":
      return `Line chart of ${measureName(spec)} by ${x}`;
    case "scatter":
      return `Scatter chart of ${spec.y?.name ?? ""} by ${x}`;
    case "histogram":
      return `Histogram of ${x}`;
    case "pareto":
      return `Pareto chart of count(*) by ${x}`;
  }
}

/**
 * The query that computes `spec`'s chart from the result of `source`. Its columns are x and y,
 * plus x_end (where each histogram bin ends) and cumulative_pct (Pareto). x is text for bar and
 * Pareto charts and a DOUBLE for the others; y is always a DOUBLE.
 */
export function chartSql(source: string, spec: ChartSpec): string {
  // The source becomes a subquery: without its final semicolon, and on lines of its own, so a
  // comment on its last line doesn't swallow the closing parenthesis.
  const from = `FROM (\n${source.trim().replace(/;(\s|--[^\n]*)*$/, "")}\n) AS source`;
  const y = spec.y ? quote(spec.y.name) : "NULL";
  switch (spec.type) {
    case "bar":
      return `SELECT ${category(spec.x)} AS x, ${measure(spec, y)} AS y
${from}
GROUP BY 1
ORDER BY 2 DESC NULLS LAST, 1
LIMIT ${BAR_LIMIT}`;
    case "line":
      // LINE_POINTS buckets of equal width between the smallest and largest x; when every x is
      // the same there's one.
      return `WITH points AS (
  SELECT ${numeric(spec.x)} AS x, ${y} AS y ${from} WHERE ${quote(spec.x.name)} IS NOT NULL
), bounds AS (
  SELECT min(x) AS lo, (max(x) - min(x)) / ${LINE_POINTS} AS width FROM points
), buckets AS (
  SELECT coalesce(least(floor((x - lo) / nullif(width, 0)), ${LINE_POINTS - 1}), 0) AS bucket, lo, width, y
  FROM points, bounds
)
SELECT any_value(lo) + bucket * coalesce(any_value(width), 0) AS x, ${measure(spec, "y")} AS y
FROM buckets
GROUP BY bucket
ORDER BY bucket`;
    case "scatter":
      if (!spec.y) throw new Error("A scatter chart needs a y column");
      return `SELECT x, y FROM (
  SELECT ${numeric(spec.x)} AS x, ${numeric(spec.y)} AS y
  ${from}
  WHERE ${quote(spec.x.name)} IS NOT NULL AND ${y} IS NOT NULL
) USING SAMPLE reservoir(${SCATTER_POINTS} ROWS) REPEATABLE (42)`;
    case "histogram":
      return `WITH points AS (
  SELECT ${numeric(spec.x)} AS x ${from} WHERE ${quote(spec.x.name)} IS NOT NULL
), bounds AS (
  SELECT min(x) AS lo, max(x) - min(x) AS span FROM points
), bins AS (
  SELECT coalesce(least(floor((x - lo) * ${HISTOGRAM_BINS} / nullif(span, 0)), ${HISTOGRAM_BINS - 1}), 0) AS bin, lo, span
  FROM points, bounds
)
SELECT
  any_value(lo) + bin * any_value(span) / ${HISTOGRAM_BINS} AS x,
  any_value(lo) + (bin + 1) * any_value(span) / ${HISTOGRAM_BINS} AS x_end,
  CAST(count(*) AS DOUBLE) AS y
FROM bins
GROUP BY bin
ORDER BY bin`;
    case "pareto":
      // The running percentage is of every row, not only of the categories shown.
      return `WITH counts AS (
  SELECT ${category(spec.x)} AS x, CAST(count(*) AS DOUBLE) AS y ${from} GROUP BY 1
)
SELECT x, y, 100 * sum(y) OVER (ORDER BY y DESC, x ROWS UNBOUNDED PRECEDING) / sum(y) OVER () AS cumulative_pct
FROM counts
ORDER BY y DESC, x
LIMIT ${BAR_LIMIT}`;
  }
}
