// A chart of the last query's result. Its points are computed by the engine (chart-sql.ts) and
// drawn by ECharts, which loads the first time a chart is drawn.
import type { Table } from "apache-arrow";
import {
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { query } from "@/engine/engine";
import { download, exportFileName } from "@/features/results/export";
import { getQueryRun, subscribeToQueryRun } from "@/features/results/query-run";
import { getResult, subscribeToResult } from "@/features/results/result-store";
import { getChartPreset, subscribeToChartPreset } from "./chart-preset";
import { type ChartPicture, setShownChart, setShownChartPicture } from "./chart-settings";
import {
  type Aggregate,
  type ChartColumn,
  type ChartSpec,
  type ChartType,
  chartLabel,
  chartSql,
  columnKind,
  downsampling,
  LINE_POINTS,
  lineSeriesSql,
  measureName,
} from "./chart-sql";
import { chartSummary, formatValue } from "./chart-summary";
import { lttb } from "./lttb";

/** A chart's points, as its query returned them (see chartSql). */
export type ChartData = {
  spec: ChartSpec;
  /** The chart's accessible name: what it shows, then a summary of its data. */
  label: string;
  rows: {
    x: (string | number | null)[];
    y: (number | null)[];
    xEnd: (number | null)[];
    cumulative: (number | null)[];
  };
  /** When the spec was chosen (a `performance.now()` time), for the chart-render measure. */
  startedAt: number;
};

/** Read once: switching strategy means reloading the page with another `?downsample=`. */
const DOWNSAMPLING = downsampling(location.search);

/** Whether `spec` is a line chart whose points are fetched one per row and reduced here. */
function downsamplesHere(spec: ChartSpec): boolean {
  return (
    DOWNSAMPLING === "client" &&
    spec.type === "line" &&
    spec.y !== null &&
    spec.aggregate !== "count"
  );
}

/** `spec`'s chart, from the engine's query and, when it downsamples here, LTTB. */
async function chartRows(source: string, spec: ChartSpec): Promise<ChartData["rows"]> {
  if (downsamplesHere(spec)) {
    const table = await query(lineSeriesSql(source, spec));
    const { x, y } = lttb(
      table.getChild("x")?.toArray() ?? [],
      table.getChild("y")?.toArray() ?? [],
      LINE_POINTS,
    );
    return { x, y, xEnd: [], cumulative: [] };
  }
  const table = await query(chartSql(source, spec));
  return {
    x: column(table, "x"),
    y: column(table, "y"),
    xEnd: column(table, "x_end"),
    cumulative: column(table, "cumulative_pct"),
  };
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "scatter", label: "Scatter" },
  { value: "histogram", label: "Histogram" },
  { value: "pareto", label: "Pareto" },
];
const AGGREGATES: Aggregate[] = ["count", "sum", "avg", "min", "max"];
/** A running percentage only adds up for counts and sums. */
const PARETO_AGGREGATES: Aggregate[] = ["count", "sum"];

const selectClass = "h-7 rounded-md border border-input bg-background px-1.5 text-xs";

/**
 * The chart drawn in `container` in both themes, described by `label`, for a report to show the
 * one for its reader's colours; null when none is drawn there.
 */
async function pictureOf(
  container: HTMLElement | null,
  label: string,
): Promise<ChartPicture | null> {
  if (!container) return null;
  const { chartPng } = await import("./draw-chart");
  const light = chartPng(container, "light");
  const dark = chartPng(container, "dark");
  return light && dark ? { light, dark, description: label } : null;
}

function column<T>(table: Table, name: string): T[] {
  return Array.from(table.getChild(name) ?? []) as T[];
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function ChartCanvas({ data, ref }: { data: ChartData; ref: RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    let cleanUp: (() => void) | undefined;
    let removed = false;
    void import("./draw-chart").then(({ drawChart }) => {
      if (!removed && ref.current) cleanUp = drawChart(ref.current, data);
    });
    return () => {
      removed = true;
      cleanUp?.();
    };
  }, [data, ref]);
  return <div ref={ref} className="min-h-0 flex-1" />;
}

