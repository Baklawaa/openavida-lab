/**
 * Shared contract of the Expérience goal panel after its split: the mutable
 * state the modules read and write, the services the app hands the panel, and
 * the few helpers they share (DOM query, HTML escape, replay note). Modules
 * import this file, never goalPanel.ts, so the split stays acyclic.
 */
import type {
  Goal,
  Manifest,
  Recipe,
  Strain,
  SweepPoint,
  SweepVariable,
  TournamentSummary,
  TrialConfig,
  TrialResult,
  World,
  WorldSnapshot,
} from "../sim/index";
import type { ExperimentRecord } from "./experimentHistory";
import type { RunHandle } from "./goalRunner";
import { PresetStore, type PresetMeta } from "./presetStore";

/** What the app hands the panel; the modules reach the same services through GoalContext. */
export interface GoalPanelOptions {
  status(msg: string): void;
  world(): World;
  activeWorld(): "A" | "B";
  /** Restore a snapshot into the active world or into world B (and show it). */
  restoreInto(target: "active" | "B", snapshot: WorldSnapshot): void;
  /** Replace world B with a start state and start playing it, so a replicate is watched from its first step. */
  replayInto(snapshot: WorldSnapshot): void;
  /** Replace world B with this end state and open the organism explorer on it. */
  openCatalog(snapshot: WorldSnapshot): void;
  setRecording(on: boolean): void;
  applyRecipe(recipe: Recipe, target: "active" | "B"): void;
  reportExtras(): { treePng: string | null };
}

/** Replicate ceilings: runs are long but the UI must stay responsive, so rendering is throttled and capped. */
export const MAX_REPLICATES = 5000;
export const MAX_SWEEP_REPLICATES = 500;

/** Result-table orders. "launch" keeps the replicate index; the others sort as their label says. */
export type ResultSort = "launch" | "hit-fast" | "hit-slow" | "fail-fast" | "fail-slow" | "value-desc" | "pop-desc";

/** Everything the modules mutate while the panel lives, so no module needs the class. */
export interface GoalPanelState {
  /** Start state and configs of the last run or sweep, for exact replays. */
  lastRun: { snapshot: WorldSnapshot; label: string; configs: TrialConfig[] } | null;
  /** Results indexed by replicate; holes while a run is in flight. */
  results: TrialResult[];
  /** Ticks reached by each replicate, for the progress bars. */
  progress: number[];
  lastGoal: Goal | null;
  lastGoals: Goal[];
  extraGoals: Goal[];
  /** Manifest loaded from a file: while set, it specifies the next run and is returned by manifest(). */
  imported: Manifest | null;
  lastStrains: Strain[];
  lastMetricKey: string;
  sweepPoints: SweepPoint[];
  sweepVar: SweepVariable;
  tournamentNames: string[];
  tournamentSummary: TournamentSummary | null;
  tournamentPickKey: string;
  historyRecords: ExperimentRecord[];
  historySelected: string[];
  presets: PresetMeta[];
  handle: RunHandle | null;
  sort: ResultSort;
  /** Coalescing state of the live rendering: at most one DOM update per RENDER_INTERVAL_MS. */
  renderTimer: number | null;
  renderMax: number;
  resultsDirty: boolean;
  lastTableRender: number;
  /** Set while a replicate is being re-simulated: one reconstruction at a time, never two racing for world B. */
  rebuilding: boolean;
}

/** State object plus the app services and DOM helpers, handed to every module function. */
export interface GoalContext extends GoalPanelOptions {
  /** Panel root: the q() lookup and the section search start here. */
  readonly root: HTMLElement;
  /** Local preset / journal storage, shared by the preset, history and tournament code. */
  readonly store: PresetStore;
  /** Mutable state; modules write here instead of touching class fields. */
  readonly state: GoalPanelState;
  /** querySelector on the panel root; the markup guarantees the id exists. */
  q<T extends HTMLElement>(sel: string): T;
}

/** A fresh state object, so the panel constructor stays a list of wiring calls. */
export function initialState(): GoalPanelState {
  return {
    lastRun: null,
    results: [],
    progress: [],
    lastGoal: null,
    lastGoals: [],
    extraGoals: [],
    imported: null,
    lastStrains: [],
    lastMetricKey: "",
    sweepPoints: [],
    sweepVar: "toxinScale",
    tournamentNames: [],
    tournamentSummary: null,
    tournamentPickKey: "",
    historyRecords: [],
    historySelected: [],
    presets: [],
    handle: null,
    sort: "hit-fast",
    renderTimer: null,
    renderMax: 0,
    resultsDirty: false,
    lastTableRender: 0,
    rebuilding: false,
  };
}

/** Bind the state, the storage and the app services to the panel root; the only place a PresetStore is made. */
export function createGoalContext(root: HTMLElement, opts: GoalPanelOptions): GoalContext {
  return {
    ...opts,
    root,
    store: new PresetStore(),
    state: initialState(),
    q: <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!,
  };
}

/** HTML-escape a user-supplied name before it joins an innerHTML string. */
export function escapeGoalHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** Reveal the replay note above the replay controls (replay and catalogue both report there). */
export function showReplayInfo(ctx: GoalContext, html: string): void {
  const box = ctx.q("#replay-info");
  box.innerHTML = html;
  box.hidden = false;
}
