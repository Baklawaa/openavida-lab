/**
 * Diversity measures that do not depend on sample size the way raw Shannon
 * does: Hill numbers, rarefaction, evenness and the Chao1 richness estimator.
 */
import { Rng } from "./rng";
import { shannonFromCounts } from "./metrics";

/** Hill numbers for q = 0 (richness), 1 (exp Shannon) and 2 (inverse Simpson). */
export function hillNumbers(counts: readonly number[], qs: readonly number[] = [0, 1, 2]): number[] {
  const present = counts.filter((c) => c > 0);
  const total = present.reduce((s, c) => s + c, 0);
  if (total <= 0) return qs.map(() => 0);
  return qs.map((q) => {
    if (q === 0) return present.length;
    // shannonFromCounts is in bits; Hill numbers need the exponential of Shannon in nats.
    if (Math.abs(q - 1) < 1e-9) return Math.exp(shannonFromCounts(present, total) * Math.LN2);
    let sum = 0;
    for (const c of present) sum += (c / total) ** q;
    return sum > 0 ? sum ** (1 / (1 - q)) : 0;
  });
}

/** Pielou evenness H / ln S. */
export function shannonEvenness(counts: readonly number[]): number {
  const present = counts.filter((c) => c > 0);
  const total = present.reduce((s, c) => s + c, 0);
  if (present.length <= 1 || total <= 0) return 0;
  // Same units on both sides: Shannon in bits over log2(S).
  return shannonFromCounts(present, total) / Math.log2(present.length);
}

export function richness(counts: readonly number[]): number {
  return counts.filter((c) => c > 0).length;
}

/** Chao1 richness estimator (observed + unseen species from singletons/doubletons). */
export function chao1(counts: readonly number[]): number {
  const present = counts.filter((c) => c > 0);
  const f1 = present.filter((c) => c === 1).length;
  const f2 = present.filter((c) => c === 2).length;
  if (f2 > 0) return present.length + (f1 * f1) / (2 * f2);
  return present.length + (f1 * (f1 - 1)) / 2;
}

/**
 * Rarefied richness: expected number of groups in a random subsample of size
 * `n`, estimated by seeded simulation so the value is reproducible.
 */
export function rarefy(counts: readonly number[], n: number, seed = 0x9e37, resamples = 200): number {
  const total = counts.reduce((s, c) => s + c, 0);
  if (n >= total) return richness(counts);
  if (n <= 0) return 0;
  const rng = new Rng(seed);
  const pool: number[] = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) pool.push(i);
  });
  let sum = 0;
  for (let r = 0; r < resamples; r++) {
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const j = rng.int(pool.length);
      seen.add(pool[j]!);
    }
    sum += seen.size;
  }
  return sum / resamples;
}
