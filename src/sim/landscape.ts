/**
 * Local fitness landscape: every sense-codon substitution inside coding
 * regions, scored with fitness(ph, env, zero neighbors). No RNG.
 */
import { annotateSequence, phenotypeDelta, replaceRange } from "./dnaEdit";
import { fitness } from "./fitness";
import { decodeGenome } from "./genome";
import { BASES, TRAIT_NAMES, isStopCodon, type TraitName } from "./mapping";
import type { EnvSample, NeighborEffects } from "./types";

export const ZERO_NEIGHBORS: NeighborEffects = { predationGain: 0 };

export function senseCodons(): string[] {
  const out: string[] = [];
  for (const a of BASES) for (const b of BASES) for (const c of BASES) {
    const codon = a + b + c;
    if (!isStopCodon(codon)) out.push(codon);
  }
  return out;
}

export const SENSE_CODONS: readonly string[] = senseCodons();

export interface LandscapeHit {
  position: number;
  codon: string;
  from: string;
  fitness: number;
  deltaFitness: number;
  traits: Partial<Record<TraitName, number>>;
}

export interface LandscapeProbe {
  baseline: number;
  best: LandscapeHit[];
  worst: LandscapeHit[];
}

function phenoKey(ph: Record<TraitName, number>): string {
  let s = "";
  for (const t of TRAIT_NAMES) s += `${ph[t]!.toFixed(5)},`;
  return s;
}

export function probeLandscape(genome: string, env: EnvSample, n = 10): LandscapeProbe {
  const ann = annotateSequence(genome);
  const seq = ann.decoded.sequence;
  const basePh = ann.decoded.phenotype;
  const baseline = fitness(basePh, env, ZERO_NEIGHBORS);
  const baseKey = phenoKey(basePh);
  const coding = ann.cells.filter((c) => c.role === "coding" && c.bases.length === 3);
  const seen = new Map<string, LandscapeHit>();
  for (const cell of coding) {
    for (const codon of SENSE_CODONS) {
      if (codon === cell.bases) continue;
      const next = replaceRange(seq, cell.start, cell.start + 3, codon);
      const ph = decodeGenome(next).phenotype;
      const key = phenoKey(ph);
      if (key === baseKey || seen.has(key)) continue;
      const fit = fitness(ph, env, ZERO_NEIGHBORS);
      const delta = phenotypeDelta(ph, basePh);
      const traits: Partial<Record<TraitName, number>> = {};
      for (const t of TRAIT_NAMES) {
        const d = delta[t]!;
        if (d !== 0) traits[t] = d;
      }
      seen.set(key, {
        position: cell.start,
        codon,
        from: cell.bases,
        fitness: fit,
        deltaFitness: fit - baseline,
        traits,
      });
    }
  }
  const all = [...seen.values()];
  const best = all.slice().sort((a, b) => b.fitness - a.fitness || a.position - b.position).slice(0, Math.max(0, n));
  const worst = all.slice().sort((a, b) => a.fitness - b.fitness || a.position - b.position).slice(0, Math.max(0, n));
  return { baseline, best, worst };
}
