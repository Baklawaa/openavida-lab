/**
 * The single source of truth for simulation parameters: defaults, bounds,
 * display metadata and documentation. tests/params.test.ts asserts the table
 * covers every SimParams key exactly once, and tools/modeldoc.ts renders the
 * reference table in docs/model.md from this table (`npm run docs`; the sync
 * test fails when the document is stale).
 *
 * `unit` is a unit **id** (cells, perTick, energy/base, …), never display text:
 * the interface resolves it through its locale catalog (src/ui/i18n), which also
 * owns every parameter label and the French column of the descriptions.
 * `description` is English and feeds the model documentation, the panel's
 * English text and the research exports.
 */
import type { SimParams } from "./types";

export type ParamGroup = "world" | "metabolism" | "ecology" | "evolution" | "chemistry";

export interface ParamSpec {
  key: keyof SimParams;
  /** Unit id, resolved to display text by the interface catalog. */
  unit: string;
  group: ParamGroup;
  kind: "number" | "boolean";
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  default: number | boolean;
  description: string;
}

const PARAM_SPEC_LIST = [
  {
    key: "width", unit: "cells", group: "world", kind: "number",
    min: 8, max: 256, step: 1, integer: true, default: 128,
    description: "Plate width in cells.",
  },
  {
    key: "height", unit: "cells", group: "world", kind: "number",
    min: 8, max: 256, step: 1, integer: true, default: 128,
    description: "Plate height in cells.",
  },
  {
    key: "seed", unit: "", group: "world", kind: "number",
    min: 1, max: 4294967295, step: 1, integer: true, default: 0xa7f31ab,
    description: "Master seed of the mulberry32 stream. All simulation randomness derives from it.",
  },
  {
    key: "startPopulation", unit: "organisms", group: "world", kind: "number",
    min: 0, max: 100000, step: 1, integer: true, default: 0,
    description: "Founders placed at construction (kits first, then random genomes). Capped by maxPopulation.",
  },
  {
    key: "maxPopulation", unit: "organisms", group: "world", kind: "number",
    min: 16, max: 1000000, step: 1, integer: true, default: 1100,
    description: "Hard ceiling on living organisms; a soft density-dependent fecundity gate applies below it.",
  },
  {
    key: "randomTerrain", unit: "", group: "world", kind: "boolean",
    min: 0, max: 1, step: 1, default: false,
    description: "Seed vents, walls and shade at construction.",
  },
  {
    key: "disturbances", unit: "", group: "world", kind: "boolean",
    min: 0, max: 1, step: 1, default: false,
    description: "Enable stochastic toxin pulses, droughts and crashes during the run.",
  },
  {
    key: "diffusionRate", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.22,
    description: "Jacobi diffusion coefficient for nutrient, toxin and temperature (0 = no mixing).",
  },
  {
    key: "nutrientInflow", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 0.2, step: 0.001, default: 0.004,
    description: "Uniform nutrient regeneration per tick (detritus recycling). Sets the equilibrium of a ventless plate: inflow / nutrientDecay.",
  },
  {
    key: "nutrientDecay", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.007,
    description: "Fractional loss of the nutrient field per tick.",
  },
  {
    key: "toxinDecay", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.006,
    description: "Fractional loss of the toxin field per tick.",
  },
  {
    key: "temperatureDecay", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.002,
    description: "Relaxation of the temperature field towards 0 per tick.",
  },
  {
    key: "lightDecay", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.03,
    description: "Fractional loss of the light field per tick before solar recharge.",
  },
  {
    key: "reproduceEnergy", unit: "energy", group: "metabolism", kind: "number",
    min: 0.05, max: 100, step: 0.05, default: 1.55,
    description: "Base energy a cell must hold to divide; scaled by the fecundity trait.",
  },
  {
    key: "maxAge", unit: "steps", group: "metabolism", kind: "number",
    min: 1, max: 100000, step: 1, integer: true, default: 260,
    description: "Hard age ceiling. With senescenceRate > 0 most deaths happen well before it.",
  },
  {
    key: "predationThreshold", unit: "aggression", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.26,
    description: "Minimum aggression for an organism to be a predator at all.",
  },
  {
    key: "maxMealsPerTick", unit: "prey", group: "metabolism", kind: "number",
    min: 1, max: 8, step: 1, integer: true, default: 1,
    description: "Maximum prey a predator can eat in one tick across all phases; density-independent attack limit.",
  },
  {
    key: "kinThreshold", unit: "aggression", group: "ecology", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.1,
    description: "Minimum aggression gap required for a kill. 0 allows cannibalism of identical phenotypes.",
  },
  {
    key: "mutationRate", unit: "perBirth", group: "evolution", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.12,
    description: "Probability that a birth draws a mutation; scaled per organism by the mutator trait.",
  },
  {
    key: "pointWeight", unit: "relative", group: "evolution", kind: "number",
    min: 0, max: 10, step: 0.05, default: 0.7,
    description: "Relative weight of single-base substitutions among mutations.",
  },
  {
    key: "indelWeight", unit: "relative", group: "evolution", kind: "number",
    min: 0, max: 10, step: 0.05, default: 0.2,
    description: "Relative weight of insertions and deletions (1 to 3 bases) among mutations.",
  },
  {
    key: "duplicationWeight", unit: "relative", group: "evolution", kind: "number",
    min: 0, max: 10, step: 0.05, default: 0.1,
    description: "Relative weight of tandem duplications among mutations.",
  },
  {
    key: "recombinationRate", unit: "perBirth", group: "evolution", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0,
    description: "Probability that a birth takes a single-point crossover with a nearby neighbour (sex and horizontal transfer share this operator).",
  },
  {
    key: "recombinationRadius", unit: "cells", group: "evolution", kind: "number",
    min: 0, max: 32, step: 1, integer: true, default: 3,
    description: "Chebyshev radius within which a recombination partner is drawn.",
  },
  {
    key: "regulationEnabled", unit: "", group: "evolution", kind: "boolean",
    min: 0, max: 1, step: 1, default: true,
    description: "Amplify a gene by the codons upstream of its ATG (cis-regulatory layer). Off restores the purely additive decoder.",
  },
  {
    key: "lightDiffusion", unit: "perTick", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0,
    description: "Diffusion of the light field. 0 keeps light where the solar recharge and shade put it.",
  },
  {
    key: "senescenceRate", unit: "risk", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.005, default: 0.02,
    description: "Scale of the age-dependent mortality hazard (1 - exp(-rate (age/maxAge)^2)). 0 = hard maxAge cutoff only.",
  },
  {
    key: "exudateLeak", unit: "fraction", group: "chemistry", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.15,
    description: "Share of the photosynthetic surplus a phototroph leaks into the exudate field.",
  },
  {
    key: "exudateDecay", unit: "perTick", group: "chemistry", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.03,
    description: "Fractional loss of the exudate field per tick.",
  },
  {
    key: "exudateDiffusion", unit: "perTick", group: "chemistry", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.5,
    description: "Diffusion of the exudate field; how far a leak travels from its producer.",
  },
  {
    key: "genomeUpkeep", unit: "energyPerBasePerTick", group: "evolution", kind: "number",
    min: 0, max: 0.01, step: 0.00001, default: 0.00002,
    description: "Maintenance cost per genome base per tick, so longer genomes are not free.",
  },
  {
    key: "replicationCost", unit: "energyPerBase", group: "evolution", kind: "number",
    min: 0, max: 0.05, step: 0.0001, default: 0.001,
    description: "Energy charged per genome base at division, on top of the daughter's share.",
  },
  {
    key: "toxinPulseRate", unit: "perTick", group: "world", kind: "number",
    min: 0, max: 1, step: 0.0005, default: 0.015625,
    description: "Per-tick hazard of a random toxin pulse when disturbances are enabled (default 1/64).",
  },
  {
    key: "droughtRate", unit: "perTick", group: "world", kind: "number",
    min: 0, max: 1, step: 0.0005, default: 0.011363636363636364,
    description: "Per-tick hazard of a nutrient drought when disturbances are enabled (default 1/88).",
  },
  {
    key: "crashRate", unit: "perTick", group: "world", kind: "number",
    min: 0, max: 1, step: 0.0005, default: 0.008333333333333333,
    description: "Per-tick hazard of a population crash when disturbances are enabled (default 1/120).",
  },
  {
    key: "recordTraitDistribution", unit: "", group: "world", kind: "boolean",
    min: 0, max: 1, step: 1, default: true,
    description: "Store mean, sd and quantiles of every trait on each history sample (analysis without re-simulation).",
  },
  {
    key: "recordEvents", unit: "", group: "world", kind: "boolean",
    min: 0, max: 1, step: 1, default: false,
    description: "Record every birth, death, meal, exudation, recombination and neutral substitution for research export (bounded ring).",
  },
  {
    key: "dilutionRate", unit: "perTick", group: "world", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0,
    description: "Chemostat washout: fraction of organisms removed per tick and nutrient relaxed towards inflowNutrient. 0 = closed batch world.",
  },
  {
    key: "inflowNutrient", unit: "concentration", group: "world", kind: "number",
    min: 0, max: 4, step: 0.01, default: 0.12,
    description: "Nutrient concentration the inflow restores when dilutionRate > 0.",
  },
] as const satisfies readonly ParamSpec[];

