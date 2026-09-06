import { assembleGenome, decodeGenome, geneCassette } from "./genome";
import { TRAIT_COLOR, TRAIT_NAMES, TRAIT_SPEC, type TraitName } from "./mapping";

export interface GeneBlock {
  trait: TraitName;
  strength: number;
}

export const GENE_LABEL: Record<TraitName, string> = {
  uptake: "Eat food",
  photo: "Eat light",
  resist: "Resist toxin",
  tpref: "Temperature",
  motility: "Move",
  aggression: "Hunt",
  signal: "Share (signal)",
  hue: "Color",
  fecundity: "Reproduce",
  size: "Size",
};

export function clampStrength(n: number): number {
  const v = Math.round(n);
  if (v < 1) return 1;
  if (v > 8) return 8;
  return v;
}

export function genomeFromBlocks(blocks: readonly GeneBlock[]): string {
  const parts = blocks.map((b) => geneCassette(b.trait, clampStrength(b.strength)));
  return assembleGenome(parts);
}

/** Approximate visual blocks from decoded ORFs (dominant trait + AA length). */
export function blocksFromGenome(seq: string): GeneBlock[] {
  const d = decodeGenome(seq);
  const out: GeneBlock[] = [];
  for (const g of d.genes) {
    const trait = (TRAIT_NAMES as readonly string[]).includes(g.dominant)
      ? (g.dominant as TraitName)
      : "uptake";
    out.push({ trait, strength: clampStrength(g.translation.length || 1) });
  }
  return out;
}

export function addBlock(blocks: GeneBlock[], trait: TraitName): GeneBlock[] {
  return [...blocks, { trait, strength: 3 }];
}

export function setBlockStrength(blocks: GeneBlock[], index: number, strength: number): GeneBlock[] {
  return blocks.map((b, i) => (i === index ? { ...b, strength: clampStrength(strength) } : b));
}

export function removeBlock(blocks: GeneBlock[], index: number): GeneBlock[] {
  return blocks.filter((_, i) => i !== index);
}

export function moveBlock(blocks: GeneBlock[], index: number, dir: -1 | 1): GeneBlock[] {
  const j = index + dir;
  if (index < 0 || index >= blocks.length || j < 0 || j >= blocks.length) return blocks;
  const next = blocks.slice();
  const a = next[index]!;
  next[index] = next[j]!;
  next[j] = a;
  return next;
}

export function geneColor(trait: TraitName): string {
  return TRAIT_COLOR[trait];
}

export function geneHint(trait: TraitName): string {
  return TRAIT_SPEC[trait].description;
}
