// Draws a chart with ECharts on a canvas. Loaded only when the first chart is drawn, so ECharts
// isn't part of the workbench's first load: it imports only the charts and components used.
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { type EChartsCoreOption, init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { afterNextPaint, measureSince, measures } from "@/lib/user-timing";
import type { ChartData } from "./ChartPanel";

use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

type Colours = { ink: string; muted: string; gridline: string; first: string; second: string };

/**
 * The design tokens' colours, as the canvas draws them. The tokens are oklch(), which ECharts
 * can't parse to shade them, so each is drawn on a pixel and read back as rgb().
 */
function readColours(): Colours {
  const style = getComputedStyle(document.documentElement);
  const context = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const rgb = (token: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = style.getPropertyValue(token).trim() || "gray";
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    ink: rgb("--data-ink"),
    muted: rgb("--muted-foreground"),
    gridline: rgb("--gridline"),
    first: rgb("--chart-1"),
    second: rgb("--chart-2"),
  };
}

const formatNumber = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format;

function option({ spec, rows }: ChartData, colours: Colours): EChartsCoreOption {
  const axisStyle = {
    axisLine: { lineStyle: { color: colours.muted } },
    axisLabel: { color: colours.ink, hideOverlap: true },
    splitLine: { lineStyle: { color: colours.gridline } },
  };
  const valueX = { type: spec.x.kind === "temporal" ? "time" : "value", scale: true, ...axisStyle };
  const common = {
    animation: false,
    color: [colours.first, colours.second],
    grid: { left: 16, right: 16, top: 24, bottom: 16, containLabel: true },
    tooltip: { trigger: spec.type === "scatter" ? "item" : "axis" },
    yAxis: { type: "value", ...axisStyle },
  };
  const pairs = rows.x.map((x, i) => [x, rows.y[i]]);
  switch (spec.type) {
    case "bar":
      return {
        ...common,
        xAxis: { type: "category", data: rows.x, ...axisStyle },
        series: [{ type: "bar", data: rows.y }],
      };
    case "line":
      return {
        ...common,
        xAxis: valueX,
        series: [{ type: "line", data: pairs, showSymbol: false }],
      };
    case "scatter":
      return {
        ...common,
        xAxis: valueX,
        yAxis: { ...common.yAxis, scale: true },
        series: [{ type: "scatter", data: pairs, symbolSize: 4, large: true }],
      };
    case "histogram":
      return {
        ...common,
        xAxis: {
          type: "category",
          data: rows.x.map(
            (x, i) => `${formatNumber(Number(x))}–${formatNumber(rows.xEnd[i] ?? 0)}`,
          ),
          ...axisStyle,
        },
        series: [{ type: "bar", data: rows.y, barCategoryGap: 1 }],
      };
    case "pareto":
      return {
        ...common,
        xAxis: { type: "category", data: rows.x, ...axisStyle },
        yAxis: [
          common.yAxis,
          { type: "value", max: 100, axisLabel: { color: colours.ink, formatter: "{value}%" } },
        ],
        series: [
          { type: "bar", data: rows.y },
          { type: "line", data: rows.cumulative, yAxisIndex: 1, showSymbol: false },
        ],
      };
  }
}

/** Draws `data` in `container`, redrawing it as it resizes and the theme changes. Returns a cleanup. */
export function drawChart(container: HTMLElement, data: ChartData): () => void {
  const chart = init(container, null, { renderer: "canvas" });
  const draw = () => {
    chart.setOption(option(data, readColours()), true);
    const canvas = container.querySelector("canvas");
    canvas?.setAttribute("role", "img");
    canvas?.setAttribute("aria-label", data.label);
  };
  draw();
  const cancelMeasure = afterNextPaint(() => measureSince(measures.chartRender, data.startedAt));
  const resize = new ResizeObserver(() => chart.resize());
  resize.observe(container);
  // The theme is a class on the root element (theme-init.js).
  const theme = new MutationObserver(draw);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    cancelMeasure();
    resize.disconnect();
    theme.disconnect();
    chart.dispose();
  };
}
