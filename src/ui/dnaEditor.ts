/**
 * Visual DNA editor. Owns the "Éditeur d’ADN" block in the Organismes panel:
 * gene cards, base-by-base strip with selection editing, codon palette,
 * live phenotype deltas, undo/redo, and the raw-sequence fallback.
 *
 * The sequence in `EditHistory.present` is the single source of truth; every
 * interaction produces a new sequence via `src/sim/dnaEdit.ts` and re-renders.
 */
import { phenotypeDiffHtml } from "../render/genomeBrowser";
import {
  CODON_TABLE,
  DNA_KITS,
  EditHistory,
  MAX_GENOME,
  TRAIT_NAMES,
  annotateSequence,
  appendGene,
  bumpGene,
  deleteRange,
  duplicateMutate,
  duplicateRange,
  founderHeterotroph,
  geneColor,
  geneStrength,
  genomeForKit,
  indelMutate,
  insertAt,
  moveGene,
  pointMutate,
  removeGene,
  probeLandscape,
  replaceRange,
  sanitizeSequence,
  sequenceDiff,
  setGeneStrength,
  validateSequence,
  type CodonCell,
  type DnaAnnotation,
  type EnvSample,
  type LandscapeHit,
  type SeqHunk,
  type TraitName,
} from "../sim/index";
import { Rng } from "../sim/rng";
import { TRAIT_HINT, TRAIT_LABEL } from "./labels";
import { icon, KIT_COPY } from "./layout";

export interface DnaEditorOptions {
  status(msg: string): void;
  onChange?(seq: string): void;
  onApply(seq: string): void;
  onPlace(): void;
  /** Genome of the organism currently inspected, if any. */
  selectedGenome(): { id: number; genome: string } | null;
  /** Local environment for the landscape probe. */
  env(): EnvSample;
  envLabel(): string;
}

interface Sel {
  a: number;
  b: number;
}

const BASES = ["A", "C", "G", "T"] as const;
const CONTROL_CODONS = [
  { codon: "ATG", label: "début" },
  { codon: "TAA", label: "fin" },
  { codon: "TAG", label: "fin" },
  { codon: "TGA", label: "fin" },
];

