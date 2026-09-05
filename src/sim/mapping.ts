/**
 * Explicit genome → phenotype mapping.
 *
 * This module is the single source of truth: Vitest, decodeGenome, the
 * genome browser, and the inspect panel all import these tables. Do not
 * duplicate the codon rules elsewhere.
 *
 * Model (Avida-class, not a biochemistry simulator):
 *   sequence  →  ORFs (ATG … stop)  →  codon table  →  trait deltas
 *   phenotype[trait] = squash(BASAL[trait] + sum of codon deltas)
 *
 * PHASE 2 HOOK: real molecular biochemistry would replace scalar trait
 * deltas with a metabolic reaction network. Keep this table as the
 * readable stand-in until then.
 */

export const ALPHABET = "ACGT";
export const BASES = ["A", "C", "G", "T"] as const;
export type Base = (typeof BASES)[number];

export const CODON_LEN = 3;
export const START_CODON = "ATG";
export const STOP_CODONS = ["TAA", "TAG", "TGA"] as const;

export const MIN_GENOME = 9;
export const MAX_GENOME = 384;

export const TRAIT_NAMES = [
  "uptake",
  "photo",
  "resist",
  "tpref",
  "motility",
  "aggression",
  "signal",
  "hue",
  "fecundity",
  "size",
] as const;
export type TraitName = (typeof TRAIT_NAMES)[number];

export type SquashKind = "clamp" | "tanh01" | "quant7";

export interface TraitSpec {
  min: number;
  max: number;
  squash: SquashKind;
  description: string;
}

export const TRAIT_SPEC: Record<TraitName, TraitSpec> = {
  uptake: {
    min: 0,
    max: 2.2,
    squash: "clamp",
    description: "Nutrient harvest rate from the local nutrient field",
  },
  photo: {
    min: 0,
    max: 2.2,
    squash: "clamp",
    description: "Light-driven energy gain from the local light field",
  },
  resist: {
    min: 0,
    max: 1,
    squash: "clamp",
    description: "Fraction of toxin damage ignored [0–1]",
  },
  tpref: {
    min: 0,
    max: 1,
    squash: "tanh01",
    description: "Preferred temperature [0 cold … 1 hot]",
  },
  motility: {
    min: 0,
    max: 1,
    squash: "clamp",
    description: "Per-tick probability of attempting a move",
  },
  aggression: {
    min: 0,
    max: 1,
    squash: "clamp",
    description: "Predation strength; high values eat weaker neighbors",
  },
  signal: {
    min: 0,
    max: 7,
    squash: "quant7",
    description: "Mutualism channel 0–7; matching neighbors share energy",
  },
  hue: {
    min: 0,
    max: 1,
    squash: "tanh01",
    description: "Display hue (visual only; not a fitness input)",
  },
  fecundity: {
    min: 0.25,
    max: 2,
    squash: "clamp",
    description: "Reproduction efficiency (lower energy threshold, more split)",
  },
  size: {
    min: 0.4,
    max: 2.2,
    squash: "clamp",
    description: "Body size; raises maintenance cost and point size",
  },
};

export const TRAIT_COLOR: Record<TraitName, string> = {
  uptake: "#3ee0c0",
  photo: "#f0d35a",
  resist: "#c87bff",
  tpref: "#ff7a45",
  motility: "#6ea8ff",
  aggression: "#ff4d6d",
  signal: "#9dffb0",
  hue: "#e8e8ff",
  fecundity: "#b08cff",
  size: "#8aa0b5",
};

export const BASE_COLOR: Record<Base, string> = {
  A: "#3ee0c0",
  C: "#6ea8ff",
  G: "#f0d35a",
  T: "#ff6b8a",
};

export interface Phenotype {
  uptake: number;
  photo: number;
  resist: number;
  tpref: number;
  motility: number;
  aggression: number;
  signal: number;
  hue: number;
  fecundity: number;
  size: number;
}

/** Basal trait vector for a genome with no ORFs. */
export const BASAL: Phenotype = {
  uptake: 0.18,
  photo: 0.02,
  resist: 0.05,
  tpref: 0.5,
  motility: 0.16,
  aggression: 0.02,
  signal: 0,
  hue: 0.55,
  fecundity: 0.55,
  size: 0.9,
};

export interface CodonRule {
  codon: string;
  aa: string;
  trait: TraitName;
  delta: number;
  label: string;
}

interface AaGroup {
  aa: string;
  codons: string[];
  trait: TraitName;
  delta: number;
}

/**
 * Amino-acid analog groups. Codons follow the standard genetic code so the
 * table is readable to anyone who has seen a codon wheel; trait assignment
 * is the lab's explicit design, not biochemistry.
 */
