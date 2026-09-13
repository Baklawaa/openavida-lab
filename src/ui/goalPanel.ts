/**
 * Expérience tab additions: local presets (IndexedDB) and goal-directed
 * multi-replicate runs. The user picks a start state (active world or a
 * preset), a measurable goal, and run parameters; replicates run in workers
 * and report the tick at which the goal was reached.
 */
import { drawSweep, drawTrialSeries, type TrialRun } from "../render/charts";
import {
  FIELD_NAMES,
  SWEEP_VARIABLES,
  TRAIT_NAMES,
  World,
  buildRecipeShareURL,
  parseRecipe,
  recipeFromWorld,
  replicateSeeds,
  summarizeSweep,
  summarizeTrials,
  sweepConfigs,
  sweepValues,
  tournamentConfigs,
  trialGoalTicks,
  summarizeTournament,
  worldForTrial,
  asGoals,
  configsForManifest,
  engineInfo,
  startSnapshot,
  makeManifest,
  validateManifest,
  worldFromSnapshot,
  type FieldName,
  type Goal,
  type Manifest,
  type GoalMetric,
  type Recipe,
  type Strain,
  type SweepPoint,
  type SweepVariable,
  type TraitName,
  type TournamentContestant,
  type TournamentSummary,
  type TrialConfig,
  type TrialResult,
  type WorldSnapshot,
} from "../sim/index";
import { runReplicates, type RunHandle } from "./goalRunner";
import { engineDrift, historyRows, recordFromRun, type ExperimentRecord } from "./experimentHistory";
import { FIELD_LABEL } from "./labels";
import { buildReportHtml } from "./report";
import { TRAIT_LABEL } from "./labels";
import { icon } from "./layout";
import { PresetStore, type PresetMeta } from "./presetStore";
import { tDynamic } from "./i18n/runtime";

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
const MAX_CHART_SERIES = 100;
const RENDER_INTERVAL_MS = 200;
/** The full result table is rebuilt at most this often while a run is in progress (always once at the end). */
const TABLE_INTERVAL_MS = 1000;
/** Steps replayed per animation frame when a replicate is rebuilt for its end-state catalogue, so the UI keeps breathing. */
const CATALOG_CHUNK = 150;

export type ResultSort = "launch" | "hit-fast" | "hit-slow" | "fail-fast" | "fail-slow" | "value-desc" | "pop-desc";
export const RESULT_SORTS: Array<{ id: ResultSort; label: string }> = [
  { id: "hit-fast", label: tDynamic("goal.sort.hitFast") },
  { id: "hit-slow", label: tDynamic("goal.sort.hitSlow") },
  { id: "fail-fast", label: tDynamic("goal.sort.failFast") },
  { id: "fail-slow", label: tDynamic("goal.sort.failSlow") },
  { id: "value-desc", label: tDynamic("goal.sort.valueDesc") },
  { id: "pop-desc", label: tDynamic("goal.sort.popDesc") },
  { id: "launch", label: tDynamic("goal.sort.launch") },
];

