import {
  ALPHABET,
  BASES,
  CODON_INDEX,
  CODON_LEN,
  MAX_GENOME,
  MIN_GENOME,
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

export interface DecodedGenome {
  sequence: string;
  genes: Gene[];
  raw: Record<TraitName, number>;
  phenotype: Phenotype;
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
export function decodeGenome(sequence: string): DecodedGenome {
  const seq = sanitizeSequence(sequence);
  const genes: Gene[] = [];
  const raw = zeroTraits();
  let i = 0;
  while (i + CODON_LEN <= seq.length) {
    if (seq.slice(i, i + CODON_LEN) === START_CODON) {
      const geneStart = i;
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
        }
        i += CODON_LEN;
      }
      if (!closed) break;
      if (aas.length === 0) continue;
      const dominant = dominantTrait(contrib);
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
  return { sequence: seq, genes, raw, phenotype: phenotypeFromRaw(raw) };
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
  return assembleGenome([geneCassette("resist", 5), geneCassette("uptake", 3), geneCassette("tpref", 2)]);
}

export function founderPredator(): string {
  return assembleGenome([
    geneCassette("aggression", 5),
    geneCassette("motility", 3),
    geneCassette("uptake", 2),
  ]);
}

export function founderMutualist(channelCodons = 2): string {
  return assembleGenome([
    geneCassette("signal", channelCodons),
    geneCassette("uptake", 3),
    geneCassette("photo", 2),
  ]);
}

export function randomGenome(rng: Rng, cassettes = 4): string {
  const traits: TraitName[] = [
    "uptake",
    "photo",
    "resist",
    "tpref",
    "motility",
    "aggression",
    "signal",
    "fecundity",
    "size",
    "hue",
  ];
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
