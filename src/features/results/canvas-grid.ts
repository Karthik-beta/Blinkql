// Drawing the results grid's rows on a canvas (P-11): the same cells the DOM grid shows, in the
// same places, so the transparent DOM cells over them line up with what's drawn.
import { CELL_CHROME_PX, ROW_HEIGHT } from "./grid-layout";
import type { Bounds, Cell } from "./selection";

/** The colours and font the DOM grid gets from CSS, read from the grid's computed style. */
export type Theme = {
  font: string;
  text: string;
  muted: string;
  border: string;
  selection: string;
  ring: string;
};

/** What a canvas the size of the grid's viewport, below its header, shows. */
export type Frame = {
  /** The canvas's size in CSS px. */
  width: number;
  height: number;
  /** The grid's scrollTop, and how far the rows have moved, in unscaled px (see scrollScale). */
  scrolled: number;
  offset: number;
  scrollLeft: number;
  rowCount: number;
  /** Each column's left edge within the rows and its width, its right border included, in px. */
  lefts: readonly number[];
  widths: readonly number[];
  /** Whether each column holds numbers, which line up on the right. */
  numeric: readonly boolean[];
  selection: Bounds | null;
  active: Cell | null;
  /** Whether the grid has the focus, which outlines the active cell. */
  focused: boolean;
  theme: Theme;
  /** A cell's text, or null for SQL NULL. */
  read: (row: number, column: number) => string | null;
};

/** A cell's left padding, in px: `px-2`. */
const PADDING_PX = 8;

/** The width of the active cell's outline, in px: `outline-2`, drawn inside the cell. */
const OUTLINE_PX = 2;

/**
 * `text`, cut short with an ellipsis if it's longer than `fit` characters, as `truncate` shows it.
 * The font is monospaced, so a character count is enough and no text is measured per cell.
 */
function truncated(text: string, fit: number): string {
  return text.length > fit ? `${text.slice(0, Math.max(0, fit - 1))}…` : text;
}

/** Draws the cells of `frame` in view, and nothing else, on a context scaled to CSS px. */
export function drawCells(context: CanvasRenderingContext2D, frame: Frame): void {
  const { width, height, scrolled, offset, scrollLeft, rowCount, lefts, widths, theme } = frame;
  context.clearRect(0, 0, width, height);
  if (rowCount === 0 || width <= 0 || height <= 0) return;

  // Placed as the DOM grid places its rows, rounded the same way, so they line up exactly.
  const rowTop = (row: number) => Math.round(scrolled + row * ROW_HEIGHT - offset) - scrolled;
  const rows: number[] = [];
  const first = Math.max(0, Math.floor(offset / ROW_HEIGHT) - 1);
  const last = Math.min(rowCount - 1, Math.ceil((offset + height) / ROW_HEIGHT));
  for (let row = first; row <= last; row++) {
    const top = rowTop(row);
    if (top + ROW_HEIGHT > 0 && top < height) rows.push(row);
  }
  const columns: number[] = [];
  for (let column = 0; column < lefts.length; column++) {
    const left = (lefts[column] ?? 0) - scrollLeft;
    if (left + (widths[column] ?? 0) > 0 && left < width) columns.push(column);
  }
  const lastColumn = lefts.length - 1;
  const rowsRight = Math.min(
    width,
    (lefts[lastColumn] ?? 0) + (widths[lastColumn] ?? 0) - scrollLeft,
  );
  const x = (column: number) => (lefts[column] ?? 0) - scrollLeft;
  const w = (column: number) => widths[column] ?? 0;

  const { selection } = frame;
  if (selection) {
    context.fillStyle = theme.selection;
    for (const row of rows) {
      if (row < selection.top || row > selection.bottom) continue;
      for (const column of columns) {
        if (column < selection.left || column > selection.right) continue;
        context.fillRect(x(column), rowTop(row), w(column), ROW_HEIGHT - 1);
      }
    }
  }

  // Each row's bottom border and each cell's right one, on whole pixels so they stay sharp.
  context.fillStyle = theme.border;
  const firstRow = rows[0];
  const lastRow = rows.at(-1);
  if (firstRow === undefined || lastRow === undefined) return;
  for (const row of rows) context.fillRect(0, rowTop(row) + ROW_HEIGHT - 1, rowsRight, 1);
  const rowsTop = Math.max(0, rowTop(firstRow));
  const rowsBottom = Math.min(height, rowTop(lastRow) + ROW_HEIGHT);
  for (const column of columns) {
    context.fillRect(Math.round(x(column) + w(column)) - 1, rowsTop, 1, rowsBottom - rowsTop);
  }

  context.font = theme.font;
  context.textBaseline = "middle";
  const charWidth = context.measureText("0").width;
  for (const column of columns) {
    const left = x(column);
    const cellWidth = w(column);
    // Up to half a pixel either way: widths are read rounded to whole pixels.
    const fit =
      charWidth > 0
        ? Math.floor((cellWidth - CELL_CHROME_PX + 0.5) / charWidth)
        : Number.POSITIVE_INFINITY;
    const right = frame.numeric[column] ?? false;
    context.textAlign = right ? "right" : "left";
    // Inside the padding, and on the right inside the cell's 1 px border too.
    const textX = right ? left + cellWidth - 1 - PADDING_PX : left + PADDING_PX;
    // Characters wider than the font's own (CJK, emoji) could run over; the cell clips them.
    context.save();
    context.beginPath();
    context.rect(left, 0, cellWidth - 1, height);
    context.clip();
    for (const row of rows) {
      const text = frame.read(row, column);
      context.fillStyle = text === null ? theme.muted : theme.text;
      context.fillText(truncated(text ?? "NULL", fit), textX, rowTop(row) + (ROW_HEIGHT - 1) / 2);
    }
    context.restore();
  }

  const { active } = frame;
  if (frame.focused && active && rows.includes(active.row) && columns.includes(active.column)) {
    context.strokeStyle = theme.ring;
    context.lineWidth = OUTLINE_PX;
    const inset = OUTLINE_PX / 2;
    context.strokeRect(
      x(active.column) + inset,
      rowTop(active.row) + inset,
      w(active.column) - OUTLINE_PX,
      ROW_HEIGHT - 1 - OUTLINE_PX,
    );
  }
}
