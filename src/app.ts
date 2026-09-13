import { drawFitness, drawPhylogeny, drawShannon, phylogenyHitAt, type PhylogenyHit } from "./render/charts";
import { GenomeBrowser } from "./render/genomeBrowser";
import { DnaEditor } from "./ui/dnaEditor";
import { Explorer } from "./ui/explorer";
import { SpeciesPanel } from "./ui/speciesPanel";
import { GoalPanel } from "./ui/goalPanel";
import { WorkerHost } from "./ui/workerHost";
import { LabRenderer, type ViewMode } from "./render/webgl";
import { View3D } from "./render/view3d";
import {
  DualWorld,
  InlineHost,
  World,
  applyRecipe,
  canDriveClock,
  canMutateWorld,
  decodeGenome,
  DNA_KITS,
  flagsFromQuery,
  genomeForKit,
  mappingLegend,
  parseShareURL,
  recipeFromQuery,
  strongestLiving,
  type BrushKind,
  type FeatureFlags,
  type Recipe,
  type Side,
  type SimHost,
  type StepSide,
} from "./sim/index";
import { ticksDue } from "./ui/speed";
import { attachControlHelp, controlHelp } from "./ui/help";
import { applyTool, pointerAction, type LabTool } from "./ui/pointer";
import { createLabLayout, icon, KIT_COPY } from "./ui/layout";
import { applyDocumentLang, locale, switchLocale, tDynamic, type Locale } from "./ui/i18n/runtime";
import { ModelPanel } from "./ui/modelPanel";
import { DEFAULT_OVERLAY_ALPHA, describeExudate, EXUDATE_OVERLAY_ALPHA, normalizeOverlay } from "./render/overlay";
import { el, type LabContext, type LabState } from "./ui/lab/context";
import { createExports } from "./ui/lab/exports";
import { createExperimental } from "./ui/lab/experimental";
import { createFeeds } from "./ui/lab/feeds";
import { createSchedulePanel } from "./ui/lab/schedulePanel";
import { createTimelineBar } from "./ui/lab/timelineBar";
import { createWorldControls } from "./ui/lab/worldControls";

