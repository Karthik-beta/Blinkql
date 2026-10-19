// The result on screen. Its Arrow table stays here, outside React (ADR-004): components subscribe
// to a small description of it (row count and columns) and read each cell from here as they render
// it, so React never holds the data.
import type { DataType, Table } from "apache-arrow";
import { measureSince, measures } from "@/lib/user-timing";
import { type ResultColumn, resultColumns } from "./cells";

/** What components know about the result: its shape, not its data. */
export type Result = {
  rowCount: number;
  columns: readonly { name: string; type: DataType }[];
  /** When the result reached the main thread (a `performance.now()` time). */
  finishedAt: number;
};

let result: Result | null = null;
let readers: readonly ResultColumn[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The result on screen, or null. Returns the same object until it changes. */
export function getResult(): Result | null {
  return result;
}

/** Calls `listener` whenever the result changes; returns a function that unsubscribes. */
export function subscribeToResult(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows `table` in place of the current result. The store keeps no reference to the previous
 * table, so it can be garbage-collected.
 */
export function showResult(table: Table, finishedAt: number): void {
  const preparing = performance.now();
  readers = resultColumns(table);
  measureSince(measures.resultsConvert, preparing);
  result = {
    rowCount: table.numRows,
    columns: readers.map(({ name, type }) => ({ name, type })),
    finishedAt,
  };
  notify();
}

/** Shows no result, and lets go of the current one. */
export function clearResult(): void {
  if (!result) return;
  result = null;
  readers = [];
  notify();
}

/** The text of a cell of the result on screen, or null for SQL `NULL`. */
export function readCell(rowIndex: number, columnIndex: number): string | null {
  const column = readers[columnIndex];
  if (!column) throw new RangeError(`The result has no column ${columnIndex}`);
  return column.cell(rowIndex);
}
