/**
 * The run journal and the way back into a recorded run: the stored-runs table
 * with its comparison, overlaid curves and notes, the manifest export, the
 * replay of a stored record, and the replay/catalogue of a replicate from the
 * live results table (both rebuild a world from a run's start state).
 */
import { drawTrialSeries, type TrialRun } from "../render/charts";
import {
  configsForManifest,
  engineInfo,
  startSnapshot,
  summarizeTrials,
  worldForTrial,
  type Manifest,
  type TrialConfig,
  type TrialResult,
} from "../sim/index";
import { historyRows, recordFromRun, type ExperimentRecord } from "./experimentHistory";
import { tDynamic } from "./i18n/runtime";
import { escapeGoalHtml, showReplayInfo, type GoalContext } from "./goalContext";
import { parseSeed, SEED_HINT, startSnapshot as startState } from "./goalWizard";

/** Steps replayed per animation frame when a replicate is rebuilt for its end-state catalogue, so the UI keeps breathing. */
const CATALOG_CHUNK = 150;

/** Store the last finished run, then refresh the list. */
export async function keepLastRun(ctx: GoalContext, manifest: Manifest | null): Promise<void> {
  const state = ctx.state;
  const results = state.results.filter(Boolean) as TrialResult[];
  if (!state.lastRun || results.length === 0 || !manifest) {
    ctx.status(tDynamic("goal.history.noneToKeep"));
    return;
  }
  const record = recordFromRun({ manifest, results, summary: summarizeTrials(results) });
  await ctx.store.saveExperiment(record);
  state.historySelected = [record.id];
  ctx.status(tDynamic("goal.history.kept", { name: record.name, count: record.results.length }));
  await refreshHistory(ctx);
}

