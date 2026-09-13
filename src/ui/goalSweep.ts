/**
 * The two batch experiments of the Expérience panel: the one-variable sweep
 * grid (values, table, chart, CSV) and the tournament (contestant picks, pair
 * runs, win matrix, CSV). Each keeps its own results separate from the
 * targeted run, and both start from the panel's selected start state.
 */
import { drawSweep } from "../render/charts";
import {
  SWEEP_VARIABLES,
  summarizeSweep,
  summarizeTournament,
  sweepConfigs,
  sweepValues,
  tournamentConfigs,
  type Goal,
  type SweepVariable,
  type TrialResult,
  type TournamentContestant,
} from "../sim/index";
import { runReplicates } from "./goalRunner";
import { tDynamic } from "./i18n/runtime";
import { MAX_SWEEP_REPLICATES, type GoalContext } from "./goalContext";
import { cancelScheduledRender, renderProgress, scheduleRender } from "./goalRunView";
import { currentGoals, parseSeed, startSnapshot } from "./goalWizard";

const SWEEP_LABEL: Record<SweepVariable, string> = {
  mutationRate: tDynamic("goal.sweep.var.mutationRate"),
  maxPopulation: tDynamic("goal.sweep.var.maxPopulation"),
  reproduceEnergy: tDynamic("goal.sweep.var.reproduceEnergy"),
  toxinScale: tDynamic("goal.sweep.var.toxinScale"),
  nutrientScale: tDynamic("goal.sweep.var.nutrientScale"),
  temperatureScale: tDynamic("goal.sweep.var.temperatureScale"),
  lightScale: tDynamic("goal.sweep.var.lightScale"),
};

/** The markup lists sweep variables by these labels; the panel template needs them too. */
export { SWEEP_LABEL };

/** A tournament pairs at most this many contestants. */
const MAX_TOURNAMENT = 4;

export async function runSweep(ctx: GoalContext): Promise<void> {
  const state = ctx.state;
  if (state.handle) return;
  const goals = currentGoals(ctx);
  const goal = goals?.[0] ?? null;
  if (!goal || !goals) {
    ctx.status(tDynamic("goal.status.incomplete"));
    return;
  }
  const start = await startSnapshot(ctx);
  if (!start) return;
  if (start.snapshot.organisms.length === 0) {
    ctx.status(tDynamic("goal.status.emptyStart"));
    return;
  }
  const variable = ctx.q<HTMLSelectElement>("#sweep-var").value as SweepVariable;
  if (!(SWEEP_VARIABLES as readonly string[]).includes(variable)) return;
  const from = Number(ctx.q<HTMLInputElement>("#sweep-from").value);
  const to = Number(ctx.q<HTMLInputElement>("#sweep-to").value);
  const steps = Math.max(2, Math.round(Number(ctx.q<HTMLInputElement>("#sweep-steps").value) || 2));
  const perValue = Math.max(1, Math.min(MAX_SWEEP_REPLICATES, Math.round(Number(ctx.q<HTMLInputElement>("#sweep-reps").value) || 1)));
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    ctx.status(tDynamic("goal.sweep.status.bounds"));
    return;
  }
  const values = sweepValues(from, to, steps);
  const maxTicks = Math.max(10, Math.round(Number(ctx.q<HTMLInputElement>("#goal-max").value) || 100));
  const seed = Math.round(Number(ctx.q<HTMLInputElement>("#goal-seed").value)) >>> 0 || 1;
  const mutationRate = Math.max(0, Math.min(1, Number(ctx.q<HTMLInputElement>("#goal-mut").value)));
  const maxPopulation = Math.max(16, Math.round(Number(ctx.q<HTMLInputElement>("#goal-popmax").value) || 16));
  const disturbances = ctx.q<HTMLInputElement>("#goal-disturb").checked;
  const sampleEvery = Math.max(1, Math.round(maxTicks / 80));
  const configs = sweepConfigs(
    { seed, maxTicks, sampleEvery, overrides: { mutationRate, maxPopulation, disturbances }, keepSnapshot: false },
    variable,
    values,
    perValue,
  );
  state.sweepVar = variable;
  state.lastGoal = goal;
  state.lastGoals = goals;
  state.lastRun = { snapshot: start.snapshot, label: start.label, configs };
  state.results = new Array(configs.length);
  state.progress = new Array(configs.length).fill(0);
  state.sweepPoints = [];
  ctx.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
  ctx.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
  ctx.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-sweep-csv").disabled = true;
  ctx.q("#sweep-table").innerHTML = "";
  renderProgress(ctx, maxTicks);
  ctx.status(tDynamic("goal.sweep.status.launched", { variable: SWEEP_LABEL[variable], values: values.length, replicates: perValue }));
  const t0 = performance.now();
  state.handle = runReplicates(start.snapshot, goals.length === 1 ? goal : goals, configs, {
    onProgress: (i, tick) => {
      state.progress[i] = tick - start.snapshot.tick;
      scheduleRender(ctx, maxTicks, false);
    },
    onResult: (i, r) => {
      state.results[i] = r;
      state.progress[i] = r.ticks;
      scheduleRender(ctx, maxTicks, false);
    },
  });
  const all = await state.handle.promise;
  state.handle = null;
  cancelScheduledRender(ctx);
  renderProgress(ctx, maxTicks);
  ctx.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-sweep-run").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
  const grouped = values.map((_, vi) => all.slice(vi * perValue, (vi + 1) * perValue).filter(Boolean));
  state.sweepPoints = summarizeSweep(values, grouped);
  ctx.q<HTMLButtonElement>("#btn-sweep-csv").disabled = state.sweepPoints.length === 0;
  renderSweepTable(ctx);
  drawSweepChart(ctx);
  ctx.status(tDynamic("goal.sweep.status.done", { seconds: ((performance.now() - t0) / 1000).toFixed(1), values: values.length }));
}