/** The chart's points as a table, for those who can't see the canvas. */
function ChartTable({ data: { spec, rows } }: { data: ChartData }) {
  const headers = [spec.x.name, spec.type === "scatter" ? (spec.y?.name ?? "") : measureName(spec)];
  if (spec.type === "pareto") headers.push("Cumulative %");
  const x = (i: number) =>
    spec.type === "histogram"
      ? `${formatValue(rows.x[i] ?? null, "number")}–${formatValue(rows.xEnd[i] ?? null, "number")}`
      : formatValue(rows.x[i] ?? null, spec.x.kind);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus so the keyboard can scroll it.
    <div tabIndex={0} className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">{chartLabel(spec)}</caption>
        <thead className="sticky top-0 bg-chrome">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="border-b px-3 py-1 text-left font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.x.map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the rows never reorder.
            <tr key={i} className="border-b">
              <td className="px-3 py-0.5">{x(i)}</td>
              <td className="px-3 py-0.5">{formatValue(rows.y[i] ?? null, "number")}</td>
              {spec.type === "pareto" && (
                <td className="px-3 py-0.5">{formatValue(rows.cumulative[i] ?? null, "number")}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartPanel() {
  const result = useSyncExternalStore(subscribeToResult, getResult);
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const [type, setType] = useState<ChartType>("bar");
  const [xName, setXName] = useState("");
  const [yName, setYName] = useState("");
  const [aggregate, setAggregate] = useState<Aggregate>("count");
  const [chart, setChart] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  const preset = useSyncExternalStore(subscribeToChartPreset, getChartPreset);
  const runSql = run.state === "idle" ? null : run.sql;

  // A preset applies only to the result of its own query.
  useEffect(() => {
    if (!preset || preset.sql !== runSql) return;
    setType(preset.type);
    setXName(preset.x);
    setYName(preset.y ?? "");
    setAggregate(preset.aggregate ?? (preset.y ? "sum" : "count"));
  }, [preset, runSql]);

  const resultColumns = result?.columns;
  const columns: ChartColumn[] = useMemo(
    () => resultColumns?.map(({ name, type }) => ({ name, kind: columnKind(type) })) ?? [],
    [resultColumns],
  );
  // Line and scatter charts need an x they can place on an axis; a histogram, a number.
  const xOptions = columns.filter(({ kind }) =>
    type === "histogram"
      ? kind === "number"
      : type === "line" || type === "scatter"
        ? kind !== "other"
        : true,
  );
  const yOptions = columns.filter(({ kind }) => kind === "number");
  // Bar and Pareto charts count categories, so they start on a text column if there is one.
  const categorical = type === "bar" || type === "pareto";
  const x =
    xOptions.find(({ name }) => name === xName) ??
    (categorical ? xOptions.find(({ kind }) => kind === "other") : undefined) ??
    xOptions[0];
  const y = yOptions.find(({ name }) => name === yName) ?? yOptions[0];
  const aggregates = type === "pareto" ? PARETO_AGGREGATES : AGGREGATES;
  const usesAggregate = type === "bar" || type === "line" || type === "pareto";
  const shownAggregate = usesAggregate && aggregates.includes(aggregate) ? aggregate : "count";
  const usesY = type === "scatter" || shownAggregate !== "count";

  const spec: ChartSpec | null =
    x && (!usesY || y)
      ? { type, x, y: usesY ? (y ?? null) : null, aggregate: shownAggregate }
      : null;
  const source = run.state === "done" ? run.sql : null;
  const specKey = JSON.stringify(spec);

  // biome-ignore lint/correctness/useExhaustiveDependencies: specKey stands for spec, a new object on every render.
  useEffect(() => {
    if (!source || !spec) {
      setChart(null);
      return;
    }
    let current = true;
    const startedAt = performance.now();
    chartRows(source, spec).then(
      (rows) => {
        if (!current) return;
        setError(null);
        setChart({
          spec,
          label: `${chartLabel(spec)}, ${chartSummary({ spec, rows })}`,
          rows,
          startedAt,
        });
      },
      (failure: unknown) => {
        if (!current) return;
        setChart(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [source, specKey]);

  // Kept for share links, which carry the settings of the chart on screen, and for reports,
  // which picture it.
  useEffect(() => {
    if (!chart) return;
    const { type, x, y, aggregate } = chart.spec;
    setShownChart({ type, x: x.name, ...(y && { y: y.name }), aggregate });
    setShownChartPicture(() => pictureOf(canvas.current, chart.label));
    return () => {
      setShownChart(null);
      setShownChartPicture(null);
    };
  }, [chart]);

  const columnOptions = (options: ChartColumn[]) =>
    options.map(({ name }) => ({ value: name, label: name }));

  return (
    <section aria-label="Chart" className="flex min-h-0 flex-1 flex-col border-t">
      <div className="flex flex-wrap items-center gap-3 border-b bg-chrome px-3 py-1.5 text-xs">
        <Select
          label="Chart type"
          value={type}
          options={CHART_TYPES}
          onChange={(value) => setType(value as ChartType)}
        />
        <Select
          label="X"
          value={x?.name ?? ""}
          options={columnOptions(xOptions)}
          onChange={setXName}
        />
        {usesAggregate && (
          <Select
            label="Aggregate"
            value={shownAggregate}
            options={aggregates.map((value) => ({ value, label: value }))}
            onChange={(value) => setAggregate(value as Aggregate)}
          />
        )}
        {usesY && (
          <Select
            label="Y"
            value={y?.name ?? ""}
            options={columnOptions(yOptions)}
            onChange={setYName}
          />
        )}
        <Button
          variant={showTable ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={showTable}
          onClick={() => setShowTable(!showTable)}
        >
          View as table
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!chart || showTable}
          onClick={async () => {
            const { chartPng } = await import("./draw-chart");
            const png = canvas.current && chartPng(canvas.current);
            if (png) download(png, exportFileName("png", new Date(), "chart"));
          }}
        >
          Export PNG
        </Button>
      </div>
      {/* The canvas's name changes silently; this says what a new setting drew. */}
      <p aria-live="polite" className="sr-only">
        {chart?.label}
      </p>
      {error ? (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error}
        </p>
      ) : !source ? (
        <p className="p-3 text-xs text-muted-foreground">Run a query to chart its result.</p>
      ) : !spec ? (
        <p className="p-3 text-xs text-muted-foreground">
          The result has no column this chart can use.
        </p>
      ) : (
        chart &&
        (showTable ? <ChartTable data={chart} /> : <ChartCanvas data={chart} ref={canvas} />)
      )}
    </section>
  );
}
