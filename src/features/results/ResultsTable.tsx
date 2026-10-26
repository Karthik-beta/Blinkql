// biome-ignore-all lint/a11y/useSemanticElements: a virtualized grid can't be a <table>; it positions its rows itself, so it uses ARIA grid roles
// biome-ignore-all lint/a11y/useFocusableInteractive: the grid keeps the focus and points at the active cell with aria-activedescendant, so rows and cells take none
import type { DataType } from "apache-arrow";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { afterNextPaint, measureSince, measures } from "@/lib/user-timing";
import { CanvasBody, type GridRenderer, gridRenderer } from "./CanvasBody";
import {
  CELL_CHROME_PX,
  isNumeric,
  MAX_SCROLL_HEIGHT,
  ROW_HEIGHT,
  scrollScale,
} from "./grid-layout";
import { getQueryRun, subscribeToQueryRun } from "./query-run";
import { getResult, type Result, readCell, subscribeToResult } from "./result-store";
import { type Cell, selectionBounds, selectionText } from "./selection";

export { MAX_SCROLL_HEIGHT, ROW_HEIGHT, scrollScale } from "./grid-layout";

/**
 * How the grid draws its rows: as DOM cells (the default), or on a canvas under a transparent
 * layer of the same cells (`?grid=canvas`, P-11). Read once: switching means reloading the page.
 */
const GRID_RENDERER = gridRenderer(
  location.search,
  window.matchMedia?.("(forced-colors: active)").matches ?? false,
);

/** Rows rendered beyond each edge of the viewport, so a short scroll shows rows already there. */
const OVERSCAN = 10;

/** The rows read to size the columns, and the widest a column starts, in characters. */
const SIZING_ROWS = 100;
const MAX_COLUMN_CHARS = 50;

/** The widest a column is fitted to its content, in characters, and the narrowest it's resized to. */
const MAX_FIT_CHARS = 200;
const MIN_COLUMN_PX = 32;

/** How far Alt+Left and Alt+Right resize a column, in px. */
const RESIZE_STEP_PX = 16;

/** Whether the last query failed: the one thing about the query run the table depends on. */
const lastRunFailed = () => getQueryRun().state === "failed";

function alignment(type: DataType): string {
  return isNumeric(type) ? "text-right" : "text-left";
}

/**
 * Each column's width, fitted to its name and the values of its first `sampled` rows. Every row
 * has the same widths, so the columns don't shift as rows are scrolled in; the font is monospaced,
 * so a character count is enough.
 */
function columnWidths(columns: Result["columns"], sampled: number): string[] {
  const rows = Array.from({ length: sampled }, (_, row) => row);
  return columns.map((column, columnIndex) =>
    fittedWidth(column.name, columnIndex, rows, MAX_COLUMN_CHARS),
  );
}

/** A column's width fitted to its name and its values in `rows`, at most `maxChars` wide. */
function fittedWidth(name: string, column: number, rows: number[], maxChars: number): string {
  let chars = name.length;
  for (const row of rows) chars = Math.max(chars, (readCell(row, column) ?? "NULL").length);
  return `calc(${Math.min(chars, maxChars)}ch + ${CELL_CHROME_PX}px)`;
}

/** The active cell, and the cell the selection runs from to it: itself unless Shift extended it. */
type Active = Cell & { resultId: number; anchor: Cell };

/** Widths set by resizing columns, by column, for one result; the rest keep their fitted widths. */
type Resized = { resultId: number; widths: Record<number, string> };

const cellId = (gridId: string, row: number, column: number) =>
  `${gridId}-${row < 0 ? "h" : row}-${column}`;

/** Outlines the active cell while the grid has focus, and shades the selected cells. */
const activeCell =
  "aria-selected:bg-selection group-focus:data-active:outline-2 group-focus:data-active:-outline-offset-2";

/**
 * Every row takes its columns' widths from the grid's `--columns` property, so resizing a column
 * sets that one property rather than rendering every row again.
 */
const rowGrid = "grid h-6 grid-cols-(--columns) border-b";

/** Whether `column` is within the selected columns of a row, if any of that row is selected. */
const isSelected = (column: number, from: number | undefined, to: number | undefined) =>
  from !== undefined && to !== undefined && column >= from && column <= to;

