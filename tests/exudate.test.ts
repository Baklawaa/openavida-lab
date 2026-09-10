/**
 * Cross-feeding. Overflow photosynthesis is a transfer, not a source: the
 * producer pays exactly what the field receives, a receptor (signal >= 1)
 * takes it up with an 0.8 yield, and the rest dissipates. The advantage is
 * density- and productivity-dependent, so the tests pin both the bookkeeping
 * and the fact that a receptor ends up ahead of an identical blind neighbour.
 */
import { describe, expect, it } from "vitest";
import { World, founderPhototroph } from "../src/sim/index";
import { EXUDATE_YIELD } from "../src/sim/chemistry";
import { metabolize } from "../src/sim/ecology";

interface PairResult {
  consumer: number | null;
  producer: number | null;
  field: number;
}

/** One producer plus one consumer (receptor or blind), no growth and no movement. */
function pair(opts: { signal: number; steps: number; producerPhoto?: number }): PairResult {
  const w = new World({
    width: 8,
    height: 8,
    startPopulation: 0,
    seed: 12,
    mutationRate: 0,
    reproduceEnergy: 1000,
    maxAge: 100000,
    senescenceRate: 0,
  });
  w.fields.nutrient.fill(0);
  w.fields.light.fill(1);
  w.fields.solar.fill(1);
  const producer = w.birth(3, 3, founderPhototroph(), null, false, 3)!;
  producer.ph.photo = opts.producerPhoto ?? 2.2;
  producer.ph.motility = 0;
  producer.ph.aggression = 0;
  producer.ph.signal = 0;
  const consumer = w.birth(4, 3, founderPhototroph(), null, false, 3)!;
  consumer.ph.photo = 0;
  consumer.ph.motility = 0;
  consumer.ph.aggression = 0;
  consumer.ph.signal = opts.signal;
  for (let i = 0; i < opts.steps; i++) w.step();
  return {
    consumer: w.organisms.find((o) => o.id === consumer.id)?.energy ?? null,
    producer: w.organisms.find((o) => o.id === producer.id)?.energy ?? null,
    field: w.fields.exudate.reduce((s, v) => s + v, 0),
  };
}

describe("cross-feeding", () => {
  it("is a transfer: the producer pays exactly what the field receives", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4, mutationRate: 0 });
    w.fields.nutrient.fill(0);
    w.fields.light.fill(1);
    w.fields.solar.fill(1);
    const producer = w.birth(3, 3, founderPhototroph(), null, false, 3)!;
    producer.ph.photo = 2.2;
    producer.ph.signal = 0; // produces but cannot take up
    const c0 = w.fields.exudate[w.fields.idx(3, 3)]!;
    const e0 = producer.energy;
    const met = metabolize(producer, w.fields, w.params);
    const c1 = w.fields.exudate[w.fields.idx(3, 3)]!;
    expect(met.leaked).toBeGreaterThan(0);
    // The field is Float32Array; compare at single-precision tolerance.
    expect(c1 - c0).toBeCloseTo(met.leaked, 6);
    expect(producer.energy).toBeCloseTo(e0 + met.delta - met.leaked, 6);
    expect(met.taken).toBe(0);
  });

  it("conserves energy across the transfer (no free lunch, no silent loss)", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4, mutationRate: 0 });
    w.fields.nutrient.fill(0);
    w.fields.light.fill(1);
    w.fields.solar.fill(1);
    const producer = w.birth(3, 3, founderPhototroph(), null, false, 3)!;
    producer.ph.photo = 2.2;
    const consumer = w.birth(4, 3, founderPhototroph(), null, false, 3)!;
    consumer.ph.photo = 0;
    consumer.ph.signal = 7;
    // Put exudate in the consumer's cell so both transfers happen in this tick.
    w.fields.exudate[w.fields.idx(4, 3)] = 0.2;
    const total = () => w.organisms.reduce((s, o) => s + o.energy, 0) + w.fields.exudate.reduce((s, v) => s + v, 0);
    const before = total();
    const dPro = metabolize(producer, w.fields, w.params);
    const dCon = metabolize(consumer, w.fields, w.params);
    const after = total();
    // The exudate transfer itself moves energy; the only other change is the
    // documented yield loss (1 − EXUDATE_YIELD) on what the consumer takes up.
    expect(after - before).toBeCloseTo(
      dPro.delta + dCon.delta - dCon.taken * (1 - EXUDATE_YIELD),
      6,
    );
    expect(dCon.taken).toBeGreaterThan(0);
  });

  it("gives a receptor a higher energy budget than an identical blind neighbour", () => {
    const blind = pair({ signal: 0, steps: 20 });
    const receptor = pair({ signal: 7, steps: 20 });
    expect(blind.consumer).not.toBeNull();
    expect(receptor.consumer).not.toBeNull();
    expect(receptor.consumer!).toBeGreaterThan(blind.consumer!);
    // The producer is identical in both runs, so the gap is the uptake alone.
    expect(receptor.producer).toBeCloseTo(blind.producer!, 6);
  });

  it("scales the receptor advantage with the channel", () => {
    const weak = pair({ signal: 1, steps: 20 });
    const strong = pair({ signal: 7, steps: 20 });
    expect(strong.consumer!).toBeGreaterThan(weak.consumer!);
  });

  it("lets a receptor outlive a blind neighbour beside a productive producer", () => {
    const blind = pair({ signal: 0, steps: 30 });
    const receptor = pair({ signal: 7, steps: 30 });
    expect(blind.consumer).toBeNull();
    expect(receptor.consumer).not.toBeNull();
  });

  it("leaves a blind neighbour unable to consume the field", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4, mutationRate: 0 });
    w.fields.nutrient.fill(0);
    w.fields.light.fill(1);
    w.fields.solar.fill(1);
    const blind = w.birth(3, 3, founderPhototroph(), null, false, 3)!;
    blind.ph.photo = 0;
    blind.ph.signal = 0;
    blind.ph.motility = 0;
    w.fields.exudate[w.fields.idx(3, 3)] = 0.5;
    const met = metabolize(blind, w.fields, w.params);
    expect(met.taken).toBe(0);
    expect(w.fields.exudate[w.fields.idx(3, 3)]!).toBeCloseTo(0.5, 9);
  });
});
