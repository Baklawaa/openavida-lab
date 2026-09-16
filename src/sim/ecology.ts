import { feed, KIN_THRESHOLD, maintenanceScale, preyGap, PREY_ATTRACTION, PREY_SENSE_RADIUS } from "./body";
import {
  EXUDATE_MAX,
  EXUDATE_UPTAKE_PER_UPTAKE,
  EXUDATE_YIELD,
  PHOTO_GAIN,
  photosyntheticSurplus,
} from "./chemistry";
import { maintenanceCost, metabolicDelta, reproduceThreshold, upkeepRates } from "./fitness";
import type { UpkeepRates } from "./params";
import type { Fields } from "./fields";
import type { Organism, SimParams } from "./types";
import type { Rng } from "./rng";
import { TERRAIN } from "./types";

export const DX = [0, 1, 0, -1, 1, 1, -1, -1];
export const DY = [-1, 0, 1, 0, -1, 1, 1, -1];

export function neighborIndex(
  x: number,
  y: number,
  dir: number,
  w: number,
  h: number,
): number | null {
  const nx = x + DX[dir]!;
  const ny = y + DY[dir]!;
  if (nx < 0 || ny < 0 || nx >= w || ny >= h) return null;
  return ny * w + nx;
}

/**
 * Harvest / pay environment costs. Nutrient is consumed; light/temp/toxin
 * are sampled. Returns the metabolic delta applied to energy.
 */
export function neighborOccupancyCount(
  x: number,
  y: number,
  occupancy: Int32Array,
  w: number,
  h: number,
): number {
  let n = 0;
  for (let d = 0; d < 8; d++) {
    const ni = neighborIndex(x, y, d, w, h);
    if (ni !== null && occupancy[ni]! >= 0) n++;
  }
  return n;
}

export function crowdingPenalty(
  x: number,
  y: number,
  occupancy: Int32Array,
  w: number,
  h: number,
): number {
  return 0.012 * neighborOccupancyCount(x, y, occupancy, w, h);
}

/** Only dense clumps shade themselves — isolated cells still see the sky. */
export function shadeOccupied(
  light: Float32Array,
  organisms: { x: number; y: number }[],
  occupancy: Int32Array,
  w: number,
  h: number,
): void {
  for (let i = 0; i < organisms.length; i++) {
    const o = organisms[i]!;
    const n = neighborOccupancyCount(o.x, o.y, occupancy, w, h);
    if (n < 2) continue;
    const idx = o.y * w + o.x;
    const k = n >= 5 ? 0.18 : n >= 3 ? 0.4 : 0.7;
    light[idx] = light[idx]! * k;
  }
}

export interface MetabolismResult {
  /** Energy delta of the harvest/cost ledger (excludes the exudate transfer). */
  delta: number;
  /** Energy this organism leaked into the exudate field. */
  leaked: number;
  /** Exudate taken up from the field, before the yield conversion. */
  taken: number;
}

/**
 * Harvest, pay costs, and run the exudate transfer.
 *
 * A phototroph whose gross photosynthesis exceeds its maintenance leaks the
 * surplus into the exudate field; any organism carrying a receptor
 * (signal >= 1) takes up what its cell holds and converts it with
 * EXUDATE_YIELD. The producer pays exactly what it leaks, so the link is a
 * transfer, not a source — and a signal-positive / low-photo mutant is a
 * free-rider on its neighbours' overflow.
 */
