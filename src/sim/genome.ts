import {
  ALPHABET,
  BASES,
  CODON_INDEX,
  CODON_LEN,
  MAX_GENOME,
  MIN_GENOME,
  REG_CROSS,
  REG_MAX,
  REG_SELF,
  REG_WINDOW,
  START_CODON,
  STOP_CODONS,
  TRAIT_NAMES,
  TRAIT_COLOR,
  codonsForTrait,
  isStopCodon,
  phenotypeFromRaw,
  zeroTraits,
  type Phenotype,
  type TraitName,
} from "./mapping";
import type { Rng } from "./rng";
import type { Gene, MutationKind, MutationRates } from "./types";

export interface GeneRegulation {
  geneIndex: number;
  /** Upstream window, bounded by the previous ORF's end. */
  from: number;
  to: number;
  upstream: Partial<Record<TraitName, number>>;
  multiplier: number;
}

export interface DecodedGenome {
  sequence: string;
  genes: Gene[];
  raw: Record<TraitName, number>;
  phenotype: Phenotype;
  /** One entry per decoded gene (empty when regulation is disabled). */
  regulation: GeneRegulation[];
}

/**
 * Codon counts in a gene's upstream window, read backwards from the ATG in
 * triplets so the reading frame is anchored at the gene start (intergenic
 * sequence has no frame of its own; anchoring at the ATG is deterministic and
 * matches how the window is edited in the DNA editor).
 */
function upstreamCounts(
  seq: string,
  from: number,
  to: number,
): { counts: Record<TraitName, number>; from: number } {
  const counts = zeroTraits();
  const limit = Math.max(from, to - REG_WINDOW);
  let lo = to;
  while (lo - CODON_LEN >= limit) {
    const rule = CODON_INDEX[seq.slice(lo - CODON_LEN, lo)];
    if (rule) counts[rule.trait] += 1;
    lo -= CODON_LEN;
  }
  return { counts, from: lo };
}

export interface GenomeTrack {
  sequence: string;
  genes: Array<{
    name: string;
    start: number;
    end: number;
    color: string;
    trait: string;
    translation: string;
    contrib: Record<string, number>;
  }>;
}

export function sanitizeSequence(seq: string): string {
  let out = "";
  const up = seq.toUpperCase();
  for (let i = 0; i < up.length && out.length < MAX_GENOME; i++) {
    const c = up[i]!;
    if (ALPHABET.includes(c)) out += c;
  }
  return out;
}

function dominantTrait(contrib: Record<TraitName, number>): TraitName {
  let best: TraitName = "uptake";
  let mag = -1;
  for (const t of TRAIT_NAMES) {
    const a = Math.abs(contrib[t]);
    if (a > mag) {
      mag = a;
      best = t;
    }
  }
  return best;
}

/**
 * Scan ORFs (ATG … TAA/TAG/TGA) in any frame. Translation skips the start
 * codon. Unclosed ORFs are ignored. Trait deltas come only from CODON_INDEX.
 */
