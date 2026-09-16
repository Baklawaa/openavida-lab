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
import { EXUDATE_FITNESS, EXUDATE_MAX, EXUDATE_UPTAKE_PER_UPTAKE, EXUDATE_YIELD, PHOTO_GAIN, UPTAKE_GAIN } from "../src/sim/chemistry";
import { KIN_THRESHOLD, MASS_DECAY, MASS_HUNT_BONUS, MASS_KILL_AGGRESSION, MASS_MAINTENANCE, MASS_PER_KILL, MASS_SIZE_GAIN, MASS_TO_BREED, MEAL_BODY_BONUS, PREY_ATTRACTION, PREY_SENSE_RADIUS, TROPHIC_SHARE_AGGRESSION, TROPHIC_SHARE_BASE } from "../src/sim/body";
import { ALPHABET, CODON_LEN, MAX_GENOME, MIN_GENOME, REG_CROSS, REG_MAX, REG_SELF, REG_WINDOW, START_CODON, STOP_CODONS } from "../src/sim/mapping";
import { DEATH_LOG_KEEP, DEATH_LOG_MAX, LINEAGE_TOP_N, RESEARCH_LOG_KEEP, RESEARCH_LOG_MAX, SNAPSHOT_VERSION } from "../src/sim/types";
import { HISTORY_KEEP, HISTORY_MAX, NEUTRAL_LOG_MAX } from "../src/sim/world";
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
import { HISTORY_CURVES, HISTORY_RESULTS_CAP } from "../src/ui/experimentHistory";

/* ------------------------------------------------------------------ markers */

export const SECTION_IDS = ["identity", "params", "constants", "revisions", "calibration", "limits", "memory"] as const;
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

