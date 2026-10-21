// The result on screen. Its data stays here, outside React (ADR-004), as one reader per column over
// the Arrow vectors: components subscribe to a small description of it (row count and columns) and
// read each cell from here as they render it, so React never holds the data.
//
// A result arrives a record batch at a time (P-05). Its first rows are shown as soon as they
// arrive; later ones are added every REFRESH_MS rather than one batch at a time, so the table
// doesn't render hundreds of times for a large result.
import { type DataType, type RecordBatch, type Schema, Table } from "apache-arrow";
import { measureSince, measures } from "@/lib/user-timing";
import { type ResultColumn, resultColumns } from "./cells";

/** How often rows still arriving are added to the result on screen, in ms. */
export const REFRESH_MS = 100;

/** What components know about the result: its shape, not its data. */
export type Result = {
  /** Tells results apart: it stays the same while the result's rows arrive. */
  id: number;
  rowCount: number;
  /** The same array while the result's rows arrive. */
  columns: readonly { name: string; type: DataType }[];
  /** When its query was sent to the engine (a `performance.now()` time, as are the others). */
  startedAt: number;
  /** When its first rows reached the main thread, or its end if it has none. */
  firstRowsAt: number;
  /** When its last rows reached the main thread, or null while they're still arriving. */
  finishedAt: number | null;
};

/** A result whose rows are arriving. It's shown, as `result`, from its first rows on. */
type Incoming = {
  id: number;
  schema: Schema;
  batches: RecordBatch[];
  startedAt: number;
  firstRowsAt: number | null;
  /** Adds the rows that arrived since the result on screen was last updated. */
  refresh: ReturnType<typeof setTimeout> | undefined;
};

let result: Result | null = null;
let readers: readonly ResultColumn[] = [];
let incoming: Incoming | null = null;
let lastId = 0;
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

/** Shows the incoming result with every row received so far; `finishedAt` once it's complete. */
function show(arriving: Incoming, finishedAt: number | null): void {
  clearTimeout(arriving.refresh);
  arriving.refresh = undefined;
  const preparing = performance.now();
  arriving.firstRowsAt ??= preparing;
  // Arrow reads a row of a table with many batches by finding its batch, so this copies nothing.
  const table = new Table(arriving.schema, arriving.batches);
  readers = resultColumns(table);
  if (finishedAt !== null) measureSince(measures.resultsConvert, preparing);
  result = {
    id: arriving.id,
    rowCount: table.numRows,
    // Kept while rows arrive, so rows already on screen don't read their cells again.
    columns:
      result?.id === arriving.id
        ? result.columns
        : readers.map(({ name, type }) => ({ name, type })),
    startedAt: arriving.startedAt,
    firstRowsAt: arriving.firstRowsAt,
    finishedAt,
  };
  if (finishedAt !== null) incoming = null;
  notify();
}

/**
 * Starts receiving the result of a query sent at `startedAt`, with columns from `schema`. The
 * current result stays on screen until the new one's first rows arrive (appendRows), or until it
 * finishes without any (finishResult).
 */
export function startResult(schema: Schema, startedAt: number): void {
  if (incoming) clearTimeout(incoming.refresh);
  incoming = {
    id: ++lastId,
    schema,
    batches: [],
    startedAt,
    firstRowsAt: null,
    refresh: undefined,
  };
}

/** Adds `batch` to the result being received: at once if it holds its first rows, else soon. */
export function appendRows(batch: RecordBatch): void {
  const arriving = incoming;
  if (!arriving) throw new Error("No result is being received; call startResult first");
  arriving.batches.push(batch);
  if (batch.numRows === 0) return;
  if (arriving.firstRowsAt === null) show(arriving, null);
  else arriving.refresh ??= setTimeout(() => show(arriving, null), REFRESH_MS);
}

/** Shows the rest of the result being received, whose last rows arrived at `finishedAt`. */
export function finishResult(finishedAt: number): void {
  if (!incoming) throw new Error("No result is being received; call startResult first");
  show(incoming, finishedAt);
}

/** Shows no result, and lets go of the current one and of any being received. */
export function clearResult(): void {
  if (incoming) clearTimeout(incoming.refresh);
  incoming = null;
  if (!result) return;
  result = null;
  readers = [];
  notify();
}

/**
 * The text of a cell of the result on screen, or null for SQL `NULL`.
 *
 * Reads the current result, not a given snapshot. That's safe while the table renders through
 * useSyncExternalStore, whose renders are synchronous and see the result they render. A render
 * React can interrupt, such as one in a transition, could see a newer result than it was given.
 */
export function readCell(rowIndex: number, columnIndex: number): string | null {
  const column = readers[columnIndex];
  if (!column) throw new RangeError(`The result has no column ${columnIndex}`);
  return column.cell(rowIndex);
}