export function decodeGenome(
  sequence: string,
  opts: { regulation?: boolean } = {},
): DecodedGenome {
  const regulationEnabled = opts.regulation !== false;
  const seq = sanitizeSequence(sequence);
  const genes: Gene[] = [];
  const regulation: GeneRegulation[] = [];
  const raw = zeroTraits();
  let lastOrfEnd = 0;
  let i = 0;
  while (i + CODON_LEN <= seq.length) {
    if (seq.slice(i, i + CODON_LEN) === START_CODON) {
      const geneStart = i;
      const prevEnd = lastOrfEnd;
      i += CODON_LEN;
      let aas = "";
      const contrib = zeroTraits();
      let closed = false;
      while (i + CODON_LEN <= seq.length) {
        const codon = seq.slice(i, i + CODON_LEN);
        if (isStopCodon(codon)) {
          i += CODON_LEN;
          closed = true;
          break;
        }
        const rule = CODON_INDEX[codon];
        if (rule) {
          aas += rule.aa;
          contrib[rule.trait] += rule.delta;
          for (const extra of rule.extras) contrib[extra.trait] += extra.delta;
        }
        i += CODON_LEN;
      }
      if (!closed) break;
      if (aas.length === 0) {
        lastOrfEnd = i;
        continue;
      }
      const dominant = dominantTrait(contrib);
      let multiplier = 1;
      const up = upstreamCounts(seq, prevEnd, geneStart);
      lastOrfEnd = i;
      if (regulationEnabled) {
        let cross = 0;
        for (const t of TRAIT_NAMES) {
          if (t === dominant) continue;
          const c = up.counts[t];
          if (c > cross) cross = c;
        }
        multiplier = Math.min(REG_MAX, 1 + REG_SELF * (up.counts[dominant] ?? 0) + REG_CROSS * cross);
        if (multiplier !== 1) {
          for (const t of TRAIT_NAMES) contrib[t] *= multiplier;
        }
      }
      const upstream: Partial<Record<TraitName, number>> = {};
      for (const t of TRAIT_NAMES) {
        const c = up.counts[t];
        if (c > 0) upstream[t] = c;
      }
      regulation.push({ geneIndex: genes.length, from: up.from, to: geneStart, upstream, multiplier });
      const gene: Gene = {
        name: `${dominant.slice(0, 3)}_${geneStart}`,
        start: geneStart,
        end: i,
        stop: i - CODON_LEN,
        translation: aas,
        contrib,
        dominant,
      };
      genes.push(gene);
      for (const t of TRAIT_NAMES) raw[t] += contrib[t];
    } else {
      i += 1;
    }
  }
  return { sequence: seq, genes, raw, phenotype: phenotypeFromRaw(raw), regulation };
}

export function toGenomeTrack(decoded: DecodedGenome): GenomeTrack {
  return {
    sequence: decoded.sequence,
    genes: decoded.genes.map((g) => ({
      name: g.name,
      start: g.start,
      end: g.end,
      color: TRAIT_COLOR[g.dominant as TraitName] ?? "#8aa0b5",
      trait: g.dominant,
      translation: g.translation,
      contrib: { ...g.contrib },
    })),
  };
}

export function pointMutate(seq: string, rng: Rng): string {
  const s = seq.length === 0 ? START_CODON : seq;
  const i = rng.int(s.length);
  const cur = s[i]!;
  let b = BASES[rng.int(4)]!;
  if (b === cur) b = BASES[(BASES.indexOf(cur as (typeof BASES)[number]) + 1 + rng.int(3)) % 4]!;
  return s.slice(0, i) + b + s.slice(i + 1);
}

export function indelMutate(seq: string, rng: Rng): string {
  const n = 1 + rng.int(3);
  const insert = rng.chance(0.5);
  if (insert && seq.length + n <= MAX_GENOME) {
    const i = rng.int(seq.length + 1);
    let ins = "";
    for (let k = 0; k < n; k++) ins += BASES[rng.int(4)];
    return seq.slice(0, i) + ins + seq.slice(i);
  }
  if (!insert && seq.length - n >= MIN_GENOME) {
    const i = rng.int(seq.length - n + 1);
    return seq.slice(0, i) + seq.slice(i + n);
  }
  if (seq.length + n <= MAX_GENOME) {
    const i = rng.int(seq.length + 1);
    let ins = "";
    for (let k = 0; k < n; k++) ins += BASES[rng.int(4)];
    return seq.slice(0, i) + ins + seq.slice(i);
  }
  return pointMutate(seq, rng);
}

export function duplicateMutate(seq: string, rng: Rng): { seq: string; copied: string } {
  if (seq.length < 3) {
    const copied = seq.length ? seq : "ATG";
    const next = (seq + copied).slice(0, MAX_GENOME);
    return { seq: next, copied };
  }
  const maxLen = Math.min(24, seq.length);
  const len = Math.min(seq.length, 3 + rng.int(Math.max(1, maxLen - 2)));
  const start = rng.int(seq.length - len + 1);
  const copied = seq.slice(start, start + len);
  if (seq.length + copied.length > MAX_GENOME) {
    return { seq: pointMutate(seq, rng), copied };
  }
  const ins = rng.int(seq.length + 1);
  return { seq: seq.slice(0, ins) + copied + seq.slice(ins), copied };
}

/**
 * Single-point crossover with independent cut points, sanitized and capped.
 * Used for both sex and horizontal transfer; the caller records the donor.
 */
