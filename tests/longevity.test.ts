import { describe, expect, it } from "vitest";
import { World, decodeGenome, founderHeterotroph, genomeForKit, placeOrganismAt } from "../src/sim/index";
import { BASAL, MIN_GENOME, START_CODON } from "../src/sim/mapping";
import { lifespan, energyCap } from "../src/sim/body";
import { LONGEVITY_UPKEEP, fitness, maintenanceCost, metabolicDelta } from "../src/sim/fitness";

/**
 * The longevity trait: a heritable age ceiling whose upkeep is paid every tick,
 * so selection faces a trade-off rather than always reaching for the cap.
 *
 * The trait rides on secondary codon contributions (the threonine groups that
 * set a thermal preference and the two cysteines), which is why every genome
 * that already existed keeps its phenotype apart from lifespan.
 */

/**
 * Two genomes identical except for the longevity codons inside one ORF:
 * eleven codons plus a stop, with two of them swapped for ACT (a threonine
 * codon that also carries +0.06 longevity).
 */
const PLAIN = `${START_CODON}${"ATT".repeat(11)}TAA`;
const LONG = `${START_CODON}${"ATT".repeat(5)}ACT${"ATT".repeat(5)}ACT${"TAA"}`;

describe("longevity trait", () => {
  it("is basal 1 and additive through the secondary codons", () => {
    const plain = decodeGenome(PLAIN, { regulation: false }).phenotype;
    expect(plain.longevity).toBeCloseTo(BASAL.longevity, 10);
    const long = decodeGenome(LONG, { regulation: false }).phenotype;
    // Two ACT codons at 0.06 each. Swapping ATT for ACT also trades uptake for
    // thermal preference — that is the codon table, not a side effect — but the
    // size trait is untouched, so the longevity delta is exactly the extras.
    expect(long.longevity - plain.longevity).toBeCloseTo(0.12, 6);
    expect(long.size).toBeCloseTo(plain.size, 10);
    expect(long.uptake).toBeLessThan(plain.uptake);
  });

  it("stretches the age ceiling of the organism that carries it", () => {
    const w = new World({ width: 16, height: 16, seed: 3, startPopulation: 0 });
    const short = placeOrganismAt(w, 2, 2, PLAIN)!;
    const long = placeOrganismAt(w, 3, 3, LONG)!;
    expect(lifespan(short, 200)).toBe(200);
    expect(lifespan(long, 200)).toBeGreaterThan(200);
  });

  it("keeps a long-lived organism past the population age ceiling", () => {
    // senescenceRate 0 leaves the hard cutoff alone, so the only thing that can
    // save it is its own ceiling.
    const w = new World({ width: 16, height: 16, seed: 7, startPopulation: 0, senescenceRate: 0, maxAge: 40 });
    w.fields.nutrient.fill(0.6);
    w.fields.light.fill(0.8);
    const long = placeOrganismAt(w, 8, 8, LONG)!;
    const id = long.id;
    for (let i = 0; i < 41; i++) w.step();
    expect(w.organisms.some((o) => o.id === id), "lives past the parameter ceiling").toBe(true);
    expect(lifespan(long, 40)).toBeGreaterThan(40);
  });

  // calibration:longevity-trade-off
  it("charges upkeep for the extra life it buys", () => {
    const w = new World({ width: 16, height: 16, seed: 5, startPopulation: 0 });
    const short = placeOrganismAt(w, 2, 2, PLAIN)!;
    const long = placeOrganismAt(w, 3, 3, LONG)!;
    expect(long.ph.longevity).toBeGreaterThan(short.ph.longevity);
    // Same phenotype otherwise, so the difference is the upkeep term alone.
    expect(maintenanceCost(long.ph) - maintenanceCost(short.ph)).toBeCloseTo(
      LONGEVITY_UPKEEP * (long.ph.longevity - short.ph.longevity),
      10,
    );
    const env = { nutrient: 0.5, toxin: 0, temperature: 0.5, light: 0.5, exudate: 0 };
    expect(metabolicDelta(long.ph, env)).toBeLessThan(metabolicDelta(short.ph, env));
    // Both ledgers charge it, so the cost is not dodged in a cell contest.
    const noNeighbours = { predationGain: 0 };
    expect(fitness(long.ph, env, noNeighbours)).toBeLessThan(fitness(short.ph, env, noNeighbours));
    // The published numbers of the calibration entry, to the digit.
    expect(lifespan(long, 40)).toBe(45);
    expect(lifespan(long, 260)).toBe(291);
    expect(lifespan(short, 260)).toBe(260);
    expect(maintenanceCost(long.ph) - maintenanceCost(short.ph)).toBeCloseTo(0.00144, 10);
  });

  it("is inherited: a child decodes the same ceiling as its parent", () => {
    const w = new World({ width: 16, height: 16, seed: 11, startPopulation: 0 });
    const parent = placeOrganismAt(w, 4, 4, LONG)!;
    const child = w.birth(5, 5, parent.genome, parent, false, 0.9)!;
    expect(child.ph.longevity).toBeCloseTo(parent.ph.longevity, 10);
    expect(lifespan(child, 260)).toBe(lifespan(parent, 260));
  });

  it("leaves the stock kits at the published ceiling until they evolve it", () => {
    const w = new World({ width: 16, height: 16, seed: 13, startPopulation: 0 });
    for (const kit of ["phototroph", "heterotroph", "predator", "mutualist", "resistant"]) {
      const org = w.birth(8, 8, genomeForKit(kit), null, false, 0.9);
      expect(org, kit).not.toBeNull();
      expect(org!.ph.longevity, kit).toBeGreaterThanOrEqual(BASAL.longevity);
      w.organisms.length = 0;
      w.rebuildOccupancy();
    }
    expect(energyCap({ ph: decodeGenome(founderHeterotroph()).phenotype })).toBeGreaterThan(3);
    expect(decodeGenome("ATG").sequence.length).toBeGreaterThanOrEqual(MIN_GENOME - 6);
  });
});
