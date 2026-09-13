/**
 * Expérience tab shell: local presets (IndexedDB), recipes, manifest import,
 * the goal run itself, the determinism check, and the markup and wiring the
 * modules plug into. Responsibilities are split — goal builder in goalWizard,
 * last-run rendering and export in goalRunView, batch experiments in goalSweep,
 * journal and replay in goalHistoryView — while this file keeps the public API
 * and the thin delegations to them.
 */
import {
  SWEEP_VARIABLES,
  buildRecipeShareURL,
  configsForManifest,
  engineInfo,
  parseRecipe,
  recipeFromWorld,
  replicateSeeds,
  startSnapshot,
  summarizeTrials,
  validateManifest,
  worldFromSnapshot,
  type Goal,
  type Manifest,
  type Recipe,
  type TrialConfig,
  type WorldSnapshot,
} from "../sim/index";
import { runReplicates } from "./goalRunner";
import { engineDrift, type ExperimentRecord } from "./experimentHistory";
import { icon } from "./layout";
import type { PresetStore } from "./presetStore";
import { tDynamic } from "./i18n/runtime";
import { MAX_REPLICATES, escapeGoalHtml, type GoalContext, type GoalPanelOptions, createGoalContext } from "./goalContext";
import {
  SEED_HINT,
  TEMPLATES,
  addExtraGoal,
  applyTemplate,
  currentGoal,
  currentGoals,
  describeGoal,
  parseSeed,
  refreshMetricOptions,
  renderExtraGoals,
  startSnapshot as startState,
  syncDefaults,
  toggleFieldMin,
  updateGoalText,
} from "./goalWizard";
import {
  RESULT_SORTS,
  bindResults,
  cancelScheduledRender,
  drawChart,
  exportCsv,
  exportReport,
  manifestOf,
  persistRun,
  renderProgress,
  renderResults,
  restoreLastRun,
  scheduleRender,
} from "./goalRunView";
import {
  SWEEP_LABEL,
  drawSweepChart,
  exportSweepCsv,
  exportTournamentCsv,
  limitTournamentPicks,
  refreshTournamentPicks,
  runSweep,
  runTournament,
} from "./goalSweep";
import { bindHistory, bindReplay, keepLastRun, refreshHistory } from "./goalHistoryView";

export type { GoalPanelOptions, ResultSort } from "./goalContext";
export { MAX_SWEEP_REPLICATES } from "./goalContext";
export { MAX_REPLICATES };
export { compareResults, RESULT_SORTS } from "./goalRunView";
export { parseSeed, SEED_HINT, parseMetric } from "./goalWizard";

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

export class GoalPanel {
  readonly root: HTMLElement;
  private readonly ctx: GoalContext;

  constructor(root: HTMLElement, opts: GoalPanelOptions) {
    this.root = root;
    this.ctx = createGoalContext(root, opts);
    root.innerHTML = template();
    this.bind();
    refreshMetricOptions(this.ctx, true);
    syncDefaults(this.ctx);
    this.refreshRecipe();
    void this.refreshPresets().then(() => restoreLastRun(this.ctx));
  }

  /** Local preset and journal storage, shared by every module through the context. */
  get store(): PresetStore {
    return this.ctx.store;
  }

  get historyRecords(): ExperimentRecord[] {
    return this.ctx.state.historyRecords;
  }

  get historySelected(): string[] {
    return this.ctx.state.historySelected;
  }

  /** Called on the UI refresh cadence: keep strain-based options and defaults fresh. */
  refresh(): void {
    const ctx = this.ctx;
    if (this.root.closest("[role=tabpanel]")?.hasAttribute("hidden")) return;
    refreshMetricOptions(ctx, false);
    void refreshTournamentPicks(ctx);
    const src = ctx.q<HTMLSelectElement>("#goal-source");
    const w = ctx.world();
    src.options[0]!.textContent = tDynamic("goal.source.currentMeta", { world: ctx.activeWorld(), tick: w.tick, population: w.organisms.length });
    this.refreshRecipe();
  }

  layout(): void {
    drawChart(this.ctx);
    drawSweepChart(this.ctx);
  }

  currentGoal(): Goal | null {
    return currentGoal(this.ctx);
  }

