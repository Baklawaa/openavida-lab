/**
 * Expérience tab additions: local presets (IndexedDB) and goal-directed
 * multi-replicate runs. The user picks a start state (active world or a
 * preset), a measurable goal, and run parameters; replicates run in workers
 * and report the tick at which the goal was reached.
 */
import { drawSweep, drawTrialSeries } from "../render/charts";
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
  worldForTrial,
  type FieldName,
  type Goal,
  type GoalMetric,
  type Recipe,
  type Strain,
  type SweepPoint,
  type SweepVariable,
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
  /** Replace world B with a start state and start playing it, so a replicate is watched from its first step. */
  replayInto(snapshot: WorldSnapshot): void;
  setRecording(on: boolean): void;
  applyRecipe(recipe: Recipe, target: "active" | "B"): void;
}

/** Replicate ceilings: runs are long but the UI must stay responsive, so rendering is throttled and capped. */
export const MAX_REPLICATES = 5000;
export const MAX_SWEEP_REPLICATES = 500;
const MAX_CHART_SERIES = 100;
const RENDER_INTERVAL_MS = 200;
/** The full result table is rebuilt at most this often while a run is in progress (always once at the end). */
const TABLE_INTERVAL_MS = 1000;

export type ResultSort = "launch" | "hit-fast" | "hit-slow" | "fail-fast" | "fail-slow" | "value-desc" | "pop-desc";
export const RESULT_SORTS: Array<{ id: ResultSort; label: string }> = [
  { id: "hit-fast", label: "Réussis, les plus rapides d’abord" },
  { id: "hit-slow", label: "Réussis, les plus lents d’abord" },
  { id: "fail-fast", label: "Échoués, les plus rapides d’abord (extinction / impossible tôt)" },
  { id: "fail-slow", label: "Échoués, les plus lents d’abord" },
  { id: "value-desc", label: "Valeur finale décroissante" },
  { id: "pop-desc", label: "Population finale décroissante" },
  { id: "launch", label: "Ordre de lancement" },
];

