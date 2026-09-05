import { describe, expect, it } from "vitest";
import {
  BASAL,
  CODON_INDEX,
  START_CODON,
  World,
  decodeGenome,
  duplicateMutate,
  fitness,
  founderHeterotroph,
  founderPhototroph,
  geneCassette,
  indelMutate,
  mutate,
  pointMutate,
  squashTrait,
} from "../src/sim/index";
import { Rng } from "../src/sim/rng";

const ENV = { nutrient: 0.8, toxin: 0.1, temperature: 0.5, light: 0.9 };
const NONE = { predationGain: 0, mutualismGain: 0 };

describe("genome → phenotype mapping", () => {
  it("decodes a representative genome to documented codon deltas", () => {
    const rule = CODON_INDEX["AAA"];
    expect(rule).toBeDefined();
    expect(rule!.trait).toBe("aggression");
    const seq = START_CODON + "AAA" + "AAA" + "TAA";
    const decoded = decodeGenome(seq);
    expect(decoded.sequence).toBe(seq);
    expect(decoded.genes).toHaveLength(1);
    expect(decoded.genes[0]!.translation).toBe("KK");
    expect(decoded.genes[0]!.dominant).toBe("aggression");
    expect(decoded.raw.aggression).toBeCloseTo(rule!.delta * 2, 10);
    expect(decoded.phenotype.aggression).toBeCloseTo(
      squashTrait("aggression", BASAL.aggression + rule!.delta * 2),
      10,
    );
  });

  it("maps a photo cassette through the same table the browser uses", () => {
    const seq = geneCassette("photo", 4);
    const decoded = decodeGenome(seq);
    expect(decoded.genes.length).toBeGreaterThanOrEqual(1);
    const gene = decoded.genes[0]!;
    expect(gene.translation.length).toBe(4);
    let expected = 0;
    for (let i = 0; i < 4; i++) {
      const codon = seq.slice(3 + i * 3, 6 + i * 3);
      const r = CODON_INDEX[codon];
      expect(r).toBeDefined();
      expect(r!.trait).toBe("photo");
      expected += r!.delta;
    }
    expect(gene.contrib.photo).toBeCloseTo(expected, 10);
    expect(decoded.phenotype.photo).toBeCloseTo(squashTrait("photo", BASAL.photo + expected), 10);
  });
});

describe("mutations", () => {
  it("point mutation changes exactly one base and preserves length", () => {
    const seq = "ATGAAAAAATAACCCC";
    const rng = new Rng(1);
    const next = pointMutate(seq, rng);
    expect(next.length).toBe(seq.length);
    let diffs = 0;
    for (let i = 0; i < seq.length; i++) if (seq[i] !== next[i]) diffs++;
    expect(diffs).toBe(1);
    expect(next).not.toBe(seq);
  });

  it("indel changes length by 1–3 bases", () => {
    const seq = "ATGAAAAAATAACCCCGGGGTTTT";
    const rng = new Rng(11);
    const next = indelMutate(seq, rng);
    const d = Math.abs(next.length - seq.length);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(3);
    expect(next).not.toBe(seq);
  });

  it("duplication copies a contiguous subsequence so it appears twice", () => {
    const seq = "ACGTACGTACGTACGTAAAA";
    const rng = new Rng(42);
    const { seq: next, copied } = duplicateMutate(seq, rng);
    expect(copied.length).toBeGreaterThanOrEqual(3);
    expect(next.length).toBe(seq.length + copied.length);
    const first = next.indexOf(copied);
    const second = next.indexOf(copied, first + 1);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  it("mutate() with rate 1 yields a point, indel, or duplication", () => {
    const seq = founderHeterotroph();
    const rng = new Rng(99);
    const result = mutate(seq, rng, { rate: 1, point: 1, indel: 0, duplication: 0 });
    expect(result.kind).toBe("point");
    expect(result.seq.length).toBe(seq.length);
  });
});

describe("fitness", () => {
  it("is a finite number that differs across genomes in the same environment", () => {
    const photo = decodeGenome(founderPhototroph()).phenotype;
    const hetero = decodeGenome(founderHeterotroph()).phenotype;
    const fa = fitness(photo, ENV, NONE);
    const fb = fitness(hetero, ENV, NONE);
    expect(Number.isFinite(fa)).toBe(true);
    expect(Number.isFinite(fb)).toBe(true);
    expect(fa).not.toBe(fb);
    const dark = { ...ENV, light: 0, nutrient: 1 };
    expect(fitness(photo, dark, NONE)).not.toBe(fitness(photo, ENV, NONE));
  });
});

describe("determinism", () => {
  it("same seed+params produce identical hashes at several ticks; a different seed diverges", () => {
    const params = { width: 24, height: 24, seed: 12345, startPopulation: 36, mutationRate: 0.12 };
    const a = new World(params);
    const b = new World(params);
    const hashes: string[] = [];
    for (const t of [1, 10, 25, 40]) {
      while (a.tick < t) a.step();
      while (b.tick < t) b.step();
      expect(a.hashState()).toBe(b.hashState());
      hashes.push(a.hashState());
    }
    expect(new Set(hashes).size).toBeGreaterThan(1);
    const c = new World({ ...params, seed: 12346 });
    while (c.tick < 40) c.step();
    expect(c.hashState()).not.toBe(a.hashState());
  });
});
