import { describe, expect, it } from "vitest";
import {
  LINEAGE_TOP_N,
  World,
  fixationVsDrift,
  molecularClock,
  neutralOnly,
  selectionCoefficient,
  traitDistribution,
  type FrequencyPoint,
} from "../src/sim/index";

describe("selection and drift", () => {
  it("recovers a known selection coefficient from a frequency trajectory", () => {
    // calibration:selection-recovery
    const s = 0.012;
    const series: FrequencyPoint[] = [];
    for (let t = 0; t <= 200; t += 10) {
      const f = 1 / (1 + Math.exp(-(-1.2 + s * t)));
      series.push({ tick: t, count: Math.round(f * 1000), total: 1000 });
    }
    const estimate = selectionCoefficient(series);
    expect(estimate).not.toBeNull();
    expect(estimate!).toBeCloseTo(s, 3);
    expect(selectionCoefficient([{ tick: 0, count: 0, total: 10 }])).toBeNull();
  });

  it("tests observed fixations against neutral drift", () => {
    const drift = fixationVsDrift(0.5, 10, 20);
    expect(drift.expected).toBeCloseTo(10, 10);
    expect(drift.pValue).toBeGreaterThan(0.5);
    const biased = fixationVsDrift(0.5, 19, 20);
    expect(biased.pValue).toBeLessThan(0.01);
  });

  it("classifies hue-only changes as neutral and nothing else", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 1 });
    const org = w.birth(4, 4, "ATGAAATAAGGGCCCTAA", null, false, 1)!;
    const variant = { ...org.ph, hue: org.ph.hue + 0.2 };
    expect(neutralOnly(org.ph, variant)).toBe(true);
    expect(neutralOnly(org.ph, { ...variant, uptake: variant.uptake + 0.1 })).toBe(false);
  });

  it("stores a per-tick trait distribution only when asked", () => {
    const on = new World({ width: 12, height: 12, startPopulation: 12, seed: 3, recordTraitDistribution: true });
    for (let i = 0; i < 5; i++) on.step();
    const sample = on.history.at(-1)!;
    expect(sample.traitDist?.uptake?.mean).toBeGreaterThan(0);
    expect(sample.traitDist?.uptake?.q05).toBeLessThanOrEqual(sample.traitDist!.uptake!.q50);

    const off = new World({ width: 12, height: 12, startPopulation: 12, seed: 3, recordTraitDistribution: false });
    for (let i = 0; i < 5; i++) off.step();
    expect(off.history.at(-1)!.traitDist).toBeUndefined();
  });

  it("stores a bounded per-lineage series on every history row", () => {
    const w = new World({ width: 24, height: 24, startPopulation: 40, seed: 6, mutationRate: 0.4 });
    for (let i = 0; i < 30; i++) w.step();
    const row = w.history.at(-1)!;
    expect(row.lineageTop).toBeDefined();
    expect(row.lineageTop!.length).toBeGreaterThan(0);
    expect(row.lineageTop!.length).toBeLessThanOrEqual(LINEAGE_TOP_N);
    // Counts descend, then ids ascend: the ordering the card relies on.
    for (let i = 1; i < row.lineageTop!.length; i++) {
      const [prevId, prevCount] = row.lineageTop![i - 1]!;
      const [id, count] = row.lineageTop![i]!;
      expect(prevCount > count || (prevCount === count && prevId < id)).toBe(true);
    }
    // Every stored lineage is alive and matches the world's own count.
    for (const [id, count] of row.lineageTop!) expect(w.lineages.get(id)!.count).toBe(count);
  });

  it("summarises a trait distribution and a molecular clock", () => {
    const w = new World({ width: 12, height: 12, startPopulation: 12, seed: 5 });
    for (let i = 0; i < 20; i++) w.step();
    const dist = traitDistribution(w.organisms);
    expect(dist.uptake!.mean).toBeGreaterThan(0);
    expect(dist.uptake!.q05).toBeLessThanOrEqual(dist.uptake!.q50);
    expect(dist.uptake!.q50).toBeLessThanOrEqual(dist.uptake!.q95);
    expect(dist.uptake!.sd).toBeGreaterThanOrEqual(0);
    const clock = molecularClock(
      [{ tick: 10, orgId: 1, lineageId: 1, from: 0.5, to: 0.6 }],
      200,
      4,
    );
    expect(clock).toBeCloseTo((1 / 4) * (100 / 200), 10);
  });
});
