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
  duplicateMutate,
  indelMutate,
  pointMutate,
  alignSequences,
  sequenceDiff,
  validateSequence,
} from "../src/sim/index";
import { Rng } from "../src/sim/rng";

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

  it("sequenceDiff reports a single prefix/suffix hunk in the child sequence", () => {
    expect(sequenceDiff("ATGC", "ATGC")).toEqual([]);
    const point = sequenceDiff("ATGAAATAA", "ATGACATAA");
    expect(point).toEqual([{ a: 4, b: 5, kind: "sub" }]);
    const ins = sequenceDiff("ATGTAA", "ATGCCCTAA");
    expect(ins).toEqual([{ a: 3, b: 6, kind: "ins" }]);
    const del = sequenceDiff("ATGCCCTAA", "ATGTAA");
    expect(del).toEqual([{ a: 3, b: 3, kind: "del" }]);
    const rng = new Rng(11);
    const src = "ATGAAAAAATAACCCCGGGGTTTT";
    const p = pointMutate(src, rng);
    expect(p).not.toBe(src);
    expect(p.length).toBe(src.length);
    const pd = sequenceDiff(src, p);
    expect(pd).toHaveLength(1);
    expect(pd[0]!.kind).toBe("sub");
    expect(pd[0]!.b - pd[0]!.a).toBe(1);
    const id = indelMutate(src, new Rng(3));
    const idd = sequenceDiff(src, id);
    expect(idd).toHaveLength(1);
    expect(["ins", "del"].includes(idd[0]!.kind)).toBe(true);
    const dup = duplicateMutate(src, new Rng(7)).seq;
    expect(dup.length).toBeGreaterThan(src.length);
    const dd = sequenceDiff(src, dup);
    expect(dd).toHaveLength(1);
    expect(dd[0]!.kind === "ins" || dd[0]!.kind === "sub").toBe(true);
  });

  it("aligns identical sequences, substitutions, insertions and deletions", () => {
    const same = alignSequences("ATGCAT", "ATGCAT");
    expect(same.a).toBe("ATGCAT");
    expect(same.b).toBe("ATGCAT");
    expect(same.matches).toBe(6);
    expect(same.mismatches).toBe(0);
    expect(same.gaps).toBe(0);
    expect(same.score).toBe(6);

    const sub = alignSequences("ACGT", "ACCT");
    expect(sub.a.replace(/-/g, "")).toBe("ACGT");
    expect(sub.b.replace(/-/g, "")).toBe("ACCT");
    expect(sub.mismatches).toBe(1);
    expect(sub.matches).toBe(3);

    const ins = alignSequences("ACGT", "ACGGT");
    expect(ins.a.replace(/-/g, "")).toBe("ACGT");
    expect(ins.b.replace(/-/g, "")).toBe("ACGGT");
    expect(ins.gaps).toBe(1);
    expect(ins.a.includes("-")).toBe(true);

    const del = alignSequences("ACGGT", "ACGT");
    expect(del.b.includes("-")).toBe(true);
    expect(del.gaps).toBe(1);
    expect(del.a.replace(/-/g, "")).toBe("ACGGT");
  });
});
