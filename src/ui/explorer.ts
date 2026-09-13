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
import { tDynamic } from "./i18n/runtime";
import { DEATH_LABEL, DEATH_SHORT, STRATEGY_LABEL, TRAIT_LABEL } from "./labels";
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

/** Sort preset label: the sim returns ids (`trait:<trait>` for the trait presets). */
function sortLabel(sort: CatalogSort): string {
  return sort.startsWith("trait:")
    ? tDynamic("sim.sort.trait", { trait: sort.slice(6) })
    : tDynamic(`sim.sort.${sort}`);
}

function template(): string {
  const sorts = CATALOG_SORTS.map((s) => `<option value="${s.id}">${sortLabel(s.id)}</option>`).join("");
  const traits = TRAIT_NAMES.filter((t) => t !== "hue").map((t) => `<option value="${t}">${TRAIT_LABEL[t]}</option>`).join("");
  const causes = (Object.keys(DEATH_LABEL) as DeathCause[]).map((c) => `<option value="${c}">${DEATH_LABEL[c]}</option>`).join("");
  const strategies = STRATEGIES.map((s) => `<option value="${s}">${STRATEGY_LABEL[s]}</option>`).join("");
  return `
    <div class="explorer">
      <header class="explorer-head">
        <h2>${icon("inspect")} ${tDynamic("explorer.heading.title")}</h2><span id="ex-world" class="tag"></span>
        <div class="segmented ex-tabs" role="tablist">
          <button type="button" data-etab="organisms" class="active" role="tab" aria-selected="true">${tDynamic("explorer.tab.organisms")}</button>
          <button type="button" data-etab="lineages" role="tab" aria-selected="false">${tDynamic("explorer.tab.lineages")}</button>
          <button type="button" data-etab="tree" role="tab" aria-selected="false">${tDynamic("explorer.tab.tree")}</button>
          <button type="button" data-etab="saved" role="tab" aria-selected="false">${tDynamic("explorer.tab.saved")}</button>
        </div>
        <span class="spacer"></span>
        <button type="button" id="ex-refresh" class="quiet" title="${tDynamic("explorer.refresh.title")}">${icon("revert")}<span>${tDynamic("explorer.refresh")}</span></button>
        <button type="button" id="ex-close" class="quiet" aria-label="${tDynamic("explorer.close.aria")}">${icon("plus")}<span>${tDynamic("explorer.close")}</span></button>
      </header>

      <div class="explorer-body" id="ex-tab-organisms">
        <aside class="explorer-filters">
          <label class="ex-field">${tDynamic("explorer.filter.search")}<input id="ex-text" type="text" placeholder="${tDynamic("explorer.filter.search.placeholder")}" spellcheck="false"></label>
          <div class="ex-grid">
            <label class="ex-field">${tDynamic("explorer.filter.state")}<select id="ex-liveness"><option value="all">${tDynamic("explorer.filter.liveness.all")}</option><option value="alive">${tDynamic("explorer.filter.liveness.alive")}</option><option value="dead">${tDynamic("explorer.filter.liveness.dead")}</option></select></label>
            <label class="ex-field">${tDynamic("explorer.filter.group")}<select id="ex-group"><option value="strain">${tDynamic("explorer.filter.group.strain")}</option><option value="strategy">${tDynamic("explorer.filter.group.strategy")}</option><option value="lineage">${tDynamic("explorer.filter.group.lineage")}</option><option value="none">${tDynamic("explorer.filter.group.none")}</option></select></label>
            <label class="ex-field">${tDynamic("explorer.filter.strain")}<select id="ex-strain"><option value="">${tDynamic("explorer.filter.all")}</option></select></label>
            <label class="ex-field">${tDynamic("explorer.filter.strategy")}<select id="ex-strategy"><option value="">${tDynamic("explorer.filter.all")}</option>${strategies}</select></label>
            <label class="ex-field">${tDynamic("explorer.filter.lineage")}<input id="ex-lineage" type="number" min="1" step="1" placeholder="${tDynamic("explorer.filter.lineage.placeholder")}"></label>
            <label class="ex-field">${tDynamic("explorer.filter.cause")}<select id="ex-cause"><option value="">${tDynamic("explorer.filter.all")}</option>${causes}</select></label>
            <label class="ex-field">${tDynamic("explorer.filter.ageMin")}<input id="ex-age-min" type="number" min="0" step="1"></label>
            <label class="ex-field">${tDynamic("explorer.filter.ageMax")}<input id="ex-age-max" type="number" min="0" step="1"></label>
            <label class="ex-field">${tDynamic("explorer.filter.kills")}<input id="ex-kills" type="number" min="0" step="1"></label>
            <label class="ex-field">${tDynamic("explorer.filter.births")}<input id="ex-births" type="number" min="0" step="1"></label>
            <label class="ex-field">${tDynamic("explorer.filter.fitness")}<input id="ex-fitness" type="number" step="0.05"></label>
            <label class="ex-field">${tDynamic("explorer.filter.genome")}<input id="ex-genome" type="text" placeholder="ACGT…" spellcheck="false"></label>
          </div>
          <label class="ex-field">${tDynamic("explorer.filter.trait")}<div class="row ex-trait"><select id="ex-trait"><option value="">${tDynamic("explorer.filter.trait.none")}</option>${traits}</select><input id="ex-trait-min" type="number" step="0.05" value="0.5"></div></label>
          <label class="ex-field">${tDynamic("explorer.filter.sort")}<select id="ex-sort">${sorts}</select></label>
          <div class="row"><button type="button" id="ex-reset" class="quiet">${tDynamic("explorer.filter.reset")}</button></div>
          <div class="ex-records"><span class="eyebrow">${tDynamic("explorer.record.heading")}</span><div id="ex-records"></div></div>
        </aside>
        <section class="explorer-list">
          <div class="ex-count" id="ex-count"></div>
          <div id="ex-groups" class="ex-groups"></div>
        </section>
        <aside class="explorer-detail" id="ex-detail"><p class="muted">${tDynamic("explorer.empty.organism")}</p></aside>
      </div>

      <div class="explorer-body explorer-body-2" id="ex-tab-lineages" hidden>
        <section class="explorer-list">
          <div class="ex-count"><label class="tiny" for="ex-lin-sort">${tDynamic("explorer.lineage.sort")}</label> <select id="ex-lin-sort"><option value="count">${tDynamic("explorer.lineage.sort.count")}</option><option value="peak">${tDynamic("explorer.lineage.sort.peak")}</option><option value="born">${tDynamic("explorer.lineage.sort.born")}</option><option value="extinct">${tDynamic("explorer.lineage.sort.extinct")}</option><option value="subtree">${tDynamic("explorer.lineage.sort.subtree")}</option></select> <label class="ex-inline"><input id="ex-lin-alive" type="checkbox"> ${tDynamic("explorer.lineage.aliveOnly")}</label><span id="ex-lin-count" class="tiny"></span></div>
          <div id="ex-lineages" class="ex-groups"></div>
        </section>
        <aside class="explorer-detail" id="ex-lin-detail"><p class="muted">${tDynamic("explorer.empty.lineage")}</p></aside>
      </div>

      <div class="explorer-body explorer-body-tree" id="ex-tab-tree" hidden>
        <section class="explorer-tree">
          <div class="ex-tree-bar">
            <button type="button" id="ex-tree-fit" class="quiet">${tDynamic("explorer.tree.fit")}</button>
            <button type="button" id="ex-tree-zoom" class="quiet">${tDynamic("explorer.tree.zoomFocus")}</button>
            <label class="ex-inline"><input id="ex-tree-siblings" type="checkbox" checked> ${tDynamic("explorer.tree.siblings")}</label>
            <label class="ex-inline">${tDynamic("explorer.tree.extinct")} <select id="ex-tree-extinct"><option value="all">${tDynamic("explorer.tree.extinct.all")}</option><option value="200">${tDynamic("explorer.tree.extinct.recent")}</option><option value="0">${tDynamic("explorer.tree.extinct.hidden")}</option></select></label>
            <label class="ex-inline">${tDynamic("explorer.tree.descendants")} <select id="ex-tree-budget"><option value="150">150</option><option value="400" selected>400</option><option value="1500">1500</option></select></label>
            <span id="ex-tree-note" class="tiny"></span>
            <span class="ex-tree-legend"><i class="dot" style="background:#e6f1e9"></i>${tDynamic("explorer.tree.legend.path")} <i class="dot" style="background:#eac789"></i>${tDynamic("explorer.tree.legend.change")} <i class="dot faded"></i>${tDynamic("explorer.tree.legend.extinct")}</span>
          </div>
          <div class="ex-tree-wrap"><canvas id="ex-tree-canvas" role="img" aria-label="${tDynamic("explorer.tree.canvas.aria")}"></canvas></div>
        </section>
        <aside class="explorer-detail" id="ex-tree-detail"><p class="muted">${tDynamic("explorer.empty.tree")}</p></aside>
      </div>

      <div class="explorer-body explorer-body-2" id="ex-tab-saved" hidden>
        <section class="explorer-list">
          <div class="ex-count" id="ex-saved-count"></div>
          <div id="ex-saved" class="ex-groups"></div>
        </section>
        <aside class="explorer-detail" id="ex-saved-detail"><p class="muted">${tDynamic("explorer.empty.saved")}</p></aside>
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
    this.q("#ex-world").textContent = tDynamic("explorer.heading.world", { world: this.opts.worldSide(), tick: w.tick, alive: w.organisms.length, dead: w.deaths.length });
    const strainSel = this.q<HTMLSelectElement>("#ex-strain");
    const prev = strainSel.value;
    strainSel.innerHTML = `<option value="">${tDynamic("explorer.filter.all")}</option>` + [...w.strains.values()].map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
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
    this.q("#ex-count").textContent = tDynamic(this.shown.length > 1 ? "explorer.table.count.many" : "explorer.table.count.one", {
      shown: this.shown.length,
      total: this.entries.length,
      groups: tDynamic(groups.length > 1 ? "explorer.table.groups.many" : "explorer.table.groups.one", { count: groups.length }),
    });
    let budget = MAX_ROWS_TOTAL;
    const html = groups.map((g) => {
      const label = mode === "strain" ? (w.strains.get(Number(g.key))?.name ?? tDynamic("explorer.table.noStrain")) : mode === "strategy" ? STRATEGY_LABEL[g.key as Strategy] : mode === "lineage" ? tDynamic("explorer.table.lineageGroup", { id: g.key }) : tDynamic("explorer.table.all");
      const color = mode === "strain" ? (w.strains.get(Number(g.key))?.color ?? "#8aa0b5") : mode === "strategy" ? STRATEGY_COLOR[g.key as Strategy] : "#8aa0b5";
      const expanded = this.expandedGroups.has(g.key);
      const cap = expanded ? Math.min(g.entries.length, budget) : Math.min(MAX_ROWS_PER_GROUP, g.entries.length, budget);
      budget -= cap;
      const rows = g.entries.slice(0, cap).map((e) => this.rowHtml(e)).join("");
      const more = g.entries.length > cap ? `<button type="button" class="quiet ex-more" data-group="${esc(g.key)}">${expanded ? tDynamic("explorer.table.limit") : tDynamic("explorer.table.more", { count: g.entries.length - cap })}</button>` : "";
      return `<section class="ex-group"><header class="ex-group-head"><i class="swatch" style="background:${color}"></i><b>${esc(label)}</b><span class="tiny">${tDynamic(g.alive > 1 ? "explorer.table.groupStat.many" : "explorer.table.groupStat.one", { total: g.entries.length, alive: g.alive, fitness: fmt(g.meanFitness) })}</span></header>
        <table class="ex-table"><thead><tr><th>${tDynamic("explorer.table.col.id")}</th><th>${tDynamic("explorer.table.col.state")}</th><th class="num">${tDynamic("explorer.table.col.age")}</th><th class="num">${tDynamic("explorer.table.col.fitness")}</th><th class="num">${tDynamic("explorer.table.col.energy")}</th><th class="num">${tDynamic("explorer.table.col.kills")}</th><th class="num">${tDynamic("explorer.table.col.births")}</th><th class="num">${tDynamic("explorer.table.col.mass")}</th><th>${tDynamic("explorer.table.col.lineage")}</th></tr></thead><tbody>${rows}</tbody></table>${more}</section>`;
    });
    this.q("#ex-groups").innerHTML = html.join("") || `<p class="muted">${tDynamic("explorer.empty.list")}</p>`;
  }

  private rowHtml(e: CatalogEntry): string {
    const state = e.alive ? `<span class="hit">${tDynamic("explorer.table.state.alive")}</span>` : `<span class="dead" title="${tDynamic("explorer.table.state.death", { cause: esc(DEATH_LABEL[e.cause!]), tick: String(e.deathTick) })}">${esc(DEATH_SHORT[e.cause!] ?? e.cause!)}</span>`;
    const sel = this.selected?.id === e.id && this.selected.alive === e.alive ? " selected" : "";
    return `<tr class="ex-row${sel}" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}"><td class="mono">${e.id}</td><td>${state}</td><td class="mono num">${e.age}</td><td class="mono num">${fmt(e.fitness)}</td><td class="mono num">${e.energy === null ? "—" : fmt(e.energy, 2)}</td><td class="mono num">${e.kills}</td><td class="mono num">${e.births}</td><td class="mono num">${fmt(e.mass, 2)}</td><td class="mono">${e.lineageId}</td></tr>`;
  }

  private renderRecords(): void {
    const recs = catalogRecords(this.entries).slice(0, 12);
    this.q("#ex-records").innerHTML = recs
      .map((r) => `<button type="button" class="ex-record" data-id="${r.entry.id}" data-alive="${r.entry.alive ? 1 : 0}"><span>${esc(sortLabel(r.sort))}</span><b class="mono">${tDynamic("explorer.record.id", { id: r.entry.id })}</b></button>`)
      .join("") || `<p class="muted">${tDynamic("explorer.empty.records")}</p>`;
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
        this.opts.status(tDynamic("explorer.compare.missingSaved"));
        return;
      }
      this.runCompare(rec.entry.genome, rec.name);
      return;
    }
    const id = Number(this.dialog.querySelector<HTMLInputElement>("#ex-compare-id")?.value);
    if (Number.isInteger(id) && id > 0) {
      const e = this.entries.find((x) => x.id === id);
      if (!e) {
        this.opts.status(tDynamic("explorer.compare.missingOrganism", { id }));
        return;
      }
      this.runCompare(e.genome, tDynamic("explorer.compare.organismLabel", { id: e.id }));
      return;
    }
    this.opts.status(tDynamic("explorer.compare.hint"));
  }

  private runCompare(second: string, secondLabel: string): void {
    const first = this.selected;
    if (!first) return;
    const al = alignSequences(first.genome, second);
    this.compare = { first: first.genome, second, firstLabel: tDynamic("explorer.compare.organismLabel", { id: first.id }), secondLabel };
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
      <div class="align-strip" aria-label="${tDynamic("explorer.compare.ref.aria")}">${rowA}</div>
      <div class="tiny">${esc(secondLabel)}</div>
      <div class="align-strip" aria-label="${tDynamic("explorer.compare.cmp.aria")}">${rowB}</div>
      <p class="micro">${tDynamic("explorer.compare.stats", { matches: al.matches, mismatches: al.mismatches, gaps: al.gaps, score: al.score })}</p>
      <button type="button" data-act="compare-load">${tDynamic("explorer.compare.load")}</button>
    </div>`;
    this.opts.status(tDynamic("explorer.compare.status", { matches: al.matches, mismatches: al.mismatches, gaps: al.gaps }));
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
    const state = e.alive ? `<span class="hit">${tDynamic("explorer.table.state.alive")}</span>` : `<span class="dead">${tDynamic("explorer.table.state.death", { cause: esc(DEATH_LABEL[e.cause!]), tick: String(e.deathTick) })}</span>`;
    return `
      <div class="ex-detail-head"><h3>${tDynamic("explorer.detail.title", { id: e.id })}</h3>${state}</div>
      <div class="ex-facts">
        <span>${tDynamic("explorer.detail.strain")}<b><i class="swatch" style="background:${strain?.color ?? "#8aa0b5"}"></i>${esc(strain?.name ?? "—")}</b></span>
        <span>${tDynamic("explorer.detail.strategy")}<b style="color:${STRATEGY_COLOR[e.strategy]}">${STRATEGY_LABEL[e.strategy]}</b></span>
        <span>${tDynamic("explorer.detail.lineage")}<b><button type="button" class="linklike" data-lineage="${e.lineageId}">${tDynamic("explorer.detail.lineageId", { id: e.lineageId })}</button></b></span>
        <span>${tDynamic("explorer.detail.parent")}<b>${e.parentId < 0 ? tDynamic("explorer.detail.founder") : tDynamic("explorer.detail.parentId", { id: e.parentId })}</b></span>
        <span>${tDynamic("explorer.detail.born")}<b>${e.bornTick}</b></span>
        <span>${tDynamic("explorer.detail.age")}<b>${e.age}</b></span>
        <span>${tDynamic("explorer.detail.fitness")}<b>${fmt(e.fitness)}</b></span>
        <span>${tDynamic("explorer.detail.energy")}<b>${e.energy === null ? "—" : fmt(e.energy, 2)}</b></span>
        <span>${tDynamic("explorer.detail.kills")}<b>${e.kills}</b></span>
        <span>${tDynamic("explorer.detail.births")}<b>${e.births}</b></span>
        <span>${tDynamic("explorer.detail.mass")}<b>${fmt(e.mass, 2)}</b></span>
        <span>${tDynamic("explorer.detail.position")}<b>(${e.x}, ${e.y})</b></span>
      </div>
      <div class="row ex-actions">
        ${e.alive ? `<button type="button" data-act="select" data-id="${e.id}">${icon("inspect")}${tDynamic("explorer.detail.action.world")}</button>` : ""}
        <button type="button" data-act="tree" data-lineage="${e.lineageId}">${icon("chart")}${tDynamic("explorer.detail.action.tree")}</button>
        <button type="button" data-act="highlight" data-lineage="${e.lineageId}">${tDynamic("explorer.detail.action.highlight")}</button>
        <button type="button" data-act="dna" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}">${icon("dna")}${tDynamic("explorer.detail.action.dna")}</button>
        <button type="button" data-act="compare-toggle">${icon("dna")}${tDynamic("explorer.detail.action.compare")}</button>
        <button type="button" class="primary" data-act="save" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}">${icon("save")}${tDynamic("explorer.detail.action.save")}</button>
      </div>
      <div id="ex-compare" class="ex-compare" hidden>
        <label class="tiny" for="ex-compare-id">${tDynamic("explorer.compare.idLabel")}</label>
        <input id="ex-compare-id" type="number" min="1" step="1" placeholder="${tDynamic("explorer.compare.idPlaceholder")}">
        <label class="tiny" for="ex-compare-saved">${tDynamic("explorer.compare.savedLabel")}</label>
        <select id="ex-compare-saved"><option value="">—</option></select>
        <div class="row"><button type="button" data-act="compare-plate">${tDynamic("explorer.compare.plate")}</button><button type="button" class="primary" data-act="compare-run">${tDynamic("explorer.compare.run")}</button></div>
      </div>
      <div id="ex-align"></div>
      <div id="ex-save-form" hidden></div>
      ${phenotypeTableHtml(e.ph)}
      <div class="ex-genome mono">${e.genome}</div>
      <div class="ex-ancestry"><span class="eyebrow">${tDynamic(steps.length > 1 ? "explorer.ancestry.organism.many" : "explorer.ancestry.organism.one", { count: steps.length })}</span>${ancestryHtml(steps, w.tick)}</div>`;
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
    this.q("#ex-lin-count").textContent = tDynamic(nodes.length > 1 ? "explorer.lineage.count.many" : "explorer.lineage.count.one", {
      count: nodes.length,
      more: shown.length < nodes.length ? tDynamic("explorer.lineage.more", { count: shown.length }) : "",
    });
    this.q("#ex-lineages").innerHTML = `<table class="ex-table"><thead><tr><th>${tDynamic("explorer.lineage.col.id")}</th><th>${tDynamic("explorer.lineage.col.parent")}</th><th class="num">${tDynamic("explorer.lineage.col.born")}</th><th class="num">${tDynamic("explorer.lineage.col.extinct")}</th><th class="num">${tDynamic("explorer.lineage.col.alive")}</th><th class="num">${tDynamic("explorer.lineage.col.peak")}</th><th class="num">${tDynamic("explorer.lineage.col.subtree")}</th></tr></thead><tbody>${shown
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
    if (!node) return `<p class="muted">${tDynamic("explorer.detail.unknownLineage", { id })}</p>`;
    const steps = ancestry(w.lineages, w.innovations, id);
    const kids = descendantLineages(w.lineages, id, 40);
    const members = organismsUnderLineage(w.organisms, w.lineages, id);
    const own = w.organisms.filter((o) => o.lineageId === id);
    const sample = own[0] ?? members[0];
    return `
      <div class="ex-detail-head"><h3>${tDynamic("explorer.lineage.title", { id })}</h3>${node.count > 0 ? `<span class="hit">${tDynamic(node.count > 1 ? "explorer.lineage.alive.many" : "explorer.lineage.alive.one", { count: node.count })}</span>` : `<span class="dead">${tDynamic("explorer.lineage.extinctAt", { tick: node.extinctTick ?? "?" })}</span>`}</div>
      <div class="ex-facts">
        <span>${tDynamic("explorer.lineage.born")}<b>${node.bornTick}</b></span>
        <span>${tDynamic("explorer.lineage.peak")}<b>${node.peakCount}</b></span>
        <span>${tDynamic("explorer.lineage.parent")}<b>${node.parentId < 0 ? tDynamic("explorer.lineage.founder") : `<button type="button" class="linklike" data-lineage="${node.parentId}">${tDynamic("explorer.lineage.parentId", { id: node.parentId })}</button>`}</b></span>
        <span>${tDynamic("explorer.lineage.sub")}<b>${descendantLineages(w.lineages, id, 100000).length}</b></span>
        <span>${tDynamic("explorer.lineage.aliveSubtree")}<b>${subtreeCount(w.lineages, id)}</b></span>
        <span>${tDynamic("explorer.lineage.signature")}<b class="mono">${esc(node.signature)}</b></span>
      </div>
      <div class="row ex-actions">
        <button type="button" data-act="tree" data-lineage="${id}">${icon("chart")}${tDynamic("explorer.detail.action.tree")}</button>
        <button type="button" data-act="highlight" data-lineage="${id}">${tDynamic("explorer.lineage.action.highlight")}</button>
        <button type="button" data-act="members" data-lineage="${id}">${icon("inspect")}${tDynamic("explorer.lineage.action.members")}</button>
        ${sample ? `<button type="button" data-act="dna-org" data-id="${sample.id}">${icon("dna")}${tDynamic("explorer.lineage.action.dna")}</button>` : ""}
      </div>
      <div class="ex-ancestry"><span class="eyebrow">${tDynamic(steps.length > 1 ? "explorer.ancestry.lineage.many" : "explorer.ancestry.lineage.one", { count: steps.length })}</span>${ancestryHtml(steps, w.tick)}</div>
      ${kids.length ? `<div class="ex-ancestry"><span class="eyebrow">${tDynamic("explorer.lineage.kids.heading")}</span><ul class="ex-kids">${kids.map((k) => `<li><button type="button" class="linklike" data-lineage="${k.id}">${tDynamic("explorer.lineage.kids.id", { id: k.id })}</button>${tDynamic(k.count > 0 ? "explorer.lineage.kids.alive" : "explorer.lineage.kids.extinct", { born: k.bornTick, count: k.count, tick: String(k.extinctTick), peak: k.peakCount })}</li>`).join("")}</ul></div>` : ""}`;
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
      strainName: (sid) => w().strains.get(sid)?.name ?? tDynamic("explorer.tree.unknownStrain"),
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
      ? tDynamic(layout.nodes.length > 1 ? "explorer.tree.note.many" : "explorer.tree.note.one", {
          count: layout.nodes.length,
          path: layout.path.length,
          focus: focusId,
          hidden: hidden ? tDynamic("explorer.tree.note.hidden", { count: hidden }) : "",
        })
      : tDynamic("explorer.tree.unknown", { focus: focusId });
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
    this.q("#ex-saved-count").textContent = tDynamic(this.saved.length > 1 ? "explorer.saved.count.many" : "explorer.saved.count.one", { count: this.saved.length });
    this.q("#ex-saved").innerHTML = this.saved.length
      ? `<table class="ex-table"><thead><tr><th>${tDynamic("explorer.saved.col.name")}</th><th>${tDynamic("explorer.saved.col.id")}</th><th>${tDynamic("explorer.saved.col.origin")}</th><th class="num">${tDynamic("explorer.saved.col.fitness")}</th><th class="num">${tDynamic("explorer.saved.col.kills")}</th><th class="num">${tDynamic("explorer.saved.col.branch")}</th><th>${tDynamic("explorer.saved.col.world")}</th></tr></thead><tbody>${this.saved
          .map((s) => `<tr class="ex-row${this.savedSelected?.id === s.id ? " selected" : ""}" data-saved="${s.id}"><td>${esc(s.name)}</td><td class="mono">${s.entry.id}</td><td class="tiny">${tDynamic("explorer.saved.source", { label: esc(s.source.label), tick: s.source.tick, seed: s.source.seed })}</td><td class="mono num">${fmt(s.entry.fitness)}</td><td class="mono num">${s.entry.kills}</td><td class="mono num">${s.steps}</td><td>${s.hasSnapshot ? tDynamic("explorer.saved.included") : "—"}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">${tDynamic("explorer.empty.savedList")}</p>`;
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
        <span>${tDynamic("explorer.saved.organism")}<b>${e.alive ? tDynamic("explorer.saved.organism.alive", { id: e.id }) : tDynamic("explorer.saved.organism.dead", { id: e.id, cause: esc(DEATH_LABEL[e.cause!]) })}</b></span>
        <span>${tDynamic("explorer.saved.origin")}<b>${tDynamic("explorer.saved.sourceShort", { label: esc(rec.source.label), tick: rec.source.tick })}</b></span>
        <span>${tDynamic("explorer.saved.seed")}<b class="mono">${rec.source.seed}</b></span>
        <span>${tDynamic("explorer.detail.strain")}<b>${esc(rec.strainName)}</b></span>
        <span>${tDynamic("explorer.detail.strategy")}<b>${STRATEGY_LABEL[e.strategy]}</b></span>
        <span>${tDynamic("explorer.detail.age")}<b>${e.age}</b></span>
        <span>${tDynamic("explorer.detail.fitness")}<b>${fmt(e.fitness)}</b></span>
        <span>${tDynamic("explorer.detail.kills")}<b>${e.kills}</b></span>
        <span>${tDynamic("explorer.saved.descendants")}<b>${e.births}</b></span>
        <span>${tDynamic("explorer.saved.simulation")}<b>${rec.snapshot ? tDynamic("explorer.saved.simIncluded") : tDynamic("explorer.saved.simMissing")}</b></span>
      </div>
      <div class="row ex-actions">
        <button type="button" data-act="saved-dna" data-saved="${id}">${icon("dna")}${tDynamic("explorer.detail.action.dna")}</button>
        ${rec.snapshot ? `<button type="button" class="primary" data-act="saved-world" data-saved="${id}">${icon("play")}${tDynamic("explorer.saved.action.world")}</button>` : ""}
        <button type="button" class="quiet" data-act="saved-export" data-saved="${id}">${icon("save")}${tDynamic("explorer.saved.action.export")}</button>
        <button type="button" class="danger" data-act="saved-remove" data-saved="${id}">${tDynamic("explorer.saved.action.remove")}</button>
      </div>
      ${phenotypeTableHtml(e.ph)}
      <div class="ex-genome mono">${e.genome}</div>
      <div class="ex-ancestry"><span class="eyebrow">${tDynamic(rec.ancestry.length > 1 ? "explorer.ancestry.saved.many" : "explorer.ancestry.saved.one", { count: rec.ancestry.length })}</span>${ancestryHtml(rec.ancestry, rec.source.tick)}</div>`;
  }

  private saveForm(e: CatalogEntry): void {
    const form = this.q("#ex-save-form");
    form.hidden = false;
    form.innerHTML = `<div class="ex-save">
      <input id="ex-save-name" type="text" maxlength="48" placeholder="${tDynamic("explorer.save.namePlaceholder", { id: e.id })}" value="${e.alive ? "" : ""}">
      <label class="ex-inline"><input id="ex-save-world" type="checkbox" checked> ${tDynamic("explorer.save.includeWorld")}</label>
      <div class="row"><button type="button" class="primary" data-act="save-confirm" data-id="${e.id}" data-alive="${e.alive ? 1 : 0}">${tDynamic("explorer.save.confirm")}</button><button type="button" class="quiet" data-act="save-cancel">${tDynamic("explorer.save.cancel")}</button></div>
    </div>`;
    this.q<HTMLInputElement>("#ex-save-name").focus();
  }

  private async saveOrganism(e: CatalogEntry, name: string, includeWorld: boolean): Promise<void> {
    const w = this.opts.world();
    const rec: SavedOrganism = {
      id: `${Date.now().toString(36)}-${e.id}`,
      name: name.trim() || tDynamic("explorer.save.defaultName", { id: e.id }),
      savedAt: Date.now(),
      source: { world: this.opts.worldSide(), tick: w.tick, seed: w.params.seed, label: tDynamic("explorer.save.worldLabel", { world: this.opts.worldSide() }) },
      entry: { ...e, ph: { ...e.ph } },
      ancestry: ancestry(w.lineages, w.innovations, e.lineageId).map((s) => ({ lineage: { ...s.lineage }, innovation: s.innovation ? { ...s.innovation, changes: s.innovation.changes.map((c) => ({ ...c })), env: { ...s.innovation.env } } : null, depth: s.depth })),
      strainName: w.strains.get(e.strainId)?.name ?? "—",
    };
    if (includeWorld) rec.snapshot = w.snapshot();
    await this.opts.store.saveOrganism(rec);
    this.q("#ex-save-form").hidden = true;
    await this.refreshSaved();
    this.opts.status(tDynamic("explorer.save.done", { id: e.id, name: rec.name, world: includeWorld ? tDynamic("explorer.save.withWorld") : "" }));
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
          this.opts.status(tDynamic("explorer.status.selected", { id: entry.id }));
        }
        return;
      case "highlight": {
        const id = Number(el.dataset.lineage);
        this.opts.highlightLineage(id);
        this.opts.status(tDynamic("explorer.status.highlighted", { id }));
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
        if (entry) this.opts.loadGenome(entry.genome, tDynamic("explorer.compare.organismLabel", { id: entry.id }));
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
          this.opts.status(tDynamic("explorer.status.noPlateSelection"));
          return;
        }
        this.runCompare(sel.genome, tDynamic("explorer.compare.organismPlate", { id: sel.id }));
        return;
      }
      case "compare-run":
        void this.runCompareFromPicker();
        return;
      case "compare-load":
        if (this.compare) {
          this.opts.loadGenome(this.compare.second, this.compare.secondLabel, { diffAgainst: this.compare.first });
          this.opts.status(tDynamic("explorer.status.compareLoaded", { second: this.compare.secondLabel, first: this.compare.firstLabel }));
        }
        return;
      case "dna-org": {
        const o = this.opts.world().organisms.find((x) => x.id === Number(el.dataset.id));
        if (o) this.opts.loadGenome(o.genome, tDynamic("explorer.compare.organismLabel", { id: o.id }));
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
          this.opts.status(tDynamic("explorer.status.worldRestored", { name: this.savedSelected.name, tick: this.savedSelected.source.tick, seed: this.savedSelected.source.seed }));
        }
        return;
      case "saved-export":
        if (this.savedSelected) this.exportSaved(this.savedSelected);
        return;
      case "saved-remove":
        if (this.savedSelected) {
          void this.opts.store.removeOrganism(this.savedSelected.id).then(() => {
            this.savedSelected = null;
            this.q("#ex-saved-detail").innerHTML = `<p class="muted">${tDynamic("explorer.empty.saved")}</p>`;
            return this.refreshSaved();
          });
        }
        return;
    }
  }
}

/** Vertical evolution branch: one card per lineage from the founder, mutations that opened it, biggest changes marked. */
export function ancestryHtml(steps: readonly AncestryStep[], now: number): string {
  if (!steps.length) return `<p class="muted">${tDynamic("explorer.ancestry.unknown")}</p>`;
  const big = new Set(biggestChanges(steps, 3).map((b) => `${b.step.lineage.id}:${b.change.trait}`));
  return `<ol class="ex-branch">${steps
    .map((s) => {
      const l: LineageNode = s.lineage;
      const alive = l.count > 0 ? (l.count > 1 ? tDynamic("explorer.ancestry.alive.many", { count: l.count }) : tDynamic("explorer.ancestry.alive.one", { count: l.count })) : l.extinctTick !== null ? tDynamic("explorer.ancestry.extinct", { tick: l.extinctTick }) : tDynamic("explorer.ancestry.noMember");
      const changes = s.innovation
        ? s.innovation.changes.map((c) => {
            const d = c.to - c.from;
            const key = `${l.id}:${c.trait}`;
            return `<span class="ex-change${big.has(key) ? " big" : ""}" style="--g:${TRAIT_COLOR[c.trait]}">${TRAIT_LABEL[c.trait]} ${fmt(c.from, 2)} → ${fmt(c.to, 2)} <em class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${fmt(Math.abs(d), 2)}</em></span>`;
          }).join("")
        : s.depth === 0 ? `<span class="ex-change neutral">${tDynamic("explorer.ancestry.founderGenome")}</span>` : `<span class="ex-change neutral">${tDynamic("explorer.ancestry.neutralMutation")}</span>`;
      const env = s.innovation ? `<div class="tiny">${tDynamic("explorer.ancestry.env", { temp: fmt(s.innovation.env.temperature, 2), nutrient: fmt(s.innovation.env.nutrient, 2), toxin: fmt(s.innovation.env.toxin, 2), light: fmt(s.innovation.env.light, 2), kind: s.innovation.kind })}</div>` : "";
      return `<li class="ex-step"><div class="ex-step-head"><b>${tDynamic("explorer.ancestry.lineage")} <button type="button" class="linklike" data-lineage="${l.id}">${tDynamic("explorer.ancestry.lineageId", { id: l.id })}</button></b><span class="tiny">${tDynamic("explorer.ancestry.step", { tick: l.bornTick, end: l.bornTick < now ? ` → ${l.extinctTick ?? now}` : "", peak: l.peakCount, alive })}</span></div><div class="ex-changes">${changes}</div>${env}</li>`;
    })
    .join("")}</ol>`;
}