  /** Builder goal plus the extra list, capped at 4. */
  currentGoals(): Goal[] | null {
    return currentGoals(this.ctx);
  }

  /* ---------- presets ---------- */

  async refreshPresets(): Promise<void> {
    const ctx = this.ctx;
    const state = ctx.state;
    state.presets = await ctx.store.list();
    const list = ctx.q("#preset-list");
    if (state.presets.length === 0) {
      list.innerHTML = `<p class="muted">${tDynamic("goal.preset.empty")}</p>`;
    } else {
      list.innerHTML = state.presets
        .map((p) => `<div class="feed-row preset-row" data-id="${p.id}">
            <div class="feed-head"><b>${p.name.replace(/</g, "&lt;")}</b></div>
            <div class="muted">${tDynamic("goal.preset.meta", { world: p.world, tick: p.tick, population: p.population, width: p.width, height: p.height, date: new Date(p.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) })}</div>
            <div class="row preset-ops"><button type="button" data-act="load" data-id="${p.id}">${tDynamic("goal.preset.load")}</button><button type="button" data-act="target" data-id="${p.id}">${tDynamic("goal.preset.target")}</button><button type="button" class="quiet" data-act="remove" data-id="${p.id}" aria-label="${tDynamic("goal.preset.remove")}">×</button></div>
          </div>`)
        .join("");
    }
    const src = ctx.q<HTMLSelectElement>("#goal-source");
    const prev = src.value;
    src.innerHTML = `<option value="current">${tDynamic("goal.source.current")}</option>` + state.presets.map((p) => `<option value="${p.id}">${tDynamic("goal.preset.option", { name: p.name.replace(/</g, "&lt;"), tick: p.tick })}</option>`).join("");
    if ([...src.options].some((o) => o.value === prev)) src.value = prev;
    this.refresh();
  }

  private async savePreset(): Promise<void> {
    const ctx = this.ctx;
    const w = ctx.world();
    const name = ctx.q<HTMLInputElement>("#preset-name").value.trim();
    const meta = await ctx.store.save(name, w.snapshot(), ctx.activeWorld());
    // A refused write reports itself through the store's problem listener; it
    // must not be followed by a success message.
    if (!meta) return;
    ctx.q<HTMLInputElement>("#preset-name").value = "";
    await this.refreshPresets();
    ctx.q<HTMLSelectElement>("#goal-source").value = meta.id;
    ctx.status(tDynamic("goal.preset.saved", { name: meta.name, population: meta.population, tick: meta.tick }));
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
    const ctx = this.ctx;
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (err) {
      ctx.status(tDynamic("goal.manifest.invalid", { reason: err instanceof Error ? err.message : String(err) }));
      return;
    }
    const { manifest, errors } = validateManifest(raw);
    if (!manifest) {
      ctx.status(tDynamic("goal.manifest.invalid", { reason: errors[0]! }));
      return;
    }
    ctx.state.imported = manifest;
    this.renderManifestNote();
    ctx.status(tDynamic("goal.manifest.loaded", { name: manifest.name, replicates: manifest.run.replicates, goals: manifest.goals.length }));
  }

  /** Banner above the run buttons: what the manifest holds, and any engine drift. */
  private renderManifestNote(): void {
    const ctx = this.ctx;
    const box = ctx.q("#manifest-note");
    const manifest = ctx.state.imported;
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
    const ctx = this.ctx;
    if (!ctx.state.imported) return;
    ctx.state.imported = null;
    this.renderManifestNote();
    this.refresh();
    ctx.status(tDynamic("goal.manifest.cleared"));
  }

  /** A run needs organisms to evolve: report and refuse an empty start world. */
  private refuseEmptyStart(snapshot: WorldSnapshot): boolean {
    if (snapshot.organisms.length > 0) return false;
    this.ctx.status(tDynamic("goal.status.emptyStart"));
    return true;
  }

  /* ---------- runs ---------- */

