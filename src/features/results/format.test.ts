import { describe, expect, it } from "vitest";
import { formatDuration, formatRows } from "./format";

describe("formatDuration", () => {
  it.each([
    [0.4, "0 ms"],
    [212.4, "212 ms"],
    [999.4, "999 ms"],
    [1000, "1.0 s"],
    [3420, "3.4 s"],
  ])("formats %s ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatRows", () => {
  it("counts rows", () => {
    expect(formatRows(0)).toBe("0 rows");
    expect(formatRows(1)).toBe("1 row");
    expect(formatRows(40)).toBe("40 rows");
  });
});
