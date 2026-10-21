// biome-ignore-all lint/a11y/useSemanticElements: a virtualized grid can't be a <table>; it positions its rows itself, so it uses ARIA grid roles
// biome-ignore-all lint/a11y/useFocusableInteractive: the grid keeps the focus and points at the active cell with aria-activedescendant, so rows and cells take none
import {
  elementScroll,
  observeElementOffset,
  useVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { DataType } from "apache-arrow";
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { measureSince, measures } from "@/lib/user-timing";
import { getQueryRun, subscribeToQueryRun } from "./query-run";
import { getResult, type Result, readCell, subscribeToResult } from "./result-store";

/** The height of the header row and of every row, its bottom border included, in px. */
export const ROW_HEIGHT = 24;

/**
 * The tallest the rows may make the scrolling area, in px. Firefox can't lay out anything taller
 * than about 17.9 million px, so a taller result (over 625,000 rows) scrolls through an area this
 * tall instead, and each pixel scrolled moves the rows a little more than a pixel.
 */
export const MAX_SCROLL_HEIGHT = 15_000_000;

/** Rows rendered beyond each edge of the viewport, so a short scroll shows rows already there. */
const OVERSCAN = 10;

/** The rows read to size the columns, and the widest a column starts, in characters. */
const SIZING_ROWS = 100;
const MAX_COLUMN_CHARS = 50;

/** A cell's horizontal padding and right border, in px: `px-2` and `border-r`. */
const CELL_CHROME_PX = 17;

/** Whether the last query failed: the one thing about the query run the table depends on. */
const lastRunFailed = () => getQueryRun().state === "failed";

/** Numbers line up on the right, so their digits do too. */
function alignment(type: DataType): string {
  return DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)
    ? "text-right"
    : "text-left";
}

/**
 * Each column's width, fitted to its name and the values of its first `sampled` rows. Every row
 * has the same widths, so the columns don't shift as rows are scrolled in; the font is monospaced,
 * so a character count is enough.
 */
function columnWidths(columns: Result["columns"], sampled: number): string[] {
  return columns.map((column, columnIndex) => {
    let chars = column.name.length;
    for (let row = 0; row < sampled; row++) {
      chars = Math.max(chars, (readCell(row, columnIndex) ?? "NULL").length);
    }
    return `calc(${Math.min(chars, MAX_COLUMN_CHARS)}ch + ${CELL_CHROME_PX}px)`;
  });
}

/**
 * How far the rows move per pixel scrolled: 1, unless the result is taller than
 * MAX_SCROLL_HEIGHT. The ratio makes the bottom of the scrolling area show the last row.
 */
export function scrollScale(element: Element | null, rowCount: number): number {
  const rowsHeight = rowCount * ROW_HEIGHT;
  if (!element || rowsHeight <= MAX_SCROLL_HEIGHT) return 1;
  const viewport = element.clientHeight;
  return (ROW_HEIGHT + rowsHeight - viewport) / (ROW_HEIGHT + MAX_SCROLL_HEIGHT - viewport);
}

/** The active cell: a row of the result, or -1 for the header row, and a column. */
type Active = { resultId: number; row: number; column: number };

/** Calls `callback` once the next frame has been painted; returns a function that cancels it. */
function afterNextPaint(callback: () => void): () => void {
  // A timeout queued from requestAnimationFrame runs once that frame has been painted.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timeout = setTimeout(callback);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timeout);
  };
}

const cellId = (gridId: string, row: number, column: number) =>
  `${gridId}-${row < 0 ? "h" : row}-${column}`;

/** Outlines the active cell while the grid has focus. */
const activeCell = "group-focus:data-active:outline-2 group-focus:data-active:-outline-offset-2";

type RowProps = {
  index: number;
  columns: Result["columns"];
  template: string;
  gridId: string;
  /** The active cell's column, if it's in this row. */
  activeColumn: number | undefined;
};

/**
 * One row's cells, read from the result store. Memoized apart from the row's position, so a row
 * that moves while it's scrolled doesn't read its cells again.
 */
const RowCells = memo(function RowCells({ index, columns, gridId, activeColumn }: RowProps) {
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
      className="absolute left-0 grid h-6 border-b"
      style={{ top, gridTemplateColumns: props.template }}
    >
      <RowCells {...props} />
    </div>
  );
});

const HeaderRow = memo(function HeaderRow({
  columns,
  template,
  gridId,
  activeColumn,
}: Omit<RowProps, "index">) {
  return (
    <div role="rowgroup" className="sticky top-0 z-10">
      <div
        role="row"
        aria-rowindex={1}
        className="grid h-6 border-b bg-chrome"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column, columnIndex) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: see RowCells
            key={columnIndex}
            id={cellId(gridId, -1, columnIndex)}
            role="columnheader"
            aria-colindex={columnIndex + 1}
            data-row={-1}
            data-column={columnIndex}
            data-active={activeColumn === columnIndex || undefined}
            className={`truncate border-r px-2 font-medium leading-[23px] outline-ring ${alignment(column.type)} ${activeCell}`}
          >
            {column.name}
          </div>
        ))}
      </div>
    </div>
  );
});