export function metabolize(
  org: Organism,
  fields: Fields,
  params: SimParams,
  // Hoisted by the caller: deriving it here allocates one object per organism
  // per tick, which measured as a 2x slowdown of the whole step.
  rates: UpkeepRates = upkeepRates(params),
): MetabolismResult {
  const env = fields.sample(org.x, org.y);
  // Harvest is the documented mass-action law, uptake x local concentration x
  // UPTAKE_GAIN, so the break-even concentration is maintenance / (uptake x
  // UPTAKE_GAIN) and income is linear in the uptake trait. nutrientUptakeCap
  // only limits the *rate* at which a cell can be stripped; it must not scale
  // the yield, which is what made income quadratic in uptake and let one
  // constant set the whole plate's energy budget.
  fields.consumeNutrient(org.x, org.y, org.ph.uptake * params.nutrientUptakeCap);
  const upkeep = params.genomeUpkeep * org.genome.length;
  const delta = metabolicDelta(org.ph, env, maintenanceScale(org), upkeep, rates);
  org.energy += delta;

  let leaked = 0;
  if (params.exudateLeak > 0 && org.energy > 0 && org.ph.photo > 0 && env.light > 0) {
    const gross = org.ph.photo * env.light * PHOTO_GAIN;
    const surplus = photosyntheticSurplus(
      gross,
      maintenanceCost(org.ph, maintenanceScale(org), upkeep, rates),
    );
    if (surplus > 0) {
      // Never leak past the field clamp: what does not fit stays in the cell,
      // so the transfer can never destroy energy silently.
      const i = fields.idx(org.x, org.y);
      const headroom = EXUDATE_MAX - fields.exudate[i]!;
      leaked = Math.min(params.exudateLeak * surplus, Math.max(0, headroom));
      if (leaked > 0) {
        org.energy -= leaked;
        fields.exudate[i] = fields.exudate[i]! + leaked;
      }
    }
  }

  let taken = 0;
  if (org.ph.signal >= 1) {
    const capacity = EXUDATE_UPTAKE_PER_UPTAKE * org.ph.uptake * (org.ph.signal / 7);
    taken = fields.takeExudate(org.x, org.y, capacity);
    if (taken > 0) org.energy += taken * EXUDATE_YIELD;
  }
  return { delta, leaked, taken };
}

/**
 * Optional per-event hook. The world passes one only while the research event
 * log is recording, so the ecology functions stay pure otherwise.
 */
export interface InteractionSink {
  meal?(pred: Organism, prey: Organism, amount: number): void;
}

export interface InteractResult {
  predationEvents: number;
  kills: number;
  /** Meals taken per organism index this tick; the movement phase honours the same budget. */
  meals: Int32Array;
}

/**
 * Hunting follows need: a predator only attacks while it is below its own
 * division threshold. Without that gate a fed predator keeps killing — one meal
 * per tick, every tick — and the plate becomes an aggression runaway that eats
 * every prey and then itself (measured before the gate: extinction at tick
 * 1246 with mean aggression 0.98).
 */
function hungry(pred: Organism, reproduceEnergy: number): boolean {
  return pred.energy < reproduceThreshold(pred.ph, reproduceEnergy);
}

/**
 * Adjacent predation. Predation is certain when the aggression gap ≥ 0.5;
 * otherwise it rolls against the gap. An organism may take at most
 * `params.maxMealsPerTick` prey per tick, so trophic transfer is bounded by
 * attack rate rather than by local density.
 */
export function interactNeighbors(
  organisms: Organism[],
  occupancy: Int32Array,
  w: number,
  h: number,
  rng: Rng,
  params: SimParams,
  sink?: InteractionSink | null,
): InteractResult {
  let predationEvents = 0;
  let kills = 0;
  const meals = new Int32Array(organisms.length);
  const cap = Math.max(1, params.maxMealsPerTick | 0);
  const n = organisms.length;
  for (let i = 0; i < n; i++) {
    const pred = organisms[i]!;
    if (pred.energy <= 0) continue;
    if (!hungry(pred, params.reproduceEnergy)) continue;
    for (let d = 0; d < 8; d++) {
      if (meals[i]! >= cap) break;
      const ni = neighborIndex(pred.x, pred.y, d, w, h);
      if (ni === null) continue;
      const j = occupancy[ni]!;
      if (j < 0 || j === i) continue;
      const other = organisms[j]!;
      if (other.energy <= 0) continue;
      const gap = preyGap(pred, other, params.predationThreshold, params.kinThreshold);
      if (gap === null) continue;
      const certain = gap >= 0.5;
      if (!certain && !rng.chance(gap)) continue;
      const meal = feed(pred, other);
      sink?.meal?.(pred, other, meal);
      meals[i] = meals[i]! + 1;
      predationEvents++;
      kills++;
    }
  }
  return { predationEvents, kills, meals };
}

