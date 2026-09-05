import type { Phenotype } from "./mapping";
import type { EnvSample, NeighborEffects } from "./types";

/**
 * Instantaneous fitness: a finite scalar of phenotype × environment.
 * Energy (in World) integrates this; fitness itself is the comparable score.
 *
 *   harvest   = uptake * nutrient + photo * light
 *   toxin     = toxin * (1 - resist) * 1.15
 *   thermal   = |temperature - tpref| * 0.85
 *   maintain  = 0.04 + 0.05 * size
 *   fitness   = harvest - toxin - thermal - maintain + predation + mutualism
 *
 * Hue is display-only and does not enter fitness.
 */
export function fitness(ph: Phenotype, env: EnvSample, neighbors: NeighborEffects): number {
  const harvest = ph.uptake * env.nutrient + ph.photo * env.light;
  const tox = env.toxin * (1 - ph.resist) * 1.15;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.85;
  const maintain = 0.04 + 0.05 * ph.size;
  const v = harvest - tox - therm - maintain + neighbors.predationGain + neighbors.mutualismGain;
  return Number.isFinite(v) ? v : 0;
}

export function metabolicDelta(ph: Phenotype, env: EnvSample): number {
  const gain = ph.uptake * env.nutrient * 0.21 + ph.photo * env.light * 0.14;
  const tox = env.toxin * (1 - ph.resist) * 0.3;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.12;
  const maintain = 0.04 + 0.028 * ph.size;
  const v = gain - tox - therm - maintain;
  return Number.isFinite(v) ? v : 0;
}

export function reproduceThreshold(ph: Phenotype, base: number): number {
  const t = base / (0.65 + 0.5 * ph.fecundity);
  return t < 0.4 ? 0.4 : t;
}
