/**
 * Expérience tab additions: local presets (IndexedDB) and goal-directed
 * multi-replicate runs. The user picks a start state (active world or a
 * preset), a measurable goal, and run parameters; replicates run in workers
 * and report the tick at which the goal was reached.
 */
import { drawTrialSeries } from "../render/charts";
import {
  FIELD_NAMES,
  TRAIT_NAMES,
  World,
  replicateSeeds,
  summarizeTrials,
  type FieldName,
  type Goal,
  type GoalMetric,
  type Strain,
  type TraitName,
  type TrialConfig,
  type TrialResult,
  type WorldSnapshot,
} from "../sim/index";
import { runReplicates, type RunHandle } from "./goalRunner";
import { TRAIT_LABEL } from "./labels";
import { icon } from "./layout";
import { PresetStore, type PresetMeta } from "./presetStore";

export interface GoalPanelOptions {
  status(msg: string): void;
  world(): World;
  activeWorld(): "A" | "B";
  /** Restore a snapshot into the active world or into world B (and show it). */
  restoreInto(target: "active" | "B", snapshot: WorldSnapshot): void;
}

const FIELD_LABEL: Record<FieldName, string> = { nutrient: "nutriments", toxin: "toxines", temperature: "température", light: "lumière" };

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
  { id: "toxin", label: "Adaptation aux toxines : 50 % des organismes en zone toxique (≥ 0,3), 10 pas", metric: "share:toxin", fieldMin: 0.3, op: ">=", target: 0.5, sustain: 10 },
  { id: "resist", label: "Résistance moyenne ≥ 0,5", metric: "trait:resist:mean", op: ">=", target: 0.5, sustain: 5 },
  { id: "heat", label: "Colonisation d’une zone chaude (T ≥ 0,8) par 30 %", metric: "share:temperature", fieldMin: 0.8, op: ">=", target: 0.3, sustain: 10 },
  { id: "photo", label: "Passage à la photosynthèse : photo moyenne ≥ 0,6", metric: "trait:photo:mean", op: ">=", target: 0.6, sustain: 5 },
  { id: "pop", label: "Population ≥ 300", metric: "population", op: ">=", target: 300, sustain: 1 },
  { id: "diversity", label: "Diversité H′ ≥ 2", metric: "shannon", op: ">=", target: 2, sustain: 20 },
];