/** Nearest edible prey within PREY_SENSE_RADIUS (Chebyshev window, Euclidean pick), or null. */
export function nearestPrey(
  org: Organism,
  occupancy: Int32Array,
  organisms: readonly Organism[],
  w: number,
  h: number,
  predationThreshold: number,
  kinThreshold: number = KIN_THRESHOLD,
  radius = PREY_SENSE_RADIUS,
): Organism | null {
  if (org.ph.aggression < predationThreshold) return null;
  let best: Organism | null = null;
  let bestD = Infinity;
  const x0 = Math.max(0, org.x - radius);
  const x1 = Math.min(w - 1, org.x + radius);
  const y0 = Math.max(0, org.y - radius);
  const y1 = Math.min(h - 1, org.y + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const j = occupancy[y * w + x]!;
      if (j < 0) continue;
      const other = organisms[j]!;
      if (other === org || other.energy <= 0) continue;
      if (preyGap(org, other, predationThreshold, kinThreshold) === null) continue;
      const d = (x - org.x) ** 2 + (y - org.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = other;
      }
    }
  }
  return best;
}

/**
 * Best neighbour by harvest, toxin, temperature and crowding. With
 * `organisms` given, predators are pulled toward the nearest edible prey
 * they can sense, and a cell holding such prey attracts instead of repels.
 */
