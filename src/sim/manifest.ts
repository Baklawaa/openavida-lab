/**
 * Experiment manifest: one self-contained, versioned description of a run.
 *
 * A manifest carries the engine identity, the parameter set, the start state
 * (parameters, a snapshot or a recipe), the programme, the goals and the
 * replicate plan. The headless runner (tools/openavida.ts) consumes it, and
 * the Experiment panel can export one from the live world, so a published
 * result can be reproduced from a single file.
 */
import { engineInfo, paramsDigest, type EngineInfo } from "./engine";
import { replicateSeeds, type Goal, type TrialConfig } from "./goals";
import { migrateSnapshot } from "./migrate";
import { applyRecipe, type Recipe } from "./recipe";
import { isScheduledOp, type ScheduledOp } from "./schedule";
import { normalizeParams, type SimParams, type WorldSnapshot } from "./types";
import { World, worldFromSnapshot } from "./world";

export const MANIFEST_VERSION = 1;

export interface ManifestRun {
  replicates: number;
  seed: number;
  maxTicks: number;
  sampleEvery: number;
  overrides?: TrialConfig["overrides"];
  keepSnapshot?: boolean;
  /** Record the research event stream for the reference replicate. */
  recordEvents?: boolean;
}

export type ManifestStart =
  | { kind: "params" }
  | { kind: "snapshot"; snapshot: WorldSnapshot }
  | { kind: "recipe"; recipe: Recipe };

export interface Manifest {
  manifestVersion: typeof MANIFEST_VERSION;
  name: string;
  notes?: string;
  createdAt?: string;
  engine: EngineInfo;
  params: SimParams;
  paramsDigest: string;
  start: ManifestStart;
  schedule?: ScheduledOp[];
  goals: Goal[];
  run: ManifestRun;
  output?: { events?: boolean; trials?: boolean };
}

export function makeManifest(init: {
  name: string;
  notes?: string;
  createdAt?: string;
  params: SimParams;
  start?: ManifestStart;
  schedule?: ScheduledOp[];
  goals: Goal[];
  run: ManifestRun;
  output?: Manifest["output"];
}): Manifest {
  const params = normalizeParams(init.params);
  return {
    manifestVersion: MANIFEST_VERSION,
    name: init.name,
    ...(init.notes ? { notes: init.notes } : {}),
    createdAt: init.createdAt ?? new Date().toISOString(),
    engine: engineInfo(),
    params,
    paramsDigest: paramsDigest(params),
    start: init.start ?? { kind: "params" },
    ...(init.schedule?.length ? { schedule: init.schedule } : {}),
    goals: init.goals,
    run: init.run,
    ...(init.output ? { output: init.output } : {}),
  };
}

/** Manifest for the live world: the start state is a snapshot, so it replays exactly. */
export function manifestFromWorld(
  world: World,
  init: {
    name: string;
    notes?: string;
    createdAt?: string;
    goals: Goal[];
    run: ManifestRun;
    output?: Manifest["output"];
  },
): Manifest {
  return makeManifest({
    ...init,
    params: { ...world.params, randomTerrain: world.randomTerrain, disturbances: world.disturbances },
    start: { kind: "snapshot", snapshot: world.snapshot() },
    schedule: world.schedule,
  });
}

function isValidGoal(v: unknown): v is Goal {
  if (!v || typeof v !== "object") return false;
  const g = v as { metric?: unknown; op?: unknown; target?: unknown; sustain?: unknown };
  if (!g.metric || typeof g.metric !== "object") return false;
  if (g.op !== ">=" && g.op !== "<=") return false;
  if (typeof g.target !== "number" || !Number.isFinite(g.target)) return false;
  const sustain = g.sustain ?? 1;
  return typeof sustain === "number" && Number.isFinite(sustain) && sustain >= 1;
}

