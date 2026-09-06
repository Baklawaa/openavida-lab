import { describe, expect, it } from "vitest";
import {
  EditHistory,
  MAX_GENOME,
  annotateSequence,
  appendGene,
  bumpGene,
  decodeGenome,
  deleteRange,
  duplicateRange,
  findOpenOrf,
  founderPhototroph,
  geneStrength,
  insertAt,
  moveGene,
  phenotypeDelta,
  removeGene,
  setBase,
  setGeneStrength,
  validateSequence,
} from "../src/sim/index";

describe("DNA editor model", () => {
  it("annotates start / coding / stop / junk cells that tile the whole sequence", () => {
    const seq = "CC" + "ATGGAAGAATAA" + "GT" + "ATGTATTAG";
    const a = annotateSequence(seq);
    expect(a.decoded.genes).toHaveLength(2);
    expect(a.openFrom).toBe(-1);
    const covered = a.cells.map((c) => c.bases).join("");
    expect(covered).toBe(seq);
    expect(a.cells.map((c) => c.role)).toEqual(["junk", "start", "coding", "coding", "stop", "junk", "start", "coding", "stop"]);
    const coding = a.cells.find((c) => c.role === "coding")!;
    expect(coding.aa).toBe("E");
    expect(coding.trait).toBe("uptake");
    expect(coding.delta).toBeGreaterThan(0);
    expect(coding.gene).toBe(0);
    expect(a.cells.filter((c) => c.role === "start").every((c) => c.color.length > 0)).toBe(true);
  });

  it("flags an unclosed ORF the decoder ignores", () => {
    const seq = "ATGGAAGAATAA" + "CC" + "ATGGAAGAA";
    expect(findOpenOrf(seq, 12)).toBe(14);
    const a = annotateSequence(seq);
    expect(a.openFrom).toBe(14);
    expect(a.cells.filter((c) => c.role === "open").map((c) => c.bases).join("")).toBe("ATGGAAGAA");
    expect(validateSequence(a).some((i) => i.level === "warn" && /non terminé/.test(i.text))).toBe(true);
    // An empty ORF (ATG then stop) is skipped by the decoder and must not count as open.
    expect(findOpenOrf("ATGTAACCC")).toBe(-1);
    expect(validateSequence(annotateSequence(""))[0]!.level).toBe("info");
  });

  it("range edits keep the sequence sanitized and capped", () => {
    expect(setBase("ATGGAATAA", 3, "T")).toBe("ATGTAATAA");
    expect(setBase("ATG", 9, "T")).toBe("ATG");
    expect(insertAt("ATGTAA", 3, "gaa")).toBe("ATGGAATAA");
    expect(insertAt("ATGTAA", 3, "xyz")).toBe("ATGTAA");
    expect(deleteRange("ATGGAATAA", 3, 6)).toBe("ATGTAA");
    expect(deleteRange("ATGGAATAA", 6, 3)).toBe("ATGTAA");
    expect(duplicateRange("ATGGAATAA", 3, 6)).toBe("ATGGAAGAATAA");
    const long = insertAt("A".repeat(MAX_GENOME), 0, "CCC");
    expect(long.length).toBe(MAX_GENOME);
  });

  it("gene strength bumps add or remove one dominant codon inside the ORF", () => {
    const seq = founderPhototroph();
    const g0 = decodeGenome(seq).genes[0]!;
    expect(g0.dominant).toBe("photo");
    const s0 = geneStrength(g0);
    const up = bumpGene(seq, g0, 1);
    const upGene = decodeGenome(up).genes[0]!;
    expect(geneStrength(upGene)).toBe(s0 + 1);
    expect(decodeGenome(up).phenotype.photo).toBeGreaterThanOrEqual(decodeGenome(seq).phenotype.photo);
    expect(decodeGenome(up).genes.length).toBe(decodeGenome(seq).genes.length);
    const down = bumpGene(seq, g0, -1);
    expect(geneStrength(decodeGenome(down).genes[0]!)).toBe(s0 - 1);
    // Cannot go below one codon.
    const one = setGeneStrength(seq, 0, 1);
    expect(geneStrength(decodeGenome(one).genes[0]!)).toBe(1);
    expect(bumpGene(one, decodeGenome(one).genes[0]!, -1)).toBe(one);
    expect(geneStrength(decodeGenome(setGeneStrength(seq, 0, 9)).genes[0]!)).toBe(9);
  });

  it("move / remove / append keep other genes intact", () => {
    const seq = founderPhototroph();
    const genes = decodeGenome(seq).genes;
    const order = genes.map((g) => g.dominant);
    const moved = moveGene(seq, genes, 0, 1);
    const movedOrder = decodeGenome(moved).genes.map((g) => g.dominant);
    expect(movedOrder).toEqual([order[1], order[0], order[2]]);
    expect(moved.length).toBe(seq.length);
    expect(moveGene(seq, genes, 0, -1)).toBe(seq);
    const removed = removeGene(seq, genes[1]!);
    expect(decodeGenome(removed).genes.map((g) => g.dominant)).toEqual([order[0], order[2]]);
    const added = appendGene(seq, "aggression", 4);
    const last = decodeGenome(added).genes.at(-1)!;
    expect(last.dominant).toBe("aggression");
    expect(geneStrength(last)).toBe(4);
    expect(appendGene("A".repeat(MAX_GENOME - 4), "photo", 3)).toBe("A".repeat(MAX_GENOME - 4));
    const delta = phenotypeDelta(decodeGenome(added).phenotype, decodeGenome(seq).phenotype);
    expect(delta.aggression).toBeGreaterThan(0);
    expect(delta.photo).toBe(0);
  });

  it("history: push ignores no-ops, undo/redo walk states, new push clears redo", () => {
    const h = new EditHistory("ATGTAA");
    expect(h.canUndo).toBe(false);
    expect(h.push("atgtaa")).toBe(false);
    expect(h.push("ATGGAATAA")).toBe(true);
    expect(h.push("ATGGAAGAATAA")).toBe(true);
    expect(h.undo()).toBe("ATGGAATAA");
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe("ATGGAAGAATAA");
    expect(h.undo()).toBe("ATGGAATAA");
    expect(h.push("ATGTATTAA")).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe("ATGGAATAA");
    expect(h.undo()).toBe("ATGTAA");
    expect(h.undo()).toBe(null);
    h.reset("ATG");
    expect(h.present).toBe("ATG");
    expect(h.canUndo).toBe(false);
  });
});
