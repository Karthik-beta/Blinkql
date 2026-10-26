import { describe, expect, it } from "vitest";
import { recordingContext } from "@/test/canvas";
import { gridRenderer } from "./CanvasBody";
import { drawCells, type Frame } from "./canvas-grid";
import { ROW_HEIGHT } from "./grid-layout";

const theme = {
  font: "12px monospace",
  text: "ink",
  muted: "muted",
  border: "border",
  selection: "selection",
  ring: "ring",
};

/** 1,000 rows of three 100 px columns, the first numeric, in a 250 × 240 px canvas. */
function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    width: 250,
    height: 10 * ROW_HEIGHT,
    scrolled: 0,
    offset: 0,
    scrollLeft: 0,
    rowCount: 1_000,
    lefts: [0, 100, 200],
    widths: [100, 100, 100],
    numeric: [true, false, false],
    selection: null,
    active: null,
    focused: false,
    theme,
    read: (row, column) => (column === 2 && row % 2 === 1 ? null : `${row}:${column}`),
    ...overrides,
  };
}

function draw(overrides: Partial<Frame> = {}) {
  const { context, drawn } = recordingContext();
  drawCells(context, frame(overrides));
  return drawn;
}

describe("drawCells", () => {
  it("draws only the cells in view", () => {
    const { texts } = draw({ scrolled: 240, offset: 240, scrollLeft: 120 });
    // Rows 10 to 19 fill the canvas; columns 1 and 2 are the ones scrolled into view.
    expect(texts.map(({ text }) => text)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `${10 + i}:1`),
      ...Array.from({ length: 10 }, (_, i) => (i % 2 === 1 ? "NULL" : `${10 + i}:2`)),
    ]);
    expect(texts[0]).toMatchObject({ x: 100 - 120 + 8, y: 11.5 });
  });

  it("places rows as the grid does when the result is scaled to fit the scrolling area", () => {
    // Scrolled 100 px, the rows having moved 1,000 px: row 41 is the first in view, partly.
    const { texts } = draw({ scrolled: 100, offset: 1_000 });
    expect(texts[0]).toMatchObject({ text: "41:0", y: 41 * ROW_HEIGHT - 1_000 + 11.5 });
  });

  it("aligns numbers on the right, inside the padding and border, and shows NULL muted", () => {
    const { texts } = draw();
    expect(texts.find(({ text }) => text === "0:0")).toMatchObject({
      x: 100 - 1 - 8,
      textAlign: "right",
      fillStyle: "ink",
    });
    expect(texts.find(({ text }) => text === "0:1")).toMatchObject({ x: 108, textAlign: "left" });
    expect(texts.find(({ text }) => text === "NULL")).toMatchObject({ fillStyle: "muted" });
  });

  it("cuts text short with an ellipsis when it's wider than its cell", () => {
    // 100 px less 17 px of padding and border fits 11 characters 7 px wide.
    const { texts } = draw({
      read: (_, column) => (column === 1 ? "x".repeat(12) : "x".repeat(11)),
    });
    expect(texts.find(({ x }) => x === 108)?.text).toBe(`${"x".repeat(10)}…`);
    expect(texts.find(({ x }) => x === 208)?.text).toBe("x".repeat(11));
  });

  it("shades the selected cells and outlines the active one only while the grid has focus", () => {
    const selection = { top: 1, bottom: 2, left: 0, right: 1 };
    const active = { row: 2, column: 1 };
    const shaded = draw({ selection, active }).rects.filter(({ style }) => style === "selection");
    expect(shaded).toEqual([
      { x: 0, y: 24, width: 100, height: 23, style: "selection", kind: "fill" },
      { x: 100, y: 24, width: 100, height: 23, style: "selection", kind: "fill" },
      { x: 0, y: 48, width: 100, height: 23, style: "selection", kind: "fill" },
      { x: 100, y: 48, width: 100, height: 23, style: "selection", kind: "fill" },
    ]);
    expect(draw({ selection, active }).rects.filter(({ kind }) => kind === "stroke")).toEqual([]);
    expect(
      draw({ selection, active, focused: true }).rects.filter(({ kind }) => kind === "stroke"),
    ).toEqual([{ x: 101, y: 49, width: 98, height: 21, style: "ring", kind: "stroke" }]);
  });

  it("draws nothing for an empty result", () => {
    expect(draw({ rowCount: 0 })).toEqual({ texts: [], rects: [] });
  });
});

describe("gridRenderer", () => {
  it("draws on a canvas only when asked to, and never in forced colours", () => {
    expect(gridRenderer("", false)).toBe("dom");
    expect(gridRenderer("?grid=canvas", false)).toBe("canvas");
    expect(gridRenderer("?grid=dom", false)).toBe("dom");
    expect(gridRenderer("?grid=canvas", true)).toBe("dom");
  });
});
