/**
 * The side-panel view of the world: the leaderboard, the research card, the
 * event feed, the death tally and log, and the inspect panel with its genome,
 * phenotype, pathway and brain readouts. paintFeeds redraws them all on the UI
 * cadence, selectOrganism fills the inspect panel, and the click handlers route
 * a feed row back to the explorer, the timeline or the DNA editor. eventText
 * turns one structured sim event into the catalog sentence the feed shows.
 */
import { genesHtml, phenotypeTableHtml } from "../../render/genomeBrowser";
import {
  bodySize,
  decodeGenome,
  dnaSnippet,
  founderHeterotroph,
  inspectBiochem,
  pathwaysHtml,
  strongestLiving,
  upkeepRates,
  tallyDeaths,
  toGenomeTrack,
  tracesHtml,
  CAUSE_COLOR,
  CAUSE_LABEL,
  EVENT_COLOR,
  type DeathCause,
  type World,
} from "../../sim/index";
import { shouldWriteEditor, type EditorSyncReason } from "../editorSync";
import { tDynamic } from "../i18n/runtime";
import { DEATH_LABEL } from "../labels";
import { researchHtml } from "../researchCard";
import type { LabContext } from "./context";

/**
 * Sentence of one world event. The sim stores structured fields only
 * (kind, tick, ids); the copy lives in the locale catalog.
 */
function eventText(w: World, e: World["events"][number]): string {
  switch (e.kind) {
    case "lineage-dominant":
      return tDynamic("sim.event.lineage-dominant", { lineage: e.lineageId ?? 0 });
    case "lineage-collapse":
      return tDynamic("sim.event.lineage-collapse", { lineage: e.lineageId ?? 0 });
    case "first-predation":
      return tDynamic("sim.event.first-predation");
    case "innovation-sweep":
      return tDynamic("sim.event.innovation-sweep", { innovation: e.innovationId ?? 0 });
    case "strain-extinct": {
      const id = e.strainId ?? 0;
      return tDynamic("sim.event.strain-extinct", { name: w.strains.get(id)?.name ?? `Strain ${id}` });
    }
    case "population-crash":
      return tDynamic("sim.event.population-crash");
    case "population-boom":
      return tDynamic("sim.event.population-boom");
  }
}

/** What the feed layer hands back to the app for the context. */
export interface Feeds {
  paintFeeds(): void;
  selectOrganism(world: World, id: number, reason?: EditorSyncReason): void;
}