/** Seeds are unsigned 32-bit: digits only, 1 … 4294967295. Returns null otherwise (never silently truncates). */
export function parseSeed(text: string): number | null {
  const t = text.trim().replace(/[\s_'’]/g, "");
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 0xffffffff ? n : null;
}
export const SEED_HINT = tDynamic("goal.seed.hint");

/** Stable comparator over (index, result) pairs. Failures are extinctions, impossibles and budget exhaustion. */
export function compareResults(sort: ResultSort): (a: [number, TrialResult], b: [number, TrialResult]) => number {
  const hit = (r: TrialResult) => r.reachedTick !== null;
  const steps = (r: TrialResult) => (r.reachedTick !== null ? r.reachedTick - r.startTick : r.ticks);
  return ([ia, a], [ib, b]) => {
    let d = 0;
    switch (sort) {
      case "hit-fast": d = Number(hit(b)) - Number(hit(a)) || (hit(a) ? steps(a) - steps(b) : steps(a) - steps(b)); break;
      case "hit-slow": d = Number(hit(b)) - Number(hit(a)) || (hit(a) ? steps(b) - steps(a) : steps(b) - steps(a)); break;
      case "fail-fast": d = Number(hit(a)) - Number(hit(b)) || steps(a) - steps(b); break;
      case "fail-slow": d = Number(hit(a)) - Number(hit(b)) || steps(b) - steps(a); break;
      case "value-desc": d = b.finalValue - a.finalValue; break;
      case "pop-desc": d = b.finalPopulation - a.finalPopulation; break;
      case "launch": d = 0; break;
    }
    return d || ia - ib;
  };
}



const SWEEP_LABEL: Record<SweepVariable, string> = {
  mutationRate: tDynamic("goal.sweep.var.mutationRate"),
  maxPopulation: tDynamic("goal.sweep.var.maxPopulation"),
  reproduceEnergy: tDynamic("goal.sweep.var.reproduceEnergy"),
  toxinScale: tDynamic("goal.sweep.var.toxinScale"),
  nutrientScale: tDynamic("goal.sweep.var.nutrientScale"),
  temperatureScale: tDynamic("goal.sweep.var.temperatureScale"),
  lightScale: tDynamic("goal.sweep.var.lightScale"),
};

interface GoalTemplate {
  id: string;
  label: string;
  metric: string;
  fieldMin?: number;
  op: ">=" | "<=";
  target: number;
  sustain: number;
}

const TEMPLATES: GoalTemplate[] = [
  { id: "toxin", label: tDynamic("goal.template.toxin"), metric: "share:toxin", fieldMin: 0.3, op: ">=", target: 0.5, sustain: 10 },
  { id: "resist", label: tDynamic("goal.template.resist"), metric: "trait:resist:mean", op: ">=", target: 0.5, sustain: 5 },
  { id: "heat", label: tDynamic("goal.template.heat"), metric: "share:temperature", fieldMin: 0.8, op: ">=", target: 0.3, sustain: 10 },
  { id: "photo", label: tDynamic("goal.template.photo"), metric: "trait:photo:mean", op: ">=", target: 0.6, sustain: 5 },
  { id: "pop", label: tDynamic("goal.template.pop"), metric: "population", op: ">=", target: 300, sustain: 1 },
  { id: "diversity", label: tDynamic("goal.template.diversity"), metric: "shannon", op: ">=", target: 2, sustain: 20 },
];

function metricOptions(strains: Strain[]): string {
  const g = (label: string, items: string) => `<optgroup label="${label}">${items}</optgroup>`;
  const traits = TRAIT_NAMES.filter((t) => t !== "hue").map((t) => `<option value="trait:${t}:mean">${tDynamic("goal.metric.trait.mean", { trait: TRAIT_LABEL[t] })}</option><option value="trait:${t}:max">${tDynamic("goal.metric.trait.max", { trait: TRAIT_LABEL[t] })}</option>`).join("");
  const fields = FIELD_NAMES.map((f) => `<option value="share:${f}">${tDynamic("goal.metric.field.share", { field: FIELD_LABEL[f] })}</option>`).join("");
  const strainOpts = strains.map((s) => `<option value="strain-share:${s.id}">${tDynamic("goal.metric.strain.share", { strain: s.name })}</option><option value="strain-count:${s.id}">${tDynamic("goal.metric.strain.count", { strain: s.name })}</option>`).join("");
  return (
    g(tDynamic("goal.metric.group.population"), `<option value="population">${tDynamic("goal.metric.population")}</option><option value="lineages">${tDynamic("goal.metric.lineages")}</option><option value="shannon">${tDynamic("goal.metric.shannon")}</option><option value="meanFitness">${tDynamic("goal.metric.meanFitness")}</option>`) +
    g(tDynamic("goal.metric.group.field"), fields) +
    g(tDynamic("goal.metric.group.trait"), traits) +
    (strainOpts ? g(tDynamic("goal.metric.group.strain"), strainOpts) : "")
  );
}

export function parseMetric(value: string, fieldMin: number): GoalMetric | null {
  const [kind, a, b] = value.split(":");
  switch (kind) {
    case "population": return { kind: "population" };
    case "lineages": return { kind: "lineages" };
    case "shannon": return { kind: "shannon" };
    case "meanFitness": return { kind: "meanFitness" };
    case "trait":
      if (!(TRAIT_NAMES as readonly string[]).includes(a ?? "")) return null;
      return { kind: "trait", trait: a as TraitName, stat: b === "max" ? "max" : "mean" };
    case "share":
      if (!(FIELD_NAMES as readonly string[]).includes(a ?? "")) return null;
      return { kind: "share-in-field", field: a as FieldName, min: fieldMin };
    case "strain-share": return { kind: "strain-share", strainId: Number(a) };
    case "strain-count": return { kind: "strain-count", strainId: Number(a) };
    default: return null;
  }
}

export function describeGoal(goal: Goal, strains: Strain[]): string {
  const m = goal.metric;
  const name = (id: number) => strains.find((s) => s.id === id)?.name ?? tDynamic("goal.goal.strainFallback", { id });
  const what =
    m.kind === "population" ? tDynamic("goal.goal.population")
      : m.kind === "lineages" ? tDynamic("goal.goal.lineages")
        : m.kind === "shannon" ? tDynamic("goal.goal.shannon")
          : m.kind === "meanFitness" ? tDynamic("goal.goal.meanFitness")
            : m.kind === "trait" ? tDynamic(m.stat === "max" ? "goal.metric.trait.max" : "goal.metric.trait.mean", { trait: TRAIT_LABEL[m.trait] })
              : m.kind === "share-in-field" ? tDynamic("goal.goal.share", { field: FIELD_LABEL[m.field], min: m.min })
                : m.kind === "strain-share" ? tDynamic("goal.goal.strainShare", { strain: name(m.strainId) })
                  : tDynamic("goal.goal.strainCount", { strain: name(m.strainId) });
  const sustain = goal.sustain > 1 ? tDynamic("goal.goal.sustain", { count: goal.sustain }) : "";
  return `${what} ${goal.op === ">=" ? "≥" : "≤"} ${goal.target}${sustain}`;
}

function template(): string {
  return `
    <section class="block" id="preset-block">
      <div class="section-heading"><h2>${tDynamic("goal.preset.title")}</h2><span class="tag">${tDynamic("goal.preset.tag")}</span></div>
      <p class="muted">${tDynamic("goal.preset.hint")}</p>
      <div class="row"><input id="preset-name" type="text" placeholder="${tDynamic("goal.preset.name")}" maxlength="40"><button type="button" id="btn-preset-save" class="primary">${icon("save")}${tDynamic("goal.preset.save")}</button></div>
      <div id="preset-list" class="feed preset-list"></div>
    </section>
    <section class="block" id="recipe-block">
      <div class="section-heading"><h2>${tDynamic("goal.recipe.title")}</h2><span class="tag" id="recipe-ops">${tDynamic("goal.recipe.ops.many", { n: 0 })}</span></div>
      <p class="muted">${tDynamic("goal.recipe.hint")}</p>
      <label class="toggle-inline" id="opt-recipe-record"><input type="checkbox" checked> ${tDynamic("goal.recipe.record")}</label>
      <div class="row recipe-ops">
        <button type="button" id="btn-recipe-copy">${icon("share")}${tDynamic("goal.recipe.copy")}</button>
        <button type="button" id="btn-recipe-export">${icon("save")}${tDynamic("goal.recipe.export")}</button>
        <button type="button" id="btn-recipe-import">${tDynamic("goal.recipe.import")}</button>
        <button type="button" id="btn-recipe-replay">${tDynamic("goal.recipe.replay")}</button>
      </div>
      <input id="recipe-file" type="file" accept="application/json,.json" hidden>
    </section>
    <section class="block" id="goal-block">
      <div class="section-heading"><h2>${tDynamic("goal.block.title")}</h2><span class="tag">${tDynamic("goal.block.tag")}</span></div>
      <p class="muted">${tDynamic("goal.block.hint")}</p>

      <div class="goal-step">
        <span class="eyebrow">${tDynamic("goal.step.source")}</span>
        <select id="goal-source"><option value="current">${tDynamic("goal.source.current")}</option></select>
      </div>

      <div class="goal-step">
        <span class="eyebrow">${tDynamic("goal.step.goal")}</span>
        <select id="goal-example"><option value="">${tDynamic("goal.example.placeholder")}</option>${TEMPLATES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}</select>
        <label class="tiny" for="goal-metric">${tDynamic("goal.metric.label")}</label>
        <select id="goal-metric"></select>
        <div id="goal-field-min-row" class="goal-field">
          <label class="tiny" for="goal-field-min">${tDynamic("goal.metric.fieldMin")}</label>
          <input id="goal-field-min" type="number" step="0.05" min="0" value="0.3">
        </div>
        <label class="tiny">${tDynamic("goal.metric.condition")}</label>
        <div class="goal-row">
          <select id="goal-op" aria-label="${tDynamic("goal.metric.compare")}"><option value=">=">≥</option><option value="<=">≤</option></select>
          <input id="goal-target" type="number" step="0.05" value="0.5" aria-label="${tDynamic("goal.metric.target")}">
          <span class="tiny">${tDynamic("goal.metric.sustained")}</span><input id="goal-sustain" type="number" min="1" max="500" step="1" value="10" aria-label="${tDynamic("goal.metric.sustainAria")}"><span class="tiny">${tDynamic("goal.metric.steps")}</span>
        </div>
        <div id="goal-text" class="micro"></div>
        <div class="row goal-row-ops"><button type="button" id="btn-goal-add">${tDynamic("goal.metric.add")}</button></div>
        <div id="goal-extra"></div>
        <p class="micro">${tDynamic("goal.metric.limit")}</p>
      </div>

      <div class="goal-step">
        <span class="eyebrow">${tDynamic("goal.step.config")}</span>
        <div class="goal-config">
          <label>${tDynamic("goal.config.replicates")}<input id="goal-reps" type="number" min="1" max="5000" step="1" value="6"></label>
          <label>${tDynamic("goal.config.maxTicks")}<input id="goal-max" type="number" min="10" max="20000" step="10" value="600"></label>
          <label>${tDynamic("goal.config.mutationRate")}<input id="goal-mut" type="number" min="0" max="1" step="0.01"></label>
          <label>${tDynamic("goal.config.maxPopulation")}<input id="goal-popmax" type="number" min="16" max="20000" step="10"></label>
          <label>${tDynamic("goal.config.seed")}<input id="goal-seed" type="text" inputmode="numeric" pattern="[0-9]*" spellcheck="false"></label>
          <label class="goal-check"><input id="goal-disturb" type="checkbox"> ${tDynamic("goal.config.disturbances")}</label>
        </div>
        <p class="micro">${tDynamic("goal.config.hint")}</p>
        <div id="manifest-note" class="goal-manifest-note replay-info" hidden></div>
        <div class="row"><button type="button" id="btn-goal-run" class="primary">${icon("play")}${tDynamic("goal.run.start")}</button><button type="button" id="btn-goal-stop" disabled>${tDynamic("goal.run.stop")}</button><button type="button" id="btn-goal-csv" class="quiet" disabled>${icon("save")}CSV</button></div>
        <div class="row"><button type="button" id="btn-goal-det">${tDynamic("goal.run.determinism")}</button><span id="goal-det-result" class="micro"></span></div>
        <div id="goal-progress" class="goal-progress"></div>
      </div>

      <div class="goal-step">
        <span class="eyebrow">${tDynamic("goal.step.results")}</span>
        <div class="row"><button type="button" id="btn-goal-report" class="quiet" disabled>${icon("save")}${tDynamic("goal.results.report")}</button><button type="button" id="btn-goal-keep" class="quiet" disabled>${icon("save")}${tDynamic("goal.results.keep")}</button></div>
        <div id="goal-summary" class="goal-summary"></div>
        <div class="chart-card goal-chart"><div class="chart-heading"><h3>${tDynamic("goal.results.chart")}</h3><span id="goal-chart-note"></span></div><canvas id="chart-goal" role="img" aria-label="${tDynamic("goal.results.chartAria")}"></canvas></div>
        <div class="goal-table-head"><label class="tiny" for="goal-sort">${tDynamic("goal.results.sort")}</label><select id="goal-sort">${RESULT_SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}</select><span id="goal-table-note" class="tiny"></span></div>
        <div id="goal-results" class="goal-results"></div>
      </div>

      <div class="goal-step" id="history-step">
        <span class="eyebrow">${tDynamic("goal.history.title")}</span>
        <p class="micro">${tDynamic("goal.history.hint")}</p>
        <div id="history-body" class="history-body"></div>
        <div class="chart-card goal-chart"><div class="chart-heading"><h3>${tDynamic("goal.history.chart")}</h3><span class="micro" id="history-chart-note"></span></div><canvas id="chart-history" role="img" aria-label="${tDynamic("goal.history.chartAria")}"></canvas></div>
      </div>

      <div class="goal-step" id="replay-step">
        <span class="eyebrow">${tDynamic("goal.step.replay")}</span>
        <p class="micro">${tDynamic("goal.replay.hint")}</p>
        <div class="row replay-row"><input id="replay-seed" type="text" inputmode="numeric" pattern="[0-9]*" spellcheck="false" placeholder="${tDynamic("goal.replay.seed")}"><button type="button" id="btn-replay-seed" class="primary">${icon("play")}${tDynamic("goal.replay.run")}</button><button type="button" id="btn-catalog-seed">${icon("inspect")}${tDynamic("goal.replay.catalog")}</button></div>
        <div id="replay-info" class="replay-info" hidden></div>
      </div>

      <div class="section-heading" style="margin-top:18px"><h2>${tDynamic("goal.sweep.title")}</h2><span class="tag">${tDynamic("goal.sweep.tag")}</span></div>
      <p class="muted">${tDynamic("goal.sweep.hint")}</p>
      <label class="tiny" for="sweep-var">${tDynamic("goal.sweep.variable")}</label>
      <select id="sweep-var">${SWEEP_VARIABLES.map((v) => `<option value="${v}"${v === "toxinScale" ? " selected" : ""}>${SWEEP_LABEL[v]}</option>`).join("")}</select>
      <div class="goal-config">
        <label>${tDynamic("goal.sweep.from")}<input id="sweep-from" type="number" step="0.05" value="0.25"></label>
        <label>${tDynamic("goal.sweep.to")}<input id="sweep-to" type="number" step="0.05" value="2"></label>
        <label>${tDynamic("goal.sweep.points")}<input id="sweep-steps" type="number" min="2" max="16" step="1" value="5"></label>
        <label>${tDynamic("goal.sweep.perValue")}<input id="sweep-reps" type="number" min="1" max="500" step="1" value="4"></label>
      </div>
      <div class="row"><button type="button" id="btn-sweep-run">${icon("play")}${tDynamic("goal.sweep.run")}</button><button type="button" id="btn-sweep-csv" class="quiet" disabled>${icon("save")}${tDynamic("goal.sweep.csv")}</button></div>
      <div id="sweep-table"></div>
      <div class="chart-card goal-chart"><div class="chart-heading"><h3>${tDynamic("goal.sweep.chart")}</h3><span id="sweep-chart-note"></span></div><canvas id="chart-sweep" role="img" aria-label="${tDynamic("goal.sweep.chartAria")}"></canvas></div>
    </section>
    <section class="block" id="tournament-block">
      <div class="section-heading"><h2>${tDynamic("goal.tournament.title")}</h2><span class="tag">${tDynamic("goal.tournament.tag")}</span></div>
      <p class="muted">${tDynamic("goal.tournament.hint")}</p>
      <div id="tournament-picks" class="tournament-picks"></div>
      <div class="goal-config">
        <label>${tDynamic("goal.tournament.perPair")}<input id="tournament-reps" type="number" min="1" max="50" step="1" value="4"></label>
        <label>${tDynamic("goal.tournament.maxTicks")}<input id="tournament-max" type="number" min="10" max="5000" step="10" value="400"></label>
      </div>
      <div class="row"><button type="button" id="btn-tournament-run">${icon("play")}${tDynamic("goal.tournament.run")}</button><button type="button" id="btn-tournament-csv" class="quiet" disabled>${icon("save")}CSV</button></div>
      <div id="tournament-progress" class="goal-progress"></div>
      <div id="tournament-matrix"></div>
    </section>`;
}

function escapeGoalHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

export class GoalPanel {
  readonly root: HTMLElement;
  private readonly opts: GoalPanelOptions;
  private readonly q: <T extends HTMLElement>(sel: string) => T;
  readonly store = new PresetStore();
  private presets: PresetMeta[] = [];
  private handle: RunHandle | null = null;
  private results: TrialResult[] = [];
  private progress: number[] = [];
  private lastGoal: Goal | null = null;
  private lastGoals: Goal[] = [];
  private extraGoals: Goal[] = [];
  private static readonly MAX_GOALS = 4;
  private static readonly MAX_TOURNAMENT = 4;
  private tournamentNames: string[] = [];
  private tournamentSummary: TournamentSummary | null = null;
  private tournamentPickKey = "";
  /** Start state and configs of the last run or sweep, for exact replays. */
  private lastRun: { snapshot: WorldSnapshot; label: string; configs: TrialConfig[] } | null = null;
  /** Manifest loaded from a file: while set, it specifies the next run and is returned by manifest(). */
  private imported: Manifest | null = null;
  private lastStrains: Strain[] = [];
  private lastMetricKey = "";
  private sweepPoints: SweepPoint[] = [];
  private sweepVar: SweepVariable = "toxinScale";

  constructor(root: HTMLElement, opts: GoalPanelOptions) {
    this.root = root;
    this.opts = opts;
    root.innerHTML = template();
    this.q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.bind();
    this.refreshMetricOptions(true);
    this.syncDefaults();
    this.refreshRecipe();
    void this.refreshPresets().then(() => this.restoreLastRun());
  }

  /* ---------- persistence of the last run (survives a reload) ---------- */

  private async persistRun(results: TrialResult[], maxTicks: number): Promise<void> {
    if (!this.lastRun || !this.lastGoal) return;
    // Keep the table and replays, not the per-replicate final worlds; keep curves for an even sample only.
    const stride = Math.max(1, Math.ceil(results.length / MAX_CHART_SERIES));
    const slim = results.map((r, i) => {
      const { snapshot: _s, ...rest } = r;
      return i % stride === 0 ? rest : { ...rest, series: [] };
    });
    try {
      await this.store.saveLastRun({
        savedAt: Date.now(),
        label: this.lastRun.label,
        snapshot: this.lastRun.snapshot,
        goal: this.lastGoal,
        goals: this.lastGoals.length ? this.lastGoals : [this.lastGoal],
        configs: this.lastRun.configs,
        results: slim,
        maxTicks,
      });
    } catch {
      /* storage unavailable: the run simply is not restored after a reload */
    }
  }

  private async restoreLastRun(): Promise<void> {
    if (this.handle || this.results.some(Boolean)) return;
    const rec = await this.store.loadLastRun();
    if (!rec || !rec.results.length) return;
    this.lastRun = { snapshot: rec.snapshot, label: rec.label, configs: rec.configs };
    this.lastGoal = rec.goal;
    this.lastGoals = rec.goals?.length ? rec.goals : [rec.goal];
    this.results = rec.results.slice();
    this.progress = rec.results.map((r) => r.ticks);
    this.renderProgress(rec.maxTicks);
    this.lastTableRender = 0;
    this.renderResults();
    this.q<HTMLButtonElement>("#btn-goal-csv").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-report").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-keep").disabled = false;
    const when = new Date(rec.savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    this.q("#goal-table-note").textContent = tDynamic("goal.restore.note", { count: rec.results.length, when, label: rec.label });
    this.opts.status(tDynamic("goal.restore.status", { count: rec.results.length, label: rec.label, when }));
  }

  /** Called on the UI refresh cadence: keep strain-based options and defaults fresh. */
  refresh(): void {
    if (this.root.closest("[role=tabpanel]")?.hasAttribute("hidden")) return;
    this.refreshMetricOptions(false);
    void this.refreshTournamentPicks();
    const src = this.q<HTMLSelectElement>("#goal-source");
    const w = this.opts.world();
    src.options[0]!.textContent = tDynamic("goal.source.currentMeta", { world: this.opts.activeWorld(), tick: w.tick, population: w.organisms.length });
    this.refreshRecipe();
  }

  layout(): void {
    this.drawChart();
    this.drawSweepChart();
  }

  private syncDefaults(): void {
    const w = this.opts.world();
    this.q<HTMLInputElement>("#goal-seed").value = String((w.params.seed ^ 0x5bd1e995) >>> 0 || 1);
    this.q<HTMLInputElement>("#goal-mut").value = String(w.params.mutationRate);
    this.q<HTMLInputElement>("#goal-popmax").value = String(w.params.maxPopulation);
    this.q<HTMLInputElement>("#goal-disturb").checked = w.disturbances;
    this.updateGoalText();
  }

  private refreshMetricOptions(force: boolean): void {
    const strains = [...this.opts.world().strains.values()];
    const key = strains.map((s) => `${s.id}:${s.name}`).join("|");
    if (!force && key === this.lastMetricKey) return;
    this.lastMetricKey = key;
    this.lastStrains = strains;
    const sel = this.q<HTMLSelectElement>("#goal-metric");
    const prev = sel.value;
    sel.innerHTML = metricOptions(strains);
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else if (!prev) sel.value = "share:toxin";
    this.toggleFieldMin();
    if (this.extraGoals.length) this.renderExtraGoals();
  }

  private toggleFieldMin(): void {
    const isShare = this.q<HTMLSelectElement>("#goal-metric").value.startsWith("share:");
    this.q("#goal-field-min-row").hidden = !isShare;
  }

  currentGoal(): Goal | null {
    const metric = parseMetric(this.q<HTMLSelectElement>("#goal-metric").value, Number(this.q<HTMLInputElement>("#goal-field-min").value) || 0);
    if (!metric) return null;
    const target = Number(this.q<HTMLInputElement>("#goal-target").value);
    if (!Number.isFinite(target)) return null;
    return {
      metric,
      op: this.q<HTMLSelectElement>("#goal-op").value === "<=" ? "<=" : ">=",
      target,
      sustain: Math.max(1, Math.round(Number(this.q<HTMLInputElement>("#goal-sustain").value) || 1)),
    };
  }

  /** Builder goal plus the extra list, capped at 4. */
  currentGoals(): Goal[] | null {
    const g = this.currentGoal();
    if (!g) return null;
    return [g, ...this.extraGoals].slice(0, GoalPanel.MAX_GOALS);
  }

  private addExtraGoal(): void {
    const g = this.currentGoal();
    if (!g) {
      this.opts.status(tDynamic("goal.status.incomplete"));
      return;
    }
    if (this.extraGoals.length >= GoalPanel.MAX_GOALS - 1) {
      this.opts.status(tDynamic("goal.status.maxGoals"));
      return;
    }
    this.extraGoals.push(g);
    this.renderExtraGoals();
    this.updateGoalText();
  }

  private renderExtraGoals(): void {
    const host = this.q("#goal-extra");
    const add = this.q<HTMLButtonElement>("#btn-goal-add");
    add.disabled = this.extraGoals.length >= GoalPanel.MAX_GOALS - 1;
    if (!this.extraGoals.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = this.extraGoals
      .map((g, i) => `<div class="goal-extra-row" data-i="${i}"><b>${tDynamic("goal.extra.heading", { n: i + 2 })}</b><span>${describeGoal(g, this.lastStrains)}</span><button type="button" class="quiet" data-remove-goal="${i}" aria-label="${tDynamic("goal.extra.remove", { n: i + 2 })}">×</button></div>`)
      .join("");
  }

  private updateGoalText(): void {
    const g = this.currentGoal();
    const n = 1 + this.extraGoals.length;
    this.q("#goal-text").textContent = g
      ? n > 1
        ? tDynamic("goal.goalText.multi", {
          first: describeGoal(g, this.lastStrains),
          others: tDynamic(this.extraGoals.length > 1 ? "goal.goalText.others.many" : "goal.goalText.others.one", { count: this.extraGoals.length }),
        })
        : tDynamic("goal.goalText.single", { goal: describeGoal(g, this.lastStrains) })
      : tDynamic("goal.goalText.incomplete");
  }

  private applyTemplate(id: string): void {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    this.q<HTMLSelectElement>("#goal-metric").value = t.metric;
    if (t.fieldMin !== undefined) this.q<HTMLInputElement>("#goal-field-min").value = String(t.fieldMin);
    this.q<HTMLSelectElement>("#goal-op").value = t.op;
    this.q<HTMLInputElement>("#goal-target").value = String(t.target);
    this.q<HTMLInputElement>("#goal-sustain").value = String(t.sustain);
    this.toggleFieldMin();
    this.updateGoalText();
  }

  /* ---------- presets ---------- */

  async refreshPresets(): Promise<void> {
    this.presets = await this.store.list();
    const list = this.q("#preset-list");
    if (this.presets.length === 0) {
      list.innerHTML = `<p class="muted">${tDynamic("goal.preset.empty")}</p>`;
    } else {
      list.innerHTML = this.presets
        .map((p) => `<div class="feed-row preset-row" data-id="${p.id}">
            <div class="feed-head"><b>${p.name.replace(/</g, "&lt;")}</b></div>
            <div class="muted">${tDynamic("goal.preset.meta", { world: p.world, tick: p.tick, population: p.population, width: p.width, height: p.height, date: new Date(p.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) })}</div>
            <div class="row preset-ops"><button type="button" data-act="load" data-id="${p.id}">${tDynamic("goal.preset.load")}</button><button type="button" data-act="target" data-id="${p.id}">${tDynamic("goal.preset.target")}</button><button type="button" class="quiet" data-act="remove" data-id="${p.id}" aria-label="${tDynamic("goal.preset.remove")}">×</button></div>
          </div>`)
        .join("");
    }
    const src = this.q<HTMLSelectElement>("#goal-source");
    const prev = src.value;
    src.innerHTML = `<option value="current">${tDynamic("goal.source.current")}</option>` + this.presets.map((p) => `<option value="${p.id}">${tDynamic("goal.preset.option", { name: p.name.replace(/</g, "&lt;"), tick: p.tick })}</option>`).join("");
    if ([...src.options].some((o) => o.value === prev)) src.value = prev;
    this.refresh();
  }

  private async savePreset(): Promise<void> {
    const w = this.opts.world();
    const name = this.q<HTMLInputElement>("#preset-name").value.trim();
    const meta = await this.store.save(name, w.snapshot(), this.opts.activeWorld());
    this.q<HTMLInputElement>("#preset-name").value = "";
    await this.refreshPresets();
    this.q<HTMLSelectElement>("#goal-source").value = meta.id;
    this.opts.status(tDynamic("goal.preset.saved", { name: meta.name, population: meta.population, tick: meta.tick }));
  }

  private async startSnapshot(): Promise<{ snapshot: WorldSnapshot; label: string } | null> {
    const id = this.q<HTMLSelectElement>("#goal-source").value;
    if (id === "current") return { snapshot: this.opts.world().snapshot(), label: tDynamic("goal.source.label", { world: this.opts.activeWorld() }) };
    const rec = await this.store.load(id);
    if (!rec) {
      this.opts.status(tDynamic("goal.preset.missing"));
      return null;
    }
    return { snapshot: rec.snapshot, label: rec.name };
  }

  /* ---------- imported manifest ---------- */

  /**
   * The import controls live in the data row of layout.ts, outside the panel
   * root but inside the same tab panel. Missing controls (a bare panel in a
   * test) simply leave the wiring unbound instead of throwing.
   */
  private sectionEl<T extends HTMLElement>(sel: string): T | null {
    const scope = this.root.closest<HTMLElement>("#panel-experiment");
    return (scope ?? this.root.ownerDocument).querySelector<T>(sel);
  }

  /**
   * Adopt a manifest as the specification of the next run; the configuration
   * fields are ignored until it is cleared. Errors are reported, never thrown.
   */
  async loadManifest(text: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (err) {
      this.opts.status(tDynamic("goal.manifest.invalid", { reason: err instanceof Error ? err.message : String(err) }));
      return;
    }
    const { manifest, errors } = validateManifest(raw);
    if (!manifest) {
      this.opts.status(tDynamic("goal.manifest.invalid", { reason: errors[0]! }));
      return;
    }
    this.imported = manifest;
    this.renderManifestNote();
    this.opts.status(tDynamic("goal.manifest.loaded", { name: manifest.name, replicates: manifest.run.replicates, goals: manifest.goals.length }));
  }

  /** Banner above the run buttons: what the manifest holds, and any engine drift. */
  private renderManifestNote(): void {
    const box = this.q("#manifest-note");
    const manifest = this.imported;
    if (!manifest) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const drift = engineDrift(manifest.engine, engineInfo());
    box.innerHTML = tDynamic("goal.manifest.note", {
      name: escapeGoalHtml(manifest.name),
      replicates: manifest.run.replicates,
      goals: manifest.goals.length,
      digest: escapeGoalHtml(manifest.paramsDigest),
      drift: drift ? ` · <span class="warn">${drift}</span>` : "",
    }) + `<div class="row"><button type="button" id="btn-manifest-clear">${tDynamic("goal.manifest.clear")}</button></div>`;
    box.hidden = false;
  }

  /** Drop the imported manifest: the panel's own configuration drives runs again. */
  private clearManifest(): void {
    if (!this.imported) return;
    this.imported = null;
    this.renderManifestNote();
    this.refresh();
    this.opts.status(tDynamic("goal.manifest.cleared"));
  }

  /** A run needs organisms to evolve: report and refuse an empty start world. */
  private refuseEmptyStart(snapshot: WorldSnapshot): boolean {
    if (snapshot.organisms.length > 0) return false;
    this.opts.status(tDynamic("goal.status.emptyStart"));
    return true;
  }

  /* ---------- runs ---------- */

  private async run(): Promise<void> {
    if (this.handle) return;
    const imported = this.imported;
    const goals = imported ? imported.goals : this.currentGoals();
    const goal = goals?.[0] ?? null;
    if (!goal || !goals) {
      this.opts.status(tDynamic("goal.status.incomplete"));
      return;
    }
    let snapshot: WorldSnapshot;
    let label: string;
    let configs: TrialConfig[];
    let maxTicks: number;
    let clampNote = "";
    if (imported) {
      // An imported manifest is authoritative: the configuration fields above are ignored.
      snapshot = startSnapshot(imported);
      if (this.refuseEmptyStart(snapshot)) return;
      label = imported.name;
      const reps = Math.max(1, Math.min(MAX_REPLICATES, Math.round(imported.run.replicates)));
      if (reps < imported.run.replicates) {
        clampNote = tDynamic("goal.manifest.clamped", { limit: MAX_REPLICATES, reps });
      }
      configs = configsForManifest(reps < imported.run.replicates ? { ...imported, run: { ...imported.run, replicates: reps } } : imported);
      maxTicks = configs[0]?.maxTicks ?? imported.run.maxTicks;
    } else {
      const start = await this.startSnapshot();
      if (!start) return;
      snapshot = start.snapshot;
      if (this.refuseEmptyStart(snapshot)) return;
      label = start.label;
      const reps = Math.max(1, Math.min(MAX_REPLICATES, Math.round(Number(this.q<HTMLInputElement>("#goal-reps").value) || 1)));
      maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
      const seed = parseSeed(this.q<HTMLInputElement>("#goal-seed").value);
      if (seed === null) {
        this.opts.status(SEED_HINT);
        this.q("#goal-seed").focus();
        return;
      }
      const mutationRate = Math.max(0, Math.min(1, Number(this.q<HTMLInputElement>("#goal-mut").value)));
      const maxPopulation = Math.max(16, Math.round(Number(this.q<HTMLInputElement>("#goal-popmax").value) || 16));
      const disturbances = this.q<HTMLInputElement>("#goal-disturb").checked;
      const sampleEvery = Math.max(1, Math.round(maxTicks / 80));
      configs = replicateSeeds(seed, reps).map((s, i) => ({
        seed: s,
        maxTicks,
        sampleEvery,
        overrides: { mutationRate, maxPopulation, disturbances },
        keepSnapshot: i < 8,
      }));
    }
    const reps = configs.length;
    this.lastGoal = goal;
    this.lastGoals = goals;
    this.lastRun = { snapshot, label, configs };
    this.results = new Array(reps);
    this.progress = new Array(reps).fill(0);
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-csv").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-report").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-keep").disabled = true;
    this.q("#goal-summary").innerHTML = "";
    this.q("#goal-results").innerHTML = "";
    this.renderProgress(maxTicks);
    const goalList = goals.map((g, i) => `${goals.length > 1 ? `${i + 1}. ` : ""}${describeGoal(g, this.lastStrains)}`).join(" · ");
    this.opts.status(imported
      ? tDynamic("goal.manifest.launched", { reps, name: label, goals: goalList, clamp: clampNote })
      : tDynamic("goal.status.launched", { reps, label, goals: goalList }));
    const t0 = performance.now();
    this.handle = runReplicates(snapshot, goals.length === 1 ? goal : goals, configs, {
      onProgress: (i, tick) => {
        this.progress[i] = tick - snapshot.tick;
        this.scheduleRender(maxTicks, false);
      },
      onResult: (i, r) => {
        this.results[i] = r;
        this.progress[i] = r.ticks;
        this.scheduleRender(maxTicks, true);
      },
    });
    const all = await this.handle.promise;
    this.handle = null;
    this.cancelScheduledRender();
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-csv").disabled = all.length === 0;
    this.q<HTMLButtonElement>("#btn-goal-report").disabled = all.length === 0;
    // A finished run can be kept in the journal without a reload.
    this.q<HTMLButtonElement>("#btn-goal-keep").disabled = all.length === 0;
    this.renderProgress(maxTicks);
    this.lastTableRender = 0;
    this.renderResults();
    void this.persistRun(all, maxTicks);
    const s = summarizeTrials(all);
    this.opts.status(tDynamic("goal.status.finished", {
      seconds: ((performance.now() - t0) / 1000).toFixed(1),
      successes: s.successes,
      n: s.n,
      target: tDynamic(goals.length > 1 ? "goal.status.allGoals" : "goal.status.theGoal"),
      median: s.medianTicks !== null ? tDynamic("goal.status.median", { ticks: s.medianTicks }) : "",
    }));
  }

  private async runSweep(): Promise<void> {
    if (this.handle) return;
    const goals = this.currentGoals();
    const goal = goals?.[0] ?? null;
    if (!goal || !goals) {
      this.opts.status(tDynamic("goal.status.incomplete"));
      return;
    }
    const start = await this.startSnapshot();
    if (!start) return;
    if (start.snapshot.organisms.length === 0) {
      this.opts.status(tDynamic("goal.status.emptyStart"));
      return;
    }
    const variable = this.q<HTMLSelectElement>("#sweep-var").value as SweepVariable;
    if (!(SWEEP_VARIABLES as readonly string[]).includes(variable)) return;
    const from = Number(this.q<HTMLInputElement>("#sweep-from").value);
    const to = Number(this.q<HTMLInputElement>("#sweep-to").value);
    const steps = Math.max(2, Math.round(Number(this.q<HTMLInputElement>("#sweep-steps").value) || 2));
    const perValue = Math.max(1, Math.min(MAX_SWEEP_REPLICATES, Math.round(Number(this.q<HTMLInputElement>("#sweep-reps").value) || 1)));
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      this.opts.status(tDynamic("goal.sweep.status.bounds"));
      return;
    }
    const values = sweepValues(from, to, steps);
    const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
    const seed = Math.round(Number(this.q<HTMLInputElement>("#goal-seed").value)) >>> 0 || 1;
    const mutationRate = Math.max(0, Math.min(1, Number(this.q<HTMLInputElement>("#goal-mut").value)));
    const maxPopulation = Math.max(16, Math.round(Number(this.q<HTMLInputElement>("#goal-popmax").value) || 16));
    const disturbances = this.q<HTMLInputElement>("#goal-disturb").checked;
    const sampleEvery = Math.max(1, Math.round(maxTicks / 80));
    const configs = sweepConfigs(
      { seed, maxTicks, sampleEvery, overrides: { mutationRate, maxPopulation, disturbances }, keepSnapshot: false },
      variable,
      values,
      perValue,
    );
    this.sweepVar = variable;
    this.lastGoal = goal;
    this.lastGoals = goals;
    this.lastRun = { snapshot: start.snapshot, label: start.label, configs };
    this.results = new Array(configs.length);
    this.progress = new Array(configs.length).fill(0);
    this.sweepPoints = [];
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
    this.q<HTMLButtonElement>("#btn-sweep-csv").disabled = true;
    this.q("#sweep-table").innerHTML = "";
    this.renderProgress(maxTicks);
    this.opts.status(tDynamic("goal.sweep.status.launched", { variable: SWEEP_LABEL[variable], values: values.length, replicates: perValue }));
    const t0 = performance.now();
    this.handle = runReplicates(start.snapshot, goals.length === 1 ? goal : goals, configs, {
      onProgress: (i, tick) => {
        this.progress[i] = tick - start.snapshot.tick;
        this.scheduleRender(maxTicks, false);
      },
      onResult: (i, r) => {
        this.results[i] = r;
        this.progress[i] = r.ticks;
        this.scheduleRender(maxTicks, false);
      },
    });
    const all = await this.handle.promise;
    this.handle = null;
    this.cancelScheduledRender();
    this.renderProgress(maxTicks);
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
    const grouped = values.map((_, vi) => all.slice(vi * perValue, (vi + 1) * perValue).filter(Boolean));
    this.sweepPoints = summarizeSweep(values, grouped);
    this.q<HTMLButtonElement>("#btn-sweep-csv").disabled = this.sweepPoints.length === 0;
    this.renderSweepTable();
    this.drawSweepChart();
    this.opts.status(tDynamic("goal.sweep.status.done", { seconds: ((performance.now() - t0) / 1000).toFixed(1), values: values.length }));
  }

  private renderSweepTable(): void {
    const host = this.q("#sweep-table");
    if (!this.sweepPoints.length) {
      host.innerHTML = "";
      return;
    }
    const fmt = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
    host.innerHTML = `<table class="sweep-table"><thead><tr><th>${tDynamic("goal.sweep.table.value")}</th><th>${tDynamic("goal.sweep.table.success")}</th><th>${tDynamic("goal.sweep.table.median")}</th><th>${tDynamic("goal.sweep.table.range")}</th><th>${tDynamic("goal.sweep.table.extinctions")}</th></tr></thead><tbody>${
      this.sweepPoints.map((p) => {
        const s = p.summary;
        const range = s.minTicks === null ? "—" : `${s.minTicks}–${s.maxTicks}`;
        return `<tr><td class="mono">${p.value.toPrecision(4)}</td><td>${s.successes}/${s.n}</td><td>${fmt(s.medianTicks)}</td><td>${range}</td><td>${s.extinctions}</td></tr>`;
      }).join("")
    }</tbody></table>`;
  }

  private drawSweepChart(): void {
    const canvas = this.q<HTMLCanvasElement>("#chart-sweep");
    const cw = canvas.parentElement!.clientWidth - 28;
    if (cw <= 0) return;
    drawSweep(canvas, cw, 120, this.sweepPoints.map((p) => ({
      value: p.value,
      median: p.summary.medianTicks,
      min: p.summary.minTicks,
      max: p.summary.maxTicks,
    })));
    this.q("#sweep-chart-note").textContent = this.sweepPoints.length
      ? tDynamic("goal.sweep.chartNote", { variable: SWEEP_LABEL[this.sweepVar] })
      : "";
  }

  private exportSweepCsv(): void {
    const rows = [["value", "successes", "n", "success_rate", "median_ticks", "min_ticks", "max_ticks", "extinctions"]];
    for (const p of this.sweepPoints) {
      const s = p.summary;
      rows.push([
        p.value.toString(),
        String(s.successes),
        String(s.n),
        s.successRate.toFixed(4),
        s.medianTicks === null ? "" : String(s.medianTicks),
        s.minTicks === null ? "" : String(s.minTicks),
        s.maxTicks === null ? "" : String(s.maxTicks),
        String(s.extinctions),
      ]);
    }
    const text = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-sweep-${this.sweepVar}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- tournaments ---------- */

  private async refreshTournamentPicks(): Promise<void> {
    const host = this.q("#tournament-picks");
    const strains = [...this.opts.world().strains.values()];
    const saved = await this.store.listOrganisms();
    const key = strains.map((s) => `${s.id}:${s.name}`).join("|") + "#" + saved.map((o) => o.id).join("|");
    const checked = new Set([...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")].map((el) => el.value));
    if (key === this.tournamentPickKey && host.childElementCount) return;
    this.tournamentPickKey = key;
    if (!strains.length && !saved.length) {
      host.innerHTML = `<p class="muted">${tDynamic("goal.tournament.empty")}</p>`;
      return;
    }
    const strainItems = strains.map((s) => {
      const v = `strain:${s.id}`;
      return `<label class="tournament-pick"><input type="checkbox" value="${v}"${checked.has(v) ? " checked" : ""}><span class="swatch" style="background:${s.color}"></span>${s.name.replace(/</g, "&lt;")}</label>`;
    }).join("");
    const savedItems = saved.map((o) => {
      const v = `org:${o.id}`;
      return `<label class="tournament-pick"><input type="checkbox" value="${v}"${checked.has(v) ? " checked" : ""}>${o.name.replace(/</g, "&lt;")}<span class="tiny">${tDynamic("goal.tournament.saved")}</span></label>`;
    }).join("");
    host.innerHTML = (strainItems ? `<div class="tiny">${tDynamic("goal.tournament.strains")}</div><div class="tournament-pick-row">${strainItems}</div>` : "")
      + (savedItems ? `<div class="tiny">${tDynamic("goal.tournament.organisms")}</div><div class="tournament-pick-row">${savedItems}</div>` : "");
    this.limitTournamentPicks();
  }

  private limitTournamentPicks(): void {
    const boxes = [...this.q("#tournament-picks").querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    const n = boxes.filter((b) => b.checked).length;
    for (const b of boxes) b.disabled = !b.checked && n >= GoalPanel.MAX_TOURNAMENT;
  }

  private async selectedContestants(): Promise<TournamentContestant[] | null> {
    const values = [...this.q("#tournament-picks").querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")].map((el) => el.value);
    if (values.length < 2) {
      this.opts.status(tDynamic("goal.tournament.select"));
      return null;
    }
    const out: TournamentContestant[] = [];
    const strains = this.opts.world().strains;
    for (const v of values) {
      if (v.startsWith("strain:")) {
        const s = strains.get(Number(v.slice(7)));
        if (!s) continue;
        out.push({ name: s.name, genome: s.genome });
      } else if (v.startsWith("org:")) {
        const rec = await this.store.loadOrganism(v.slice(4));
        if (!rec) continue;
        out.push({ name: rec.name, genome: rec.entry.genome });
      }
    }
    if (out.length < 2) {
      this.opts.status(tDynamic("goal.tournament.missing"));
      return null;
    }
    return out.slice(0, GoalPanel.MAX_TOURNAMENT);
  }

  private async runTournament(): Promise<void> {
    if (this.handle) return;
    const contestants = await this.selectedContestants();
    if (!contestants) return;
    const start = await this.startSnapshot();
    if (!start) return;
    const perPair = Math.max(1, Math.min(50, Math.round(Number(this.q<HTMLInputElement>("#tournament-reps").value) || 1)));
    const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#tournament-max").value) || 400));
    const seed = parseSeed(this.q<HTMLInputElement>("#goal-seed").value) ?? (this.opts.world().params.seed >>> 0 || 1);
    const configs = tournamentConfigs(start.snapshot, contestants, perPair, seed, { maxTicks, sampleEvery: Math.max(1, Math.round(maxTicks / 80)) });
    if (!configs.length) {
      this.opts.status(tDynamic("goal.tournament.noPairs"));
      return;
    }
    this.tournamentNames = contestants.map((c) => c.name);
    this.tournamentSummary = null;
    this.q("#tournament-matrix").innerHTML = "";
    this.q<HTMLButtonElement>("#btn-tournament-csv").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-tournament-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
    const dummy: Goal = { metric: { kind: "population" }, op: ">=", target: 1e9, sustain: 1 };
    this.opts.status(tDynamic("goal.tournament.started", { contestants: contestants.length, runs: configs.length, perPair }));
    const results: TrialResult[] = new Array(configs.length);
    const render = () => {
      const done = results.filter(Boolean).length;
      this.q("#tournament-progress").innerHTML = `<div class="goal-total" role="progressbar" aria-valuemin="0" aria-valuemax="${configs.length}" aria-valuenow="${done}"><i style="width:${((done / configs.length) * 100).toFixed(1)}%"></i></div><div class="tiny">${tDynamic("goal.tournament.progress", { done, total: configs.length })}</div>`;
    };
    render();
    const t0 = performance.now();
    this.handle = runReplicates(start.snapshot, dummy, configs, {
      onResult: (i, r) => {
        results[i] = r;
        render();
      },
    });
    const all = await this.handle.promise;
    this.handle = null;
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-tournament-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
    this.tournamentSummary = summarizeTournament(all);
    this.renderTournamentMatrix();
    this.q<HTMLButtonElement>("#btn-tournament-csv").disabled = this.tournamentSummary.cells.length === 0;
    render();
    this.opts.status(tDynamic("goal.tournament.done", { seconds: ((performance.now() - t0) / 1000).toFixed(1), pairs: this.tournamentSummary.cells.length }));
  }

  private renderTournamentMatrix(): void {
    const host = this.q("#tournament-matrix");
    const s = this.tournamentSummary;
    const names = this.tournamentNames;
    if (!s || !names.length) {
      host.innerHTML = "";
      return;
    }
    const cellAt = (i: number, j: number) => s.cells.find((c) => c.i === i && c.j === j) ?? s.cells.find((c) => c.i === j && c.j === i);
    const heads = names.map((n) => `<th>${n.replace(/</g, "&lt;")}</th>`).join("");
    const rows = names.map((name, i) => {
      const tds = names.map((_, j) => {
        if (i === j) return `<td class="diag">—</td>`;
        const cell = cellAt(Math.min(i, j), Math.max(i, j));
        if (!cell) return `<td class="miss">—</td>`;
        const winsRow = i === cell.i ? cell.winsI : cell.winsJ;
        const winsCol = i === cell.i ? cell.winsJ : cell.winsI;
        const share = i === cell.i ? cell.meanShareI : cell.meanShareJ;
        const rate = cell.n ? winsRow / cell.n : 0.5;
        const alpha = Math.min(0.55, Math.abs(rate - 0.5) * 1.4 + (cell.draws === cell.n ? 0 : 0));
        const color = rate > 0.5 ? `rgba(62, 180, 137, ${alpha})` : rate < 0.5 ? `rgba(196, 92, 106, ${alpha})` : `rgba(125, 146, 163, 0.18)`;
        return `<td style="background:${color}" title="${tDynamic("goal.tournament.share", { share: share.toFixed(2) })}">${winsRow}–${winsCol}${cell.draws ? `<span class="tiny">${tDynamic("goal.tournament.draws", { count: cell.draws })}</span>` : ""}</td>`;
      }).join("");
      return `<tr><th>${name.replace(/</g, "&lt;")}</th>${tds}</tr>`;
    }).join("");
    host.innerHTML = `<table class="tournament-matrix"><thead><tr><th></th>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  private exportTournamentCsv(): void {
    const s = this.tournamentSummary;
    if (!s) return;
    const names = this.tournamentNames;
    const rows = [["row", "col", "wins_row", "wins_col", "draws", "mean_share_row", "mean_share_col"]];
    for (const c of s.cells) {
      rows.push([
        names[c.i] ?? String(c.i),
        names[c.j] ?? String(c.j),
        String(c.winsI),
        String(c.winsJ),
        String(c.draws),
        c.meanShareI.toFixed(4),
        c.meanShareJ.toFixed(4),
      ]);
    }
    const text = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-tournament-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private renderTimer: number | null = null;
  private renderMax = 0;
  private resultsDirty = false;
  private sort: ResultSort = "hit-fast";
  private lastTableRender = 0;

  /** Coalesce progress/result events: at most one DOM update per RENDER_INTERVAL_MS. */
  private scheduleRender(maxTicks: number, results: boolean): void {
    this.renderMax = maxTicks;
    if (results) this.resultsDirty = true;
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.renderProgress(this.renderMax);
      if (this.resultsDirty) {
        this.resultsDirty = false;
        this.renderResults();
      }
    }, RENDER_INTERVAL_MS);
  }

  private cancelScheduledRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    this.resultsDirty = false;
  }

  private renderProgress(maxTicks: number): void {
    const host = this.q("#goal-progress");
    const total = this.progress.length;
    if (!total) {
      host.innerHTML = "";
      return;
    }
    let done = 0;
    let hit = 0;
    let dead = 0;
    let unreachable = 0;
    let running = 0;
    const active: string[] = [];
    for (let i = 0; i < total; i++) {
      const r = this.results[i];
      if (r) {
        done++;
        if (r.reachedTick !== null) hit++;
        else if (r.extinct) dead++;
        else if (r.unreachable) unreachable++;
      } else if (this.progress[i]! > 0) {
        running++;
        if (active.length < 16) active.push(`<span class="goal-bar" title="${tDynamic("goal.progress.replicate", { n: i + 1 })}"><i style="width:${Math.min(100, (this.progress[i]! / maxTicks) * 100).toFixed(0)}%"></i></span>`);
      }
    }
    const pct = (done / total) * 100;
    host.innerHTML = `<div class="goal-total" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="tiny goal-progress-text">${done}/${total} ${tDynamic("goal.progress.done")} · <span class="hit">${hit} ${tDynamic("goal.progress.hit")}</span> · ${done - hit - dead - unreachable} ${tDynamic("goal.progress.missed")} · <span class="dead">${dead} ${tDynamic("goal.progress.dead")}</span>${unreachable ? ` · ${unreachable} ${tDynamic("goal.progress.unreachable")}` : ""}${running ? ` · ${running} ${tDynamic("goal.progress.running")}` : ""}</div>
      ${active.length ? `<div class="goal-active">${active.join("")}</div>` : ""}`;
  }

  private renderResults(): void {
    const done = this.results.filter(Boolean);
    const goal = this.lastGoal;
    if (!goal) return;
    const s = summarizeTrials(done);
    const fmtT = (v: number | null) => (v === null ? "—" : tDynamic("goal.table.stepCount", { value: Math.round(v) }));
    const perGoalHtml = s.perGoal.length > 1
      ? s.perGoal.map((g, i) => `<span>${tDynamic("goal.summary.goal", { n: i + 1 })}<b>${g.successes}/${s.n}${g.medianTicks !== null ? tDynamic("goal.summary.medianShort", { ticks: Math.round(g.medianTicks) }) : ""}</b></span>`).join("")
      : "";
    this.q("#goal-summary").innerHTML = done.length
      ? `<div class="goal-stats">
          <span>${tDynamic("goal.summary.success")}<b>${s.successes}/${s.n}</b></span>
          <span>${tDynamic("goal.summary.median")}<b>${fmtT(s.medianTicks)}</b></span>
          <span>${tDynamic("goal.summary.iqr")}<b>${s.p25Ticks === null ? "—" : `${Math.round(s.p25Ticks)} – ${Math.round(s.p75Ticks!)}`}</b></span>
          <span>${tDynamic("goal.summary.range")}<b>${s.minTicks === null ? "—" : `${s.minTicks} – ${s.maxTicks}`}</b></span>
          <span>${tDynamic("goal.summary.extinctions")}<b>${s.extinctions}</b></span>
          <span>${tDynamic("goal.summary.unreachable")}<b>${s.unreachable}</b></span>
          ${perGoalHtml}
        </div>${this.successSeedsHtml()}`
      : "";
    const now = performance.now();
    if (!this.handle || now - this.lastTableRender > TABLE_INTERVAL_MS) {
      this.lastTableRender = now;
      this.renderTable();
    }
    this.drawChart();
  }

  /** Every replicate, sorted; rebuilt as one HTML string so 5000 rows stay a single DOM write. */
  private renderTable(): void {
    const pairs: Array<[number, TrialResult]> = [];
    this.results.forEach((r, i) => {
      if (r) pairs.push([i, r]);
    });
    const host = this.q("#goal-results");
    if (!pairs.length) {
      host.innerHTML = "";
      this.q("#goal-table-note").textContent = "";
      return;
    }
    pairs.sort(compareResults(this.sort));
    const nGoals = Math.max(1, this.lastGoals.length);
    const pasHeads = nGoals > 1
      ? this.lastGoals.map((_, gi) => `<th class="num">${tDynamic("goal.table.stepsHeadN", { n: gi + 1 })}</th>`).join("")
      : `<th class="num">${tDynamic("goal.table.stepsHead")}</th>`;
    const cells = pairs.map(([i, r]) => {
      const ticks = trialGoalTicks(r);
      const steps = r.reachedTick !== null ? r.reachedTick - r.startTick : r.ticks;
      const outcome = r.reachedTick !== null
        ? `<span class="hit">${tDynamic("goal.table.hit")}</span>`
        : r.extinct ? `<span class="dead">${tDynamic("goal.table.extinct")}</span>`
          : r.unreachable ? `<span class="dead">${tDynamic("goal.table.unreachable")}</span>`
            : `<span class="miss">${tDynamic("goal.table.miss")}</span>`;
      const pasCells = nGoals > 1
        ? Array.from({ length: nGoals }, (_, gi) => {
            const t = ticks[gi];
            return `<td class="mono num">${t === null || t === undefined ? "—" : t - r.startTick}</td>`;
          }).join("")
        : `<td class="mono num">${steps}</td>`;
      const open = r.snapshot ? `<button type="button" class="quiet" data-open="${i}" title="${tDynamic("goal.table.finalTitle")}">${tDynamic("goal.table.final")}</button>` : "";
      return `<tr><td class="mono">${i + 1}</td><td class="mono seed" data-replay-seed="${r.seed}" title="${tDynamic("goal.table.replaySeedTitle")}">${r.seed}</td><td>${outcome}</td>${pasCells}<td class="mono num">${r.finalValue.toFixed(3)}</td><td class="mono num">${r.finalPopulation}</td><td class="ops"><button type="button" data-replay="${i}" title="${tDynamic("goal.table.replayTitle")}">${icon("play")}</button><button type="button" data-catalog="${i}" title="${tDynamic("goal.table.catalogTitle")}">${icon("inspect")}</button>${open}</td></tr>`;
    });
    host.innerHTML = `<div class="goal-table-wrap"><table class="goal-table"><thead><tr><th>#</th><th>${tDynamic("goal.table.seed")}</th><th>${tDynamic("goal.table.outcome")}</th>${pasHeads}<th class="num">${tDynamic("goal.table.value")}</th><th class="num">${tDynamic("goal.table.pop")}</th><th></th></tr></thead><tbody>${cells.join("")}</tbody></table></div>`;
    this.q("#goal-table-note").textContent = tDynamic(pairs.length > 1 ? "goal.count.replicate.many" : "goal.count.replicate.one", { count: pairs.length });
  }

  private drawChart(): void {
    const canvas = this.q<HTMLCanvasElement>("#chart-goal");
    const cw = canvas.parentElement!.clientWidth - 28;
    if (cw <= 0) return;
    const all = this.results.filter(Boolean);
    // Draw an even sample so a thousand replicates stay legible and cheap.
    const stride = Math.max(1, Math.ceil(all.length / MAX_CHART_SERIES));
    const runs = all.filter((_, i) => i % stride === 0).map((r) => ({ series: r.series, reached: r.reachedTick !== null }));
    drawTrialSeries(canvas, cw, 120, runs, this.lastGoal?.target ?? null);
    this.q("#goal-chart-note").textContent = all.length
      ? tDynamic("goal.chart.target", {
        count: tDynamic(all.length > 1 ? "goal.count.replicate.many" : "goal.count.replicate.one", { count: all.length }),
        sampled: runs.length < all.length ? tDynamic("goal.chart.sampled", { count: runs.length }) : "",
      })
      : "";
  }

  private async checkDeterminism(): Promise<void> {
    if (this.handle) {
      this.opts.status(tDynamic("goal.status.running"));
      return;
    }
    const goals = this.currentGoals();
    const goal = goals?.[0] ?? null;
    if (!goal || !goals) {
      this.opts.status(tDynamic("goal.status.incomplete"));
      return;
    }
    const start = await this.startSnapshot();
    if (!start) return;
    if (start.snapshot.organisms.length === 0) {
      this.opts.status(tDynamic("goal.status.emptyStart"));
      return;
    }
    const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
    const seed = parseSeed(this.q<HTMLInputElement>("#goal-seed").value);
    if (seed === null) {
      this.opts.status(SEED_HINT);
      return;
    }
    const mutationRate = Math.max(0, Math.min(1, Number(this.q<HTMLInputElement>("#goal-mut").value)));
    const maxPopulation = Math.max(16, Math.round(Number(this.q<HTMLInputElement>("#goal-popmax").value) || 16));
    const disturbances = this.q<HTMLInputElement>("#goal-disturb").checked;
    const config: TrialConfig = {
      seed,
      maxTicks,
      sampleEvery: Math.max(1, Math.round(maxTicks / 80)),
      overrides: { mutationRate, maxPopulation, disturbances },
      keepSnapshot: true,
    };
    const host = this.q("#goal-det-result");
    host.textContent = tDynamic("goal.det.running");
    this.q<HTMLButtonElement>("#btn-goal-det").disabled = true;
    this.handle = runReplicates(start.snapshot, goals.length === 1 ? goal : goals, [{ ...config }, { ...config }]);
    const pair = await this.handle.promise;
    this.handle = null;
    this.q<HTMLButtonElement>("#btn-goal-det").disabled = false;
    const a = pair[0]?.snapshot;
    const b = pair[1]?.snapshot;
    if (!a || !b) {
      host.innerHTML = `<span class="dead">${tDynamic("goal.det.missing")}</span>`;
      return;
    }
    const ha = worldFromSnapshot(a).hashState();
    const hb = worldFromSnapshot(b).hashState();
    if (ha === hb) {
      host.innerHTML = `<span class="hit">${tDynamic("goal.det.identical")} <span class="mono">${ha}</span></span>`;
      this.opts.status(tDynamic("goal.det.same", { hash: ha }));
    } else {
      host.innerHTML = `<span class="dead">✗ <span class="mono">${ha}</span> ≠ <span class="mono">${hb}</span></span>`;
      this.opts.status(tDynamic("goal.det.differs", { a: ha, b: hb }));
    }
  }

  /**
   * Manifest of the last run (start state, goals, replicate plan) or null when
   * nothing has run yet. The headless runner consumes it unchanged.
   */
  manifest(): Manifest | null {
    if (this.imported) return this.imported;
    if (!this.lastRun || this.lastGoals.length === 0) return null;
    const config = this.lastRun.configs[0];
    return makeManifest({
      name: this.lastRun.label,
      params: this.lastRun.snapshot.params,
      start: { kind: "snapshot", snapshot: this.lastRun.snapshot },
      schedule: this.lastRun.snapshot.schedule ?? [],
      goals: asGoals(this.lastGoals),
      run: {
        replicates: Math.max(1, this.lastRun.configs.length),
        seed: config?.seed ?? this.lastRun.snapshot.params.seed,
        maxTicks: config?.maxTicks ?? 100,
        sampleEvery: config?.sampleEvery ?? 1,
        ...(config?.overrides ? { overrides: config.overrides } : {}),
        ...(config?.overrides?.recordEvents ? { recordEvents: true } : {}),
      },
    });
  }

  /* ---------- experiment journal ---------- */

  private historyRecords: ExperimentRecord[] = [];
  private historySelected: string[] = [];

  /** Store the last finished run, then refresh the list. */
  private async keepLastRun(): Promise<void> {
    const results = this.results.filter(Boolean) as TrialResult[];
    const manifest = this.manifest();
    if (!this.lastRun || results.length === 0 || !manifest) {
      this.opts.status(tDynamic("goal.history.noneToKeep"));
      return;
    }
    const record = recordFromRun({ manifest, results, summary: summarizeTrials(results) });
    await this.store.saveExperiment(record);
    this.historySelected = [record.id];
    this.opts.status(tDynamic("goal.history.kept", { name: record.name, count: record.results.length }));
    await this.refreshHistory();
  }

  /** Reload the stored runs and redraw the history table. */
  async refreshHistory(): Promise<void> {
    try {
      this.historyRecords = await this.store.listExperiments();
    } catch {
      this.historyRecords = [];
    }
    this.historySelected = this.historySelected.filter((id) => this.historyRecords.some((r) => r.id === id));
    this.renderHistory();
  }

  private download(name: string, text: string): void {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private renderHistory(): void {
    const body = this.q("#history-body");
    if (this.historyRecords.length === 0) {
      body.innerHTML = `<p class="muted">${tDynamic("goal.history.empty")}</p>`;
      return;
    }
    const rows = historyRows(this.historyRecords, {
      ...(this.historySelected[0] ? { referenceId: this.historySelected[0] } : {}),
      current: engineInfo(),
    });
    const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
    const span = (ci: [number, number] | null) => (ci ? `[${ci[0].toFixed(2)} – ${ci[1].toFixed(2)}]` : "—");
    const header = `<tr><th></th><th>${tDynamic("goal.history.run")}</th><th>n</th><th>${tDynamic("goal.history.success")}</th><th>${tDynamic("goal.history.medianSteps")}</th><th>${tDynamic("goal.history.effect")}</th><th></th></tr>`;
    const bodyRows = rows
      .map((row) => {
        const picked = this.historySelected.includes(row.id);
        const finalSnap = this.historyRecords.find((r) => r.id === row.id)?.results[0]?.snapshot;
        const effect = row.effect
          ? `Δ ${row.effect.medianShift === null ? "—" : row.effect.medianShift.toFixed(1)} · δ ${row.effect.cliffsDelta.toFixed(2)} · g ${row.effect.hedgesG.toFixed(2)}`
          : tDynamic("goal.history.reference");
        return `<tr class="${picked ? "picked" : ""}">
          <td><input type="checkbox" data-history-pick="${row.id}" ${picked ? "checked" : ""} aria-label="${tDynamic("goal.history.compare")}"></td>
          <td><b>${escapeGoalHtml(row.name)}</b><div class="micro">${row.createdAt.slice(0, 16).replace("T", " ")}${row.engineMismatch ? ` · <span class="warn">${row.engineMismatch}</span>` : ""}</div>
            <input type="text" class="history-note" data-history-note="${row.id}" placeholder="${tDynamic("goal.history.note")}" value="${escapeGoalHtml(this.historyRecords.find((r) => r.id === row.id)?.notes ?? "")}"></td>
          <td>${row.n}</td>
          <td>${row.successes}/${row.n} · ${pct(row.successRate)}<div class="micro">${tDynamic("goal.history.ci", { low: pct(row.successRateCI[0]), high: pct(row.successRateCI[1]) })}</div></td>
          <td>${row.medianTicks === null ? "—" : row.medianTicks.toFixed(1)}<div class="micro">IC ${span(row.medianTicksCI)}</div></td>
          <td class="micro">${effect}</td>
          <td><button type="button" class="quiet" data-history-replay="${row.id}" title="${tDynamic("goal.history.replayTitle")}">${tDynamic("goal.history.replay")}</button>${finalSnap ? `<button type="button" class="quiet" data-history-open="${row.id}" title="${tDynamic("goal.history.openTitle")}">B</button>` : ""}<button type="button" class="quiet" data-history-manifest="${row.id}" title="${tDynamic("goal.history.manifestTitle")}">${tDynamic("goal.history.manifest")}</button>
            <button type="button" class="quiet" data-history-remove="${row.id}" title="${tDynamic("goal.history.removeTitle")}">×</button></td>
        </tr>`;
      })
      .join("");
    body.innerHTML = `<table class="history-table">${header}${bodyRows}</table>`;

    // Overlay the stored curves of the selected runs (12 replicates each).
    const chart = this.q<HTMLCanvasElement>("#chart-history");
    const picked = this.historySelected
      .map((id) => this.historyRecords.find((r) => r.id === id))
      .filter((r): r is ExperimentRecord => Boolean(r));
    const runs: TrialRun[] = picked.flatMap((record) =>
      record.curves.slice(0, 12).map((curve) => ({
        series: curve.values.map((value, i) => [i, value] as [number, number]),
        reached: curve.reached,
      })),
    );
    try {
      drawTrialSeries(chart, Math.max(120, chart.parentElement!.clientWidth - 28), 120, runs, null);
    } catch {
      // A chart failure must never take the panel down (no canvas context, etc.).
    }
    this.q("#history-chart-note").textContent = picked.length
      ? tDynamic("goal.history.chartNote", { runs: picked.length, curves: runs.length })
      : tDynamic("goal.history.chartHint");
  }

  /** Rebuild the first replicate of a stored run from its own manifest, into world B. */
  private replayRecord(record: ExperimentRecord, index = 0): void {
    const config = configsForManifest(record.manifest)[index];
    if (!config) {
      this.opts.status(tDynamic("goal.replay.emptyManifest"));
      return;
    }
    const world = worldForTrial(startSnapshot(record.manifest), config);
    this.opts.replayInto(world.snapshot());
    this.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
    const known = record.results[index];
    const expected = known
      ? known.reachedTick !== null
        ? tDynamic("goal.replay.hit", { step: known.reachedTick - known.startTick })
        : tDynamic("goal.replay.miss", { ticks: known.ticks })
      : tDynamic("goal.replay.noReference");
    this.showReplayInfo(tDynamic("goal.replay.historyInfo", { name: record.name, tick: world.tick, population: world.organisms.length, seed: config.seed, expected }));
    this.opts.status(tDynamic("goal.replay.historyStatus", { n: index + 1, name: record.name }));
  }

  private async exportHistoryManifest(id: string): Promise<void> {
    const record = this.historyRecords.find((r) => r.id === id);
    if (!record) return;
    this.download(`openavida-${record.id}.json`, JSON.stringify(record.manifest, null, 2));
    this.opts.status(tDynamic("goal.history.manifestExported", { name: record.name }));
  }

  private async updateHistoryNote(id: string, notes: string): Promise<void> {
    const record = this.historyRecords.find((r) => r.id === id);
    if (!record) return;
    record.notes = notes;
    await this.store.saveExperiment(record);
  }

  private async removeHistory(id: string): Promise<void> {
    await this.store.removeExperiment(id);
    this.historySelected = this.historySelected.filter((x) => x !== id);
    await this.refreshHistory();
  }

  private async exportReport(): Promise<void> {
    if (!this.lastRun || !this.lastGoal) {
      this.opts.status(tDynamic("goal.report.none"));
      return;
    }
    const done = this.results.filter(Boolean);
    if (!done.length) {
      this.opts.status(tDynamic("goal.report.empty"));
      return;
    }
    let chartPng: string | undefined;
    try {
      chartPng = this.q<HTMLCanvasElement>("#chart-goal").toDataURL("image/png");
    } catch {
      chartPng = undefined;
    }
    const extras = this.opts.reportExtras();
    const genomes = new Set((this.lastRun.snapshot.strains ?? []).map((s) => s.genome));
    for (const o of this.lastRun.snapshot.organisms) genomes.add(o.genome);
    const saved = [];
    for (const meta of await this.store.listOrganisms()) {
      const rec = await this.store.loadOrganism(meta.id);
      if (rec && genomes.has(rec.entry.genome)) saved.push({ name: rec.name, genome: rec.entry.genome, strainName: rec.strainName });
    }
    const goals = this.lastGoals.length ? this.lastGoals : [this.lastGoal];
    const html = buildReportHtml({
      generatedAt: new Date().toLocaleString("fr-FR"),
      startLabel: this.lastRun.label,
      params: this.lastRun.snapshot.params,
      recipeOps: recipeFromWorld(this.opts.world()).ops,
      schedule: this.lastRun.snapshot.schedule ?? [],
      goals,
      goalLabels: goals.map((g) => describeGoal(g, this.lastStrains)),
      summary: summarizeTrials(done),
      results: done,
      maxTicks: this.lastRun.configs[0]?.maxTicks ?? 0,
      chartPng,
      treePng: extras.treePng ?? undefined,
      saved,
    });
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-rapport-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.opts.status(tDynamic("goal.report.done", { count: done.length }));
  }

  private exportCsv(): void {
    const nGoals = Math.max(1, this.lastGoals.length);
    const extra = nGoals > 1 ? this.lastGoals.map((_, gi) => `reached_tick_${gi + 1}`) : [];
    const rows = [["replicate", "seed", "reached_tick", ...extra, "ticks_run", "final_value", "final_population", "extinct", "unreachable"]];
    this.results.forEach((r, i) => {
      if (!r) return;
      const ticks = trialGoalTicks(r);
      const extraVals = nGoals > 1
        ? this.lastGoals.map((_, gi) => {
            const t = ticks[gi];
            return t === null || t === undefined ? "" : String(t - r.startTick);
          })
        : [];
      rows.push([
        String(i + 1),
        String(r.seed),
        r.reachedTick === null ? "" : String(r.reachedTick - r.startTick),
        ...extraVals,
        String(r.ticks),
        r.finalValue.toFixed(4),
        String(r.finalPopulation),
        r.extinct ? "1" : "0",
        r.unreachable ? "1" : "0",
      ]);
    });
    const text = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-goal-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private refreshRecipe(): void {
    const w = this.opts.world();
    const n = w.recording?.length ?? 0;
    this.q("#recipe-ops").textContent = tDynamic(n > 1 ? "goal.recipe.ops.many" : "goal.recipe.ops.one", { n });
    const box = this.q<HTMLInputElement>("#opt-recipe-record input");
    if (document.activeElement !== box) box.checked = w.recording !== null;
  }

  private recipe(): Recipe {
    return recipeFromWorld(this.opts.world());
  }

  private async copyRecipeLink(): Promise<void> {
    const { url, truncated } = buildRecipeShareURL(this.recipe());
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      this.opts.status(url);
      return;
    }
    if (truncated) {
      this.opts.status(tDynamic("goal.recipe.tooLong"));
    } else {
      this.opts.status(tDynamic("goal.recipe.copied"));
      try { history.replaceState(null, "", "?" + url.split("?")[1]); } catch { /* ignore */ }
    }
  }

  private exportRecipe(): void {
    const text = JSON.stringify(this.recipe());
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-recipe-t${this.opts.world().tick}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.opts.status(tDynamic("goal.recipe.exported"));
  }

  private importRecipeFile(file: File): void {
    void file.text().then((text) => {
      const recipe = parseRecipe(JSON.parse(text) as unknown);
      if (!recipe) {
        this.opts.status(tDynamic("goal.recipe.invalid"));
        return;
      }
      this.opts.applyRecipe(recipe, "active");
      this.opts.status(tDynamic("goal.recipe.imported", { actions: tDynamic(recipe.ops.length > 1 ? "goal.recipe.action.many" : "goal.recipe.action.one", { count: recipe.ops.length }) }));
    }).catch(() => this.opts.status(tDynamic("goal.recipe.unreadable")));
  }

  private bind(): void {
    this.q("#btn-preset-save").addEventListener("click", () => void this.savePreset());
    this.q<HTMLInputElement>("#opt-recipe-record input").addEventListener("change", (ev) => {
      this.opts.setRecording((ev.target as HTMLInputElement).checked);
      this.refreshRecipe();
    });
    this.q("#btn-recipe-copy").addEventListener("click", () => void this.copyRecipeLink());
    this.q("#btn-recipe-export").addEventListener("click", () => this.exportRecipe());
    this.q("#btn-recipe-import").addEventListener("click", () => this.q("#recipe-file").click());
    this.q<HTMLInputElement>("#recipe-file").addEventListener("change", (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      (ev.target as HTMLInputElement).value = "";
      if (file) this.importRecipeFile(file);
    });
    this.q("#btn-recipe-replay").addEventListener("click", () => {
      const recipe = this.recipe();
      this.opts.applyRecipe(recipe, "B");
      this.opts.status(tDynamic("goal.recipe.replayed", { actions: tDynamic(recipe.ops.length > 1 ? "goal.recipe.action.many" : "goal.recipe.action.one", { count: recipe.ops.length }) }));
    });
    this.q("#preset-list").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id!;
      const act = btn.dataset.act;
      if (act === "target") {
        this.q<HTMLSelectElement>("#goal-source").value = id;
        this.opts.status(tDynamic("goal.preset.selected"));
      } else if (act === "load") {
        void this.store.load(id).then((rec) => {
          if (!rec) return;
          this.opts.restoreInto("active", rec.snapshot);
          this.opts.status(tDynamic("goal.preset.loaded", { name: rec.name, world: this.opts.activeWorld() }));
        });
      } else if (act === "remove") {
        void this.store.remove(id).then(() => this.refreshPresets());
      }
    });
    this.q("#goal-example").addEventListener("change", (ev) => {
      this.applyTemplate((ev.target as HTMLSelectElement).value);
      (ev.target as HTMLSelectElement).value = "";
    });
    this.q("#goal-metric").addEventListener("change", () => {
      this.toggleFieldMin();
      this.updateGoalText();
    });
    for (const id of ["#goal-field-min", "#goal-op", "#goal-target", "#goal-sustain"]) this.q(id).addEventListener("input", () => this.updateGoalText());
    this.q("#btn-goal-add").addEventListener("click", () => this.addExtraGoal());
    this.q("#goal-extra").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-remove-goal]");
      if (!btn) return;
      const i = Number(btn.dataset.removeGoal);
      if (!Number.isInteger(i)) return;
      this.extraGoals.splice(i, 1);
      this.renderExtraGoals();
      this.updateGoalText();
    });
    this.q("#btn-goal-run").addEventListener("click", () => void this.run());
    this.q("#btn-sweep-run").addEventListener("click", () => void this.runSweep());
    this.q("#btn-goal-stop").addEventListener("click", () => {
      this.handle?.cancel();
      this.opts.status(tDynamic("goal.status.stopped"));
    });
    this.q("#btn-goal-csv").addEventListener("click", () => this.exportCsv());
    this.q("#btn-goal-report").addEventListener("click", () => void this.exportReport());
    this.q("#btn-goal-keep").addEventListener("click", () => void this.keepLastRun());
    this.q("#manifest-note").addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("#btn-manifest-clear")) this.clearManifest();
    });
    const manifestFile = this.sectionEl<HTMLInputElement>("#manifest-file");
    this.sectionEl<HTMLButtonElement>("#btn-manifest-import")?.addEventListener("click", () => manifestFile?.click());
    manifestFile?.addEventListener("change", async (ev) => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        await this.loadManifest(await file.text());
      } catch (err) {
        this.opts.status(tDynamic("goal.manifest.invalid", { reason: err instanceof Error ? err.message : String(err) }));
      } finally {
        input.value = "";
      }
    });
    const historyBody = this.q("#history-body");
    historyBody.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement;
      const manifestBtn = target.closest<HTMLElement>("[data-history-manifest]");
      if (manifestBtn?.dataset.historyManifest) {
        void this.exportHistoryManifest(manifestBtn.dataset.historyManifest);
        return;
      }
      const removeBtn = target.closest<HTMLElement>("[data-history-remove]");
      if (removeBtn?.dataset.historyRemove) {
        void this.removeHistory(removeBtn.dataset.historyRemove);
        return;
      }
      const replayBtn = target.closest<HTMLElement>("[data-history-replay]");
      if (replayBtn?.dataset.historyReplay) {
        const record = this.historyRecords.find((r) => r.id === replayBtn.dataset.historyReplay);
        if (record) this.replayRecord(record);
        return;
      }
      const openBtn = target.closest<HTMLElement>("[data-history-open]");
      if (openBtn?.dataset.historyOpen) {
        const record = this.historyRecords.find((r) => r.id === openBtn.dataset.historyOpen);
        const snapshot = record?.results[0]?.snapshot;
        if (record && snapshot) {
          this.opts.restoreInto("B", snapshot);
          this.opts.status(tDynamic("goal.history.opened", { name: record.name }));
        } else {
          this.opts.status(tDynamic("goal.history.noFinalState"));
        }
      }
    });
    historyBody.addEventListener("change", (ev) => {
      const target = ev.target as HTMLInputElement;
      if (target.dataset.historyPick) {
        const id = target.dataset.historyPick;
        this.historySelected = target.checked
          ? [...this.historySelected.filter((x) => x !== id), id].slice(-4)
          : this.historySelected.filter((x) => x !== id);
        this.renderHistory();
        return;
      }
      if (target.dataset.historyNote) void this.updateHistoryNote(target.dataset.historyNote, target.value);
    });
    void this.refreshHistory();
    this.q("#btn-goal-det").addEventListener("click", () => void this.checkDeterminism());
    this.q("#btn-sweep-csv").addEventListener("click", () => this.exportSweepCsv());
    this.q("#tournament-picks").addEventListener("change", () => this.limitTournamentPicks());
    this.q("#btn-tournament-run").addEventListener("click", () => void this.runTournament());
    this.q("#btn-tournament-csv").addEventListener("click", () => this.exportTournamentCsv());
    this.q("#goal-sort").addEventListener("change", (ev) => {
      this.sort = (ev.target as HTMLSelectElement).value as ResultSort;
      this.renderTable();
    });
    this.q("#goal-results").addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const replay = t.closest<HTMLElement>("[data-replay]");
      if (replay) {
        this.replayIndex(Number(replay.dataset.replay));
        return;
      }
      const catalog = t.closest<HTMLElement>("[data-catalog]");
      if (catalog) {
        this.catalogIndex(Number(catalog.dataset.catalog));
        return;
      }
      const seedCell = t.closest<HTMLElement>("[data-replay-seed]");
      if (seedCell) {
        this.replaySeed(Number(seedCell.dataset.replaySeed));
        return;
      }
      const btn = t.closest<HTMLElement>("[data-open]");
      if (!btn) return;
      const r = this.results[Number(btn.dataset.open)];
      if (r?.snapshot) {
        this.opts.restoreInto("B", r.snapshot);
        this.opts.status(tDynamic("goal.status.finalOpened", { n: Number(btn.dataset.open) + 1 }));
      }
    });
    this.q("#goal-summary").addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const chip = t.closest<HTMLElement>("[data-replay-seed]");
      if (chip) {
        this.replaySeed(Number(chip.dataset.replaySeed));
        return;
      }
      if (t.closest("#btn-copy-seeds")) {
        const seeds = this.results.filter((r) => r && r.reachedTick !== null).map((r) => r.seed).join(", ");
        void navigator.clipboard?.writeText(seeds).then(
          () => this.opts.status(tDynamic("goal.status.seedsCopied")),
          () => this.opts.status(seeds),
        );
      }
    });
    this.q("#btn-replay-seed").addEventListener("click", () => {
      const seed = parseSeed(this.q<HTMLInputElement>("#replay-seed").value);
      if (seed === null) {
        this.opts.status(SEED_HINT);
        this.showReplayInfo(`<span class="dead">${SEED_HINT}</span>`);
        this.q("#replay-seed").focus();
        return;
      }
      this.replaySeed(seed);
    });
    this.q("#btn-catalog-seed").addEventListener("click", () => {
      const seed = parseSeed(this.q<HTMLInputElement>("#replay-seed").value);
      if (seed === null) {
        this.opts.status(SEED_HINT);
        this.showReplayInfo(`<span class="dead">${SEED_HINT}</span>`);
        this.q("#replay-seed").focus();
        return;
      }
      this.catalogSeed(seed);
    });
    this.q("#replay-seed").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") this.q("#btn-replay-seed").click();
    });
  }

  /* ---------- replays ---------- */

  private successSeedsHtml(): string {
    const hits = this.results.filter((r) => r && r.reachedTick !== null);
    if (!hits.length) return "";
    const shown = hits.slice(0, 60);
    return `<div class="seed-chips"><span class="eyebrow">${tDynamic("goal.seeds.title")}</span>${shown
      .map((r) => `<button type="button" class="seed-chip" data-replay-seed="${r.seed}" title="${tDynamic("goal.seeds.chipTitle", { step: r.reachedTick! - r.startTick })}">${r.seed}</button>`)
      .join("")}${hits.length > shown.length ? `<span class="tiny">${tDynamic("goal.seeds.more", { count: hits.length - shown.length })}</span>` : ""}<button type="button" id="btn-copy-seeds" class="quiet">${icon("copy")}${tDynamic("goal.seeds.copy")}</button></div>`;
  }

  private replayIndex(i: number): void {
    const cfg = this.lastRun?.configs[i];
    if (!this.lastRun || !cfg) return;
    this.replay(cfg, tDynamic("goal.replay.label.replicate", { n: i + 1 }));
  }

  /** Replay a seed with the last run's start state and parameters (or the current form when nothing ran yet). */
  private replaySeed(seed: number): void {
    if (this.lastRun) {
      const exact = this.lastRun.configs.find((c) => c.seed === seed);
      const template = exact ?? this.lastRun.configs[0];
      if (!template) return;
      this.replay({ ...template, seed }, tDynamic(exact ? "goal.replay.label.seed" : "goal.replay.label.seedOffRun", { seed }));
      return;
    }
    void this.startSnapshot().then((start) => {
      if (!start) return;
      const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
      const mutationRate = Math.max(0, Math.min(1, Number(this.q<HTMLInputElement>("#goal-mut").value)));
      const maxPopulation = Math.max(16, Math.round(Number(this.q<HTMLInputElement>("#goal-popmax").value) || 16));
      const disturbances = this.q<HTMLInputElement>("#goal-disturb").checked;
      this.lastRun = { snapshot: start.snapshot, label: start.label, configs: [] };
      this.replay({ seed, maxTicks, sampleEvery: 1, overrides: { mutationRate, maxPopulation, disturbances } }, tDynamic("goal.replay.label.seed", { seed }));
    });
  }

  private replay(config: TrialConfig, label: string): void {
    if (!this.lastRun) return;
    const w = worldForTrial(this.lastRun.snapshot, config);
    this.opts.replayInto(w.snapshot());
    this.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
    const known = this.results.find((r) => r && r.seed === config.seed);
    const expected = !known
      ? tDynamic("goal.replay.seedOffRun")
      : known.reachedTick !== null
        ? tDynamic("goal.replay.detail.hit", { step: known.reachedTick - known.startTick, tick: known.reachedTick })
        : known.extinct
          ? tDynamic("goal.replay.detail.extinct", { ticks: known.ticks })
          : known.unreachable
            ? tDynamic("goal.replay.detail.unreachable", { ticks: known.ticks })
            : tDynamic("goal.replay.detail.miss", { ticks: known.ticks, value: known.finalValue.toFixed(3) });
    const o = config.overrides ?? {};
    this.showReplayInfo(tDynamic("goal.replay.info", {
      label,
      start: this.lastRun.label,
      tick: w.tick,
      population: w.organisms.length,
      seed: config.seed,
      mutation: o.mutationRate ?? w.params.mutationRate,
      popMax: o.maxPopulation ?? w.params.maxPopulation,
      disturbances: (o.disturbances ?? w.disturbances) ? tDynamic("goal.replay.yes") : tDynamic("goal.replay.no"),
      expected,
    }));
    this.opts.status(tDynamic("goal.replay.status", { label, seed: config.seed }));
  }

  /* ---------- end-state catalogue ---------- */

  /** Set while a replicate is being re-simulated: one reconstruction at a time, never two racing for world B. */
  private rebuilding = false;

  private catalogIndex(i: number): void {
    const cfg = this.lastRun?.configs[i];
    const r = this.results[i];
    if (!cfg || !r) {
      this.opts.status(tDynamic("goal.catalog.unknownConfig"));
      return;
    }
    this.catalogFor(cfg, r.ticks, tDynamic("goal.replay.label.replicate", { n: i + 1 }));
  }

  /** Catalogue for a typed seed: the recorded length when the seed ran, otherwise the full budget of the course. */
  private catalogSeed(seed: number): void {
    if (!this.lastRun) {
      this.opts.status(tDynamic("goal.catalog.noRun"));
      return;
    }
    const exact = this.lastRun.configs.find((c) => c.seed === seed);
    const template = exact ?? this.lastRun.configs[0];
    if (!template) {
      this.opts.status(tDynamic("goal.catalog.noConfig"));
      return;
    }
    const known = this.results.find((r) => r && r.seed === seed);
    this.catalogFor({ ...template, seed }, known ? known.ticks : template.maxTicks, tDynamic(exact ? "goal.replay.label.seed" : "goal.replay.label.seedOffRun", { seed }));
  }

  /**
   * Rebuild a replicate from the last run's start state, step it to its recorded end, and hand that
   * end state to the explorer. Stepping is chunked with a zero timeout so the page stays responsive.
   */
  private catalogFor(config: TrialConfig, ticks: number, label: string): void {
    const run = this.lastRun;
    if (!run) {
      this.opts.status(tDynamic("goal.catalog.noRun"));
      return;
    }
    if (this.rebuilding) {
      this.opts.status(tDynamic("goal.catalog.rebuilding"));
      return;
    }
    const total = Math.max(0, Math.round(ticks));
    const w = worldForTrial(run.snapshot, config);
    this.rebuilding = true;
    this.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
    const o = config.overrides ?? {};
    this.showReplayInfo(tDynamic("goal.catalog.buildingInfo", {
      label,
      start: run.label,
      tick: w.tick,
      population: w.organisms.length,
      seed: config.seed,
      mutation: o.mutationRate ?? w.params.mutationRate,
      popMax: o.maxPopulation ?? w.params.maxPopulation,
      total,
    }));
    this.opts.status(tDynamic("goal.catalog.progress", { label, done: 0, total }));
    let done = 0;
    const chunk = (): void => {
      const end = Math.min(total, done + CATALOG_CHUNK);
      try {
        // An extinct world cannot change any more: stop there, the catalogue still reads (deaths log included).
        while (done < end && w.organisms.length > 0) {
          w.step();
          done++;
        }
      } catch (err) {
        this.rebuilding = false;
        const msg = (err instanceof Error ? err.message : String(err)).replace(/</g, "&lt;");
        this.showReplayInfo(`<span class="dead">${tDynamic("goal.catalog.interrupted", { label, done, error: msg })}</span>`);
        this.opts.status(tDynamic("goal.catalog.failed", { label, done, error: msg }));
        return;
      }
      this.opts.status(tDynamic("goal.catalog.progress", { label, done, total }));
      if (done < total && w.organisms.length > 0) {
        window.setTimeout(chunk, 0);
        return;
      }
      this.rebuilding = false;
      const note = w.organisms.length > 0 ? "" : done < total ? tDynamic("goal.catalog.noteExtinct", { done, total }) : tDynamic("goal.catalog.noteNoSurvivor");
      this.showReplayInfo(tDynamic("goal.catalog.rebuiltInfo", { label, tick: w.tick, population: w.organisms.length, note }));
      this.opts.openCatalog(w.snapshot());
      this.opts.status(tDynamic("goal.catalog.rebuilt", { label, tick: w.tick }));
    };
    chunk();
  }

  private showReplayInfo(html: string): void {
    const box = this.q("#replay-info");
    box.innerHTML = html;
    box.hidden = false;
  }
}
