/**
 * Validation against analytic or accounting expectations. These are the checks
 * docs/model.md cites: if one fails, the model — not just a helper — is wrong.
 */
import { describe, expect, it } from "vitest";
import { MEAL_BODY_BONUS } from "../src/sim/body";
import {
  TERRAIN,
  World,
  bodySize,
  assembleGenome,
  decodeGenome,
  founderHeterotroph,
  founderPredator,
  geneCassette,
  interactNeighbors,
} from "../src/sim/index";

describe("model validation", () => {
  it("conserves field mass when nothing decays and no vent feeds it", () => {
    const w = new World({ width: 24, height: 24, startPopulation: 0, seed: 4 });
    Object.assign(w.params, { nutrientDecay: 0, toxinDecay: 0, temperatureDecay: 0, lightDecay: 0 });
    w.fields.nutrient.fill(0);
    // Stay below the field clamp (4): clamping is a documented bound, not a
    // conservation rule, so it must not confound this check.
    w.fields.nutrient[w.fields.idx(12, 12)] = 3;
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
    const before = sum(w.fields.nutrient);
    for (let i = 0; i < 10; i++) w.fields.advance(w.terrain, w.params, 0);
    expect(sum(w.fields.nutrient)).toBeCloseTo(before, 3);
  });

  it("does not let a barrier pass field flux", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 0, seed: 4 });
    Object.assign(w.params, { nutrientDecay: 0 });
    w.fields.nutrient.fill(0);
    // Vertical wall at x = 8.
    for (let y = 0; y < w.h; y++) w.terrain[w.fields.idx(8, y)] = TERRAIN.barrier;
    w.fields.nutrient[w.fields.idx(4, 8)] = 4;
    for (let i = 0; i < 40; i++) w.fields.advance(w.terrain, w.params, 0);
    expect(w.fields.nutrient[w.fields.idx(12, 8)]!).toBe(0);
    expect(w.fields.nutrient[w.fields.idx(4, 8)]!).toBeGreaterThan(0);
  });

  it("bounds the energy a kill may create by the documented biomass bonus", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 0, seed: 3 });
    const pred = w.birth(5, 5, founderPredator(), null, false, 2)!;
    pred.ph.aggression = 1;
    const prey = w.birth(6, 5, founderHeterotroph(), null, false, 1.5)!;
    prey.ph.aggression = 0;
    const total = () => w.organisms.reduce((s, o) => s + Math.max(0, o.energy), 0);
    const before = total();
    interactNeighbors(w.organisms, w.occupancy, w.w, w.h, w.rng, w.params);
    // A meal transfers a share of the prey's energy and adds at most the
    // documented biomass bonus (bodySize × MEAL_BODY_BONUS); it never destroys
    // more than the full prey energy either.
    const created = total() - before;
    const bonus = MEAL_BODY_BONUS * bodySize(prey);
    expect(created).toBeLessThanOrEqual(bonus + 1e-9);
    expect(created).toBeGreaterThanOrEqual(-1.5 - 1e-9);
  });

  it("drifts to fixation at the founder frequency when the strains are neutral", () => {
    // Two genomes with the same phenotype (both hue codons code +0.08) and the
    // same length: only the sequence differs, so selection cannot tell them apart.
    const base = assembleGenome([
      geneCassette("photo", 4),
      geneCassette("hue", 2),
      geneCassette("uptake", 2),
    ]);
    const twin = base.replace("TTC", "TTT");
    expect(twin).not.toBe(base);
    expect(twin.length).toBe(base.length);
    const phenoBase = decodeGenome(base).phenotype;
    const phenoTwin = decodeGenome(twin).phenotype;
    for (const key of Object.keys(phenoBase) as Array<keyof typeof phenoBase>) {
      expect(phenoTwin[key], key).toBeCloseTo(phenoBase[key], 12);
    }
    const keyOf = (o: { genome: string }) => (o.genome === twin ? "twin" : "base");
    const frequencies: number[] = [];
    for (let seed = 1; seed <= 16; seed++) {
      const w = new World({ width: 24, height: 24, startPopulation: 0, seed, mutationRate: 0, maxAge: 5000 });
      w.fields.nutrient.fill(2);
      w.fields.light.fill(1);
      w.fields.solar.fill(1);
      w.injectStrain(base, 12);
      w.injectStrain(twin, 12);
      for (let i = 0; i < 150; i++) w.step();
      const twinCount = w.organisms.filter((o) => keyOf(o) === "twin").length;
      frequencies.push(w.organisms.length ? twinCount / w.organisms.length : 0);
    }
    const meanFreq = frequencies.reduce((s, f) => s + f, 0) / frequencies.length;
    expect(meanFreq).toBeGreaterThan(0.25);
    expect(meanFreq).toBeLessThan(0.75);
    // Drift actually moved the frequency somewhere.
    expect(new Set(frequencies.map((f) => f.toFixed(2))).size).toBeGreaterThan(1);
  });
});
