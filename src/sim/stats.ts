/**
 * Inference helpers for replicate experiments.
 *
 * Everything here is deterministic given a seed: bootstrap intervals draw from
 * a seeded Rng, so a reported interval can be recomputed exactly. Nothing in
 * this module touches the simulation.
 */
import { Rng } from "./rng";

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function sd(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

/** Linear-interpolated quantile of an already sorted array. */
export function quantileSorted(sorted: readonly number[], q: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function quantile(values: readonly number[], q: number): number | null {
  return quantileSorted([...values].sort((a, b) => a - b), q);
}

/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
  alpha?: number;
}

/** Percentile bootstrap interval for any statistic of a sample. */
export function bootstrapCI(
  values: readonly number[],
  statistic: (sample: readonly number[]) => number | null,
  opts: BootstrapOptions = {},
): [number, number] | null {
  if (values.length === 0) return null;
  const resamples = Math.max(50, opts.resamples ?? 1000);
  const rng = new Rng(opts.seed ?? 0x5eed);
  const alpha = opts.alpha ?? 0.05;
  const draws: number[] = [];
  const n = values.length;
  const sample: number[] = new Array(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) sample[i] = values[rng.int(n)]!;
    const v = statistic(sample);
    if (v !== null && Number.isFinite(v)) draws.push(v);
  }
  if (draws.length === 0) return null;
  draws.sort((a, b) => a - b);
  const lo = quantileSorted(draws, alpha / 2);
  const hi = quantileSorted(draws, 1 - alpha / 2);
  return lo === null || hi === null ? null : [lo, hi];
}

/** Cliff's delta: P(a > b) − P(a < b), in [−1, 1]. */
export function cliffsDelta(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let gt = 0;
  let lt = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) gt++;
      else if (x < y) lt++;
    }
  }
  return (gt - lt) / (a.length * b.length);
}

/** Hedges' g: standardised mean difference with small-sample correction. */
export function hedgesG(a: readonly number[], b: readonly number[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const na = a.length;
  const nb = b.length;
  const pooled = Math.sqrt(((na - 1) * sd(a) ** 2 + (nb - 1) * sd(b) ** 2) / (na + nb - 2));
  if (pooled === 0) return 0;
  const d = (mean(a) - mean(b)) / pooled;
  const correction = 1 - 3 / (4 * (na + nb) - 9);
  return d * correction;
}

/** Paired differences a−b, for common-random-number designs. */
export function pairedDifferences(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a[i]! - b[i]!);
  return out;
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** Two-sided exact binomial test. */
export function binomialTest(k: number, n: number, p = 0.5): number {
  if (n <= 0) return 1;
  const logP = (i: number) => logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p);
  const observed = logP(k);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const lp = logP(i);
    if (lp <= observed + 1e-9) total += Math.exp(lp);
  }
  return Math.min(1, Math.max(0, total));
}
