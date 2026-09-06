/**
 * SimHost: where the visible simulation runs.
 *
 * - `InlineHost` steps the DualWorld on the calling thread (default).
 * - `WorkerHost` (src/ui/workerHost.ts) keeps a *mirror* DualWorld on the
 *   main thread and forwards every mutation (`SimOp`) to a worker that owns
 *   the authoritative worlds. Mutations are also applied to the mirror
 *   immediately (optimistic), and the worker streams `WorldFrame`s back that
 *   overwrite the mirror. Frames older than the last mutation are skipped.
 *
 * `applySimOp` is the single implementation of every mutation, shared by the
 * inline host, the worker and the mirror, so all three agree by construction.
 * Nothing here draws random numbers outside World's own methods.
 */
import { BrainRuntime, baselinePolicy, llmPolicy, type BrainTrace } from "./brains";
import { copyPhenotype } from "./mapping";
import type { RecipeOp } from "./recipe";
import { DualWorld } from "./sandbox";
import { Timeline } from "./timeline";
import type { TimelineMeta } from "./timeline";
import type { EventFlags, WorldEvent } from "./events";
import type { Innovation, Strain } from "./species";
import { DEATH_LOG_KEEP, DEATH_LOG_MAX } from "./types";
import type {
  BrushKind,
  DeathRecord,
  ExtinctionRecord,
  LineageNode,
  MetricsSample,
  Organism,
  SimParams,
  WorldSnapshot,
} from "./types";
import { World, worldFromSnapshot } from "./world";

export type Side = "A" | "B";
export type StepSide = Side | "both";

export type SimOp =
  | { kind: "paint"; which: Side; x: number; y: number; radius: number; brush: BrushKind; amount?: number }
  | { kind: "place"; which: Side; x: number; y: number; genome: string; energy?: number }
  | { kind: "inject"; which: Side; genome: string; count: number; x?: number; y?: number }
  | { kind: "defineStrain"; which: Side; genome: string; name?: string; manual?: boolean }
  | { kind: "renameStrain"; which: Side; id: number; name: string }
  | { kind: "replaceGenome"; which: Side; orgId: number; genome: string }
  | { kind: "restore"; which: Side; snapshot: WorldSnapshot }
  | { kind: "replaceWorld"; which: Side; snapshot: WorldSnapshot; recording?: RecipeOp[] | null }
  | { kind: "bottleneck"; which: Side; keep: number }
  | { kind: "reseed"; params: SimParams; seedB: number }
  | { kind: "terrainPreset"; on: boolean }
  | { kind: "disturbances"; on: boolean }
  | { kind: "brains"; on: boolean; llm: boolean }
  | { kind: "recording"; which: Side; on: boolean }
  | { kind: "setParams"; which: Side; params: Partial<SimParams> }
  | { kind: "timeline"; which: Side; every?: number; trimAfter?: number };

export interface SimOpResult {
  child?: Organism | null;
  count?: number;
  ok?: boolean;
  strain?: Strain;
}

export function worldOf(dual: DualWorld, side: Side): World {
  return side === "B" ? dual.b : dual.a;
}

export function timelineOf(dual: DualWorld, side: Side): Timeline {
  return side === "B" ? dual.timelineB : dual.timelineA;
}

export function recordTimeline(dual: DualWorld, side: Side): void {
  const tl = timelineOf(dual, side);
  tl.record(worldOf(dual, side));
  worldOf(dual, side).timelineMeta = tl.meta();
}

/** Sides whose state an op may change (used to decide which frames to send). */
export function opSides(op: SimOp): Side[] {
  if (op.kind === "reseed" || op.kind === "terrainPreset" || op.kind === "disturbances" || op.kind === "brains") return ["A", "B"];
  return [op.which];
}

/** Ops after which the whole history must be resent. */
export function opResetsHistory(op: SimOp): boolean {
  return op.kind === "restore" || op.kind === "replaceWorld" || op.kind === "reseed";
}

export function applySimOp(dual: DualWorld, op: SimOp): SimOpResult {
  const result = applySimOpCore(dual, op);
  if (op.kind === "reseed") {
    dual.timelineA.clear();
    dual.timelineB.clear();
  } else if (op.kind === "replaceWorld") {
    timelineOf(dual, op.which).clear();
  }
  if (op.kind === "timeline") {
    worldOf(dual, op.which).timelineMeta = timelineOf(dual, op.which).meta();
  } else {
    for (const s of opSides(op)) recordTimeline(dual, s);
  }
  return result;
}

