import type { Phenotype } from "./mapping";
import type { EngineInfo } from "./engine";
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
  | "bottleneck"
  | "washout";

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

export const BRUSH_KINDS = [
  "barrier",
  "erase",
  "nutrientVent",
  "toxinVent",
  "thermalVent",
  "shade",
  "nutrientBlob",
  "toxinBlob",
  "heatBlob",
  "lightBlob",
  "wipeOrgs",
] as const;
export type BrushKind = (typeof BRUSH_KINDS)[number];

export interface SimParams {
  width: number;
  height: number;
  seed: number;
  mutationRate: number;
  pointWeight: number;
  indelWeight: number;
  duplicationWeight: number;
  /** Probability that a birth recombines with a neighbour instead of mutating. */
  recombinationRate: number;
  /** Chebyshev radius (cells) within which a recombination partner is sought. */
  recombinationRadius: number;
  /** Apply the cis-regulatory layer to decoded genomes. */
  regulationEnabled: boolean;
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
  /** Maximum prey a predator can eat per tick (interaction and movement phases combined). */
  maxMealsPerTick: number;
  /** Minimum aggression gap required for a kill; 0 allows cannibalism of identical phenotypes. */
  kinThreshold: number;
  /** Diffusion of the light field (0 = light only recharges from the solar field). */
  lightDiffusion: number;
  /** Scale of the age-dependent mortality hazard; 0 keeps only the hard maxAge cutoff. */
  senescenceRate: number;
  /** Share of gross photosynthesis a saturated phototroph leaks as exudate. */
  exudateLeak: number;
  exudateDecay: number;
  exudateDiffusion: number;
  /** Energy upkeep per genome base per tick. */
  genomeUpkeep: number;
  /** Energy charged per genome base at division. */
  replicationCost: number;
  /** Per-tick hazards of the three disturbance kinds when disturbances are enabled. */
  toxinPulseRate: number;
  droughtRate: number;
  crashRate: number;
  /** Record the per-organism research event stream (off by default: it costs memory). */
  recordEvents: boolean;
  /** Chemostat washout fraction per tick; 0 keeps the closed batch world. */
  dilutionRate: number;
  /** Nutrient concentration the inflow restores when dilutionRate > 0. */
  inflowNutrient: number;
  /** Random vents/walls/shade at start. Off by default — paint them yourself. */
  randomTerrain: boolean;
  /** Periodic toxin pulses, droughts, crashes. Off by default. */
  disturbances: boolean;
}

/**
 * Defaults, bounds and normalization live in ./params (the single source of
 * truth shared by the UI model panel, the query string and the docs).
 * Re-exported here so every existing `from "./types"` import keeps working.
 */
export { DEFAULT_PARAMS, PARAM_SPEC, QUERY_KEYS, normalizeParams, paramSpec, type ParamGroup, type ParamSpec } from "./params";

export interface EnvSample {
  nutrient: number;
  toxin: number;
  temperature: number;
  light: number;
  /** Cross-feeding metabolite leaked by rich phototrophs; see src/sim/chemistry.ts. */
  exudate: number;
}

export interface NeighborEffects {
  predationGain: number;
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
  /** Hill numbers over living lineages (q = 1 and 2), sample-size aware. */
  hill1?: number;
  hill2?: number;
  /** Living lineage count and Pielou evenness. */
  richness?: number;
  evenness?: number;
  /** Mean offspring of adults that died recently (rolling over the death log). */
  meanOffspringPerAdult?: number;
}

export interface MutationRates {
  rate: number;
  point: number;
  indel: number;
  duplication: number;
}

export type MutationKind = "point" | "indel" | "duplication" | "recombination";

/** Current snapshot schema version. The upgrade path lives in src/sim/migrate.ts. */
export const SNAPSHOT_VERSION = 2;

/** Per-organism research event stream; see World.eventLog. */
export type ResearchEventKind = "birth" | "death" | "meal" | "exudate" | "recombination" | "neutral";

export interface ResearchEvent {
  kind: ResearchEventKind;
  tick: number;
  orgId: number;
  parentId?: number;
  preyId?: number;
  donorId?: number;
  lineageId: number;
  strainId: number;
  x: number;
  y: number;
  /** Organism energy at the event. */
  energy: number;
  mass: number;
  /** Meal energy (meal) or leaked exudate (exudate). */
  amount?: number;
  cause?: DeathCause;
  genomeSignature?: string;
  hueFrom?: number;
  hueTo?: number;
}

/** Research event log size: keep the last RESEARCH_LOG_KEEP past RESEARCH_LOG_MAX. */
export const RESEARCH_LOG_MAX = 20000;
export const RESEARCH_LOG_KEEP = 10000;

export interface WorldSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** Engine that produced this snapshot. Optional on payloads written before provenance existed. */
  engine?: EngineInfo;
  /** Digest of the snapshot's params, for provenance lines and reports. */
  paramsDigest?: string;
  params: SimParams;
  rngState: number;
  tick: number;
  nutrient: number[];
  toxin: number[];
  temperature: number[];
  light: number[];
  /** Optional on v1 payloads; the migration fills zeros. */
  exudate?: number[];
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


