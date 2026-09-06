import type { Phenotype } from "./mapping";
import type { EventFlags, WorldEvent } from "./events";
import type { Innovation, Strain } from "./species";
import type { ScheduledOp } from "./schedule";

export type DeathCause =
  | "starvation"
  | "toxin"
  | "crowding"
  | "old-age"
  | "predation"
  | "competition"
  | "crash"
  | "wipe"
  | "bottleneck";

export interface DeathRecord {
  tick: number;
  orgId: number;
  lineageId: number;
  genome: string;
  fitness: number;
  cause: DeathCause;
  x: number;
  y: number;
  strainId?: number;
  /** Monotonic id (1-based) so a trimmed log can be mirrored incrementally. */
  seq?: number;
  age?: number;
  kills?: number;
  births?: number;
  parentId?: number;
  mass?: number;
}

/** Death log size: keep the last DEATH_LOG_KEEP once it exceeds DEATH_LOG_MAX. */
export const DEATH_LOG_MAX = 4000;
export const DEATH_LOG_KEEP = 3000;

export const TERRAIN = {
  empty: 0,
  barrier: 1,
  nutrientVent: 2,
  toxinVent: 3,
  thermalVent: 4,
  shade: 5,
} as const;
export type TerrainKind = (typeof TERRAIN)[keyof typeof TERRAIN];

export type BrushKind =
  | "barrier"
  | "erase"
  | "nutrientVent"
  | "toxinVent"
  | "thermalVent"
  | "shade"
  | "nutrientBlob"
  | "toxinBlob"
  | "heatBlob"
  | "lightBlob"
  | "wipeOrgs";

export interface SimParams {
  width: number;
  height: number;
  seed: number;
  mutationRate: number;
  pointWeight: number;
  indelWeight: number;
  duplicationWeight: number;
  diffusionRate: number;
  nutrientDecay: number;
  toxinDecay: number;
  temperatureDecay: number;
  lightDecay: number;
  maxPopulation: number;
  startPopulation: number;
  reproduceEnergy: number;
  maxAge: number;
  predationThreshold: number;
  mutualismShare: number;
  /** Random vents/walls/shade at start. Off by default — paint them yourself. */
  randomTerrain: boolean;
  /** Periodic toxin pulses, droughts, crashes. Off by default. */
  disturbances: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  width: 128,
  height: 128,
  seed: 0xa7f31ab,
  mutationRate: 0.12,
  pointWeight: 0.7,
  indelWeight: 0.2,
  duplicationWeight: 0.1,
  diffusionRate: 0.22,
  nutrientDecay: 0.007,
  toxinDecay: 0.006,
  temperatureDecay: 0.002,
  lightDecay: 0.03,
  maxPopulation: 1100,
  startPopulation: 0,
  reproduceEnergy: 1.55,
  maxAge: 260,
  predationThreshold: 0.26,
  mutualismShare: 0.04,
  randomTerrain: false,
  disturbances: false,
};

export interface EnvSample {
  nutrient: number;
  toxin: number;
  temperature: number;
  light: number;
}

export interface NeighborEffects {
  predationGain: number;
  mutualismGain: number;
}

export interface Organism {
  id: number;
  x: number;
  y: number;
  genome: string;
  ph: Phenotype;
  energy: number;
  age: number;
  lineageId: number;
  parentId: number;
  fitness: number;
  /** Founding-genome group; 0 when untagged (older snapshots). */
  strainId: number;
  /** Last positions; not snapshotted. */
  trail?: Array<[number, number]>;
  /** Body condition 0–1: rises with prey eaten, decays slowly. See src/sim/body.ts. */
  mass: number;
  /** Prey eaten by this organism. */
  kills: number;
  /** Children born to this organism. */
  births: number;
  pendingDeath?: DeathCause;
}

export interface Gene {
  name: string;
  start: number;
  end: number;
  stop: number;
  translation: string;
  contrib: Record<string, number>;
  dominant: string;
}

export interface LineageNode {
  id: number;
  parentId: number;
  bornTick: number;
  extinctTick: number | null;
  count: number;
  peakCount: number;
  hue: number;
  signature: string;
}

export interface ExtinctionRecord {
  lineageId: number;
  tick: number;
  peakCount: number;
}

export interface MetricsSample {
  tick: number;
  population: number;
  meanFitness: number;
  maxFitness: number;
  shannon: number;
  shannonGenotype: number;
  lineageCount: number;
  extinctTotal: number;
  fixationFraction: number;
  fixationLineageId: number;
  /** Living count per strain id / per strategy at this tick. */
  strains?: Record<string, number>;
  strategies?: Record<string, number>;
  /** Per strain: [cx, cy, spread, temperature, nutrient], 2-decimal. */
  strainTracks?: Record<string, [number, number, number, number, number]>;
}

export interface MutationRates {
  rate: number;
  point: number;
  indel: number;
  duplication: number;
}

export type MutationKind = "point" | "indel" | "duplication";

export interface WorldSnapshot {
  version: 1;
  params: SimParams;
  rngState: number;
  tick: number;
  nutrient: number[];
  toxin: number[];
  temperature: number[];
  light: number[];
  solar: number[];
  terrain: number[];
  organisms: Organism[];
  nextOrgId: number;
  nextLineageId: number;
  lineages: LineageNode[];
  extinctions: ExtinctionRecord[];
  history: MetricsSample[];
  deaths?: DeathRecord[];
  nextDeathSeq?: number;
  strains?: Strain[];
  nextStrainId?: number;
  innovations?: Innovation[];
  nextInnovationId?: number;
  events?: WorldEvent[];
  nextEventId?: number;
  eventFlags?: EventFlags;
  schedule?: ScheduledOp[];
}

export function normalizeParams(partial: Partial<SimParams> = {}): SimParams {
  const p = { ...DEFAULT_PARAMS, ...partial };
  p.width = Math.max(8, Math.min(256, p.width | 0));
  p.height = Math.max(8, Math.min(256, p.height | 0));
  p.seed = p.seed >>> 0 || 1;
  p.mutationRate = clamp01(p.mutationRate);
  p.maxPopulation = Math.max(16, p.maxPopulation | 0);
  p.startPopulation = Math.max(0, Math.min(p.maxPopulation, p.startPopulation | 0));
  p.randomTerrain = Boolean(p.randomTerrain);
  p.disturbances = Boolean(p.disturbances);
  return p;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
