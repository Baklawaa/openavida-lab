import { describe, expect, it } from "vitest";
import { compareConditions, summarizeCondition, type TrialResult } from "../src/sim/index";

function res(seed: number, ticks: number | null): TrialResult {
  return {
    seed,
    startTick: 0,
    ticks: ticks ?? 100,
    reachedTick: ticks,
    reachedTicks: [ticks],
    finalValue: 1,
    finalPopulation: 10,
    extinct: false,
    unreachable: false,
    series: [],
  };
}

describe("condition comparison", () => {
  it("summarises a condition with an interval", () => {
    const summary = summarizeCondition("x", [res(1, 10), res(2, 20), res(3, null)]);
    expect(summary.n).toBe(3);
    expect(summary.successes).toBe(2);
    expect(summary.successRate).toBeCloseTo(2 / 3, 10);
    expect(summary.successRateCI[0]).toBeLessThan(summary.successRate);
    expect(summary.medianTicks).toBeCloseTo(15, 10);
  });

  it("reports effect sizes against the reference, positive meaning slower", () => {
    const fast = [res(1, 10), res(2, 12), res(3, 14)];
    const slow = [res(1, 30), res(2, 32), res(3, 34)];
    const cmp = compareConditions({ fast, slow }, { reference: "fast" });
    expect(cmp.reference).toBe("fast");
    expect(cmp.effects).toHaveLength(2);
    expect(cmp.effects[0]!.medianShift).toBe(0);
    const effect = cmp.effects.find((e) => e.label === "slow")!;
    expect(effect.medianShift).toBeGreaterThan(0);
    expect(effect.cliffsDelta).toBe(1);
    expect(effect.hedgesG).toBeGreaterThan(1);
  });

  it("pairs by replicate seed and uses only the shared seeds", () => {
    const a = [res(1, 10), res(2, 20), res(3, 30)];
    const b = [res(2, 5), res(3, 6), res(4, 7)];
    const cmp = compareConditions({ a, b }, { reference: "a", paired: true });
    const effect = cmp.effects.find((e) => e.label === "b")!;
    expect(effect.n).toBe(2);
    expect(effect.medianShift).toBeLessThan(0);
    expect(effect.cliffsDelta).toBe(-1);
  });

  it("falls back to the first condition when the reference is unknown", () => {
    const cmp = compareConditions({ only: [res(1, 5)] }, { reference: "missing" });
    expect(cmp.reference).toBe("only");
  });
});
