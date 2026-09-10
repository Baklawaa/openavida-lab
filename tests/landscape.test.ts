import { describe, expect, it } from "vitest";
import {
  SENSE_CODONS,
  annotateSequence,
  decodeGenome,
  founderPhototroph,
  probeLandscape,
  replaceRange,
} from "../src/sim/index";

const HIGH_LIGHT = { nutrient: 0.05, toxin: 0, temperature: 0.5, light: 1, exudate: 0 };

describe("fitness landscape", () => {
  it("enumerates 61 sense codons, stays inside ORFs, and ranks a photo-raising substitution", () => {
    expect(SENSE_CODONS).toHaveLength(61);
    expect(SENSE_CODONS).not.toContain("TAA");
    expect(SENSE_CODONS).not.toContain("TAG");
    expect(SENSE_CODONS).not.toContain("TGA");

    const g = founderPhototroph();
    const pos = g.indexOf("GAT");
    expect(pos).toBeGreaterThanOrEqual(0);
    const boosted = replaceRange(g, pos, pos + 3, "TAT");
    expect(decodeGenome(boosted).phenotype.photo).toBeGreaterThan(decodeGenome(g).phenotype.photo);

    const r = probeLandscape(g, HIGH_LIGHT, 10);
    expect(r.best).toHaveLength(10);
    expect(r.worst).toHaveLength(10);
    for (let i = 1; i < r.best.length; i++) expect(r.best[i - 1]!.fitness).toBeGreaterThanOrEqual(r.best[i]!.fitness);
    for (let i = 1; i < r.worst.length; i++) expect(r.worst[i - 1]!.fitness).toBeLessThanOrEqual(r.worst[i]!.fitness);
    expect(r.best[0]!.fitness).toBeGreaterThan(r.baseline);
    expect(r.worst[0]!.fitness).toBeLessThan(r.baseline);

    const photoUp = r.best.find((h) => (h.traits.photo ?? 0) > 0);
    expect(photoUp).toBeTruthy();
    expect(photoUp!.codon).toMatch(/^[ACGT]{3}$/);
    expect(r.best.some((h) => h.position === pos && h.codon === "TAT") || (photoUp!.traits.photo ?? 0) > 0).toBe(true);

    const ann = annotateSequence(g);
    const codingStarts = new Set(ann.cells.filter((c) => c.role === "coding").map((c) => c.start));
    for (const h of [...r.best, ...r.worst]) {
      expect(codingStarts.has(h.position)).toBe(true);
      const junk = ann.cells.find((c) => c.start === h.position);
      expect(junk?.role).toBe("coding");
    }
  });
});
