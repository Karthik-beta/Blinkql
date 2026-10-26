// @vitest-environment node
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { Bool, DateDay, Float64, Int32, TimestampMillisecond, Utf8 } from "apache-arrow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BAR_LIMIT,
  type ChartSpec,
  chartLabel,
  chartSql,
  columnKind,
  downsampling,
  HISTOGRAM_BINS,
  LINE_POINTS,
  lineSeriesSql,
  RAW_LINE_POINTS,
  SCATTER_POINTS,
} from "./chart-sql";

// 10,000 readings from 7 machines, a day apart, with some temperatures missing.
const SOURCE = `SELECT
  'm' || (range % 7) AS machine,
  range AS n,
  CASE WHEN range % 10 = 0 THEN NULL ELSE (range % 100) / 2 END AS temperature,
  TIMESTAMP '2026-01-01' + to_seconds(range * 60) AS at,
  DATE '2026-01-01' + CAST(range % 365 AS INTEGER) AS day
FROM range(10000);`;

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
});

afterAll(() => {
  connection.closeSync();
});

async function rows(spec: ChartSpec, source = SOURCE) {
  const reader = await connection.runAndReadAll(chartSql(source, spec));
  return { columns: reader.columnNames(), rows: reader.getRowObjectsJS() };
}

describe("columnKind", () => {
  it("tells numbers, dates and times, and everything else apart", () => {
    expect(columnKind(new Int32())).toBe("number");
    expect(columnKind(new Float64())).toBe("number");
    expect(columnKind(new TimestampMillisecond())).toBe("temporal");
    expect(columnKind(new DateDay())).toBe("temporal");
    expect(columnKind(new Utf8())).toBe("other");
    expect(columnKind(new Bool())).toBe("other");
  });
});

describe("chartLabel", () => {
  it("describes each chart by its type, measure and columns", () => {
    const x = { name: "machine", kind: "other" } as const;
    const y = { name: "temperature", kind: "number" } as const;
    expect(chartLabel({ type: "bar", x, y, aggregate: "avg" })).toBe(
      "Bar chart of avg(temperature) by machine",
    );
    expect(chartLabel({ type: "bar", x, y: null, aggregate: "count" })).toBe(
      "Bar chart of count(*) by machine",
    );
    expect(chartLabel({ type: "line", x, y, aggregate: "max" })).toBe(
      "Line chart of max(temperature) by machine",
    );
    expect(chartLabel({ type: "scatter", x, y, aggregate: "count" })).toBe(
      "Scatter chart of temperature by machine",
    );
    expect(chartLabel({ type: "histogram", x: y, y: null, aggregate: "count" })).toBe(
      "Histogram of temperature",
    );
    expect(chartLabel({ type: "pareto", x, y: null, aggregate: "sum" })).toBe(
      "Pareto chart of count(*) by machine",
    );
    expect(chartLabel({ type: "pareto", x, y, aggregate: "sum" })).toBe(
      "Pareto chart of sum(temperature) by machine",
    );
    expect(chartLabel({ type: "pareto", x, y, aggregate: "avg" })).toBe(
      "Pareto chart of count(*) by machine",
    );
  });
});

