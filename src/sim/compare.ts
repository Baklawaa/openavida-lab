/**
 * Compare experimental conditions over replicates.
 *
 * Ticks-to-goal is a time-to-event outcome: lower is better. Effect sizes are
 * reported against a reference condition, so a positive shift means the
 * condition was slower. In paired mode the comparison uses only replicate
 * seeds present in both conditions (common random numbers), which removes the
 * between-seed variance that dominates unpaired comparisons.
 */
import type { TrialResult } from "./goals";
import { cliffsDelta, hedgesG, mean, pairedDifferences, quantile, wilsonInterval } from "./stats";

export interface ConditionSummary {
  label: string;
  n: number;
  successes: number;
  successRate: number;
  successRateCI: [number, number];
  medianTicks: number | null;
  meanTicks: number | null;
}

export interface ConditionEffect {
  label: string;
  /** Median of the paired differences (condition − reference); positive = slower. */
  medianShift: number | null;
  cliffsDelta: number;
  hedgesG: number;
  /** Replicates used in the comparison (paired: shared seeds only). */
  n: number;
}

export interface ConditionComparison {
  reference: string;
  paired: boolean;
  conditions: ConditionSummary[];
  effects: ConditionEffect[];
}

/** Ticks to goal per replicate seed, for replicates that reached it. */
function ticksBySeed(results: readonly TrialResult[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of results) {
    if (r.reachedTick === null) continue;
    map.set(r.seed, r.reachedTick - r.startTick);
  }
  return map;
}

export function summarizeCondition(label: string, results: readonly TrialResult[]): ConditionSummary {
  const ticks = [...ticksBySeed(results).values()].sort((a, b) => a - b);
  const n = results.length;
  return {
    label,
    n,
    successes: ticks.length,
    successRate: n ? ticks.length / n : 0,
    successRateCI: wilsonInterval(ticks.length, n),
    medianTicks: quantile(ticks, 0.5),
    meanTicks: ticks.length ? mean(ticks) : null,
  };
}

export function compareConditions(
  resultsByLabel: Record<string, readonly TrialResult[]>,
  opts: { reference?: string; paired?: boolean } = {},
): ConditionComparison {
  const labels = Object.keys(resultsByLabel);
  const reference = opts.reference && labels.includes(opts.reference) ? opts.reference : (labels[0] ?? "");
  const paired = Boolean(opts.paired);
  const refMap = ticksBySeed(resultsByLabel[reference] ?? []);
  const effects: ConditionEffect[] = [];
  for (const label of labels) {
    if (label === reference) {
      effects.push({ label, medianShift: 0, cliffsDelta: 0, hedgesG: 0, n: refMap.size });
      continue;
    }
    const map = ticksBySeed(resultsByLabel[label] ?? []);
    if (paired) {
      const commonSeeds = [...map.keys()].filter((s) => refMap.has(s)).sort((a, b) => a - b);
      const a = commonSeeds.map((s) => map.get(s)!);
      const b = commonSeeds.map((s) => refMap.get(s)!);
      effects.push({
        label,
        medianShift: quantile(pairedDifferences(a, b), 0.5),
        cliffsDelta: cliffsDelta(a, b),
        hedgesG: hedgesG(a, b),
        n: commonSeeds.length,
      });
    } else {
      const a = [...map.values()];
      const b = [...refMap.values()];
      effects.push({
        label,
        medianShift: a.length && b.length ? (quantile(a, 0.5) ?? 0) - (quantile(b, 0.5) ?? 0) : null,
        cliffsDelta: cliffsDelta(a, b),
        hedgesG: hedgesG(a, b),
        n: a.length,
      });
    }
  }
  return {
    reference,
    paired,
    conditions: labels.map((label) => summarizeCondition(label, resultsByLabel[label] ?? [])),
    effects,
  };
}
