/**
 * Body condition ("corpulence").
 *
 * `Organism.mass` (0–1) is a somatic state, not a gene: it rises with every
 * prey eaten and decays slowly. It scales the effective body size, which in
 * turn raises the energy cap and the maintenance cost, strengthens hunting,
 * and drives the rendered size. Genome-coded `ph.size` is unchanged.
 */
import type { Organism } from "./types";

/** Mass gained per kill, plus a share of the predator's aggression. */
export const MASS_PER_KILL = 0.22;
export const MASS_KILL_AGGRESSION = 0.1;
/** Mass lost per tick when not feeding (full mass fades in ~250 ticks). */
export const MASS_DECAY = 0.004;
/** Effective size = ph.size × (1 + MASS_SIZE_GAIN × mass). */
export const MASS_SIZE_GAIN = 0.6;
/** Hunting power = aggression + MASS_HUNT_BONUS × mass. */
export const MASS_HUNT_BONUS = 0.15;
/** Chemotaxis bonus for moving toward the nearest edible prey. */
export const PREY_ATTRACTION = 0.3;
/** How far (in cells) a predator senses prey. */
export const PREY_SENSE_RADIUS = 6;
/** Maintenance multiplier = 1 + MASS_MAINTENANCE × mass (much weaker than the size gain, so growing pays). */
export const MASS_MAINTENANCE = 0.2;
/** Predators (aggression ≥ threshold) reproduce only once this fed: breeding follows growth. */
export const MASS_TO_BREED = 0.25;
/**
 * Default minimum aggression gap for a kill. The shipped rule keeps predators
 * from eating identical kin; params.kinThreshold = 0 enables cannibalism.
 */
export const KIN_THRESHOLD = 0.1;
/**
 * Extra energy from a prey's body, per unit of its effective size. Small on
 * purpose: it used to be 0.45, which is seven ticks of a stock predator's
 * maintenance *per kill regardless of what the prey had stored*, so a kill
 * always paid and aggression ratcheted to fixation — measured, the mature
 * plate ran to mean aggression 1.3 and collapsed from ~1090 to 69 organisms by
 * tick 6000. At 0.10 a lean prey is a poor meal.
 */
export const MEAL_BODY_BONUS = 0.1;

/**
 * Share of the prey's stored energy a kill transfers: base + per unit of the
 * predator's aggression. The pair used to be 0.35 + 0.40, which together with
 * the old body bonus made a meal worth 15-40 ticks of maintenance and turned
 * the plate into a shark monoculture. 0.30 + 0.30 keeps predation a living
 * strategy (about 37 % of deaths on the default plate) without the runaway.
 */
export const TROPHIC_SHARE_BASE = 0.3;
export const TROPHIC_SHARE_AGGRESSION = 0.3;

type Body = Pick<Organism, "ph"> & { mass?: number };

export function bodySize(o: Body): number {
  return o.ph.size * (1 + MASS_SIZE_GAIN * (o.mass ?? 0));
}

/** Maintenance multiplier relative to the genome-coded size. */
export function maintenanceScale(o: Body): number {
  return 1 + MASS_MAINTENANCE * (o.mass ?? 0);
}

export function huntingPower(o: Body): number {
  return o.ph.aggression + MASS_HUNT_BONUS * (o.mass ?? 0);
}

/**
 * Gap that decides a kill, or null when `pred` cannot prey on `other`.
 * Eligibility uses genome aggression only (so well-fed predators do not
 * start eating identical kin); body mass then widens the gap, i.e. the
 * chance that an uncertain attack succeeds.
 */
export function preyGap(
  pred: Body,
  other: Body,
  predationThreshold: number,
  kinThreshold: number = KIN_THRESHOLD,
): number | null {
  if (pred.ph.aggression < predationThreshold) return null;
  if (pred.ph.aggression - other.ph.aggression < kinThreshold) return null;
  return huntingPower(pred) - other.ph.aggression;
}

/** Predator eats prey: energy transferred, mass gained. Returns the meal energy. */
export function feed(pred: Organism, prey: Organism): number {
  const meal =
    prey.energy * (TROPHIC_SHARE_BASE + TROPHIC_SHARE_AGGRESSION * pred.ph.aggression) +
    MEAL_BODY_BONUS * bodySize(prey);
  pred.energy += meal;
  pred.kills = (pred.kills ?? 0) + 1;
  pred.mass = Math.min(1, (pred.mass ?? 0) + MASS_PER_KILL + MASS_KILL_AGGRESSION * pred.ph.aggression);
  prey.energy = 0;
  prey.pendingDeath = "predation";
  return meal;
}

export function decayMass(o: Organism): void {
  if (o.mass > 0) o.mass = Math.max(0, o.mass - MASS_DECAY);
}

/** Lean predators cannot breed; everyone else can. */
export function canBreed(o: Body, predationThreshold: number): boolean {
  return o.ph.aggression < predationThreshold || (o.mass ?? 0) >= MASS_TO_BREED;
}

export function energyCap(o: Body): number {
  return 3.2 + 1.2 * bodySize(o);
}

/**
 * Age ceiling of one organism: the parameter times its longevity trait, so a
 * long-lived genome stretches both the hard cutoff and the senescence hazard.
 */
export function lifespan(o: Body, maxAge: number): number {
  return Math.max(1, Math.round(maxAge * o.ph.longevity));
}
