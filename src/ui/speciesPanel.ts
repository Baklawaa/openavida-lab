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
import { helpFor, tDynamic } from "./i18n/runtime";
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
      <div class="section-heading"><h2>${tDynamic("render.species.groups")}</h2><span class="tag" id="species-count">${tDynamic("render.species.tag", { n: 0 })}</span></div>
      <div class="row species-mode">
        <div class="segmented" role="group" aria-label="${tDynamic("render.species.grouping")}">
          <button type="button" id="species-strains" class="active" aria-pressed="true">${tDynamic("render.species.mode.strains")}</button>
          <button type="button" id="species-strategies" aria-pressed="false">${tDynamic("render.species.mode.strategies")}</button>
        </div>
        <label class="toggle-inline" id="opt-color-strain"><input type="checkbox"> ${tDynamic("render.species.colorByStrain")}</label>
      </div>
      <p class="muted" id="species-mode-hint">${tDynamic("render.species.hint.strains")}</p>
      <div class="chart-card species-chart"><div class="chart-heading"><h3>${tDynamic("render.species.groupsChart")}</h3><span id="species-legend"></span></div><canvas id="chart-groups" role="img" aria-label="${tDynamic("render.species.groupsChart.aria")}"></canvas></div>
      <div class="chart-card species-chart" id="species-tracks">
        <div class="chart-heading"><h3>${tDynamic("render.species.tracks")}</h3><span id="species-track-legend"></span></div>
        <div class="track-caption">${tDynamic("render.species.tracks.map")}</div>
        <canvas id="chart-strain-map" role="img" aria-label="${tDynamic("render.species.tracks.map.aria")}"></canvas>
        <div class="track-caption">${tDynamic("render.species.tracks.temperature")}</div>
        <canvas id="chart-strain-temp" role="img" aria-label="${tDynamic("render.species.tracks.temperature.aria")}"></canvas>
      </div>
      <div id="species-list" class="species-list"></div>
    </section>
    <section class="block">
      <h2>${tDynamic("render.species.define")}</h2>
      <p class="muted">${tDynamic("render.species.define.hint")}</p>
      <div class="row"><input id="strain-name" type="text" placeholder="${tDynamic("render.species.name")}" maxlength="32"><button type="button" id="btn-strain-define" class="primary">${icon("plus")}${tDynamic("render.species.define.button")}</button></div>
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
        ? tDynamic("render.species.hint.strains")
        : tDynamic("render.species.hint.strategies");
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
        return s ? { label: s.name, color: s.color } : { label: tDynamic("render.species.unlabelled"), color: "#8aa0b5" };
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
    this.q("#species-count").textContent = tDynamic(n > 1 ? "render.species.count.many" : "render.species.count.one", { n });
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
      list.innerHTML = `<p class="muted">${tDynamic("render.species.empty")}</p>`;
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
      ? `<input class="group-name" value="${strain.name.replace(/"/g, "&quot;")}" data-strain="${strain.id}" aria-label="${tDynamic("render.species.name")}" maxlength="32">`
      : `<b class="group-label">${s.label}</b>`;
    const ops = strain
      ? `<span class="chip-ops"><button type="button" data-act="place" data-strain="${strain.id}" title="${tDynamic("render.species.place.title")}">${tDynamic("render.species.place")}</button><button type="button" data-act="inject" data-strain="${strain.id}" title="${tDynamic("render.species.inject.title")}">+24</button><button type="button" data-act="heat" data-strain="${strain.id}" class="${w.heatStrainId === strain.id ? "active" : ""}" title="${helpFor("btn-heat-strain")}">${tDynamic("render.species.heat")}</button></span>`
      : "";
    const state = extinct ? `<span class="tiny group-state">${tDynamic(everLived ? "render.species.state.extinct" : "render.species.state.unplaced")}</span>` : `<span class="tiny">${(s.share * 100).toFixed(0)} %</span>`;
    const path = strainTrack(w.history, s.key, Math.max(1, w.history.length - 1));
    const displace = path.length
      ? `<span class="span-2">${tDynamic("render.species.displacement", { cells: Math.hypot(path[path.length - 1]!.cx - path[0]!.cx, path[path.length - 1]!.cy - path[0]!.cy).toFixed(0) })}</span>`
      : "";
    const facts = extinct
      ? (everLived && displace ? `<div class="group-facts">${displace}</div>` : "")
      : `<div class="group-facts">
          <span>${tDynamic("render.species.fitness")} <b>${fmt(s.meanFitness, 3)}</b></span>
          <span>${tDynamic("render.species.energy")} <b>${fmt(s.meanEnergy)}</b></span>
          <span>${tDynamic("render.species.age")} <b>${s.meanAge.toFixed(0)}</b></span>
          <span>${tDynamic("render.species.centroid")} <b>(${s.centroid.x.toFixed(0)}, ${s.centroid.y.toFixed(0)})</b> ± ${s.spread.toFixed(0)}</span>
          ${displace}
        </div>
        <div class="group-env">${tDynamic("render.species.env", { temperature: fmt(s.env.temperature), nutrient: fmt(s.env.nutrient), toxin: fmt(s.env.toxin), light: fmt(s.env.light) })}</div>`;
    const traits = `<div class="trait-strip" aria-label="${tDynamic("render.species.traits.aria")}">${TRAIT_NAMES.map((t) => `<span title="${TRAIT_LABEL[t]} ${fmt(s.traits[t], 3)}"><i style="height:${pct(t, s.traits[t]).toFixed(0)}%;background:${TRAIT_COLOR[t]}"></i><small>${TRAIT_ABBR[t]}</small></span>`).join("")}</div>`;
    let drift = "";
    let innov = "";
    if (strain && !extinct) {
      const d = traitDrift(strain.founderPhenotype, s.traits).slice(0, 4);
      if (d.length) drift = `<div class="group-drift"><span class="eyebrow">${tDynamic("render.species.drift")}</span>${d.map((c) => `<div>${changeText(c)}</div>`).join("")}</div>`;
      else drift = `<div class="group-drift muted">${tDynamic("render.species.drift.none")}</div>`;
      const inns = keyInnovations(w.innovations, spread ?? new Map(), strain.id, 4).filter((i) => i.living > 0);
      if (inns.length) {
        innov = `<div class="group-innov"><span class="eyebrow">${tDynamic("render.species.innovations")}</span><ul>${inns
          .map((i) => {
            const see = i.genome && i.parentGenome
              ? `<button type="button" class="quiet btn-see-mutation" data-act="mutation" data-inn="${i.id}" title="${helpFor("btn-see-mutation")}" data-help="${helpFor("btn-see-mutation")}">${tDynamic("render.species.seeMutation")}</button>`
              : "";
            const living = tDynamic(i.living > 1 ? "render.species.descendants.many" : "render.species.descendants.one", { count: i.living });
            return `<li><b class="mono">${tDynamic("render.species.innovation.tick", { tick: i.tick })}</b> ${i.changes.map(changeText).join(" · ")}${see}<div class="tiny">${living} · ${tDynamic("render.species.innovation.env", { temperature: fmt(i.env.temperature), nutrient: fmt(i.env.nutrient), light: fmt(i.env.light) })}</div></li>`;
          })
          .join("")}</ul></div>`;
      } else innov = `<div class="group-innov muted">${tDynamic("render.species.innovations.none")}</div>`;
    }
    const deaths = s.deathTotal
      ? `<div class="group-deaths">${tDynamic("render.species.deaths")} ${(Object.keys(s.deaths) as DeathCause[])
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
        this.opts.status(tDynamic("render.species.editorEmpty"));
        return;
      }
      const w = this.opts.world();
      const name = input.value.trim() || tDynamic("render.strain.defaultName", { id: w.nextStrainId });
      const s = this.opts.defineStrain(seq, name);
      input.value = "";
      this.lastListKey = "";
      this.refresh(true);
      this.opts.status(tDynamic("render.species.defined", { name: s.name }));
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
        this.opts.status(tDynamic("render.species.renamed", { name: input.value.trim() }));
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
