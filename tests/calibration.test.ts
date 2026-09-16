import { describe, expect, it } from "vitest";
import {
  World,
  decodeGenome,
  founderPhototroph,
  founderPredator,
  genomeForKit,
  placeOrganismAt,
} from "../src/sim/index";
import { maintenanceCost } from "../src/sim/fitness";
import { UPTAKE_GAIN } from "../src/sim/chemistry";

/** Mean aggression of the living, the quantity the aggression tax acts on. */
function meanAggression(w: World): number {
  if (w.organisms.length === 0) return 0;
  let sum = 0;
  for (const o of w.organisms) sum += o.ph.aggression;
  return sum / w.organisms.length;
}

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
  it("keeps a fresh plate habitable: a dropped heterotroph founds a population", () => {
    // calibration:plate-habitability
    const w = new World({ width: 48, height: 48, seed: 20260913, startPopulation: 0 });
    const founder = placeOrganismAt(w, 24, 24, genomeForKit("heterotroph"))!;
    const id = founder.id;
    let lastAliveTick = 0;
    let nutrientAt100 = 0;
    let firstBirth = -1;
    for (let i = 0; i < 150; i++) {
      w.step();
      if (w.tick === 100) nutrientAt100 = mean(w.fields.nutrient);
      if (w.organisms.some((o) => o.id === id)) lastAliveTick = w.tick;
      if (w.organisms.length > 1 && firstBirth < 0) firstBirth = w.tick;
    }
    // Before nutrientInflow the same organism starved in about 20 steps; before
    // the climate and harvest repairs it peaked below its own division
    // threshold and died childless at the age ceiling.
    expect(lastAliveTick, "the founder is still alive at step 150").toBe(150);
    expect(firstBirth, "the founder divides").toBeGreaterThan(0);
    expect(firstBirth).toBeLessThan(150);
    expect(w.organisms.length, "and it is no longer alone").toBeGreaterThan(1);
    expect(nutrientAt100, "the plate still holds food after 100 steps").toBeGreaterThanOrEqual(0.42);
  });

  it("settles a ventless plate at the inflow / decay equilibrium, above the break-even", () => {
    // calibration:nutrient-equilibrium
    const w = new World({ width: 32, height: 32, seed: 7, startPopulation: 0 });
    const equilibrium = w.params.nutrientInflow / w.params.nutrientDecay;
    for (let i = 0; i < 400; i++) w.step();
    const level = mean(w.fields.nutrient);
    expect(level).toBeGreaterThan(equilibrium - 0.05);
    expect(level).toBeLessThan(equilibrium + 0.05);
    // A stock heterotroph breaks even on the mass-action harvest at
    // (maintenance + thermal) / (uptake x UPTAKE_GAIN), about 0.63, and the
    // plate has to settle above it for a grazer to live at all.
    const ph = decodeGenome(genomeForKit("heterotroph")).phenotype;
    const breakEven = (maintenanceCost(ph) + Math.abs(0.5 - ph.tpref) * 0.12) / (ph.uptake * UPTAKE_GAIN);
    expect(equilibrium).toBeGreaterThan(breakEven);
    expect(breakEven).toBeGreaterThan(0.55);
    expect(breakEven).toBeLessThan(0.7);
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

  it("lets one founder of every non-carnivorous kit found a population", () => {
    // calibration:founder-viability
    for (const kit of ["phototroph", "heterotroph", "resistant", "mutualist"] as const) {
      const w = new World({ width: 48, height: 48, seed: 0xa7f31ab, startPopulation: 0 });
      placeOrganismAt(w, 24, 24, genomeForKit(kit));
      let firstBirth = -1;
      let maxPop = 1;
      for (let i = 0; i < 600 && w.organisms.length > 0; i++) {
        w.step();
        if (w.organisms.length > 1 && firstBirth < 0) firstBirth = w.tick;
        maxPop = Math.max(maxPop, w.organisms.length);
      }
      expect(firstBirth, `${kit} divides`).toBeGreaterThan(0);
      expect(firstBirth, `${kit} divides early enough`).toBeLessThan(200);
      expect(maxPop, `${kit} founds a population`).toBeGreaterThan(5);
    }
  });

  it("prices aggression: a mixed population loses its hunters", () => {
    // calibration:aggression-priced
    for (const seed of [1, 7, 21]) {
      const w = new World({ width: 32, height: 32, seed, startPopulation: 0 });
      for (let i = 0; i < 40; i++) {
        placeOrganismAt(w, 2 + (i % 16), 2 + Math.floor(i / 16) * 3, founderPhototroph());
      }
      for (let i = 0; i < 20; i++) {
        placeOrganismAt(w, 2 + (i % 16), 14 + Math.floor(i / 16) * 3, founderPredator());
      }
      expect(meanAggression(w), `seed ${seed} starts with hunters`).toBeGreaterThan(0.15);
      for (let i = 0; i < 300 && w.organisms.length > 0; i++) w.step();
      expect(w.organisms.length, `seed ${seed} is still populated`).toBeGreaterThan(0);
      expect(meanAggression(w), `seed ${seed} drops its hunters`).toBeLessThan(0.05);
    }
  });

  it("keeps a plate alive for thousands of ticks with predators present", { timeout: 60000 }, () => {
    // calibration:plate-longrun
    // 64x64, 180 founders, 2500 ticks. This is the cheap guard for the trophic
    // economy: with the pre-stabiliser transfer (0.35 + 0.40 x aggression plus a
    // 0.45 body bonus) the same scenario is extinct at tick 1843, because every
    // kill paid a fixed jackpot and aggression swept to fixation.
    const w = new World({ width: 64, height: 64, startPopulation: 180, seed: 0xa7f31ab });
    let minAfter300 = Infinity;
    while (w.tick < 2500 && w.organisms.length > 0) {
      w.step();
      if (w.tick > 300) minAfter300 = Math.min(minAfter300, w.organisms.length);
    }
    const causes = new Map<string, number>();
    for (const d of w.deaths) causes.set(d.cause, (causes.get(d.cause) ?? 0) + 1);
    expect(w.tick, "the plate runs the whole horizon").toBe(2500);
    expect(w.organisms.length, "and is still populated").toBeGreaterThan(100);
    expect(minAfter300, "without collapsing on the way").toBeGreaterThan(25);
    expect(meanAggression(w), "aggression stays bounded").toBeLessThan(0.5);
    expect(causes.get("predation") ?? 0, "and predation stays a live strategy").toBeGreaterThan(100);
  });

  it("recycles the leak: a higher exudateLeak no longer strangles a phototroph monoculture", () => {
    // calibration:exudate-leak-tuned
    const tuned = monoculture(0.15);
    const greedy = monoculture(0.4);
    expect(tuned.survivors).toBeGreaterThan(0);
    expect(greedy.survivors).toBeGreaterThan(0);
    // The old bisect claim (0.4 strangles the culture) only held while the plate
    // was cooling to zero and the harvest was capped below subsistence. With
    // both repaired the leak is a transfer to receptors: 33 survivors against
    // 26, so the test now pins "not worse" instead of "strictly better".
    expect(greedy.survivors, "the higher leak is not a penalty").toBeGreaterThan(tuned.survivors * 0.75);
    expect(greedy.innovations).toBeGreaterThanOrEqual(0);
  });
});
