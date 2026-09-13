/**
 * The machine-checkable half of `docs/model.md`.
 *
 * Every fact the document states about the model is rendered from the code
 * here: the parameter table from `PARAM_SPEC`, the constant table from the
 * modules that define the constants, the engine identity from `engine.ts`
 * plus `tests/baselines/engine.json`, and the calibration record from the
 * entries below. `tests/modelDoc.test.ts` re-renders and compares, so a
 * changed value fails the suite instead of leaving the document quietly wrong.
 *
 * Regenerate with `npm run docs`.
 */
import { EXUDATE_FITNESS, EXUDATE_MAX, EXUDATE_UPTAKE_PER_UPTAKE, EXUDATE_YIELD, NUTRIENT_UPTAKE_CAP, PHOTO_GAIN, UPTAKE_GAIN } from "../src/sim/chemistry";
import { KIN_THRESHOLD, MASS_DECAY, MASS_HUNT_BONUS, MASS_KILL_AGGRESSION, MASS_MAINTENANCE, MASS_PER_KILL, MASS_SIZE_GAIN, MASS_TO_BREED, MEAL_BODY_BONUS, PREY_ATTRACTION, PREY_SENSE_RADIUS } from "../src/sim/body";
import { ALPHABET, CODON_LEN, MAX_GENOME, MIN_GENOME, REG_CROSS, REG_MAX, REG_SELF, REG_WINDOW, START_CODON, STOP_CODONS } from "../src/sim/mapping";
import { DEATH_LOG_KEEP, DEATH_LOG_MAX, LINEAGE_TOP_N, RESEARCH_LOG_KEEP, RESEARCH_LOG_MAX, SNAPSHOT_VERSION } from "../src/sim/types";
import { NEUTRAL_LOG_MAX } from "../src/sim/world";
import { EVENT_LOG_MAX, EVENT_WINDOW } from "../src/sim/events";
import { HEAT_STEPS, TRAIL_LENGTH } from "../src/sim/heat";
import { DEFAULT_TIMELINE_BUDGET, DEFAULT_TIMELINE_EVERY } from "../src/sim/timeline";
import { CRASH_EVERY, DROUGHT_EVERY, TOXIN_PULSE_EVERY } from "../src/sim/climate";
import { TOURNAMENT_DRAW, TOURNAMENT_INJECT } from "../src/sim/tournament";
import { RECIPE_QUERY_MAX, RECIPE_VERSION } from "../src/sim/recipe";
import { MANIFEST_VERSION } from "../src/sim/manifest";
import { HASH_ALGO, ENGINE_VERSION, MODEL_REVISION, engineInfo } from "../src/sim/engine";
import { PARAM_SPEC } from "../src/sim/params";
import { DEFAULT_OVERLAY_ALPHA, EXUDATE_OVERLAY_ALPHA, OVERLAY_GAMMA } from "../src/render/overlay";

/* ------------------------------------------------------------------ markers */

