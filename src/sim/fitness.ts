import { EXUDATE_FITNESS, EXUDATE_YIELD, PHOTO_GAIN, UPTAKE_GAIN } from "./chemistry";
import type { Phenotype } from "./mapping";
import type { EnvSample, NeighborEffects } from "./types";

/**
 * Instantaneous fitness: a finite scalar of phenotype × environment.
 * Energy (in World) integrates the ledger `metabolicDelta`; fitness itself is
 * the comparable score used by competition and by the charts.
 *
 *   harvest   = uptake * nutrient + photo * light + uptake * exudate
 *   toxin     = toxin * (1 - resist) * 1.15
 *   thermal   = |temperature - tpref| * 0.85
 *   maintain  = 0.04 + 0.05 * size * bodyScale + genomeUpkeep
 *   fitness   = harvest - toxin - thermal - maintain + predation
 *
 * Hue is display-only and does not enter fitness.
 */
export function fitness(
  ph: Phenotype,
  env: EnvSample,
  neighbors: NeighborEffects,
  bodyScale = 1,
  genomeUpkeep = 0,
): number {
  const harvest = ph.uptake * env.nutrient + ph.photo * env.light + ph.uptake * env.exudate * EXUDATE_FITNESS;
  const tox = env.toxin * (1 - ph.resist) * 1.15;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.85;
  const maintain = 0.04 + 0.05 * ph.size * bodyScale + genomeUpkeep;
  const v = harvest - tox - therm - maintain + neighbors.predationGain;
  return Number.isFinite(v) ? v : 0;
}

/** Per-tick maintenance cost, shared by the energy ledger and the overflow rule. */
export function maintenanceCost(ph: Phenotype, bodyScale = 1, genomeUpkeep = 0): number {
  return 0.04 + 0.028 * ph.size * bodyScale + genomeUpkeep;
}

/** Energy ledger: the coefficients here are the ones the world integrates. */
export function metabolicDelta(ph: Phenotype, env: EnvSample, bodyScale = 1, genomeUpkeep = 0): number {
  const gain =
    ph.uptake * env.nutrient * UPTAKE_GAIN +
    ph.photo * env.light * PHOTO_GAIN +
    ph.uptake * env.exudate * EXUDATE_YIELD;
  const tox = env.toxin * (1 - ph.resist) * 0.3;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.12;
  const v = gain - tox - therm - maintenanceCost(ph, bodyScale, genomeUpkeep);
  return Number.isFinite(v) ? v : 0;
}

export function reproduceThreshold(ph: Phenotype, base: number): number {
  const t = base / (0.65 + 0.5 * ph.fecundity);
  return t < 0.4 ? 0.4 : t;
}
