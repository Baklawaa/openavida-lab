/**
 * The last run as the panel reads it: progress bars and summary, the sorted
 * per-replicate table with its seeds block, the objective chart, the CSV
 * export, the standalone HTML report, the manifest the headless runner
 * consumes, and the IndexedDB copy that survives a reload. The wiring of the
 * results controls lives here too.
 */
import { drawTrialSeries } from "../render/charts";
import {
  asGoals,
  makeManifest,
  recipeFromWorld,
  summarizeTrials,
  trialGoalTicks,
  type Manifest,
  type TrialResult,
} from "../sim/index";
import { icon } from "./layout";
import { buildReportHtml } from "./report";
import { tDynamic } from "./i18n/runtime";
import type { GoalContext, ResultSort } from "./goalContext";
import { describeGoal } from "./goalWizard";
import { catalogIndex, replayIndex, replaySeed } from "./goalHistoryView";

const MAX_CHART_SERIES = 100;
const RENDER_INTERVAL_MS = 200;
/** The full result table is rebuilt at most this often while a run is in progress (always once at the end). */
const TABLE_INTERVAL_MS = 1000;

export const RESULT_SORTS: Array<{ id: ResultSort; label: string }> = [
  { id: "hit-fast", label: tDynamic("goal.sort.hitFast") },
  { id: "hit-slow", label: tDynamic("goal.sort.hitSlow") },
  { id: "fail-fast", label: tDynamic("goal.sort.failFast") },
  { id: "fail-slow", label: tDynamic("goal.sort.failSlow") },
  { id: "value-desc", label: tDynamic("goal.sort.valueDesc") },
  { id: "pop-desc", label: tDynamic("goal.sort.popDesc") },
  { id: "launch", label: tDynamic("goal.sort.launch") },
];

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

/** Keep the table and replays, not the per-replicate final worlds; keep curves for an even sample only. */
export async function persistRun(ctx: GoalContext, results: TrialResult[], maxTicks: number): Promise<void> {
  const state = ctx.state;
  if (!state.lastRun || !state.lastGoal) return;
  const stride = Math.max(1, Math.ceil(results.length / MAX_CHART_SERIES));
  const slim = results.map((r, i) => {
    const { snapshot: _s, ...rest } = r;
    return i % stride === 0 ? rest : { ...rest, series: [] };
  });
  try {
    await ctx.store.saveLastRun({
      savedAt: Date.now(),
      label: state.lastRun.label,
      snapshot: state.lastRun.snapshot,
      goal: state.lastGoal,
      goals: state.lastGoals.length ? state.lastGoals : [state.lastGoal],
      configs: state.lastRun.configs,
      results: slim,
      maxTicks,
    });
  } catch {
    /* storage unavailable: the run simply is not restored after a reload */
  }
}

/** Put a reloaded run back on screen, as if it had just finished. */
export async function restoreLastRun(ctx: GoalContext): Promise<void> {
  const state = ctx.state;
  if (state.handle || state.results.some(Boolean)) return;
  const rec = await ctx.store.loadLastRun();
  if (!rec || !rec.results.length) return;
  state.lastRun = { snapshot: rec.snapshot, label: rec.label, configs: rec.configs };
  state.lastGoal = rec.goal;
  state.lastGoals = rec.goals?.length ? rec.goals : [rec.goal];
  state.results = rec.results.slice();
  state.progress = rec.results.map((r) => r.ticks);
  renderProgress(ctx, rec.maxTicks);
  state.lastTableRender = 0;
  renderResults(ctx);
  ctx.q<HTMLButtonElement>("#btn-goal-csv").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-goal-report").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-goal-keep").disabled = false;
  const when = new Date(rec.savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  ctx.q("#goal-table-note").textContent = tDynamic("goal.restore.note", { count: rec.results.length, when, label: rec.label });
  ctx.status(tDynamic("goal.restore.status", { count: rec.results.length, label: rec.label, when }));
}

