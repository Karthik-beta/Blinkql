// Largest-Triangle-Three-Buckets (Steinarsson, 2013): reduces a line to `threshold` of its own
// points, keeping the ones that change its shape most, so peaks and dips survive.

/** Only called with indexes inside the series. */
const at = (values: ArrayLike<number>, index: number) => values[index] as number;

export type Series = { x: number[]; y: number[] };

/**
 * The points of the series (x ascending) that LTTB keeps: always the first and last, and one from
 * each of `threshold - 2` equal buckets in between, the one forming the largest triangle with the
 * point kept before it and the average of the next bucket. A series no longer than `threshold`,
 * or a threshold below 3, is returned as it is.
 */
export function lttb(x: ArrayLike<number>, y: ArrayLike<number>, threshold: number): Series {
  const length = x.length;
  if (threshold < 3 || length <= threshold) return { x: Array.from(x), y: Array.from(y) };

  const outX = [at(x, 0)];
  const outY = [at(y, 0)];
  const size = (length - 2) / (threshold - 2);
  let kept = 0;
  for (let bucket = 0; bucket < threshold - 2; bucket++) {
    const start = Math.floor(bucket * size) + 1;
    const end = Math.floor((bucket + 1) * size) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * size) + 1, length);
    let avgX = 0;
    let avgY = 0;
    for (let i = end; i < nextEnd; i++) {
      avgX += at(x, i);
      avgY += at(y, i);
    }
    const count = nextEnd - end;
    avgX /= count;
    avgY /= count;

    const ax = at(x, kept);
    const ay = at(y, kept);
    let largest = -1;
    let chosen = start;
    for (let i = start; i < end; i++) {
      const area = Math.abs((ax - avgX) * (at(y, i) - ay) - (ax - at(x, i)) * (avgY - ay));
      if (area > largest) {
        largest = area;
        chosen = i;
      }
    }
    outX.push(at(x, chosen));
    outY.push(at(y, chosen));
    kept = chosen;
  }
  outX.push(at(x, length - 1));
  outY.push(at(y, length - 1));
  return { x: outX, y: outY };
}
