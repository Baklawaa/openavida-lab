/**
 * Selection, drift and molecular-clock statistics derived from a run's
 * history and innovation log. Pure functions; no simulation state.
 */
import { TRAIT_NAMES, type Phenotype, type TraitName } from "./mapping";
import { binomialTest } from "./stats";
import type { Organism, TraitDistribution } from "./types";

export type { TraitDistribution };

export interface FrequencyPoint {
  tick: number;
  count: number;
  total: number;
}

const logit = (p: number): number => Math.log(p / (1 - p));

/**
 * Per-tick selection coefficient estimated as the least-squares slope of
 * logit(frequency) against time. Points with frequency 0 or 1 are skipped
 * (logit is undefined); fewer than two usable points gives null.
 */
export function selectionCoefficient(series: readonly FrequencyPoint[]): number | null {
  const points: Array<[number, number]> = [];
  for (const p of series) {
    if (p.total <= 0) continue;
    const f = p.count / p.total;
    if (f <= 0 || f >= 1) continue;
    points.push([p.tick, logit(f)]);
  }
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Expected fixations under neutral drift, and a two-sided exact test. */
export function fixationVsDrift(
  founderFrequency: number,
  observedFixations: number,
  replicates: number,
): { expected: number; pValue: number } {
  const p = Math.min(1, Math.max(0, founderFrequency));
  return {
    expected: p * replicates,
    pValue: binomialTest(observedFixations, replicates, p),
  };
}

export function traitDistribution(organisms: readonly Organism[]): Partial<Record<TraitName, TraitDistribution>> {
  const out: Partial<Record<TraitName, TraitDistribution>> = {};
  const n = organisms.length;
  if (n === 0) return out;
  for (const trait of TRAIT_NAMES) {
    const values = organisms.map((o) => o.ph[trait]).sort((a, b) => a - b);
    const m = values.reduce((s, v) => s + v, 0) / n;
    let ss = 0;
    for (const v of values) ss += (v - m) ** 2;
    // Rounded to three decimals: this lands in every history row, which the
    // timeline embeds in every snapshot, so full float precision is pure waste.
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    out[trait] = {
      mean: r3(m),
      sd: r3(n > 1 ? Math.sqrt(ss / (n - 1)) : 0),
      q05: r3(values[Math.floor(0.05 * (n - 1))]!),
      q50: r3(values[Math.floor(0.5 * (n - 1))]!),
      q95: r3(values[Math.floor(0.95 * (n - 1))]!),
    };
  }
  return out;
}

export interface NeutralSubstitution {
  tick: number;
  orgId: number;
  lineageId: number;
  from: number;
  to: number;
}

/**
 * Fitness-neutral difference between parent and child: every trait except the
 * display-only hue is unchanged. Synonymous codon swaps (two codons of the same
 * trait and delta), substitutions outside ORFs, and changes that only move the
 * hue all qualify — which is what a molecular clock counts. Hue may move, but
 * it does not have to.
 */
export function neutralOnly(parent: Phenotype, child: Phenotype): boolean {
  for (const trait of TRAIT_NAMES) {
    if (trait === "hue") continue;
    if (Math.abs(child[trait] - parent[trait]) > 1e-9) return false;
  }
  return true;
}

/** Substitutions per 100 ticks per lineage, from the neutral log. */
export function molecularClock(log: readonly NeutralSubstitution[], ticks: number, lineages: number): number {
  if (ticks <= 0 || lineages <= 0) return 0;
  return (log.length / lineages) * (100 / ticks);
}


