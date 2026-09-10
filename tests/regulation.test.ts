/**
 * Cis-regulation: the codons immediately upstream of an ATG amplify that
 * gene, bounded by the previous ORF's stop. Kit genomes have two-base spacers
 * and must stay additive; intergenic sequence and gene order are the wiring.
 */
import { describe, expect, it } from "vitest";
import {
  REG_MAX,
  World,
  assembleGenome,
  decodeGenome,
  founderHeterotroph,
  founderPhototroph,
  founderPredator,
  founderResistant,
  geneCassette,
} from "../src/sim/index";

const KITS = [founderPhototroph, founderHeterotroph, founderResistant, founderPredator, () => geneCassette("photo", 2)];

describe("cis-regulation", () => {
  it("leaves every kit genome additive", () => {
    for (const kit of KITS) {
      const decoded = decodeGenome(kit());
      for (const r of decoded.regulation) expect(r.multiplier, kit().slice(0, 12)).toBe(1);
    }
  });

  it("amplifies a gene by the codons upstream of its ATG", () => {
    const plain = assembleGenome([geneCassette("photo", 3), geneCassette("uptake", 3)], "CC");
    const regulated = geneCassette("photo", 3) + "CC" + "TAT".repeat(3) + geneCassette("uptake", 3);
    const up = decodeGenome(regulated);
    const base = decodeGenome(plain);
    expect(up.regulation[1]!.multiplier).toBeGreaterThan(1);
    expect(Object.keys(up.regulation[1]!.upstream).length).toBeGreaterThan(0);
    expect(up.phenotype.uptake).toBeGreaterThan(base.phenotype.uptake);
    // The first gene has no upstream sequence in either genome.
    expect(up.regulation[0]!.multiplier).toBe(1);
  });

  it("caps expression at REG_MAX", () => {
    const strong = geneCassette("photo", 3) + "CC" + "TAT".repeat(7) + geneCassette("photo", 3);
    const decoded = decodeGenome(strong);
    expect(decoded.regulation[1]!.multiplier).toBe(REG_MAX);
    // One codon fewer stays below the cap.
    const weaker = geneCassette("photo", 3) + "CC" + "TAT".repeat(5) + geneCassette("photo", 3);
    expect(decodeGenome(weaker).regulation[1]!.multiplier).toBeLessThan(REG_MAX);
  });

  it("can be switched off, restoring the additive phenotype exactly", () => {
    const genome = geneCassette("photo", 3) + "CC" + "TAT".repeat(3) + geneCassette("uptake", 3);
    const on = decodeGenome(genome);
    const off = decodeGenome(genome, { regulation: false });
    expect(off.regulation.every((r) => r.multiplier === 1)).toBe(true);
    expect(off.phenotype.uptake).toBeLessThan(on.phenotype.uptake);
    expect(off.phenotype.photo).toBeCloseTo(on.phenotype.photo, 12);
  });

  it("is heritable through the sequence, not the organism", () => {
    const genome = geneCassette("photo", 3) + "CC" + "TAT".repeat(3) + geneCassette("uptake", 3);
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 2 });
    const org = w.birth(4, 4, genome, null, false, 3)!;
    expect(org.ph.uptake).toBeCloseTo(decodeGenome(genome).phenotype.uptake, 12);
  });
});
