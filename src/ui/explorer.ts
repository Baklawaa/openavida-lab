/**
 * Explorateur: a full-size dialog over the active world.
 *
 * - Organismes: every organism, living or dead, grouped by species with
 *   precise filters and sort presets; a detail pane with the organism's
 *   record, phenotype, and its evolutionary branch (lineage chain with the
 *   phenotype-changing mutations, biggest changes marked).
 * - Lignées: the lineage table; a lineage's chain, descendants and members.
 * - Enregistrés: organisms saved locally with their branch and optionally
 *   the whole world they lived in.
 */
import { phenotypeTableHtml } from "../render/genomeBrowser";
import {
  CATALOG_SORTS,
  STRATEGIES,
  STRATEGY_COLOR,
  STRATEGY_LABEL,
  TRAIT_COLOR,
  TRAIT_NAMES,
  World,
  alignSequences,
  ancestry,
  applyFilter,
  biggestChanges,
  buildCatalog,
  catalogRecords,
  descendantLineages,
  groupCatalog,
  organismsUnderLineage,
  sortCatalog,
  subtreeCount,
  type AncestryStep,
  type CatalogEntry,
  type CatalogFilter,
  type CatalogGroupMode,
  type CatalogSort,
  type DeathCause,
  type Liveness,
  type Strategy,
  type TraitName,
  type WorldSnapshot,
} from "../sim/index";
import type { LineageNode } from "../sim/types";
import { LineageTreeView } from "../render/lineageTreeCanvas";
import { layoutLineageTree, lineageStrainMap, type TreeNode } from "../render/lineageTreeLayout";
import { DEATH_LABEL, TRAIT_LABEL } from "./labels";
import { icon } from "./layout";
import type { PresetStore, SavedOrganism, SavedOrganismMeta } from "./presetStore";

export type ExplorerTab = "organisms" | "lineages" | "tree" | "saved";

export interface ExplorerOptions {
  status(msg: string): void;
  world(): World;
  worldSide(): "A" | "B";
  store: PresetStore;
  /** Select an organism in the visible world (living organisms only). */
  selectOrganism(id: number): void;
  highlightLineage(id: number): void;
  loadGenome(seq: string, label: string, opts?: { diffAgainst?: string }): void;
  /** Organism currently selected on the plate, if any. */
  plateSelection(): { id: number; genome: string } | null;
  restoreInto(target: "B", snapshot: WorldSnapshot): void;
}

export interface ExplorerView {
  tab?: ExplorerTab;
  organismId?: number;
  lineageId?: number;
  sort?: CatalogSort;
  filter?: Partial<CatalogFilter>;
}

const MAX_ROWS_PER_GROUP = 150;
const MAX_ROWS_TOTAL = 1500;

