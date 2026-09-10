/**
 * Small shared geometry helpers. Extracted so the per-strain tracks in
 * World.recordMetrics and the group statistics in species.ts cannot drift apart.
 */

export interface CentroidSpread {
  cx: number;
  cy: number;
  /** Root-mean-square distance to the centroid, in cells. */
  spread: number;
}

/** Centroid and RMS spread of a point set. Empty input gives the origin. */
export function centroidSpread(xs: readonly number[], ys: readonly number[]): CentroidSpread {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { cx: 0, cy: 0, spread: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const cx = sx / n;
  const cy = sy / n;
  let d2 = 0;
  for (let i = 0; i < n; i++) {
    d2 += (xs[i]! - cx) ** 2 + (ys[i]! - cy) ** 2;
  }
  return { cx, cy, spread: Math.sqrt(d2 / n) };
}
