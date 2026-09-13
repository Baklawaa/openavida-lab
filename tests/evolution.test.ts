/**
 * Stage 1 genome economics: upkeep per base and a replication charge.
 */
import { describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng";
import {
  World,
  assembleGenome,
  decodeGenome,
  founderHeterotroph,
  founderPhototroph,
  geneCassette,
  metabolicDelta,
  recombine,
} from "../src/sim/index";

const ENV = { nutrient: 0.5, toxin: 0, temperature: 0.5, light: 0.5, exudate: 0 };

describe("genome economics", () => {
  it("charges maintenance per genome base", () => {
    // calibration:genome-economics
    const ph = decodeGenome(founderHeterotroph()).phenotype;
    const free = metabolicDelta(ph, ENV, 1, 0);
    const taxed = metabolicDelta(ph, ENV, 1, 0.00002 * 100);
    expect(free - taxed).toBeCloseTo(0.002, 10);
    expect(taxed).toBeLessThan(free);
  });

  it("scales the mutation rate with the mutator trait", () => {
    const w = new World({ width: 12, height: 12, startPopulation: 0, seed: 3, mutationRate: 0.5 });
    const slow = w.birth(3, 3, founderHeterotroph(), null, false, 3)!;
    const fast = w.birth(4, 3, founderHeterotroph(), null, false, 3)!;
    slow.ph.mutator = 0.5;
    fast.ph.mutator = 4;
    expect(w.mutationRatesFor(slow).rate).toBeCloseTo(0.25, 10);
    expect(w.mutationRatesFor(fast).rate).toBeCloseTo(2, 10);
    expect(w.mutationRatesFor(fast).point).toBeCloseTo(w.mutationRatesFor(slow).point, 10);
  });

  it("lets a mutator genome found more mutant lineages than a compact one", () => {
    // Proline codons and TGG carry the secondary mutator contribution.
    const mutatorGenome = assembleGenome([
      geneCassette("mutator", 6),
      geneCassette("photo", 4),
      geneCassette("uptake", 3),
    ]);
    const plainGenome = assembleGenome([geneCassette("photo", 4), geneCassette("uptake", 3)]);
    expect(decodeGenome(mutatorGenome).phenotype.mutator).toBeGreaterThan(1);
    expect(decodeGenome(plainGenome).phenotype.mutator).toBe(1);

    // Compare the *fraction* of births that found a lineage: the mutator
    // cassette also raises size, so raw lineage counts confound growth rate.
    const run = (genome: string) => {
      const w = new World({ width: 24, height: 24, startPopulation: 0, seed: 5, mutationRate: 0.4 });
      w.fields.nutrient.fill(1.5);
      w.fields.light.fill(1);
      w.injectStrain(genome, 20);
      const founders = w.organisms.length;
      for (let i = 0; i < 80; i++) w.step();
      const births = Math.max(1, w.nextOrgId - 1 - founders);
      return (w.nextLineageId - 1) / births;
    };
    expect(run(mutatorGenome)).toBeGreaterThan(run(plainGenome));
  });

  it("builds a chimera: a prefix of one parent and a suffix of the other", () => {
    const a = decodeGenome(founderPhototroph()).sequence;
    const b = decodeGenome(founderHeterotroph()).sequence;
    const children = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      const child = recombine(a, b, new Rng(seed));
      expect(child.length).toBeGreaterThanOrEqual(9);
      children.add(child);
      const composable = (() => {
        for (let n = 0; n <= a.length && n <= child.length; n++) {
          if (child.startsWith(a.slice(0, n)) && child.slice(n) === b.slice(b.length - (child.length - n))) return true;
        }
        return false;
      })();
      expect(composable, `seed ${seed}`).toBe(true);
    }
    expect(children.size).toBeGreaterThan(5);
  });

  it("records recombination as an explicit mutation kind with its donor", () => {
    const w = new World({
      width: 16,
      height: 16,
      startPopulation: 0,
      seed: 7,
      mutationRate: 0,
      recombinationRate: 1,
      maxPopulation: 300,
    });
    w.fields.nutrient.fill(1.5);
    w.fields.light.fill(1);
    w.injectStrain(founderPhototroph(), 12);
    w.injectStrain(founderHeterotroph(), 12);
    for (let i = 0; i < 60; i++) w.step();
    const recombinants = w.innovations.filter((i) => i.kind === "recombination");
    expect(recombinants.length).toBeGreaterThan(0);
    expect(recombinants[0]!.donorOrgId).toBeGreaterThan(0);
    expect(w.organisms.some((o) => o.genome.length > 0)).toBe(true);
  });

  it("charges replication per genome base, so the parent ends a division poorer", () => {
    const run = (replicationCost: number) => {
      const w = new World({ width: 12, height: 12, startPopulation: 0, seed: 21, mutationRate: 0 });
      w.fields.nutrient.fill(2);
      const parent = w.birth(6, 6, founderHeterotroph(), null, false, 6)!;
      Object.assign(w.params, { replicationCost });
      w.step();
      return { energy: parent.energy, population: w.organisms.length };
    };
    const free = run(0);
    const taxed = run(0.01);
    expect(free.population).toBeGreaterThan(1);
    expect(taxed.energy).toBeLessThan(free.energy);
  });
});