function fmt(v: number, d = 3): string {
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function template(): string {
  const sorts = CATALOG_SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  const traits = TRAIT_NAMES.filter((t) => t !== "hue").map((t) => `<option value="${t}">${TRAIT_LABEL[t]}</option>`).join("");
  const causes = (Object.keys(DEATH_LABEL) as DeathCause[]).map((c) => `<option value="${c}">${DEATH_LABEL[c]}</option>`).join("");
  const strategies = STRATEGIES.map((s) => `<option value="${s}">${STRATEGY_LABEL[s]}</option>`).join("");
  return `
    <div class="explorer">
      <header class="explorer-head">
        <h2>${icon("inspect")} Explorateur</h2><span id="ex-world" class="tag"></span>
        <div class="segmented ex-tabs" role="tablist">
          <button type="button" data-etab="organisms" class="active" role="tab" aria-selected="true">Organismes</button>
          <button type="button" data-etab="lineages" role="tab" aria-selected="false">Lignées</button>
          <button type="button" data-etab="tree" role="tab" aria-selected="false">Arbre</button>
          <button type="button" data-etab="saved" role="tab" aria-selected="false">Enregistrés</button>
        </div>
        <span class="spacer"></span>
        <button type="button" id="ex-refresh" class="quiet" title="Relire le monde">${icon("revert")}<span>Actualiser</span></button>
        <button type="button" id="ex-close" class="quiet" aria-label="Fermer l’explorateur">${icon("plus")}<span>Fermer</span></button>
      </header>

      <div class="explorer-body" id="ex-tab-organisms">
        <aside class="explorer-filters">
          <label class="ex-field">Recherche<input id="ex-text" type="text" placeholder="n° 42 · l12 (lignée) · s2 (souche)" spellcheck="false"></label>
          <div class="ex-grid">
            <label class="ex-field">État<select id="ex-liveness"><option value="all">Tous</option><option value="alive">Vivants</option><option value="dead">Morts</option></select></label>
            <label class="ex-field">Regrouper<select id="ex-group"><option value="strain">Souche</option><option value="strategy">Stratégie</option><option value="lineage">Lignée</option><option value="none">Aucun</option></select></label>
            <label class="ex-field">Souche<select id="ex-strain"><option value="">Toutes</option></select></label>
            <label class="ex-field">Stratégie<select id="ex-strategy"><option value="">Toutes</option>${strategies}</select></label>
            <label class="ex-field">Lignée n°<input id="ex-lineage" type="number" min="1" step="1" placeholder="toutes"></label>
            <label class="ex-field">Cause du décès<select id="ex-cause"><option value="">Toutes</option>${causes}</select></label>
            <label class="ex-field">Âge min<input id="ex-age-min" type="number" min="0" step="1"></label>
            <label class="ex-field">Âge max<input id="ex-age-max" type="number" min="0" step="1"></label>
            <label class="ex-field">Tués ≥<input id="ex-kills" type="number" min="0" step="1"></label>
            <label class="ex-field">Descendants ≥<input id="ex-births" type="number" min="0" step="1"></label>
            <label class="ex-field">Fitness ≥<input id="ex-fitness" type="number" step="0.05"></label>
            <label class="ex-field">Génome contient<input id="ex-genome" type="text" placeholder="ACGT…" spellcheck="false"></label>
          </div>
          <label class="ex-field">Trait ≥ valeur<div class="row ex-trait"><select id="ex-trait"><option value="">Aucun</option>${traits}</select><input id="ex-trait-min" type="number" step="0.05" value="0.5"></div></label>
          <label class="ex-field">Tri<select id="ex-sort">${sorts}</select></label>
          <div class="row"><button type="button" id="ex-reset" class="quiet">Réinitialiser les filtres</button></div>
          <div class="ex-records"><span class="eyebrow">RECORDS DU MONDE</span><div id="ex-records"></div></div>
        </aside>
        <section class="explorer-list">
          <div class="ex-count" id="ex-count"></div>
          <div id="ex-groups" class="ex-groups"></div>
        </section>
        <aside class="explorer-detail" id="ex-detail"><p class="muted">Cliquez sur un organisme.</p></aside>
      </div>

      <div class="explorer-body explorer-body-2" id="ex-tab-lineages" hidden>
        <section class="explorer-list">
          <div class="ex-count"><label class="tiny" for="ex-lin-sort">Trier</label> <select id="ex-lin-sort"><option value="count">Effectif vivant</option><option value="peak">Effectif maximal</option><option value="born">Apparition</option><option value="extinct">Extinction</option><option value="subtree">Descendance vivante</option></select> <label class="ex-inline"><input id="ex-lin-alive" type="checkbox"> vivantes seulement</label><span id="ex-lin-count" class="tiny"></span></div>
          <div id="ex-lineages" class="ex-groups"></div>
        </section>
        <aside class="explorer-detail" id="ex-lin-detail"><p class="muted">Cliquez sur une lignée, ici ou dans l’arbre des lignées.</p></aside>
      </div>

      <div class="explorer-body explorer-body-tree" id="ex-tab-tree" hidden>
        <section class="explorer-tree">
          <div class="ex-tree-bar">
            <button type="button" id="ex-tree-fit" class="quiet">Ajuster</button>
            <button type="button" id="ex-tree-zoom" class="quiet">Zoom sur le foyer</button>
            <label class="ex-inline"><input id="ex-tree-siblings" type="checkbox" checked> lignées sœurs</label>
            <label class="ex-inline">Éteintes <select id="ex-tree-extinct"><option value="all">toutes</option><option value="200">récentes (200 pas)</option><option value="0">masquées</option></select></label>
            <label class="ex-inline">Descendance <select id="ex-tree-budget"><option value="150">150</option><option value="400" selected>400</option><option value="1500">1500</option></select></label>
            <span id="ex-tree-note" class="tiny"></span>
            <span class="ex-tree-legend"><i class="dot" style="background:#e6f1e9"></i>trajet fondateur → foyer <i class="dot" style="background:#eac789"></i>mutation à effet <i class="dot faded"></i>éteinte</span>
          </div>
          <div class="ex-tree-wrap"><canvas id="ex-tree-canvas" role="img" aria-label="Arbre des lignées autour de la lignée choisie"></canvas></div>
        </section>
        <aside class="explorer-detail" id="ex-tree-detail"><p class="muted">Cliquez sur une lignée de l’arbre. Double-clic : recentrer l’arbre sur elle.</p></aside>
      </div>

      <div class="explorer-body explorer-body-2" id="ex-tab-saved" hidden>
        <section class="explorer-list">
          <div class="ex-count" id="ex-saved-count"></div>
          <div id="ex-saved" class="ex-groups"></div>
        </section>
        <aside class="explorer-detail" id="ex-saved-detail"><p class="muted">Sélectionnez un organisme enregistré.</p></aside>
      </div>
    </div>`;
}

export class Explorer {
  readonly dialog: HTMLDialogElement;
  private readonly opts: ExplorerOptions;
  private readonly q: <T extends HTMLElement>(sel: string) => T;
  private entries: CatalogEntry[] = [];
  private shown: CatalogEntry[] = [];
  private selected: CatalogEntry | null = null;
  private selectedLineage: number = -1;
  private expandedGroups = new Set<string>();
  private saved: SavedOrganismMeta[] = [];
  private savedSelected: SavedOrganism | null = null;
  private tree: LineageTreeView | null = null;
  private treeFocus = -1;
  private treeObserver: ResizeObserver | null = null;
  private compare: { first: string; second: string; firstLabel: string; secondLabel: string } | null = null;

  constructor(dialog: HTMLDialogElement, opts: ExplorerOptions) {
    this.dialog = dialog;
    this.opts = opts;
    dialog.innerHTML = template();
    this.q = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
    this.bind();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  treePng(): string | null {
    if (!this.dialog.open) return null;
    try {
      return this.q<HTMLCanvasElement>("#ex-tree-canvas").toDataURL("image/png");
    } catch {
      return null;
    }
  }

  open(view: ExplorerView = {}): void {
    if (!this.dialog.open) this.dialog.showModal();
    this.reload();
    if (view.filter || view.sort) this.setFilterInputs(view.filter ?? {}, view.sort);
    if (view.tab) this.setTab(view.tab);
    else this.setTab(view.lineageId !== undefined ? "lineages" : "organisms");
    if (view.tab === "tree" && view.lineageId !== undefined) this.showTree(view.lineageId);
    else if (view.lineageId !== undefined) this.showLineage(view.lineageId);
    if (view.organismId !== undefined) {
      const e = this.entries.find((x) => x.id === view.organismId);
      if (e) this.showOrganism(e);
    }
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /* ---------- data ---------- */

  private reload(): void {
    const w = this.opts.world();
    this.entries = buildCatalog(w);
    this.q("#ex-world").textContent = `MONDE ${this.opts.worldSide()} · PAS ${w.tick} · ${w.organisms.length} VIVANTS · ${w.deaths.length} MORTS`;
    const strainSel = this.q<HTMLSelectElement>("#ex-strain");
    const prev = strainSel.value;
    strainSel.innerHTML = `<option value="">Toutes</option>` + [...w.strains.values()].map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    strainSel.value = [...strainSel.options].some((o) => o.value === prev) ? prev : "";
    this.renderList();
    this.renderRecords();
    this.renderLineages();
    void this.refreshSaved();
  }

  private currentFilter(): CatalogFilter {
    const num = (id: string): number | undefined => {
      const v = this.q<HTMLInputElement>(id).value.trim();
      return v === "" ? undefined : Number(v);
    };
    const trait = this.q<HTMLSelectElement>("#ex-trait").value as TraitName | "";
    const strain = this.q<HTMLSelectElement>("#ex-strain").value;
    const strategy = this.q<HTMLSelectElement>("#ex-strategy").value as Strategy | "";
    const cause = this.q<HTMLSelectElement>("#ex-cause").value as DeathCause | "";
    return {
      liveness: this.q<HTMLSelectElement>("#ex-liveness").value as Liveness,
      strainId: strain ? Number(strain) : undefined,
      strategy: strategy || undefined,
      lineageId: num("#ex-lineage"),
      cause: cause || undefined,
      minAge: num("#ex-age-min"),
      maxAge: num("#ex-age-max"),
      minKills: num("#ex-kills"),
      minBirths: num("#ex-births"),
      minFitness: num("#ex-fitness"),
      trait: trait ? { trait, min: Number(this.q<HTMLInputElement>("#ex-trait-min").value) || 0 } : undefined,
      genome: this.q<HTMLInputElement>("#ex-genome").value,
      text: this.q<HTMLInputElement>("#ex-text").value,
    };
  }

  private setFilterInputs(f: Partial<CatalogFilter>, sort?: CatalogSort): void {
    const set = (id: string, v: unknown) => {
      this.q<HTMLInputElement>(id).value = v === undefined || v === null ? "" : String(v);
    };
    set("#ex-liveness", f.liveness ?? "all");
    set("#ex-strain", f.strainId);
    set("#ex-strategy", f.strategy);
    set("#ex-lineage", f.lineageId);
    set("#ex-cause", f.cause);
    set("#ex-age-min", f.minAge);
    set("#ex-age-max", f.maxAge);
    set("#ex-kills", f.minKills);
    set("#ex-births", f.minBirths);
    set("#ex-fitness", f.minFitness);
    set("#ex-trait", f.trait?.trait);
    if (f.trait) set("#ex-trait-min", f.trait.min);
    set("#ex-genome", f.genome);
    set("#ex-text", f.text);
    if (sort) set("#ex-sort", sort);
    this.renderList();
  }

  /* ---------- organisms tab ---------- */

  private renderList(): void {
    const filter = this.currentFilter();
    const sort = this.q<HTMLSelectElement>("#ex-sort").value as CatalogSort;
    const mode = this.q<HTMLSelectElement>("#ex-group").value as CatalogGroupMode;
    this.shown = sortCatalog(applyFilter(this.entries, filter), sort);
    const w = this.opts.world();
    const groups = groupCatalog(this.shown, mode);
    this.q("#ex-count").textContent = `${this.shown.length} organisme${this.shown.length > 1 ? "s" : ""} sur ${this.entries.length} · ${groups.length} groupe${groups.length > 1 ? "s" : ""}`;
    let budget = MAX_ROWS_TOTAL;
    const html = groups.map((g) => {
      const label = mode === "strain" ? (w.strains.get(Number(g.key))?.name ?? "Sans étiquette") : mode === "strategy" ? STRATEGY_LABEL[g.key as Strategy] : mode === "lineage" ? `Lignée ${g.key}` : "Tous";
      const color = mode === "strain" ? (w.strains.get(Number(g.key))?.color ?? "#8aa0b5") : mode === "strategy" ? STRATEGY_COLOR[g.key as Strategy] : "#8aa0b5";
      const expanded = this.expandedGroups.has(g.key);
      const cap = expanded ? Math.min(g.entries.length, budget) : Math.min(MAX_ROWS_PER_GROUP, g.entries.length, budget);
      budget -= cap;
      const rows = g.entries.slice(0, cap).map((e) => this.rowHtml(e)).join("");
      const more = g.entries.length > cap ? `<button type="button" class="quiet ex-more" data-group="${esc(g.key)}">${expanded ? "Limite d’affichage atteinte" : `Afficher les ${g.entries.length - cap} autres`}</button>` : "";
      return `<section class="ex-group"><header class="ex-group-head"><i class="swatch" style="background:${color}"></i><b>${esc(label)}</b><span class="tiny">${g.entries.length} · ${g.alive} vivant${g.alive > 1 ? "s" : ""} · fitness moy. ${fmt(g.meanFitness)}</span></header>
        <table class="ex-table"><thead><tr><th>N°</th><th>État</th><th class="num">Âge</th><th class="num">Fitness</th><th class="num">Énergie</th><th class="num">Tués</th><th class="num">Desc.</th><th class="num">Corp.</th><th>Lignée</th></tr></thead><tbody>${rows}</tbody></table>${more}</section>`;
    });
    this.q("#ex-groups").innerHTML = html.join("") || `<p class="muted">Aucun organisme ne correspond aux filtres.</p>`;
  }

  private rowHtml(e: CatalogEntry): string {
    const state = e.alive ? `<span class="hit">vivant</span>` : `<span class="dead" title="${esc(DEATH_LABEL[e.cause!])} au pas ${e.deathTick}">${esc(CAUSE_SHORT_FR[e.cause!] ?? e.cause!)}</span>`;
    const sel = this.selected?.id === e.id && this.selected.alive === e.alive ? " selected" : "";
    return `<tr class="ex-row${sel}" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}"><td class="mono">${e.id}</td><td>${state}</td><td class="mono num">${e.age}</td><td class="mono num">${fmt(e.fitness)}</td><td class="mono num">${e.energy === null ? "—" : fmt(e.energy, 2)}</td><td class="mono num">${e.kills}</td><td class="mono num">${e.births}</td><td class="mono num">${fmt(e.mass, 2)}</td><td class="mono">${e.lineageId}</td></tr>`;
  }

  private renderRecords(): void {
    const recs = catalogRecords(this.entries).slice(0, 12);
    this.q("#ex-records").innerHTML = recs
      .map((r) => `<button type="button" class="ex-record" data-id="${r.entry.id}" data-alive="${r.entry.alive ? 1 : 0}"><span>${esc(r.label)}</span><b class="mono">n° ${r.entry.id}</b></button>`)
      .join("") || `<p class="muted">Aucun organisme.</p>`;
  }

  private findEntry(id: number, alive: boolean): CatalogEntry | undefined {
    return this.entries.find((e) => e.id === id && e.alive === alive) ?? this.entries.find((e) => e.id === id);
  }

  private async fillCompareSaved(): Promise<void> {
    const sel = this.dialog.querySelector<HTMLSelectElement>("#ex-compare-saved");
    if (!sel) return;
    this.saved = await this.opts.store.listOrganisms();
    const prev = sel.value;
    sel.innerHTML = `<option value="">—</option>` + this.saved.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  private async runCompareFromPicker(): Promise<void> {
    const savedId = this.dialog.querySelector<HTMLSelectElement>("#ex-compare-saved")?.value ?? "";
    if (savedId) {
      const rec = await this.opts.store.loadOrganism(savedId);
      if (!rec) {
        this.opts.status("Organisme enregistré introuvable.");
        return;
      }
      this.runCompare(rec.entry.genome, rec.name);
      return;
    }
    const id = Number(this.dialog.querySelector<HTMLInputElement>("#ex-compare-id")?.value);
    if (Number.isInteger(id) && id > 0) {
      const e = this.entries.find((x) => x.id === id);
      if (!e) {
        this.opts.status(`Organisme n° ${id} absent du catalogue.`);
        return;
      }
      this.runCompare(e.genome, `organisme n° ${e.id}`);
      return;
    }
    this.opts.status("Indiquez un n° d’organisme, un enregistrement, ou l’organisme sélectionné sur la plaque.");
  }

  private runCompare(second: string, secondLabel: string): void {
    const first = this.selected;
    if (!first) return;
    const al = alignSequences(first.genome, second);
    this.compare = { first: first.genome, second, firstLabel: `organisme n° ${first.id}`, secondLabel };
    const host = this.dialog.querySelector("#ex-align");
    if (!host) return;
    let rowA = "";
    let rowB = "";
    for (let i = 0; i < al.a.length; i++) {
      const ca = al.a[i]!;
      const cb = al.b[i]!;
      const cls = ca === "-" || cb === "-" ? "gap" : ca === cb ? "match" : "mis";
      rowA += `<span class="${cls}">${ca}</span>`;
      rowB += `<span class="${cls}">${cb}</span>`;
    }
    host.innerHTML = `<div class="align-block">
      <div class="tiny">${esc(this.compare.firstLabel)}</div>
      <div class="align-strip" aria-label="Séquence de référence">${rowA}</div>
      <div class="tiny">${esc(secondLabel)}</div>
      <div class="align-strip" aria-label="Séquence comparée">${rowB}</div>
      <p class="micro">${al.matches} identités · ${al.mismatches} substitutions · ${al.gaps} gaps · score ${al.score}</p>
      <button type="button" data-act="compare-load">Charger la comparaison</button>
    </div>`;
    this.opts.status(`Alignement : ${al.matches} identités, ${al.mismatches} substitutions, ${al.gaps} gaps.`);
  }

  private showOrganism(e: CatalogEntry): void {
    this.selected = e;
    this.setTab("organisms");
    this.q("#ex-detail").innerHTML = this.organismDetailHtml(e);
    this.compare = null;
    void this.fillCompareSaved();
    this.dialog.querySelectorAll(".ex-row.selected").forEach((r) => r.classList.remove("selected"));
    this.dialog.querySelector(`.ex-row[data-id="${e.id}"][data-alive="${e.alive ? 1 : 0}"]`)?.classList.add("selected");
  }

  private organismDetailHtml(e: CatalogEntry): string {
    const w = this.opts.world();
    const strain = w.strains.get(e.strainId);
    const steps = ancestry(w.lineages, w.innovations, e.lineageId);
    const state = e.alive ? `<span class="hit">vivant</span>` : `<span class="dead">${esc(DEATH_LABEL[e.cause!])} au pas ${e.deathTick}</span>`;
    return `
      <div class="ex-detail-head"><h3>Organisme n° ${e.id}</h3>${state}</div>
      <div class="ex-facts">
        <span>Souche<b><i class="swatch" style="background:${strain?.color ?? "#8aa0b5"}"></i>${esc(strain?.name ?? "—")}</b></span>
        <span>Stratégie<b style="color:${STRATEGY_COLOR[e.strategy]}">${STRATEGY_LABEL[e.strategy]}</b></span>
        <span>Lignée<b><button type="button" class="linklike" data-lineage="${e.lineageId}">n° ${e.lineageId}</button></b></span>
        <span>Parent<b>${e.parentId < 0 ? "fondateur" : `n° ${e.parentId}`}</b></span>
        <span>Né au pas<b>${e.bornTick}</b></span>
        <span>Âge<b>${e.age}</b></span>
        <span>Fitness<b>${fmt(e.fitness)}</b></span>
        <span>Énergie<b>${e.energy === null ? "—" : fmt(e.energy, 2)}</b></span>
        <span>Proies tuées<b>${e.kills}</b></span>
        <span>Descendants directs<b>${e.births}</b></span>
        <span>Corpulence<b>${fmt(e.mass, 2)}</b></span>
        <span>Position<b>(${e.x}, ${e.y})</b></span>
      </div>
      <div class="row ex-actions">
        ${e.alive ? `<button type="button" data-act="select" data-id="${e.id}">${icon("inspect")}Voir dans le monde</button>` : ""}
        <button type="button" data-act="tree" data-lineage="${e.lineageId}">${icon("chart")}Voir dans l’arbre</button>
        <button type="button" data-act="highlight" data-lineage="${e.lineageId}">Surligner la lignée</button>
        <button type="button" data-act="dna" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}">${icon("dna")}Charger l’ADN</button>
        <button type="button" data-act="compare-toggle">${icon("dna")}Comparer à…</button>
        <button type="button" class="primary" data-act="save" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}">${icon("save")}Enregistrer…</button>
      </div>
      <div id="ex-compare" class="ex-compare" hidden>
        <label class="tiny" for="ex-compare-id">Organisme n°</label>
        <input id="ex-compare-id" type="number" min="1" step="1" placeholder="n°">
        <label class="tiny" for="ex-compare-saved">Enregistré</label>
        <select id="ex-compare-saved"><option value="">—</option></select>
        <div class="row"><button type="button" data-act="compare-plate">Organisme sélectionné</button><button type="button" class="primary" data-act="compare-run">Aligner</button></div>
      </div>
      <div id="ex-align"></div>
      <div id="ex-save-form" hidden></div>
      ${phenotypeTableHtml(e.ph)}
      <div class="ex-genome mono">${e.genome}</div>
      <div class="ex-ancestry"><span class="eyebrow">ÉVOLUTION · ${steps.length} lignée${steps.length > 1 ? "s" : ""} du fondateur à cet organisme</span>${ancestryHtml(steps, w.tick)}</div>`;
  }

  /* ---------- lineages tab ---------- */

  private renderLineages(): void {
    const w = this.opts.world();
    const sort = this.q<HTMLSelectElement>("#ex-lin-sort").value;
    const aliveOnly = this.q<HTMLInputElement>("#ex-lin-alive").checked;
    let nodes = [...w.lineages.values()];
    if (aliveOnly) nodes = nodes.filter((n) => n.count > 0);
    const sub = new Map<number, number>();
    if (sort === "subtree") for (const n of nodes) sub.set(n.id, subtreeCount(w.lineages, n.id));
    nodes.sort((a, b) =>
      sort === "count" ? b.count - a.count || b.peakCount - a.peakCount
        : sort === "peak" ? b.peakCount - a.peakCount
          : sort === "born" ? a.bornTick - b.bornTick
            : sort === "extinct" ? (b.extinctTick ?? Infinity) - (a.extinctTick ?? Infinity)
              : (sub.get(b.id) ?? 0) - (sub.get(a.id) ?? 0),
    );
    const shown = nodes.slice(0, 600);
    this.q("#ex-lin-count").textContent = `${nodes.length} lignée${nodes.length > 1 ? "s" : ""}${shown.length < nodes.length ? ` · ${shown.length} affichées` : ""}`;
    this.q("#ex-lineages").innerHTML = `<table class="ex-table"><thead><tr><th>N°</th><th>Parent</th><th class="num">Née</th><th class="num">Éteinte</th><th class="num">Vivants</th><th class="num">Max</th><th class="num">Descendance</th></tr></thead><tbody>${shown
      .map((n) => `<tr class="ex-row${n.id === this.selectedLineage ? " selected" : ""}" data-lineage="${n.id}"><td class="mono">${n.id}</td><td class="mono">${n.parentId < 0 ? "—" : n.parentId}</td><td class="mono num">${n.bornTick}</td><td class="mono num">${n.extinctTick ?? "—"}</td><td class="mono num">${n.count}</td><td class="mono num">${n.peakCount}</td><td class="mono num">${sub.get(n.id) ?? subtreeCount(w.lineages, n.id)}</td></tr>`)
      .join("")}</tbody></table>`;
  }

  showLineage(id: number): void {
    this.selectedLineage = id;
    this.setTab("lineages");
    this.renderLineages();
    this.q("#ex-lin-detail").innerHTML = this.lineageDetailHtml(id);
    if (this.opts.world().lineages.has(id)) this.opts.highlightLineage(id);
  }

  private lineageDetailHtml(id: number): string {
    const w = this.opts.world();
    const node = w.lineages.get(id);
    if (!node) return `<p class="muted">Lignée ${id} inconnue.</p>`;
    const steps = ancestry(w.lineages, w.innovations, id);
    const kids = descendantLineages(w.lineages, id, 40);
    const members = organismsUnderLineage(w.organisms, w.lineages, id);
    const own = w.organisms.filter((o) => o.lineageId === id);
    const sample = own[0] ?? members[0];
    return `
      <div class="ex-detail-head"><h3>Lignée n° ${id}</h3>${node.count > 0 ? `<span class="hit">${node.count} vivant${node.count > 1 ? "s" : ""}</span>` : `<span class="dead">éteinte au pas ${node.extinctTick ?? "?"}</span>`}</div>
      <div class="ex-facts">
        <span>Née au pas<b>${node.bornTick}</b></span>
        <span>Effectif maximal<b>${node.peakCount}</b></span>
        <span>Parent<b>${node.parentId < 0 ? "fondateur" : `<button type="button" class="linklike" data-lineage="${node.parentId}">n° ${node.parentId}</button>`}</b></span>
        <span>Sous-lignées<b>${descendantLineages(w.lineages, id, 100000).length}</b></span>
        <span>Descendance vivante<b>${subtreeCount(w.lineages, id)}</b></span>
        <span>Signature<b class="mono">${esc(node.signature)}</b></span>
      </div>
      <div class="row ex-actions">
        <button type="button" data-act="tree" data-lineage="${id}">${icon("chart")}Voir dans l’arbre</button>
        <button type="button" data-act="highlight" data-lineage="${id}">Surligner sur la plaque</button>
        <button type="button" data-act="members" data-lineage="${id}">${icon("inspect")}Voir ses organismes</button>
        ${sample ? `<button type="button" data-act="dna-org" data-id="${sample.id}">${icon("dna")}Charger un génome</button>` : ""}
      </div>
      <div class="ex-ancestry"><span class="eyebrow">ORIGINE · ${steps.length} lignée${steps.length > 1 ? "s" : ""} depuis le fondateur</span>${ancestryHtml(steps, w.tick)}</div>
      ${kids.length ? `<div class="ex-ancestry"><span class="eyebrow">SOUS-LIGNÉES DIRECTES ET SUIVANTES</span><ul class="ex-kids">${kids.map((k) => `<li><button type="button" class="linklike" data-lineage="${k.id}">n° ${k.id}</button> · née ${k.bornTick} · ${k.count > 0 ? `${k.count} vivants` : `éteinte ${k.extinctTick}`} · max ${k.peakCount}</li>`).join("")}</ul></div>` : ""}`;
  }

  /* ---------- tree tab ---------- */

  private ensureTree(): LineageTreeView {
    if (this.tree) return this.tree;
    const tip = document.createElement("div");
    tip.id = "ex-tree-tip";
    tip.className = "ex-tree-tip";
    tip.hidden = true;
    // Inside the dialog: a modal renders in the top layer, so a body-level fixed element would paint underneath it.
    this.dialog.append(tip);
    const w = () => this.opts.world();
    this.tree = new LineageTreeView(this.q<HTMLCanvasElement>("#ex-tree-canvas"), tip, {
      onSelect: (id) => {
        this.selectedLineage = id;
        this.q("#ex-tree-detail").innerHTML = this.lineageDetailHtml(id);
        this.opts.highlightLineage(id);
      },
      onFocus: (id) => this.showTree(id),
      strainColor: (sid) => w().strains.get(sid)?.color ?? "#8aa0b5",
      strainName: (sid) => w().strains.get(sid)?.name ?? "souche inconnue",
      changeLabel: (n: TreeNode) => {
        const c = n.change;
        if (!c) return "";
        const d = c.to - c.from;
        return `${TRAIT_LABEL[c.trait]} ${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
      },
    });
    const wrap = this.q("#ex-tree-canvas").parentElement!;
    this.treeObserver = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) this.tree!.resize(r.width, r.height);
    });
    this.treeObserver.observe(wrap);
    return this.tree;
  }

  /** Draw the tree centred on a lineage and show its details beside it. */
  showTree(focusId: number): void {
    const w = this.opts.world();
    this.treeFocus = focusId;
    this.selectedLineage = focusId;
    this.setTab("tree");
    const view = this.ensureTree();
    const extinct = this.q<HTMLSelectElement>("#ex-tree-extinct").value;
    const layout = layoutLineageTree(w.lineages, w.innovations, focusId, {
      now: w.tick,
      maxDescendants: Number(this.q<HTMLSelectElement>("#ex-tree-budget").value) || 400,
      siblings: this.q<HTMLInputElement>("#ex-tree-siblings").checked,
      extinctFor: extinct === "all" ? Infinity : Number(extinct),
      strainOf: lineageStrainMap(w.organisms, w.deaths, w.innovations, w.lineages),
    });
    const wrap = this.q("#ex-tree-canvas").parentElement!;
    const r = wrap.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) view.resize(r.width, r.height);
    view.setLayout(layout, w.tick);
    const hidden = layout.nodes.reduce((sum, n) => sum + n.hiddenDescendants, 0);
    this.q("#ex-tree-note").textContent = layout.nodes.length
      ? `${layout.nodes.length} lignée${layout.nodes.length > 1 ? "s" : ""} · trajet de ${layout.path.length} · foyer n° ${focusId}${hidden ? ` · ${hidden} sous-lignées masquées` : ""}`
      : `Lignée n° ${focusId} inconnue.`;
    this.q("#ex-tree-detail").innerHTML = this.lineageDetailHtml(focusId);
    this.opts.highlightLineage(focusId);
    requestAnimationFrame(() => {
      const rr = wrap.getBoundingClientRect();
      if (rr.width > 0 && rr.height > 0) view.resize(rr.width, rr.height);
      view.focusZoom();
    });
  }

  /* ---------- saved tab ---------- */

  private async refreshSaved(): Promise<void> {
    this.saved = await this.opts.store.listOrganisms();
    this.q("#ex-saved-count").textContent = `${this.saved.length} organisme${this.saved.length > 1 ? "s" : ""} enregistré${this.saved.length > 1 ? "s" : ""}`;
    this.q("#ex-saved").innerHTML = this.saved.length
      ? `<table class="ex-table"><thead><tr><th>Nom</th><th>N°</th><th>Origine</th><th class="num">Fitness</th><th class="num">Tués</th><th class="num">Branche</th><th>Monde</th></tr></thead><tbody>${this.saved
          .map((s) => `<tr class="ex-row${this.savedSelected?.id === s.id ? " selected" : ""}" data-saved="${s.id}"><td>${esc(s.name)}</td><td class="mono">${s.entry.id}</td><td class="tiny">${esc(s.source.label)} · pas ${s.source.tick} · graine ${s.source.seed}</td><td class="mono num">${fmt(s.entry.fitness)}</td><td class="mono num">${s.entry.kills}</td><td class="mono num">${s.steps}</td><td>${s.hasSnapshot ? "inclus" : "—"}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">Aucun organisme enregistré. Dans Organismes, ouvrez une fiche puis « Enregistrer… ».</p>`;
  }

  private async showSaved(id: string): Promise<void> {
    const rec = await this.opts.store.loadOrganism(id);
    if (!rec) return;
    this.savedSelected = rec;
    const e = rec.entry;
    this.dialog.querySelectorAll("#ex-saved .ex-row.selected").forEach((r) => r.classList.remove("selected"));
    this.dialog.querySelector(`#ex-saved .ex-row[data-saved="${id}"]`)?.classList.add("selected");
    this.q("#ex-saved-detail").innerHTML = `
      <div class="ex-detail-head"><h3>${esc(rec.name)}</h3><span class="tiny">${new Date(rec.savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span></div>
      <div class="ex-facts">
        <span>Organisme<b>n° ${e.id} · ${e.alive ? "vivant" : `mort (${esc(DEATH_LABEL[e.cause!])})`}</b></span>
        <span>Origine<b>${esc(rec.source.label)} · pas ${rec.source.tick}</b></span>
        <span>Graine du monde<b class="mono">${rec.source.seed}</b></span>
        <span>Souche<b>${esc(rec.strainName)}</b></span>
        <span>Stratégie<b>${STRATEGY_LABEL[e.strategy]}</b></span>
        <span>Âge<b>${e.age}</b></span>
        <span>Fitness<b>${fmt(e.fitness)}</b></span>
        <span>Proies tuées<b>${e.kills}</b></span>
        <span>Descendants<b>${e.births}</b></span>
        <span>Simulation<b>${rec.snapshot ? "incluse" : "non incluse"}</b></span>
      </div>
      <div class="row ex-actions">
        <button type="button" data-act="saved-dna" data-saved="${id}">${icon("dna")}Charger l’ADN</button>
        ${rec.snapshot ? `<button type="button" class="primary" data-act="saved-world" data-saved="${id}">${icon("play")}Ouvrir la simulation dans B</button>` : ""}
        <button type="button" class="quiet" data-act="saved-export" data-saved="${id}">${icon("save")}Exporter .json</button>
        <button type="button" class="danger" data-act="saved-remove" data-saved="${id}">Supprimer</button>
      </div>
      ${phenotypeTableHtml(e.ph)}
      <div class="ex-genome mono">${e.genome}</div>
      <div class="ex-ancestry"><span class="eyebrow">ÉVOLUTION ENREGISTRÉE · ${rec.ancestry.length} lignée${rec.ancestry.length > 1 ? "s" : ""}</span>${ancestryHtml(rec.ancestry, rec.source.tick)}</div>`;
  }

  private saveForm(e: CatalogEntry): void {
    const form = this.q("#ex-save-form");
    form.hidden = false;
    form.innerHTML = `<div class="ex-save">
      <input id="ex-save-name" type="text" maxlength="48" placeholder="Nom (ex. Chasseur n° ${e.id})" value="${e.alive ? "" : ""}">
      <label class="ex-inline"><input id="ex-save-world" type="checkbox" checked> Inclure la simulation entière (monde, carte, graine) pour la revoir plus tard</label>
      <div class="row"><button type="button" class="primary" data-act="save-confirm" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}">Enregistrer</button><button type="button" class="quiet" data-act="save-cancel">Annuler</button></div>
    </div>`;
    this.q<HTMLInputElement>("#ex-save-name").focus();
  }

  private async saveOrganism(e: CatalogEntry, name: string, includeWorld: boolean): Promise<void> {
    const w = this.opts.world();
    const rec: SavedOrganism = {
      id: `${Date.now().toString(36)}-${e.id}`,
      name: name.trim() || `Organisme n° ${e.id}`,
      savedAt: Date.now(),
      source: { world: this.opts.worldSide(), tick: w.tick, seed: w.params.seed, label: `Monde ${this.opts.worldSide()}` },
      entry: { ...e, ph: { ...e.ph } },
      ancestry: ancestry(w.lineages, w.innovations, e.lineageId).map((s) => ({ lineage: { ...s.lineage }, innovation: s.innovation ? { ...s.innovation, changes: s.innovation.changes.map((c) => ({ ...c })), env: { ...s.innovation.env } } : null, depth: s.depth })),
      strainName: w.strains.get(e.strainId)?.name ?? "—",
    };
    if (includeWorld) rec.snapshot = w.snapshot();
    await this.opts.store.saveOrganism(rec);
    this.q("#ex-save-form").hidden = true;
    await this.refreshSaved();
    this.opts.status(`Organisme n° ${e.id} enregistré sous « ${rec.name} »${includeWorld ? " avec la simulation" : ""}.`);
  }

  private exportSaved(rec: SavedOrganism): void {
    const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `openavida-organisme-${rec.entry.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- tabs & events ---------- */

  private setTab(tab: ExplorerTab): void {
    for (const t of["organisms", "lineages", "tree", "saved"] as const) {
      this.q(`#ex-tab-${t}`).hidden = t !== tab;
      const b = this.dialog.querySelector(`[data-etab="${t}"]`)!;
      b.classList.toggle("active", t === tab);
      b.setAttribute("aria-selected", String(t === tab));
    }
    if (tab === "saved") void this.refreshSaved();
    if (tab === "tree" && this.tree) {
      requestAnimationFrame(() => {
        const wrap = this.q("#ex-tree-canvas").parentElement!;
        const r = wrap.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) this.tree!.resize(r.width, r.height);
      });
    }
  }

  private bind(): void {
    const d = this.dialog;
    d.querySelectorAll<HTMLElement>("[data-etab]").forEach((b) => b.addEventListener("click", () => this.setTab(b.dataset.etab as ExplorerTab)));
    this.q("#ex-close").addEventListener("click", () => this.close());
    this.q("#ex-refresh").addEventListener("click", () => this.reload());
    d.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      this.close();
    });
    for (const id of ["#ex-text", "#ex-liveness", "#ex-group", "#ex-strain", "#ex-strategy", "#ex-lineage", "#ex-cause", "#ex-age-min", "#ex-age-max", "#ex-kills", "#ex-births", "#ex-fitness", "#ex-genome", "#ex-trait", "#ex-trait-min", "#ex-sort"]) {
      this.q(id).addEventListener("input", () => this.renderList());
      this.q(id).addEventListener("change", () => this.renderList());
    }
    this.q("#ex-reset").addEventListener("click", () => {
      this.setFilterInputs({}, "best-fitness");
      this.expandedGroups.clear();
      this.renderList();
    });
    this.q("#ex-lin-sort").addEventListener("change", () => this.renderLineages());
    this.q("#ex-tree-fit").addEventListener("click", () => this.tree?.fit());
    this.q("#ex-tree-zoom").addEventListener("click", () => this.tree?.focusZoom());
    for (const id of ["#ex-tree-siblings", "#ex-tree-extinct", "#ex-tree-budget"]) {
      this.q(id).addEventListener("change", () => {
        if (this.treeFocus >= 0) this.showTree(this.treeFocus);
      });
    }
    this.q("#ex-lin-alive").addEventListener("change", () => this.renderLineages());

    d.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const more = t.closest<HTMLElement>(".ex-more");
      if (more) {
        this.expandedGroups.add(more.dataset.group!);
        this.renderList();
        return;
      }
      const record = t.closest<HTMLElement>(".ex-record");
      if (record) {
        const e = this.findEntry(Number(record.dataset.id), record.dataset.alive === "1");
        if (e) this.showOrganism(e);
        return;
      }
      const savedRow = t.closest<HTMLElement>("[data-saved].ex-row");
      if (savedRow) {
        void this.showSaved(savedRow.dataset.saved!);
        return;
      }
      const act = t.closest<HTMLElement>("[data-act]");
      if (act) {
        this.onAction(act);
        return;
      }
      const lin = t.closest<HTMLElement>("[data-lineage].linklike, .ex-row[data-lineage]");
      if (lin) {
        this.showLineage(Number(lin.dataset.lineage));
        return;
      }
      const row = t.closest<HTMLElement>(".ex-row[data-id]");
      if (row) {
        const e = this.findEntry(Number(row.dataset.id), row.dataset.alive === "1");
        if (e) this.showOrganism(e);
      }
    });
  }

  private onAction(el: HTMLElement): void {
    const act = el.dataset.act;
    const entry = el.dataset.id !== undefined ? this.findEntry(Number(el.dataset.id), el.dataset.alive === "1") : undefined;
    switch (act) {
      case "select":
        if (entry) {
          this.opts.selectOrganism(entry.id);
          this.opts.highlightLineage(entry.lineageId);
          this.close();
          this.opts.status(`Organisme n° ${entry.id} sélectionné ; sa lignée est surlignée sur la plaque.`);
        }
        return;
      case "highlight": {
        const id = Number(el.dataset.lineage);
        this.opts.highlightLineage(id);
        this.opts.status(`Lignée n° ${id} surlignée sur la plaque (anneaux). Fermez l’explorateur pour la voir.`);
        return;
      }
      case "members":
        this.setFilterInputs({ lineageId: Number(el.dataset.lineage), liveness: "all" }, "best-fitness");
        this.setTab("organisms");
        return;
      case "tree":
        this.showTree(Number(el.dataset.lineage));
        return;
      case "dna":
        if (entry) this.opts.loadGenome(entry.genome, `organisme n° ${entry.id}`);
        return;
      case "compare-toggle": {
        const box = this.dialog.querySelector<HTMLElement>("#ex-compare");
        if (box) box.hidden = !box.hidden;
        if (box && !box.hidden) void this.fillCompareSaved();
        return;
      }
      case "compare-plate": {
        const sel = this.opts.plateSelection();
        if (!sel) {
          this.opts.status("Aucun organisme sélectionné sur la plaque.");
          return;
        }
        this.runCompare(sel.genome, `organisme n° ${sel.id} (plaque)`);
        return;
      }
      case "compare-run":
        void this.runCompareFromPicker();
        return;
      case "compare-load":
        if (this.compare) {
          this.opts.loadGenome(this.compare.second, this.compare.secondLabel, { diffAgainst: this.compare.first });
          this.opts.status(`Génome de ${this.compare.secondLabel} chargé, comparé à ${this.compare.firstLabel}.`);
        }
        return;
      case "dna-org": {
        const o = this.opts.world().organisms.find((x) => x.id === Number(el.dataset.id));
        if (o) this.opts.loadGenome(o.genome, `organisme n° ${o.id}`);
        return;
      }
      case "save":
        if (entry) this.saveForm(entry);
        return;
      case "save-cancel":
        this.q("#ex-save-form").hidden = true;
        return;
      case "save-confirm":
        if (entry) void this.saveOrganism(entry, this.q<HTMLInputElement>("#ex-save-name").value, this.q<HTMLInputElement>("#ex-save-world").checked);
        return;
      case "saved-dna":
        if (this.savedSelected) this.opts.loadGenome(this.savedSelected.entry.genome, this.savedSelected.name);
        return;
      case "saved-world":
        if (this.savedSelected?.snapshot) {
          this.opts.restoreInto("B", this.savedSelected.snapshot);
          this.close();
          this.opts.status(`Simulation de « ${this.savedSelected.name} » ouverte dans le monde B (pas ${this.savedSelected.source.tick}, graine ${this.savedSelected.source.seed}).`);
        }
        return;
      case "saved-export":
        if (this.savedSelected) this.exportSaved(this.savedSelected);
        return;
      case "saved-remove":
        if (this.savedSelected) {
          void this.opts.store.removeOrganism(this.savedSelected.id).then(() => {
            this.savedSelected = null;
            this.q("#ex-saved-detail").innerHTML = `<p class="muted">Sélectionnez un organisme enregistré.</p>`;
            return this.refreshSaved();
          });
        }
        return;
    }
  }
}

const CAUSE_SHORT_FR: Partial<Record<DeathCause, string>> = {
  starvation: "faim", toxin: "toxines", crowding: "surpopulation", "old-age": "vieillesse", predation: "prédation",
  competition: "compétition", crash: "événement", wipe: "pinceau", bottleneck: "goulot",
};

/** Vertical evolution branch: one card per lineage from the founder, mutations that opened it, biggest changes marked. */
export function ancestryHtml(steps: readonly AncestryStep[], now: number): string {
  if (!steps.length) return `<p class="muted">Lignée inconnue.</p>`;
  const big = new Set(biggestChanges(steps, 3).map((b) => `${b.step.lineage.id}:${b.change.trait}`));
  return `<ol class="ex-branch">${steps
    .map((s) => {
      const l: LineageNode = s.lineage;
      const alive = l.count > 0 ? `${l.count} vivant${l.count > 1 ? "s" : ""}` : l.extinctTick !== null ? `éteinte au pas ${l.extinctTick}` : "sans membre";
      const changes = s.innovation
        ? s.innovation.changes.map((c) => {
            const d = c.to - c.from;
            const key = `${l.id}:${c.trait}`;
            return `<span class="ex-change${big.has(key) ? " big" : ""}" style="--g:${TRAIT_COLOR[c.trait]}">${TRAIT_LABEL[c.trait]} ${fmt(c.from, 2)} → ${fmt(c.to, 2)} <em class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${fmt(Math.abs(d), 2)}</em></span>`;
          }).join("")
        : s.depth === 0 ? `<span class="ex-change neutral">génome fondateur</span>` : `<span class="ex-change neutral">mutation sans effet notable sur le phénotype</span>`;
      const env = s.innovation ? `<div class="tiny">née à T ${fmt(s.innovation.env.temperature, 2)} · nutr ${fmt(s.innovation.env.nutrient, 2)} · tox ${fmt(s.innovation.env.toxin, 2)} · lum ${fmt(s.innovation.env.light, 2)} · ${s.innovation.kind}</div>` : "";
      return `<li class="ex-step"><div class="ex-step-head"><b>Lignée <button type="button" class="linklike" data-lineage="${l.id}">n° ${l.id}</button></b><span class="tiny">pas ${l.bornTick}${l.bornTick < now ? ` → ${l.extinctTick ?? now}` : ""} · max ${l.peakCount} · ${alive}</span></div><div class="ex-changes">${changes}</div>${env}</li>`;
    })
    .join("")}</ol>`;
}