describe("chartSql", () => {
  it("quotes column names and copes with a trailing semicolon and comment", async () => {
    const source = `SELECT 1 AS "odd ""name""", 2 AS v; -- the last line is a comment`;
    const { rows: result } = await rows(
      { type: "bar", x: { name: 'odd "name"', kind: "number" }, y: null, aggregate: "count" },
      source,
    );
    expect(result).toEqual([{ x: "1", y: 1 }]);
  });

  describe("bar", () => {
    it("aggregates y per category, largest first", async () => {
      const result = await rows({
        type: "bar",
        x: { name: "machine", kind: "other" },
        y: { name: "temperature", kind: "number" },
        aggregate: "sum",
      });
      expect(result.columns).toEqual(["x", "y"]);
      expect(result.rows).toHaveLength(7);
      const sums = result.rows.map((r) => r.y as number);
      expect(sums).toEqual([...sums].sort((a, b) => b - a));
      expect(typeof result.rows[0]?.x).toBe("string");
    });

    it("counts rows when there's no y", async () => {
      const { rows: result } = await rows({
        type: "bar",
        x: { name: "machine", kind: "other" },
        y: null,
        aggregate: "count",
      });
      expect(result.reduce((total, r) => total + (r.y as number), 0)).toBe(10000);
    });

    it(`keeps the ${BAR_LIMIT} largest categories`, async () => {
      const { rows: result } = await rows({
        type: "bar",
        x: { name: "n", kind: "number" },
        y: { name: "n", kind: "number" },
        aggregate: "max",
      });
      expect(result).toHaveLength(BAR_LIMIT);
      expect(result[0]).toEqual({ x: "9999", y: 9999 });
    });

    it.each(["count", "sum", "avg", "min", "max"] as const)("runs with %s", async (aggregate) => {
      const { rows: result } = await rows({
        type: "bar",
        x: { name: "day", kind: "temporal" },
        y: { name: "temperature", kind: "number" },
        aggregate,
      });
      expect(result).toHaveLength(BAR_LIMIT);
    });
  });

  describe("line", () => {
    it(`buckets a timestamp into at most ${LINE_POINTS} points, in order`, async () => {
      const result = await rows({
        type: "line",
        x: { name: "at", kind: "temporal" },
        y: { name: "temperature", kind: "number" },
        aggregate: "avg",
      });
      expect(result.columns).toEqual(["x", "y"]);
      expect(result.rows.length).toBeGreaterThan(LINE_POINTS / 2);
      expect(result.rows.length).toBeLessThanOrEqual(LINE_POINTS);
      const xs = result.rows.map((r) => r.x as number);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      // Milliseconds since 1970, starting at the first reading.
      expect(xs[0]).toBe(Date.UTC(2026, 0, 1));
    });

    it("buckets a date", async () => {
      const { rows: result } = await rows({
        type: "line",
        x: { name: "day", kind: "temporal" },
        y: null,
        aggregate: "count",
      });
      expect(result.length).toBeLessThanOrEqual(365);
      expect(result.reduce((total, r) => total + (r.y as number), 0)).toBe(10000);
    });

    it("buckets a number", async () => {
      const { rows: result } = await rows({
        type: "line",
        x: { name: "n", kind: "number" },
        y: { name: "n", kind: "number" },
        aggregate: "min",
      });
      expect(result).toHaveLength(LINE_POINTS);
      expect(result[0]).toEqual({ x: 0, y: 0 });
      expect(result.at(-1)?.x).toBeLessThan(9999);
    });

    it("gives one point when x never changes", async () => {
      const { rows: result } = await rows(
        { type: "line", x: { name: "x", kind: "number" }, y: null, aggregate: "count" },
        "SELECT 5 AS x FROM range(3)",
      );
      expect(result).toEqual([{ x: 5, y: 3 }]);
    });
  });

  describe("scatter", () => {
    it(`samples at most ${SCATTER_POINTS} points with both values`, async () => {
      const result = await rows({
        type: "scatter",
        x: { name: "n", kind: "number" },
        y: { name: "temperature", kind: "number" },
        aggregate: "count",
      });
      expect(result.columns).toEqual(["x", "y"]);
      expect(result.rows).toHaveLength(SCATTER_POINTS);
      expect(result.rows.every((r) => typeof r.x === "number" && typeof r.y === "number")).toBe(
        true,
      );
    });

    it("plots a timestamp as milliseconds since 1970", async () => {
      const { rows: result } = await rows(
        {
          type: "scatter",
          x: { name: "at", kind: "temporal" },
          y: { name: "v", kind: "number" },
          aggregate: "count",
        },
        "SELECT TIMESTAMP '2026-01-01' AS at, 1 AS v",
      );
      expect(result).toEqual([{ x: Date.UTC(2026, 0, 1), y: 1 }]);
    });
  });

  describe("histogram", () => {
    it(`counts values in ${HISTOGRAM_BINS} equal bins`, async () => {
      const result = await rows({
        type: "histogram",
        x: { name: "n", kind: "number" },
        y: null,
        aggregate: "count",
      });
      expect(result.columns).toEqual(["x", "x_end", "y"]);
      expect(result.rows).toHaveLength(HISTOGRAM_BINS);
      expect(result.rows[0]?.x).toBe(0);
      expect(result.rows.at(-1)?.x_end).toBe(9999);
      expect(result.rows.reduce((total, r) => total + (r.y as number), 0)).toBe(10000);
    });

    it("leaves out missing values", async () => {
      const { rows: result } = await rows({
        type: "histogram",
        x: { name: "temperature", kind: "number" },
        y: null,
        aggregate: "count",
      });
      expect(result.reduce((total, r) => total + (r.y as number), 0)).toBe(9000);
    });

    it("puts every value in one bin when they're all the same", async () => {
      const { rows: result } = await rows(
        { type: "histogram", x: { name: "x", kind: "number" }, y: null, aggregate: "count" },
        "SELECT 5 AS x FROM range(3)",
      );
      expect(result).toEqual([{ x: 5, x_end: 5, y: 3 }]);
    });
  });

  describe("pareto", () => {
    it("counts per category, largest first, with the running percentage of the total", async () => {
      const result = await rows(
        { type: "pareto", x: { name: "cause", kind: "other" }, y: null, aggregate: "sum" },
        `SELECT unnest(['jam', 'jam', 'jam', 'heat', 'heat', 'stop', NULL]) AS cause`,
      );
      expect(result.columns).toEqual(["x", "y", "cumulative_pct"]);
      expect(result.rows.map(({ x, y }) => [x, y])).toEqual([
        ["jam", 3],
        ["heat", 2],
        ["NULL", 1],
        ["stop", 1],
      ]);
      const percentages = result.rows.map((r) => r.cumulative_pct as number);
      [3, 5, 6, 7].forEach((count, i) => {
        expect(percentages[i]).toBeCloseTo((count / 7) * 100);
      });
    });

    it("sums y per category, with the running percentage of the total sum", async () => {
      const result = await rows(
        {
          type: "pareto",
          x: { name: "cause", kind: "other" },
          y: { name: "minutes", kind: "number" },
          aggregate: "sum",
        },
        `SELECT * FROM (VALUES ('jam', 5), ('heat', 30), ('jam', 10), ('stop', 5)) t(cause, minutes)`,
      );
      expect(result.rows).toEqual([
        { x: "heat", y: 30, cumulative_pct: 60 },
        { x: "jam", y: 15, cumulative_pct: 90 },
        { x: "stop", y: 5, cumulative_pct: 100 },
      ]);
    });

    it(`keeps the ${BAR_LIMIT} largest categories, as a share of every row`, async () => {
      const { rows: result } = await rows({
        type: "pareto",
        x: { name: "n", kind: "number" },
        y: null,
        aggregate: "count",
      });
      expect(result).toHaveLength(BAR_LIMIT);
      expect(result.at(-1)?.cumulative_pct).toBeCloseTo((BAR_LIMIT / 10000) * 100);
    });
  });
});