type RowProps = {
  index: number;
  columns: Result["columns"];
  gridId: string;
  /** The active cell's column, if it's in this row. */
  activeColumn: number | undefined;
  /** The first and last selected columns, if the selection takes in this row. */
  selectedFrom: number | undefined;
  selectedTo: number | undefined;
};

/**
 * One row's cells, read from the result store. Memoized apart from the row's position, so a row
 * that moves while it's scrolled doesn't read its cells again.
 */
const RowCells = memo(function RowCells({
  index,
  columns,
  gridId,
  activeColumn,
  selectedFrom,
  selectedTo,
}: RowProps) {
  return columns.map((column, columnIndex) => {
    const text = readCell(index, columnIndex);
    return (
      <div
        // Columns can share a name, so the position is the key.
        // biome-ignore lint/suspicious/noArrayIndexKey: columns never reorder within a result
        key={columnIndex}
        id={cellId(gridId, index, columnIndex)}
        role="gridcell"
        aria-colindex={columnIndex + 1}
        aria-selected={isSelected(columnIndex, selectedFrom, selectedTo)}
        data-row={index}
        data-column={columnIndex}
        data-active={activeColumn === columnIndex || undefined}
        title={text ?? undefined}
        className={`truncate border-r px-2 leading-[23px] outline-ring ${alignment(column.type)} ${activeCell}`}
      >
        {text ?? <span className="text-muted-foreground">NULL</span>}
      </div>
    );
  });
});

const Row = memo(function Row({ top, ...props }: RowProps & { top: number }) {
  return (
    <div
      role="row"
      // The header is row 1.
      aria-rowindex={props.index + 2}
      className={`absolute left-0 ${rowGrid}`}
      style={{ top }}
    >
      <RowCells {...props} />
    </div>
  );
});

type HeaderRowProps = Omit<RowProps, "index"> & {
  /** The id of the text that tells screen readers how to resize a column. */
  resizeHintId: string;
  onResizeStart: (event: ReactPointerEvent, column: number) => void;
  onFit: (column: number) => void;
};