/** Validate and normalize an unknown payload (a parsed manifest file). */
export function validateManifest(raw: unknown): { manifest: Manifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { manifest: null, errors: ["manifest is not an object"] };
  const m = raw as Record<string, unknown>;
  if (m.manifestVersion !== MANIFEST_VERSION) {
    errors.push(`manifestVersion must be ${MANIFEST_VERSION} (got ${String(m.manifestVersion)})`);
  }
  if (typeof m.name !== "string" || m.name.trim().length === 0) errors.push("name is required");
  const params = normalizeParams((m.params ?? {}) as Partial<SimParams>);
  if (!m.params || typeof m.params !== "object") errors.push("params object is required");

  const goalsRaw = Array.isArray(m.goals) ? m.goals : null;
  if (!goalsRaw || goalsRaw.length === 0) errors.push("at least one goal is required");
  const goals = (goalsRaw ?? []).filter(isValidGoal);
  if (goalsRaw && goals.length !== goalsRaw.length) errors.push("some goals are malformed");

  const runRaw = (m.run ?? {}) as Record<string, unknown>;
  const replicates = Math.round(Number(runRaw.replicates ?? 0));
  const seed = Number(runRaw.seed ?? 0) >>> 0 || 1;
  const maxTicks = Math.round(Number(runRaw.maxTicks ?? 0));
  const sampleEvery = Math.max(1, Math.round(Number(runRaw.sampleEvery ?? 1)));
  if (!(replicates >= 1 && replicates <= 100000)) errors.push("run.replicates must be between 1 and 100000");
  if (!(maxTicks >= 1 && maxTicks <= 1000000)) errors.push("run.maxTicks must be between 1 and 1000000");
  if (typeof runRaw.seed === "number" && !Number.isFinite(runRaw.seed)) errors.push("run.seed must be finite");

  let start: ManifestStart = { kind: "params" };
  const startRaw = (m.start ?? { kind: "params" }) as Record<string, unknown>;
  if (startRaw.kind === "snapshot") {
    try {
      start = { kind: "snapshot", snapshot: migrateSnapshot(startRaw.snapshot) };
    } catch (err) {
      errors.push(`start.snapshot is not usable: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (startRaw.kind === "recipe") {
    const recipe = startRaw.recipe as Recipe | undefined;
    if (!recipe || recipe.version !== 1 || !Array.isArray(recipe.ops)) errors.push("start.recipe is malformed");
    else start = { kind: "recipe", recipe };
  } else if (startRaw.kind !== "params") {
    errors.push(`unknown start kind ${String(startRaw.kind)}`);
  }

  let schedule: ScheduledOp[] | undefined;
  if (m.schedule !== undefined) {
    if (!Array.isArray(m.schedule) || !m.schedule.every(isScheduledOp)) errors.push("schedule entries are malformed");
    else schedule = m.schedule as ScheduledOp[];
  }

  if (errors.length) return { manifest: null, errors };
  return {
    manifest: {
      manifestVersion: MANIFEST_VERSION,
      name: String(m.name),
      ...(typeof m.notes === "string" ? { notes: m.notes } : {}),
      ...(typeof m.createdAt === "string" ? { createdAt: m.createdAt } : {}),
      engine: engineInfo(),
      params,
      paramsDigest: paramsDigest(params),
      start,
      ...(schedule?.length ? { schedule } : {}),
      goals,
      run: {
        replicates,
        seed,
        maxTicks,
        sampleEvery,
        ...(runRaw.overrides && typeof runRaw.overrides === "object"
          ? { overrides: runRaw.overrides as TrialConfig["overrides"] }
          : {}),
        ...(runRaw.keepSnapshot === true ? { keepSnapshot: true } : {}),
        ...(runRaw.recordEvents === true ? { recordEvents: true } : {}),
      },
      ...(m.output && typeof m.output === "object" ? { output: m.output as Manifest["output"] } : {}),
    },
    errors: [],
  };
}

/** The world state every replicate starts from. */
export function startSnapshot(m: Manifest): WorldSnapshot {
  if (m.start.kind === "snapshot") return worldFromSnapshot(m.start.snapshot).snapshot();
  if (m.start.kind === "recipe") return applyRecipe(m.start.recipe).snapshot();
  return new World({ ...m.params, startPopulation: m.params.startPopulation }).snapshot();
}

/**
 * Replicate configurations, in order. The first replicate carries the history
 * and (when recording is on) the event stream the run exports.
 */
export function configsForManifest(m: Manifest): TrialConfig[] {
  const overrides: TrialConfig["overrides"] = { ...(m.run.overrides ?? {}) };
  if (m.run.recordEvents) overrides.recordEvents = true;
  const base: TrialConfig = {
    seed: m.run.seed,
    maxTicks: m.run.maxTicks,
    sampleEvery: m.run.sampleEvery,
    overrides,
    ...(m.run.keepSnapshot ? { keepSnapshot: true } : {}),
    ...(m.schedule?.length ? { schedule: m.schedule } : {}),
  };
  return replicateSeeds(m.run.seed, m.run.replicates).map((seed, index) => ({
    ...base,
    seed,
    collectHistory: index === 0,
    collectEvents: index === 0 && m.run.recordEvents === true,
  }));
}
