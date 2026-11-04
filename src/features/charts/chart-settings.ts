// The chart on screen, if one is: its settings, so a share link can carry them (features/share),
// and its picture, for an HTML report (features/results/report.ts). The chart panel keeps both
// up to date.
import type { ChartPreset } from "./chart-preset";

/** A chart's type and columns, by name; what a preset sets, without its query. */
export type ChartSettings = Omit<ChartPreset, "sql">;

/**
 * A drawn chart as PNG data URLs in the light and the dark theme, and the text that describes it
 * to those who can't see it.
 */
export type ChartPicture = { light: string; dark: string; description: string };

let shown: ChartSettings | null = null;
let picture: (() => Promise<ChartPicture | null>) | null = null;

/** The chart on screen's settings, or null while no chart is drawn. */
export function getShownChart(): ChartSettings | null {
  return shown;
}

export function setShownChart(next: ChartSettings | null): void {
  shown = next;
}

/** The chart on screen as a picture, or null while none is drawn (or it's shown as a table). */
export async function getShownChartPicture(): Promise<ChartPicture | null> {
  return picture ? picture() : null;
}

/** Sets how to picture the chart on screen, or null while no chart is drawn. */
export function setShownChartPicture(next: (() => Promise<ChartPicture | null>) | null): void {
  picture = next;
}
