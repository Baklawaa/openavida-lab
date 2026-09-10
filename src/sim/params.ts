/**
 * The single source of truth for simulation parameters: defaults, bounds,
 * display metadata and documentation. tests/params.test.ts asserts the table
 * covers every SimParams key exactly once, and tools/gen-model-doc.mjs writes
 * the reference table in docs/model.md from this table.
 *
 * `label` is the UI string (French, like the rest of the interface until the
 * i18n pass). `description` is English and feeds the model documentation and
 * the research exports.
 */
import type { SimParams } from "./types";

export type ParamGroup = "world" | "metabolism" | "ecology" | "evolution" | "chemistry";

export interface ParamSpec {
  key: keyof SimParams;
  label: string;
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
    key: "width", label: "Largeur", unit: "cellules", group: "world", kind: "number",
    min: 8, max: 256, step: 1, integer: true, default: 128,
    description: "Plate width in cells.",
  },
  {
    key: "height", label: "Hauteur", unit: "cellules", group: "world", kind: "number",
    min: 8, max: 256, step: 1, integer: true, default: 128,
    description: "Plate height in cells.",
  },
  {
    key: "seed", label: "Graine", unit: "", group: "world", kind: "number",
    min: 1, max: 4294967295, step: 1, integer: true, default: 0xa7f31ab,
    description: "Master seed of the mulberry32 stream. All simulation randomness derives from it.",
  },
  {
    key: "startPopulation", label: "Population initiale", unit: "organismes", group: "world", kind: "number",
    min: 0, max: 100000, step: 1, integer: true, default: 0,
    description: "Founders placed at construction (kits first, then random genomes). Capped by maxPopulation.",
  },
  {
    key: "maxPopulation", label: "Population maximale", unit: "organismes", group: "world", kind: "number",
    min: 16, max: 1000000, step: 1, integer: true, default: 1100,
    description: "Hard ceiling on living organisms; a soft density-dependent fecundity gate applies below it.",
  },
  {
    key: "randomTerrain", label: "Relief aléatoire", unit: "", group: "world", kind: "boolean",
    min: 0, max: 1, step: 1, default: false,
    description: "Seed vents, walls and shade at construction.",
  },
  {
    key: "disturbances", label: "Événements aléatoires", unit: "", group: "world", kind: "boolean",
    min: 0, max: 1, step: 1, default: false,
    description: "Enable stochastic toxin pulses, droughts and crashes during the run.",
  },
  {
    key: "diffusionRate", label: "Diffusion", unit: "par pas", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.22,
    description: "Jacobi diffusion coefficient for nutrient, toxin and temperature (0 = no mixing).",
  },
  {
    key: "nutrientDecay", label: "Décroissance nutriments", unit: "par pas", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.007,
    description: "Fractional loss of the nutrient field per tick.",
  },
  {
    key: "toxinDecay", label: "Décroissance toxines", unit: "par pas", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.006,
    description: "Fractional loss of the toxin field per tick.",
  },
  {
    key: "temperatureDecay", label: "Décroissance thermique", unit: "par pas", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.002,
    description: "Relaxation of the temperature field towards 0 per tick.",
  },
  {
    key: "lightDecay", label: "Décroissance lumière", unit: "par pas", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.001, default: 0.03,
    description: "Fractional loss of the light field per tick before solar recharge.",
  },
  {
    key: "reproduceEnergy", label: "Seuil de reproduction", unit: "énergie", group: "metabolism", kind: "number",
    min: 0.05, max: 100, step: 0.05, default: 1.55,
    description: "Base energy a cell must hold to divide; scaled by the fecundity trait.",
  },
  {
    key: "maxAge", label: "Âge maximal", unit: "pas", group: "metabolism", kind: "number",
    min: 1, max: 100000, step: 1, integer: true, default: 260,
    description: "Hard age ceiling. With senescenceRate > 0 most deaths happen well before it.",
  },
  {
    key: "predationThreshold", label: "Seuil de prédation", unit: "agression", group: "metabolism", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.26,
    description: "Minimum aggression for an organism to be a predator at all.",
  },
  {
    key: "mutationRate", label: "Taux de mutation", unit: "par naissance", group: "evolution", kind: "number",
    min: 0, max: 1, step: 0.01, default: 0.12,
    description: "Probability that a birth draws a mutation; scaled per organism by the mutator trait.",
  },
  {
    key: "pointWeight", label: "Poids ponctuel", unit: "relatif", group: "evolution", kind: "number",
    min: 0, max: 10, step: 0.05, default: 0.7,
    description: "Relative weight of single-base substitutions among mutations.",
  },
  {
    key: "indelWeight", label: "Poids indels", unit: "relatif", group: "evolution", kind: "number",
    min: 0, max: 10, step: 0.05, default: 0.2,
    description: "Relative weight of insertions and deletions (1 to 3 bases) among mutations.",
  },
  {
    key: "duplicationWeight", label: "Poids duplications", unit: "relatif", group: "evolution", kind: "number",
    min: 0, max: 10, step: 0.05, default: 0.1,
    description: "Relative weight of tandem duplications among mutations.",
  },
  {
    key: "mutualismShare", label: "Partage mutualiste", unit: "énergie", group: "ecology", kind: "number",
    min: 0, max: 1, step: 0.005, default: 0.04,
    description: "Legacy pairwise energy share for matching signal channels.",
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
