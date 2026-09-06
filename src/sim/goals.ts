/**
 * Goal-directed trials: run a world from a snapshot until a measurable goal
 * holds (optionally sustained), or until a tick budget runs out.
 *
 * Pure and synchronous so it can run in a worker, in a test, or inline.
 */
import type { FieldName } from "./fields";
import { TRAIT_NAMES, type TraitName } from "./mapping";
import { Rng } from "./rng";
import type { SimParams, WorldSnapshot } from "./types";
import { World, worldFromSnapshot } from "./world";

export type GoalMetric =
  | { kind: "trait"; trait: TraitName; stat: "mean" | "max" }
  /** Fraction of living organisms standing on a cell where `field >= min`. */
  | { kind: "share-in-field"; field: FieldName; min: number }
  | { kind: "population" }
  | { kind: "strain-count"; strainId: number }
  | { kind: "strain-share"; strainId: number }
  | { kind: "shannon" }
  | { kind: "meanFitness" }
  | { kind: "lineages" };

export type GoalOp = ">=" | "<=";

export interface Goal {
  metric: GoalMetric;
  op: GoalOp;
  target: number;
  /** Consecutive ticks the condition must hold (1 = first hit). */
  sustain: number;
}

export interface TrialConfig {
  seed: number;
  maxTicks: number;
  /** Record the metric every n ticks (plus the last tick). */
  sampleEvery: number;
  overrides?: Partial<Pick<SimParams, "mutationRate" | "disturbances" | "maxPopulation" | "reproduceEnergy">>;
  keepSnapshot?: boolean;
}

export interface TrialResult {
  seed: number;
  startTick: number;
  ticks: number;
  reachedTick: number | null;
  finalValue: number;
  finalPopulation: number;
  extinct: boolean;
  series: Array<[number, number]>;
  snapshot?: WorldSnapshot;
}

export interface TrialSummary {
  n: number;
  successes: number;
  successRate: number;
  medianTicks: number | null;
  meanTicks: number | null;
  minTicks: number | null;
  maxTicks: number | null;
  meanFinalValue: number;
  extinctions: number;
}

export function evaluateGoalMetric(world: World, metric: GoalMetric): number {
  const orgs = world.organisms;
  const n = orgs.length;
  switch (metric.kind) {
    case "population":
      return n;
    case "trait": {
      if (n === 0) return 0;
      if (metric.stat === "max") return orgs.reduce((m, o) => Math.max(m, o.ph[metric.trait]), -Infinity);
      let s = 0;
      for (const o of orgs) s += o.ph[metric.trait];
      return s / n;
    }
    case "share-in-field": {
      if (n === 0) return 0;
      const field = world.fields[metric.field];
      let k = 0;
      for (const o of orgs) if (field[o.y * world.w + o.x]! >= metric.min) k++;
      return k / n;
    }
    case "strain-count": {
      let k = 0;
      for (const o of orgs) if (o.strainId === metric.strainId) k++;
      return k;
    }
    case "strain-share": {
      if (n === 0) return 0;
      let k = 0;
      for (const o of orgs) if (o.strainId === metric.strainId) k++;
      return k / n;
    }
    case "shannon":
      return world.history.at(-1)?.shannon ?? 0;
    case "meanFitness":
      return world.history.at(-1)?.meanFitness ?? 0;
    case "lineages":
      return world.history.at(-1)?.lineageCount ?? 0;
  }
}

export function goalHolds(goal: Goal, value: number): boolean {
  return goal.op === ">=" ? value >= goal.target : value <= goal.target;
}

/** Build a fresh world from the snapshot with its own seed and overrides. */
export function worldForTrial(snapshot: WorldSnapshot, config: TrialConfig): World {
  const w = worldFromSnapshot(snapshot);
  if (config.overrides) Object.assign(w.params, config.overrides);
  if (config.overrides?.disturbances !== undefined) w.disturbances = config.overrides.disturbances;
  w.rng = new Rng(config.seed >>> 0 || 1);
  return w;
}

export function runTrial(
  snapshot: WorldSnapshot,
  goal: Goal,
  config: TrialConfig,
  onProgress?: (tick: number, value: number) => boolean | void,
): TrialResult {
  const w = worldForTrial(snapshot, config);
  const startTick = w.tick;
  const sustain = Math.max(1, Math.round(goal.sustain));
  const every = Math.max(1, Math.round(config.sampleEvery));
  const series: Array<[number, number]> = [];
  let streak = 0;
  let reachedTick: number | null = null;
  let value = evaluateGoalMetric(w, goal.metric);
  series.push([w.tick, value]);
  if (goalHolds(goal, value)) {
    streak = 1;
    if (sustain === 1) reachedTick = w.tick;
  }
  let extinct = w.organisms.length === 0;
  let steps = 0;
  while (reachedTick === null && !extinct && steps < config.maxTicks) {
    w.step();
    steps++;
    value = evaluateGoalMetric(w, goal.metric);
    if (steps % every === 0 || steps === config.maxTicks) series.push([w.tick, value]);
    if (goalHolds(goal, value)) {
      streak++;
      if (streak >= sustain) reachedTick = w.tick;
    } else streak = 0;
    extinct = w.organisms.length === 0;
    if (onProgress && steps % 20 === 0 && onProgress(w.tick, value) === false) break;
  }
  if (series[series.length - 1]![0] !== w.tick) series.push([w.tick, value]);
  const result: TrialResult = {
    seed: config.seed,
    startTick,
    ticks: steps,
    reachedTick,
    finalValue: value,
    finalPopulation: w.organisms.length,
    extinct,
    series,
  };
  if (config.keepSnapshot) result.snapshot = w.snapshot();
  return result;
}

export function summarizeTrials(results: readonly TrialResult[]): TrialSummary {
  const n = results.length;
  const hits = results.filter((r) => r.reachedTick !== null).map((r) => r.reachedTick! - r.startTick).sort((a, b) => a - b);
  const successes = hits.length;
  const median = successes ? (successes % 2 ? hits[(successes - 1) / 2]! : (hits[successes / 2 - 1]! + hits[successes / 2]!) / 2) : null;
  return {
    n,
    successes,
    successRate: n ? successes / n : 0,
    medianTicks: median,
    meanTicks: successes ? hits.reduce((s, v) => s + v, 0) / successes : null,
    minTicks: successes ? hits[0]! : null,
    maxTicks: successes ? hits[successes - 1]! : null,
    meanFinalValue: n ? results.reduce((s, r) => s + r.finalValue, 0) / n : 0,
    extinctions: results.filter((r) => r.extinct).length,
  };
}

/** Seeds for n replicates: base, base+1, … (never 0). */
export function replicateSeeds(base: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((base + i) >>> 0) || 1);
  return out;
}

export const GOAL_TRAITS: readonly TraitName[] = TRAIT_NAMES;