  private async run(): Promise<void> {
    const ctx = this.ctx;
    const state = ctx.state;
    if (state.handle) return;
    const imported = state.imported;
    const goals = imported ? imported.goals : currentGoals(ctx);
    const goal = goals?.[0] ?? null;
    if (!goal || !goals) {
      ctx.status(tDynamic("goal.status.incomplete"));
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
      const start = await startState(ctx);
      if (!start) return;
      snapshot = start.snapshot;
      if (this.refuseEmptyStart(snapshot)) return;
      label = start.label;
      const reps = Math.max(1, Math.min(MAX_REPLICATES, Math.round(Number(ctx.q<HTMLInputElement>("#goal-reps").value) || 1)));
      maxTicks = Math.max(10, Math.round(Number(ctx.q<HTMLInputElement>("#goal-max").value) || 100));
      const seed = parseSeed(ctx.q<HTMLInputElement>("#goal-seed").value);
      if (seed === null) {
        ctx.status(SEED_HINT);
        ctx.q("#goal-seed").focus();
        return;
      }
      const mutationRate = Math.max(0, Math.min(1, Number(ctx.q<HTMLInputElement>("#goal-mut").value)));
      const maxPopulation = Math.max(16, Math.round(Number(ctx.q<HTMLInputElement>("#goal-popmax").value) || 16));
      const disturbances = ctx.q<HTMLInputElement>("#goal-disturb").checked;
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
    state.lastGoal = goal;
    state.lastGoals = goals;
    state.lastRun = { snapshot, label, configs };
    state.results = new Array(reps);
    state.progress = new Array(reps).fill(0);
    ctx.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
    ctx.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
    ctx.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
    ctx.q<HTMLButtonElement>("#btn-goal-csv").disabled = true;
    ctx.q<HTMLButtonElement>("#btn-goal-report").disabled = true;
    ctx.q<HTMLButtonElement>("#btn-goal-keep").disabled = true;
    ctx.q("#goal-summary").innerHTML = "";
    ctx.q("#goal-results").innerHTML = "";
    renderProgress(ctx, maxTicks);
    const goalList = goals.map((g, i) => `${goals.length > 1 ? `${i + 1}. ` : ""}${describeGoal(g, state.lastStrains)}`).join(" · ");
    ctx.status(imported
      ? tDynamic("goal.manifest.launched", { reps, name: label, goals: goalList, clamp: clampNote })
      : tDynamic("goal.status.launched", { reps, label, goals: goalList }));
    const t0 = performance.now();
    state.handle = runReplicates(snapshot, goals.length === 1 ? goal : goals, configs, {
      onProgress: (i, tick) => {
        state.progress[i] = tick - snapshot.tick;
        scheduleRender(ctx, maxTicks, false);
      },
      onResult: (i, r) => {
        state.results[i] = r;
        state.progress[i] = r.ticks;
        scheduleRender(ctx, maxTicks, true);
      },
    });
    const all = await state.handle.promise;
    state.handle = null;
    cancelScheduledRender(ctx);
    ctx.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
    ctx.q<HTMLButtonElement>("#btn-sweep-run").disabled = false;
    ctx.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
    ctx.q<HTMLButtonElement>("#btn-goal-csv").disabled = all.length === 0;
    ctx.q<HTMLButtonElement>("#btn-goal-report").disabled = all.length === 0;
    // A finished run can be kept in the journal without a reload.
    ctx.q<HTMLButtonElement>("#btn-goal-keep").disabled = all.length === 0;
    renderProgress(ctx, maxTicks);
    state.lastTableRender = 0;
    renderResults(ctx);
    void persistRun(ctx, all, maxTicks);
    const s = summarizeTrials(all);
    ctx.status(tDynamic("goal.status.finished", {
      seconds: ((performance.now() - t0) / 1000).toFixed(1),
      successes: s.successes,
      n: s.n,
      target: tDynamic(goals.length > 1 ? "goal.status.allGoals" : "goal.status.theGoal"),
      median: s.medianTicks !== null ? tDynamic("goal.status.median", { ticks: s.medianTicks }) : "",
    }));
  }

  private async checkDeterminism(): Promise<void> {
    const ctx = this.ctx;
    const state = ctx.state;
    if (state.handle) {
      ctx.status(tDynamic("goal.status.running"));
      return;
    }
    const goals = currentGoals(ctx);
    const goal = goals?.[0] ?? null;
    if (!goal || !goals) {
      ctx.status(tDynamic("goal.status.incomplete"));
      return;
    }
    const start = await startState(ctx);
    if (!start) return;
    if (start.snapshot.organisms.length === 0) {
      ctx.status(tDynamic("goal.status.emptyStart"));
      return;
    }
    const maxTicks = Math.max(10, Math.round(Number(ctx.q<HTMLInputElement>("#goal-max").value) || 100));
    const seed = parseSeed(ctx.q<HTMLInputElement>("#goal-seed").value);
    if (seed === null) {
      ctx.status(SEED_HINT);
      return;
    }
    const mutationRate = Math.max(0, Math.min(1, Number(ctx.q<HTMLInputElement>("#goal-mut").value)));
    const maxPopulation = Math.max(16, Math.round(Number(ctx.q<HTMLInputElement>("#goal-popmax").value) || 16));
    const disturbances = ctx.q<HTMLInputElement>("#goal-disturb").checked;
    const config: TrialConfig = {
      seed,
      maxTicks,
      sampleEvery: Math.max(1, Math.round(maxTicks / 80)),
      overrides: { mutationRate, maxPopulation, disturbances },
      keepSnapshot: true,
    };
    const host = ctx.q("#goal-det-result");
    host.textContent = tDynamic("goal.det.running");
    ctx.q<HTMLButtonElement>("#btn-goal-det").disabled = true;
    state.handle = runReplicates(start.snapshot, goals.length === 1 ? goal : goals, [{ ...config }, { ...config }]);
    const pair = await state.handle.promise;
    state.handle = null;
    ctx.q<HTMLButtonElement>("#btn-goal-det").disabled = false;
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
      ctx.status(tDynamic("goal.det.same", { hash: ha }));
    } else {
      host.innerHTML = `<span class="dead">✗ <span class="mono">${ha}</span> ≠ <span class="mono">${hb}</span></span>`;
      ctx.status(tDynamic("goal.det.differs", { a: ha, b: hb }));
    }
  }

