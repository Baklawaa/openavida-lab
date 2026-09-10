/**
 * Named coefficients of the metabolic ledger.
 *
 * `fitness` is a comparable score (harvest with unit weights); the energy
 * ledger in `metabolicDelta` uses the gain coefficients below. Keeping both
 * in one place is what lets the reported fitness and the actual energy budget
 * be checked against each other.
 *
 * Exudation is overflow photosynthesis: a phototroph whose energy is close to
 * its cap leaks a fraction of its gross gain into the exudate field, where any
 * organism carrying a receptor (signal >= 1) can take it up. The producer pays
 * the leaked energy, the consumer gains `EXUDATE_YIELD` of it, and the
 * remainder dissipates — so the trophic link is conservative and a
 * signal-positive / low-photo mutant is a genuine free-rider.
 */

/** Energy gained per unit of nutrient × uptake. */
export const UPTAKE_GAIN = 0.21;
/** Energy gained per unit of light × photo. */
export const PHOTO_GAIN = 0.14;
/** Per-tick nutrient consumption capacity per unit of uptake. */
export const NUTRIENT_UPTAKE_CAP = 0.16;
/** Energy a consumer gains per unit of exudate taken up. */
export const EXUDATE_YIELD = 0.8;
/** Per-tick exudate uptake capacity per unit of uptake, scaled by signal/7. */
export const EXUDATE_UPTAKE_PER_UPTAKE = 0.5;
/** Weight of exudate in the comparable fitness score (the ledger uses EXUDATE_YIELD). */
export const EXUDATE_FITNESS = 1;
/** Maximum exudate a cell can hold; the field clamp and the leak headroom share it. */
export const EXUDATE_MAX = 4;

/**
 * Overflow metabolism: a cell that fixes more carbon than its maintenance
 * costs leaks the excess. Expressed as energy per tick, so it does not depend
 * on the (body-size dependent) energy cap — an organism that is merely poor
 * never leaks, while a productive phototroph in bright light does.
 */
export function photosyntheticSurplus(gross: number, maintenance: number): number {
  return gross > maintenance ? gross - maintenance : 0;
}
