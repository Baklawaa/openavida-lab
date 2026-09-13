import { describe, expect, it } from "vitest";
import { World, genomeForKit, placeOrganismAt } from "../src/sim/index";

/**
 * The cheap half of the calibration record in docs/model.md: claims a test can
 * re-measure on a small seeded world in a fraction of a second. Tolerances are
 * deliberately wide (a claim, not a golden number) so the suite survives
 * cross-platform float differences while still catching a regression in the
 * documented behaviour.
 */

function mean(field: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += field[i]!;
  return sum / field.length;
}

function fieldTotal(field: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += field[i]!;
  return sum;
}

/** One phototroph monoculture, stepped under a given leak; returns its outcome. */
function monoculture(exudateLeak: number, steps = 90): { survivors: number; innovations: number } {
  const w = new World({
    width: 32,
    height: 32,
    seed: 3,
    startPopulation: 0,
    exudateLeak,
    mutationRate: 1,
    maxPopulation: 400,
  });
  w.injectStrain(genomeForKit("phototroph"), 24, 16, 16);
  for (let i = 0; i < steps; i++) w.step();
  return { survivors: w.organisms.length, innovations: w.innovations.length };
}

describe("calibration claims", () => {
  it("keeps a fresh plate habitable: a dropped heterotroph lives for hundreds of steps", () => {
    // calibration:plate-habitability
    const w = new World({ width: 48, height: 48, seed: 20260913, startPopulation: 0 });
    const founder = placeOrganismAt(w, 24, 24, genomeForKit("heterotroph"))!;
    const id = founder.id;
    let lastAliveTick = 0;
    let nutrientAt100 = 0;
    for (let i = 0; i < 150; i++) {
      w.step();
      if (w.tick === 100) nutrientAt100 = mean(w.fields.nutrient);
      if (w.organisms.some((o) => o.id === id)) lastAliveTick = w.tick;
    }
    // Before nutrientInflow the same organism starved in about 20 steps.
    expect(lastAliveTick, "the founder is still alive at step 150").toBe(150);
    expect(nutrientAt100, "the plate still holds food after 100 steps").toBeGreaterThanOrEqual(0.42);
  });

  it("settles a ventless plate at the inflow / decay equilibrium, above the break-even", () => {
    // calibration:nutrient-equilibrium
    const inflow = 0.004;
    const decay = 0.007;
    const w = new World({ width: 32, height: 32, seed: 7, startPopulation: 0, nutrientInflow: inflow, nutrientDecay: decay });
    for (let i = 0; i < 400; i++) w.step();
    const level = mean(w.fields.nutrient);
    expect(level).toBeGreaterThan(0.55);
    expect(level).toBeLessThan(0.62);
    // A stock heterotroph breaks even at maintenance / (uptake x UPTAKE_GAIN) ~ 0.42.
    expect(inflow / decay).toBeGreaterThan(0.42);
  });

  it("leaks exudate only as photosynthetic surplus, and not at all at exudateLeak 0", () => {
    // calibration:exudate-surplus-rule
    const leaky = new World({ width: 32, height: 32, seed: 11, startPopulation: 0, exudateLeak: 0.15, maxPopulation: 400 });
    leaky.injectStrain(genomeForKit("phototroph"), 12, 16, 16);
    let producers = 0;
    let peakTotal = 0;
    for (let i = 0; i < 60; i++) {
      leaky.step();
      producers = Math.max(producers, leaky.lastExudate);
      peakTotal = Math.max(peakTotal, fieldTotal(leaky.fields.exudate));
    }
    expect(producers, "productive phototrophs leak").toBeGreaterThan(0);
    expect(peakTotal).toBeGreaterThan(0);

    const sealed = new World({ width: 32, height: 32, seed: 11, startPopulation: 0, exudateLeak: 0, maxPopulation: 400 });
    sealed.injectStrain(genomeForKit("phototroph"), 12, 16, 16);
    let sealedMax = 0;
    for (let i = 0; i < 60; i++) {
      sealed.step();
      sealedMax = Math.max(sealedMax, fieldTotal(sealed.fields.exudate));
    }
    expect(sealedMax, "exudateLeak 0 disables the trophic link exactly").toBe(0);
    expect(sealed.lastExudate).toBe(0);
  });

  it("tuned exudateLeak 0.15 keeps a phototroph monoculture alive where 0.4 strangles it", () => {
    // calibration:exudate-leak-tuned
    const tuned = monoculture(0.15);
    const greedy = monoculture(0.4);
    expect(tuned.survivors).toBeGreaterThan(0);
    expect(greedy.survivors).toBeGreaterThanOrEqual(0);
    expect(tuned.survivors, "the published default is gentler than the 0.4 bisect bound").toBeGreaterThan(greedy.survivors);
    expect(tuned.innovations).toBeGreaterThanOrEqual(greedy.innovations);
  });
});
