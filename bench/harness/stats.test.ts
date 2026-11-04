import { describe, expect, it } from "vitest";
import { quantile, summarize } from "./stats.ts";

describe("quantile", () => {
  it("returns the middle value of an odd-length sample", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it("interpolates between the two middle values of an even-length sample", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("puts the p95 of 10 samples between the 9th and 10th", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    expect(quantile(sorted, 0.95)).toBeCloseTo(95.5);
  });

  it("returns the extremes at 0 and 1", () => {
    expect(quantile([3, 7, 9], 0)).toBe(3);
    expect(quantile([3, 7, 9], 1)).toBe(9);
  });

  it("handles a single sample", () => {
    expect(quantile([42], 0.95)).toBe(42);
  });

  it("rejects an empty sample and out-of-range quantiles", () => {
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], 1.5)).toThrow(RangeError);
  });
});

describe("summarize", () => {
  it("summarizes unsorted samples and keeps them in measurement order", () => {
    const samples = [30, 10, 20];

    expect(summarize(samples)).toEqual({
      median: 20,
      p95: 29,
      min: 10,
      max: 30,
      mean: 20,
      samples: [30, 10, 20],
    });
  });

  it("does not reorder the caller's array", () => {
    const samples = [3, 1, 2];
    summarize(samples);

    expect(samples).toEqual([3, 1, 2]);
  });
});
