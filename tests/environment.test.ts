/**
 * Stage 1 environment mechanics: undisturbed light, hazard-driven
 * disturbances, the kin threshold and the chemostat.
 */
import { describe, expect, it } from "vitest";
import { World, founderHeterotroph, founderPredator, preyGap } from "../src/sim/index";

describe("environment mechanics", () => {
  it("keeps light where it is unless lightDiffusion is set", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 0, seed: 3 });
    w.fields.light.fill(0);
    w.fields.solar.fill(0);
    w.fields.nutrient.fill(0);
    w.fields.light[w.fields.idx(8, 8)] = 1;
    w.fields.nutrient[w.fields.idx(8, 8)] = 1;
    w.fields.advance(w.terrain, w.params, 0);
    expect(w.fields.light[w.fields.idx(8, 8)]!).toBeCloseTo(1 - w.params.lightDecay, 5);
    expect(w.fields.light[w.fields.idx(9, 8)]!).toBe(0);
    expect(w.fields.nutrient[w.fields.idx(9, 8)]!).toBeGreaterThan(0);

    const diffuse = new World({ width: 16, height: 16, startPopulation: 0, seed: 3 });
    diffuse.fields.light.fill(0);
    diffuse.fields.solar.fill(0);
    diffuse.fields.light[diffuse.fields.idx(8, 8)] = 1;
    Object.assign(diffuse.params, { lightDiffusion: 0.5 });
    diffuse.fields.advance(diffuse.terrain, diffuse.params, 0);
    expect(diffuse.fields.light[diffuse.fields.idx(9, 8)]!).toBeGreaterThan(0);
  });

  it("makes cannibalism of near-identical phenotypes a parameter", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 0, seed: 3 });
    const a = w.birth(5, 5, founderPredator(), null, false, 1)!;
    const b = w.birth(6, 5, founderPredator(), null, false, 1)!;
    a.ph.aggression = 0.6;
    b.ph.aggression = 0.55;
    expect(preyGap(a, b, 0.26)).toBe(null);
    expect(preyGap(a, b, 0.26, 0)).not.toBe(null);
  });

  it("fires disturbances from per-tick hazards and stays silent at rate 0", () => {
    const loud = new World({ width: 16, height: 16, startPopulation: 0, seed: 5 });
    Object.assign(loud.params, { toxinPulseRate: 1, droughtRate: 0, crashRate: 0 });
    loud.disturbances = true;
    loud.fields.toxin.fill(0);
    loud.step();
    expect(loud.fields.toxin.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);

    const silent = new World({ width: 16, height: 16, startPopulation: 0, seed: 5 });
    Object.assign(silent.params, { toxinPulseRate: 0, droughtRate: 0, crashRate: 0 });
    silent.disturbances = true;
    silent.fields.toxin.fill(0);
    for (let i = 0; i < 20; i++) silent.step();
    expect(silent.fields.toxin.reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("keeps a chemostat population alive and away from the cap", () => {
    const pops: number[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new World({ width: 24, height: 24, startPopulation: 40, seed, mutationRate: 0.05 });
      Object.assign(w.params, {
        dilutionRate: 0.05,
        inflowNutrient: 0.6,
        maxPopulation: 4000,
      });
      for (let i = 0; i < 200; i++) w.step();
      pops.push(w.organisms.length);
      expect(w.fields.nutrient.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
    }
    const mean = pops.reduce((a, b) => a + b, 0) / pops.length;
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(4000);
    for (const p of pops) expect(p).toBeLessThan(4000);
  });
});
