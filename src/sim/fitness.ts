import { EXUDATE_FITNESS, EXUDATE_YIELD, PHOTO_GAIN, UPTAKE_GAIN } from "./chemistry";
import type { Phenotype } from "./mapping";
import { DEFAULT_UPKEEP, type UpkeepRates } from "./params";
import type { EnvSample, NeighborEffects, SimParams } from "./types";

/** The life-history upkeeps of a parameter set, for the two ledgers. */
export function upkeepRates(p: Pick<SimParams, "longevityUpkeep" | "aggressionUpkeep">): UpkeepRates {
  return { longevity: p.longevityUpkeep, aggression: p.aggressionUpkeep };
}

/**
 * Instantaneous fitness: a finite scalar of phenotype × environment.
 * Energy (in World) integrates the ledger `metabolicDelta`; fitness itself is
 * the comparable score used by competition and by the charts.
 *
 *   harvest   = uptake * nutrient + photo * light + uptake * exudate
 *   toxin     = toxin * (1 - resist) * 1.15
 *   thermal   = |temperature - tpref| * 0.85
 *   maintain  = 0.04 + 0.05 * size * bodyScale + genomeUpkeep
 *               + longevityUpkeep(ph, params.longevityUpkeep)
 *               + aggressionUpkeep(ph, params.aggressionUpkeep)
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
  upkeep: UpkeepRates = DEFAULT_UPKEEP,
): number {
  const harvest = ph.uptake * env.nutrient + ph.photo * env.light + ph.uptake * env.exudate * EXUDATE_FITNESS;
  const tox = env.toxin * (1 - ph.resist) * 1.15;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.85;
  const maintain =
    0.04 +
    0.05 * ph.size * bodyScale +
    genomeUpkeep +
    longevityUpkeep(ph, upkeep.longevity) +
    aggressionUpkeep(ph, upkeep.aggression);
  const v = harvest - tox - therm - maintain + neighbors.predationGain;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Upkeep charged per unit of lifespan multiplier above the published ceiling.
 * Without it a longevity gene would be free and would fix at its maximum; with
 * it, selection faces the classic trade-off between living longer and paying for
 * it every tick.
 */
/**
 * The lifespan term, shared by both ledgers. Charging it in the comparable
 * score as well as the energy ledger keeps a long-lived organism from winning
 * cell contests on a cost it never pays.
 */
export function longevityUpkeep(ph: Phenotype, rate: number = DEFAULT_UPKEEP.longevity): number {
  return ph.longevity > 1 ? rate * (ph.longevity - 1) : 0;
}

/**
 * Upkeep of the hunting apparatus, per unit of aggression. Free aggression has
 * no counterweight: without this term the trait sweeps to fixation, every
 * organism becomes a predator and the plate eats itself — measured on the
 * default plate, mean aggression reached 0.98 and the population went extinct
 * around tick 1300, against a stable 3000+ tick plate when predation is off.
 */
/** The aggression term, charged in both ledgers for the same reason. */
export function aggressionUpkeep(ph: Phenotype, rate: number = DEFAULT_UPKEEP.aggression): number {
  return rate * ph.aggression;
}

/** Per-tick maintenance cost, shared by the energy ledger and the overflow rule. */
export function maintenanceCost(
  ph: Phenotype,
  bodyScale = 1,
  genomeUpkeep = 0,
  upkeep: UpkeepRates = DEFAULT_UPKEEP,
): number {
  return (
    0.04 +
    0.028 * ph.size * bodyScale +
    genomeUpkeep +
    longevityUpkeep(ph, upkeep.longevity) +
    aggressionUpkeep(ph, upkeep.aggression)
  );
}

/** Energy ledger: the coefficients here are the ones the world integrates. */
export function metabolicDelta(
  ph: Phenotype,
  env: EnvSample,
  bodyScale = 1,
  genomeUpkeep = 0,
  upkeep: UpkeepRates = DEFAULT_UPKEEP,
): number {
  const gain =
    ph.uptake * env.nutrient * UPTAKE_GAIN +
    ph.photo * env.light * PHOTO_GAIN +
    ph.uptake * env.exudate * EXUDATE_YIELD;
  const tox = env.toxin * (1 - ph.resist) * 0.3;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.12;
  const v = gain - tox - therm - maintenanceCost(ph, bodyScale, genomeUpkeep, upkeep);
  return Number.isFinite(v) ? v : 0;
}

export function reproduceThreshold(ph: Phenotype, base: number): number {
  const t = base / (0.65 + 0.5 * ph.fecundity);
  return t < 0.4 ? 0.4 : t;
}