export interface MemoryBoundEntry {
  /** The structure that grows with the run. */
  structure: string;
  /** What one retained item holds. */
  holds: string;
  /** The bound, built from the constants that define it at render time. */
  bound: string;
  /** Where the bound is applied. */
  enforcedIn: string;
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
  { group: "Body", name: "MEAL_BODY_BONUS", value: num(MEAL_BODY_BONUS), source: "src/sim/body.ts", note: "Extra energy from the prey's body, per unit of effective size. Small: at 0.45 a kill always paid and aggression ran away." },
  { group: "Body", name: "TROPHIC_SHARE_BASE / TROPHIC_SHARE_AGGRESSION", names: ["TROPHIC_SHARE_BASE", "TROPHIC_SHARE_AGGRESSION"], value: `${TROPHIC_SHARE_BASE} / ${TROPHIC_SHARE_AGGRESSION}`, source: "src/sim/body.ts", note: "Share of the prey's stored energy a kill transfers, at aggression 0 and per unit of aggression. This is the trophic efficiency that keeps predation a strategy instead of a runaway." },
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
  { group: "Logs and bounds", name: "HISTORY_MAX / KEEP", names: ["HISTORY_MAX", "HISTORY_KEEP"], value: `${HISTORY_MAX} / ${HISTORY_KEEP}`, source: "src/sim/world.ts", note: "Metrics samples are trimmed to KEEP once they pass MAX, so the history stays bounded on long runs." },
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

/**
 * Every structure that grows with the run and the constants that cap it. The
 * bounds are interpolated from the imported constants, so raising a cap cannot
 * leave §8 stale the way a hand-written list did.
 */
export const MEMORY_BOUNDS: readonly MemoryBoundEntry[] = [
  {
    structure: "`World.history`",
    holds: "one `MetricsSample` per tick (population, diversity, trait distribution, lineage top list)",
    bound: `${HISTORY_MAX} samples, trimmed to ${HISTORY_KEEP}`,
    enforcedIn: "`src/sim/world.ts` `recordMetrics`; the worker mirror re-applies the same bound in `src/sim/simHost.ts`",
  },
  {
    structure: "`World.deaths`",
    holds: "death records with cause, age, genome and parent, for the death log and the explorer",
    bound: `${DEATH_LOG_MAX} records, trimmed to ${DEATH_LOG_KEEP}`,
    enforcedIn: "`src/sim/world.ts` `reap`",
  },
  {
    structure: "`World.eventLog`",
    holds: "research events (birth, death, meal, exudation, recombination, neutral) when `recordEvents` is on",
    bound: `${RESEARCH_LOG_MAX} events, trimmed to ${RESEARCH_LOG_KEEP}`,
    enforcedIn: "`src/sim/world.ts` `pushEvent`",
  },
  {
    structure: "`World.neutralLog`",
    holds: "hue-only substitutions kept for the molecular clock",
    bound: `${NEUTRAL_LOG_MAX} substitutions`,
    enforcedIn: "`src/sim/world.ts` `birth`",
  },
  {
    structure: "`Timeline` ring",
    holds: `encoded OAV2 snapshots taken every ${DEFAULT_TIMELINE_EVERY} ticks`,
    bound: `${DEFAULT_TIMELINE_BUDGET / (1024 * 1024)} MB; the oldest entry after the origin is evicted first`,
    enforcedIn: "`src/sim/timeline.ts` `Timeline.evict`",
  },
  {
    structure: "`ExperimentRecord.results`",
    holds: "stored `TrialResult` replicates per journal record (the summary keeps the full statistics)",
    bound: `${HISTORY_RESULTS_CAP} replicates`,
    enforcedIn: "`src/ui/experimentHistory.ts` `recordFromRun`",
  },
  {
    structure: "`ExperimentRecord.curves`",
    holds: "evenly sampled replicate curves per journal record, for the overlay chart",
    bound: `${HISTORY_CURVES} curves`,
    enforcedIn: "`src/ui/experimentHistory.ts` `sampleCurves`",
  },
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
  {
    version: "2.3.0",
    revision: 5,
    perfHash: "b6734bfc",
    date: "2026-09-14",
    headline: "Heritable lifespan, a standing climate, and a food web with prices",
    changes: [
      "A twelfth trait, longevity, multiplies the age ceiling: lifespan = max(1, round(maxAge x longevity)), squashed into [0.5, 2]. The senescence hazard and the reap cutoff both use the organism's own ceiling. It rides on the threonine codons ACT/ACC/ACA/ACG (+0.06) and the cysteines TGT/TGC (+0.08), so a genome that predates it keeps its phenotype, and params.longevityUpkeep (0.012 per unit above 1) charges for the extra life in both ledgers.",
      "The climate has a floor: the temperature field relaxes towards params.ambientTemperature (0.5) instead of decaying to 0. A one-way decay was a countdown — every organism's |temperature - tpref| cost grew without bound, so the plate froze into mass starvation by tick ~500 whatever it ate.",
      "Harvest is the documented mass-action law again: energy is uptake x nutrient x UPTAKE_GAIN, and params.nutrientUptakeCap only limits how fast a cell can be stripped. Reconstructing the harvest from the cap instead made income quadratic in uptake (a knife-edge at uptake ~ 0.67) and let one constant set the whole plate's energy budget.",
      "Aggression is priced: params.aggressionUpkeep (0.30 per unit) is charged in both ledgers. Free aggression swept to fixation, every organism became a predator and the plate ate itself extinct at tick ~1250; the priced plate holds ~1090 organisms for 3000 ticks with all five death causes present.",
      "Hunting follows need: a predator only attacks while it is below its own division threshold, so a fed predator is blocked by prey instead of hoarding meals.",
      "Trophic efficiency is real: a meal transfers TROPHIC_SHARE_BASE + TROPHIC_SHARE_AGGRESSION x aggression (0.30 + 0.30) of the prey's stored energy plus a small MEAL_BODY_BONUS (0.10, was 0.45) of its body. The old pair made every kill a 15-to-40-tick jackpot whatever the prey held, so aggression remained free money and the plate still decayed to 69 organisms by tick 6000; at the new share the default plate holds 1088-1098 to tick 5500 and predation stays a third of deaths.",
      "The two specialist kits can feed themselves: Resistant is resist x5 / uptake x5 / motility x3 (uptake x3 left its income ceiling below its own maintenance, so a dropped Resistant starved in fifteen ticks) and the Mutualist gains motility x3. randomGenome() now derives its trait list from TRAIT_NAMES, so no trait can be missing from the random founders.",
      "Snapshot schema v3 with a v2 -> v3 migration: a version-2 payload predates longevity, and restoring its stored phenotype verbatim left ph.longevity undefined, lifespan() NaN and the next reap() empty. World.restore and parseWorldBytes now migrate every reader, so file import, presets, in-session snapshots and the worker op all pass through one choke point.",
      "nutrientDecay defaults to 0.004 (equilibrium 1.0) and seedEnvironment starts the plate at that equilibrium; inflowNutrient defaults to 1 so a chemostat starts habitable.",
    ],
    evidence: "workbench.md, \"Round: a gene for age\" and \"Round: death with reasons\"",
  },
];

export const CALIBRATION: readonly CalibrationEntry[] = [
  {
    id: "plate-habitability",
    claim: "A ventless plate stays habitable and a dropped organism founds a population instead of starving in seconds.",
    method: "World(48x48, published defaults, randomTerrain false) with one heterotroph kit genome placed at the centre; step 260 ticks and record the first birth, the population and the plate's mean nutrient.",
    measured: "First birth at tick 22, six organisms at tick 150 (the founder still among them) and twenty-five at tick 260; mean nutrient 0.994 at tick 100. Before the climate and harvest repairs the same founder never divided at all: it peaked at 1.008 energy against a 1.542 threshold and died childless at tick 260.",
    tolerance: "The founder is alive at step 150, the population has grown past it, and mean nutrient at step 100 is at least 0.42.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/world.ts seedEnvironment, params.ambientTemperature",
  },
  {
    id: "nutrient-equilibrium",
    claim: "Nutrient inflow sets a floor under a ventless plate: the equilibrium is inflow / nutrientDecay.",
    method: "32x32 world with the published defaults (nutrientInflow 0.004, nutrientDecay 0.004), no organisms and no vents; step 400 and read the mean nutrient.",
    measured: "1.000 by tick 400 (0.004 / 0.004), and the plate starts there because seedEnvironment fills the equilibrium. The break-even of a stock heterotroph is (maintenance + thermal) / (uptake x UPTAKE_GAIN) = (0.0676 + 0.0277) / 0.1512, about 0.63.",
    tolerance: "Within 0.05 of inflow / nutrientDecay at tick 400, and the equilibrium stays above the 0.63 break-even.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/fields.ts, src/sim/world.ts seedEnvironment",
  },
  {
    id: "exudate-surplus-rule",
    claim: "Cross-feeding is overflow metabolism: only a phototroph whose gross gain exceeds its maintenance leaks, and exudateLeak 0 disables the trophic link exactly.",
    method: "32x32 plate, 12 phototrophs injected; step 60 and read lastExudate and the exudate field total; repeat with exudateLeak 0.",
    measured: "Twelve phototrophs on a 32x32 plate: 21 leak in the peak tick and the field total reaches 1.99 by step 60. With exudateLeak 0 the field total stays at exactly 0 for the whole run.",
    tolerance: "At least one producer event with the default; field total identically 0 at leak 0.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/chemistry.ts, src/sim/ecology.ts metabolize",
  },
  {
    id: "exudate-leak-tuned",
    claim: "The leak is a transfer, not a tax: a larger exudateLeak no longer strangles a phototroph monoculture.",
    method: "24 injected phototrophs, mutationRate 1, 90 steps: survivors and innovations at leak 0.15 and at leak 0.4, plus the 0-leak rule above.",
    measured: "26 survivors / 12 innovations at leak 0.15 against 33 / 14 at leak 0.4. The historical bisect read the other way (11 / 2 against 7 / 0) while the plate was cooling to zero and the nutrient yield was capped below subsistence; with both repaired the surplus is recovered by receptors instead of lost.",
    tolerance: "Both monocultures survive 90 steps and the higher leak is not worse by more than a quarter.",
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
    claim: "Population size is bounded by the plate as much as by the parameter.",
    method: "180 founders on the 128x128 default plate, step to 400 and read the population, then keep stepping to 3000 and read the death causes and mean aggression.",
    measured: "508 at tick 100, 677 at tick 400, peak 1087 against the 1100 cap; at tick 3000 the plate holds 1093 organisms with mean aggression 0.028 and deaths by competition 1744, old-age 1652, starvation 307, predation 162, crowding 75.",
    tolerance: "Recorded measurement; the population must stay below maxPopulation.",
    check: { kind: "recorded" },
    source: "workbench.md, \"Round: a habitable fresh plate\"",
  },
  {
    id: "perf-budget",
    claim: "A step fits the 60 fps budget on the canonical world, and the mature plate fits its own measured budget.",
    method: "npx vite-node tools/perf.ts: three 128x128 scenarios on seed 0xa7f31ab with 50 measured steps each — canonical (260 founders, 48 warmup ticks), mature (180 founders, stepped to tick 400) and chemostat (dilutionRate 0.02, inflowNutrient 1, 400 warmup ticks).",
    measured: "4.4 ms/step at 160 organisms on the canonical world, 5.3 on the mature plate (1033 organisms) and 5.7 in the chemostat (1089) on an idle machine; 8.5 / 10.4 / 11.1 ms/step on the same scenarios for 152 / 677 / 1087 organisms while another process held most of a core (a WebKit WebContent at 58 %). A clean checkout of the previous commit measures the identical field cost, so the difference is the machine, not the model — and all three stay inside their budgets either way.",
    tolerance: "Canonical below 16.67 ms/step (the 60 fps target); mature below 12.9 ms/step and chemostat below 12.4 ms/step (2.5x the slowest recorded run).",
    check: { kind: "test", file: "tests/perf.test.ts" },
    source: "tools/perf.ts, tests/perf.test.ts",
  },
  {
    id: "longevity-trade-off",
    claim: "Lifespan is heritable, and the extra life is charged as upkeep, so the trait faces a trade-off instead of pinning itself at the cap.",
    method: "Decode two genomes that differ in exactly two ACT codons (threonine, +0.06 longevity each); compare the phenotype, lifespan and maintenanceCost, then hold a carrier on a fed plate with senescenceRate 0 and maxAge 40.",
    measured: "1.0000 to 1.1200 longevity: an age ceiling of 40 becomes 45 and 260 becomes 291, while maintenance rises from 0.065200 to 0.066640 energy per tick (LONGEVITY_UPKEEP x 0.12). The carrier is still alive at step 41 on a plate whose parameter ceiling is 40.",
    tolerance: "The measured deltas must follow the codon extras exactly; the carrier outlives maxAge with the hazard disabled.",
    check: { kind: "test", file: "tests/longevity.test.ts" },
    source: "src/sim/mapping.ts CODON_EXTRAS, src/sim/body.ts lifespan, src/sim/fitness.ts maintenanceCost",
  },
  {
    id: "founder-viability",
    claim: "Every non-carnivorous starter kit founds a population from a single founder on a bare default plate.",
    method: "One founder of the phototroph, heterotroph, resistant and mutualist kits on a fresh 48x48 plate (seed 0xa7f31ab, no injected food); step 600 ticks and record the first birth and the largest population.",
    measured: "First birth at tick 34 / 38 / 63 / 50 with a largest population of 115 / 68 / 11 / 62. Before the repairs all four were dead ends: the heterotroph never divided, the phototroph divided once at tick 251, and the Resistant and Mutualist kits starved in fifteen ticks.",
    tolerance: "Every listed kit divides within 200 ticks and passes a population of 5; the predator kit is excluded because it needs prey.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/kits.ts, src/sim/genome.ts founder*",
  },
  {
    id: "aggression-priced",
    claim: "Aggression is not free: a population seeded with hunters loses them, because the hunting apparatus is charged every tick.",
    method: "32x32 plate, no injection: 40 phototrophs and 20 predators placed by hand (mean aggression 0.193), stepped 300 ticks on three seeds; read the mean aggression of the survivors.",
    measured: "Mean aggression falls to 0.020 / 0.020 / 0.023 on seeds 1 / 7 / 21, i.e. back to the phototroph baseline: the hunters cannot pay AGGRESSION_UPKEEP without prey. Free aggression instead swept the mature plate to mean 0.91 and extinction.",
    tolerance: "Every seed stays populated and drops below 0.05 mean aggression.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/fitness.ts aggressionUpkeep, params.aggressionUpkeep, src/sim/ecology.ts hungry",
  },
  {
    id: "plate-persistence",
    claim: "A mature plate with predators present persists for thousands of ticks.",
    method: "180 founders on the 128x128 default plate (seed 0xa7f31ab); step to 6000 ticks and read the trajectory, then the death causes of the last 3000 deaths.",
    measured: "1088-1098 organisms from tick 500 to tick 5500, then 810 at tick 6000; over that final stretch the causes are starvation 1529, predation 1387, competition 577, crowding 315, old-age 80 — every cause present, predation about a third of deaths. Before the trophic repair the same plate ran to mean aggression 1.3 and 69 organisms by tick 6000, and with free aggression it went extinct at tick 2190.",
    tolerance: "Recorded measurement of a long run; the tested claim below pins the mechanism on a cheaper scenario.",
    check: { kind: "recorded" },
    source: "workbench.md, \"Round: death with reasons\"",
  },
  {
    id: "plate-longrun",
    claim: "A plate keeps a self-regulating community for thousands of ticks: deaths have causes, aggression stays bounded and predators stay alive.",
    method: "64x64 plate, 180 founders (seed 0xa7f31ab), 2500 ticks; read the population, its minimum after tick 300, mean aggression and the death causes.",
    measured: "582 organisms at tick 2500, minimum 69 after tick 300, mean aggression 0.066, predation 1213 of 3102 deaths. With the pre-stabiliser transfer (0.35 + 0.40 x aggression plus a 0.45 body bonus) the same scenario is extinct at tick 1843.",
    tolerance: "Still populated at tick 2500 with more than 100 organisms, mean aggression below 0.5, and more than 100 predation deaths.",
    check: { kind: "test", file: "tests/calibration.test.ts" },
    source: "src/sim/body.ts feed, TROPHIC_SHARE_BASE, MEAL_BODY_BONUS",
  },
];

export const LIMITS: readonly LimitEntry[] = [
  {
    gap: "Profil v1 only approximates engine-v1",
    detail: "The legacy profile restores senescence 0, regulation off, no recombination, no exudate, no genome costs, 8 meals per tick and light diffusion 0.22. The meal budget and the decoder differ, so results are close but not hash-identical: use the tag engine-v1 for bit-reproducing pre-upgrade results.",
    source: "src/ui/modelPanel.ts LEGACY_V1_PROFILE",
  },
  {
    gap: "Nutrient inflow is a source term",
    detail: "nutrientInflow injects nutrient from outside the modelled system, so total field mass is only conserved when it is zero. The validation tests zero it deliberately, and the parameter is bounded at 0.2 per tick.",
    source: "src/sim/fields.ts applyVentsAndDecay, tests/validation.test.ts",
  },
  {
    gap: "The perf budget is scenario-specific",
    detail: "The canonical 128 x 128 world (260 founders, seed 0xa7f31ab) is the pinned-hash world: its budget is the 16.67 ms/step 60 fps target. The mature plate (180 founders stepped to tick 400, 1033 organisms) and the chemostat carry their own 2.5x-headroom budgets in tests/perf.test.ts, measured by npx vite-node tools/perf.ts. No single scenario describes the 1100-organism cap.",
    source: "tests/perf.test.ts, tools/perf.ts",
  },
  {
    gap: "A mature plate reaches its population cap",
    detail: "With the climate and harvest repaired the plate is productive enough to fill maxPopulation (1100) from tick ~1000, so at maturity the cap is a binding constraint rather than a safety net: 677 organisms at tick 400 and 1093 at tick 3000 on the default plate. It is also doing stabilising work — allowed to grow past it (maxPopulation 3000) the same world booms to 2400 and crashes to a few hundred — so raising the cap is not a free way to make the plate richer.",
    source: "tools/modeldoc.ts CALIBRATION plate-capacity, src/sim/world.ts reproduceAll",
  },
  {
    gap: "Small, sparse plates are extinction-prone",
    detail: "The trophic economy self-regulates on the default 128 x 128 plate, but a small world with few founders has little spatial buffer: 64 x 64 with 90 founders goes extinct around tick 2300, while the same plate with 180 founders or a 96 x 96 plate with 90 persists for 3000+ ticks. Start small plates denser, or expect a single stochastic extinction.",
    source: "tools/modeldoc.ts CALIBRATION plate-longrun, src/sim/world.ts seedPopulation",
  },
  {
    gap: "Snapshot v2 payloads are converted, not replayed",
    detail: "A version-2 payload predates the longevity trait, so it is upgraded by recomputing every phenotype from its genome (v2 -> v3). The world plays on, but it is not bit-identical to the run that wrote it, because the phenotype gained a trait. Every reader migrates: World.restore, parseWorldBytes, the manifest start state and the worker restore op.",
    source: "src/sim/migrate.ts, src/sim/world.ts restore",
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

function renderMemory(): string {
  const rows = MEMORY_BOUNDS.map((e) => [
    e.structure,
    escapeCell(e.holds),
    escapeCell(e.bound),
    e.enforcedIn,
  ]);
  return [
    "What caps each structure that grows with the run, read from the constants themselves. A raised cap shows up here instead of leaving a hand-written list stale.",
    "",
    table(["Structure", "Holds", "Bound", "Enforced in"], rows),
  ].join("\n");
}

const RENDERERS: Record<SectionId, () => string> = {
  identity: renderIdentity,
  params: renderParams,
  constants: renderConstants,
  revisions: renderRevisions,
  calibration: renderCalibration,
  limits: renderLimits,
  memory: renderMemory,
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
