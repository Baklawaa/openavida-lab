/**
 * "Espèces" tab: per-group analysis of the active world.
 *
 * Groups are either strains (founding genome, inherited by descendants) or
 * strategies (deterministic phenotype classes). Cards show live statistics,
 * drift from the founder, and the key innovations that spread.
 */
import { drawGroupSeries, drawStrainMap, drawTrackSeries, type GroupSeries, type StrainMapVent } from "../render/charts";
import {
  CAUSE_COLOR,
  STRATEGIES,
  STRATEGY_COLOR,
  TERRAIN,
  TRAIT_COLOR,
  TRAIT_NAMES,
  World,
  decodeGenome,
  groupStats,
  innovationSpread,
  keyInnovations,
  strainTrack,
  strategyOf,
  traitDrift,
  type DeathCause,

  type GroupStats,
  type Strain,
  type Strategy,
  type Innovation,
  type TraitChange,
  type TraitName,
} from "../sim/index";
import { helpFor } from "./i18n/runtime";
import type { DeathRecord } from "../sim/types";
import { DEATH_LABEL, STRATEGY_LABEL, TRAIT_ABBR, TRAIT_LABEL } from "./labels";
import { icon } from "./layout";

export type GroupMode = "strains" | "strategies";

export interface SpeciesPanelOptions {
  status(msg: string): void;
  world(): World;
  editorGenome(): string;
  /** Load a genome into the DNA editor and arm the Place tool. */
  loadGenome(seq: string, label: string): void;
  inject(seq: string, count: number): void;
  /** Mutations go through the app's SimHost so worker and mirror agree. */
  defineStrain(genome: string, name: string): Strain;
  renameStrain(id: number, name: string): boolean;
  onColorByStrain(on: boolean): void;
  onHeatStrain(strainId: number | null): void;
  openMutation(innovation: Innovation): void;
}

function pct(t: TraitName, v: number): number {
  return t === "signal" ? (v / 7) * 100 : Math.max(0, Math.min(100, v * 50));
}

function fmt(v: number, digits = 2): string {
  return v.toFixed(digits);
}

function changeText(c: TraitChange): string {
  const d = c.to - c.from;
  return `${TRAIT_LABEL[c.trait]} ${fmt(c.from)} → ${fmt(c.to)} <span class="${d > 0 ? "up" : "down"}">(${d > 0 ? "+" : "−"}${fmt(Math.abs(d))})</span>`;
}

function template(): string {
  return `
    <section class="block">
      <div class="section-heading"><h2>Groupes</h2><span class="tag" id="species-count">0 GROUPES</span></div>
      <div class="row species-mode">
        <div class="segmented" role="group" aria-label="Regroupement">
          <button type="button" id="species-strains" class="active" aria-pressed="true">Souches</button>
          <button type="button" id="species-strategies" aria-pressed="false">Stratégies</button>
        </div>
        <label class="toggle-inline" id="opt-color-strain"><input type="checkbox"> Colorer le monde par souche</label>
      </div>
      <p class="muted" id="species-mode-hint">Souche = génome fondateur. Les descendants, mutants compris, gardent l’étiquette.</p>
      <div class="chart-card species-chart"><div class="chart-heading"><h3>Effectifs par groupe</h3><span id="species-legend"></span></div><canvas id="chart-groups" role="img" aria-label="Effectifs par groupe au fil du temps"></canvas></div>
      <div class="chart-card species-chart" id="species-tracks">
        <div class="chart-heading"><h3>Trajectoires</h3><span id="species-track-legend"></span></div>
        <div class="track-caption">Carte · centre de masse</div>
        <canvas id="chart-strain-map" role="img" aria-label="Trajectoire du centre de chaque souche dans le monde"></canvas>
        <div class="track-caption">Température locale moyenne</div>
        <canvas id="chart-strain-temp" role="img" aria-label="Température locale moyenne par souche"></canvas>
      </div>
      <div id="species-list" class="species-list"></div>
    </section>
    <section class="block">
      <h2>Définir une souche</h2>
      <p class="muted">Nomme le génome courant de l’éditeur. Tout organisme placé ou injecté avec ce génome porte l’étiquette ; comparez ainsi 2 ou 3 souches dans un même milieu.</p>
      <div class="row"><input id="strain-name" type="text" placeholder="Nom de la souche" maxlength="32"><button type="button" id="btn-strain-define" class="primary">${icon("plus")}Créer depuis l’éditeur</button></div>
    </section>`;
}

