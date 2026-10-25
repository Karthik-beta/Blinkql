/** A cell of the grid: a row of the result, or -1 for the header row, and a column. */
export type Cell = { row: number; column: number };

/** The block of cells a selection covers, inclusive. */
export type Bounds = { top: number; bottom: number; left: number; right: number };

/** The block between the cell a selection started from and the active cell. */
export function selectionBounds(anchor: Cell, active: Cell): Bounds {
  return {
    top: Math.min(anchor.row, active.row),
    bottom: Math.max(anchor.row, active.row),
    left: Math.min(anchor.column, active.column),
    right: Math.max(anchor.column, active.column),
  };
}

/** A value as a spreadsheet reads it from pasted text: quoted if it holds a tab, line break or quote. */
function field(text: string | null): string {
  if (text === null) return "";
  return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The cells of `bounds` as tab-separated text, a line per row, read with `read`; NULL is an empty
 * cell. Spreadsheets paste it as the same block.
 */
export function selectionText(
  { top, bottom, left, right }: Bounds,
  read: (row: number, column: number) => string | null,
): string {
  const lines: string[] = [];
  for (let row = top; row <= bottom; row++) {
    const fields: string[] = [];
    for (let column = left; column <= right; column++) fields.push(field(read(row, column)));
    lines.push(fields.join("\t"));
  }
  return lines.join("\n");
}
