// The settings of the chart on screen, if one is, so a share link can carry them
// (features/share). The chart panel keeps it up to date.
import type { ChartPreset } from "./chart-preset";

/** A chart's type and columns, by name; what a preset sets, without its query. */
export type ChartSettings = Omit<ChartPreset, "sql">;

let shown: ChartSettings | null = null;

/** The chart on screen's settings, or null while no chart is drawn. */
export function getShownChart(): ChartSettings | null {
  return shown;
}

export function setShownChart(next: ChartSettings | null): void {
  shown = next;
}