function applySimOpCore(dual: DualWorld, op: SimOp): SimOpResult {
  switch (op.kind) {
    case "paint":
      worldOf(dual, op.which).paint(op.x, op.y, op.radius, op.brush, op.amount);
      return {};
    case "place":
      return { child: worldOf(dual, op.which).birth(op.x, op.y, op.genome, null, false, op.energy ?? 0.9) };
    case "inject":
      return { count: worldOf(dual, op.which).injectStrain(op.genome, op.count, op.x, op.y) };
    case "defineStrain":
      return { strain: worldOf(dual, op.which).defineStrain(op.genome, { name: op.name, manual: op.manual }) };
    case "renameStrain":
      return { ok: worldOf(dual, op.which).renameStrain(op.id, op.name) };
    case "replaceGenome":
      return { ok: worldOf(dual, op.which).replaceGenome(op.orgId, op.genome) };
    case "restore":
      worldOf(dual, op.which).restore(op.snapshot);
      return {};
    case "replaceWorld": {
      const next = worldFromSnapshot(op.snapshot);
      next.recording = op.recording === undefined ? next.recording : op.recording;
      if (op.which === "B") dual.b = next;
      else dual.a = next;
      return {};
    }
    case "bottleneck":
      return { count: worldOf(dual, op.which).bottleneck(op.keep) };
    case "reseed":
      dual.a = new World(op.params);
      dual.b = new World({ ...op.params, seed: op.seedB });
      return {};
    case "terrainPreset":
      for (const w of [dual.a, dual.b]) {
        if (op.on) w.seedRandomTerrain();
        else w.clearPresetTerrain();
      }
      return {};
    case "disturbances":
      dual.a.disturbances = op.on;
      dual.b.disturbances = op.on;
      return {};
    case "brains":
      for (const w of [dual.a, dual.b]) {
        w.brainsEnabled = op.on;
        if (op.on) w.brain = new BrainRuntime(op.llm ? llmPolicy(null) : baselinePolicy);
      }
      return {};
    case "recording": {
      const w = worldOf(dual, op.which);
      w.recording = op.on ? (w.recording ?? []) : null;
      return {};
    }
    case "setParams":
      Object.assign(worldOf(dual, op.which).params, op.params);
      return {};
    case "timeline": {
      const tl = timelineOf(dual, op.which);
      if (op.every !== undefined) tl.every = Math.max(1, op.every | 0);
      if (op.trimAfter !== undefined) tl.trimAfter(op.trimAfter);
      return {};
    }
  }
}

export function stepSides(dual: DualWorld, which: StepSide, n = 1): void {
  for (let i = 0; i < n; i++) {
    if (which === "A" || which === "both") {
      dual.a.step();
      recordTimeline(dual, "A");
    }
    if (which === "B" || which === "both") {
      dual.b.step();
      recordTimeline(dual, "B");
    }
  }
}

/* ---------- frames ---------- */

export interface WorldFrame {
  which: Side;
  tick: number;
  rngState: number;
  params: SimParams;
  nextOrgId: number;
  nextLineageId: number;
  nextStrainId: number;
  nextInnovationId: number;
  nutrient: Float32Array;
  toxin: Float32Array;
  temperature: Float32Array;
  light: Float32Array;
  solar: Float32Array;
  terrain: Uint8Array;
  organisms: Organism[];
  strains: Strain[];
  innovations?: Innovation[];
  /** Death records with seq > deathsSince (all when deathsFull). */
  deaths: DeathRecord[];
  deathsFull: boolean;
  nextDeathSeq: number;
  extinctions: ExtinctionRecord[];
  history: MetricsSample[];
  historyFull: boolean;
  lineages?: LineageNode[];
  lastStepMs: number;
  lastPredation: number;
  lastMutualism: number;
  lastDisplacements: number;
  randomTerrain: boolean;
  disturbances: boolean;
  brainsEnabled: boolean;
  brainTraces?: BrainTrace[];
  recording: RecipeOp[] | null;
  timelineMeta?: TimelineMeta | null;
  events?: WorldEvent[];
  eventsFull?: boolean;
  nextEventId?: number;
  eventFlags?: EventFlags;
}

