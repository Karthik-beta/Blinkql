// Showing and scrolling large results: one scenario per result size, so a build that can't show
// the largest ones in reasonable time (every row rendered, before P-04) can skip them with
// --scenario. Each iteration shows the result, then scrolls it two ways while sampling frames.
// The `-canvas` scenarios do the same with the rows drawn on a canvas (`?grid=canvas`, P-11).
// Generate the files first with `pnpm bench:data`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Dataset, fileName } from "../datasets/generate.ts";
import {
  importFile,
  measureMemory,
  openWorkbench,
  runQuery,
  type ScrollKind,
  sampleScroll,
} from "../harness/page.ts";
import { quantile } from "../harness/stats.ts";
import type { Scenario } from "../harness/types.ts";
import { DATA_DIR, tableName } from "./datasets.ts";

/** How long each kind of scroll is sampled for. */
const SCROLL_MS = 5_000;

/**
 * A frame slower than this missed at least one refresh at 60 Hz or 75 Hz (headless Chromium runs
 * at 75), so the display showed the previous frame again, which reads as a stutter.
 */
const SLOW_FRAME_MS = 25;

const label = (rows: number) => (rows >= 1_000_000 ? `${rows / 1_000_000}m` : `${rows / 1_000}k`);

function scrollScenario(dataset: Dataset, rows: number, grid: "dom" | "canvas" = "dom"): Scenario {
  const file = fileName(dataset);
  const t = tableName(dataset);
  const scrollMetrics = (kind: ScrollKind) => ({
    [`${kind}FrameMedianMs`]: "ms",
    [`${kind}FrameP95Ms`]: "ms",
    [`${kind}SlowFrames`]: "count",
    [`${kind}LongestFrameMs`]: "ms",
  });
  return {
    name: `scroll-${label(rows)}-${dataset.shape}${grid === "canvas" ? "-canvas" : ""}`,
    description: `${rows.toLocaleString("en")} rows of ${file}${grid === "canvas" ? " drawn on a canvas (?grid=canvas)" : ""}: showing them, then scrolling them for ${SCROLL_MS / 1000} s at a steady speed and ${SCROLL_MS / 1000} s from top to bottom, sampling every frame.`,
    modes: ["warm"],
    metrics: {
      renderMs: "ms",
      renderLongestFrameMs: "ms",
      firstRowsMs: "ms",
      firstRowsRenderMs: "ms",
      memoryBytes: "bytes",
      ...scrollMetrics("wheel"),
      ...scrollMetrics("drag"),
    },
    async run(page, baseURL) {
      const path = join(DATA_DIR, file);
      if (!existsSync(path))
        throw new Error(`${path} is missing; generate it with pnpm bench:data`);

      await openWorkbench(page, baseURL, grid === "canvas" ? "?grid=canvas" : "");
      await importFile(page, path);
      const result = await runQuery(page, `SELECT * FROM ${t} LIMIT ${rows}`);
      const values: Record<string, number | undefined> = {
        renderMs: result.render,
        renderLongestFrameMs: result.longestFrame,
        firstRowsMs: result.firstRows,
        firstRowsRenderMs: result.firstRowsRender,
        memoryBytes: (await measureMemory(page))?.total,
      };
      for (const kind of ["wheel", "drag"] as const) {
        const { intervals, longestFrame } = await sampleScroll(page, kind, SCROLL_MS);
        const sorted = intervals.toSorted((a, b) => a - b);
        values[`${kind}FrameMedianMs`] = quantile(sorted, 0.5);
        values[`${kind}FrameP95Ms`] = quantile(sorted, 0.95);
        values[`${kind}SlowFrames`] = intervals.filter((ms) => ms > SLOW_FRAME_MS).length;
        values[`${kind}LongestFrameMs`] = longestFrame;
      }
      return values;
    },
  };
}

const narrow: Dataset = { size: "m", shape: "narrow", format: "parquet" };
const wide: Dataset = { size: "s", shape: "wide", format: "parquet" };

export const scrollScenarios: readonly Scenario[] = [
  scrollScenario(narrow, 10_000),
  scrollScenario(narrow, 100_000),
  scrollScenario(narrow, 1_000_000),
  scrollScenario(wide, 10_000),
  scrollScenario(wide, 100_000),
  scrollScenario(wide, 10_000, "canvas"),
  scrollScenario(wide, 100_000, "canvas"),
];