export function createFeeds(ctx: LabContext): Feeds {
  const { root, state, dual, renderer } = ctx;
  /** Signature of the last feed pass; paintFeeds runs at 4 Hz and most passes repeat it. */
  let paintSignature = "";
  /** Signature of the last research card, which reads fewer inputs than the whole panel. */
  let researchSignature = "";
  let researchCache = "";

  /** Strain names are rendered by the research card, so a rename must reach the signature. */
  function strainNames(w: World): string {
    let names = "";
    for (const s of w.strains.values()) names += `${s.id}:${s.name};`;
    return names;
  }

  /** Cheap identity of everything the feed DOM is built from. */
  function feedSignature(w: World): string {
    return `${w.tick}|${w.organisms.length}|${w.deaths.length}|${w.events.length}|${w.strains.size}|${state.selectedId}|${strainNames(w)}`;
  }

  /**
   * Inputs of the research card alone: it reads the history, the lineages, the
   * strain names and the neutral log, never the death or event logs, so a
   * repaint those trigger (the bottleneck op trims the population without a
   * step) reuses the card instead of refitting every selection series.
   */
  function researchInputs(w: World): string {
    return `${w.tick}|${w.history.length}|${w.organisms.length}|${w.strains.size}|${w.lineages.size}|${w.extinctions.length}|${w.neutralLog.length}|${strainNames(w)}`;
  }

  function paintFeeds(): void {
    const w = ctx.viewWorld();
    const signature = feedSignature(w);
    // Nothing the panel draws from moved: keep the DOM exactly as it is.
    if (signature === paintSignature) return;
    paintSignature = signature;
    const board = root.querySelector("#leaderboard")!;
    const top = strongestLiving(w.organisms, 8);
    if (top.length === 0) {
      board.innerHTML = tDynamic("app.leaderboard.empty");
    } else {
      board.innerHTML = top
        .map((o, i) => {
          const ph = o.ph;
          return `<button type="button" class="feed-row" data-org="${o.id}">
            <div class="feed-head"><b>#${i + 1}</b> ${tDynamic("app.leaderboard.head", { fitness: o.fitness.toFixed(3), energy: o.energy.toFixed(2) })}</div>
            <div class="muted">${tDynamic("app.leaderboard.traits", { lineage: o.lineageId, light: ph.photo.toFixed(2), uptake: ph.uptake.toFixed(2) })}</div>
            <div class="dna">${dnaSnippet(o.genome)}</div>
            <span class="use-dna" data-use="${o.id}">${tDynamic("app.leaderboard.useDna")}</span>
          </button>`;
        })
        .join("");
    }
    const research = root.querySelector("#research-body");
    if (research) {
      const inputs = researchInputs(w);
      if (inputs !== researchSignature) {
        researchSignature = inputs;
        researchCache = researchHtml(w);
      }
      research.innerHTML = researchCache;
    }
    const eventLog = root.querySelector("#event-log")!;
    const recentEvents = w.events.slice(-40).reverse();
    root.querySelector("#event-count")!.textContent = String(w.events.length);
    if (recentEvents.length === 0) {
      eventLog.innerHTML = tDynamic("app.events.empty");
    } else {
      eventLog.innerHTML = recentEvents
        .map((e) => {
          const color = EVENT_COLOR[e.kind];
          return `<button type="button" class="feed-row event-row" data-tick="${e.tick}" data-kind="${e.kind}" data-lineage="${e.lineageId ?? ""}" data-strain="${e.strainId ?? ""}">
            <div class="feed-head" style="color:${color}">${eventText(w, e)}</div>
            <div class="muted">${tDynamic("app.events.tick", { tick: e.tick })}</div>
          </button>`;
        })
        .join("");
    }
    const tally = tallyDeaths(w.deaths);
    const tallyEl = root.querySelector("#death-tally")!;
    const causes = Object.keys(CAUSE_LABEL) as DeathCause[];
    const parts = causes
      .filter((k) => (tally[k] ?? 0) > 0)
      .map((k) => `<span style="color:${CAUSE_COLOR[k]}">${tDynamic("app.deaths.tally", { label: DEATH_LABEL[k], count: tally[k] ?? 0 })}</span>`);
    tallyEl.innerHTML = parts.length ? parts.join(" · ") : tDynamic("app.deaths.none");
    const log = root.querySelector("#death-log")!;
    const recent = w.deaths.slice(-16).reverse();
    if (recent.length === 0) {
      log.innerHTML = tDynamic("app.deaths.empty");
    } else {
      log.innerHTML = recent
        .map((d) => {
          return `<button type="button" class="feed-row" data-genome="${d.genome}">
            <div class="feed-head" style="color:${CAUSE_COLOR[d.cause]}">${DEATH_LABEL[d.cause]}</div>
            <div class="muted">${tDynamic("app.deaths.row", { tick: d.tick, org: d.orgId, lineage: d.lineageId, fitness: d.fitness.toFixed(3) })}</div>
            <div class="dna">${dnaSnippet(d.genome)}</div>
          </button>`;
        })
        .join("");
    }
  }

  function selectOrganism(world: World, id: number, reason: EditorSyncReason = "select"): void {
    const view3d = ctx.view3d();
    state.selectedId = id;
    renderer.selectedId = id;
    renderer.selectedWorld = world === dual.b ? "B" : "A";
    if (view3d) view3d.selectedId = id;
    const org = world.organisms.find((o) => o.id === id) ?? null;
    const meta = root.querySelector("#inspect-meta")!;
    const gEl = root.querySelector("#inspect-genome")!;
    const pEl = root.querySelector("#inspect-phenotype")!;
    const genesEl = root.querySelector("#inspect-genes")!;
    const pwEl = root.querySelector("#inspect-pathways")!;
    const brEl = root.querySelector("#inspect-brain")!;
    const actions = root.querySelector("#inspect-actions") as HTMLElement;
    if (!org) {
      if (reason === "select" || reason === "peek") {
        root.querySelector("#selection-tag")!.textContent = tDynamic("app.inspect.none");
        actions.hidden = true;
        meta.textContent = tDynamic("app.inspect.clickOrganism");
        gEl.textContent = "";
        pEl.innerHTML = "";
        genesEl.innerHTML = "";
        pwEl.innerHTML = "";
        state.pathwaysText = "";
        brEl.innerHTML = "";
        ctx.browser.clear();
      }
      return;
    }
    root.querySelector("#selection-tag")!.textContent = tDynamic("app.inspect.number", { id: org.id });
    actions.hidden = false;
    meta.innerHTML = `<div class="selection-metrics"><span>${tDynamic("app.inspect.energy", { value: org.energy.toFixed(2) })}</span><span>${tDynamic("app.inspect.fitness", { value: org.fitness.toFixed(3) })}</span></div><div class="selection-info">${tDynamic("app.inspect.identity", { lineage: org.lineageId, x: org.x, y: org.y, parent: org.parentId < 0 ? tDynamic("app.inspect.founder") : org.parentId })}</div><div class="selection-info">${tDynamic("app.inspect.body", { mass: (org.mass * 100).toFixed(0), size: bodySize(org).toFixed(2), genome: org.ph.size.toFixed(2), age: org.age })}</div>`;
    if (reason === "refresh") return;
    const decoded = decodeGenome(org.genome);
    const track = toGenomeTrack(decoded);
    gEl.textContent = org.genome;
    pEl.innerHTML = phenotypeTableHtml(org.ph);
    genesEl.innerHTML = genesHtml(track);
    const env = world.fields.sample(org.x, org.y);
    pwEl.innerHTML = pathwaysHtml(inspectBiochem(decoded, env, org, undefined, upkeepRates(world.params)));
    // The probe reports this text; cache it here so no frame has to read the DOM.
    state.pathwaysText = pwEl.textContent ?? "";
    brEl.innerHTML = tracesHtml(world.brain?.traces ?? [], org.id);
    if (shouldWriteEditor(reason)) ctx.dna.load(org.genome);
    ctx.browser.setSequence(org.genome);
    if (view3d) view3d.selectedId = id;
  }

  root.querySelector("#btn-edit-selected")!.addEventListener("click", () => {
    const org = ctx.current().organisms.find((o) => o.id === state.selectedId);
    if (!org) {
      ctx.status(tDynamic("app.inspect.gone"));
      return;
    }
    ctx.loadSeqIntoBuilder(org.genome);
    ctx.setTool("place");
    root.querySelector("#dna-editor")!.scrollIntoView({ block: "start", behavior: "smooth" });
    ctx.status(tDynamic("app.dna.opened", { id: org.id }));
  });
  root.querySelector("#btn-explorer")!.addEventListener("click", () => ctx.explorer.open({ tab: "organisms" }));
  root.querySelector("#btn-ancestry")!.addEventListener("click", () => {
    if (state.selectedId >= 0) ctx.explorer.open({ organismId: state.selectedId });
    else ctx.status(tDynamic("app.inspect.selectFirst"));
  });
  root.querySelector("#event-log")!.addEventListener("click", (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>(".event-row");
    if (!row) return;
    const tick = Number(row.dataset.tick);
    const lineageId = Number(row.dataset.lineage);
    const strainId = Number(row.dataset.strain);
    if (Number.isFinite(tick)) void ctx.previewTick(tick);
    if (Number.isFinite(lineageId) && lineageId > 0) ctx.explorer.open({ lineageId });
    else if (Number.isFinite(strainId) && strainId > 0) ctx.explorer.open({ filter: { strainId }, tab: "organisms" });
  });
  root.querySelector("#leaderboard")!.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const use = t.closest("[data-use]") as HTMLElement | null;
    if (use) {
      const id = Number(use.getAttribute("data-use"));
      const org = ctx.current().organisms.find((o) => o.id === id);
      if (org) {
        ctx.loadSeqIntoBuilder(org.genome);
        ctx.setTool("place");
        ctx.status(tDynamic("app.dna.loaded", { id }));
      }
      return;
    }
    const row = t.closest("[data-org]") as HTMLElement | null;
    if (!row) return;
    const id = Number(row.getAttribute("data-org"));
    selectOrganism(ctx.current(), id, "select");
    ctx.refreshMetrics();
  });
  root.querySelector("#death-log")!.addEventListener("click", (ev) => {
    const row = (ev.target as HTMLElement).closest("[data-genome]") as HTMLElement | null;
    if (!row) return;
    const seq = row.getAttribute("data-genome") ?? "";
    if (!seq) return;
    ctx.loadSeqIntoBuilder(seq);
    ctx.setTool("place");
    ctx.status(tDynamic("app.dna.loadedGeneric"));
  });
  root.querySelector("#btn-start")!.addEventListener("click", () => (root.querySelector("#btn-inject") as HTMLButtonElement).click());
  root.querySelector("#btn-inject")!.addEventListener("click", () => {
    const seq = ctx.dna.sequence || founderHeterotroph();
    ctx.tagStrain(ctx.current(), seq);
    const n = ctx.host.apply({ kind: "inject", which: ctx.sideOf(ctx.current()), genome: seq, count: 24 }).count ?? 0;
    ctx.status(tDynamic("app.inject.added", { n, world: dual.active }));
    paintFeeds();
    ctx.refreshMetrics();
  });

  return { paintFeeds, selectOrganism };
}