function metricOptions(strains: Strain[]): string {
  const g = (label: string, items: string) => `<optgroup label="${label}">${items}</optgroup>`;
  const traits = TRAIT_NAMES.filter((t) => t !== "hue").map((t) => `<option value="trait:${t}:mean">${TRAIT_LABEL[t]} (moyenne)</option><option value="trait:${t}:max">${TRAIT_LABEL[t]} (max)</option>`).join("");
  const fields = FIELD_NAMES.map((f) => `<option value="share:${f}">Part des organismes où ${FIELD_LABEL[f]} ≥ seuil</option>`).join("");
  const strainOpts = strains.map((s) => `<option value="strain-share:${s.id}">Part de « ${s.name} »</option><option value="strain-count:${s.id}">Effectif de « ${s.name} »</option>`).join("");
  return (
    g("Population", `<option value="population">Population</option><option value="lineages">Lignées vivantes</option><option value="shannon">Diversité H′</option><option value="meanFitness">Fitness moyenne</option>`) +
    g("Occupation d’une zone", fields) +
    g("Traits", traits) +
    (strainOpts ? g("Souches", strainOpts) : "")
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
  const name = (id: number) => strains.find((s) => s.id === id)?.name ?? `souche ${id}`;
  const what =
    m.kind === "population" ? "population"
      : m.kind === "lineages" ? "lignées vivantes"
        : m.kind === "shannon" ? "diversité H′"
          : m.kind === "meanFitness" ? "fitness moyenne"
            : m.kind === "trait" ? `${TRAIT_LABEL[m.trait]} (${m.stat === "max" ? "max" : "moyenne"})`
              : m.kind === "share-in-field" ? `part des organismes où ${FIELD_LABEL[m.field]} ≥ ${m.min}`
                : m.kind === "strain-share" ? `part de « ${name(m.strainId)} »`
                  : `effectif de « ${name(m.strainId)} »`;
  const sustain = goal.sustain > 1 ? ` pendant ${goal.sustain} pas` : "";
  return `${what} ${goal.op === ">=" ? "≥" : "≤"} ${goal.target}${sustain}`;
}

function template(): string {
  return `
    <section class="block" id="preset-block">
      <div class="section-heading"><h2>Préréglages</h2><span class="tag">LOCAL</span></div>
      <p class="muted">État complet du monde actif (champs, terrain, organismes, souches, historique), conservé dans ce navigateur. Sert de point de départ aux expériences ciblées.</p>
      <div class="row"><input id="preset-name" type="text" placeholder="Nom du préréglage" maxlength="40"><button type="button" id="btn-preset-save" class="primary">${icon("save")}Enregistrer l’état actuel</button></div>
      <div id="preset-list" class="feed preset-list"></div>
    </section>
    <section class="block" id="goal-block">
      <div class="section-heading"><h2>Expérience ciblée</h2><span class="tag">MULTI-SIMULATION</span></div>
      <p class="muted">Depuis un état de départ, lance n réplicats en arrière-plan avec des graines différentes et mesure le pas auquel l’objectif est atteint.</p>
      <label class="tiny" for="goal-source">État de départ</label>
      <select id="goal-source"><option value="current">Monde actif</option></select>
      <label class="tiny" for="goal-example">Objectifs types</label>
      <select id="goal-example"><option value="">Choisir un exemple…</option>${TEMPLATES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}</select>
      <label class="tiny" for="goal-metric">Mesure</label>
      <div class="goal-row">
        <select id="goal-metric"></select>
        <input id="goal-field-min" type="number" step="0.05" min="0" value="0.3" aria-label="Seuil du champ" title="Seuil du champ">
      </div>
      <div class="goal-row">
        <select id="goal-op" aria-label="Comparaison"><option value=">=">≥</option><option value="<=">≤</option></select>
        <input id="goal-target" type="number" step="0.05" value="0.5" aria-label="Valeur cible">
        <span class="tiny">maintenu</span><input id="goal-sustain" type="number" min="1" max="500" step="1" value="10" aria-label="Pas consécutifs"><span class="tiny">pas</span>
      </div>
      <div id="goal-text" class="micro"></div>
      <div class="goal-config">
        <label>Réplicats<input id="goal-reps" type="number" min="1" max="32" step="1" value="6"></label>
        <label>Pas max<input id="goal-max" type="number" min="10" max="20000" step="10" value="600"></label>
        <label>Graine<input id="goal-seed" type="number" min="1" step="1"></label>
        <label>Taux de mutation<input id="goal-mut" type="number" min="0" max="1" step="0.01"></label>
        <label>Pop. max<input id="goal-popmax" type="number" min="16" max="20000" step="10"></label>
        <label class="goal-check"><input id="goal-disturb" type="checkbox"> Perturbations</label>
      </div>
      <div class="row"><button type="button" id="btn-goal-run" class="primary">${icon("play")}Lancer les réplicats</button><button type="button" id="btn-goal-stop" disabled>Arrêter</button><button type="button" id="btn-goal-csv" class="quiet" disabled>${icon("save")}CSV</button></div>
      <div id="goal-progress" class="goal-progress"></div>
      <div id="goal-summary" class="goal-summary"></div>
      <div class="chart-card goal-chart"><div class="chart-heading"><h3>Mesure par réplicat</h3><span id="goal-chart-note"></span></div><canvas id="chart-goal" role="img" aria-label="Évolution de la mesure pour chaque réplicat"></canvas></div>
      <div id="goal-results" class="feed goal-results"></div>
    </section>`;
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
  private lastStrains: Strain[] = [];
  private lastMetricKey = "";

  constructor(root: HTMLElement, opts: GoalPanelOptions) {
    this.root = root;
    this.opts = opts;
    root.innerHTML = template();
    this.q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.bind();
    this.refreshMetricOptions(true);
    this.syncDefaults();
    void this.refreshPresets();
  }

  /** Called on the UI refresh cadence: keep strain-based options and defaults fresh. */
  refresh(): void {
    if (this.root.closest("[role=tabpanel]")?.hasAttribute("hidden")) return;
    this.refreshMetricOptions(false);
    const src = this.q<HTMLSelectElement>("#goal-source");
    const w = this.opts.world();
    src.options[0]!.textContent = `Monde ${this.opts.activeWorld()} actuel · pas ${w.tick} · ${w.organisms.length} organismes`;
  }

  layout(): void {
    this.drawChart();
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
  }

  private toggleFieldMin(): void {
    const isShare = this.q<HTMLSelectElement>("#goal-metric").value.startsWith("share:");
    this.q("#goal-field-min").hidden = !isShare;
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

  private updateGoalText(): void {
    const g = this.currentGoal();
    this.q("#goal-text").textContent = g ? `Objectif : ${describeGoal(g, this.lastStrains)}.` : "Objectif incomplet.";
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
      list.innerHTML = `<p class="muted">Aucun préréglage enregistré.</p>`;
    } else {
      list.innerHTML = this.presets
        .map((p) => `<div class="feed-row preset-row" data-id="${p.id}">
            <div class="feed-head"><b>${p.name.replace(/</g, "&lt;")}</b></div>
            <div class="muted">Monde ${p.world} · pas ${p.tick} · ${p.population} organismes · ${p.width}×${p.height} · ${new Date(p.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</div>
            <div class="row preset-ops"><button type="button" data-act="load" data-id="${p.id}">Charger</button><button type="button" data-act="target" data-id="${p.id}">Point de départ</button><button type="button" class="quiet" data-act="remove" data-id="${p.id}" aria-label="Supprimer le préréglage">×</button></div>
          </div>`)
        .join("");
    }
    const src = this.q<HTMLSelectElement>("#goal-source");
    const prev = src.value;
    src.innerHTML = `<option value="current">Monde actif</option>` + this.presets.map((p) => `<option value="${p.id}">${p.name.replace(/</g, "&lt;")} · pas ${p.tick}</option>`).join("");
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
    this.opts.status(`Préréglage « ${meta.name} » enregistré (${meta.population} organismes, pas ${meta.tick}).`);
  }

  private async startSnapshot(): Promise<{ snapshot: WorldSnapshot; label: string } | null> {
    const id = this.q<HTMLSelectElement>("#goal-source").value;
    if (id === "current") return { snapshot: this.opts.world().snapshot(), label: `monde ${this.opts.activeWorld()}` };
    const rec = await this.store.load(id);
    if (!rec) {
      this.opts.status("Préréglage introuvable.");
      return null;
    }
    return { snapshot: rec.snapshot, label: rec.name };
  }

  /* ---------- runs ---------- */

  private async run(): Promise<void> {
    if (this.handle) return;
    const goal = this.currentGoal();
    if (!goal) {
      this.opts.status("Objectif incomplet : choisissez une mesure et une valeur cible.");
      return;
    }
    const start = await this.startSnapshot();
    if (!start) return;
    if (start.snapshot.organisms.length === 0) {
      this.opts.status("L’état de départ ne contient aucun organisme.");
      return;
    }
    const reps = Math.max(1, Math.min(32, Math.round(Number(this.q<HTMLInputElement>("#goal-reps").value) || 1)));
    const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
    const seed = Math.round(Number(this.q<HTMLInputElement>("#goal-seed").value)) >>> 0 || 1;
    const mutationRate = Math.max(0, Math.min(1, Number(this.q<HTMLInputElement>("#goal-mut").value)));
    const maxPopulation = Math.max(16, Math.round(Number(this.q<HTMLInputElement>("#goal-popmax").value) || 16));
    const disturbances = this.q<HTMLInputElement>("#goal-disturb").checked;
    const sampleEvery = Math.max(1, Math.round(maxTicks / 80));
    const configs: TrialConfig[] = replicateSeeds(seed, reps).map((s, i) => ({
      seed: s,
      maxTicks,
      sampleEvery,
      overrides: { mutationRate, maxPopulation, disturbances },
      keepSnapshot: i < 8,
    }));
    this.lastGoal = goal;
    this.results = new Array(reps);
    this.progress = new Array(reps).fill(0);
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-csv").disabled = true;
    this.q("#goal-summary").innerHTML = "";
    this.q("#goal-results").innerHTML = "";
    this.renderProgress(maxTicks);
    this.opts.status(`${reps} réplicats lancés depuis ${start.label} : ${describeGoal(goal, this.lastStrains)}.`);
    const t0 = performance.now();
    this.handle = runReplicates(start.snapshot, goal, configs, {
      onProgress: (i, tick) => {
        this.progress[i] = tick - start.snapshot.tick;
        this.renderProgress(maxTicks);
      },
      onResult: (i, r) => {
        this.results[i] = r;
        this.progress[i] = r.ticks;
        this.renderProgress(maxTicks);
        this.renderResults();
      },
    });
    const all = await this.handle.promise;
    this.handle = null;
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = false;
    this.q<HTMLButtonElement>("#btn-goal-stop").disabled = true;
    this.q<HTMLButtonElement>("#btn-goal-csv").disabled = all.length === 0;
    this.renderResults();
    const s = summarizeTrials(all);
    this.opts.status(`Réplicats terminés en ${((performance.now() - t0) / 1000).toFixed(1)} s : ${s.successes}/${s.n} atteignent l’objectif${s.medianTicks !== null ? ` (médiane ${s.medianTicks} pas)` : ""}.`);
  }

  private renderProgress(maxTicks: number): void {
    const host = this.q("#goal-progress");
    host.innerHTML = this.progress
      .map((p, i) => {
        const r = this.results[i];
        const cls = r ? (r.reachedTick !== null ? "hit" : r.extinct ? "dead" : "miss") : "";
        const pct = Math.min(100, (p / maxTicks) * 100);
        return `<span class="goal-bar ${cls}" title="Réplicat ${i + 1}"><i style="width:${pct.toFixed(0)}%"></i></span>`;
      })
      .join("");
  }

  private renderResults(): void {
    const done = this.results.filter(Boolean);
    const goal = this.lastGoal;
    if (!goal) return;
    const s = summarizeTrials(done);
    const fmtT = (v: number | null) => (v === null ? "—" : `${Math.round(v)} pas`);
    this.q("#goal-summary").innerHTML = done.length
      ? `<div class="goal-stats">
          <span>Réussite<b>${s.successes}/${s.n}</b></span>
          <span>Médiane<b>${fmtT(s.medianTicks)}</b></span>
          <span>Min – max<b>${s.minTicks === null ? "—" : `${s.minTicks} – ${s.maxTicks}`}</b></span>
          <span>Extinctions<b>${s.extinctions}</b></span>
        </div>`
      : "";
    this.q("#goal-results").innerHTML = this.results
      .map((r, i) => {
        if (!r) return `<div class="feed-row goal-row-pending"><div class="feed-head">#${i + 1} · en cours…</div></div>`;
        const outcome = r.reachedTick !== null ? `<b class="hit">atteint au pas ${r.reachedTick - r.startTick}</b>` : r.extinct ? `<b class="dead">extinction au pas ${r.ticks}</b>` : `<b class="miss">non atteint en ${r.ticks} pas</b>`;
        const open = r.snapshot ? `<button type="button" class="quiet" data-open="${i}">Ouvrir dans B</button>` : "";
        return `<div class="feed-row goal-result"><div class="feed-head">#${i + 1} · graine ${r.seed} · ${outcome}</div><div class="muted">Valeur finale ${r.finalValue.toFixed(3)} · ${r.finalPopulation} organismes</div>${open}</div>`;
      })
      .join("");
    this.drawChart();
  }

  private drawChart(): void {
    const canvas = this.q<HTMLCanvasElement>("#chart-goal");
    const cw = canvas.parentElement!.clientWidth - 28;
    if (cw <= 0) return;
    const runs = this.results.filter(Boolean).map((r) => ({ series: r.series, reached: r.reachedTick !== null }));
    drawTrialSeries(canvas, cw, 120, runs, this.lastGoal?.target ?? null);
    this.q("#goal-chart-note").textContent = runs.length ? `${runs.length} réplicat${runs.length > 1 ? "s" : ""} · cible en pointillé` : "";
  }

  private exportCsv(): void {
    const rows = [["replicate", "seed", "reached_tick", "ticks_run", "final_value", "final_population", "extinct"]];
    this.results.forEach((r, i) => {
      if (r) rows.push([String(i + 1), String(r.seed), r.reachedTick === null ? "" : String(r.reachedTick - r.startTick), String(r.ticks), r.finalValue.toFixed(4), String(r.finalPopulation), r.extinct ? "1" : "0"]);
    });
    const text = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-goal-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private bind(): void {
    this.q("#btn-preset-save").addEventListener("click", () => void this.savePreset());
    this.q("#preset-list").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("button[data-act]");
      if (!btn) return;
      const id = btn.dataset.id!;
      const act = btn.dataset.act;
      if (act === "target") {
        this.q<HTMLSelectElement>("#goal-source").value = id;
        this.opts.status("Point de départ sélectionné pour l’expérience ciblée.");
      } else if (act === "load") {
        void this.store.load(id).then((rec) => {
          if (!rec) return;
          this.opts.restoreInto("active", rec.snapshot);
          this.opts.status(`Préréglage « ${rec.name} » chargé dans le monde ${this.opts.activeWorld()}.`);
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
    this.q("#btn-goal-run").addEventListener("click", () => void this.run());
    this.q("#btn-goal-stop").addEventListener("click", () => {
      this.handle?.cancel();
      this.opts.status("Réplicats arrêtés.");
    });
    this.q("#btn-goal-csv").addEventListener("click", () => this.exportCsv());
    this.q("#goal-results").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-open]");
      if (!btn) return;
      const r = this.results[Number(btn.dataset.open)];
      if (r?.snapshot) {
        this.opts.restoreInto("B", r.snapshot);
        this.opts.status(`État final du réplicat ${Number(btn.dataset.open) + 1} ouvert dans le monde B.`);
      }
    });
  }
}