export function mount(root: HTMLElement): void {
  const q = typeof location !== "undefined" ? location.search : "";
  const sharedRecipe = recipeFromQuery(q);
  const initial = sharedRecipe ? sharedRecipe.params : parseShareURL(q);
  const flags = flagsFromQuery(q) as FeatureFlags;
  const recipeWorld = sharedRecipe ? applyRecipe(sharedRecipe) : null;
  // The host owns where the simulation runs; app code only reads `dual` and sends ops/steps through `host`.
  const host: SimHost =
    flags.worker && typeof Worker !== "undefined"
      ? new WorkerHost(initial, recipeWorld ? { snapshotA: recipeWorld.snapshot(), recordingA: recipeWorld.recording } : {})
      : new InlineHost(
          (() => {
            const d = new DualWorld(initial);
            if (recipeWorld) d.a = recipeWorld;
            return d;
          })(),
        );
  const dual = host.dual;
  const state: LabState = {
    view: "A" as ViewMode,
    paused: false,
    speed: 2,
    brush: "nutrientBlob" as BrushKind,
    radius: 3,
    painting: false,
    paintMode: false,
    tool: "place" as LabTool,
    kit: "phototroph",
    selectedId: -1,
    snapshot: null,
    lastUi: 0,
    flags,
    surface: "2d" as "2d" | "3d",
    room: null,
    roomPost: null,
    roomClose: null as (() => void) | null,
    preview: null as World | null,
    previewTick: null as number | null,
  };
  if (state.flags.view3d) state.surface = "3d";

  const { viz, stage, canvas, canvas3d, hud, cursors, side, cFit, cShan, cPhy } = createLabLayout(root);
  // The shell was rendered in the active locale; mirror it onto <html lang> and
  // let the picker switch (it stores the choice, rewrites ?lang= and reloads, so
  // every panel is rebuilt from the catalog rather than patched in place).
  applyDocumentLang();
  const langSelect = root.querySelector<HTMLSelectElement>("#lang-select");
  if (langSelect) {
    langSelect.value = locale();
    langSelect.addEventListener("change", () => switchLocale(langSelect.value as Locale));
  }
  const trailCanvas = root.querySelector<HTMLCanvasElement>("#gl-trail")!;
  const kitRow = root.querySelector("#dna-kits")!;
  const showKit = (id: string) => {
    state.kit = id;
    kitRow.querySelectorAll("button").forEach((b) => { b.classList.toggle("active", b.id === "kit-" + id); b.setAttribute("aria-pressed", String(b.id === "kit-" + id)); });
    (root.querySelector("#kit-blurb") as HTMLElement).textContent = KIT_COPY[id]!.description;
    (root.querySelector("#founder") as HTMLSelectElement).value = id;
    const p = decodeGenome(genomeForKit(id)).phenotype;
    (root.querySelector("#kit-traits") as HTMLElement).textContent =
      tDynamic("app.kit.traits", { light: p.photo.toFixed(2), uptake: p.uptake.toFixed(2), resist: p.resist.toFixed(2) });
    dna.load(genomeForKit(id));
  };
  for (const kit of DNA_KITS) {
    const btn = el("button", { type: "button", id: "kit-" + kit.id, class: "kit-btn" }, `${icon(KIT_COPY[kit.id]!.icon)}<span><strong>${KIT_COPY[kit.id]!.label}</strong><small>${KIT_COPY[kit.id]!.short}</small></span><span class="kit-check">✓</span>`);
    kitRow.append(btn);
  }
  kitRow.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>(".kit-btn");
    if (!t) return;
    const id = t.id.startsWith("kit-") ? t.id.slice(4) : "";
    if (id) {
      selectKit(id);
    }
  });
  const legend = root.querySelector("#legend")!;
  legend.innerHTML = mappingLegend()
    .map((r) => `<div>${r.codon} ${r.aa} → ${r.trait} ${r.delta >= 0 ? "+" : ""}${r.delta}</div>`)
    .join("");

  const renderer = new LabRenderer(canvas);
  let view3d: View3D | null = null;
  function ensure3d(): View3D {
    if (view3d) return view3d;
    view3d = new View3D(canvas3d);
    view3d.fieldMode = renderer.fieldMode;
    view3d.colorByStrain = renderer.colorByStrain;
    view3d.selectedId = state.selectedId;
    const r = viz.getBoundingClientRect();
    view3d.resize(r.width, r.height);
    return view3d;
  }

  const gbCanvas = root.querySelector("#gbrowser") as HTMLCanvasElement;
  const browser = new GenomeBrowser(gbCanvas);
  (root.querySelector("#seed") as HTMLInputElement).value = String(dual.a.params.seed);

  const current = (): World => ((state.view === "split" ? dual.active : state.view) === "B" ? dual.b : dual.a);
  const viewWorld = (): World => state.preview ?? current();
  const sideOf = (w: World): Side => (w === dual.b ? "B" : "A");
  const stepWhich = (): StepSide => (state.view === "split" ? "both" : state.view === "B" ? "B" : "A");

  function status(msg: string): void {
    (root.querySelector("#status-line") as HTMLElement).textContent = msg;
  }

  // The context every lab module works through. Fields are filled in as the
  // services they name are created, so a constructor callback can close over the
  // context before its neighbours exist; the factories just below also bind the
  // callbacks one module has to reach in another.
  const ctx = {} as LabContext;
  ctx.root = root;
  ctx.state = state;
  ctx.dual = dual;
  ctx.host = host;
  ctx.canvas = canvas;
  ctx.canvas3d = canvas3d;
  ctx.viz = viz;
  ctx.stage = stage;
  ctx.hud = hud;
  ctx.cursors = cursors;
  ctx.side = side;
  ctx.current = current;
  ctx.viewWorld = viewWorld;
  ctx.sideOf = sideOf;
  ctx.stepWhich = stepWhich;
  ctx.status = status;
  ctx.renderer = renderer;
  ctx.view3d = () => view3d;
  ctx.ensure3d = ensure3d;
  ctx.layout = layout;
  ctx.refreshMetrics = refreshMetrics;
  ctx.drawCharts = drawCharts;
  ctx.browser = browser;
  ctx.setTool = setTool;
  ctx.tagStrain = tagStrain;
  ctx.loadSeqIntoBuilder = loadSeqIntoBuilder;

  const worldControls = createWorldControls(ctx);
  ctx.openPanel = worldControls.openPanel;
  ctx.openTab = worldControls.openTab;
  ctx.setView = worldControls.setView;
  ctx.setField = worldControls.setField;
  ctx.setSurface = worldControls.setSurface;
  ctx.setSpeed = worldControls.setSpeed;
  ctx.updatePlayback = worldControls.updatePlayback;
  ctx.setChartsCollapsed = worldControls.setChartsCollapsed;
  const feeds = createFeeds(ctx);
  ctx.paintFeeds = feeds.paintFeeds;
  ctx.selectOrganism = feeds.selectOrganism;
  const timelineBar = createTimelineBar(ctx);
  ctx.refreshTimeline = timelineBar.refresh;
  ctx.previewTick = timelineBar.preview;
  const schedulePanel = createSchedulePanel(ctx);
  ctx.refreshScheduleList = schedulePanel.refresh;
  createExports(ctx);
  const experimental = createExperimental(ctx);
  ctx.emitOp = experimental.emitOp;
  ctx.emitCursor = experimental.emitCursor;
  ctx.paintPeers = experimental.paintPeers;
  ctx.setBrains = experimental.setBrains;
  ctx.joinRoom = experimental.joinRoom;

  const dna = new DnaEditor(root.querySelector<HTMLElement>("#dna-editor")!, {
    status,
    selectedGenome: () => {
      const org = current().organisms.find((o) => o.id === state.selectedId);
      return org ? { id: org.id, genome: org.genome } : null;
    },
    onApply: (seq) => {
      if (state.selectedId < 0) {
        status(tDynamic("app.dna.selectFirst"));
        return;
      }
      host.apply({ kind: "replaceGenome", which: sideOf(current()), orgId: state.selectedId, genome: seq });
      ctx.selectOrganism(current(), state.selectedId, "apply");
      status(tDynamic("app.dna.applied"));
    },
    onPlace: () => {
      setTool("place");
      status(tDynamic("app.dna.placeHint"));
    },
    env: () => {
      const w = current();
      const org = w.organisms.find((o) => o.id === state.selectedId);
      if (org) return w.fields.sample(org.x, org.y);
      return w.fields.sample(Math.floor(w.w / 2), Math.floor(w.h / 2));
    },
    envLabel: () => {
      const w = current();
      const org = w.organisms.find((o) => o.id === state.selectedId);
      return org
        ? tDynamic("app.dna.envCell", { x: org.x, y: org.y })
        : tDynamic("app.dna.envCenter", { x: Math.floor(w.w / 2), y: Math.floor(w.h / 2) });
    },
  });
  ctx.dna = dna;
  const editorGenome = (): string => dna.sequence || genomeForKit(state.kit);
  let explorerRef: Explorer | null = null;
  const goals = new GoalPanel(root.querySelector<HTMLElement>("#panel-goals")!, {
    status,
    world: () => current(),
    activeWorld: () => dual.active,
    reportExtras: () => ({ treePng: explorerRef?.treePng() ?? null }),
    restoreInto: (target, snap) => {
      if (target === "B") {
        host.apply({ kind: "restore", which: "B", snapshot: snap });
        ctx.setView("B");
      } else {
        host.apply({ kind: "restore", which: sideOf(current()), snapshot: snap });
        ctx.selectOrganism(current(), -1);
      }
      ctx.paintFeeds();
      refreshMetrics();
    },
    replayInto: (snap) => {
      host.apply({ kind: "replaceWorld", which: "B", snapshot: snap, recording: null });
      ctx.setView("B");
      // A replay is meant to be watched: start playing at once (observation speed if the clock was stopped).
      if (state.speed <= 0) ctx.setSpeed(2);
      state.paused = false;
      ctx.updatePlayback();
      ctx.paintFeeds();
      refreshMetrics();
    },
    // A catalog is read, not run: load the state into B, keep it stopped, and open the explorer on it.
    openCatalog: (snap) => {
      host.apply({ kind: "replaceWorld", which: "B", snapshot: snap, recording: null });
      state.paused = true;
      ctx.updatePlayback();
      ctx.setView("B");
      ctx.paintFeeds();
      refreshMetrics();
      explorer.open({ tab: "organisms" });
    },
    setRecording: (on) => host.apply({ kind: "recording", which: sideOf(current()), on }),
    applyRecipe: (recipe: Recipe, target) => {
      const next = applyRecipe(recipe);
      const which: Side = target === "B" ? "B" : sideOf(current());
      host.apply({ kind: "replaceWorld", which, snapshot: next.snapshot(), recording: next.recording });
      if (target === "B") ctx.setView("B");
      else ctx.selectOrganism(current(), -1);
      ctx.paintFeeds();
      refreshMetrics();
    },
  });
  ctx.goals = goals;
  if (sharedRecipe) {
    status(tDynamic(sharedRecipe.ops.length > 1 ? "app.recipe.loaded.many" : "app.recipe.loaded.one", { count: sharedRecipe.ops.length }));
  }
  /** Name the strain after its kit when the genome is an unmodified kit genome. */
  function tagStrain(world: World, seq: string): void {
    const kit = DNA_KITS.find((k) => genomeForKit(k.id) === seq);
    host.apply({ kind: "defineStrain", which: sideOf(world), genome: seq, name: kit ? KIT_COPY[kit.id]!.label : undefined });
  }
  const species = new SpeciesPanel(root.querySelector<HTMLElement>("#panel-species")!, {
    status,
    world: () => viewWorld(),
    editorGenome: () => dna.sequence,
    loadGenome: (seq, label) => {
      dna.load(seq);
      setTool("place");
      status(tDynamic("app.strain.genomeLoaded", { label }));
    },
    inject: (seq, n) => {
      tagStrain(current(), seq);
      const placed = host.apply({ kind: "inject", which: sideOf(current()), genome: seq, count: n }).count ?? 0;
      status(tDynamic("app.inject.count", { n: placed, world: dual.active }));
      ctx.paintFeeds();
      refreshMetrics();
    },
    defineStrain: (genome, name) => host.apply({ kind: "defineStrain", which: sideOf(current()), genome, name, manual: true }).strain!,
    renameStrain: (id, name) => host.apply({ kind: "renameStrain", which: sideOf(current()), id, name }).ok ?? false,
    onColorByStrain: (on) => {
      renderer.colorByStrain = on;
      if (view3d) view3d.colorByStrain = on;
      status(on ? tDynamic("app.strain.colorStrain") : tDynamic("app.strain.colorGuild"));
    },
    onHeatStrain: (id) => {
      host.apply({ kind: "heatStrain", which: sideOf(current()), strainId: id });
      status(id === null ? tDynamic("app.strain.heatOff") : tDynamic("app.strain.heatOn", { id }));
    },
    openMutation: (inn) => {
      if (!inn.genome) {
        status(tDynamic("app.mutation.missing"));
        return;
      }
      dna.load(inn.genome, { diffAgainst: inn.parentGenome ?? "" });
      ctx.openTab("organisms");
      root.querySelector("#dna-editor")?.scrollIntoView({ block: "nearest" });
      (root.querySelector("#dna-strip-section") as HTMLDetailsElement | null)?.setAttribute("open", "");
      status(tDynamic("app.mutation.loaded", { tick: inn.tick, kind: inn.kind }));
    },
  });

  ctx.species = species;
  const explorer = new Explorer(root.querySelector<HTMLDialogElement>("#explorer-dialog")!, {
    status,
    world: () => viewWorld(),
    worldSide: () => sideOf(current()),
    store: goals.store,
    selectOrganism: (id) => {
      setTool("inspect");
      ctx.selectOrganism(viewWorld(), id, "select");
      refreshMetrics();
    },
    highlightLineage: (id) => {
      renderer.highlightLineage = id;
      drawCharts();
    },
    loadGenome: (seq, label, opts) => {
      dna.load(seq, opts?.diffAgainst !== undefined ? { diffAgainst: opts.diffAgainst } : {});
      setTool("place");
      status(opts?.diffAgainst !== undefined
        ? tDynamic("app.explorer.genomeCompared", { label })
        : tDynamic("app.explorer.genomeLoaded", { label }));
    },
    plateSelection: () => {
      const org = viewWorld().organisms.find((o) => o.id === state.selectedId);
      return org ? { id: org.id, genome: org.genome } : null;
    },
    restoreInto: (_target, snap) => {
      host.apply({ kind: "replaceWorld", which: "B", snapshot: snap, recording: null });
      state.paused = true;
      ctx.updatePlayback();
      ctx.setView("B");
      ctx.paintFeeds();
      refreshMetrics();
    },
  });
  explorerRef = explorer;
  ctx.explorer = explorer;

  function loadSeqIntoBuilder(seq: string): void {
    dna.load(seq);
    (root.querySelector("#dna-builder") as HTMLDetailsElement).open = true;
  }

  function setTool(tool: LabTool): void {
    const next = applyTool(tool);
    state.tool = next.tool;
    state.paintMode = next.paintMode;
    hud.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.id === "tool-" + tool);
      b.setAttribute("aria-pressed", String(b.id === "tool-" + tool));
    });
    const hint = tool === "place" ? tDynamic("app.hint.place") : tool === "paint" ? tDynamic("app.hint.paint") : tDynamic("app.hint.inspect");
    root.querySelector("#place-hint")!.textContent = hint;
    root.querySelector("#view-hint")!.textContent = state.surface === "3d" ? tDynamic("app.view.hint3d") : hint;
    canvas.style.cursor = tool === "inspect" ? "crosshair" : "cell";
    ctx.openPanel(tool === "paint" ? "environment" : tool === "inspect" ? "analysis" : "organisms");
  }

  function selectKit(id: string): void {
    setTool("place");
    showKit(id);
  }

  /** Rows drawn by the last phylogeny pass, in CSS pixels: what a click or hover on #chart-phy resolves against. */
  let phyHits: PhylogenyHit[] = [];
  function drawCharts(): void {
    if (root.classList.contains("charts-collapsed") && !root.classList.contains("wide-workspace")) return;
    const w = viewWorld();
    const hist = w.history.length > 400 ? w.history.filter((_, i) => i % 4 === 0 || i > w.history.length - 80) : w.history;
    const size = (c: HTMLCanvasElement) => [c.parentElement!.clientWidth - 28, Math.max(75, c.parentElement!.clientHeight - 42)] as const;
    drawFitness(cFit, ...size(cFit), hist, w.schedule.map((s) => s.at));
    drawShannon(cShan, ...size(cShan), hist);
    phyHits = drawPhylogeny(cPhy, ...size(cPhy), w.lineages.values(), w.tick, renderer.highlightLineage);
  }
  cPhy.addEventListener("click", (ev) => {
    const hit = phylogenyHitAt(phyHits, ev.offsetX, ev.offsetY);
    if (hit) explorer.open({ lineageId: hit.id });
  });
  cPhy.addEventListener("mousemove", (ev) => {
    const hit = phylogenyHitAt(phyHits, ev.offsetX, ev.offsetY);
    const node = hit ? current().lineages.get(hit.id) : undefined;
    cPhy.title = node ? tDynamic("app.chart.lineageTitle", { id: node.id, born: node.bornTick, count: node.count, peak: node.peakCount }) : "";
    cPhy.style.cursor = hit ? "pointer" : "default";
  });
  cPhy.addEventListener("mouseleave", () => {
    cPhy.title = "";
  });

  const workspace = root.querySelector<HTMLElement>(".workspace")!;
  function layout(): void {
    const ws = workspace.getBoundingClientRect();
    const wide = window.innerWidth > 900 && !root.classList.contains("focus-mode") && ws.width / Math.max(1, ws.height) > 1.9;
    if (root.classList.contains("wide-workspace") !== wide) {
      root.classList.toggle("wide-workspace", wide);
      requestAnimationFrame(layout);
      return;
    }
    const r = stage.getBoundingClientRect();
    let height = Math.max(1, r.height);
    let width = Math.max(1, r.width);
    if (state.surface !== "3d") {
      // Letterbox: the plate keeps its cell aspect (square, or two squares side by side).
      const w = current();
      const aspect = (w.w / w.h) * (state.view === "split" ? 2 : 1);
      if (width / height > aspect) width = Math.max(1, Math.floor(height * aspect));
      else height = Math.max(1, Math.floor(width / aspect));
    }
    viz.style.width = `${width}px`;
    viz.style.height = `${height}px`;
    renderer.resize(width, height);
    if (view3d) view3d.resize(width, height);
    const br = gbCanvas.parentElement!.getBoundingClientRect();
    if (br.width > 0) browser.resize(br.width, 108);
    drawCharts();
    if (!(root.querySelector("#panel-species") as HTMLElement).hidden) species.layout();
    if (!(root.querySelector("#panel-experiment") as HTMLElement).hidden) goals.layout();
  }

  function refreshMetrics(): void {
    const live = current();
    const w = viewWorld();
    const last = w.history[w.history.length - 1];
    const set = (id: string, v: string) => {
      const n = document.getElementById(id);
      if (n && n.textContent !== v) n.textContent = v;
    };
    const activeWorld = live === dual.b ? "B" : "A";
    set("chart-world", tDynamic("app.charts.world", { world: activeWorld }));
    set("world-size", `${w.w} × ${w.h}`);
    set("stage-label", state.view === "split" ? tDynamic("app.stage.side", { side: "A", count: dual.a.organisms.length, selected: activeWorld === "A" ? tDynamic("app.stage.selected") : "" }) : tDynamic("app.stage.world", { world: activeWorld }));
    set("stage-label-b", tDynamic("app.stage.side", { side: "B", count: dual.b.organisms.length, selected: activeWorld === "B" ? tDynamic("app.stage.selected") : "" }));
    (root.querySelector("#stage-label-b") as HTMLElement).hidden = state.view !== "split";
    (root.querySelector("#empty-world") as HTMLElement).hidden = state.tool !== "place" || state.view === "split" || w.organisms.length > 0;
    set("m-tick", String(w.tick));
    set("m-pop", String(w.organisms.length));
    set("m-lin", String(last?.lineageCount ?? 0));
    set("m-h", (last?.shannon ?? 0).toFixed(3));
    set("m-fit", (last?.meanFitness ?? 0).toFixed(3));
    const fix = last && last.fixationFraction >= 0.9 ? `${(last.fixationFraction * 100).toFixed(0)}%` : "—";
    set("m-fix", fix);
    set("m-ex", String(w.extinctions.length));
    set("m-ms", `${w.lastStepMs.toFixed(2)}ms`);
    const seedEl = document.getElementById("m-seed");
    if (seedEl) {
      seedEl.textContent = `seed 0x${w.params.seed.toString(16)} · ${w.w}×${w.h} · ${state.view}`;
    }
    if (state.selectedId >= 0) {
      const org = w.organisms.find((o) => o.id === state.selectedId);
      if (!org) {
        ctx.selectOrganism(w, -1);
        root.querySelector("#inspect-meta")!.textContent = tDynamic("app.inspect.dead");
      }
    }
    ctx.refreshTimeline();
    ctx.refreshScheduleList();
    const now = performance.now();
    if (now - state.lastUi > 250) {
      drawCharts();
      ctx.paintFeeds();
      if (state.selectedId >= 0) ctx.selectOrganism(w, state.selectedId, "refresh");
      species.refresh();
      goals.refresh();
      ctx.updatePlayback();
      const note = document.getElementById("field-note");
      if (note) {
        const stats = renderer.fieldMode === 5 ? describeExudate(w) : null;
        const parts = !stats
          ? []
          : stats.max <= 0
            ? [tDynamic("render.exudate.empty")]
            : [
                tDynamic(stats.producers > 1 ? "render.exudate.producers.many" : "render.exudate.producers.one", { producers: stats.producers }),
                tDynamic(stats.visible > 1 ? "render.exudate.cells.many" : "render.exudate.cells.one", { visible: stats.visible }),
                tDynamic("render.exudate.totals", { max: stats.max.toFixed(3), total: stats.total.toFixed(2) }),
              ];
        note.textContent = parts.join(" · ");
      }
      state.lastUi = now;
    }
    const gl = state.surface === "3d" && view3d ? view3d.gl : renderer.gl;
    const lastDeath = w.deaths[w.deaths.length - 1];
    const top = strongestLiving(w.organisms, 1)[0];
    const pw = (document.getElementById("inspect-pathways") as HTMLElement | null)?.textContent ?? "";
    window.__openavida = {
      tick: w.tick,
      population: w.organisms.length,
      selectedGenome: (document.getElementById("inspect-genome") as HTMLElement).textContent ?? "",
      selectedPhenotype: (document.getElementById("inspect-phenotype") as HTMLElement).textContent ?? "",
      editorValue: (document.getElementById("genome-edit") as HTMLTextAreaElement | null)?.value ?? "",
      canvasWidth: state.surface === "3d" ? canvas3d.width : canvas.width,
      canvasHeight: state.surface === "3d" ? canvas3d.height : canvas.height,
      drawingBufferWidth: gl.drawingBufferWidth,
      drawingBufferHeight: gl.drawingBufferHeight,
      lastStepMs: w.lastStepMs,
      seed: w.params.seed,
      world: activeWorld,
      deathCount: w.deaths.length,
      lastDeathCause: lastDeath?.cause ?? "",
      topFit: top?.fitness ?? 0,
      builderGenes: dna.geneCount,
      surface: state.surface,
      view3d: state.flags.view3d,
      brains: state.flags.brains,
      llmBrains: state.flags.llmBrains,
      multiplayer: state.flags.multiplayer,
      pathways: pw,
      brainTraces: w.brain?.traces.length ?? 0,
      roomPeers: state.room?.metrics.peers ?? 0,
      host: host.kind,
      explorerOpen: explorer.isOpen,
      neutralSubstitutions: w.neutralLog.length,
      researchEvents: w.eventLog.length,
      historyRows: w.history.length,
    };
  }

  /** Parameters of one world (or the active one), for the model-panel gate. */
  window.__openavidaParams = (side?: "A" | "B") => ({
    ...(side === "A" ? dual.a : side === "B" ? dual.b : current()).params,
  });

  window.__openavidaSelectAt = (clientX: number, clientY: number) => {
    const sidePick = renderer.pickWorld(clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(clientX, clientY, world);
    if (!grid) return false;
    const org = world.nearestOrganism(grid.x, grid.y, 6);
    if (!org) return false;
    dual.active = sidePick;
    ctx.selectOrganism(world, org.id);
    refreshMetrics();
    return true;
  };

  function paintAt(ev: PointerEvent): void {
    if (state.room && !canMutateWorld(state.room.self.role)) return;
    const sidePick = renderer.pickWorld(ev.clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(ev.clientX, ev.clientY, world);
    if (grid) {
      host.apply({ kind: "paint", which: sidePick, x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
      ctx.emitOp({ kind: "paint", x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
    }
  }

  function onPointer(ev: PointerEvent, down: boolean): void {
    const sidePick = renderer.pickWorld(ev.clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(ev.clientX, ev.clientY, world);
    if (!grid) return;
    if (dual.active !== sidePick) {
      dual.active = sidePick;
      ctx.selectOrganism(world, -1);
    }
    ctx.emitCursor(grid.x, grid.y);
    const action = pointerAction({
      tool: state.tool,
      paintMode: state.paintMode,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      buttons: ev.buttons,
    });
    if (action === "paint") {
      if (state.room && !canMutateWorld(state.room.self.role)) {
        status("spectator — inspect only");
        return;
      }
      state.painting = true;
      host.apply({ kind: "paint", which: sidePick, x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
      ctx.emitOp({ kind: "paint", x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
      return;
    }
    if (!down) return;
    if (action === "place") {
      if (state.room && !canMutateWorld(state.room.self.role)) {
        status("spectator — inspect only");
        return;
      }
      const seq = editorGenome();
      tagStrain(world, seq);
      const child = host.apply({ kind: "place", which: sidePick, x: grid.x, y: grid.y, genome: seq }).child ?? null;
      if (child) {
        dual.active = sidePick;
        ctx.selectOrganism(world, child.id, "peek");
        status(tDynamic("app.place.done", { x: grid.x, y: grid.y }));
        ctx.emitOp({ kind: "place", x: grid.x, y: grid.y, genome: seq });
        ctx.paintFeeds();
        refreshMetrics();
      } else {
        const occ = world.organismAt(grid.x, grid.y);
        if (occ) {
          dual.active = sidePick;
          ctx.selectOrganism(world, occ.id, "peek");
          refreshMetrics();
        } else status(tDynamic("app.place.blocked"));
      }
      return;
    }
    const org = world.nearestOrganism(grid.x, grid.y, 4);
    if (org) {
      dual.active = sidePick;
      ctx.selectOrganism(world, org.id);
      refreshMetrics();
    }
  }

  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    onPointer(ev, true);
  });
  canvas.addEventListener("pointermove", (ev) => {
    const sidePick = renderer.pickWorld(ev.clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(ev.clientX, ev.clientY, world);
    if (grid) {
      ctx.emitCursor(grid.x, grid.y);
      const f = world.fields.sample(grid.x, grid.y);
      const readout = root.querySelector<HTMLElement>("#cell-readout")!;
      readout.hidden = false;
      readout.textContent = tDynamic("app.readout.cell", { x: grid.x, y: grid.y, nutrient: f.nutrient.toFixed(2), toxin: f.toxin.toFixed(2), temperature: f.temperature.toFixed(2), light: f.light.toFixed(2), exudate: f.exudate.toFixed(2) });
    }
    if (ev.buttons === 0) return;
    const action = pointerAction({
      tool: state.tool,
      paintMode: state.paintMode,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      buttons: ev.buttons,
    });
    if (action === "paint") paintAt(ev);
  });
  canvas.addEventListener("pointerup", () => {
    state.painting = false;
  });
  canvas.addEventListener("pointerleave", () => { root.querySelector<HTMLElement>("#cell-readout")!.hidden = true; });
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  canvas3d.addEventListener("pointerdown", (ev) => {
    canvas3d.setPointerCapture(ev.pointerId);
    ensure3d().pointerDown(ev);
  });
  canvas3d.addEventListener("pointermove", (ev) => {
    if (!view3d) return;
    view3d.pointerMove(ev);
    const g = view3d.pick(ev.clientX, ev.clientY, current());
    if (g) ctx.emitCursor(g.x, g.y);
  });
  canvas3d.addEventListener("pointerup", (ev) => {
    if (!view3d) return;
    const clicked = view3d.pointerUp();
    if (!clicked) return;
    const world = current();
    const grid = view3d.pick(ev.clientX, ev.clientY, world);
    if (!grid) return;
    const org = world.nearestOrganism(grid.x, grid.y, 2);
    if (state.tool === "place" && !org) {
      const seq = editorGenome();
      if (state.room && !canMutateWorld(state.room.self.role)) return;
      tagStrain(world, seq);
      const child = host.apply({ kind: "place", which: sideOf(world), x: grid.x, y: grid.y, genome: seq }).child ?? null;
      if (child) {
        ctx.selectOrganism(world, child.id, "peek");
        ctx.emitOp({ kind: "place", x: grid.x, y: grid.y, genome: seq });
        refreshMetrics();
      }
    } else if (state.tool === "paint") {
      if (state.room && !canMutateWorld(state.room.self.role)) return;
      host.apply({ kind: "paint", which: sideOf(world), x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
      ctx.emitOp({ kind: "paint", x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
    } else if (org) {
      ctx.selectOrganism(world, org.id, state.tool === "inspect" ? "select" : "peek");
      refreshMetrics();
    }
  });
  canvas3d.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    ensure3d().zoomBy(ev.deltaY);
  }, { passive: false });
  canvas3d.addEventListener("contextmenu", (ev) => ev.preventDefault());

  // Model parameters: the form is generated from PARAM_SPEC (see modelPanel.ts).
  let model: ModelPanel | null = null;
  model = new ModelPanel(root.querySelector<HTMLElement>("#model-form")!, {
    status,
    params: () => current().params,
    apply: (patch, target) => {
      const sides: Side[] = target === "both" ? ["A", "B"] : [target];
      for (const side of sides) host.apply({ kind: "setParams", which: side, params: patch });
      ctx.paintFeeds();
      refreshMetrics();
    },
  });

  ctx.model = model;

  window.__openavidaMutate = async (n = 40) => {
    const which = sideOf(current());
    const prev = current().params.mutationRate;
    const steps = Math.max(1, Math.min(400, n | 0));
    host.apply({ kind: "setParams", which, params: { mutationRate: 1 } });
    host.step(which, steps);
    host.apply({ kind: "setParams", which, params: { mutationRate: prev } });
    await host.flush();
    ctx.paintFeeds();
    refreshMetrics();
    species.refresh(true);
    return current().innovations.length;
  };
  window.__openavidaStep = async (n = 1) => {
    host.step(stepWhich(), Math.max(1, n | 0));
    await host.flush();
    refreshMetrics();
  };
  window.__openavidaHash = () => host.hash(sideOf(current()));

  window.__openavidaPlaceAt = (x: number, y: number) => {
    const w = current();
    tagStrain(w, editorGenome());
    const child = host.apply({ kind: "place", which: sideOf(w), x, y, genome: editorGenome() }).child ?? null;
    if (!child) return false;
    ctx.selectOrganism(w, child.id, "peek");
    refreshMetrics();
    return true;
  };

  window.__openavidaOrgPixel = (index = 0) => {
    const w = current();
    const o =
      w.organisms[index] ??
      w.organisms.find((org) => org.x > w.w * 0.25 && org.y > w.h * 0.25) ??
      w.organisms[0];
    if (!o) return null;
    const p = renderer.gridToCanvas(o.x, o.y, w);
    return { x: p.x, y: p.y, id: o.id };
  };

  function drawTrail(w: World): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = viz.clientWidth;
    const cssH = viz.clientHeight;
    trailCanvas.width = Math.max(1, Math.round(cssW * dpr));
    trailCanvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = trailCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const org = w.organisms.find((o) => o.id === state.selectedId);
    const trail = org?.trail;
    if (!trail || trail.length < 2) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const p0 = renderer.gridToCanvas(trail[i - 1]![0], trail[i - 1]![1], w);
      const p1 = renderer.gridToCanvas(trail[i]![0], trail[i]![1], w);
      const a = 0.1 + 0.75 * (i / (trail.length - 1));
      ctx.strokeStyle = `rgba(226,236,232,${a.toFixed(3)})`;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  const exudateLayer = { data: new Float32Array(0) };
  /** Normalised exudate field for the layer overlay, in a reused buffer. */
  function exudateOverlay(w: World): Float32Array {
    const n = w.w * w.h;
    if (exudateLayer.data.length !== n) exudateLayer.data = new Float32Array(n);
    normalizeOverlay(w.fields.exudate, exudateLayer.data);
    return exudateLayer.data;
  }

  let lastFrame = performance.now();
  let tickAccum = 0;
  let lastLoopError = 0;
  /** Keep the rAF loop alive when a frame throws; report at most once per second. */
  const reportLoopError = (err: unknown): void => {
    const t = performance.now();
    if (t - lastLoopError < 1000) return;
    lastLoopError = t;
    status(tDynamic("app.error.runtime", { message: err instanceof Error ? err.message : String(err) }));
    console.error(err);
  };
  const frameBody = (now: number): void => {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (!state.paused && state.speed > 0 && canDriveClock(state.room)) {
      const due = ticksDue(tickAccum, dt, state.speed, 3);
      tickAccum = due.accumMs;
      // Backpressure: never queue more than two step batches ahead of the frames we have drawn.
      if (due.ticks > 0 && host.pendingSteps() < 2) host.step(stepWhich(), due.ticks, 10);
    } else {
      tickAccum = 0;
    }
    if (state.surface === "3d") {
      ensure3d().draw(viewWorld());
    } else {
      const side = sideOf(current());
      const shown = viewWorld();
      const a = state.preview && side === "A" ? state.preview : dual.a;
      const b = state.preview && side === "B" ? state.preview : dual.b;
      renderer.heatSize = [shown.w, shown.h];
      if (renderer.fieldMode === 5) {
        // Exudate layer: the fifth field normalised to its own maximum, drawn
        // through the same R8 overlay path as the strain heat map, at the
        // overlay alpha and gamma that make a thin field readable.
        renderer.heatStrain = exudateOverlay(shown);
        renderer.heatColor = [0.72, 0.45, 1];
        renderer.heatAlpha = EXUDATE_OVERLAY_ALPHA;
      } else {
        renderer.heatAlpha = DEFAULT_OVERLAY_ALPHA;
        const heatId = shown.heatStrainId;
        renderer.heatStrain = heatId === null ? null : shown.heat.normalized(heatId);
        const strain = heatId !== null ? shown.strains.get(heatId) : undefined;
        if (strain) {
          const n = parseInt(strain.color.slice(1), 16);
          renderer.heatColor = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        }
      }
      renderer.draw(a, b, now / 1000);
      drawTrail(shown);
    }
    if (state.room?.isHost && !state.paused && state.speed > 0 && current().tick % 10 === 0) {
      state.roomPost?.({ kind: "snapshot", snap: current().snapshot() });
    }
    refreshMetrics();
  };
  const loop = (now: number): void => {
    try {
      frameBody(now);
    } catch (err) {
      reportLoopError(err);
    }
    requestAnimationFrame(loop);
  };

  const tip = el("div", { id: "hover-tip" });
  tip.hidden = true;
  document.body.append(tip);
  attachControlHelp(root, tip);
  window.__openavidaHelp = controlHelp();

  let chartsPref = "1";
  try { chartsPref = localStorage.getItem("openavida.charts") ?? "1"; } catch { /* storage unavailable */ }
  ctx.setChartsCollapsed(chartsPref === "0");
  browser.clear();
  showKit(state.kit);
  setTool("place");
  ctx.paintPeers();
  if (state.flags.view3d) ctx.setSurface("3d");
  else ctx.setSurface("2d");
  if (state.flags.brains) ctx.setBrains(true);
  if (state.flags.multiplayer) ctx.joinRoom(true);
  requestAnimationFrame(loop);
}