export function recombine(a: string, b: string, rng: Rng): string {
  if (a.length === 0 || b.length === 0) return a || b;
  const cutA = rng.int(a.length + 1);
  const cutB = rng.int(b.length + 1);
  const child = sanitizeSequence(a.slice(0, cutA) + b.slice(cutB));
  if (child.length < MIN_GENOME) return a.length >= b.length ? a : b;
  return child;
}

export function mutate(
  seq: string,
  rng: Rng,
  rates: MutationRates,
): { seq: string; kind: MutationKind | null; copied?: string } {
  if (!rng.chance(rates.rate)) return { seq, kind: null };
  const w = rates.point + rates.indel + rates.duplication;
  const u = rng.next() * (w > 0 ? w : 1);
  if (u < rates.point) return { seq: pointMutate(seq, rng), kind: "point" };
  if (u < rates.point + rates.indel) return { seq: indelMutate(seq, rng), kind: "indel" };
  const d = duplicateMutate(seq, rng);
  return { seq: d.seq, kind: "duplication", copied: d.copied };
}

export function geneCassette(trait: TraitName, nCodons: number): string {
  const codons = codonsForTrait(trait);
  const pick = codons.length ? codons : ["GAA"];
  let body = "";
  for (let i = 0; i < nCodons; i++) body += pick[i % pick.length];
  return START_CODON + body + STOP_CODONS[0];
}

export function assembleGenome(parts: string[], spacer = "CC"): string {
  return sanitizeSequence(parts.join(spacer)).slice(0, MAX_GENOME);
}

export function founderPhototroph(): string {
  return assembleGenome([geneCassette("photo", 6), geneCassette("size", 2), geneCassette("resist", 1)]);
}

export function founderHeterotroph(): string {
  return assembleGenome([geneCassette("uptake", 6), geneCassette("motility", 3), geneCassette("fecundity", 2)]);
}

export function founderResistant(): string {
  // uptake x5 and fecundity x2, not uptake x3 / tpref x2. At uptake x3 the
  // kit's saturated nutrient income (uptake^2 x UPTAKE_GAIN, about 0.044) was
  // below its own maintenance (0.067), so a dropped Resistant starved within
  // fifteen ticks whatever the plate held; the tpref cassettes then pushed its
  // preferred temperature away from the ambient and cost it another 0.028 per
  // tick. The resist-for-uptake trade-off stays, but the kit can now feed.
  return assembleGenome([geneCassette("resist", 5), geneCassette("uptake", 5), geneCassette("motility", 3)]);
}

export function founderPredator(): string {
  return assembleGenome([
    geneCassette("aggression", 5),
    geneCassette("motility", 3),
    geneCassette("uptake", 2),
  ]);
}

export function founderMutualist(channelCodons = 2): string {
  // motility x3 for the same reason as the Resistant kit: a supply-limited
  // plate is harvested by roaming, and a stationary kit sits at break-even.
  return assembleGenome([
    geneCassette("signal", channelCodons),
    geneCassette("uptake", 3),
    geneCassette("photo", 2),
    geneCassette("motility", 3),
  ]);
}

export function randomGenome(rng: Rng, cassettes = 4): string {
  // Derived from TRAIT_NAMES, so a trait added to the table cannot be silently
  // missing from the random founders (mutator and longevity were both absent
  // from the hand-written list this replaces).
  const traits: readonly TraitName[] = TRAIT_NAMES;
  const parts: string[] = [];
  const n = 2 + rng.int(cassettes);
  for (let i = 0; i < n; i++) {
    const t = traits[rng.int(traits.length)]!;
    parts.push(geneCassette(t, 1 + rng.int(5)));
    if (rng.chance(0.4)) {
      let junk = "";
      const jn = rng.int(6);
      for (let k = 0; k < jn; k++) junk += BASES[rng.int(4)];
      parts.push(junk);
    }
  }
  const g = assembleGenome(parts);
  return g.length >= MIN_GENOME ? g : founderHeterotroph();
}

export function genomeSignature(seq: string): string {
  // FNV-1a over the sequence — compact genotype id for metrics.
  let h = 2166136261;
  for (let i = 0; i < seq.length; i++) {
    h ^= seq.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + ":" + seq.length;
}