/** Coalesce progress/result events: at most one DOM update per RENDER_INTERVAL_MS. */
export function scheduleRender(ctx: GoalContext, maxTicks: number, results: boolean): void {
  const state = ctx.state;
  state.renderMax = maxTicks;
  if (results) state.resultsDirty = true;
  if (state.renderTimer !== null) return;
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = null;
    renderProgress(ctx, state.renderMax);
    if (state.resultsDirty) {
      state.resultsDirty = false;
      renderResults(ctx);
    }
  }, RENDER_INTERVAL_MS);
}

export function cancelScheduledRender(ctx: GoalContext): void {
  const state = ctx.state;
  if (state.renderTimer !== null) window.clearTimeout(state.renderTimer);
  state.renderTimer = null;
  state.resultsDirty = false;
}

export function renderProgress(ctx: GoalContext, maxTicks: number): void {
  const state = ctx.state;
  const host = ctx.q("#goal-progress");
  const total = state.progress.length;
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
    const r = state.results[i];
    if (r) {
      done++;
      if (r.reachedTick !== null) hit++;
      else if (r.extinct) dead++;
      else if (r.unreachable) unreachable++;
    } else if (state.progress[i]! > 0) {
      running++;
      if (active.length < 16) active.push(`<span class="goal-bar" title="${tDynamic("goal.progress.replicate", { n: i + 1 })}"><i style="width:${Math.min(100, (state.progress[i]! / maxTicks) * 100).toFixed(0)}%"></i></span>`);
    }
  }
  const pct = (done / total) * 100;
  host.innerHTML = `<div class="goal-total" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="tiny goal-progress-text">${done}/${total} ${tDynamic("goal.progress.done")} · <span class="hit">${hit} ${tDynamic("goal.progress.hit")}</span> · ${done - hit - dead - unreachable} ${tDynamic("goal.progress.missed")} · <span class="dead">${dead} ${tDynamic("goal.progress.dead")}</span>${unreachable ? ` · ${unreachable} ${tDynamic("goal.progress.unreachable")}` : ""}${running ? ` · ${running} ${tDynamic("goal.progress.running")}` : ""}</div>
      ${active.length ? `<div class="goal-active">${active.join("")}</div>` : ""}`;
}

export function renderResults(ctx: GoalContext): void {
  const state = ctx.state;
  const done = state.results.filter(Boolean);
  const goal = state.lastGoal;
  if (!goal) return;
  const s = summarizeTrials(done);
  const fmtT = (v: number | null) => (v === null ? "—" : tDynamic("goal.table.stepCount", { value: Math.round(v) }));
  const perGoalHtml = s.perGoal.length > 1
    ? s.perGoal.map((g, i) => `<span>${tDynamic("goal.summary.goal", { n: i + 1 })}<b>${g.successes}/${s.n}${g.medianTicks !== null ? tDynamic("goal.summary.medianShort", { ticks: Math.round(g.medianTicks) }) : ""}</b></span>`).join("")
    : "";
  ctx.q("#goal-summary").innerHTML = done.length
    ? `<div class="goal-stats">
          <span>${tDynamic("goal.summary.success")}<b>${s.successes}/${s.n}</b></span>
          <span>${tDynamic("goal.summary.median")}<b>${fmtT(s.medianTicks)}</b></span>
          <span>${tDynamic("goal.summary.iqr")}<b>${s.p25Ticks === null ? "—" : `${Math.round(s.p25Ticks)} – ${Math.round(s.p75Ticks!)}`}</b></span>
          <span>${tDynamic("goal.summary.range")}<b>${s.minTicks === null ? "—" : `${s.minTicks} – ${s.maxTicks}`}</b></span>
          <span>${tDynamic("goal.summary.extinctions")}<b>${s.extinctions}</b></span>
          <span>${tDynamic("goal.summary.unreachable")}<b>${s.unreachable}</b></span>
          ${perGoalHtml}
        </div>${successSeedsHtml(ctx)}`
    : "";
  const now = performance.now();
  if (!state.handle || now - state.lastTableRender > TABLE_INTERVAL_MS) {
    state.lastTableRender = now;
    renderTable(ctx);
  }
  drawChart(ctx);
}

