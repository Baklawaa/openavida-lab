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
  /** Per-goal reached ticks (same length as the goals array). */
  reachedTicks: Array<number | null>;
  finalValue: number;
  finalPopulation: number;
  extinct: boolean;
  /** Stopped early because the goal can no longer be met (e.g. the tracked strain died out). */
  unreachable: boolean;
  series: Array<[number, number]>;
  snapshot?: WorldSnapshot;
}

export interface GoalHitSummary {
  successes: number;
  successRate: number;
  medianTicks: number | null;
  meanTicks: number | null;
  minTicks: number | null;
  maxTicks: number | null;
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
  /** One summary per goal (length 1 when the trial used a single goal). */
  perGoal: GoalHitSummary[];
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

export function asGoals(goal: Goal | Goal[]): Goal[] {
  return Array.isArray(goal) ? goal : [goal];
}

/** Per-goal reached ticks; falls back to the single `reachedTick` on older records. */
export function trialGoalTicks(r: TrialResult): Array<number | null> {
  return r.reachedTicks && r.reachedTicks.length ? r.reachedTicks : [r.reachedTick];
}

export function runTrial(
  snapshot: WorldSnapshot,
  goal: Goal | Goal[],
  config: TrialConfig,
  onProgress?: (tick: number, value: number) => boolean | void,
): TrialResult {
  const goals = asGoals(goal);
  const w = worldForTrial(snapshot, config);
  const startTick = w.tick;
  const every = Math.max(1, Math.round(config.sampleEvery));
  const series: Array<[number, number]> = [];
  if (goals.length === 0) {
    return {
      seed: config.seed,
      startTick,
      ticks: 0,
      reachedTick: null,
      reachedTicks: [],
      finalValue: 0,
      finalPopulation: w.organisms.length,
      extinct: w.organisms.length === 0,
      unreachable: false,
      series: [[w.tick, 0]],
    };
  }
  const primary = goals[0]!;
  const streaks = goals.map(() => 0);
  const reachedTicks: Array<number | null> = goals.map(() => null);
  const update = (): number => {
    const value = evaluateGoalMetric(w, primary.metric);
    for (let i = 0; i < goals.length; i++) {
      if (reachedTicks[i] !== null) continue;
      const g = goals[i]!;
      if (goalHolds(g, evaluateGoalMetric(w, g.metric))) {
        streaks[i]++;
        if (streaks[i]! >= Math.max(1, Math.round(g.sustain))) reachedTicks[i] = w.tick;
      } else streaks[i] = 0;
    }
    return value;
  };
  let value = update();
  series.push([w.tick, value]);
  let extinct = w.organisms.length === 0;
  const remainingUnreachable = () =>
    goals.every((g, i) => reachedTicks[i] !== null || goalUnreachable(g, w));
  let unreachable = !extinct && remainingUnreachable() && reachedTicks.some((t) => t === null);
  let steps = 0;
  while (reachedTicks.some((t) => t === null) && !extinct && !unreachable && steps < config.maxTicks) {
    w.step();
    steps++;
    value = update();
    if (steps % every === 0 || steps === config.maxTicks) series.push([w.tick, value]);
    extinct = w.organisms.length === 0;
    if (reachedTicks.some((t) => t === null) && !extinct) unreachable = remainingUnreachable();
    if (onProgress && steps % 50 === 0 && onProgress(w.tick, value) === false) break;
  }
  if (series[series.length - 1]![0] !== w.tick) series.push([w.tick, value]);
  const allHit = reachedTicks.every((t) => t !== null);
  const reachedTick = allHit
    ? reachedTicks.reduce((m, t) => Math.max(m!, t!), 0)
    : reachedTicks.length === 1
      ? reachedTicks[0]!
      : null;
  const result: TrialResult = {
    seed: config.seed,
    startTick,
    ticks: steps,
    reachedTick,
    reachedTicks,
    finalValue: value,
    finalPopulation: w.organisms.length,
    extinct,
    unreachable,
    series,
  };
  if (config.keepSnapshot) result.snapshot = w.snapshot();
  return result;
}

function quantileOf(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function hitSummary(hits: number[], n: number): GoalHitSummary {
  const sorted = hits.slice().sort((a, b) => a - b);
  const k = sorted.length;
  return {
    successes: k,
    successRate: n ? k / n : 0,
    medianTicks: quantileOf(sorted, 0.5),
    meanTicks: k ? sorted.reduce((s, v) => s + v, 0) / k : null,
    minTicks: k ? sorted[0]! : null,
    maxTicks: k ? sorted[k - 1]! : null,
  };
}

export function summarizeTrials(results: readonly TrialResult[]): TrialSummary {
  const n = results.length;
  const hits = results.filter((r) => r.reachedTick !== null).map((r) => r.reachedTick! - r.startTick).sort((a, b) => a - b);
  const successes = hits.length;
  const goalCount = results.reduce((m, r) => Math.max(m, trialGoalTicks(r).length), 0);
  const perGoal: GoalHitSummary[] = [];
  for (let i = 0; i < Math.max(1, goalCount); i++) {
    const gHits: number[] = [];
    for (const r of results) {
      const t = trialGoalTicks(r)[i];
      if (t !== null && t !== undefined) gHits.push(t - r.startTick);
    }
    perGoal.push(hitSummary(gHits, n));
  }
  return {
    n,
    successes,
    successRate: n ? successes / n : 0,
    medianTicks: quantileOf(hits, 0.5),
    meanTicks: successes ? hits.reduce((s, v) => s + v, 0) / successes : null,
    minTicks: successes ? hits[0]! : null,
    maxTicks: successes ? hits[successes - 1]! : null,
    p25Ticks: quantileOf(hits, 0.25),
    p75Ticks: quantileOf(hits, 0.75),
    meanFinalValue: n ? results.reduce((s, r) => s + r.finalValue, 0) / n : 0,
    extinctions: results.filter((r) => r.extinct).length,
    unreachable: results.filter((r) => r.unreachable).length,
    perGoal,
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