export class SpeciesPanel {
  readonly root: HTMLElement;
  mode: GroupMode = "strains";
  private readonly opts: SpeciesPanelOptions;
  private readonly q: <T extends HTMLElement>(sel: string) => T;
  private readonly strategyCache = new Map<string, Strategy>();
  private lastListKey = "";

  constructor(root: HTMLElement, opts: SpeciesPanelOptions) {
    this.root = root;
    this.opts = opts;
    root.innerHTML = template();
    this.q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    this.bind();
  }

  setMode(mode: GroupMode): void {
    this.mode = mode;
    this.q("#species-strains").classList.toggle("active", mode === "strains");
    this.q("#species-strategies").classList.toggle("active", mode === "strategies");
    this.q("#species-strains").setAttribute("aria-pressed", String(mode === "strains"));
    this.q("#species-strategies").setAttribute("aria-pressed", String(mode === "strategies"));
    this.q("#species-mode-hint").textContent =
      mode === "strains"
        ? "Souche = génome fondateur. Les descendants, mutants compris, gardent l’étiquette."
        : "Stratégie = classe du phénotype actuel : prédation ≥ seuil, signal ≥ 1, puis photo / nutrition dominante.";
    this.lastListKey = "";
    this.refresh(true);
  }

  layout(): void {
    this.refresh(true);
  }

  private strategyOfDeath(d: DeathRecord, threshold: number): Strategy {
    const cached = this.strategyCache.get(d.genome);
    if (cached) return cached;
    const s = strategyOf(decodeGenome(d.genome).phenotype, threshold);
    if (this.strategyCache.size > 2000) this.strategyCache.clear();
    this.strategyCache.set(d.genome, s);
    return s;
  }

  private groups(): { stats: GroupStats[]; series: GroupSeries[] } {
    const w = this.opts.world();
    const env = (x: number, y: number) => w.fields.sample(x, y);
    if (this.mode === "strategies") {
      const th = w.params.predationThreshold;
      const stats = groupStats(
        w.organisms,
        env,
        (o) => strategyOf(o.ph, th),
        (k) => ({ label: STRATEGY_LABEL[k as Strategy], color: STRATEGY_COLOR[k as Strategy] }),
        w.deaths,
        (d) => this.strategyOfDeath(d, th),
      );
      const series = STRATEGIES.map((s) => ({ key: s, label: STRATEGY_LABEL[s], color: STRATEGY_COLOR[s] }));
      return { stats, series };
    }
    const stats = groupStats(
      w.organisms,
      env,
      (o) => String(o.strainId),
      (k) => {
        const s = w.strains.get(Number(k));
        return s ? { label: s.name, color: s.color } : { label: "Sans étiquette", color: "#8aa0b5" };
      },
      w.deaths,
      (d) => String(d.strainId ?? 0),
    );
    const present = new Set(stats.map((s) => s.key));
    for (const s of w.strains.values()) {
      if (present.has(String(s.id))) continue;
      stats.push({
        key: String(s.id), label: s.name, color: s.color, count: 0, share: 0, meanFitness: 0, meanEnergy: 0, meanAge: 0,
        traits: { ...s.founderPhenotype }, centroid: { x: 0, y: 0 }, spread: 0,
        env: { nutrient: 0, toxin: 0, temperature: 0, light: 0, exudate: 0 }, deaths: {}, deathTotal: 0,
      });
    }
    const series = stats.map((s) => ({ key: s.key, label: s.label, color: s.color }));
    return { stats, series };
  }

