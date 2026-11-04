// Drawing a line chart of a million points (P-10), downsampled two ways: averaged into buckets by
// the engine (the default), or fetched point by point and reduced with LTTB on the main thread
// (`?downsample=client`). No dataset is needed: the query computes its own rows.
import type { Page } from "@playwright/test";
import { measures } from "../../src/lib/user-timing.ts";
import {
  clearLongFrames,
  clearMeasures,
  longestFrame,
  openWorkbench,
  runQuery,
  waitForMeasure,
} from "../harness/page.ts";
import { quantile } from "../harness/stats.ts";
import type { Scenario } from "../harness/types.ts";

const SQL = "SELECT range AS x, sin(range / 1000.0) + random() * 0.1 AS y FROM range(1000000)";
const LINE = "Line chart of avg(y) by x";
/** How long the pointer moves across the chart while frames are sampled. */
const HOVER_MS = 2_000;
/** As in scroll.ts: a frame slower than this missed at least one refresh. */
const SLOW_FRAME_MS = 25;

type HoverSample = { intervals: number[]; running: boolean };

/**
 * Moves the pointer from the chart's left edge to its right for `HOVER_MS`, which moves the
 * tooltip and its axis pointer, and records the time between frames from requestAnimationFrame.
 */
async function sampleHover(page: Page): Promise<number[]> {
  const box = await page.getByRole("img", { name: LINE }).boundingBox();
  if (!box) throw new Error("The chart isn't on screen");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.evaluate(() => {
    const sample: HoverSample = { intervals: [], running: true };
    let last: number | undefined;
    const frame = (now: number) => {
      if (last !== undefined) sample.intervals.push(now - last);
      last = now;
      if (sample.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    Object.assign(window, { blinkqlHover: sample });
  });
  const started = Date.now();
  while (Date.now() - started < HOVER_MS) {
    const progress = (Date.now() - started) / HOVER_MS;
    await page.mouse.move(box.x + 1 + progress * (box.width - 2), y);
    await page.waitForTimeout(10);
  }
  return page.evaluate(() => {
    const sample = (window as { blinkqlHover?: HoverSample }).blinkqlHover;
    if (!sample) throw new Error("No frames were sampled");
    sample.running = false;
    return sample.intervals;
  });
}

function chartLineScenario(downsampling: "sql" | "client"): Scenario {
  const where =
    downsampling === "sql"
      ? "averaged into buckets by the engine"
      : "reduced with LTTB on the main thread (?downsample=client)";
  return {
    name: `chart-line-1m-${downsampling}`,
    description: `"${SQL}" charted as a line of avg(y) by x, downsampled to 1,000 points ${where}, then hovered for ${HOVER_MS / 1000} s.`,
    modes: ["warm"],
    metrics: {
      chartRenderMs: "ms",
      chartLongestFrameMs: "ms",
      hoverFrameMedianMs: "ms",
      hoverFrameP95Ms: "ms",
      hoverSlowFrames: "count",
      hoverLongestFrameMs: "ms",
    },
    async run(page, baseURL) {
      await openWorkbench(page, baseURL, downsampling === "client" ? "?downsample=client" : "");
      await runQuery(page, SQL);
      await page.getByRole("button", { name: "Chart" }).click();
      // Pick the measure on a bar chart first, so choosing Line draws the measured chart at once.
      await page.getByLabel("Aggregate").selectOption("avg");
      await page.getByLabel("Y", { exact: true }).selectOption("y");
      await page
        .getByRole("img", { name: "Bar chart of avg(y) by x" })
        .waitFor({ timeout: 60_000 });
      await waitForMeasure(page, measures.chartRender);

      await clearMeasures(page);
      await clearLongFrames(page);
      await page.getByLabel("Chart type").selectOption("line");
      const chartRenderMs = await waitForMeasure(page, measures.chartRender);
      const chartLongestFrameMs = await longestFrame(page);
      await page.getByRole("img", { name: LINE }).waitFor();

      await clearLongFrames(page);
      const intervals = (await sampleHover(page)).sort((a, b) => a - b);
      return {
        chartRenderMs,
        chartLongestFrameMs,
        hoverFrameMedianMs: quantile(intervals, 0.5),
        hoverFrameP95Ms: quantile(intervals, 0.95),
        hoverSlowFrames: intervals.filter((ms) => ms > SLOW_FRAME_MS).length,
        hoverLongestFrameMs: await longestFrame(page),
      };
    },
  };
}

export const chartLineScenarios: readonly Scenario[] = [
  chartLineScenario("sql"),
  chartLineScenario("client"),
];