export const PARAM_SPEC: readonly ParamSpec[] = PARAM_SPEC_LIST;

/**
 * Compile-time proof that every SimParams key has exactly one spec entry:
 * a missing key makes the annotation below fail to typecheck.
 */
type MissingParamKeys = Exclude<keyof SimParams, (typeof PARAM_SPEC_LIST)[number]["key"]>;
export const PARAMS_EXHAUSTIVE: MissingParamKeys extends never ? true : false = true;

export function paramSpec(key: keyof SimParams): ParamSpec | undefined {
  return PARAM_SPEC.find((s) => s.key === key);
}

/** Query-string keys, in table order; replaces the hand-maintained list in serialize.ts. */
export const QUERY_KEYS: readonly (keyof SimParams)[] = PARAM_SPEC.map((s) => s.key);

function specDefault(spec: ParamSpec): number | boolean {
  return spec.default;
}

export const DEFAULT_PARAMS: SimParams = Object.freeze(
  Object.fromEntries(PARAM_SPEC.map((s) => [s.key, specDefault(s)])),
) as unknown as SimParams;

function clampNumber(v: number, spec: ParamSpec): number {
  let n = Number.isFinite(v) ? v : (specDefault(spec) as number);
  if (spec.integer) n = Math.round(n);
  if (n < spec.min) n = spec.min;
  if (n > spec.max) n = spec.max;
  return n;
}

/**
 * Fill defaults, coerce types and clamp every parameter to its spec.
 * `seed` and `startPopulation` have cross-parameter rules and are handled here.
 */
export function normalizeParams(partial: Partial<SimParams> = {}): SimParams {
  const src = partial as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Rebuild from the spec: unknown keys are dropped, never carried forward.
  for (const spec of PARAM_SPEC) {
    const v = src[spec.key];
    if (v === undefined || v === null) {
      out[spec.key] = specDefault(spec);
    } else if (spec.kind === "boolean") {
      out[spec.key] = Boolean(v);
    } else if (spec.key === "seed" || spec.key === "startPopulation") {
      out[spec.key] = Number(v);
    } else {
      out[spec.key] = clampNumber(Number(v), spec);
    }
  }
  const p = out as unknown as SimParams;
  p.seed = p.seed >>> 0 || 1;
  const start = Number.isFinite(p.startPopulation) ? p.startPopulation | 0 : 0;
  p.startPopulation = Math.max(0, Math.min(p.maxPopulation, start));
  return p;
}