function fmtDelta(d: number): string {
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(2)}`;
}

function template(): string {
  const founders = DNA_KITS.map((k) => `<option value="${k.id}">${KIT_COPY[k.id]?.label ?? k.label}</option>`).join("");
  const traitOptions = TRAIT_NAMES.map((t) => `<option value="${t}">${TRAIT_LABEL[t]}</option>`).join("");
  const geneAdd = TRAIT_NAMES.map(
    (t) => `<button type="button" id="gene-add-${t}" class="gene-add-btn" data-trait="${t}"><span class="swatch" style="background:${geneColor(t)}"></span>${TRAIT_LABEL[t]}</button>`,
  ).join("");
  return `
    <div class="section-heading"><h2>${icon("dna")} Éditeur d’ADN</h2><span class="tag" id="dna-meta">0 BASES · 0 GÈNES</span></div>
    <p class="muted">Séquence ACGT décodée en direct : ORF (ATG … stop) → codons → deltas de traits → phénotype.</p>
    <div class="dna-toolbar" role="toolbar" aria-label="Historique de l’édition">
      <button type="button" id="dna-undo" class="quiet" disabled>${icon("undo")}<span>Annuler</span></button>
      <button type="button" id="dna-redo" class="quiet" disabled>${icon("redo")}<span>Rétablir</span></button>
      <button type="button" id="dna-revert" class="quiet" disabled>${icon("revert")}<span>Revenir</span></button>
      <span class="spacer"></span>
      <button type="button" id="btn-from-inspect" class="quiet">${icon("inspect")}<span>Copier la sélection</span></button>
      <button type="button" id="btn-clear-genes" class="quiet">Vider</button>
    </div>
    <div id="dna-cassette" class="dna-cassette" role="group" aria-label="Carte du génome"></div>
    <details id="dna-builder" open>
      <summary>Gènes <span class="tag">VISUEL</span></summary>
      <div id="gene-blocks" class="gene-blocks"></div>
      <div class="gene-add-wrap"><span class="eyebrow">AJOUTER UN GÈNE</span><div id="gene-add" class="gene-add-grid">${geneAdd}</div></div>
    </details>
    <details id="dna-strip-section" open>
      <summary>Séquence base par base <span class="tag">ACGT</span></summary>
      <div id="dna-strip" class="dna-strip" tabindex="0" role="application" data-own-keys aria-label="Séquence ACGT. Flèches : déplacer la sélection ; A, C, G, T : remplacer ; Retour arrière : supprimer ; Maj : étendre."></div>
      <div id="dna-sel" class="dna-selection"></div>
      <div class="dna-palette">
        <div class="dna-palette-head"><span class="eyebrow">INSÉRER APRÈS LA SÉLECTION</span><select id="dna-palette-trait" aria-label="Trait des codons proposés"><option value="control">Début / fin</option>${traitOptions}</select></div>
        <div id="dna-palette-codons" class="codon-chips"></div>
      </div>
      <div id="dna-warnings" class="dna-warnings" aria-live="polite"></div>
    </details>
    <details id="dna-landscape">
      <summary>Paysage</summary>
      <p class="micro" id="dna-landscape-env"></p>
      <div class="tiny">Meilleures substitutions</div>
      <div id="dna-landscape-best" class="landscape-list"></div>
      <div class="tiny">Pires substitutions</div>
      <div id="dna-landscape-worst" class="landscape-list"></div>
    </details>
    <div class="dna-pheno-head"><span class="eyebrow">PHÉNOTYPE</span><span class="tiny" id="dna-pheno-note">comparé au génome chargé</span></div>
    <div id="builder-pheno"></div>
    <div class="row dna-actions">
      <button type="button" id="btn-apply" class="primary">${icon("edit")}<span>Appliquer à la sélection</span></button>
      <button type="button" id="btn-dna-place">${icon("plus")}<span>Placer dans le monde</span></button>
      <button type="button" id="btn-dna-copy" class="quiet" aria-label="Copier la séquence">${icon("copy")}</button>
    </div>
    <details id="dna-advanced">
      <summary>Séquence brute et mutations <span class="tag">AVANCÉ</span></summary>
      <div class="stack">
        <label class="tiny" for="genome-edit">Séquence ACGT</label>
        <textarea id="genome-edit" spellcheck="false" placeholder="Séquence ACGT — ATG…TAA"></textarea>
        <div class="row"><button type="button" id="btn-point">Mutation ponctuelle</button><button type="button" id="btn-indel">Insertion / délétion</button><button type="button" id="btn-dup">Duplication</button></div>
        <label class="tiny" for="founder">Génome de départ</label>
        <div class="row"><select id="founder">${founders}</select><button type="button" id="btn-load-founder">Charger</button></div>
      </div>
    </details>`;
}

export class DnaEditor {
  readonly root: HTMLElement;
  private readonly opts: DnaEditorOptions;
  private readonly history = new EditHistory("");
  private reference = "";
  private diffAgainst: string | null = null;
  private diffHunks: SeqHunk[] = [];
  private ann: DnaAnnotation = annotateSequence("");
  private sel: Sel | null = null;
  private anchor = -1;
  private sliding = false;
  private fromTextarea = false;
  private paletteTrait = "control";
  private readonly rng = new Rng(0x51ed);
  private readonly q: <T extends HTMLElement>(sel: string) => T;

  constructor(root: HTMLElement, opts: DnaEditorOptions) {
    this.root = root;
    this.opts = opts;
    root.innerHTML = template();
    this.q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.bind();
    this.render();
  }

  get sequence(): string {
    return this.history.present;
  }

  get geneCount(): number {
    return this.ann.decoded.genes.length;
  }

  get isDirty(): boolean {
    return this.sequence !== this.reference;
  }

  /** Load a genome from outside (kit, inspected organism, founder). Undo still restores the previous state. */
  load(seq: string, opts: { reference?: boolean; diffAgainst?: string } = {}): void {
    const clean = sanitizeSequence(seq);
    this.history.push(clean);
    this.diffAgainst = opts.diffAgainst !== undefined ? sanitizeSequence(opts.diffAgainst) : null;
    this.diffHunks = this.diffAgainst ? sequenceDiff(this.diffAgainst, clean) : [];
    if (this.diffAgainst) this.reference = this.diffAgainst;
    else if (opts.reference !== false) this.reference = clean;
    this.sel = null;
    this.render();
  }

  focusStrip(): void {
    this.q("#dna-strip-section").setAttribute("open", "");
    this.q("#dna-strip").focus({ preventScroll: true });
  }

  /* ---------------- state ---------------- */

  private commit(next: string, sel: Sel | null | undefined = undefined, msg?: string): boolean {
    const changed = this.history.push(next);
    if (sel !== undefined) this.sel = sel;
    this.render();
    if (changed && msg) this.opts.status(msg);
    return changed;
  }

  private clampSel(): void {
    const n = this.sequence.length;
    if (!this.sel) return;
    if (n === 0) {
      this.sel = null;
      return;
    }
    const a = Math.max(0, Math.min(this.sel.a, n - 1));
    const b = Math.max(a + 1, Math.min(this.sel.b, n));
    this.sel = { a, b };
  }

  private cellAt(i: number): CodonCell | null {
    for (const c of this.ann.cells) if (i >= c.start && i < c.start + c.bases.length) return c;
    return null;
  }

  private baseIsDiff(i: number): boolean {
    for (const h of this.diffHunks) {
      if (h.kind === "del") {
        if (i === h.a || (h.a > 0 && i === h.a - 1)) return true;
      } else if (i >= h.a && i < h.b) return true;
    }
    return false;
  }

  private diffCount(): number {
    return this.diffHunks.reduce((s, h) => s + Math.max(1, h.b - h.a), 0);
  }

  private insertionPoint(): number {
    return this.sel ? this.sel.b : this.sequence.length;
  }

  private selectDiff(before: string, after: string): Sel | null {
    if (before === after) return this.sel;
    let i = 0;
    while (i < before.length && i < after.length && before[i] === after[i]) i++;
    if (i >= after.length) return after.length ? { a: after.length - 1, b: after.length } : null;
    const grow = Math.max(1, after.length - before.length);
    return { a: i, b: Math.min(after.length, i + grow) };
  }

  /* ---------------- rendering ---------------- */

  private render(): void {
    this.ann = annotateSequence(this.sequence);
    this.clampSel();
    this.renderMeta();
    this.renderMinimap();
    this.renderGenes();
    this.renderStrip();
    this.renderSelection();
    this.renderPalette();
    this.renderIssues();
    this.renderPheno();
    this.renderLandscape();
    this.syncTextarea();
    this.opts.onChange?.(this.sequence);
  }

  private renderMeta(): void {
    const n = this.sequence.length;
    const g = this.geneCount;
    this.q("#dna-meta").textContent = `${n} BASE${n > 1 ? "S" : ""} · ${g} GÈNE${g > 1 ? "S" : ""}${this.isDirty ? " · MODIFIÉ" : ""}`;
    (this.q("#dna-undo") as HTMLButtonElement).disabled = !this.history.canUndo;
    (this.q("#dna-redo") as HTMLButtonElement).disabled = !this.history.canRedo;
    (this.q("#dna-revert") as HTMLButtonElement).disabled = !this.isDirty;
    this.q("#dna-pheno-note").textContent = this.diffAgainst
      ? "comparé au génome parental"
      : this.isDirty
        ? "comparé au génome chargé"
        : "identique au génome chargé";
  }

  private renderMinimap(): void {
    const host = this.q("#dna-cassette");
    if (this.sequence.length === 0) {
      host.innerHTML = `<div class="cas-empty">génome vide</div>`;
      return;
    }
    const segs: string[] = [];
    let run: { role: string; gene: number; start: number; len: number; color: string } | null = null;
    const flush = () => {
      if (!run) return;
      const gene = run.gene >= 0 ? this.ann.decoded.genes[run.gene] : null;
      const label = gene ? `${TRAIT_LABEL[gene.dominant as TraitName]} · ${geneStrength(gene)} codons` : run.role === "open" ? "Gène non terminé (ignoré)" : "Hors gène";
      const bg = run.color ? `background:${run.color}` : "";
      segs.push(`<button type="button" class="cas-seg role-${run.role}" data-a="${run.start}" data-b="${run.start + run.len}" style="flex:${run.len};${bg}" title="${label}" aria-label="${label}"></button>`);
      run = null;
    };
    for (const c of this.ann.cells) {
      const key = c.gene >= 0 ? `g${c.gene}` : c.role;
      if (run && (run.gene >= 0 ? `g${run.gene}` : run.role) === key) run.len += c.bases.length;
      else {
        flush();
        run = { role: c.role, gene: c.gene, start: c.start, len: c.bases.length, color: c.color };
      }
    }
    flush();
    host.innerHTML = segs.join("");
  }

  private renderGenes(): void {
    const host = this.q("#gene-blocks");
    const genes = this.ann.decoded.genes;
    if (genes.length === 0) {
      host.innerHTML = `<p class="muted">Aucun gène. Ajoutez-en un ci-dessous ou choisissez un kit.</p>`;
      return;
    }
    host.innerHTML = genes
      .map((g, i) => {
        const trait = g.dominant as TraitName;
        const color = geneColor(trait);
        const strength = geneStrength(g);
        const contrib = Object.entries(g.contrib)
          .filter(([, v]) => Math.abs(v) > 1e-9)
          .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
          .map(([t, v]) => `<span><i class="swatch" style="background:${geneColor(t as TraitName)}"></i>${TRAIT_LABEL[t as TraitName]} ${fmtDelta(v)}</span>`)
          .join("");
        const selected = this.sel && this.sel.a >= g.start && this.sel.b <= g.end ? " selected" : "";
        return `<div class="gene-chip${selected}" data-i="${i}" style="--g:${color};border-left-color:${color}">
          <div class="chip-title" data-select="${i}">
            <span class="swatch" style="background:${color}"></span>
            <strong>${TRAIT_LABEL[trait]}</strong>
            <span class="mono">${strength}</span><span class="tiny">codon${strength > 1 ? "s" : ""}</span>
            <span class="chip-ops">
              <button type="button" data-act="minus" data-i="${i}" aria-label="Réduire la force" ${strength <= 1 ? "disabled" : ""}>−</button>
              <button type="button" data-act="plus" data-i="${i}" aria-label="Augmenter la force">+</button>
              <button type="button" data-act="up" data-i="${i}" aria-label="Monter le gène" ${i === 0 ? "disabled" : ""}>↑</button>
              <button type="button" data-act="down" data-i="${i}" aria-label="Descendre le gène" ${i === genes.length - 1 ? "disabled" : ""}>↓</button>
              <button type="button" data-act="del" data-i="${i}" aria-label="Retirer le gène">×</button>
            </span>
          </div>
          <input type="range" class="strength-range" data-i="${i}" min="1" max="12" step="1" value="${Math.min(12, strength)}" aria-label="Force du gène ${TRAIT_LABEL[trait]}">
          <div class="hint">${TRAIT_HINT[trait]}</div>
          <div class="gene-contrib">${contrib}</div>
          <div class="gene-span tiny">bases ${g.start}–${g.end - 1} · <span class="aa mono">${g.translation}</span></div>
        </div>`;
      })
      .join("");
  }

  private renderStrip(): void {
    const host = this.q("#dna-strip");
    if (this.sequence.length === 0) {
      host.innerHTML = `<p class="muted">Séquence vide. Insérez un codon ci-dessous ou ajoutez un gène.</p>`;
      return;
    }
    const sel = this.sel;
    const genes = this.ann.decoded.genes;
    const parts: string[] = [];
    for (const c of this.ann.cells) {
      const gene = c.gene >= 0 ? genes[c.gene] : null;
      const label = gene ? TRAIT_LABEL[gene.dominant as TraitName] : "";
      let help = "";
      if (c.role === "start") help = `ATG · début du gène ${c.gene + 1} (${label})`;
      else if (c.role === "stop") help = `${c.bases} · fin du gène ${c.gene + 1} (${label})`;
      else if (c.role === "coding") help = c.trait ? `${c.bases} → ${c.aa} · ${TRAIT_LABEL[c.trait]} ${fmtDelta(c.delta)}` : `${c.bases} · sans effet`;
      else if (c.role === "open") help = `${c.bases} · gène non terminé : ignoré par l’organisme`;
      else if (c.role === "reg") help = `${c.bases} · région régulatrice : amplifie l’expression du gène ${c.gene + 1}`;
      else help = `${c.bases} · hors gène : sans effet`;
      const tiles = [...c.bases]
        .map((b, k) => {
          const i = c.start + k;
          const on = sel && i >= sel.a && i < sel.b ? " sel" : "";
          const diff = this.baseIsDiff(i) ? " nt-diff" : "";
          return `<span class="nt nt-${b}${on}${diff}" data-i="${i}">${b}</span>`;
        })
        .join("");
      const badge = c.role === "start" ? `<b class="gene-tag">${c.gene + 1}</b>` : "";
      const aa = c.role === "coding" && c.aa ? `<em class="aa-tag">${c.aa}</em>` : "";
      parts.push(`<span class="codon role-${c.role}" data-start="${c.start}" data-len="${c.bases.length}" data-help="${help}" style="--g:${c.color || "transparent"}">${badge}${tiles}${aa}</span>`);
    }
    host.innerHTML = parts.join("");
    if (sel) {
      const first = host.querySelector<HTMLElement>(`.nt[data-i="${sel.a}"]`);
      if (first) {
        const r = first.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        if (r.top < hr.top || r.bottom > hr.bottom) first.scrollIntoView({ block: "nearest" });
      }
    }
  }

  private renderSelection(): void {
    const host = this.q("#dna-sel");
    const sel = this.sel;
    if (!sel) {
      const diff = this.diffAgainst ? `${this.diffCount()} bases modifiées par rapport au parent. ` : "";
      host.innerHTML = `<span class="muted">${diff}Cliquez sur une base pour la sélectionner. Double-clic : le codon entier. Glissez ou Maj + clic : une plage.</span>`;
      return;
    }
    const n = sel.b - sel.a;
    let info: string;
    if (n === 1) {
      const c = this.cellAt(sel.a);
      const base = this.sequence[sel.a];
      if (!c) info = `Base ${sel.a} · ${base}`;
      else if (c.role === "coding" && c.trait) info = `Base ${sel.a} · codon ${c.bases} → ${c.aa} · ${TRAIT_LABEL[c.trait]} ${fmtDelta(c.delta)}`;
      else if (c.role === "start") info = `Base ${sel.a} · ATG, début du gène ${c.gene + 1}`;
      else if (c.role === "stop") info = `Base ${sel.a} · ${c.bases}, fin du gène ${c.gene + 1}`;
      else if (c.role === "open") info = `Base ${sel.a} · gène non terminé`;
      else info = `Base ${sel.a} · hors gène`;
    } else {
      info = `Bases ${sel.a}–${sel.b - 1} · ${n} bases · ${this.sequence.slice(sel.a, Math.min(sel.b, sel.a + 12))}${n > 12 ? "…" : ""}`;
    }
    if (this.diffAgainst) info += ` · ${this.diffCount()} bases modifiées par rapport au parent`;
    const bases = BASES.map((b) => `<button type="button" class="base-btn nt-${b}" data-set="${b}" aria-label="Remplacer par ${b}">${b}</button>`).join("");
    host.innerHTML = `<div class="sel-info mono">${info}</div>
      <div class="sel-ops">
        <span class="base-set" role="group" aria-label="Remplacer la sélection par">${bases}</span>
        <button type="button" class="quiet" data-sel="dup" title="Dupliquer la sélection (⌘D)">Dupliquer</button>
        <button type="button" class="quiet" data-sel="del" title="Supprimer la sélection (⌫)">Supprimer</button>
        <button type="button" class="quiet" data-sel="none" title="Désélectionner (Échap)">×</button>
      </div>`;
  }

  private renderPalette(): void {
    const host = this.q("#dna-palette-codons");
    (this.q("#dna-palette-trait") as HTMLSelectElement).value = this.paletteTrait;
    if (this.paletteTrait === "control") {
      host.innerHTML = CONTROL_CODONS.map((c) => `<button type="button" class="codon-chip" data-codon="${c.codon}"><span class="mono">${c.codon}</span><small>${c.label}</small></button>`).join("");
      return;
    }
    const trait = this.paletteTrait as TraitName;
    const rows = CODON_TABLE.filter((r) => r.trait === trait).sort((x, y) => y.delta - x.delta);
    host.innerHTML = rows
      .map((r) => `<button type="button" class="codon-chip ${r.delta < 0 ? "neg" : ""}" data-codon="${r.codon}" style="--g:${geneColor(trait)}"><span class="mono">${r.codon}</span><small>${r.aa} ${fmtDelta(r.delta)}</small></button>`)
      .join("");
  }

  private renderIssues(): void {
    const host = this.q("#dna-warnings");
    const issues = validateSequence(this.ann);
    host.innerHTML = issues.map((i) => `<div class="dna-issue ${i.level}">${icon(i.level === "warn" ? "warn" : "help")}<span>${i.text}</span></div>`).join("");
  }

  private renderPheno(): void {
    const ref = annotateSequence(this.reference).decoded.phenotype;
    this.q("#builder-pheno").innerHTML = phenotypeDiffHtml(this.ann.decoded.phenotype, ref);
  }

  private renderLandscape(): void {
    const box = this.q<HTMLDetailsElement>("#dna-landscape");
    const envEl = this.q("#dna-landscape-env");
    if (!box.open) {
      envEl.textContent = "Ouvrez pour évaluer les substitutions d’un codon dans les gènes, à l’environnement local.";
      this.q("#dna-landscape-best").innerHTML = "";
      this.q("#dna-landscape-worst").innerHTML = "";
      return;
    }
    const env = this.opts.env();
    const probe = probeLandscape(this.sequence, env, 10);
    envEl.textContent = `${this.opts.envLabel()} · fitness de référence ${probe.baseline.toFixed(3)}.`;
    const maxAbs = Math.max(0.001, ...probe.best.map((h) => Math.abs(h.deltaFitness)), ...probe.worst.map((h) => Math.abs(h.deltaFitness)));
    const row = (h: LandscapeHit, kind: "best" | "worst") => {
      const traits = Object.entries(h.traits)
        .filter(([, d]) => d)
        .map(([t, d]) => `${TRAIT_LABEL[t as TraitName] ?? t} ${fmtDelta(d!)}`)
        .join(" · ");
      const w = Math.max(4, (Math.abs(h.deltaFitness) / maxAbs) * 100);
      return `<button type="button" class="landscape-hit ${kind}" data-pos="${h.position}" data-codon="${h.codon}" title="Remplacer ${h.from} par ${h.codon} à la base ${h.position}">
        <i style="width:${w.toFixed(0)}%"></i>
        <span class="mono">${h.from}→${h.codon}</span>
        <span class="pos">@${h.position}</span>
        <span class="fit">${fmtDelta(h.deltaFitness)}</span>
        <span class="tiny">${traits}</span>
      </button>`;
    };
    this.q("#dna-landscape-best").innerHTML = probe.best.map((h) => row(h, "best")).join("") || `<p class="muted">Aucune substitution n’améliore la fitness.</p>`;
    this.q("#dna-landscape-worst").innerHTML = probe.worst.map((h) => row(h, "worst")).join("") || `<p class="muted">Aucune substitution n’abaisse la fitness.</p>`;
  }

  private syncTextarea(): void {
    const ta = this.q<HTMLTextAreaElement>("#genome-edit");
    if (this.fromTextarea) return;
    if (ta.value !== this.sequence) ta.value = this.sequence;
  }

  /* ---------------- events ---------------- */

  private bind(): void {
    const { root } = this;
    const status = this.opts.status;

    this.q("#dna-undo").addEventListener("click", () => {
      const prev = this.history.undo();
      if (prev === null) return;
      this.sel = null;
      this.render();
      status("Modification annulée.");
    });
    this.q("#dna-redo").addEventListener("click", () => {
      const next = this.history.redo();
      if (next === null) return;
      this.sel = null;
      this.render();
      status("Modification rétablie.");
    });
    this.q("#dna-revert").addEventListener("click", () => this.commit(this.reference, null, "Génome chargé rétabli."));
    this.q("#btn-clear-genes").addEventListener("click", () => this.commit("", null, "Génome vidé : phénotype basal."));
    this.q("#btn-from-inspect").addEventListener("click", () => {
      const org = this.opts.selectedGenome();
      if (!org) {
        status("Sélectionnez d’abord un organisme avec Inspecter.");
        return;
      }
      this.load(org.genome);
      status(`ADN de l’organisme ${org.id} copié dans l’éditeur.`);
    });

    // Minimap → select a region.
    this.q("#dna-cassette").addEventListener("click", (ev) => {
      const seg = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]");
      if (!seg) return;
      this.sel = { a: Number(seg.dataset.a), b: Number(seg.dataset.b) };
      this.render();
      this.focusStrip();
    });

    // Gene cards.
    const blocks = this.q("#gene-blocks");
    blocks.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const btn = t.closest<HTMLElement>("button[data-act]");
      const genes = this.ann.decoded.genes;
      if (btn) {
        const i = Number(btn.dataset.i);
        const gene = genes[i];
        if (!gene) return;
        const act = btn.dataset.act;
        const seq = this.sequence;
        const geneSel = (idx: number, s: string): Sel | null => {
          const g = annotateSequence(s).decoded.genes[idx];
          return g ? { a: g.start, b: g.end } : null;
        };
        if (act === "plus") {
          const next = bumpGene(seq, gene, 1);
          this.commit(next, geneSel(i, next), next === seq ? undefined : `${TRAIT_LABEL[gene.dominant as TraitName]} renforcé.`);
          if (next === seq) status(`Le génome est plein (${MAX_GENOME} bases).`);
        } else if (act === "minus") this.commit(bumpGene(seq, gene, -1), geneSel(i, bumpGene(seq, gene, -1)));
        else if (act === "up") {
          const next = moveGene(seq, genes, i, -1);
          this.commit(next, geneSel(i - 1, next));
        } else if (act === "down") {
          const next = moveGene(seq, genes, i, 1);
          this.commit(next, geneSel(i + 1, next));
        } else if (act === "del") this.commit(removeGene(seq, gene), null, `Gène ${TRAIT_LABEL[gene.dominant as TraitName]} retiré.`);
        return;
      }
      const title = t.closest<HTMLElement>("[data-select]");
      if (title) {
        const g = genes[Number(title.dataset.select)];
        if (!g) return;
        this.sel = { a: g.start, b: g.end };
        this.render();
        this.focusStrip();
      }
    });
    blocks.addEventListener("input", (ev) => {
      const r = ev.target as HTMLInputElement;
      if (!r.classList.contains("strength-range")) return;
      const i = Number(r.dataset.i);
      const next = setGeneStrength(this.sequence, i, Number(r.value));
      if (!this.sliding) {
        this.sliding = true;
        this.history.push(next);
      } else this.history.amend(next);
      const g = annotateSequence(next).decoded.genes[i];
      this.sel = g ? { a: g.start, b: g.end } : null;
      this.render();
      const again = blocks.querySelector<HTMLInputElement>(`.strength-range[data-i="${i}"]`);
      again?.focus({ preventScroll: true });
    });
    blocks.addEventListener("change", () => {
      this.sliding = false;
    });

    // Add gene cassette at the end.
    this.q("#gene-add").addEventListener("click", (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-trait]");
      const trait = t?.dataset.trait as TraitName | undefined;
      if (!trait || !(TRAIT_NAMES as readonly string[]).includes(trait)) return;
      const seq = this.sequence;
      const next = appendGene(seq, trait);
      if (next === seq) {
        status(`Le génome est plein (${MAX_GENOME} bases).`);
        return;
      }
      const g = annotateSequence(next).decoded.genes.at(-1);
      this.commit(next, g ? { a: g.start, b: g.end } : null, `Gène ajouté : ${TRAIT_LABEL[trait]}.`);
    });

    // Strip: pointer selection.
    const strip = this.q("#dna-strip");
    const tileIndex = (el: Element | null): number => {
      const tile = el?.closest<HTMLElement>(".nt");
      return tile ? Number(tile.dataset.i) : -1;
    };
    strip.addEventListener("pointerdown", (ev) => {
      const i = tileIndex(ev.target as Element);
      if (i < 0) return;
      ev.preventDefault();
      strip.focus({ preventScroll: true });
      if (ev.shiftKey && this.sel) {
        this.sel = { a: Math.min(this.sel.a, i), b: Math.max(this.sel.b, i + 1) };
        this.anchor = this.sel.a;
      } else {
        this.sel = { a: i, b: i + 1 };
        this.anchor = i;
      }
      strip.setPointerCapture(ev.pointerId);
      this.render();
    });
    strip.addEventListener("pointermove", (ev) => {
      if (this.anchor < 0 || ev.buttons === 0) return;
      const i = tileIndex(document.elementFromPoint(ev.clientX, ev.clientY));
      if (i < 0) return;
      const a = Math.min(this.anchor, i);
      const b = Math.max(this.anchor, i) + 1;
      if (this.sel && this.sel.a === a && this.sel.b === b) return;
      this.sel = { a, b };
      this.render();
    });
    const endDrag = () => {
      this.anchor = -1;
    };
    strip.addEventListener("pointerup", endDrag);
    strip.addEventListener("pointercancel", endDrag);
    strip.addEventListener("dblclick", (ev) => {
      const i = tileIndex(ev.target as Element);
      const c = i >= 0 ? this.cellAt(i) : null;
      if (!c) return;
      this.sel = { a: c.start, b: c.start + c.bases.length };
      this.render();
    });

    // Strip: keyboard editing.
    strip.addEventListener("keydown", (ev) => {
      const n = this.sequence.length;
      const key = ev.key;
      const meta = ev.metaKey || ev.ctrlKey;
      const sel = this.sel;
      const move = (delta: number) => {
        if (n === 0) return;
        if (!sel) {
          this.sel = delta > 0 ? { a: 0, b: 1 } : { a: n - 1, b: n };
        } else if (ev.shiftKey) {
          const b = Math.max(sel.a + 1, Math.min(n, sel.b + delta));
          this.sel = { a: sel.a, b };
        } else {
          const a = Math.max(0, Math.min(n - 1, sel.a + delta));
          this.sel = { a, b: a + 1 };
        }
        this.render();
      };
      if (meta && key.toLowerCase() === "z") {
        ev.preventDefault();
        (ev.shiftKey ? this.q("#dna-redo") : this.q("#dna-undo")).click();
        return;
      }
      if (meta && key.toLowerCase() === "y") {
        ev.preventDefault();
        this.q("#dna-redo").click();
        return;
      }
      if (meta && key.toLowerCase() === "a") {
        ev.preventDefault();
        if (n) this.sel = { a: 0, b: n };
        this.render();
        return;
      }
      if (meta && key.toLowerCase() === "d") {
        ev.preventDefault();
        this.duplicateSelection();
        return;
      }
      if (meta && key.toLowerCase() === "c") {
        if (!sel) return;
        ev.preventDefault();
        void navigator.clipboard?.writeText(this.sequence.slice(sel.a, sel.b)).then(() => status("Sélection copiée."), () => {});
        return;
      }
      if (meta) return;
      switch (key) {
        case "ArrowRight": ev.preventDefault(); move(1); return;
        case "ArrowLeft": ev.preventDefault(); move(-1); return;
        case "ArrowDown": ev.preventDefault(); move(3); return;
        case "ArrowUp": ev.preventDefault(); move(-3); return;
        case "Home": ev.preventDefault(); if (n) { this.sel = { a: 0, b: 1 }; this.render(); } return;
        case "End": ev.preventDefault(); if (n) { this.sel = { a: n - 1, b: n }; this.render(); } return;
        case "Escape": ev.preventDefault(); this.sel = null; this.render(); return;
        case "Backspace":
        case "Delete": ev.preventDefault(); this.deleteSelection(); return;
      }
      const up = key.toUpperCase();
      if (key.length === 1 && (BASES as readonly string[]).includes(up)) {
        ev.preventDefault();
        this.setSelectionBase(up);
      }
    });

    // Selection toolbar.
    this.q("#dna-sel").addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const set = t.closest<HTMLElement>("[data-set]");
      if (set) {
        this.setSelectionBase(set.dataset.set!);
        this.focusStrip();
        return;
      }
      const op = t.closest<HTMLElement>("[data-sel]")?.dataset.sel;
      if (op === "dup") this.duplicateSelection();
      else if (op === "del") this.deleteSelection();
      else if (op === "none") {
        this.sel = null;
        this.render();
      }
      if (op) this.focusStrip();
    });

    // Codon palette.
    this.q("#dna-palette-trait").addEventListener("change", (ev) => {
      this.paletteTrait = (ev.target as HTMLSelectElement).value;
      this.renderPalette();
    });
    this.q("#dna-landscape").addEventListener("toggle", () => this.renderLandscape());
    this.q("#dna-landscape").addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-pos]");
      if (!btn) return;
      const pos = Number(btn.dataset.pos);
      const codon = btn.dataset.codon ?? "";
      if (!Number.isInteger(pos) || codon.length !== 3) return;
      const next = replaceRange(this.sequence, pos, pos + 3, codon);
      this.commit(next, { a: pos, b: pos + 3 }, `Substitution ${this.sequence.slice(pos, pos + 3)} → ${codon} à la base ${pos}.`);
    });
    this.q("#dna-palette-codons").addEventListener("click", (ev) => {
      const chip = (ev.target as HTMLElement).closest<HTMLElement>("[data-codon]");
      if (!chip) return;
      const codon = chip.dataset.codon!;
      const at = this.insertionPoint();
      const seq = this.sequence;
      const next = insertAt(seq, at, codon);
      if (next === seq) {
        status(`Le génome est plein (${MAX_GENOME} bases).`);
        return;
      }
      this.commit(next, { a: at, b: at + codon.length }, `Codon ${codon} inséré.`);
      this.focusStrip();
    });

    // Actions.
    this.q("#btn-apply").addEventListener("click", () => this.opts.onApply(this.sequence));
    this.q("#btn-dna-place").addEventListener("click", () => this.opts.onPlace());
    this.q("#btn-dna-copy").addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.sequence).then(
        () => status(`Séquence copiée (${this.sequence.length} bases).`),
        () => status("Copie impossible dans ce navigateur."),
      );
    });

    // Raw textarea (two-way) and mutations.
    const ta = this.q<HTMLTextAreaElement>("#genome-edit");
    ta.addEventListener("input", () => {
      this.fromTextarea = true;
      this.commit(ta.value, null);
      this.fromTextarea = false;
    });
    ta.addEventListener("change", () => {
      if (ta.value !== this.sequence) ta.value = this.sequence;
    });
    const mutate = (fn: (s: string) => string, msg: string) => {
      const before = this.sequence || founderHeterotroph();
      const after = fn(before);
      this.commit(after, this.selectDiff(before, after), msg);
    };
    this.q("#btn-point").addEventListener("click", () => mutate((s) => pointMutate(s, this.rng), "Mutation ponctuelle : une base remplacée."));
    this.q("#btn-indel").addEventListener("click", () => mutate((s) => indelMutate(s, this.rng), "Insertion ou délétion appliquée."));
    this.q("#btn-dup").addEventListener("click", () => mutate((s) => duplicateMutate(s, this.rng).seq, "Fragment dupliqué."));
    this.q("#btn-load-founder").addEventListener("click", () => {
      const id = this.q<HTMLSelectElement>("#founder").value;
      this.load(genomeForKit(id));
      status(`Génome de départ chargé : ${KIT_COPY[id]?.label ?? id}.`);
    });

    root.addEventListener("toggle", () => this.renderStrip(), true);
  }

  private setSelectionBase(base: string): void {
    const sel = this.sel;
    const seq = this.sequence;
    if (!sel) {
      const next = insertAt(seq, seq.length, base);
      this.commit(next, next.length ? { a: next.length - 1, b: next.length } : null);
      return;
    }
    const fill = base.repeat(sel.b - sel.a);
    this.commit(replaceRange(seq, sel.a, sel.b, fill), { a: sel.a, b: sel.b });
  }

  private deleteSelection(): void {
    const sel = this.sel;
    if (!sel) return;
    const next = deleteRange(this.sequence, sel.a, sel.b);
    const a = Math.min(sel.a, Math.max(0, next.length - 1));
    this.commit(next, next.length ? { a, b: a + 1 } : null, `${sel.b - sel.a} base${sel.b - sel.a > 1 ? "s" : ""} supprimée${sel.b - sel.a > 1 ? "s" : ""}.`);
  }

  private duplicateSelection(): void {
    const sel = this.sel;
    if (!sel) return;
    const seq = this.sequence;
    const next = duplicateRange(seq, sel.a, sel.b);
    if (next === seq) {
      this.opts.status(`Le génome est plein (${MAX_GENOME} bases).`);
      return;
    }
    const len = sel.b - sel.a;
    this.commit(next, { a: sel.b, b: Math.min(next.length, sel.b + len) }, "Sélection dupliquée.");
  }
}