/** Every replicate, sorted; rebuilt as one HTML string so 5000 rows stay a single DOM write. */
export function renderTable(ctx: GoalContext): void {
  const state = ctx.state;
  const pairs: Array<[number, TrialResult]> = [];
  state.results.forEach((r, i) => {
    if (r) pairs.push([i, r]);
  });
  const host = ctx.q("#goal-results");
  if (!pairs.length) {
    host.innerHTML = "";
    ctx.q("#goal-table-note").textContent = "";
    return;
  }
  pairs.sort(compareResults(state.sort));
  const nGoals = Math.max(1, state.lastGoals.length);
  const pasHeads = nGoals > 1
    ? state.lastGoals.map((_, gi) => `<th class="num">${tDynamic("goal.table.stepsHeadN", { n: gi + 1 })}</th>`).join("")
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
  ctx.q("#goal-table-note").textContent = tDynamic(pairs.length > 1 ? "goal.count.replicate.many" : "goal.count.replicate.one", { count: pairs.length });
}

export function drawChart(ctx: GoalContext): void {
  const state = ctx.state;
  const canvas = ctx.q<HTMLCanvasElement>("#chart-goal");
  const cw = canvas.parentElement!.clientWidth - 28;
  if (cw <= 0) return;
  const all = state.results.filter(Boolean);
  // Draw an even sample so a thousand replicates stay legible and cheap.
  const stride = Math.max(1, Math.ceil(all.length / MAX_CHART_SERIES));
  const runs = all.filter((_, i) => i % stride === 0).map((r) => ({ series: r.series, reached: r.reachedTick !== null }));
  drawTrialSeries(canvas, cw, 120, runs, state.lastGoal?.target ?? null);
  ctx.q("#goal-chart-note").textContent = all.length
    ? tDynamic("goal.chart.target", {
      count: tDynamic(all.length > 1 ? "goal.count.replicate.many" : "goal.count.replicate.one", { count: all.length }),
      sampled: runs.length < all.length ? tDynamic("goal.chart.sampled", { count: runs.length }) : "",
    })
    : "";
}

