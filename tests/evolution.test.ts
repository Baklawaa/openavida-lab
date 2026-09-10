/**
 * Stage 1 genome economics: upkeep per base and a replication charge.
 */
import { describe, expect, it } from "vitest";
import { World, decodeGenome, founderHeterotroph, metabolicDelta } from "../src/sim/index";

const ENV = { nutrient: 0.5, toxin: 0, temperature: 0.5, light: 0.5, exudate: 0 };

describe("genome economics", () => {
  it("charges maintenance per genome base", () => {
    const ph = decodeGenome(founderHeterotroph()).phenotype;
    const free = metabolicDelta(ph, ENV, 1, 0);
    const taxed = metabolicDelta(ph, ENV, 1, 0.00002 * 100);
    expect(free - taxed).toBeCloseTo(0.002, 10);
    expect(taxed).toBeLessThan(free);
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