/** Scrolls `grid` up or down, if needed, so the whole of `row` is in view below the header. */
export function revealRow(grid: HTMLElement, row: number, rowCount: number): void {
  const scale = scrollScale(grid, rowCount);
  // In unscaled px, as the virtualizer sees them: the scrolled offset and the row's top.
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
 * result, so screen readers announce it even though most rows aren't in the page.
 */
export const ResultsTable = memo(function ResultsTable() {
  const results = useSyncExternalStore(subscribeToResult, getResult);
  const failed = useSyncExternalStore(subscribeToQueryRun, lastRunFailed);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const [stored, setActive] = useState<Active | null>(null);
  // The active cell belongs to the result it was chosen in; a new result starts without one.
  const active = stored && stored.resultId === results?.id ? stored : null;
  const rowCount = results?.rowCount ?? 0;

  const virtualizer: Virtualizer<HTMLDivElement, Element> = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // The rows start below the header, which stays over the top row of the viewport.
    scrollMargin: ROW_HEIGHT,
    // The virtualizer works in unscaled offsets, as if every row took ROW_HEIGHT; these convert
    // to and from the scrolling area's, which differ for a result over MAX_SCROLL_HEIGHT. Its
    // scrollToIndex still compares with the area's real height, so the grid doesn't use it; it
    // scrolls rows into view itself (revealRow). The offset observer is set up once, with the
    // grid, so it reads the row count from the current options rather than this render's.
    observeElementOffset: (instance, onOffset) =>
      observeElementOffset(instance, (offset, isScrolling) =>
        onOffset(offset * scrollScale(instance.scrollElement, instance.options.count), isScrolling),
      ),
    scrollToFn: (offset, { adjustments = 0, behavior }, instance) =>
      elementScroll(
        (offset + adjustments) / scrollScale(instance.scrollElement, instance.options.count),
        { behavior },
        instance,
      ),
  });

  // Sized again only while the rows they're sized by are still arriving.
  const columns = results?.columns;
  const sampled = Math.min(rowCount, SIZING_ROWS);
  const widths = useMemo(() => (columns ? columnWidths(columns, sampled) : []), [columns, sampled]);
  const template = widths.join(" ");

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

  const items = virtualizer.getVirtualItems();
  // Where the rows are drawn: their unscaled position relative to the viewport, plus how far the
  // area has really scrolled. The same as their unscaled position unless the result is scaled.
  const offset = virtualizer.scrollOffset ?? 0;
  const scrolled = offset / scrollScale(gridRef.current, rowCount);
  const bodyHeight = Math.min(rowCount * ROW_HEIGHT, MAX_SCROLL_HEIGHT);
  const activeInPage =
    active && (active.row < 0 || items.some((item) => item.index === active.row));

  const activate = (row: number, column: number) => {
    if (!results) return;
    setActive({ resultId: results.id, row, column });
    const grid = gridRef.current;
    if (!grid) return;
    if (row >= 0) revealRow(grid, row, rowCount);
    revealColumn(grid, gridId, column);
  };

  const onFocus = () => {
    if (!results || active || results.columns.length === 0) return;
    // Start on the first row in view, or on the header if there are no rows.
    const first = items.find((item) => item.start - offset >= ROW_HEIGHT);
    setActive({ resultId: results.id, row: rowCount > 0 ? (first?.index ?? 0) : -1, column: 0 });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!results || !active) return;
    const grid = gridRef.current;
    const page = Math.max(1, Math.floor(((grid?.clientHeight ?? 0) - ROW_HEIGHT) / ROW_HEIGHT));
    const next = move(event, active, { rows: rowCount, columns: results.columns.length, page });
    if (!next) return;
    event.preventDefault();
    activate(next.row, next.column);
  };

  const onClick = (event: MouseEvent) => {
    const cell = (event.target as Element).closest<HTMLElement>("[data-column]");
    if (!cell) return;
    activate(Number(cell.dataset.row), Number(cell.dataset.column));
  };

  // The same element with or without a result, so the virtualizer knows the viewport's size by
  // the time the first result arrives, and shows it in one render.
  return (
    <div
      ref={gridRef}
      // The grid scrolls itself and keeps the focus; its cells are reached with the arrow keys.
      {...(results && {
        role: "grid",
        "aria-label": "Results",
        "aria-rowcount": rowCount + 1,
        "aria-colcount": results.columns.length,
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
        <div className="w-max min-w-full">
          <HeaderRow
            columns={results.columns}
            template={template}
            gridId={gridId}
            activeColumn={active?.row === -1 ? active.column : undefined}
          />
          <div role="rowgroup" className="relative" style={{ height: bodyHeight }}>
            {items.map((item) => (
              <Row
                key={item.index}
                index={item.index}
                top={Math.round(scrolled + item.start - offset - ROW_HEIGHT)}
                columns={results.columns}
                template={template}
                gridId={gridId}
                activeColumn={active?.row === item.index ? active.column : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
