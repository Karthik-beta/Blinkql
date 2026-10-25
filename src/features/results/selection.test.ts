import { describe, expect, it } from "vitest";
import { selectionBounds, selectionText } from "./selection";

const rows = [
  ["1", "press"],
  ["2", null],
  ["3", "lathe"],
];
const read = (row: number, column: number) => rows[row]?.[column] ?? null;

describe("selectionBounds", () => {
  it("spans the anchor and the active cell, whichever way it was drawn", () => {
    expect(selectionBounds({ row: 2, column: 1 }, { row: 0, column: 0 })).toEqual({
      top: 0,
      bottom: 2,
      left: 0,
      right: 1,
    });
  });
});

describe("selectionText", () => {
  it("copies one cell as its text", () => {
    expect(selectionText({ top: 2, bottom: 2, left: 1, right: 1 }, read)).toBe("lathe");
  });

  it("copies a block as tab-separated rows, with NULL as an empty cell", () => {
    expect(selectionText({ top: 0, bottom: 2, left: 0, right: 1 }, read)).toBe(
      "1\tpress\n2\t\n3\tlathe",
    );
  });

  it("quotes values holding a tab, a line break or a quote, as spreadsheets expect", () => {
    const odd = ["a\tb", "two\nlines", 'say "hi"'];
    const text = selectionText({ top: 0, bottom: 2, left: 0, right: 0 }, (row) => odd[row] ?? null);
    expect(text).toBe('"a\tb"\n"two\nlines"\n"say ""hi"""');
  });
});
