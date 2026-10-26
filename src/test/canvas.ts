// jsdom has no canvas 2D context, so tests that draw use this one, which records what's drawn.
import { vi } from "vitest";

export type Drawn = {
  /** Each fillText: the text, where, and in which colour and alignment. */
  texts: { text: string; x: number; y: number; fillStyle: string; textAlign: string }[];
  /** Each fillRect and strokeRect, with its colour. */
  rects: { x: number; y: number; width: number; height: number; style: string; kind: string }[];
};

/** A 2D context whose characters are all `charWidth` px wide, and what's been drawn on it. */
export function recordingContext(charWidth = 7) {
  const drawn: Drawn = { texts: [], rects: [] };
  const context = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineWidth: 1,
    clearRect: vi.fn(() => {
      drawn.texts.length = 0;
      drawn.rects.length = 0;
    }),
    fillRect(x: number, y: number, width: number, height: number) {
      drawn.rects.push({ x, y, width, height, style: context.fillStyle, kind: "fill" });
    },
    strokeRect(x: number, y: number, width: number, height: number) {
      drawn.rects.push({ x, y, width, height, style: context.strokeStyle, kind: "stroke" });
    },
    fillText(text: string, x: number, y: number) {
      drawn.texts.push({
        text,
        x,
        y,
        fillStyle: context.fillStyle,
        textAlign: context.textAlign,
      });
    },
    measureText: (text: string) => ({ width: text.length * charWidth }),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  };
  return { context: context as unknown as CanvasRenderingContext2D, drawn };
}

/** Makes every canvas draw on `context`. */
export function mockCanvasContext(context: CanvasRenderingContext2D): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => context) as unknown as HTMLCanvasElement["getContext"],
  );
}