export function exportCsv(ctx: GoalContext): void {
  const state = ctx.state;
  const nGoals = Math.max(1, state.lastGoals.length);
  const extra = nGoals > 1 ? state.lastGoals.map((_, gi) => `reached_tick_${gi + 1}`) : [];
  const rows = [["replicate", "seed", "reached_tick", ...extra, "ticks_run", "final_value", "final_population", "extinct", "unreachable"]];
  state.results.forEach((r, i) => {
    if (!r) return;
    const ticks = trialGoalTicks(r);
    const extraVals = nGoals > 1
      ? state.lastGoals.map((_, gi) => {
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

/** Standalone HTML report of the last run: configuration, recipe, goals, summary, table, chart and saved organisms. */
export async function exportReport(ctx: GoalContext): Promise<void> {
  const state = ctx.state;
  if (!state.lastRun || !state.lastGoal) {
    ctx.status(tDynamic("goal.report.none"));
    return;
  }
  const done = state.results.filter(Boolean);
  if (!done.length) {
    ctx.status(tDynamic("goal.report.empty"));
    return;
  }
  let chartPng: string | undefined;
  try {
    chartPng = ctx.q<HTMLCanvasElement>("#chart-goal").toDataURL("image/png");
  } catch {
    chartPng = undefined;
  }
  const extras = ctx.reportExtras();
  const genomes = new Set((state.lastRun.snapshot.strains ?? []).map((s) => s.genome));
  for (const o of state.lastRun.snapshot.organisms) genomes.add(o.genome);
  const saved = [];
  for (const meta of await ctx.store.listOrganisms()) {
    const rec = await ctx.store.loadOrganism(meta.id);
    if (rec && genomes.has(rec.entry.genome)) saved.push({ name: rec.name, genome: rec.entry.genome, strainName: rec.strainName });
  }
  const goals = state.lastGoals.length ? state.lastGoals : [state.lastGoal];
  const html = buildReportHtml({
    generatedAt: new Date().toLocaleString("fr-FR"),
    startLabel: state.lastRun.label,
    params: state.lastRun.snapshot.params,
    recipeOps: recipeFromWorld(ctx.world()).ops,
    schedule: state.lastRun.snapshot.schedule ?? [],
    goals,
    goalLabels: goals.map((g) => describeGoal(g, state.lastStrains)),
    summary: summarizeTrials(done),
    results: done,
    maxTicks: state.lastRun.configs[0]?.maxTicks ?? 0,
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
  ctx.status(tDynamic("goal.report.done", { count: done.length }));
}

function successSeedsHtml(ctx: GoalContext): string {
  const hits = ctx.state.results.filter((r) => r && r.reachedTick !== null);
  if (!hits.length) return "";
  const shown = hits.slice(0, 60);
  return `<div class="seed-chips"><span class="eyebrow">${tDynamic("goal.seeds.title")}</span>${shown
    .map((r) => `<button type="button" class="seed-chip" data-replay-seed="${r.seed}" title="${tDynamic("goal.seeds.chipTitle", { step: r.reachedTick! - r.startTick })}">${r.seed}</button>`)
    .join("")}${hits.length > shown.length ? `<span class="tiny">${tDynamic("goal.seeds.more", { count: hits.length - shown.length })}</span>` : ""}<button type="button" id="btn-copy-seeds" class="quiet">${icon("copy")}${tDynamic("goal.seeds.copy")}</button></div>`;
}

/**
 * Manifest of the last run (start state, goals, replicate plan) or null when
 * nothing has run yet. The headless runner consumes it unchanged.
 */
export function manifestOf(ctx: GoalContext): Manifest | null {
  const state = ctx.state;
  if (state.imported) return state.imported;
  if (!state.lastRun || state.lastGoals.length === 0) return null;
  const config = state.lastRun.configs[0];
  return makeManifest({
    name: state.lastRun.label,
    params: state.lastRun.snapshot.params,
    start: { kind: "snapshot", snapshot: state.lastRun.snapshot },
    schedule: state.lastRun.snapshot.schedule ?? [],
    goals: asGoals(state.lastGoals),
    run: {
      replicates: Math.max(1, state.lastRun.configs.length),
      seed: config?.seed ?? state.lastRun.snapshot.params.seed,
      maxTicks: config?.maxTicks ?? 100,
      sampleEvery: config?.sampleEvery ?? 1,
      ...(config?.overrides ? { overrides: config.overrides } : {}),
      ...(config?.overrides?.recordEvents ? { recordEvents: true } : {}),
    },
  });
}

/** Sort control and the click targets of the results table and the seeds block. */
export function bindResults(ctx: GoalContext): void {
  const q = ctx.q;
  q("#goal-sort").addEventListener("change", (ev) => {
    ctx.state.sort = (ev.target as HTMLSelectElement).value as ResultSort;
    renderTable(ctx);
  });
  q("#goal-results").addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const replay = t.closest<HTMLElement>("[data-replay]");
    if (replay) {
      replayIndex(ctx, Number(replay.dataset.replay));
      return;
    }
    const catalog = t.closest<HTMLElement>("[data-catalog]");
    if (catalog) {
      catalogIndex(ctx, Number(catalog.dataset.catalog));
      return;
    }
    const seedCell = t.closest<HTMLElement>("[data-replay-seed]");
    if (seedCell) {
      replaySeed(ctx, Number(seedCell.dataset.replaySeed));
      return;
    }
    const btn = t.closest<HTMLElement>("[data-open]");
    if (!btn) return;
    const r = ctx.state.results[Number(btn.dataset.open)];
    if (r?.snapshot) {
      ctx.restoreInto("B", r.snapshot);
      ctx.status(tDynamic("goal.status.finalOpened", { n: Number(btn.dataset.open) + 1 }));
    }
  });
  q("#goal-summary").addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const chip = t.closest<HTMLElement>("[data-replay-seed]");
    if (chip) {
      replaySeed(ctx, Number(chip.dataset.replaySeed));
      return;
    }
    if (t.closest("#btn-copy-seeds")) {
      const seeds = ctx.state.results.filter((r) => r && r.reachedTick !== null).map((r) => r.seed).join(", ");
      void navigator.clipboard?.writeText(seeds).then(
        () => ctx.status(tDynamic("goal.status.seedsCopied")),
        () => ctx.status(seeds),
      );
    }
  });
}