  refresh(force = false): void {
    if (this.root.closest("[role=tabpanel]")?.hasAttribute("hidden") && !force) return;
    const w = this.opts.world();
    const { stats, series } = this.groups();
    const n = stats.filter((s) => s.count > 0).length;
    this.q("#species-count").textContent = `${n} GROUPE${n > 1 ? "S" : ""} VIVANT${n > 1 ? "S" : ""}`;
    this.q("#species-legend").innerHTML = series.slice(0, 6).map((g) => `<i class="dot" style="background:${g.color}"></i>${g.label}`).join(" ");

    const canvas = this.q<HTMLCanvasElement>("#chart-groups");
    const card = canvas.parentElement!;
    const cw = card.clientWidth - 28;
    if (cw > 0) {
      const hist = w.history.length > 400 ? w.history.filter((_, i) => i % 4 === 0 || i > w.history.length - 80) : w.history;
      drawGroupSeries(canvas, cw, 110, hist, series, this.mode);
    }

    const tracksCard = this.q("#species-tracks");
    tracksCard.toggleAttribute("hidden", this.mode !== "strains");
    if (this.mode === "strains") {
      const tw = tracksCard.clientWidth - 28;
      if (tw > 0) this.drawTracks(w, series, tw);
    }

    // Do not rebuild the cards while a name is being edited.
    const list = this.q("#species-list");
    if (list.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    const spread = this.mode === "strains" ? innovationSpread(w.lineages, w.innovations) : null;
    const key = `${this.mode}|${w.tick}|${stats.map((s) => `${s.key}:${s.count}`).join(",")}|${w.innovations.length}|${w.heatStrainId}`;
    if (!force && key === this.lastListKey) return;
    this.lastListKey = key;
    if (stats.length === 0) {
      list.innerHTML = `<p class="muted">Aucun organisme. Placez un kit, ou définissez des souches ci-dessous et injectez-les.</p>`;
      return;
    }
    list.innerHTML = stats.map((s) => this.cardHtml(w, s, spread)).join("");
  }

  private cardHtml(w: World, s: GroupStats, spread: Map<number, number> | null): string {
    const strains = this.mode === "strains";
    const strain = strains ? w.strains.get(Number(s.key)) : undefined;
    const extinct = s.count === 0;
    const everLived = extinct && w.history.some((h) => (h.strains?.[s.key] ?? 0) > 0);
    const name = strain
      ? `<input class="group-name" value="${strain.name.replace(/"/g, "&quot;")}" data-strain="${strain.id}" aria-label="Nom de la souche" maxlength="32">`
      : `<b class="group-label">${s.label}</b>`;
    const ops = strain
      ? `<span class="chip-ops"><button type="button" data-act="place" data-strain="${strain.id}" title="Charger ce génome dans l’éditeur et activer Placer">Placer</button><button type="button" data-act="inject" data-strain="${strain.id}" title="Injecter 24 organismes de cette souche">+24</button><button type="button" data-act="heat" data-strain="${strain.id}" class="${w.heatStrainId === strain.id ? "active" : ""}" title="${helpFor("btn-heat-strain")}">Carte de présence</button></span>`
      : "";
    const state = extinct ? `<span class="tiny group-state">${everLived ? "éteinte" : "non placée"}</span>` : `<span class="tiny">${(s.share * 100).toFixed(0)} %</span>`;
    const path = strainTrack(w.history, s.key, Math.max(1, w.history.length - 1));
    const displace = path.length
      ? `<span class="span-2">Déplacement du centre depuis le fondateur : <b>${Math.hypot(path[path.length - 1]!.cx - path[0]!.cx, path[path.length - 1]!.cy - path[0]!.cy).toFixed(0)}</b> cellules</span>`
      : "";
    const facts = extinct
      ? (everLived && displace ? `<div class="group-facts">${displace}</div>` : "")
      : `<div class="group-facts">
          <span>Fitness <b>${fmt(s.meanFitness, 3)}</b></span>
          <span>Énergie <b>${fmt(s.meanEnergy)}</b></span>
          <span>Âge <b>${s.meanAge.toFixed(0)}</b></span>
          <span>Centre <b>(${s.centroid.x.toFixed(0)}, ${s.centroid.y.toFixed(0)})</b> ± ${s.spread.toFixed(0)}</span>
          ${displace}
        </div>
        <div class="group-env">Milieu local · T <b>${fmt(s.env.temperature)}</b> · Nutr <b>${fmt(s.env.nutrient)}</b> · Tox <b>${fmt(s.env.toxin)}</b> · Lum <b>${fmt(s.env.light)}</b></div>`;
    const traits = `<div class="trait-strip" aria-label="Phénotype moyen">${TRAIT_NAMES.map((t) => `<span title="${TRAIT_LABEL[t]} ${fmt(s.traits[t], 3)}"><i style="height:${pct(t, s.traits[t]).toFixed(0)}%;background:${TRAIT_COLOR[t]}"></i><small>${TRAIT_ABBR[t]}</small></span>`).join("")}</div>`;
    let drift = "";
    let innov = "";
    if (strain && !extinct) {
      const d = traitDrift(strain.founderPhenotype, s.traits).slice(0, 4);
      if (d.length) drift = `<div class="group-drift"><span class="eyebrow">DÉRIVE DEPUIS LE FONDATEUR</span>${d.map((c) => `<div>${changeText(c)}</div>`).join("")}</div>`;
      else drift = `<div class="group-drift muted">Phénotype moyen identique au fondateur.</div>`;
      const inns = keyInnovations(w.innovations, spread ?? new Map(), strain.id, 4).filter((i) => i.living > 0);
      if (inns.length) {
        innov = `<div class="group-innov"><span class="eyebrow">CHANGEMENTS CLÉS</span><ul>${inns
          .map((i) => {
            const see = i.genome && i.parentGenome
              ? `<button type="button" class="quiet btn-see-mutation" data-act="mutation" data-inn="${i.id}" title="${helpFor("btn-see-mutation")}" data-help="${helpFor("btn-see-mutation")}">Voir la mutation</button>`
              : "";
            return `<li><b class="mono">pas ${i.tick}</b> ${i.changes.map(changeText).join(" · ")}${see}<div class="tiny">${i.living} descendant${i.living > 1 ? "s" : ""} vivant${i.living > 1 ? "s" : ""} · né à T ${fmt(i.env.temperature)}, nutr ${fmt(i.env.nutrient)}, lum ${fmt(i.env.light)}</div></li>`;
          })
          .join("")}</ul></div>`;
      } else innov = `<div class="group-innov muted">Aucune mutation à effet notable n’a encore de descendants vivants.</div>`;
    }
    const deaths = s.deathTotal
      ? `<div class="group-deaths">Décès récents : ${(Object.keys(s.deaths) as DeathCause[])
          .sort((a, b) => (s.deaths[b] ?? 0) - (s.deaths[a] ?? 0))
          .slice(0, 3)
          .map((c) => `<span style="color:${CAUSE_COLOR[c]}">${DEATH_LABEL[c]} ${s.deaths[c]}</span>`)
          .join(" · ")}</div>`
      : "";
    return `<article class="group-card${extinct ? " extinct" : ""}" style="--g:${s.color}" data-key="${s.key}">
      <header class="group-head"><i class="swatch" style="background:${s.color}"></i>${name}<b class="mono group-count">${s.count}</b>${state}${ops}</header>
      ${facts}${traits}${drift}${innov}${deaths}
    </article>`;
  }

  private bind(): void {
    this.q("#species-strains").addEventListener("click", () => this.setMode("strains"));
    this.q("#species-strategies").addEventListener("click", () => this.setMode("strategies"));
    this.q<HTMLInputElement>("#opt-color-strain input").addEventListener("change", (ev) => {
      this.opts.onColorByStrain((ev.target as HTMLInputElement).checked);
    });
    this.q("#btn-strain-define").addEventListener("click", () => {
      const input = this.q<HTMLInputElement>("#strain-name");
      const seq = this.opts.editorGenome();
      if (!seq) {
        this.opts.status("L’éditeur d’ADN est vide.");
        return;
      }
      const w = this.opts.world();
      const name = input.value.trim() || `Souche ${w.nextStrainId}`;
      const s = this.opts.defineStrain(seq, name);
      input.value = "";
      this.lastListKey = "";
      this.refresh(true);
      this.opts.status(`Souche « ${s.name} » définie. Placez-la ou injectez-la depuis sa carte.`);
    });
    const list = this.q("#species-list");
    list.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("button[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "mutation") {
        const inn = this.opts.world().innovations.find((x) => x.id === Number(btn.dataset.inn));
        if (inn) this.opts.openMutation(inn);
        return;
      }
      const strain = this.opts.world().strains.get(Number(btn.dataset.strain));
      if (!strain) return;
      if (btn.dataset.act === "place") this.opts.loadGenome(strain.genome, strain.name);
      else if (btn.dataset.act === "inject") this.opts.inject(strain.genome, 24);
      else if (btn.dataset.act === "heat") {
        const on = this.opts.world().heatStrainId !== strain.id;
        this.opts.onHeatStrain(on ? strain.id : null);
        this.lastListKey = "";
        this.refresh(true);
      }
    });
    list.addEventListener("change", (ev) => {
      const input = ev.target as HTMLInputElement;
      if (!input.classList.contains("group-name")) return;
      if (this.opts.renameStrain(Number(input.dataset.strain), input.value)) {
        this.lastListKey = "";
        this.opts.status(`Souche renommée : ${input.value.trim()}.`);
      }
    });
    list.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.target as HTMLElement).classList.contains("group-name")) (ev.target as HTMLInputElement).blur();
    });
  }

  private drawTracks(w: World, series: GroupSeries[], cw: number): void {
    this.q("#species-track-legend").innerHTML = series.slice(0, 6).map((g) => `<i class="dot" style="background:${g.color}"></i>${g.label}`).join(" ");
    const every = w.history.length > 160 ? Math.ceil(w.history.length / 80) : 1;
    const tracks = series.map((s) => ({
      key: s.key,
      color: s.color,
      points: strainTrack(w.history, s.key, every),
    }));
    const vents: StrainMapVent[] = [];
    const terrain = w.terrain;
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i]!;
      if (t !== TERRAIN.nutrientVent && t !== TERRAIN.toxinVent && t !== TERRAIN.thermalVent) continue;
      vents.push({
        x: i % w.w,
        y: (i / w.w) | 0,
        kind: t === TERRAIN.nutrientVent ? "nutrient" : t === TERRAIN.toxinVent ? "toxin" : "thermal",
      });
    }
    const mapH = Math.max(72, Math.min(140, Math.round(cw * (w.h / Math.max(1, w.w)))));
    drawStrainMap(
      this.q<HTMLCanvasElement>("#chart-strain-map"),
      cw,
      mapH,
      w.w,
      w.h,
      tracks.map((t) => ({ color: t.color, points: t.points })),
      vents,
    );
    drawTrackSeries(
      this.q<HTMLCanvasElement>("#chart-strain-temp"),
      cw,
      110,
      tracks.map((t) => ({
        key: t.key,
        color: t.color,
        points: t.points.map((p) => ({ tick: p.tick, value: p.temperature })),
      })),
    );
  }
}
