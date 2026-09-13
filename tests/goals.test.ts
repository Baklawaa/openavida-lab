import { describe, expect, it } from "vitest";
import {
  World,
  evaluateGoalMetric,
  founderHeterotroph,
  founderResistant,
  goalHolds,
  replicateSeeds,
  runTrial,
  summarizeSweep,
  summarizeTrials,
  sweepConfigs,
  sweepValues,
  takeSnapshot,
  worldForTrial,
  worldFromSnapshot,
  type Goal,
  type TrialResult,
} from "../src/sim/index";

function toxinWorld(): World {
  const w = new World({ width: 32, height: 32, seed: 21, mutationRate: 1 });
  w.fields.nutrient.fill(0.3);
  // Food behind a toxin band on the right half.
  for (let y = 0; y < 32; y++) for (let x = 16; x < 32; x++) {
    w.fields.toxin[y * 32 + x] = 0.5;
    w.fields.nutrient[y * 32 + x] = 1.6;
  }
  w.injectStrain(founderHeterotroph(), 20, 6, 16);
  return w;
}

describe("goal metrics", () => {
  it("evaluates population, traits, field shares, strains and history metrics", () => {
    const w = new World({ width: 16, height: 16, seed: 1 });
    w.fields.toxin.fill(0);
    for (let x = 8; x < 16; x++) for (let y = 0; y < 16; y++) w.fields.toxin[y * 16 + x] = 0.4;
    w.defineStrain(founderResistant(), { name: "R", manual: true });
    w.injectStrain(founderHeterotroph(), 4, 3, 8);
    w.injectStrain(founderResistant(), 4, 12, 8);
    expect(evaluateGoalMetric(w, { kind: "population" })).toBe(8);
    const share = evaluateGoalMetric(w, { kind: "share-in-field", field: "toxin", min: 0.3 });
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    const resistMean = evaluateGoalMetric(w, { kind: "trait", trait: "resist", stat: "mean" });
    const resistMax = evaluateGoalMetric(w, { kind: "trait", trait: "resist", stat: "max" });
    expect(resistMax).toBeGreaterThan(resistMean);
    expect(evaluateGoalMetric(w, { kind: "strain-count", strainId: 1 })).toBe(4);
    expect(evaluateGoalMetric(w, { kind: "strain-share", strainId: 1 })).toBeCloseTo(0.5);
    w.recordMetrics();
    expect(evaluateGoalMetric(w, { kind: "lineages" })).toBe(2);
    expect(evaluateGoalMetric(w, { kind: "shannon" })).toBeGreaterThan(0);
    expect(goalHolds({ metric: { kind: "population" }, op: ">=", target: 8, sustain: 1 }, 8)).toBe(true);
    expect(goalHolds({ metric: { kind: "population" }, op: "<=", target: 7, sustain: 1 }, 8)).toBe(false);
  });

  it("runs a trial to a goal, respects sustain, budget, extinction and seeds", () => {
    const snap = takeSnapshot(toxinWorld());
    const goal: Goal = { metric: { kind: "share-in-field", field: "toxin", min: 0.3 }, op: ">=", target: 0.5, sustain: 3 };
    const r = runTrial(snap, goal, { seed: 7, maxTicks: 400, sampleEvery: 10 });
    expect(r.startTick).toBe(0);
    expect(r.series[0]![0]).toBe(0);
    expect(r.series.at(-1)![0]).toBe(r.startTick + r.ticks);
    expect(r.ticks).toBeLessThanOrEqual(400);
    if (r.reachedTick !== null) {
      expect(r.reachedTick).toBeGreaterThanOrEqual(3);
      expect(r.finalValue).toBeGreaterThanOrEqual(0.5);
    }
    // Immediate goals resolve at the start tick without stepping.
    const now = runTrial(snap, { metric: { kind: "population" }, op: ">=", target: 1, sustain: 1 }, { seed: 1, maxTicks: 50, sampleEvery: 5 });
    expect(now.reachedTick).toBe(0);
    expect(now.ticks).toBe(0);
    // Sustain > 1 needs at least sustain-1 more ticks.
    const sus = runTrial(snap, { metric: { kind: "population" }, op: ">=", target: 1, sustain: 4 }, { seed: 1, maxTicks: 50, sampleEvery: 5 });
    expect(sus.reachedTick).toBe(3);
    // Unreachable goal exhausts the budget.
    const never = runTrial(snap, { metric: { kind: "population" }, op: ">=", target: 1e6, sustain: 1 }, { seed: 1, maxTicks: 30, sampleEvery: 5, keepSnapshot: true });
    expect(never.reachedTick).toBe(null);
    expect(never.ticks).toBe(30);
    expect(never.snapshot?.tick).toBe(30);
    // Same seed reproduces, different seeds diverge (mutation rate 1 makes this near certain).
    const a = runTrial(snap, goal, { seed: 3, maxTicks: 60, sampleEvery: 5 });
    const b = runTrial(snap, goal, { seed: 3, maxTicks: 60, sampleEvery: 5 });
    const c = runTrial(snap, goal, { seed: 4, maxTicks: 60, sampleEvery: 5 });
    expect(a.series).toEqual(b.series);
    expect(a.series).not.toEqual(c.series);
    // Overrides apply to the trial world only.
    const quiet = runTrial(snap, goal, { seed: 3, maxTicks: 10, sampleEvery: 5, overrides: { mutationRate: 0 }, keepSnapshot: true });
    expect(quiet.snapshot!.params.mutationRate).toBe(0);
    expect(quiet.snapshot!.params.seed).toBe(3);
    expect(snap.params.mutationRate).toBe(1);
    // Extinction stops early.
    const empty = new World({ width: 8, height: 8, seed: 2 });
    const dead = runTrial(takeSnapshot(empty), goal, { seed: 1, maxTicks: 100, sampleEvery: 5 });
    expect(dead.extinct).toBe(true);
    expect(dead.ticks).toBe(0);
    // Progress callback can abort.
    const aborted = runTrial(snap, { metric: { kind: "population" }, op: ">=", target: 1e6, sustain: 1 }, { seed: 1, maxTicks: 100, sampleEvery: 5 }, () => false);
    expect(aborted.ticks).toBe(50);
    // A "≥" goal on a strain that died out stops as unreachable.
    const w2 = new World({ width: 16, height: 16, seed: 4 });
    w2.fields.nutrient.fill(1);
    w2.injectStrain(founderHeterotroph(), 6, 4, 4);
    const other = w2.injectStrain(founderResistant(), 3, 12, 12);
    expect(other).toBe(3);
    for (const o of w2.organisms) if (o.strainId === 2) o.energy = 0;
    w2.step();
    const gone = runTrial(takeSnapshot(w2), { metric: { kind: "strain-share", strainId: 2 }, op: ">=", target: 0.5, sustain: 1 }, { seed: 1, maxTicks: 200, sampleEvery: 5 });
    expect(gone.unreachable).toBe(true);
    expect(gone.ticks).toBe(0);
    expect(gone.extinct).toBe(false);
    const alive = runTrial(takeSnapshot(w2), { metric: { kind: "strain-share", strainId: 1 }, op: ">=", target: 2, sustain: 1 }, { seed: 1, maxTicks: 20, sampleEvery: 5 });
    expect(alive.unreachable).toBe(false);
    expect(alive.ticks).toBe(20);
  });

  it("summarizes replicates", () => {
    const mk = (reached: number | null, extinct = false): TrialResult => ({
      seed: 1, startTick: 10, ticks: 50, reachedTick: reached, reachedTicks: [reached], finalValue: 1, finalPopulation: extinct ? 0 : 5, extinct, unreachable: false, series: [], finalHash: "00000000",
    });
    const s = summarizeTrials([mk(30), mk(50), mk(null), mk(null, true)]);
    expect(s.n).toBe(4);
    expect(s.successes).toBe(2);
    expect(s.successRate).toBeCloseTo(0.5);
    expect(s.medianTicks).toBe(30);
    expect(s.minTicks).toBe(20);
    expect(s.maxTicks).toBe(40);
    expect(s.extinctions).toBe(1);
    expect(s.p25Ticks).toBe(25);
    expect(s.p75Ticks).toBe(35);
    expect(s.unreachable).toBe(0);
    expect(s.perGoal).toHaveLength(1);
    expect(s.perGoal[0]!.successes).toBe(2);
    expect(summarizeTrials([]).medianTicks).toBe(null);
    expect(summarizeTrials([]).perGoal).toEqual([{ successes: 0, successRate: 0, medianTicks: null, meanTicks: null, minTicks: null, maxTicks: null }]);
    expect(replicateSeeds(0xfffffffe, 3)).toEqual([0xfffffffe, 0xffffffff, 1]);
    const s2 = summarizeTrials([
      { ...mk(30), reachedTicks: [20, 30] },
      { ...mk(50), reachedTicks: [10, 50] },
      { ...mk(null), reachedTicks: [5, null] },
    ]);
    expect(s2.successes).toBe(2);
    expect(s2.perGoal).toHaveLength(2);
    expect(s2.perGoal[0]!.successes).toBe(3);
    expect(s2.perGoal[1]!.successes).toBe(2);
    expect(s2.perGoal[0]!.medianTicks).toBe(0);
    expect(s2.perGoal[1]!.medianTicks).toBe(30);
  });

  it("fieldScale multiplies the trial world fields and leaves the snapshot untouched", () => {
    const w = new World({ width: 16, height: 16, seed: 5 });
    w.fields.toxin.fill(0.4);
    w.injectStrain(founderHeterotroph(), 4, 8, 8);
    const snap = takeSnapshot(w);
    const metric = { kind: "share-in-field" as const, field: "toxin" as const, min: 0.3 };
    expect(evaluateGoalMetric(worldFromSnapshot(snap), metric)).toBe(1);
    const scaled = worldForTrial(snap, { seed: 1, maxTicks: 1, sampleEvery: 1, overrides: { fieldScale: { toxin: 0.5 } } });
    expect(evaluateGoalMetric(scaled, metric)).toBe(0);
    expect(evaluateGoalMetric(worldFromSnapshot(snap), metric)).toBe(1);
    const i = 8 * 16 + 8;
    expect(scaled.fields.toxin[i]!).toBeCloseTo(0.2, 6);
    expect(snap.toxin[i]!).toBeCloseTo(0.4, 6);
  });

  it("sweepConfigs is values × replicates with unique continuing seeds", () => {
    const values = sweepValues(0.25, 1, 4);
    expect(values).toHaveLength(4);
    expect(values[0]).toBeCloseTo(0.25);
    expect(values[3]).toBeCloseTo(1);
    const base = { seed: 10, maxTicks: 50, sampleEvery: 5 };
    const configs = sweepConfigs(base, "toxinScale", values, 3);
    expect(configs).toHaveLength(12);
    const seeds = configs.map((c) => c.seed);
    expect(new Set(seeds).size).toBe(12);
    expect(seeds.slice(0, 3)).toEqual([10, 11, 12]);
    expect(seeds.slice(3, 6)).toEqual([13, 14, 15]);
    expect(configs[0]!.overrides?.fieldScale?.toxin).toBeCloseTo(0.25);
    expect(configs[9]!.overrides?.fieldScale?.toxin).toBeCloseTo(1);
    const mut = sweepConfigs(base, "mutationRate", [0, 0.5], 2);
    expect(mut[0]!.overrides?.mutationRate).toBe(0);
    expect(mut[2]!.overrides?.mutationRate).toBe(0.5);
  });

  it("summarizeSweep reports one summary per value", () => {
    const mk = (reached: number | null, extinct = false): TrialResult => ({
      seed: 1, startTick: 0, ticks: 40, reachedTick: reached, reachedTicks: [reached], finalValue: 1, finalPopulation: extinct ? 0 : 4, extinct, unreachable: false, series: [], finalHash: "00000000",
    });
    const points = summarizeSweep([0.5, 1.5], [[mk(10), mk(20)], [mk(null), mk(null, true)]]);
    expect(points).toHaveLength(2);
    expect(points[0]!.value).toBe(0.5);
    expect(points[0]!.summary.successes).toBe(2);
    expect(points[0]!.summary.medianTicks).toBe(15);
    expect(points[1]!.summary.successes).toBe(0);
    expect(points[1]!.summary.extinctions).toBe(1);
  });

  it("records two goals at different ticks and stops when the rest are unreachable", () => {
    const snap = takeSnapshot(toxinWorld());
    const gNow: Goal = { metric: { kind: "population" }, op: ">=", target: 1, sustain: 1 };
    const gLater: Goal = { metric: { kind: "population" }, op: ">=", target: 1, sustain: 5 };
    const both = runTrial(snap, [gNow, gLater], { seed: 1, maxTicks: 50, sampleEvery: 5 });
    expect(both.reachedTicks).toEqual([0, 4]);
    expect(both.reachedTick).toBe(4);
    expect(both.ticks).toBe(4);
    const one = runTrial(snap, gNow, { seed: 1, maxTicks: 10, sampleEvery: 5 });
    expect(one.reachedTicks).toEqual([0]);
    expect(one.reachedTick).toBe(0);

    const w2 = new World({ width: 16, height: 16, seed: 4 });
    w2.fields.nutrient.fill(1);
    w2.injectStrain(founderHeterotroph(), 6, 4, 4);
    expect(w2.injectStrain(founderResistant(), 3, 12, 12)).toBe(3);
    for (const o of w2.organisms) if (o.strainId === 2) o.energy = 0;
    w2.step();
    const gPop: Goal = { metric: { kind: "population" }, op: ">=", target: 1, sustain: 4 };
    const gGone: Goal = { metric: { kind: "strain-share", strainId: 2 }, op: ">=", target: 0.5, sustain: 1 };
    const stop = runTrial(takeSnapshot(w2), [gPop, gGone], { seed: 1, maxTicks: 200, sampleEvery: 5 });
    expect(stop.startTick).toBe(1);
    expect(stop.reachedTicks[0]).toBe(4);
    expect(stop.reachedTicks[1]).toBe(null);
    expect(stop.reachedTick).toBe(null);
    expect(stop.unreachable).toBe(true);
    expect(stop.ticks).toBe(3);
    expect(stop.extinct).toBe(false);
  });

  it("the same seed hashes identically when two trials keep their end snapshots", () => {
    const snap = takeSnapshot(toxinWorld());
    const goal: Goal = { metric: { kind: "population" }, op: ">=", target: 1e9, sustain: 1 };
    const cfg = { seed: 9, maxTicks: 25, sampleEvery: 5, keepSnapshot: true } as const;
    const a = runTrial(snap, goal, cfg);
    const b = runTrial(snap, goal, cfg);
    expect(a.snapshot).toBeTruthy();
    expect(worldFromSnapshot(a.snapshot!).hashState()).toBe(worldFromSnapshot(b.snapshot!).hashState());
  });
});
