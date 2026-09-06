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

export type SweepVariable =
  | "mutationRate"
  | "maxPopulation"
  | "reproduceEnergy"
  | "toxinScale"
  | "nutrientScale"
  | "temperatureScale"
  | "lightScale";

export const SWEEP_VARIABLES: readonly SweepVariable[] = [
  "mutationRate",
  "maxPopulation",
  "reproduceEnergy",
  "toxinScale",
  "nutrientScale",
  "temperatureScale",
  "lightScale",
];

const SWEEP_FIELD: Partial<Record<SweepVariable, FieldName>> = {
  toxinScale: "toxin",
  nutrientScale: "nutrient",
  temperatureScale: "temperature",
  lightScale: "light",
};

export interface TrialConfig {
  seed: number;
  maxTicks: number;
  /** Record the metric every n ticks (plus the last tick). */
  sampleEvery: number;
  overrides?: Partial<Pick<SimParams, "mutationRate" | "disturbances" | "maxPopulation" | "reproduceEnergy">> & {
    fieldScale?: Partial<Record<FieldName, number>>;
  };
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
  /** Stopped early because the goal can no longer be met (e.g. the tracked strain died out). */
  unreachable: boolean;
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
  p25Ticks: number | null;
  p75Ticks: number | null;
  meanFinalValue: number;
  extinctions: number;
  unreachable: number;
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

/** True when no future tick can satisfy the goal: a "≥" goal on a strain that has no living member left. */
export function goalUnreachable(goal: Goal, world: World): boolean {
  const m = goal.metric;
  if (goal.op !== ">=" || goal.target <= 0) return false;
  if (m.kind !== "strain-count" && m.kind !== "strain-share") return false;
  for (const o of world.organisms) if (o.strainId === m.strainId) return false;
  return true;
}

function scaleField(arr: Float32Array, k: number): void {
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! * k;
}

/** Build a fresh world from the snapshot with its own seed and overrides. */
export function worldForTrial(snapshot: WorldSnapshot, config: TrialConfig): World {
  const w = worldFromSnapshot(snapshot);
  if (config.overrides) {
    const { fieldScale, ...params } = config.overrides;
    Object.assign(w.params, params);
    if (fieldScale) {
      for (const name of Object.keys(fieldScale) as FieldName[]) {
        const k = fieldScale[name];
        if (k === undefined || !Number.isFinite(k)) continue;
        scaleField(w.fields[name], k);
      }
    }
  }
  if (config.overrides?.disturbances !== undefined) w.disturbances = config.overrides.disturbances;
  // The replicate seed becomes the world's seed: the RNG restarts from it and the status bar / share link report it.
  const seed = config.seed >>> 0 || 1;
  Object.assign(w.params, { seed });
  w.rng = new Rng(seed);
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
  let unreachable = reachedTick === null && !extinct && goalUnreachable(goal, w);
  let steps = 0;
  while (reachedTick === null && !extinct && !unreachable && steps < config.maxTicks) {
    w.step();
    steps++;
    value = evaluateGoalMetric(w, goal.metric);
    if (steps % every === 0 || steps === config.maxTicks) series.push([w.tick, value]);
    if (goalHolds(goal, value)) {
      streak++;
      if (streak >= sustain) reachedTick = w.tick;
    } else streak = 0;
    extinct = w.organisms.length === 0;
    if (reachedTick === null && !extinct) unreachable = goalUnreachable(goal, w);
    if (onProgress && steps % 50 === 0 && onProgress(w.tick, value) === false) break;
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
    unreachable,
    series,
  };
  if (config.keepSnapshot) result.snapshot = w.snapshot();
  return result;
}

export function summarizeTrials(results: readonly TrialResult[]): TrialSummary {
  const n = results.length;
  const hits = results.filter((r) => r.reachedTick !== null).map((r) => r.reachedTick! - r.startTick).sort((a, b) => a - b);
  const successes = hits.length;
  const quantile = (q: number): number | null => {
    if (!successes) return null;
    const pos = (successes - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.min(successes - 1, lo + 1);
    return hits[lo]! + (hits[hi]! - hits[lo]!) * (pos - lo);
  };
  return {
    n,
    successes,
    successRate: n ? successes / n : 0,
    medianTicks: quantile(0.5),
    meanTicks: successes ? hits.reduce((s, v) => s + v, 0) / successes : null,
    minTicks: successes ? hits[0]! : null,
    maxTicks: successes ? hits[successes - 1]! : null,
    p25Ticks: quantile(0.25),
    p75Ticks: quantile(0.75),
    meanFinalValue: n ? results.reduce((s, r) => s + r.finalValue, 0) / n : 0,
    extinctions: results.filter((r) => r.extinct).length,
    unreachable: results.filter((r) => r.unreachable).length,
  };
}

/** Seeds for n replicates: base, base+1, … (never 0). */
export function replicateSeeds(base: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((base + i) >>> 0) || 1);
  return out;
}

/** Linear inclusive grid. `steps` is the number of values (≥ 2). */
export function sweepValues(from: number, to: number, steps: number): number[] {
  const n = Math.max(2, Math.round(steps));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1));
  return out;
}

export function applySweepValue(base: TrialConfig, variable: SweepVariable, value: number): TrialConfig {
  const overrides = { ...base.overrides, fieldScale: { ...base.overrides?.fieldScale } };
  const field = SWEEP_FIELD[variable];
  if (field) overrides.fieldScale = { ...overrides.fieldScale, [field]: value };
  else if (variable === "mutationRate" || variable === "maxPopulation" || variable === "reproduceEnergy") {
    overrides[variable] = value;
  }
  return { ...base, overrides };
}

/**
 * One TrialConfig per (value, replicate). Seeds continue across values:
 * value 0 uses base.seed … base.seed+R-1, value 1 uses the next R seeds, etc.
 */
export function sweepConfigs(
  base: TrialConfig,
  variable: SweepVariable,
  values: readonly number[],
  replicates: number,
): TrialConfig[] {
  const R = Math.max(1, Math.round(replicates));
  const out: TrialConfig[] = [];
  let seed = base.seed >>> 0 || 1;
  for (const value of values) {
    const seeds = replicateSeeds(seed, R);
    seed = ((seeds[seeds.length - 1]! + 1) >>> 0) || 1;
    for (const s of seeds) out.push(applySweepValue({ ...base, seed: s }, variable, value));
  }
  return out;
}

export interface SweepPoint {
  value: number;
  summary: TrialSummary;
}

export function summarizeSweep(values: readonly number[], resultsPerValue: readonly (readonly TrialResult[])[]): SweepPoint[] {
  return values.map((value, i) => ({ value, summary: summarizeTrials(resultsPerValue[i] ?? []) }));
}

export const GOAL_TRAITS: readonly TraitName[] = TRAIT_NAMES;
