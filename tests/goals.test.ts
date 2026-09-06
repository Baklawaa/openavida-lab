import { describe, expect, it } from "vitest";
import {
  World,
  evaluateGoalMetric,
  founderHeterotroph,
  founderResistant,
  goalHolds,
  replicateSeeds,
  runTrial,
  summarizeTrials,
  takeSnapshot,
  type Goal,
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
    expect(snap.params.mutationRate).toBe(1);
    // Extinction stops early.
    const empty = new World({ width: 8, height: 8, seed: 2 });
    const dead = runTrial(takeSnapshot(empty), goal, { seed: 1, maxTicks: 100, sampleEvery: 5 });
    expect(dead.extinct).toBe(true);
    expect(dead.ticks).toBe(0);
    // Progress callback can abort.
    const aborted = runTrial(snap, { metric: { kind: "population" }, op: ">=", target: 1e6, sustain: 1 }, { seed: 1, maxTicks: 100, sampleEvery: 5 }, () => false);
    expect(aborted.ticks).toBe(20);
  });

  it("summarizes replicates", () => {
    const mk = (reached: number | null, extinct = false) => ({ seed: 1, startTick: 10, ticks: 50, reachedTick: reached, finalValue: 1, finalPopulation: extinct ? 0 : 5, extinct, series: [] as Array<[number, number]> });
    const s = summarizeTrials([mk(30), mk(50), mk(null), mk(null, true)]);
    expect(s.n).toBe(4);
    expect(s.successes).toBe(2);
    expect(s.successRate).toBeCloseTo(0.5);
    expect(s.medianTicks).toBe(30);
    expect(s.minTicks).toBe(20);
    expect(s.maxTicks).toBe(40);
    expect(s.extinctions).toBe(1);
    expect(summarizeTrials([]).medianTicks).toBe(null);
    expect(replicateSeeds(0xfffffffe, 3)).toEqual([0xfffffffe, 0xffffffff, 1]);
  });
});