export const SECTION_IDS = ["identity", "params", "constants", "revisions", "calibration", "limits"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export function beginMarker(id: SectionId): string {
  return `<!-- generated:${id} -->`;
}

export function endMarker(id: SectionId): string {
  return `<!-- /generated:${id} -->`;
}

/* -------------------------------------------------------------------- data */

export interface ConstantEntry {
  /** Grouping used for the table's section column. */
  group: string;
  /** Display name; compound rows use " / " and list every symbol in `names`. */
  name: string;
  /** Exact symbol names asserted against the source file. Defaults to [name]. */
  names?: readonly string[];
  value: string;
  source: string;
  note: string;
}

export interface RevisionEntry {
  version: string;
  revision: number;
  perfHash: string;
  date: string;
  headline: string;
  changes: string[];
  evidence: string;
}

export type CalibrationCheck = { kind: "test"; file: string } | { kind: "recorded" };

export interface CalibrationEntry {
  id: string;
  claim: string;
  method: string;
  measured: string;
  tolerance: string;
  check: CalibrationCheck;
  source: string;
}

export interface LimitEntry {
  gap: string;
  detail: string;
  source: string;
}

const num = (v: number): string => String(v);

/**
 * The model constants that are not parameters. Values are read from the
 * modules that define them, so editing a constant turns the sync test red
 * instead of leaving this table stale.
 */
export const MODEL_CONSTANTS: readonly ConstantEntry[] = [
  { group: "Metabolism", name: "UPTAKE_GAIN", value: num(UPTAKE_GAIN), source: "src/sim/chemistry.ts", note: "Energy gained per unit of nutrient × uptake." },
  { group: "Metabolism", name: "PHOTO_GAIN", value: num(PHOTO_GAIN), source: "src/sim/chemistry.ts", note: "Energy gained per unit of light × photo." },
  { group: "Metabolism", name: "NUTRIENT_UPTAKE_CAP", value: num(NUTRIENT_UPTAKE_CAP), source: "src/sim/chemistry.ts", note: "Per-tick nutrient consumption capacity per unit of uptake." },
  { group: "Exudate", name: "EXUDATE_YIELD", value: num(EXUDATE_YIELD), source: "src/sim/chemistry.ts", note: "Energy a consumer gains per unit of exudate taken up; the rest dissipates." },
  { group: "Exudate", name: "EXUDATE_UPTAKE_PER_UPTAKE", value: num(EXUDATE_UPTAKE_PER_UPTAKE), source: "src/sim/chemistry.ts", note: "Per-tick uptake capacity per unit of uptake, scaled by signal / 7." },
  { group: "Exudate", name: "EXUDATE_FITNESS", value: num(EXUDATE_FITNESS), source: "src/sim/chemistry.ts", note: "Weight of exudate in the comparable fitness score." },
  { group: "Exudate", name: "EXUDATE_MAX", value: num(EXUDATE_MAX), source: "src/sim/chemistry.ts", note: "Cell ceiling shared by the field clamp and the leak headroom." },
  { group: "Body", name: "MASS_PER_KILL", value: num(MASS_PER_KILL), source: "src/sim/body.ts", note: "Body condition gained per kill." },
  { group: "Body", name: "MASS_KILL_AGGRESSION", value: num(MASS_KILL_AGGRESSION), source: "src/sim/body.ts", note: "Extra condition per kill, scaled by aggression." },
  { group: "Body", name: "MASS_DECAY", value: num(MASS_DECAY), source: "src/sim/body.ts", note: "Condition lost per tick when not feeding (full mass fades in ~250 ticks)." },
  { group: "Body", name: "MASS_SIZE_GAIN", value: num(MASS_SIZE_GAIN), source: "src/sim/body.ts", note: "Effective size = ph.size × (1 + gain × mass)." },
  { group: "Body", name: "MASS_HUNT_BONUS", value: num(MASS_HUNT_BONUS), source: "src/sim/body.ts", note: "Hunting power = aggression + bonus × mass." },
  { group: "Body", name: "MASS_MAINTENANCE", value: num(MASS_MAINTENANCE), source: "src/sim/body.ts", note: "Maintenance multiplier 1 + value × mass (weaker than the size gain, so growing pays)." },
  { group: "Body", name: "MASS_TO_BREED", value: num(MASS_TO_BREED), source: "src/sim/body.ts", note: "Predators reproduce only once this fed: breeding follows real feeding." },
  { group: "Body", name: "MEAL_BODY_BONUS", value: num(MEAL_BODY_BONUS), source: "src/sim/body.ts", note: "Extra energy from the prey's body, per unit of effective size." },
  { group: "Body", name: "PREY_ATTRACTION", value: num(PREY_ATTRACTION), source: "src/sim/body.ts", note: "Chemotaxis pull toward the nearest edible prey." },
  { group: "Body", name: "PREY_SENSE_RADIUS", value: num(PREY_SENSE_RADIUS), source: "src/sim/body.ts", note: "How far a predator senses prey, in cells." },
  { group: "Body", name: "KIN_THRESHOLD", value: num(KIN_THRESHOLD), source: "src/sim/body.ts", note: "Fallback minimum aggression gap for a kill; params.kinThreshold overrides it." },
  { group: "Genome", name: "ALPHABET", value: ALPHABET, source: "src/sim/mapping.ts", note: "The four bases; every sequence is over this alphabet." },
  { group: "Genome", name: "CODON_LEN", value: num(CODON_LEN), source: "src/sim/mapping.ts", note: "Bases per codon." },
  { group: "Genome", name: "START_CODON", value: START_CODON, source: "src/sim/mapping.ts", note: "Opens an ORF." },
  { group: "Genome", name: "STOP_CODONS", value: STOP_CODONS.join(", "), source: "src/sim/mapping.ts", note: "Close an ORF." },
  { group: "Genome", name: "MIN_GENOME", value: num(MIN_GENOME), source: "src/sim/mapping.ts", note: "Shortest accepted sequence." },
  { group: "Genome", name: "MAX_GENOME", value: num(MAX_GENOME), source: "src/sim/mapping.ts", note: "Longest accepted sequence." },
  { group: "Regulation", name: "REG_WINDOW", value: num(REG_WINDOW), source: "src/sim/mapping.ts", note: "Upstream codons read backwards from the ATG, in triplets." },
  { group: "Regulation", name: "REG_SELF", value: num(REG_SELF), source: "src/sim/mapping.ts", note: "Amplification per upstream codon of the same trait." },
  { group: "Regulation", name: "REG_CROSS", value: num(REG_CROSS), source: "src/sim/mapping.ts", note: "Amplification per upstream codon of the most frequent other trait." },
  { group: "Regulation", name: "REG_MAX", value: num(REG_MAX), source: "src/sim/mapping.ts", note: "Cap on the regulatory multiplier." },
  { group: "Logs and bounds", name: "LINEAGE_TOP_N", value: num(LINEAGE_TOP_N), source: "src/sim/types.ts", note: "Living lineages stored per history row, for the lineage-level selection readout." },
  { group: "Logs and bounds", name: "DEATH_LOG_MAX / KEEP", names: ["DEATH_LOG_MAX", "DEATH_LOG_KEEP"], value: `${DEATH_LOG_MAX} / ${DEATH_LOG_KEEP}`, source: "src/sim/types.ts", note: "Death records are trimmed to KEEP once they pass MAX." },
  { group: "Logs and bounds", name: "RESEARCH_LOG_MAX / KEEP", names: ["RESEARCH_LOG_MAX", "RESEARCH_LOG_KEEP"], value: `${RESEARCH_LOG_MAX} / ${RESEARCH_LOG_KEEP}`, source: "src/sim/types.ts", note: "Per-organism research events, same trimming rule." },
  { group: "Logs and bounds", name: "NEUTRAL_LOG_MAX", value: num(NEUTRAL_LOG_MAX), source: "src/sim/world.ts", note: "Hue-only substitutions kept for the molecular clock." },
  { group: "Logs and bounds", name: "EVENT_LOG_MAX / WINDOW", names: ["EVENT_LOG_MAX", "EVENT_WINDOW"], value: `${EVENT_LOG_MAX} / ${EVENT_WINDOW}`, source: "src/sim/events.ts", note: "Derived world events kept, and the lookback window in ticks." },
  { group: "Logs and bounds", name: "HEAT_STEPS / TRAIL_LENGTH", names: ["HEAT_STEPS", "TRAIL_LENGTH"], value: `${HEAT_STEPS} / ${TRAIL_LENGTH}`, source: "src/sim/heat.ts", note: "Occupancy-heat decay constant and the organism trail length." },
  { group: "Logs and bounds", name: "DEFAULT_TIMELINE_EVERY", value: num(DEFAULT_TIMELINE_EVERY), source: "src/sim/timeline.ts", note: "Ticks between recorded snapshots." },
  { group: "Logs and bounds", name: "DEFAULT_TIMELINE_BUDGET", value: `${DEFAULT_TIMELINE_BUDGET / (1024 * 1024)} MB`, source: "src/sim/timeline.ts", note: "Snapshot ring budget; the oldest entry after the origin is evicted first." },
  { group: "Hazards", name: "TOXIN_PULSE_EVERY / DROUGHT_EVERY / CRASH_EVERY", names: ["TOXIN_PULSE_EVERY", "DROUGHT_EVERY", "CRASH_EVERY"], value: `${TOXIN_PULSE_EVERY} / ${DROUGHT_EVERY} / ${CRASH_EVERY}`, source: "src/sim/climate.ts", note: "Legacy periods behind the parameterised per-tick hazards; a crash needs more than 280 organisms." },
  { group: "Formats", name: "SNAPSHOT_VERSION", value: num(SNAPSHOT_VERSION), source: "src/sim/types.ts", note: "Snapshot schema; v1 payloads are migrated by src/sim/migrate.ts." },
  { group: "Formats", name: "MANIFEST_VERSION", value: num(MANIFEST_VERSION), source: "src/sim/manifest.ts", note: "Run-manifest schema used by the headless runner." },
  { group: "Formats", name: "RECIPE_VERSION", value: num(RECIPE_VERSION), source: "src/sim/recipe.ts", note: "Recipe schema for shareable ?recipe= links." },
  { group: "Formats", name: "RECIPE_QUERY_MAX", value: num(RECIPE_QUERY_MAX), source: "src/sim/recipe.ts", note: "Above this many characters the share link falls back to parameters only." },
  { group: "Formats", name: "HASH_ALGO", value: HASH_ALGO, source: "src/sim/engine.ts", note: "State hash used for provenance and the perf baseline." },
  { group: "Tournament", name: "TOURNAMENT_DRAW / INJECT", names: ["TOURNAMENT_DRAW", "TOURNAMENT_INJECT"], value: `${TOURNAMENT_DRAW} / ${TOURNAMENT_INJECT}`, source: "src/sim/tournament.ts", note: "Share gap that counts as a draw, and cells injected per contestant." },
  { group: "Rendering", name: "OVERLAY_GAMMA", value: num(OVERLAY_GAMMA), source: "src/render/overlay.ts", note: "Contrast applied before the overlay field becomes a byte." },
  { group: "Rendering", name: "DEFAULT_OVERLAY_ALPHA", value: num(DEFAULT_OVERLAY_ALPHA), source: "src/render/overlay.ts", note: "Alpha of the strain heat map." },
  { group: "Rendering", name: "EXUDATE_OVERLAY_ALPHA", value: num(EXUDATE_OVERLAY_ALPHA), source: "src/render/overlay.ts", note: "Alpha of the exudate layer, raised so a thin field is readable." },
];

export const REVISION_LOG: readonly RevisionEntry[] = [
  {
    version: "1.0.0",
    revision: 1,
    perfHash: "c2c03a81",
    date: "2026-09-10",
    headline: "Pre-upgrade engine, frozen as the annotated tag engine-v1",
    changes: [
      "Phase 1–2 model: point, indel and duplication mutations; four diffusing fields (nutrient, toxin, temperature, light); 8-neighbour predation; the original mutualism rule.",
      "Engine identity, the parameter spec, snapshot v2 and the migration path were introduced on top of this revision without changing its behaviour, so the perf hash stayed c2c03a81 through Stage 0.",
    ],
    evidence: "workbench.md, \"Upgrade Stage 0 — engine identity, parameter spec, migration, gates\"",
  },
  {
    version: "2.0.0",
    revision: 2,
    perfHash: "9df52ec5",
    date: "2026-09-10",
    headline: "Model correctness: bounded predation, overflow cross-feeding, genome economics",
    changes: [
      "A predator is limited to params.maxMealsPerTick prey per tick (default 1) across both the interaction and the movement phase; the meal ledger is shared.",
      "Mutualism was replaced by overflow cross-feeding: a phototroph whose gross photosynthesis exceeds its maintenance leaks params.exudateLeak of the surplus into the exudate field, and a receptor (signal >= 1) takes it up at EXUDATE_YIELD. The producer pays exactly what the field gains, capped by the cell's headroom.",
      "Sequence length costs energy: params.genomeUpkeep per base per tick and params.replicationCost per base at division.",
      "Senescence: an age-dependent hazard 1 - exp(-rate (age/maxAge)^2) on top of the hard maxAge ceiling.",
      "Disturbances became per-tick hazards (params.toxinPulseRate / droughtRate / crashRate) instead of fixed periods.",
      "Light stopped being a solute: params.lightDiffusion is separate from params.diffusionRate.",
      "Kin recognition is a parameter (params.kinThreshold), and density-dependent fecundity p = 1/(1 + (N/K)^4) replaced an undocumented RNG skip.",
      "Chemostat mode: params.dilutionRate with params.inflowNutrient refreshes the medium and washes organisms out, adding the washout death cause.",
    ],
    evidence: "workbench.md, \"Upgrade Stage 1 — model correctness\"",
  },
  {
    version: "2.1.0",
    revision: 3,
    perfHash: "185d6460",
    date: "2026-09-10",
    headline: "Evolvability: a mutator trait, recombination and cis-regulation",
    changes: [
      "An eleventh trait, mutator, rides as a secondary contribution on the proline codons and TGG; World.mutationRatesFor scales the base rate per organism.",
      "recombine(a, b, rng) is a single-point crossover with independent cut points, used for sex and horizontal transfer through params.recombinationRate and params.recombinationRadius. The innovation records the donor.",
      "Cis-regulation: codons immediately upstream of an ATG amplify the gene (REG_SELF for the same trait, REG_CROSS for the most frequent other trait, capped at REG_MAX), making gene order and intergenic sequence evolvable. params.regulationEnabled switches it off.",
    ],
    evidence: "workbench.md, \"Upgrade Stage 2 — evolvability\"",
  },
  {
    version: "2.2.0",
    revision: 4,
    perfHash: "e953dcdc",
    date: "2026-09-13",
    headline: "A habitable fresh plate: nutrient recycling",
    changes: [
      "New parameter nutrientInflow (default 0.004 per tick): uniform nutrient regeneration inside Fields.applyVentsAndDecay, i.e. detritus recycling.",
      "Starting nutrient raised from 0.12 to 0.35 in seedEnvironment and clearPresetTerrain.",
      "The two model-validation tests that isolate the diffusion kernel now zero the inflow, because it is a source.",
    ],
    evidence: "workbench.md, \"Round: a habitable fresh plate\"",
  },
];

export const CALIBRATION: readonly CalibrationEntry[] = [
  {
    id: "plate-habitability",
    claim: "A ventless plate stays habitable: a dropped organism founds a population instead of starving in seconds.",
    method: "World(48x48, published defaults, randomTerrain false) with one heterotroph kit genome placed at the centre; step until it dies, then read the plate's mean nutrient.",
    measured: "One heterotroph lives exactly 260 steps on a 48x48 plate (about 20 before the change); on a mature 128x128 plate the nutrient self-regulates between 0.13 and 0.41 as the population grazes it.",
    tolerance: "The founder is still alive at step 150; mean nutrient at step 100 at least 0.42.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "workbench.md, \"Round: a habitable fresh plate\"",
  },
  {
    id: "nutrient-equilibrium",
    claim: "Nutrient inflow sets a floor under a ventless plate: the equilibrium is inflow / nutrientDecay.",
    method: "32x32 world with nutrientInflow 0.004, nutrientDecay 0.007, no organisms and no vents; step 400 and read the mean nutrient.",
    measured: "0.558 by tick 400, asymptotically 0.571 (0.004 / 0.007); the break-even of a stock heterotroph is maintenance / (uptake x UPTAKE_GAIN) = 0.07 / 0.147, about 0.42.",
    tolerance: "Between 0.55 and 0.62 at tick 400, and the equilibrium stays above the 0.42 break-even.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/fields.ts, src/sim/world.ts seedEnvironment",
  },
  {
    id: "exudate-surplus-rule",
    claim: "Cross-feeding is overflow metabolism: only a phototroph whose gross gain exceeds its maintenance leaks, and exudateLeak 0 disables the trophic link exactly.",
    method: "32x32 plate, 12 phototrophs injected; step 60 and read lastExudate and the exudate field total; repeat with exudateLeak 0.",
    measured: "Twelve phototrophs on a 32x32 plate: 11 leak in the peak tick and the field total reaches 1.72 by step 60. With exudateLeak 0 the field total stays at exactly 0 for the whole run.",
    tolerance: "At least one producer event with the default; field total identically 0 at leak 0.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/chemistry.ts, src/sim/ecology.ts metabolize",
  },
  {
    id: "exudate-leak-tuned",
    claim: "exudateLeak 0.15 is the tuned default: a larger leak strangles a phototroph monoculture.",
    method: "24 injected phototrophs, mutationRate 1, 90 steps: survivors / innovations / lineages with living descendants, on the v1 engine, at leak 0.4 and at leak 0.15.",
    measured: "Survivors / innovations: 11 / 2 at leak 0.15 against 7 / 0 at leak 0.4. The historical bisect (a different scenario) read 21 / 12 / 9 on the v1 engine, 10 / 2 / 0 at leak 0.4 and 17 / 6 / 5 at leak 0.15, and a receptor outlived an identical blind neighbour 30 steps to 25.",
    tolerance: "Leak 0.15 leaves strictly more survivors and innovations at 90 steps than leak 0.4 on the same seed.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "workbench.md, \"Upgrade Stage 1 — model correctness\", calibration evidence",
  },
  {
    id: "meal-budget",
    claim: "Trophic transfer is bounded by attack rate, not by local density.",
    method: "One predator ringed by eight edible prey, one tick, with maxMealsPerTick 1 and then 3.",
    measured: "Eight kills before the fix; one with the default budget and three with the budget raised.",
    tolerance: "Exactly maxMealsPerTick kills.",
    check: { kind: "test", file: "tests/predation.test.ts" },
    source: "workbench.md, \"Upgrade Stage 1\", the two measured artifacts",
  },
  {
    id: "field-mass-conservation",
    claim: "Below the field clamp the diffusion kernel conserves mass, and a barrier blocks the flux.",
    method: "Nutrient isolated on an open plate with decay, inflow and vents zeroed; diffuse 200 steps and compare the totals.",
    measured: "Total mass unchanged to float precision; no nutrient crosses a barrier column.",
    tolerance: "Relative drift below 1e-4.",
    check: { kind: "test", file: "tests/validation.test.ts" },
    source: "tests/validation.test.ts",
  },
  {
    id: "genome-economics",
    claim: "Sequence length is not free: upkeep and replication are charged per base.",
    method: "Two organisms with the same phenotype but different genome lengths; compare energy after N ticks and the cost charged at birth.",
    measured: "Energy differs by genomeUpkeep x bases x ticks; a birth pays replicationCost x bases before the daughter's share.",
    tolerance: "Longer genome strictly poorer at equal phenotype.",
    check: { kind: "test", file: "tests/evolution.test.ts" },
    source: "src/sim/world.ts reproduceAll, src/sim/fitness.ts maintenanceCost",
  },
  {
    id: "selection-recovery",
    claim: "The reported selection coefficient is an estimator, not a decoration: it recovers a known s.",
    method: "Synthetic frequency trajectories with a known per-tick s; least-squares slope of logit(frequency).",
    measured: "Recovers s to three decimals across the tested trajectories; the test names the scenario and the expected value.",
    tolerance: "|estimate - s| below 0.002.",
    check: { kind: "test", file: "tests/selection.test.ts" },
    source: "src/sim/selection.ts, workbench.md Stage 3",
  },
  {
    id: "plate-capacity",
    claim: "Population size is bounded by the plate rather than by the parameter.",
    method: "180 founders on the 128x128 default plate, step to 400 and read the population and Shannon index.",
    measured: "Reaches 263 at tick 100, peaks at 924 (below the 1100 cap) and holds 670-780 organisms with Shannon 5.9 at tick 400.",
    tolerance: "Recorded measurement; the population must stay below maxPopulation.",
    check: { kind: "recorded" },
    source: "workbench.md, \"Round: a habitable fresh plate\"",
  },
  {
    id: "perf-budget",
    claim: "A step fits the 60 fps budget on the canonical world.",
    method: "tests/engine.test.ts perf world (128x128, 260 founders, seed 0xa7f31ab), 48 steps, ms per step.",
    measured: "10.6 ms/step on the canonical world against a 16.67 ms target; 3.85 ms/step at about 74 organisms on a quiet machine.",
    tolerance: "Below 16.67 ms/step.",
    check: { kind: "test", file: "tests/engine.test.ts" },
    source: "workbench.md, Stage 3 performance note",
  },
];

export const LIMITS: readonly LimitEntry[] = [
  {
    gap: "The interface has no manifest import",
    detail: "A manifest can be exported from the Expérience panel and replayed by the headless runner or stored runs, but a .json manifest cannot be loaded back into the interface.",
    source: "src/ui/goalPanel.ts, src/sim/manifest.ts",
  },
  {
    gap: "Binary snapshot files are not wired to the interface",
    detail: "snapshotBin.ts encodes and decodes the OAV2 container, and the timeline stores encoded buffers, but the export button still writes JSON.",
    source: "src/sim/snapshotBin.ts, src/ui/goalPanel.ts",
  },
  {
    gap: "Profil v1 only approximates engine-v1",
    detail: "The legacy profile restores senescence 0, regulation off, no recombination, no exudate, no genome costs, 8 meals per tick and light diffusion 0.22. The meal budget and the decoder differ, so results are close but not hash-identical: use the tag engine-v1 for bit-reproducing pre-upgrade results.",
    source: "src/ui/modelPanel.ts LEGACY_V1_PROFILE",
  },
  {
    gap: "The 3D view has no exudate plane",
    detail: "Layer 5 falls back to the composite rendering in 3D; the exudate layer is a 2D overlay.",
    source: "src/render/view3d.ts, src/app.ts",
  },
  {
    gap: "Nutrient inflow is a source term",
    detail: "nutrientInflow injects nutrient from outside the modelled system, so total field mass is only conserved when it is zero. The validation tests zero it deliberately, and the parameter is bounded at 0.2 per tick.",
    source: "src/sim/fields.ts applyVentsAndDecay, tests/validation.test.ts",
  },
  {
    gap: "The perf baseline is measured on a lightly populated world",
    detail: "The canonical perf world loses organisms over its 48 steps, so the recorded ms/step does not describe a mature plate at the 1100-organism cap.",
    source: "tests/engine.test.ts, workbench.md",
  },
];

/* --------------------------------------------------------------- rendering */

/**
 * Markdown inline code span. Building code spans through a function keeps the
 * renderers free of raw backticks inside template literals.
 */
function code(text: string): string {
  return "\u0060" + text + "\u0060";
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

/** Show a repeating decimal such as 0.011363636363636364 as 1/88. */
export function formatDefault(value: number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  const inv = 1 / value;
  if (Number.isFinite(inv) && inv > 1 && Math.abs(inv - Math.round(inv)) < 1e-6) {
    return `${value} (1/${Math.round(inv)})`;
  }
  return String(value);
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

function renderIdentity(): string {
  const info = engineInfo();
  return [
    `- Engine version **${info.version}**, model revision **${info.revision}**, state hash ${code(info.hashAlgo)}.`,
    "- The canonical perf world is a 128 x 128 plate with 260 founders and seed 0xa7f31ab; the pinned hash after 48 steps lives in `tests/baselines/engine.json`.",
    "- Results published under an earlier revision reproduce from the annotated tag `engine-v1` (pre-upgrade) or from the engine version named in the manifest. `tests/fixtures/snapshot-v1.json` is the migration fixture captured from that revision.",
    "- `npm run baseline` regenerates the pinned hash deliberately; `npm test` fails if the behaviour hash changes without it.",
  ].join("\n");
}

function renderParams(): string {
  const rows = PARAM_SPEC.map((spec) => [
    `\`${spec.key}\``,
    spec.group,
    spec.kind === "boolean" ? "flag" : "number",
    escapeCell(spec.key === "seed" && typeof spec.default === "number" ? `0x${spec.default.toString(16)} (${spec.default})` : formatDefault(spec.default)),
    spec.kind === "boolean" ? "0-1" : `${spec.min}-${spec.max}`,
    spec.kind === "boolean" ? "1" : String(spec.step),
    spec.unit ? escapeCell(spec.unit) : "-",
    escapeCell(spec.description),
  ]);
  return [
    `${PARAM_SPEC.length} parameters. ${code("PARAM_SPEC")} in ${code("src/sim/params.ts")} is the single source: the interface form, the URL query keys (${code("QUERY_KEYS")}), ${code("normalizeParams")} bounds and this table are all generated from it.`,
    "",
    table(["Key", "Group", "Type", "Default", "Bounds", "Step", "Unit", "Meaning"], rows),
  ].join("\n");
}

function renderConstants(): string {
  const rows = MODEL_CONSTANTS.map((c) => [
    c.group,
    `\`${c.name}\``,
    `\`${escapeCell(c.value)}\``,
    `\`${c.source}\``,
    escapeCell(c.note),
  ]);
  return [
    "Values the model hard-codes rather than exposing as parameters. Each row is read from the module that defines it, so changing a constant without regenerating this document fails the test suite.",
    "",
    table(["Area", "Constant", "Value", "Defined in", "Meaning"], rows),
  ].join("\n");
}

function renderRevisions(): string {
  const blocks = REVISION_LOG.map((r) => {
    const lines = [
      `### ${r.version} — revision ${r.revision} — perf hash \`${r.perfHash}\` (${r.date})`,
      "",
      `**${r.headline}.**`,
      "",
      ...r.changes.map((c) => `- ${c}`),
      "",
      `Evidence: ${r.evidence}.`,
    ];
    return lines.join("\n");
  });
  return [
    "The current revision is asserted against `src/sim/engine.ts` and `tests/baselines/engine.json` on every test run; the earlier rows are the recorded history of the model.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function renderCalibration(): string {
  const blocks = CALIBRATION.map((c) => {
    const check = c.check.kind === "test" ? `re-measured by \`${c.check.file}\` on every run` : "recorded measurement (not re-measured by the suite)";
    return [
      `### ${c.id}`,
      "",
      c.claim,
      "",
      `- **Method.** ${c.method}`,
      `- **Measured.** ${c.measured}`,
      `- **Tolerance.** ${c.tolerance}`,
      `- **Checked by.** ${check}.`,
      `- **Source.** ${c.source}.`,
    ].join("\n");
  });
  return [
    "Why each default has the value it has. Entries backed by a test carry a `calibration:<id>` marker in that file, so the record cannot point at a check that no longer exists.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function renderLimits(): string {
  return LIMITS.map((l) => `- **${l.gap}.** ${l.detail} (${code(l.source)})`).join("\n");
}

const RENDERERS: Record<SectionId, () => string> = {
  identity: renderIdentity,
  params: renderParams,
  constants: renderConstants,
  revisions: renderRevisions,
  calibration: renderCalibration,
  limits: renderLimits,
};

export function renderSection(id: SectionId): string {
  return RENDERERS[id]();
}

/**
 * Replace every generated block of `doc` with its current rendering. Throws on
 * a missing, duplicated or unknown marker rather than silently dropping text.
 */
export function applyGenerated(doc: string): string {
  const known = new Set<string>(SECTION_IDS);
  for (const match of doc.matchAll(/<!-- generated:([a-z]+) -->/g)) {
    if (!known.has(match[1]!)) throw new Error(`docs/model.md has an unknown generated block: ${match[0]}`);
  }
  let out = doc;
  for (const id of SECTION_IDS) {
    const begin = beginMarker(id);
    const end = endMarker(id);
    const b = out.indexOf(begin);
    const e = out.indexOf(end);
    if (b < 0) throw new Error(`docs/model.md is missing the "${id}" block: add ${begin} and ${end}`);
    if (out.indexOf(begin, b + 1) >= 0) throw new Error(`docs/model.md has a duplicated "${id}" block`);
    if (e < 0 || e < b) throw new Error(`docs/model.md has an unterminated "${id}" block`);
    out = `${out.slice(0, b + begin.length)}\n${renderSection(id)}\n${out.slice(e)}`;
  }
  return out;
}

/** The engine identity the document advertises, for tests that check both sides. */
export function identityFacts(): { version: string; revision: number; hashAlgo: string } {
  return { version: ENGINE_VERSION, revision: MODEL_REVISION, hashAlgo: HASH_ALGO };
}
