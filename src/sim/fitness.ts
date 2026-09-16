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
 *   maintain  = 0.04 + 0.05 * size * bodyScale + genomeUpkeep + longevityUpkeep
 *               + aggressionUpkeep
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
  const maintain =
    0.04 + 0.05 * ph.size * bodyScale + genomeUpkeep + longevityUpkeep(ph) + aggressionUpkeep(ph);
  const v = harvest - tox - therm - maintain + neighbors.predationGain;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Upkeep charged per unit of lifespan multiplier above the published ceiling.
 * Without it a longevity gene would be free and would fix at its maximum; with
 * it, selection faces the classic trade-off between living longer and paying for
 * it every tick.
 */
export const LONGEVITY_UPKEEP = 0.012;

/**
 * The lifespan term, shared by both ledgers. Charging it in the comparable
 * score as well as the energy ledger keeps a long-lived organism from winning
 * cell contests on a cost it never pays.
 */
export function longevityUpkeep(ph: Phenotype): number {
  return ph.longevity > 1 ? LONGEVITY_UPKEEP * (ph.longevity - 1) : 0;
}

/**
 * Upkeep of the hunting apparatus, per unit of aggression. Free aggression has
 * no counterweight: without this term the trait sweeps to fixation, every
 * organism becomes a predator and the plate eats itself — measured on the
 * default plate, mean aggression reached 0.98 and the population went extinct
 * around tick 1300, against a stable 3000+ tick plate when predation is off.
 */
export const AGGRESSION_UPKEEP = 0.30;

/** The aggression term, charged in both ledgers for the same reason. */
export function aggressionUpkeep(ph: Phenotype): number {
  return AGGRESSION_UPKEEP * ph.aggression;
}

/** Per-tick maintenance cost, shared by the energy ledger and the overflow rule. */
export function maintenanceCost(ph: Phenotype, bodyScale = 1, genomeUpkeep = 0): number {
  return 0.04 + 0.028 * ph.size * bodyScale + genomeUpkeep + longevityUpkeep(ph) + aggressionUpkeep(ph);
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