export interface FrameOptions {
  /** Send history rows with tick > historySince; -1 = everything. */
  historySince: number;
  /** Send death records with seq > deathsSince; -1 = everything. */
  deathsSince?: number;
  lineages: boolean;
  innovations: boolean;
}

export function frameFromWorld(w: World, which: Side, opts: FrameOptions): { frame: WorldFrame; transfer: ArrayBuffer[] } {
  const nutrient = new Float32Array(w.fields.nutrient);
  const toxin = new Float32Array(w.fields.toxin);
  const temperature = new Float32Array(w.fields.temperature);
  const light = new Float32Array(w.fields.light);
  const solar = new Float32Array(w.fields.solar);
  const terrain = new Uint8Array(w.terrain);
  const frame: WorldFrame = {
    which,
    tick: w.tick,
    rngState: w.rng.state(),
    params: { ...w.params },
    nextOrgId: w.nextOrgId,
    nextLineageId: w.nextLineageId,
    nextStrainId: w.nextStrainId,
    nextInnovationId: w.nextInnovationId,
    nutrient,
    toxin,
    temperature,
    light,
    solar,
    terrain,
    organisms: w.organisms.map((o) => ({ ...o, ph: copyPhenotype(o.ph) })),
    strains: [...w.strains.values()].map((s) => ({ ...s, founderPhenotype: copyPhenotype(s.founderPhenotype) })),
    deaths: (opts.deathsSince === undefined || opts.deathsSince < 0 ? w.deaths : w.deaths.filter((d) => (d.seq ?? 0) > opts.deathsSince!)).map((d) => ({ ...d })),
    deathsFull: opts.deathsSince === undefined || opts.deathsSince < 0,
    nextDeathSeq: w.nextDeathSeq,
    extinctions: w.extinctions.map((e) => ({ ...e })),
    history: opts.historySince < 0 ? w.history.map((h) => ({ ...h })) : w.history.filter((h) => h.tick > opts.historySince).map((h) => ({ ...h })),
    historyFull: opts.historySince < 0,
    lastStepMs: w.lastStepMs,
    lastPredation: w.lastPredation,
    lastMutualism: w.lastMutualism,
    lastDisplacements: w.lastDisplacements,
    randomTerrain: w.randomTerrain,
    disturbances: w.disturbances,
    brainsEnabled: w.brainsEnabled,
    recording: w.recording ? w.recording.map((op) => ({ ...op })) : null,
    timelineMeta: w.timelineMeta ? { ...w.timelineMeta, entries: w.timelineMeta.entries.map((e) => ({ ...e })) } : w.timelineMeta,
    events: w.events.map((e) => ({ ...e })),
    eventsFull: true,
    nextEventId: w.nextEventId,
    eventFlags: { dominant: [...w.eventFlags.dominant], sweep: [...w.eventFlags.sweep], firstPredation: w.eventFlags.firstPredation },
  };
  if (opts.innovations) frame.innovations = w.innovations.map((i) => ({ ...i, changes: i.changes.map((c) => ({ ...c })), env: { ...i.env } }));
  if (opts.lineages) frame.lineages = [...w.lineages.values()].map((l) => ({ ...l }));
  if (w.brain) frame.brainTraces = w.brain.traces.slice(-200).map((t) => ({ ...t }));
  return { frame, transfer: [nutrient.buffer, toxin.buffer, temperature.buffer, light.buffer, solar.buffer, terrain.buffer] };
}