export function renderSweepTable(ctx: GoalContext): void {
  const host = ctx.q("#sweep-table");
  if (!ctx.state.sweepPoints.length) {
    host.innerHTML = "";
    return;
  }
  const fmt = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
  host.innerHTML = `<table class="sweep-table"><thead><tr><th>${tDynamic("goal.sweep.table.value")}</th><th>${tDynamic("goal.sweep.table.success")}</th><th>${tDynamic("goal.sweep.table.median")}</th><th>${tDynamic("goal.sweep.table.range")}</th><th>${tDynamic("goal.sweep.table.extinctions")}</th></tr></thead><tbody>${
    ctx.state.sweepPoints.map((p) => {
      const s = p.summary;
      const range = s.minTicks === null ? "—" : `${s.minTicks}–${s.maxTicks}`;
      return `<tr><td class="mono">${p.value.toPrecision(4)}</td><td>${s.successes}/${s.n}</td><td>${fmt(s.medianTicks)}</td><td>${range}</td><td>${s.extinctions}</td></tr>`;
    }).join("")
  }</tbody></table>`;
}

export function drawSweepChart(ctx: GoalContext): void {
  const canvas = ctx.q<HTMLCanvasElement>("#chart-sweep");
  const cw = canvas.parentElement!.clientWidth - 28;
  if (cw <= 0) return;
  drawSweep(canvas, cw, 120, ctx.state.sweepPoints.map((p) => ({
    value: p.value,
    median: p.summary.medianTicks,
    min: p.summary.minTicks,
    max: p.summary.maxTicks,
  })));
  ctx.q("#sweep-chart-note").textContent = ctx.state.sweepPoints.length
    ? tDynamic("goal.sweep.chartNote", { variable: SWEEP_LABEL[ctx.state.sweepVar] })
    : "";
}

