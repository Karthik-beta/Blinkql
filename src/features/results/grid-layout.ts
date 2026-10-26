// Where the results grid's rows and cells go, shared by the DOM grid and the canvas it can draw on.
import { DataType } from "apache-arrow";

/** The height of the header row and of every row, its bottom border included, in px. */
export const ROW_HEIGHT = 24;

/**
 * The tallest the rows may make the scrolling area, in px. Firefox can't lay out anything taller
 * than about 17.9 million px, so a taller result (over 625,000 rows) scrolls through an area this
 * tall instead, and each pixel scrolled moves the rows a little more than a pixel.
 */
export const MAX_SCROLL_HEIGHT = 15_000_000;

/** A cell's horizontal padding and right border, in px: `px-2` and `border-r`. */
export const CELL_CHROME_PX = 17;

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

/** Numbers line up on the right, so their digits do too. */
export function isNumeric(type: DataType): boolean {
  return DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type);
}