/** Seeds are unsigned 32-bit: digits only, 1 … 4294967295. Returns null otherwise (never silently truncates). */
export function parseSeed(text: string): number | null {
  const t = text.trim().replace(/[\s_'’]/g, "");
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 0xffffffff ? n : null;
}
export const SEED_HINT = "Graine invalide : un entier entre 1 et 4294967295, tel qu’affiché dans le tableau ou la colonne seed du CSV.";

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

const FIELD_LABEL: Record<FieldName, string> = { nutrient: "nutriments", toxin: "toxines", temperature: "température", light: "lumière" };

const SWEEP_LABEL: Record<SweepVariable, string> = {
  mutationRate: "Taux de mutation",
  maxPopulation: "Population maximale",
  reproduceEnergy: "Seuil énergétique de reproduction",
  toxinScale: "Échelle des toxines",
  nutrientScale: "Échelle des nutriments",
  temperatureScale: "Échelle de température",
  lightScale: "Échelle de lumière",
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
    <section class="block" id="recipe-block">
      <div class="section-heading"><h2>Recette</h2><span class="tag" id="recipe-ops">0 ACTIONS</span></div>
      <p class="muted">Séquence rejouable : paramètres plus peindre, placer, injecter, définir une souche, avancer. Encodée en <span class="mono">?recipe=</span> (base64url). Au-delà de 6000 caractères, le lien ne conserve que les paramètres.</p>
      <label class="toggle-inline" id="opt-recipe-record"><input type="checkbox" checked> Enregistrer les actions</label>
      <div class="row recipe-ops">
        <button type="button" id="btn-recipe-copy">${icon("share")}Copier le lien de la recette</button>
        <button type="button" id="btn-recipe-export">${icon("save")}Exporter .json</button>
        <button type="button" id="btn-recipe-import">Importer .json</button>
        <button type="button" id="btn-recipe-replay">Rejouer dans B</button>
      </div>
      <input id="recipe-file" type="file" accept="application/json,.json" hidden>
    </section>
    <section class="block" id="goal-block">
      <div class="section-heading"><h2>Expérience ciblée</h2><span class="tag">MULTI-SIMULATION</span></div>
      <p class="muted">Depuis un état de départ, n réplicats à graines différentes courent en arrière-plan. Chacun s’arrête au pas où l’objectif est atteint, à l’extinction, ou au bout du budget.</p>

      <div class="goal-step">
        <span class="eyebrow">1 · ÉTAT DE DÉPART</span>
        <select id="goal-source"><option value="current">Monde actif</option></select>
      </div>

      <div class="goal-step">
        <span class="eyebrow">2 · OBJECTIF</span>
        <select id="goal-example"><option value="">Choisir un objectif type…</option>${TEMPLATES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}</select>
        <label class="tiny" for="goal-metric">Mesure</label>
        <select id="goal-metric"></select>
        <div id="goal-field-min-row" class="goal-field">
          <label class="tiny" for="goal-field-min">Seuil du champ : un organisme compte si sa cellule atteint cette valeur</label>
          <input id="goal-field-min" type="number" step="0.05" min="0" value="0.3">
        </div>
        <label class="tiny">Condition</label>
        <div class="goal-row">
          <select id="goal-op" aria-label="Comparaison"><option value=">=">≥</option><option value="<=">≤</option></select>
          <input id="goal-target" type="number" step="0.05" value="0.5" aria-label="Valeur cible">
          <span class="tiny">maintenu</span><input id="goal-sustain" type="number" min="1" max="500" step="1" value="10" aria-label="Pas consécutifs"><span class="tiny">pas</span>
        </div>
        <div id="goal-text" class="micro"></div>
      </div>

      <div class="goal-step">
        <span class="eyebrow">3 · PARAMÈTRES DE LA COURSE</span>
        <div class="goal-config">
          <label>Réplicats<input id="goal-reps" type="number" min="1" max="5000" step="1" value="6"></label>
          <label>Pas max par réplicat<input id="goal-max" type="number" min="10" max="20000" step="10" value="600"></label>
          <label>Taux de mutation<input id="goal-mut" type="number" min="0" max="1" step="0.01"></label>
          <label>Population max<input id="goal-popmax" type="number" min="16" max="20000" step="10"></label>
          <label>Graine du 1er réplicat<input id="goal-seed" type="text" inputmode="numeric" pattern="[0-9]*" spellcheck="false"></label>
          <label class="goal-check"><input id="goal-disturb" type="checkbox"> Perturbations</label>
        </div>
        <p class="micro">Les réplicats reçoivent les graines graine, graine + 1, graine + 2, … Elles figurent dans le tableau des résultats et dans la colonne seed du CSV.</p>
        <div class="row"><button type="button" id="btn-goal-run" class="primary">${icon("play")}Lancer les réplicats</button><button type="button" id="btn-goal-stop" disabled>Arrêter</button><button type="button" id="btn-goal-csv" class="quiet" disabled>${icon("save")}CSV</button></div>
        <div id="goal-progress" class="goal-progress"></div>
      </div>

      <div class="goal-step">
        <span class="eyebrow">4 · RÉSULTATS</span>
        <div id="goal-summary" class="goal-summary"></div>
        <div class="chart-card goal-chart"><div class="chart-heading"><h3>Mesure par réplicat</h3><span id="goal-chart-note"></span></div><canvas id="chart-goal" role="img" aria-label="Évolution de la mesure pour chaque réplicat"></canvas></div>
        <div class="goal-table-head"><label class="tiny" for="goal-sort">Trier</label><select id="goal-sort">${RESULT_SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}</select><span id="goal-table-note" class="tiny"></span></div>
        <div id="goal-results" class="goal-results"></div>
      </div>

      <div class="goal-step" id="replay-step">
        <span class="eyebrow">5 · REJOUER UN RÉPLICAT DANS LE MONDE B</span>
        <p class="micro">Collez la graine d’un réplicat (tableau ci-dessus, ou colonne seed du CSV). Le monde B est reconstruit à l’état de départ de la dernière course, avec cette graine et les paramètres de la course, puis la lecture démarre : la simulation reproduit le réplicat pas pour pas. Un nouveau clic repart du début.</p>
        <div class="row replay-row"><input id="replay-seed" type="text" inputmode="numeric" pattern="[0-9]*" spellcheck="false" placeholder="Graine du réplicat"><button type="button" id="btn-replay-seed" class="primary">${icon("play")}Rejouer dans B</button></div>
        <div id="replay-info" class="replay-info" hidden></div>
      </div>

      <div class="section-heading" style="margin-top:18px"><h2>Balayage</h2><span class="tag">PARAMÈTRE</span></div>
      <p class="muted">Répète l’objectif pour une grille linéaire d’une variable (ex. échelle des toxines). Les graines se suivent d’une valeur à l’autre.</p>
      <label class="tiny" for="sweep-var">Variable</label>
      <select id="sweep-var">${SWEEP_VARIABLES.map((v) => `<option value="${v}"${v === "toxinScale" ? " selected" : ""}>${SWEEP_LABEL[v]}</option>`).join("")}</select>
      <div class="goal-config">
        <label>De<input id="sweep-from" type="number" step="0.05" value="0.25"></label>
        <label>À<input id="sweep-to" type="number" step="0.05" value="2"></label>
        <label>Points<input id="sweep-steps" type="number" min="2" max="16" step="1" value="5"></label>
        <label>Réplicats / valeur<input id="sweep-reps" type="number" min="1" max="500" step="1" value="4"></label>
      </div>
      <div class="row"><button type="button" id="btn-sweep-run">${icon("play")}Lancer le balayage</button><button type="button" id="btn-sweep-csv" class="quiet" disabled>${icon("save")}CSV du balayage</button></div>
      <div id="sweep-table"></div>
      <div class="chart-card goal-chart"><div class="chart-heading"><h3>Pas jusqu’à l’objectif vs valeur</h3><span id="sweep-chart-note"></span></div><canvas id="chart-sweep" role="img" aria-label="Médiane et étendue des pas jusqu’à l’objectif selon la variable"></canvas></div>
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
  /** Start state and configs of the last run or sweep, for exact replays. */
  private lastRun: { snapshot: WorldSnapshot; label: string; configs: TrialConfig[] } | null = null;
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
    this.results = rec.results.slice();
    this.progress = rec.results.map((r) => r.ticks);
    this.renderProgress(rec.maxTicks);
    this.lastTableRender = 0;
    this.renderResults();
    this.q<HTMLButtonElement>("#btn-goal-csv").disabled = false;
    const when = new Date(rec.savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    this.q("#goal-table-note").textContent = `${rec.results.length} réplicats · course du ${when} restaurée · depuis ${rec.label}`;
    this.opts.status(`Dernière course restaurée (${rec.results.length} réplicats depuis ${rec.label}, ${when}) : tableau, tri et rejeu disponibles.`);
  }

  /** Called on the UI refresh cadence: keep strain-based options and defaults fresh. */
  refresh(): void {
    if (this.root.closest("[role=tabpanel]")?.hasAttribute("hidden")) return;
    this.refreshMetricOptions(false);
    const src = this.q<HTMLSelectElement>("#goal-source");
    const w = this.opts.world();
    src.options[0]!.textContent = `Monde ${this.opts.activeWorld()} actuel · pas ${w.tick} · ${w.organisms.length} organismes`;
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
    const reps = Math.max(1, Math.min(MAX_REPLICATES, Math.round(Number(this.q<HTMLInputElement>("#goal-reps").value) || 1)));
    const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
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
    const configs: TrialConfig[] = replicateSeeds(seed, reps).map((s, i) => ({
      seed: s,
      maxTicks,
      sampleEvery,
      overrides: { mutationRate, maxPopulation, disturbances },
      keepSnapshot: i < 8,
    }));
    this.lastGoal = goal;
    this.lastRun = { snapshot: start.snapshot, label: start.label, configs };
    this.results = new Array(reps);
    this.progress = new Array(reps).fill(0);
    this.q<HTMLButtonElement>("#btn-goal-run").disabled = true;
    this.q<HTMLButtonElement>("#btn-sweep-run").disabled = true;
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
    this.renderProgress(maxTicks);
    this.lastTableRender = 0;
    this.renderResults();
    void this.persistRun(all, maxTicks);
    const s = summarizeTrials(all);
    this.opts.status(`Réplicats terminés en ${((performance.now() - t0) / 1000).toFixed(1)} s : ${s.successes}/${s.n} atteignent l’objectif${s.medianTicks !== null ? ` (médiane ${s.medianTicks} pas)` : ""}.`);
  }

  private async runSweep(): Promise<void> {
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
    const variable = this.q<HTMLSelectElement>("#sweep-var").value as SweepVariable;
    if (!(SWEEP_VARIABLES as readonly string[]).includes(variable)) return;
    const from = Number(this.q<HTMLInputElement>("#sweep-from").value);
    const to = Number(this.q<HTMLInputElement>("#sweep-to").value);
    const steps = Math.max(2, Math.round(Number(this.q<HTMLInputElement>("#sweep-steps").value) || 2));
    const perValue = Math.max(1, Math.min(MAX_SWEEP_REPLICATES, Math.round(Number(this.q<HTMLInputElement>("#sweep-reps").value) || 1)));
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      this.opts.status("Bornes du balayage invalides.");
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
    this.opts.status(`Balayage ${SWEEP_LABEL[variable]} : ${values.length} valeurs × ${perValue} réplicats.`);
    const t0 = performance.now();
    this.handle = runReplicates(start.snapshot, goal, configs, {
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
    this.opts.status(`Balayage terminé en ${((performance.now() - t0) / 1000).toFixed(1)} s · ${values.length} valeurs.`);
  }

  private renderSweepTable(): void {
    const host = this.q("#sweep-table");
    if (!this.sweepPoints.length) {
      host.innerHTML = "";
      return;
    }
    const fmt = (v: number | null) => (v === null ? "—" : String(Math.round(v)));
    host.innerHTML = `<table class="sweep-table"><thead><tr><th>Valeur</th><th>Réussite</th><th>Médiane</th><th>Min–max</th><th>Extinctions</th></tr></thead><tbody>${
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
      ? `${SWEEP_LABEL[this.sweepVar]} · médiane et étendue des pas`
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
        if (active.length < 16) active.push(`<span class="goal-bar" title="Réplicat ${i + 1}"><i style="width:${Math.min(100, (this.progress[i]! / maxTicks) * 100).toFixed(0)}%"></i></span>`);
      }
    }
    const pct = (done / total) * 100;
    host.innerHTML = `<div class="goal-total" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="tiny goal-progress-text">${done}/${total} terminés · <span class="hit">${hit} atteints</span> · ${done - hit - dead - unreachable} non atteints · <span class="dead">${dead} extinctions</span>${unreachable ? ` · ${unreachable} impossibles` : ""}${running ? ` · ${running} en cours` : ""}</div>
      ${active.length ? `<div class="goal-active">${active.join("")}</div>` : ""}`;
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
          <span>P25 – P75<b>${s.p25Ticks === null ? "—" : `${Math.round(s.p25Ticks)} – ${Math.round(s.p75Ticks!)}`}</b></span>
          <span>Min – max<b>${s.minTicks === null ? "—" : `${s.minTicks} – ${s.maxTicks}`}</b></span>
          <span>Extinctions<b>${s.extinctions}</b></span>
          <span>Impossibles<b>${s.unreachable}</b></span>
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
    const cells = pairs.map(([i, r]) => {
      const steps = r.reachedTick !== null ? r.reachedTick - r.startTick : r.ticks;
      const outcome = r.reachedTick !== null
        ? `<span class="hit">atteint</span>`
        : r.extinct ? `<span class="dead">extinction</span>`
          : r.unreachable ? `<span class="dead">impossible</span>`
            : `<span class="miss">non atteint</span>`;
      const open = r.snapshot ? `<button type="button" class="quiet" data-open="${i}" title="État final dans B">fin</button>` : "";
      return `<tr><td class="mono">${i + 1}</td><td class="mono seed" data-replay-seed="${r.seed}" title="Rejouer cette graine dans B">${r.seed}</td><td>${outcome}</td><td class="mono num">${steps}</td><td class="mono num">${r.finalValue.toFixed(3)}</td><td class="mono num">${r.finalPopulation}</td><td class="ops"><button type="button" data-replay="${i}" title="Rejouer dans B">${icon("play")}</button>${open}</td></tr>`;
    });
    host.innerHTML = `<div class="goal-table-wrap"><table class="goal-table"><thead><tr><th>#</th><th>Graine</th><th>Issue</th><th class="num">Pas</th><th class="num">Valeur</th><th class="num">Pop.</th><th></th></tr></thead><tbody>${cells.join("")}</tbody></table></div>`;
    this.q("#goal-table-note").textContent = `${pairs.length} réplicat${pairs.length > 1 ? "s" : ""}`;
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
      ? `${all.length} réplicat${all.length > 1 ? "s" : ""}${runs.length < all.length ? ` (${runs.length} tracés)` : ""} · cible en pointillé`
      : "";
  }

  private exportCsv(): void {
    const rows = [["replicate", "seed", "reached_tick", "ticks_run", "final_value", "final_population", "extinct", "unreachable"]];
    this.results.forEach((r, i) => {
      if (r) rows.push([String(i + 1), String(r.seed), r.reachedTick === null ? "" : String(r.reachedTick - r.startTick), String(r.ticks), r.finalValue.toFixed(4), String(r.finalPopulation), r.extinct ? "1" : "0", r.unreachable ? "1" : "0"]);
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
    this.q("#recipe-ops").textContent = `${n} ACTION${n > 1 ? "S" : ""}`;
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
      this.opts.status("Recette trop longue pour l’URL (> 6000 caractères). Lien des paramètres uniquement.");
    } else {
      this.opts.status("Lien de la recette copié.");
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
    this.opts.status("Recette exportée en JSON.");
  }

  private importRecipeFile(file: File): void {
    void file.text().then((text) => {
      const recipe = parseRecipe(JSON.parse(text) as unknown);
      if (!recipe) {
        this.opts.status("Fichier de recette invalide.");
        return;
      }
      this.opts.applyRecipe(recipe, "active");
      this.opts.status(`Recette importée : ${recipe.ops.length} action${recipe.ops.length > 1 ? "s" : ""}.`);
    }).catch(() => this.opts.status("Import impossible : JSON de recette illisible."));
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
      this.opts.status(`Recette rejouée dans B : ${recipe.ops.length} action${recipe.ops.length > 1 ? "s" : ""}.`);
    });
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
    this.q("#btn-sweep-run").addEventListener("click", () => void this.runSweep());
    this.q("#btn-goal-stop").addEventListener("click", () => {
      this.handle?.cancel();
      this.opts.status("Réplicats arrêtés.");
    });
    this.q("#btn-goal-csv").addEventListener("click", () => this.exportCsv());
    this.q("#btn-sweep-csv").addEventListener("click", () => this.exportSweepCsv());
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
        this.opts.status(`État final du réplicat ${Number(btn.dataset.open) + 1} ouvert dans le monde B.`);
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
          () => this.opts.status("Graines des réplicats réussis copiées."),
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
    this.q("#replay-seed").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") this.q("#btn-replay-seed").click();
    });
  }

  /* ---------- replays ---------- */

  private successSeedsHtml(): string {
    const hits = this.results.filter((r) => r && r.reachedTick !== null);
    if (!hits.length) return "";
    const shown = hits.slice(0, 60);
    return `<div class="seed-chips"><span class="eyebrow">GRAINES RÉUSSIES</span>${shown
      .map((r) => `<button type="button" class="seed-chip" data-replay-seed="${r.seed}" title="Rejouer ce réplicat dans B (atteint au pas ${r.reachedTick! - r.startTick})">${r.seed}</button>`)
      .join("")}${hits.length > shown.length ? `<span class="tiny">+${hits.length - shown.length} dans le CSV</span>` : ""}<button type="button" id="btn-copy-seeds" class="quiet">${icon("copy")}Copier</button></div>`;
  }

  private replayIndex(i: number): void {
    const cfg = this.lastRun?.configs[i];
    if (!this.lastRun || !cfg) return;
    this.replay(cfg, `réplicat ${i + 1}`);
  }

  /** Replay a seed with the last run's start state and parameters (or the current form when nothing ran yet). */
  private replaySeed(seed: number): void {
    if (this.lastRun) {
      const exact = this.lastRun.configs.find((c) => c.seed === seed);
      const template = exact ?? this.lastRun.configs[0];
      if (!template) return;
      this.replay({ ...template, seed }, exact ? `graine ${seed}` : `graine ${seed} (hors de la dernière course)`);
      return;
    }
    void this.startSnapshot().then((start) => {
      if (!start) return;
      const maxTicks = Math.max(10, Math.round(Number(this.q<HTMLInputElement>("#goal-max").value) || 100));
      const mutationRate = Math.max(0, Math.min(1, Number(this.q<HTMLInputElement>("#goal-mut").value)));
      const maxPopulation = Math.max(16, Math.round(Number(this.q<HTMLInputElement>("#goal-popmax").value) || 16));
      const disturbances = this.q<HTMLInputElement>("#goal-disturb").checked;
      this.lastRun = { snapshot: start.snapshot, label: start.label, configs: [] };
      this.replay({ seed, maxTicks, sampleEvery: 1, overrides: { mutationRate, maxPopulation, disturbances } }, `graine ${seed}`);
    });
  }

  private replay(config: TrialConfig, label: string): void {
    if (!this.lastRun) return;
    const w = worldForTrial(this.lastRun.snapshot, config);
    this.opts.replayInto(w.snapshot());
    this.q<HTMLInputElement>("#replay-seed").value = String(config.seed);
    const known = this.results.find((r) => r && r.seed === config.seed);
    const expected = !known
      ? "Graine hors de la dernière course : pas de résultat de référence."
      : known.reachedTick !== null
        ? `Dans la course, ce réplicat a atteint l’objectif au pas ${known.reachedTick - known.startTick} (pas absolu ${known.reachedTick}).`
        : known.extinct
          ? `Dans la course, ce réplicat s’est éteint après ${known.ticks} pas.`
          : known.unreachable
            ? `Dans la course, l’objectif est devenu impossible après ${known.ticks} pas.`
            : `Dans la course, ce réplicat n’a pas atteint l’objectif en ${known.ticks} pas (valeur finale ${known.finalValue.toFixed(3)}).`;
    const o = config.overrides ?? {};
    this.showReplayInfo(`<b>Monde B relancé, lecture en cours</b> · ${label} · départ ${this.lastRun.label}, pas ${w.tick}, ${w.organisms.length} organismes<br>Graine <span class="mono">${config.seed}</span> · mutation ${o.mutationRate ?? w.params.mutationRate} · pop. max ${o.maxPopulation ?? w.params.maxPopulation} · perturbations ${(o.disturbances ?? w.disturbances) ? "oui" : "non"}<br>${expected}<br>Le monde B rejoue ce réplicat pas pour pas ; Espace met en pause, un nouveau clic sur Rejouer repart du pas ${w.tick}.`);
    this.opts.status(`Monde B : ${label} rejoué (graine ${config.seed}), lecture en cours.`);
  }

  private showReplayInfo(html: string): void {
    const box = this.q("#replay-info");
    box.innerHTML = html;
    box.hidden = false;
  }
}