  /**
   * Manifest of the last run (start state, goals, replicate plan) or null when
   * nothing has run yet. The headless runner consumes it unchanged.
   */
  manifest(): Manifest | null {
    return manifestOf(this.ctx);
  }

  /** Reload the stored runs and redraw the history table. */
  async refreshHistory(): Promise<void> {
    await refreshHistory(this.ctx);
  }

  private refreshRecipe(): void {
    const ctx = this.ctx;
    const w = ctx.world();
    const n = w.recording?.length ?? 0;
    ctx.q("#recipe-ops").textContent = tDynamic(n > 1 ? "goal.recipe.ops.many" : "goal.recipe.ops.one", { n });
    const box = ctx.q<HTMLInputElement>("#opt-recipe-record input");
    if (document.activeElement !== box) box.checked = w.recording !== null;
  }

  private recipe(): Recipe {
    return recipeFromWorld(this.ctx.world());
  }

  private async copyRecipeLink(): Promise<void> {
    const { url, truncated } = buildRecipeShareURL(this.recipe());
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      this.ctx.status(url);
      return;
    }
    if (truncated) {
      this.ctx.status(tDynamic("goal.recipe.tooLong"));
    } else {
      this.ctx.status(tDynamic("goal.recipe.copied"));
      try { history.replaceState(null, "", "?" + url.split("?")[1]); } catch { /* ignore */ }
    }
  }

  private exportRecipe(): void {
    const text = JSON.stringify(this.recipe());
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-recipe-t${this.ctx.world().tick}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.ctx.status(tDynamic("goal.recipe.exported"));
  }

  private importRecipeFile(file: File): void {
    const ctx = this.ctx;
    void file.text().then((text) => {
      const recipe = parseRecipe(JSON.parse(text) as unknown);
      if (!recipe) {
        ctx.status(tDynamic("goal.recipe.invalid"));
        return;
      }
      ctx.applyRecipe(recipe, "active");
      ctx.status(tDynamic("goal.recipe.imported", { actions: tDynamic(recipe.ops.length > 1 ? "goal.recipe.action.many" : "goal.recipe.action.one", { count: recipe.ops.length }) }));
    }).catch(() => ctx.status(tDynamic("goal.recipe.unreadable")));
  }

  private bind(): void {
    const ctx = this.ctx;
    const q = ctx.q;
    q("#btn-preset-save").addEventListener("click", () => void this.savePreset());
    q<HTMLInputElement>("#opt-recipe-record input").addEventListener("change", (ev) => {
      ctx.setRecording((ev.target as HTMLInputElement).checked);
      this.refreshRecipe();
    });
    q("#btn-recipe-copy").addEventListener("click", () => void this.copyRecipeLink());
    q("#btn-recipe-export").addEventListener("click", () => this.exportRecipe());
    q("#btn-recipe-import").addEventListener("click", () => q("#recipe-file").click());
    q<HTMLInputElement>("#recipe-file").addEventListener("change", (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      (ev.target as HTMLInputElement).value = "";
      if (file) this.importRecipeFile(file);
    });
    q("#btn-recipe-replay").addEventListener("click", () => {
      const recipe = this.recipe();
      ctx.applyRecipe(recipe, "B");
      ctx.status(tDynamic("goal.recipe.replayed", { actions: tDynamic(recipe.ops.length > 1 ? "goal.recipe.action.many" : "goal.recipe.action.one", { count: recipe.ops.length }) }));
    });
    q("#preset-list").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id!;
      const act = btn.dataset.act;
      if (act === "target") {
        q<HTMLSelectElement>("#goal-source").value = id;
        ctx.status(tDynamic("goal.preset.selected"));
      } else if (act === "load") {
        void ctx.store.load(id).then((rec) => {
          if (!rec) return;
          ctx.restoreInto("active", rec.snapshot);
          ctx.status(tDynamic("goal.preset.loaded", { name: rec.name, world: ctx.activeWorld() }));
        });
      } else if (act === "remove") {
        void ctx.store.remove(id).then(() => this.refreshPresets());
      }
    });
    q("#goal-example").addEventListener("change", (ev) => {
      applyTemplate(ctx, (ev.target as HTMLSelectElement).value);
      (ev.target as HTMLSelectElement).value = "";
    });
    q("#goal-metric").addEventListener("change", () => {
      toggleFieldMin(ctx);
      updateGoalText(ctx);
    });
    for (const id of ["#goal-field-min", "#goal-op", "#goal-target", "#goal-sustain"]) q(id).addEventListener("input", () => updateGoalText(ctx));
    q("#btn-goal-add").addEventListener("click", () => addExtraGoal(ctx));
    q("#goal-extra").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-remove-goal]");
      if (!btn) return;
      const i = Number(btn.dataset.removeGoal);
      if (!Number.isInteger(i)) return;
      ctx.state.extraGoals.splice(i, 1);
      renderExtraGoals(ctx);
      updateGoalText(ctx);
    });
    q("#btn-goal-run").addEventListener("click", () => void this.run());
    q("#btn-sweep-run").addEventListener("click", () => void runSweep(ctx));
    q("#btn-goal-stop").addEventListener("click", () => {
      ctx.state.handle?.cancel();
      ctx.status(tDynamic("goal.status.stopped"));
    });
    q("#btn-goal-csv").addEventListener("click", () => exportCsv(ctx));
    q("#btn-goal-report").addEventListener("click", () => void exportReport(ctx));
    q("#btn-goal-keep").addEventListener("click", () => void keepLastRun(ctx, this.manifest()));
    q("#manifest-note").addEventListener("click", (ev) => {
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
        ctx.status(tDynamic("goal.manifest.invalid", { reason: err instanceof Error ? err.message : String(err) }));
      } finally {
        input.value = "";
      }
    });
    bindHistory(ctx);
    q("#btn-goal-det").addEventListener("click", () => void this.checkDeterminism());
    q("#btn-sweep-csv").addEventListener("click", () => exportSweepCsv(ctx));
    q("#tournament-picks").addEventListener("change", () => limitTournamentPicks(ctx));
    q("#btn-tournament-run").addEventListener("click", () => void runTournament(ctx));
    q("#btn-tournament-csv").addEventListener("click", () => exportTournamentCsv(ctx));
    bindResults(ctx);
    bindReplay(ctx);
  }
}