/** Reload the stored runs and redraw the history table. */
export async function refreshHistory(ctx: GoalContext): Promise<void> {
  const state = ctx.state;
  try {
    state.historyRecords = await ctx.store.listExperiments();
  } catch {
    state.historyRecords = [];
  }
  state.historySelected = state.historySelected.filter((id) => state.historyRecords.some((r) => r.id === id));
  renderHistory(ctx);
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function renderHistory(ctx: GoalContext): void {
  const state = ctx.state;
  const body = ctx.q("#history-body");
  if (state.historyRecords.length === 0) {
    body.innerHTML = `<p class="muted">${tDynamic("goal.history.empty")}</p>`;
    return;
  }
  const rows = historyRows(state.historyRecords, {
    ...(state.historySelected[0] ? { referenceId: state.historySelected[0] } : {}),
    current: engineInfo(),
  });
  const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
  const span = (ci: [number, number] | null) => (ci ? `[${ci[0].toFixed(2)} – ${ci[1].toFixed(2)}]` : "—");
  const header = `<tr><th></th><th>${tDynamic("goal.history.run")}</th><th>n</th><th>${tDynamic("goal.history.success")}</th><th>${tDynamic("goal.history.medianSteps")}</th><th>${tDynamic("goal.history.effect")}</th><th></th></tr>`;
  const bodyRows = rows
    .map((row) => {
      const picked = state.historySelected.includes(row.id);
      const finalSnap = state.historyRecords.find((r) => r.id === row.id)?.results[0]?.snapshot;
      const effect = row.effect
        ? `Δ ${row.effect.medianShift === null ? "—" : row.effect.medianShift.toFixed(1)} · δ ${row.effect.cliffsDelta.toFixed(2)} · g ${row.effect.hedgesG.toFixed(2)}`
        : tDynamic("goal.history.reference");
      return `<tr class="${picked ? "picked" : ""}">
          <td><input type="checkbox" data-history-pick="${row.id}" ${picked ? "checked" : ""} aria-label="${tDynamic("goal.history.compare")}"></td>
          <td><b>${escapeGoalHtml(row.name)}</b><div class="micro">${row.createdAt.slice(0, 16).replace("T", " ")}${row.engineMismatch ? ` · <span class="warn">${row.engineMismatch}</span>` : ""}</div>
            <input type="text" class="history-note" data-history-note="${row.id}" placeholder="${tDynamic("goal.history.note")}" value="${escapeGoalHtml(state.historyRecords.find((r) => r.id === row.id)?.notes ?? "")}"></td>
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
  const chart = ctx.q<HTMLCanvasElement>("#chart-history");
  const picked = state.historySelected
    .map((id) => state.historyRecords.find((r) => r.id === id))
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
  ctx.q("#history-chart-note").textContent = picked.length
    ? tDynamic("goal.history.chartNote", { runs: picked.length, curves: runs.length })
    : tDynamic("goal.history.chartHint");
}

/** Rebuild the first replicate of a stored run from its own manifest, into world B. */
export function replayRecord(ctx: GoalContext, record: ExperimentRecord, index = 0): void {
  const config = configsForManifest(record.manifest)[index];
  if (!config) {
    ctx.status(tDynamic("goal.replay.emptyManifest"));
    return;
  }
  const world = worldForTrial(startSnapshot(record.manifest), config);
  ctx.replayInto(world.snapshot());
  ctx.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
  const known = record.results[index];
  const expected = known
    ? known.reachedTick !== null
      ? tDynamic("goal.replay.hit", { step: known.reachedTick - known.startTick })
      : tDynamic("goal.replay.miss", { ticks: known.ticks })
    : tDynamic("goal.replay.noReference");
  showReplayInfo(ctx, tDynamic("goal.replay.historyInfo", { name: record.name, tick: world.tick, population: world.organisms.length, seed: config.seed, expected }));
  ctx.status(tDynamic("goal.replay.historyStatus", { n: index + 1, name: record.name }));
}

export async function exportHistoryManifest(ctx: GoalContext, id: string): Promise<void> {
  const record = ctx.state.historyRecords.find((r) => r.id === id);
  if (!record) return;
  download(`openavida-${record.id}.json`, JSON.stringify(record.manifest, null, 2));
  ctx.status(tDynamic("goal.history.manifestExported", { name: record.name }));
}

export async function updateHistoryNote(ctx: GoalContext, id: string, notes: string): Promise<void> {
  const record = ctx.state.historyRecords.find((r) => r.id === id);
  if (!record) return;
  record.notes = notes;
  await ctx.store.saveExperiment(record);
}

export async function removeHistory(ctx: GoalContext, id: string): Promise<void> {
  await ctx.store.removeExperiment(id);
  ctx.state.historySelected = ctx.state.historySelected.filter((x) => x !== id);
  await refreshHistory(ctx);
}

/* ---------- replays ---------- */

export function replayIndex(ctx: GoalContext, i: number): void {
  const cfg = ctx.state.lastRun?.configs[i];
  if (!ctx.state.lastRun || !cfg) return;
  replay(ctx, cfg, tDynamic("goal.replay.label.replicate", { n: i + 1 }));
}

/** Replay a seed with the last run's start state and parameters (or the current form when nothing ran yet). */
export function replaySeed(ctx: GoalContext, seed: number): void {
  const state = ctx.state;
  if (state.lastRun) {
    const exact = state.lastRun.configs.find((c) => c.seed === seed);
    const template = exact ?? state.lastRun.configs[0];
    if (!template) return;
    replay(ctx, { ...template, seed }, tDynamic(exact ? "goal.replay.label.seed" : "goal.replay.label.seedOffRun", { seed }));
    return;
  }
  void startState(ctx).then((start) => {
    if (!start) return;
    const maxTicks = Math.max(10, Math.round(Number(ctx.q<HTMLInputElement>("#goal-max").value) || 100));
    const mutationRate = Math.max(0, Math.min(1, Number(ctx.q<HTMLInputElement>("#goal-mut").value)));
    const maxPopulation = Math.max(16, Math.round(Number(ctx.q<HTMLInputElement>("#goal-popmax").value) || 16));
    const disturbances = ctx.q<HTMLInputElement>("#goal-disturb").checked;
    state.lastRun = { snapshot: start.snapshot, label: start.label, configs: [] };
    replay(ctx, { seed, maxTicks, sampleEvery: 1, overrides: { mutationRate, maxPopulation, disturbances } }, tDynamic("goal.replay.label.seed", { seed }));
  });
}

function replay(ctx: GoalContext, config: TrialConfig, label: string): void {
  const state = ctx.state;
  if (!state.lastRun) return;
  const w = worldForTrial(state.lastRun.snapshot, config);
  ctx.replayInto(w.snapshot());
  ctx.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
  const known = state.results.find((r) => r && r.seed === config.seed);
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
  showReplayInfo(ctx, tDynamic("goal.replay.info", {
    label,
    start: state.lastRun.label,
    tick: w.tick,
    population: w.organisms.length,
    seed: config.seed,
    mutation: o.mutationRate ?? w.params.mutationRate,
    popMax: o.maxPopulation ?? w.params.maxPopulation,
    disturbances: (o.disturbances ?? w.disturbances) ? tDynamic("goal.replay.yes") : tDynamic("goal.replay.no"),
    expected,
  }));
  ctx.status(tDynamic("goal.replay.status", { label, seed: config.seed }));
}

/* ---------- end-state catalogue ---------- */

export function catalogIndex(ctx: GoalContext, i: number): void {
  const cfg = ctx.state.lastRun?.configs[i];
  const r = ctx.state.results[i];
  if (!cfg || !r) {
    ctx.status(tDynamic("goal.catalog.unknownConfig"));
    return;
  }
  catalogFor(ctx, cfg, r.ticks, tDynamic("goal.replay.label.replicate", { n: i + 1 }));
}

/** Catalogue for a typed seed: the recorded length when the seed ran, otherwise the full budget of the course. */
export function catalogSeed(ctx: GoalContext, seed: number): void {
  const state = ctx.state;
  if (!state.lastRun) {
    ctx.status(tDynamic("goal.catalog.noRun"));
    return;
  }
  const exact = state.lastRun.configs.find((c) => c.seed === seed);
  const template = exact ?? state.lastRun.configs[0];
  if (!template) {
    ctx.status(tDynamic("goal.catalog.noConfig"));
    return;
  }
  const known = state.results.find((r) => r && r.seed === seed);
  catalogFor(ctx, { ...template, seed }, known ? known.ticks : template.maxTicks, tDynamic(exact ? "goal.replay.label.seed" : "goal.replay.label.seedOffRun", { seed }));
}

/**
 * Rebuild a replicate from the last run's start state, step it to its recorded end, and hand that
 * end state to the explorer. Stepping is chunked with a zero timeout so the page stays responsive.
 */
function catalogFor(ctx: GoalContext, config: TrialConfig, ticks: number, label: string): void {
  const run = ctx.state.lastRun;
  if (!run) {
    ctx.status(tDynamic("goal.catalog.noRun"));
    return;
  }
  if (ctx.state.rebuilding) {
    ctx.status(tDynamic("goal.catalog.rebuilding"));
    return;
  }
  const total = Math.max(0, Math.round(ticks));
  const w = worldForTrial(run.snapshot, config);
  ctx.state.rebuilding = true;
  ctx.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
  const o = config.overrides ?? {};
  showReplayInfo(ctx, tDynamic("goal.catalog.buildingInfo", {
    label,
    start: run.label,
    tick: w.tick,
    population: w.organisms.length,
    seed: config.seed,
    mutation: o.mutationRate ?? w.params.mutationRate,
    popMax: o.maxPopulation ?? w.params.maxPopulation,
    total,
  }));
  ctx.status(tDynamic("goal.catalog.progress", { label, done: 0, total }));
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
      ctx.state.rebuilding = false;
      const msg = (err instanceof Error ? err.message : String(err)).replace(/</g, "&lt;");
      showReplayInfo(ctx, `<span class="dead">${tDynamic("goal.catalog.interrupted", { label, done, error: msg })}</span>`);
      ctx.status(tDynamic("goal.catalog.failed", { label, done, error: msg }));
      return;
    }
    ctx.status(tDynamic("goal.catalog.progress", { label, done, total }));
    if (done < total && w.organisms.length > 0) {
      window.setTimeout(chunk, 0);
      return;
    }
    ctx.state.rebuilding = false;
    const note = w.organisms.length > 0 ? "" : done < total ? tDynamic("goal.catalog.noteExtinct", { done, total }) : tDynamic("goal.catalog.noteNoSurvivor");
    showReplayInfo(ctx, tDynamic("goal.catalog.rebuiltInfo", { label, tick: w.tick, population: w.organisms.length, note }));
    ctx.openCatalog(w.snapshot());
    ctx.status(tDynamic("goal.catalog.rebuilt", { label, tick: w.tick }));
  };
  chunk();
}

/* ---------- wiring ---------- */

/** The stored-runs table: manifest export, removal, replay and "open the final state". */
export function bindHistory(ctx: GoalContext): void {
  const state = ctx.state;
  const historyBody = ctx.q("#history-body");
  historyBody.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const manifestBtn = target.closest<HTMLElement>("[data-history-manifest]");
    if (manifestBtn?.dataset.historyManifest) {
      void exportHistoryManifest(ctx, manifestBtn.dataset.historyManifest);
      return;
    }
    const removeBtn = target.closest<HTMLElement>("[data-history-remove]");
    if (removeBtn?.dataset.historyRemove) {
      void removeHistory(ctx, removeBtn.dataset.historyRemove);
      return;
    }
    const replayBtn = target.closest<HTMLElement>("[data-history-replay]");
    if (replayBtn?.dataset.historyReplay) {
      const record = state.historyRecords.find((r) => r.id === replayBtn.dataset.historyReplay);
      if (record) replayRecord(ctx, record);
      return;
    }
    const openBtn = target.closest<HTMLElement>("[data-history-open]");
    if (openBtn?.dataset.historyOpen) {
      const record = state.historyRecords.find((r) => r.id === openBtn.dataset.historyOpen);
      const snapshot = record?.results[0]?.snapshot;
      if (record && snapshot) {
        ctx.restoreInto("B", snapshot);
        ctx.status(tDynamic("goal.history.opened", { name: record.name }));
      } else {
        ctx.status(tDynamic("goal.history.noFinalState"));
      }
    }
  });
  historyBody.addEventListener("change", (ev) => {
    const target = ev.target as HTMLInputElement;
    if (target.dataset.historyPick) {
      const id = target.dataset.historyPick;
      state.historySelected = target.checked
        ? [...state.historySelected.filter((x) => x !== id), id].slice(-4)
        : state.historySelected.filter((x) => x !== id);
      renderHistory(ctx);
      return;
    }
    if (target.dataset.historyNote) void updateHistoryNote(ctx, target.dataset.historyNote, target.value);
  });
  void refreshHistory(ctx);
}

/** The typed-seed replay controls at the bottom of the goal block. */
export function bindReplay(ctx: GoalContext): void {
  ctx.q("#btn-replay-seed").addEventListener("click", () => {
    const seed = parseSeed(ctx.q<HTMLInputElement>("#replay-seed").value);
    if (seed === null) {
      ctx.status(SEED_HINT);
      showReplayInfo(ctx, `<span class="dead">${SEED_HINT}</span>`);
      ctx.q("#replay-seed").focus();
      return;
    }
    replaySeed(ctx, seed);
  });
  ctx.q("#btn-catalog-seed").addEventListener("click", () => {
    const seed = parseSeed(ctx.q<HTMLInputElement>("#replay-seed").value);
    if (seed === null) {
      ctx.status(SEED_HINT);
      showReplayInfo(ctx, `<span class="dead">${SEED_HINT}</span>`);
      ctx.q("#replay-seed").focus();
      return;
    }
    catalogSeed(ctx, seed);
  });
  ctx.q("#replay-seed").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") ctx.q("#btn-replay-seed").click();
  });
}
