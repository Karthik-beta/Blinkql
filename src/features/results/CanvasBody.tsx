import { type RefObject, useLayoutEffect, useRef } from "react";
import { drawCells, type Theme } from "./canvas-grid";
import { isNumeric, ROW_HEIGHT, scrollScale } from "./grid-layout";
import { getResult, type Result, readCell } from "./result-store";
import { type Cell, selectionBounds } from "./selection";

/**
 * How the results grid draws its rows: as DOM cells, or on a canvas (P-11), an experiment kept
 * behind a flag so the two can be benchmarked against each other.
 */
export type GridRenderer = "dom" | "canvas";

/**
 * The renderer a page's query string (`location.search`) asks for: `?grid=canvas`, or the DOM.
 * Always the DOM in forced colours (such as Windows High Contrast), whose system colours the
 * browser applies to DOM cells but not to what's drawn on a canvas.
 */
export function gridRenderer(search: string, forcedColors: boolean): GridRenderer {
  if (forcedColors) return "dom";
  return new URLSearchParams(search).get("grid") === "canvas" ? "canvas" : "dom";
}

type State = {
  result: Result;
  /** The columns' widths, as the grid's `--columns`; the columns are measured again when it changes. */
  template: string;
  bodyHeight: number;
  active: (Cell & { anchor: Cell }) | null;
};

function readTheme(grid: HTMLElement): Theme {
  const style = getComputedStyle(grid);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    font: `${style.fontSize} ${style.fontFamily}`,
    text: style.color,
    muted: token("--muted-foreground"),
    border: token("--border"),
    selection: token("--selection"),
    ring: token("--ring"),
  };
}

/**
 * Draws the grid's rows on `canvas` whenever they move: as it scrolls or resizes, gains or loses
 * the focus, or changes theme or font, at most once a frame; and at once when `update` is called.
 */
function painter(grid: HTMLElement, canvas: HTMLCanvasElement) {
  let state: State | null = null;
  let theme = readTheme(grid);
  let columns = { template: null as string | null, lefts: [] as number[], widths: [] as number[] };
  // The text of the cells drawn last time, by row, so a scroll reads only the rows it brings in.
  let cells = { resultId: -1, rows: new Map<number, (string | null | undefined)[]>() };
  let frame = 0;

  /** Each column's edges, from the header, which lays them out from the same `--columns`. */
  const measure = (template: string) => {
    const headers = grid.querySelectorAll<HTMLElement>('[role="columnheader"]');
    columns = {
      template,
      lefts: Array.from(headers, (header) => header.offsetLeft),
      widths: Array.from(headers, (header) => header.offsetWidth),
    };
  };

  const draw = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    // A newer result than the one last rendered has columns this one's state doesn't know about;
    // it's drawn when it renders.
    if (!state || getResult()?.id !== state.result.id) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { result, active } = state;
    if (columns.template !== state.template) measure(state.template);

    // As big as the viewport below the header, but no taller than the rows, which it mustn't
    // scroll past. Its negative margin keeps it out of the rows' way.
    const width = grid.clientWidth;
    const height = Math.max(0, Math.min(grid.clientHeight - ROW_HEIGHT, state.bodyHeight));
    const ratio = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.marginBottom = `${-height}px`;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (cells.resultId !== result.id) cells = { resultId: result.id, rows: new Map() };
    const previous = cells.rows;
    const rows = new Map<number, (string | null | undefined)[]>();
    const read = (row: number, column: number) => {
      let texts = rows.get(row);
      if (!texts) {
        texts = previous.get(row) ?? [];
        rows.set(row, texts);
      }
      let text = texts[column];
      if (text === undefined) {
        text = readCell(row, column);
        texts[column] = text;
      }
      return text;
    };

    const scrolled = grid.scrollTop;
    drawCells(context, {
      width,
      height,
      scrolled,
      offset: scrolled * scrollScale(grid, result.rowCount),
      scrollLeft: grid.scrollLeft,
      rowCount: result.rowCount,
      lefts: columns.lefts,
      widths: columns.widths,
      numeric: result.columns.map((column) => isNumeric(column.type)),
      selection: active ? selectionBounds(active.anchor, active) : null,
      active,
      focused: document.activeElement === grid,
      theme,
      read,
    });
    cells.rows = rows;
  };

  const schedule = () => {
    frame ||= requestAnimationFrame(draw);
  };
  const onThemeChange = () => {
    theme = readTheme(grid);
    schedule();
  };
  // A web font loading changes the font's width, and with it the columns' widths in `ch`.
  const onFontsLoaded = () => {
    columns.template = null;
    schedule();
  };

  grid.addEventListener("scroll", schedule, { passive: true });
  grid.addEventListener("focus", schedule);
  grid.addEventListener("blur", schedule);
  const resize = new ResizeObserver(schedule);
  resize.observe(grid);
  // The theme is a class on the root element (public/theme-init.js).
  const themeChange = new MutationObserver(onThemeChange);
  themeChange.observe(document.documentElement, { attributeFilter: ["class", "style"] });
  document.fonts?.addEventListener("loadingdone", onFontsLoaded);

  return {
    update(next: State) {
      state = next;
      draw();
    },
    dispose() {
      cancelAnimationFrame(frame);
      grid.removeEventListener("scroll", schedule);
      grid.removeEventListener("focus", schedule);
      grid.removeEventListener("blur", schedule);
      resize.disconnect();
      themeChange.disconnect();
      document.fonts?.removeEventListener("loadingdone", onFontsLoaded);
    },
  };
}

/**
 * The grid's rows drawn on a canvas, which stays put over the rows' viewport as they scroll under
 * it. Only the cells in view are drawn, each from the same text, alignment, borders, selection and
 * outline as the DOM grid's cells. The canvas is hidden from screen readers and lets clicks
 * through: the DOM cells, transparent above it, take both.
 */
export function CanvasBody({
  gridRef,
  ...props
}: State & { gridRef: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paint = useRef<ReturnType<typeof painter> | null>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const canvas = canvasRef.current;
    if (!grid || !canvas) return;
    const current = painter(grid, canvas);
    paint.current = current;
    return () => {
      current.dispose();
      paint.current = null;
    };
  }, [gridRef]);

  // Drawn before the browser paints, so the canvas shows a new result, selection or column width
  // in the same frame as the DOM cells do.
  const { result, template, bodyHeight, active } = props;
  useLayoutEffect(() => {
    paint.current?.update({ result, template, bodyHeight, active });
  }, [result, template, bodyHeight, active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none sticky top-6 left-0 block h-0 w-0"
    />
  );
}