export function chemotaxisDir(
  org: Organism,
  fields: Fields,
  terrain: Uint8Array,
  occupancy: Int32Array,
  w: number,
  h: number,
  rng: Rng,
  organisms: readonly Organism[] | null = null,
  predationThreshold = 0.26,
  kinThreshold = KIN_THRESHOLD,
): number {
  let best = rng.int(8);
  let bestScore = -1e9;
  const prey = organisms
    ? nearestPrey(org, occupancy, organisms, w, h, predationThreshold, kinThreshold)
    : null;
  const pull = PREY_ATTRACTION * (0.5 + org.ph.aggression);
  const here = prey ? Math.hypot(prey.x - org.x, prey.y - org.y) : 0;
  for (let d = 0; d < 8; d++) {
    const ni = neighborIndex(org.x, org.y, d, w, h);
    if (ni === null) continue;
    if (terrain[ni] === TERRAIN.barrier) continue;
    const x = org.x + DX[d]!;
    const y = org.y + DY[d]!;
    const env = fields.sample(x, y);
    let s = org.ph.uptake * env.nutrient + org.ph.photo * env.light;
    s -= env.toxin * (1 - org.ph.resist);
    s -= Math.abs(env.temperature - org.ph.tpref) * 0.5;
    if (occupancy[ni]! >= 0) {
      const other = organisms ? organisms[occupancy[ni]!] : undefined;
      if (other && other.energy > 0 && preyGap(org, other, predationThreshold, kinThreshold) !== null) s += pull;
      else s -= 0.15;
    } else if (prey) {
      // Closing the distance to the sensed prey scores like moving up a gradient.
      s += pull * Math.max(0, here - Math.hypot(prey.x - x, prey.y - y));
    }
    s += rng.next() * 0.05;
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

export interface MoveResult {
  moved: number;
  displacements: number;
}

/**
 * Attempt motile moves. Occupied destination: higher fitness displaces the
 * occupant (competition). Ties keep the occupant.
 */
export function moveOrganisms(
  organisms: Organism[],
  occupancy: Int32Array,
  terrain: Uint8Array,
  fields: Fields,
  w: number,
  h: number,
  rng: Rng,
  params?: Pick<SimParams, "predationThreshold" | "maxMealsPerTick" | "kinThreshold" | "reproduceEnergy">,
  meals: Int32Array | null = null,
  sink?: InteractionSink | null,
): MoveResult {
  const threshold = params?.predationThreshold ?? 0.26;
  const kin = params?.kinThreshold ?? KIN_THRESHOLD;
  const cap = Math.max(1, params?.maxMealsPerTick ?? 1);
  const reproBase = params?.reproduceEnergy ?? 1.55;
  /** A predator that already reached its meal budget cannot start another kill. */
  const hasBudget = (i: number): boolean => meals === null || meals[i]! < cap;
  let moved = 0;
  let displacements = 0;
  const n = organisms.length;
  for (let i = 0; i < n; i++) {
    const org = organisms[i]!;
    if (org.energy <= 0) continue;
    if (!rng.chance(org.ph.motility)) continue;
    const dir = rng.chance(0.72)
      ? chemotaxisDir(org, fields, terrain, occupancy, w, h, rng, organisms, threshold, kin)
      : rng.int(8);
    const ni = neighborIndex(org.x, org.y, dir, w, h);
    if (ni === null) continue;
    if (terrain[ni] === TERRAIN.barrier) continue;
    const occ = occupancy[ni]!;
    const nx = org.x + DX[dir]!;
    const ny = org.y + DY[dir]!;
    if (occ < 0) {
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      moved++;
      continue;
    }
    if (occ === i) continue;
    const other = organisms[occ]!;
    if (preyGap(org, other, threshold, kin) !== null) {
      // Moving onto prey is a hunt: the predator eats and takes the cell.
      // A predator at its meal budget, or one that has no need to eat yet, is
      // simply blocked by the prey.
      if (!hasBudget(i) || !hungry(org, reproBase)) continue;
      const meal = feed(org, other);
      sink?.meal?.(org, other, meal);
      if (meals) meals[i] = meals[i]! + 1;
      occupancy[other.y * w + other.x] = -1;
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      moved++;
      continue;
    }
    if (preyGap(other, org, threshold, kin) !== null) {
      // Walking into a predator: the mover is eaten where it stands, unless
      // the predator has already eaten its fill this tick or is not hungry.
      if (!hasBudget(occ) || !hungry(other, reproBase)) continue;
      const meal = feed(other, org);
      sink?.meal?.(other, org, meal);
      if (meals) meals[occ] = meals[occ]! + 1;
      occupancy[org.y * w + org.x] = -1;
      continue;
    }
    if (other.energy <= 0) {
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      moved++;
      continue;
    }
    if (org.fitness > other.fitness) {
      occupancy[other.y * w + other.x] = -1;
      other.energy = 0;
      other.pendingDeath = "competition";
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      displacements++;
      moved++;
    }
  }
  return { moved, displacements };
}

export function sampleNeighborEffects(
  org: Organism,
  occupancy: Int32Array,
  organisms: Organism[],
  w: number,
  h: number,
  params: SimParams,
): { predationGain: number } {
  let predationGain = 0;
  for (let d = 0; d < 8; d++) {
    const ni = neighborIndex(org.x, org.y, d, w, h);
    if (ni === null) continue;
    const j = occupancy[ni]!;
    if (j < 0) continue;
    const other = organisms[j]!;
    if (!other || other.energy <= 0) continue;
    if (org.ph.aggression >= params.predationThreshold) {
      const gap = org.ph.aggression - other.ph.aggression;
      if (gap >= params.kinThreshold) predationGain += gap * 0.35;
    }
  }
  return { predationGain };
}

export function emptyNeighbor(
  x: number,
  y: number,
  occupancy: Int32Array,
  terrain: Uint8Array,
  w: number,
  h: number,
  rng: Rng,
): { x: number; y: number } | null {
  const order = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  for (const d of order) {
    const ni = neighborIndex(x, y, d, w, h);
    if (ni === null) continue;
    if (terrain[ni] === TERRAIN.barrier) continue;
    if (occupancy[ni] >= 0) continue;
    return { x: x + DX[d]!, y: y + DY[d]! };
  }
  return null;
}
