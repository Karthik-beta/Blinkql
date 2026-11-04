// Summary statistics for benchmark samples.

export type Summary = {
  median: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  /** Every measured sample, in the order it was taken. */
  samples: number[];
};

/**
 * The q-th quantile (0 ≤ q ≤ 1) of `sorted`, which must be in ascending order. Interpolates
 * linearly between the two closest ranks (Hyndman & Fan type 7, the default in NumPy, R and
 * spreadsheet PERCENTILE), so the p95 of 10 samples sits between the 9th and 10th.
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError("quantile of an empty sample");
  if (q < 0 || q > 1) throw new RangeError(`quantile ${q} is outside [0, 1]`);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const below = sorted[lower] as number;
  const above = sorted[upper] as number;
  return below + (above - below) * (position - lower);
}

export function summarize(samples: readonly number[]): Summary {
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    min: sorted[0] as number,
    max: sorted.at(-1) as number,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    samples: [...samples],
  };
}
