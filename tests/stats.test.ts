import { describe, expect, it } from "vitest";
import {
  binomialTest,
  bootstrapCI,
  cliffsDelta,
  hedgesG,
  pairedDifferences,
  quantile,
  summarizeTrials,
  wilsonInterval,
  type TrialResult,
} from "../src/sim/index";

function result(reachedTick: number | null): TrialResult {
  return {
    seed: 1,
    startTick: 0,
    ticks: 100,
    reachedTick,
    reachedTicks: [reachedTick],
    finalValue: 1,
    finalPopulation: 10,
    extinct: false,
    unreachable: false,
    series: [],
  };
}

describe("inference helpers", () => {
  it("brackets a binomial proportion", () => {
    const [lo, hi] = wilsonInterval(50, 100);
    expect(lo).toBeGreaterThan(0.39);
    expect(hi).toBeLessThan(0.61);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
    expect(wilsonInterval(10, 10)[1]).toBeLessThanOrEqual(1);
  });

  it("bootstraps a median deterministically and brackets the sample", () => {
    const values = Array.from({ length: 60 }, (_, i) => i + 1);
    const a = bootstrapCI(values, (s) => quantile(s, 0.5), { seed: 7 });
    const b = bootstrapCI(values, (s) => quantile(s, 0.5), { seed: 7 });
    expect(a).toEqual(b);
    expect(a![0]).toBeLessThanOrEqual(30.5);
    expect(a![1]).toBeGreaterThanOrEqual(30.5);
    const constant = bootstrapCI([4, 4, 4, 4], (s) => quantile(s, 0.5), { seed: 1 });
    expect(constant).toEqual([4, 4]);
    expect(bootstrapCI([], () => 0)).toBeNull();
  });

  it("measures effect sizes", () => {
    expect(cliffsDelta([2, 3, 4], [0, 1])).toBe(1);
    expect(cliffsDelta([0, 1], [2, 3, 4])).toBe(-1);
    expect(cliffsDelta([1, 2], [1, 2])).toBe(0);
    expect(hedgesG([5, 6, 7], [5, 6, 7])).toBe(0);
    expect(hedgesG([10, 11, 12], [1, 2, 3])).toBeGreaterThan(1);
    expect(pairedDifferences([3, 4], [1, 1])).toEqual([2, 3]);
  });

  it("runs an exact binomial test", () => {
    expect(binomialTest(10, 10, 0.5)).toBeLessThan(0.01);
    expect(binomialTest(5, 10, 0.5)).toBeGreaterThan(0.9);
    expect(binomialTest(0, 0, 0.5)).toBe(1);
  });

  it("adds intervals to a trial summary", () => {
    const results = [result(10), result(20), result(30), result(null)];
    const summary = summarizeTrials(results);
    expect(summary.successes).toBe(3);
    expect(summary.successRateCI[0]).toBeLessThan(0.75);
    expect(summary.successRateCI[1]).toBeGreaterThan(0.9);
    expect(summary.medianTicksCI).not.toBeNull();
    expect(summary.medianTicksCI![0]).toBeLessThanOrEqual(20);
    expect(summary.medianTicksCI![1]).toBeGreaterThanOrEqual(20);
  });
});