/** Overwrite a mirror world with a frame. Returns false when the grid size differs (caller must recreate the world). */
export function applyFrame(w: World, f: WorldFrame): boolean {
  if (f.params.width !== w.w || f.params.height !== w.h) return false;
  Object.assign(w.params, f.params);
  w.fields.nutrient.set(f.nutrient);
  w.fields.toxin.set(f.toxin);
  w.fields.temperature.set(f.temperature);
  w.fields.light.set(f.light);
  w.fields.solar.set(f.solar);
  w.terrain.set(f.terrain);
  w.organisms = f.organisms;
  w.rebuildOccupancy();
  w.tick = f.tick;
  w.rng.setState(f.rngState);
  w.nextOrgId = f.nextOrgId;
  w.nextLineageId = f.nextLineageId;
  w.nextStrainId = f.nextStrainId;
  w.nextInnovationId = f.nextInnovationId;
  w.strains = new Map(f.strains.map((s) => [s.id, s]));
  if (f.innovations) w.innovations = f.innovations;
  if (f.deathsFull) w.deaths = f.deaths;
  else if (f.deaths.length) {
    w.deaths.push(...f.deaths);
    if (w.deaths.length > DEATH_LOG_MAX) w.deaths.splice(0, w.deaths.length - DEATH_LOG_KEEP);
  }
  w.nextDeathSeq = f.nextDeathSeq;
  w.extinctions = f.extinctions;
  if (f.historyFull) w.history = f.history;
  else if (f.history.length) {
    const first = f.history[0]!.tick;
    let cut = w.history.length;
    while (cut > 0 && w.history[cut - 1]!.tick >= first) cut--;
    if (cut < w.history.length) w.history.splice(cut);
    w.history.push(...f.history);
    if (w.history.length > 4000) w.history.splice(0, w.history.length - 3000);
  }
  if (f.lineages) w.lineages = new Map(f.lineages.map((l) => [l.id, l]));
  w.lastStepMs = f.lastStepMs;
  w.lastPredation = f.lastPredation;
  w.lastMutualism = f.lastMutualism;
  w.lastDisplacements = f.lastDisplacements;
  w.randomTerrain = f.randomTerrain;
  w.disturbances = f.disturbances;
  w.brainsEnabled = f.brainsEnabled;
  if (f.brainTraces) {
    if (!w.brain) w.brain = new BrainRuntime(baselinePolicy);
    w.brain.traces = f.brainTraces;
  }
  w.recording = f.recording;
  if (f.timelineMeta !== undefined) w.timelineMeta = f.timelineMeta;
  if (f.events) {
    if (f.eventsFull || !w.events.length) w.events = f.events;
    else {
      const seen = new Set(w.events.map((e) => e.id));
      for (const e of f.events) if (!seen.has(e.id)) w.events.push(e);
      if (w.events.length > 500) w.events.splice(0, w.events.length - 500);
    }
  }
  if (f.nextEventId !== undefined) w.nextEventId = f.nextEventId;
  if (f.eventFlags) w.eventFlags = { dominant: [...f.eventFlags.dominant], sweep: [...f.eventFlags.sweep], firstPredation: f.eventFlags.firstPredation };
  return true;
}

/* ---------- host interface + inline implementation ---------- */

export interface SimHost {
  readonly kind: "inline" | "worker";
  /** Live worlds (inline) or the mirror (worker). Always safe to read. */
  readonly dual: DualWorld;
  apply(op: SimOp): SimOpResult;
  /** Advance n ticks. Inline stops early once `budgetMs` is spent; the worker ignores the budget. */
  step(which: StepSide, n?: number, budgetMs?: number): void;
  /** Authoritative snapshot / hash (inline: immediate). */
  snapshot(which: Side): Promise<WorldSnapshot>;
  /** Cadence snapshot closest to `tick`, or null if the ring is empty. */
  snapshotAt(which: Side, tick: number): Promise<WorldSnapshot | null>;
  hash(which: Side): Promise<string>;
  /** Resolves once everything sent so far has been processed and mirrored. */
  flush(): Promise<void>;
  /** Step requests not yet reflected in `dual` (inline: 0). */
  pendingSteps(): number;
  dispose(): void;
}

export class InlineHost implements SimHost {
  readonly kind = "inline" as const;
  readonly dual: DualWorld;

  constructor(dual: DualWorld) {
    this.dual = dual;
  }

  apply(op: SimOp): SimOpResult {
    return applySimOp(this.dual, op);
  }

  step(which: StepSide, n = 1, budgetMs = Infinity): void {
    if (!Number.isFinite(budgetMs)) {
      stepSides(this.dual, which, n);
      return;
    }
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();
    for (let i = 0; i < n; i++) {
      stepSides(this.dual, which, 1);
      if (now() - t0 > budgetMs) break;
    }
  }

  snapshot(which: Side): Promise<WorldSnapshot> {
    return Promise.resolve(worldOf(this.dual, which).snapshot());
  }

  snapshotAt(which: Side, tick: number): Promise<WorldSnapshot | null> {
    return Promise.resolve(timelineOf(this.dual, which).nearest(tick)?.snapshot ?? null);
  }

  hash(which: Side): Promise<string> {
    return Promise.resolve(worldOf(this.dual, which).hashState());
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  pendingSteps(): number {
    return 0;
  }

  dispose(): void {}
}