function HeaderRow({
  columns,
  gridId,
  activeColumn,
  selectedFrom,
  selectedTo,
  resizeHintId,
  onResizeStart,
  onFit,
}: HeaderRowProps) {
  return (
    <div role="rowgroup" className="sticky top-0 z-10">
      <div role="row" aria-rowindex={1} className={`${rowGrid} bg-chrome`}>
        {columns.map((column, columnIndex) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: see RowCells
            key={columnIndex}
            id={cellId(gridId, -1, columnIndex)}
            role="columnheader"
            aria-colindex={columnIndex + 1}
            aria-selected={isSelected(columnIndex, selectedFrom, selectedTo)}
            aria-describedby={resizeHintId}
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
            data-row={-1}
            data-column={columnIndex}
            data-active={activeColumn === columnIndex || undefined}
            className={`relative truncate border-r px-2 font-medium leading-[23px] outline-ring ${alignment(column.type)} ${activeCell}`}
          >
            {column.name}
            {/* For the mouse; the keyboard resizes with Alt+arrows, as the hint says. */}
            <div
              aria-hidden
              title="Drag to resize, double-click to fit"
              onPointerDown={(event) => onResizeStart(event, columnIndex)}
              onDoubleClick={() => onFit(columnIndex)}
              className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-ring"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The rows in view, plus OVERSCAN either side, for a grid scrolled to `offset` unscaled px with a
 * viewport `height` px tall. Every row is ROW_HEIGHT tall, so this is arithmetic: it costs the same
 * at any row count, where a general virtualizer walks every row each time the count changes.
 */
function rowsInView(offset: number, height: number, rowCount: number): number[] {
  if (rowCount === 0) return [];
  // Row i spans [(i + 1), (i + 2)) * ROW_HEIGHT: the rows start below the header, which stays over
  // the top row of the viewport. A row is in view if any of it is within [offset, offset + height).
  const first = Math.max(0, Math.floor(offset / ROW_HEIGHT) - 1 - OVERSCAN);
  const last = Math.min(rowCount - 1, Math.ceil((offset + height) / ROW_HEIGHT) - 2 + OVERSCAN);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/** Scrolls `grid` up or down, if needed, so the whole of `row` is in view below the header. */
export function revealRow(grid: HTMLElement, row: number, rowCount: number): void {
  const scale = scrollScale(grid, rowCount);
  // In unscaled px, as the rows are placed: the scrolled offset and the row's top.
  const offset = grid.scrollTop * scale;
  const top = row * ROW_HEIGHT;
  const below = grid.clientHeight - ROW_HEIGHT;
  // Scaled, a row's position is rounded to whole pixels, so allow one more.
  const slack = scale > 1 ? 1 : 0;
  if (top < offset) grid.scrollTop = Math.floor(top / scale) - slack;
  else if (top + ROW_HEIGHT > offset + below) {
    grid.scrollTop = Math.ceil((top + ROW_HEIGHT - below) / scale) + slack;
  }
}

/** Scrolls `grid` sideways, if needed, so the whole of `column` is in view. */
function revealColumn(grid: HTMLElement, gridId: string, column: number): void {
  const header = document.getElementById(cellId(gridId, -1, column));
  if (!header) return;
  const left = header.offsetLeft;
  const right = left + header.offsetWidth;
  if (left < grid.scrollLeft) grid.scrollLeft = left;
  else if (right > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = right - grid.clientWidth;
}

/**
 * The cell a key press moves to from `row` and `column`, or null for a key the grid doesn't use.
 * Follows the ARIA grid pattern: arrows move one cell, Page Up and Page Down a screenful, Home and
 * End to the ends of the row, and with Ctrl (⌘ on macOS) to the first and last cells.
 */
function move(
  event: KeyboardEvent,
  { row, column }: { row: number; column: number },
  { rows, columns, page }: { rows: number; columns: number; page: number },
): { row: number; column: number } | null {
  const lastRow = rows - 1;
  const lastColumn = columns - 1;
  const toEdge = event.ctrlKey || event.metaKey;
  switch (event.key) {
    case "ArrowUp":
      return { row: Math.max(-1, row - 1), column };
    case "ArrowDown":
      return { row: Math.min(lastRow, row + 1), column };
    case "ArrowLeft":
      return { row, column: Math.max(0, column - 1) };
    case "ArrowRight":
      return { row, column: Math.min(lastColumn, column + 1) };
    case "PageUp":
      return { row: Math.max(row < 0 ? -1 : 0, row - page), column };
    case "PageDown":
      return { row: Math.min(lastRow, Math.max(0, row + page)), column };
    case "Home":
      return toEdge ? { row: Math.min(0, lastRow), column: 0 } : { row, column: 0 };
    case "End":
      return toEdge ? { row: lastRow, column: lastColumn } : { row, column: lastColumn };
    default:
      return null;
  }
}

/**
 * The result on screen as a virtualized grid: only the rows in view, plus a few either side, are
 * in the page, so showing and scrolling a result costs about the same at any size (P-04).
 *
 * The grid renders when the result changes, including as its rows arrive (P-05), when the last
 * run starts or stops failing, and as it scrolls. It subscribes to the result's shape and to that one flag, not to the whole query run,
 * and it's memoized, so neither a query starting nor its parent rendering renders it (P-03). Cells
 * are read from the Arrow result as their rows come into view; nothing is copied (P-02).
 *
 * It's an ARIA grid: the focus stays on the grid, and the active cell, moved with the keyboard or
 * by clicking, is its `aria-activedescendant`. Rows and cells carry their position in the whole
 * result, so screen readers announce it even though most rows aren't in the page. Shift extends
 * the selection from the active cell to a block, which Ctrl+C (⌘C) copies as tab-separated text.
 * Columns resize by dragging or double-clicking a header's edge, or with Alt+Left and Alt+Right.
 *
 * With the canvas renderer the rows are drawn on a canvas instead, and the same rows and cells
 * stay in the page, transparent, over it: they're what clicks land on and screen readers read.
 */
export const ResultsTable = memo(function ResultsTable({
  renderer = GRID_RENDERER,
}: {
  renderer?: GridRenderer;
}) {
  const results = useSyncExternalStore(subscribeToResult, getResult);
  const failed = useSyncExternalStore(subscribeToQueryRun, lastRunFailed);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const [stored, setActive] = useState<Active | null>(null);
  // The active cell belongs to the result it was chosen in; a new result starts without one.
  const active = stored && stored.resultId === results?.id ? stored : null;
  const rowCount = results?.rowCount ?? 0;

  // Where the grid is scrolled to and how tall it is, read on every scroll and resize. Read before
  // the first paint, so the first result shows in one render.
  const [view, setView] = useState({ scrollTop: 0, height: 0 });
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const read = () => setView({ scrollTop: grid.scrollTop, height: grid.clientHeight });
    read();
    grid.addEventListener("scroll", read, { passive: true });
    const resize = new ResizeObserver(read);
    resize.observe(grid);
    return () => {
      grid.removeEventListener("scroll", read);
      resize.disconnect();
    };
  }, []);

  // Sized again only while the rows they're sized by are still arriving.
  const columns = results?.columns;
  const sampled = Math.min(rowCount, SIZING_ROWS);
  const widths = useMemo(() => (columns ? columnWidths(columns, sampled) : []), [columns, sampled]);

  const id = results?.id;
  useEffect(() => {
    if (id === undefined) return;
    // A new result starts at its first row and column; rows arriving later leave it where it is.
    const grid = gridRef.current;
    if (grid) {
      grid.scrollTop = 0;
      grid.scrollLeft = 0;
    }
  }, [id]);

  // Timed for the benchmark: each result's first rows on screen, then all of them.
  const { startedAt, firstRowsAt, finishedAt } = results ?? {};
  useEffect(() => {
    if (startedAt === undefined || firstRowsAt === undefined) return;
    return afterNextPaint(() => {
      measureSince(measures.firstRows, startedAt);
      measureSince(measures.firstRowsRender, firstRowsAt);
    });
  }, [startedAt, firstRowsAt]);
  useEffect(() => {
    if (finishedAt == null) return;
    return afterNextPaint(() => measureSince(measures.resultsRender, finishedAt));
  }, [finishedAt]);

  // Rows are placed in unscaled px, as if every row took ROW_HEIGHT, then moved by how far the area
  // has really scrolled. The two are the same unless the result is over MAX_SCROLL_HEIGHT.
  const scrolled = view.scrollTop;
  const offset = scrolled * scrollScale(gridRef.current, rowCount);
  const rows = rowsInView(offset, view.height, rowCount);
  const bodyHeight = Math.min(rowCount * ROW_HEIGHT, MAX_SCROLL_HEIGHT);
  const activeInPage = active && (active.row < 0 || rows.includes(active.row));

  const selection = active ? selectionBounds(active.anchor, active) : null;
  /** The selected columns of `row`: `selectedFrom` and `selectedTo`, if it's selected. */
  const selectedIn = (row: number) =>
    selection && row >= selection.top && row <= selection.bottom
      ? { selectedFrom: selection.left, selectedTo: selection.right }
      : { selectedFrom: undefined, selectedTo: undefined };

  /** Makes a cell the active one; `extend` keeps the selection's anchor, as Shift does. */
  const activate = (row: number, column: number, extend: boolean) => {
    if (!results) return;
    const anchor = extend && active ? active.anchor : { row, column };
    setActive({ resultId: results.id, row, column, anchor });
    const grid = gridRef.current;
    if (!grid) return;
    if (row >= 0) revealRow(grid, row, rowCount);
    revealColumn(grid, gridId, column);
  };

  const onFocus = () => {
    if (!results || active || results.columns.length === 0) return;
    // Start on the first row in view, or on the header if there are no rows.
    const first = rows.find((row) => row * ROW_HEIGHT >= offset);
    const start = { row: rowCount > 0 ? (first ?? 0) : -1, column: 0 };
    setActive({ resultId: results.id, ...start, anchor: start });
  };

  const [storedWidths, setResized] = useState<Resized | null>(null);
  // Like the active cell, resized widths belong to their result.
  const resized = storedWidths?.resultId === results?.id ? (storedWidths?.widths ?? {}) : {};
  const template = widths.map((width, column) => resized[column] ?? width).join(" ");

  const resize = (column: number, width: string) => {
    if (!results) return;
    const { id } = results;
    setResized((previous) => ({
      resultId: id,
      widths: { ...(previous?.resultId === id && previous.widths), [column]: width },
    }));
  };
  const resizeTo = (column: number, px: number) =>
    resize(column, `${Math.max(MIN_COLUMN_PX, Math.round(px))}px`);
  const headerWidth = (column: number) =>
    document.getElementById(cellId(gridId, -1, column))?.offsetWidth ?? 0;

  const onResizeStart = (event: ReactPointerEvent, column: number) => {
    if (event.button !== 0) return;
    // Keeps the drag from selecting the page's text.
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = headerWidth(column);
    const onMove = (moved: PointerEvent) => resizeTo(column, startWidth + moved.clientX - startX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** Fits a column to its name and the values of the rows in the page. */
  const onFit = (column: number) => {
    const name = results?.columns[column]?.name ?? "";
    resize(column, fittedWidth(name, column, rows, MAX_FIT_CHARS));
  };

  /** Copies the selected cells as tab-separated text, the header's as the columns' names. */
  const copy = () => {
    if (!results || !selection) return;
    const read = (row: number, column: number) =>
      row < 0 ? (results.columns[column]?.name ?? null) : readCell(row, column);
    void navigator.clipboard.writeText(selectionText(selection, read));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!results || !active) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copy();
      return;
    }
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -RESIZE_STEP_PX : RESIZE_STEP_PX;
      resizeTo(active.column, headerWidth(active.column) + step);
      return;
    }
    const grid = gridRef.current;
    const page = Math.max(1, Math.floor(((grid?.clientHeight ?? 0) - ROW_HEIGHT) / ROW_HEIGHT));
    const next = move(event, active, { rows: rowCount, columns: results.columns.length, page });
    if (!next) return;
    event.preventDefault();
    activate(next.row, next.column, event.shiftKey);
  };

  const onClick = (event: MouseEvent) => {
    const cell = (event.target as Element).closest<HTMLElement>("[data-column]");
    if (!cell) return;
    activate(Number(cell.dataset.row), Number(cell.dataset.column), event.shiftKey);
  };

  // The same element with or without a result, so the viewport's size is known by the time the
  // first result arrives, and it shows in one render.
  return (
    <div
      ref={gridRef}
      // The grid scrolls itself and keeps the focus; its cells are reached with the arrow keys.
      {...(results && {
        role: "grid",
        "aria-label": "Results",
        "aria-rowcount": rowCount + 1,
        "aria-colcount": results.columns.length,
        "aria-multiselectable": true,
        "aria-activedescendant":
          active && activeInPage ? cellId(gridId, active.row, active.column) : undefined,
        tabIndex: 0,
        onFocus,
        onKeyDown,
        onClick,
      })}
      // A failed query has no results; its error panel, above, gets the room instead.
      hidden={failed}
      className="group min-h-0 flex-1 overflow-auto border-t font-mono text-xs tabular-nums outline-none"
    >
      {results && (
        <div className="w-max min-w-full" style={{ "--columns": template } as CSSProperties}>
          <span id={`${gridId}-resize`} hidden>
            Alt+Left and Alt+Right resize the column
          </span>
          <HeaderRow
            columns={results.columns}
            gridId={gridId}
            activeColumn={active?.row === -1 ? active.column : undefined}
            {...selectedIn(-1)}
            resizeHintId={`${gridId}-resize`}
            onResizeStart={onResizeStart}
            onFit={onFit}
          />
          {renderer === "canvas" && (
            <CanvasBody
              gridRef={gridRef}
              result={results}
              template={template}
              bodyHeight={bodyHeight}
              active={active}
            />
          )}
          <div
            role="rowgroup"
            // Transparent over the canvas, which shows the same cells, but still in the
            // accessibility tree and under the pointer.
            className={renderer === "canvas" ? "relative opacity-0" : "relative"}
            style={{ height: bodyHeight }}
          >
            {rows.map((row) => (
              <Row
                key={row}
                index={row}
                top={Math.round(scrolled + row * ROW_HEIGHT - offset)}
                columns={results.columns}
                gridId={gridId}
                activeColumn={active?.row === row ? active.column : undefined}
                {...selectedIn(row)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
