import { describe, expect, it } from "vitest";
import { lttb } from "./lttb";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("lttb", () => {
  it("returns a series no longer than the threshold unchanged", () => {
    const x = [0, 1, 2];
    const y = [5, 6, 7];
    expect(lttb(x, y, 3)).toEqual({ x, y });
    expect(lttb(x, y, 10)).toEqual({ x, y });
  });

  it("returns the series unchanged for a threshold below 3", () => {
    const x = range(10);
    expect(lttb(x, x, 2)).toEqual({ x, y: x });
  });

  it("keeps the first and last points and returns exactly the threshold", () => {
    const x = range(10_000);
    const y = x.map((i) => Math.sin(i / 100));
    const result = lttb(x, y, 1000);
    expect(result.x).toHaveLength(1000);
    expect(result.y).toHaveLength(1000);
    expect(result.x[0]).toBe(0);
    expect(result.x.at(-1)).toBe(9999);
    expect(result.y.at(-1)).toBe(y[9999]);
  });

  it("picks points from the series, in order of x", () => {
    const x = range(1000).map((i) => i * 2);
    const y = x.map((i) => (i * 7919) % 101);
    const result = lttb(x, y, 50);
    expect(result.x).toEqual([...result.x].sort((a, b) => a - b));
    result.x.forEach((xi, i) => {
      expect(y[xi / 2]).toBe(result.y[i]);
    });
  });

  it("keeps a lone spike that averaging would flatten", () => {
    const x = range(1000);
    const y = x.map((i) => (i === 503 ? 100 : 0));
    const result = lttb(x, y, 20);
    expect(result.y).toContain(100);
    expect(result.x).toContain(503);
  });
});