const AA_GROUPS: readonly AaGroup[] = [
  { aa: "F", codons: ["TTT", "TTC"], trait: "hue", delta: 0.08 },
  { aa: "L", codons: ["TTA", "TTG", "CTT", "CTC", "CTA", "CTG"], trait: "size", delta: 0.07 },
  { aa: "I", codons: ["ATT", "ATC", "ATA"], trait: "uptake", delta: 0.1 },
  { aa: "M", codons: ["ATG"], trait: "uptake", delta: 0.06 },
  { aa: "V", codons: ["GTT", "GTC", "GTA", "GTG"], trait: "motility", delta: 0.09 },
  { aa: "S", codons: ["TCT", "TCC", "TCA", "TCG", "AGT", "AGC"], trait: "resist", delta: 0.09 },
  { aa: "P", codons: ["CCT", "CCC", "CCA", "CCG"], trait: "size", delta: 0.05 },
  { aa: "T", codons: ["ACT", "ACC"], trait: "tpref", delta: 0.12 },
  { aa: "T", codons: ["ACA", "ACG"], trait: "tpref", delta: -0.12 },
  { aa: "A", codons: ["GCT", "GCC", "GCA", "GCG"], trait: "fecundity", delta: 0.08 },
  { aa: "Y", codons: ["TAT", "TAC"], trait: "photo", delta: 0.14 },
  { aa: "H", codons: ["CAT", "CAC"], trait: "signal", delta: 0.9 },
  { aa: "Q", codons: ["CAA", "CAG"], trait: "signal", delta: 0.7 },
  { aa: "N", codons: ["AAT", "AAC"], trait: "uptake", delta: 0.09 },
  { aa: "K", codons: ["AAA", "AAG"], trait: "aggression", delta: 0.14 },
  { aa: "D", codons: ["GAT", "GAC"], trait: "photo", delta: 0.1 },
  { aa: "E", codons: ["GAA", "GAG"], trait: "uptake", delta: 0.12 },
  { aa: "C", codons: ["TGT", "TGC"], trait: "resist", delta: 0.16 },
  { aa: "W", codons: ["TGG"], trait: "hue", delta: 0.18 },
  { aa: "R", codons: ["CGT", "CGC", "CGA", "CGG", "AGA", "AGG"], trait: "aggression", delta: 0.08 },
  { aa: "G", codons: ["GGT", "GGC", "GGA", "GGG"], trait: "motility", delta: 0.06 },
];

function buildCodonTable(): CodonRule[] {
  const rows: CodonRule[] = [];
  for (const g of AA_GROUPS) {
    for (const codon of g.codons) {
      const sign = g.delta >= 0 ? "+" : "";
      rows.push({
        codon,
        aa: g.aa,
        trait: g.trait,
        delta: g.delta,
        label: `${g.aa} → ${g.trait} ${sign}${g.delta}`,
      });
    }
  }
  rows.sort((a, b) => a.codon.localeCompare(b.codon));
  return rows;
}

export const CODON_TABLE: readonly CodonRule[] = buildCodonTable();

export const CODON_INDEX: Readonly<Record<string, CodonRule>> = Object.freeze(
  Object.fromEntries(CODON_TABLE.map((r) => [r.codon, r])),
);

export function isStopCodon(codon: string): boolean {
  return (STOP_CODONS as readonly string[]).includes(codon);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function squashTrait(name: TraitName, raw: number): number {
  const spec = TRAIT_SPEC[name];
  switch (spec.squash) {
    case "clamp":
      return clamp(raw, spec.min, spec.max);
    case "tanh01": {
      const u = 0.5 + 0.5 * Math.tanh(raw);
      return clamp(u, spec.min, spec.max);
    }
    case "quant7":
      return clamp(Math.round(raw), spec.min, spec.max);
  }
}

export function zeroTraits(): Record<TraitName, number> {
  const o = {} as Record<TraitName, number>;
  for (const t of TRAIT_NAMES) o[t] = 0;
  return o;
}

export function phenotypeFromRaw(raw: Record<TraitName, number>): Phenotype {
  const p = {} as Phenotype;
  for (const t of TRAIT_NAMES) {
    p[t] = squashTrait(t, BASAL[t] + raw[t]);
  }
  return p;
}

export function copyPhenotype(p: Phenotype): Phenotype {
  return {
    uptake: p.uptake,
    photo: p.photo,
    resist: p.resist,
    tpref: p.tpref,
    motility: p.motility,
    aggression: p.aggression,
    signal: p.signal,
    hue: p.hue,
    fecundity: p.fecundity,
    size: p.size,
  };
}

export function codonsForTrait(trait: TraitName): string[] {
  return CODON_TABLE.filter((r) => r.trait === trait && r.delta > 0).map((r) => r.codon);
}

export function mappingLegend(): { codon: string; aa: string; trait: TraitName; delta: number }[] {
  return CODON_TABLE.map((r) => ({
    codon: r.codon,
    aa: r.aa,
    trait: r.trait,
    delta: r.delta,
  }));
}
