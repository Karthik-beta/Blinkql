// The chart a query's result should open in, such as the one an analysis template names. The app
// switches to the chart when a preset arrives, and the chart panel takes it up while the query it
// belongs to is the last one run.
import type { Aggregate, ChartType } from "./chart-sql";

export type ChartPreset = {
  /** The query whose result the preset is for. */
  sql: string;
  type: ChartType;
  /** Names of the result's columns. */
  x: string;
  y?: string;
  aggregate?: Aggregate;
};

let preset: ChartPreset | null = null;
const listeners = new Set<() => void>();

/** The latest preset. Returns the same object until another is set. */
export function getChartPreset(): ChartPreset | null {
  return preset;
}

/** Calls `listener` whenever a preset is set; returns a function that unsubscribes. */
export function subscribeToChartPreset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setChartPreset(next: ChartPreset | null): void {
  preset = next;
  for (const listener of listeners) listener();
}
