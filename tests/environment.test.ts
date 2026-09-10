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

  it("refreshes the medium and washes organisms out in chemostat mode", () => {
    const meanOf = (w: World) => w.fields.nutrient.reduce((s, v) => s + v, 0) / w.fields.nutrient.length;

    const chemostat = new World({ width: 16, height: 16, startPopulation: 24, seed: 3, mutationRate: 0 });
    Object.assign(chemostat.params, { dilutionRate: 0.1, inflowNutrient: 1, maxPopulation: 4000 });
    chemostat.fields.nutrient.fill(0);
    for (let i = 0; i < 40; i++) chemostat.step();
    expect(meanOf(chemostat)).toBeGreaterThan(0.5);
    expect(chemostat.deaths.some((d) => d.cause === "washout")).toBe(true);
    expect(chemostat.lastWashout).toBeGreaterThanOrEqual(0);
    expect(chemostat.organisms.length).toBeLessThan(4000);

    // Closed control: the same world without dilution runs the medium down.
    const closed = new World({ width: 16, height: 16, startPopulation: 24, seed: 3, mutationRate: 0 });
    closed.fields.nutrient.fill(0);
    for (let i = 0; i < 40; i++) closed.step();
    expect(meanOf(chemostat)).toBeGreaterThan(meanOf(closed));
    expect(closed.deaths.some((d) => d.cause === "washout")).toBe(false);
  });
});