describe("downsampling", () => {
  it("is done in SQL unless the URL asks for the client", () => {
    expect(downsampling("")).toBe("sql");
    expect(downsampling("?downsample=sql")).toBe("sql");
    expect(downsampling("?downsample=nonsense")).toBe("sql");
    expect(downsampling("?a=1&downsample=client")).toBe("client");
  });
});

describe("lineSeriesSql", () => {
  const spec: ChartSpec = {
    type: "line",
    x: { name: "at", kind: "temporal" },
    y: { name: "temperature", kind: "number" },
    aggregate: "avg",
  };

  it("returns every row's x and y in order of x, leaving out rows missing either", async () => {
    const reader = await connection.runAndReadAll(lineSeriesSql(SOURCE, spec));
    expect(reader.columnNames()).toEqual(["x", "y"]);
    const result = reader.getRowObjectsJS();
    // Every tenth temperature is missing.
    expect(result).toHaveLength(9000);
    expect(result[0]).toEqual({ x: Date.UTC(2026, 0, 1, 0, 1), y: 0.5 });
    const xs = result.map((r) => r.x as number);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  // Reads a million rows into Node, which can take longer than the default 5 s on a busy machine.
  it(`returns at most ${RAW_LINE_POINTS.toLocaleString("en")} rows`, {
    timeout: 30_000,
  }, async () => {
    const reader = await connection.runAndReadAll(
      lineSeriesSql(`SELECT range AS at, 1 AS temperature FROM range(${RAW_LINE_POINTS + 5})`, {
        ...spec,
        x: { name: "at", kind: "number" },
      }),
    );
    expect(reader.currentRowCount).toBe(RAW_LINE_POINTS);
  });
});
