import { describe, expect, it } from "vitest";
import {
  World,
  applyRecipe,
  founderPhototroph,
  recipeFromWorld,
  runTrial,
  takeSnapshot,
  worldForTrial,
  type Goal,
} from "../src/sim/index";

describe("environment schedule", () => {
  it("does nothing when empty, so two equal seeds stay in lockstep", () => {
    const a = new World({ width: 24, height: 24, seed: 11, startPopulation: 0 });
    const b = new World({ width: 24, height: 24, seed: 11, startPopulation: 0 });
    expect(b.schedule).toEqual([]);
    a.injectStrain(founderPhototroph(), 4, 8, 8);
    b.injectStrain(founderPhototroph(), 4, 8, 8);
    for (let i = 0; i < 30; i++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
  });

  it("applies scale and params exactly at the scheduled tick", () => {
    const base = new World({ width: 16, height: 16, seed: 5, startPopulation: 0, mutationRate: 0.1 });
    base.fields.toxin.fill(0.4);
    const scaled = new World({ width: 16, height: 16, seed: 5, startPopulation: 0, mutationRate: 0.1 });
    scaled.fields.toxin.fill(0.4);
    scaled.schedule = [{ at: 3, op: { type: "scale", field: "toxin", k: 2 } }];
    const params = new World({ width: 16, height: 16, seed: 5, startPopulation: 0, mutationRate: 0.1 });
    params.schedule = [{ at: 2, op: { type: "params", params: { mutationRate: 0.9 } } }];
    params.step();
    expect(params.tick).toBe(1);
    expect(params.params.mutationRate).toBe(0.1);
    for (let i = 0; i < 2; i++) {
      base.step();
      scaled.step();
    }
    expect(scaled.fields.toxin[0]!).toBeCloseTo(base.fields.toxin[0]!, 6);
    params.step();
    expect(params.tick).toBe(2);
    expect(params.params.mutationRate).toBe(0.9);
    // A scheduled value is bounded by the specification, like any other write.
    const outOfRange = new World({ width: 16, height: 16, seed: 5, startPopulation: 0 });
    outOfRange.schedule = [{ at: 1, op: { type: "params", params: { reproduceEnergy: 999 } } }];
    outOfRange.step();
    expect(outOfRange.params.reproduceEnergy).toBe(100);
    base.step();
    scaled.step();
    expect(scaled.tick).toBe(3);
    expect(scaled.fields.toxin[0]!).toBeCloseTo(base.fields.toxin[0]! * 2, 6);
  });

  it("round-trips through a recipe and into a trial config", () => {
    const w = new World({ width: 16, height: 16, seed: 8, startPopulation: 0 });
    w.schedule = [
      { at: 1, op: { type: "scale", field: "nutrient", k: 0.5 } },
      { at: 4, op: { type: "params", params: { mutationRate: 0 } } },
    ];
    w.paint(8, 8, 6, "nutrientBlob", 0.9);
    w.injectStrain(founderPhototroph(), 3, 8, 8);
    for (let i = 0; i < 6; i++) w.step();
    const recipe = recipeFromWorld(w);
    expect(recipe.schedule).toHaveLength(2);
    const copy = applyRecipe(recipe);
    expect(copy.schedule).toEqual(w.schedule);
    expect(copy.hashState()).toBe(w.hashState());
    expect(copy.params.mutationRate).toBe(0);

    const start = new World({ width: 16, height: 16, seed: 2, startPopulation: 0 });
    start.injectStrain(founderPhototroph(), 4, 8, 8);
    const snap = takeSnapshot(start);
    const trial = worldForTrial(snap, {
      seed: 3,
      maxTicks: 5,
      sampleEvery: 1,
      schedule: [{ at: 1, op: { type: "params", params: { mutationRate: 0.33 } } }],
    });
    expect(trial.params.mutationRate).not.toBe(0.33);
    trial.step();
    expect(trial.params.mutationRate).toBe(0.33);
    const goal: Goal = { metric: { kind: "population" }, op: ">=", target: 1e9, sustain: 1 };
    const r = runTrial(snap, goal, {
      seed: 4,
      maxTicks: 3,
      sampleEvery: 1,
      schedule: [{ at: 2, op: { type: "scale", field: "light", k: 0 } }],
      keepSnapshot: true,
    });
    expect(r.ticks).toBe(3);
    expect(r.snapshot).toBeTruthy();
  });
});
