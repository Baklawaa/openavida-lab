import type { Phenotype } from "./mapping";

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
}

export const DEFAULT_PARAMS: SimParams = {
  width: 128,
  height: 128,
  seed: 0xa7f31ab,
  mutationRate: 0.08,
  pointWeight: 0.7,
  indelWeight: 0.2,
  duplicationWeight: 0.1,
  diffusionRate: 0.22,
  nutrientDecay: 0.004,
  toxinDecay: 0.006,
  temperatureDecay: 0.002,
  lightDecay: 0.03,
  maxPopulation: 4096,
  startPopulation: 260,
  reproduceEnergy: 1.35,
  maxAge: 420,
  predationThreshold: 0.32,
  mutualismShare: 0.07,
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
}

export function normalizeParams(partial: Partial<SimParams> = {}): SimParams {
  const p = { ...DEFAULT_PARAMS, ...partial };
  p.width = Math.max(8, Math.min(256, p.width | 0));
  p.height = Math.max(8, Math.min(256, p.height | 0));
  p.seed = p.seed >>> 0 || 1;
  p.mutationRate = clamp01(p.mutationRate);
  p.maxPopulation = Math.max(16, p.maxPopulation | 0);
  p.startPopulation = Math.max(0, Math.min(p.maxPopulation, p.startPopulation | 0));
  return p;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
