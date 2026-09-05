import { metabolicDelta } from "./fitness";
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
export function crowdingPenalty(
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
  return 0.01 * n;
}

export function metabolize(org: Organism, fields: Fields, params: SimParams): number {
  void params;
  const env = fields.sample(org.x, org.y);
  const take = fields.consumeNutrient(org.x, org.y, org.ph.uptake * 0.16);
  const envPaid = { ...env, nutrient: take > 0 ? take / 0.16 : env.nutrient };
  const d = metabolicDelta(org.ph, envPaid);
  org.energy += d;
  return d;
}

export interface InteractResult {
  predationEvents: number;
  mutualismEvents: number;
  kills: number;
}

/**
 * Adjacent predation and matching-signal mutualism. Predation is certain
 * when aggression gap ≥ 0.5; otherwise it rolls against the gap. Mutualism
 * is certain for matching channels ≥ 1.
 */
export function interactNeighbors(
  organisms: Organism[],
  occupancy: Int32Array,
  w: number,
  h: number,
  rng: Rng,
  params: SimParams,
): InteractResult {
  let predationEvents = 0;
  let mutualismEvents = 0;
  let kills = 0;
  const n = organisms.length;
  for (let i = 0; i < n; i++) {
    const pred = organisms[i]!;
    if (pred.energy <= 0) continue;
    for (let d = 0; d < 8; d++) {
      const ni = neighborIndex(pred.x, pred.y, d, w, h);
      if (ni === null) continue;
      const j = occupancy[ni]!;
      if (j < 0 || j === i) continue;
      const other = organisms[j]!;
      if (other.energy <= 0) continue;

      if (pred.ph.signal >= 1 && pred.ph.signal === other.ph.signal) {
        const share = params.mutualismShare;
        pred.energy += share;
        other.energy += share * 0.5;
        mutualismEvents++;
      }

      if (pred.ph.aggression < params.predationThreshold) continue;
      const gap = pred.ph.aggression - other.ph.aggression;
      if (gap < 0.1) continue;
      const certain = gap >= 0.5;
      if (!certain && !rng.chance(gap)) continue;
      const meal = other.energy * (0.35 + 0.4 * pred.ph.aggression);
      pred.energy += meal;
      other.energy = 0;
      predationEvents++;
      kills++;
    }
  }
  return { predationEvents, mutualismEvents, kills };
}

export function chemotaxisDir(
  org: Organism,
  fields: Fields,
  terrain: Uint8Array,
  occupancy: Int32Array,
  w: number,
  h: number,
  rng: Rng,
): number {
  let best = rng.int(8);
  let bestScore = -1e9;
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
    if (occupancy[ni] >= 0) s -= 0.15;
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
): MoveResult {
  let moved = 0;
  let displacements = 0;
  const n = organisms.length;
  for (let i = 0; i < n; i++) {
    const org = organisms[i]!;
    if (org.energy <= 0) continue;
    if (!rng.chance(org.ph.motility)) continue;
    const dir = rng.chance(0.72)
      ? chemotaxisDir(org, fields, terrain, occupancy, w, h, rng)
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
): { predationGain: number; mutualismGain: number } {
  let predationGain = 0;
  let mutualismGain = 0;
  for (let d = 0; d < 8; d++) {
    const ni = neighborIndex(org.x, org.y, d, w, h);
    if (ni === null) continue;
    const j = occupancy[ni]!;
    if (j < 0) continue;
    const other = organisms[j]!;
    if (!other || other.energy <= 0) continue;
    if (org.ph.signal >= 1 && org.ph.signal === other.ph.signal) {
      mutualismGain += params.mutualismShare;
    }
    if (org.ph.aggression >= params.predationThreshold) {
      const gap = org.ph.aggression - other.ph.aggression;
      if (gap > 0.1) predationGain += gap * 0.35;
    }
  }
  return { predationGain, mutualismGain };
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