export function exportSweepCsv(ctx: GoalContext): void {
  const rows = [["value", "successes", "n", "success_rate", "median_ticks", "min_ticks", "max_ticks", "extinctions"]];
  for (const p of ctx.state.sweepPoints) {
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
  a.download = `openavida-sweep-${ctx.state.sweepVar}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function refreshTournamentPicks(ctx: GoalContext): Promise<void> {
  const host = ctx.q("#tournament-picks");
  const strains = [...ctx.world().strains.values()];
  const saved = await ctx.store.listOrganisms();
  const key = strains.map((s) => `${s.id}:${s.name}`).join("|") + "#" + saved.map((o) => o.id).join("|");
  const checked = new Set([...host.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")].map((el) => el.value));
  if (key === ctx.state.tournamentPickKey && host.childElementCount) return;
  ctx.state.tournamentPickKey = key;
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
  limitTournamentPicks(ctx);
}

export function limitTournamentPicks(ctx: GoalContext): void {
  const boxes = [...ctx.q("#tournament-picks").querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  const n = boxes.filter((b) => b.checked).length;
  for (const b of boxes) b.disabled = !b.checked && n >= MAX_TOURNAMENT;
}

async function selectedContestants(ctx: GoalContext): Promise<TournamentContestant[] | null> {
  const values = [...ctx.q("#tournament-picks").querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")].map((el) => el.value);
  if (values.length < 2) {
    ctx.status(tDynamic("goal.tournament.select"));
    return null;
  }
  const out: TournamentContestant[] = [];
  const strains = ctx.world().strains;
  for (const v of values) {
    if (v.startsWith("strain:")) {
      const s = strains.get(Number(v.slice(7)));
      if (!s) continue;
      out.push({ name: s.name, genome: s.genome });
    } else if (v.startsWith("org:")) {
      const rec = await ctx.store.loadOrganism(v.slice(4));
      if (!rec) continue;
      out.push({ name: rec.name, genome: rec.entry.genome });
    }
  }
  if (out.length < 2) {
    ctx.status(tDynamic("goal.tournament.missing"));
    return null;
  }
  return out.slice(0, MAX_TOURNAMENT);
}

export async function runTournament(ctx: GoalContext): Promise<void> {
  const state = ctx.state;
  if (state.handle) return;
  const contestants = await selectedContestants(ctx);
  if (!contestants) return;
  const start = await startSnapshot(ctx);
  if (!start) return;
  const perPair = Math.max(1, Math.min(50, Math.round(Number(ctx.q<HTMLInputElement>("#tournament-reps").value) || 1)));
  const maxTicks = Math.max(10, Math.round(Number(ctx.q<HTMLInputElement>("#tournament-max").value) || 400));
  const seed = parseSeed(ctx.q<HTMLInputElement>("#goal-seed").value) ?? (ctx.world().params.seed >>> 0 || 1);
  const configs = tournamentConfigs(start.snapshot, contestants, perPair, seed, { maxTicks, sampleEvery: Math.max(1, Math.round(maxTicks / 80)) });
  if (!configs.length) {
    ctx.status(tDynamic("goal.tournament.noPairs"));
    return;
  }
  state.tournamentNames = contestants.map((c) => c.name);
  state.tournamentSummary = null;
  ctx.q("#tournament-matrix").innerHTML = "";
  ctx.q<HTMLButtonElement>("#btn-tournament-csv").disabled = true;
  ctx.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
  ctx.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
  ctx.q<HTMLButtonElement>("#btn-tournament-run").disabled = true;
  ctx.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
  const dummy: Goal = { metric: { kind: "population" }, op: ">=", target: 1e9, sustain: 1 };
  ctx.status(tDynamic("goal.tournament.started", { contestants: contestants.length, runs: configs.length, perPair }));
  const results: TrialResult[] = new Array(configs.length);
  const render = () => {
    const done = results.filter(Boolean).length;
    ctx.q("#tournament-progress").innerHTML = `<div class="goal-total" role="progressbar" aria-valuemin="0" aria-valuemax="${configs.length}" aria-valuenow="${done}"><i style="width:${((done / configs.length) * 100).toFixed(1)}%"></i></div><div class="tiny">${tDynamic("goal.tournament.progress", { done, total: configs.length })}</div>`;
  };
  render();
  const t0 = performance.now();
  state.handle = runReplicates(start.snapshot, dummy, configs, {
    onResult: (i, r) => {
      results[i] = r;
      render();
    },
  });
  const all = await state.handle.promise;
  state.handle = null;
  ctx.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-sweep-run").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-tournament-run").disabled = false;
  ctx.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
  state.tournamentSummary = summarizeTournament(all);
  renderTournamentMatrix(ctx);
  ctx.q<HTMLButtonElement>("#btn-tournament-csv").disabled = state.tournamentSummary.cells.length === 0;
  render();
  ctx.status(tDynamic("goal.tournament.done", { seconds: ((performance.now() - t0) / 1000).toFixed(1), pairs: state.tournamentSummary.cells.length }));
}

export function renderTournamentMatrix(ctx: GoalContext): void {
  const host = ctx.q("#tournament-matrix");
  const s = ctx.state.tournamentSummary;
  const names = ctx.state.tournamentNames;
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

export function exportTournamentCsv(ctx: GoalContext): void {
  const s = ctx.state.tournamentSummary;
  if (!s) return;
  const names = ctx.state.tournamentNames;
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
