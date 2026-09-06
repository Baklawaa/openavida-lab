import { drawFitness, drawPhylogeny, drawShannon } from "./render/charts";
import { GenomeBrowser, genesHtml, phenotypeTableHtml } from "./render/genomeBrowser";
import { DnaEditor } from "./ui/dnaEditor";
import { SpeciesPanel } from "./ui/speciesPanel";
import { GoalPanel } from "./ui/goalPanel";
import { WorkerHost } from "./ui/workerHost";
import { LabRenderer, type FieldMode, type ViewMode } from "./render/webgl";
import { View3D } from "./render/view3d";
import {
  DualWorld,
  InlineHost,
  World,
  bodySize,
  applyRecipe,
  buildShareURL,
  canDriveClock,
  canMutateWorld,
  handleIncoming,
  decodeGenome,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  CAUSE_COLOR,
  CAUSE_LABEL,
  DNA_KITS,
  dnaSnippet,
  flagsFromQuery,
  flagsToQuery,
  founderHeterotroph,
  genomeForKit,
  inspectBiochem,
  mappingLegend,
  parseJSONSnapshot,
  pathwaysHtml,
  RoomSession,
  strongestLiving,
  tallyDeaths,
  tracesHtml,
  parseShareURL,
  recipeFromQuery,
  peerColor,
  takeSnapshot,
  toGenomeTrack,
  type BrushKind,
  type Recipe,
  type DeathCause,
  type FeatureFlags,
  type PeerRole,
  type RoomOp,
  type Side,
  type SimHost,
  type SimParams,
  type StepSide,
  type WorldSnapshot,
} from "./sim/index";
import { shouldWriteEditor, type EditorSyncReason } from "./ui/editorSync";
import { formatSpeed, ticksDue } from "./ui/speed";
import { CONTROL_HELP, attachControlHelp } from "./ui/help";
import { applyTool, pointerAction, type LabTool } from "./ui/pointer";
import { makeSelf, openRoomChannel } from "./ui/roomChannel";
import { createLabLayout, icon, KIT_COPY } from "./ui/layout";
import { DEATH_LABEL } from "./ui/labels";

const BRUSHES: { id: BrushKind; label: string }[] = [
  { id: "nutrientBlob", label: "Nutriments" },
  { id: "toxinBlob", label: "Toxines" },
  { id: "heatBlob", label: "Chaleur" },
  { id: "lightBlob", label: "Lumière" },
  { id: "barrier", label: "Obstacle" },
  { id: "erase", label: "Gomme" },
  { id: "nutrientVent", label: "Source nutritive" },
  { id: "toxinVent", label: "Source toxique" },
  { id: "thermalVent", label: "Source de chaleur" },
  { id: "shade", label: "Ombre" },
  { id: "wipeOrgs", label: "Retirer la vie" },
];



function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html = "",
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  if (html) n.innerHTML = html;
  return n;
}

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

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
  const state = {
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
    snapshot: null as WorldSnapshot | null,
    lastUi: 0,
    flags,
    surface: "2d" as "2d" | "3d",
    room: null as RoomSession | null,
    roomPost: null as ((op: RoomOp) => void) | null,
    roomClose: null as (() => void) | null,
  };
  if (state.flags.view3d) state.surface = "3d";

  const { viz, stage, canvas, canvas3d, hud, cursors, side, cFit, cShan, cPhy } = createLabLayout(root);
  type Panel = "organisms" | "environment" | "analysis" | "species" | "experiment";
  const PANELS: readonly Panel[] = ["organisms", "environment", "analysis", "species", "experiment"];
  const openTab = (panel: Panel) => {
    if (panel === "experiment" || panel === "species") openPanel(panel);
    else setTool(panel === "environment" ? "paint" : panel === "analysis" ? "inspect" : "place");
  };
  function openPanel(panel: Panel, focus = false): void {
    root.querySelectorAll<HTMLElement>("[role=tabpanel]").forEach(p => p.hidden = p.id !== "panel-" + panel);
    root.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach(b => {
      const active = b.dataset.panel === panel;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
      if (active && focus) b.focus();
    });
    root.querySelector(".side-scroll")!.scrollTop = 0;
    requestAnimationFrame(layout);
  }
  root.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach(b => {
    b.addEventListener("click", () => openTab(b.dataset.panel as Panel));
    b.addEventListener("keydown", ev => {
      const n = PANELS.length;
      const index = PANELS.indexOf(b.dataset.panel as Panel);
      const next = ev.key === "ArrowRight" ? (index + 1) % n : ev.key === "ArrowLeft" ? (index + n - 1) % n : ev.key === "Home" ? 0 : ev.key === "End" ? n - 1 : -1;
      if (next >= 0) {
        ev.preventDefault();
        const panel = PANELS[next]!;
        openTab(panel);
        root.querySelector<HTMLButtonElement>("#tab-" + panel)!.focus();
      }
    });
  });
  const helpDialog = root.querySelector<HTMLDialogElement>("#help-dialog")!;
  root.querySelector("#btn-help")!.addEventListener("click", () => helpDialog.showModal());
  root.querySelector(".brand")!.addEventListener("click", ev => { ev.preventDefault(); openPanel("organisms"); });
  root.querySelector("#btn-focus")!.addEventListener("click", () => {
    const focused = root.classList.toggle("focus-mode");
    root.querySelector("#btn-focus")!.setAttribute("aria-pressed", String(focused));
    root.querySelector("#btn-focus")!.setAttribute("aria-label", focused ? "Rétablir l’interface complète" : "Agrandir la visualisation");
    layout();
  });
  side.addEventListener("toggle", () => requestAnimationFrame(layout), true);

  const brushRow = root.querySelector("#brushes")!;
  for (const b of BRUSHES) {
    const btn = el("button", { type: "button", id: "brush-" + b.id, "data-brush": b.id }, b.label);
    if (b.id === state.brush) btn.classList.add("active");
    brushRow.append(btn);
  }
  const kitRow = root.querySelector("#dna-kits")!;
  const showKit = (id: string) => {
    state.kit = id;
    kitRow.querySelectorAll("button").forEach((b) => { b.classList.toggle("active", b.id === "kit-" + id); b.setAttribute("aria-pressed", String(b.id === "kit-" + id)); });
    (root.querySelector("#kit-blurb") as HTMLElement).textContent = KIT_COPY[id]!.description;
    (root.querySelector("#founder") as HTMLSelectElement).value = id;
    const p = decodeGenome(genomeForKit(id)).phenotype;
    (root.querySelector("#kit-traits") as HTMLElement).textContent =
      `Lumière ${p.photo.toFixed(2)} · Nutrition ${p.uptake.toFixed(2)} · Résist. ${p.resist.toFixed(2)}`;
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
  function setSurface(which: "2d" | "3d"): void {
    state.surface = which;
    state.flags.view3d = which === "3d";
    canvas.classList.toggle("off", which === "3d");
    canvas3d.classList.toggle("on", which === "3d");
    root.querySelector("#view-2d")!.classList.toggle("active", which === "2d");
    root.querySelector("#view-3d")!.classList.toggle("active", which === "3d");
    root.querySelector("#view-2d")!.setAttribute("aria-pressed", String(which === "2d"));
    root.querySelector("#view-3d")!.setAttribute("aria-pressed", String(which === "3d"));
    (root.querySelector("#zoom-top") as HTMLInputElement).disabled = which === "3d";
    root.querySelector("#view-hint")!.textContent = which === "3d" ? "Glisser : tourner · Molette : zoomer · Clic : outil actif" : root.querySelector("#place-hint")!.textContent;
    if (which === "3d" && state.view === "split") setView(dual.active);
    (root.querySelector("#opt-view3d input") as HTMLInputElement).checked = which === "3d";
    if (which === "3d") {
      const v = ensure3d();
      const r = viz.getBoundingClientRect();
      v.resize(r.width, r.height);
    }
    layout();
  }
  const gbCanvas = root.querySelector("#gbrowser") as HTMLCanvasElement;
  const browser = new GenomeBrowser(gbCanvas);
  (root.querySelector("#seed") as HTMLInputElement).value = String(dual.a.params.seed);

  const current = (): World => ((state.view === "split" ? dual.active : state.view) === "B" ? dual.b : dual.a);
  const sideOf = (w: World): Side => (w === dual.b ? "B" : "A");
  const stepWhich = (): StepSide => (state.view === "split" ? "both" : state.view === "B" ? "B" : "A");

  function status(msg: string): void {
    (root.querySelector("#status-line") as HTMLElement).textContent = msg;
  }

  function emitOp(op: RoomOp): void {
    if (!state.room || !state.roomPost) return;
    if (op.kind === "cursor" || op.kind === "hello" || op.kind === "bye" || op.kind === "role" || op.kind === "pause") {
      state.roomPost(op);
      return;
    }
    if (state.room.isHost) {
      state.roomPost({ kind: "snapshot", snap: current().snapshot() });
      return;
    }
    state.roomPost(op);
  }

  function emitCursor(x: number, y: number): void {
    if (!state.room) return;
    const op = state.room.setCursor(x, y);
    if (op) emitOp(op);
  }

  function paintPeers(): void {
    const host = root.querySelector("#mp-peers")!;
    if (!state.room) {
      host.textContent = "Activez la session partagée pour ouvrir un salon.";
      cursors.innerHTML = "";
      return;
    }
    const rows = [...state.room.peers.values()].map((p) => `${p.name} (${p.role})`);
    host.textContent = rows.join(" · ") || "no peers";
    cursors.innerHTML = "";
    const w = current();
    for (const p of state.room.peers.values()) {
      if (p.id === state.room.selfId) continue;
      const pos = renderer.gridToCanvas(p.x, p.y, w);
      const d = el("div", { class: "mp-cursor" });
      d.style.left = `${pos.x}px`;
      d.style.top = `${pos.y}px`;
      d.style.borderColor = p.color;
      d.title = p.name;
      cursors.append(d);
    }
  }

  const dna = new DnaEditor(root.querySelector<HTMLElement>("#dna-editor")!, {
    status,
    selectedGenome: () => {
      const org = current().organisms.find((o) => o.id === state.selectedId);
      return org ? { id: org.id, genome: org.genome } : null;
    },
    onApply: (seq) => {
      if (state.selectedId < 0) {
        status("Sélectionnez d’abord un organisme avec Inspecter, ou placez-en un avec ce génome.");
        return;
      }
      host.apply({ kind: "replaceGenome", which: sideOf(current()), orgId: state.selectedId, genome: seq });
      selectOrganism(current(), state.selectedId, "apply");
      status("Génome appliqué à la sélection : nouvelle lignée créée.");
    },
    onPlace: () => {
      setTool("place");
      status("Cliquez dans le monde pour placer un organisme avec ce génome.");
    },
  });
  const editorGenome = (): string => dna.sequence || genomeForKit(state.kit);
  const goals = new GoalPanel(root.querySelector<HTMLElement>("#panel-goals")!, {
    status,
    world: () => current(),
    activeWorld: () => dual.active,
    restoreInto: (target, snap) => {
      if (target === "B") {
        host.apply({ kind: "restore", which: "B", snapshot: snap });
        setView("B");
      } else {
        host.apply({ kind: "restore", which: sideOf(current()), snapshot: snap });
        selectOrganism(current(), -1);
      }
      paintFeeds();
      refreshMetrics();
    },
    replayInto: (snap) => {
      host.apply({ kind: "replaceWorld", which: "B", snapshot: snap, recording: null });
      state.paused = true;
      updatePlayback();
      setView("B");
      paintFeeds();
      refreshMetrics();
    },
    setRecording: (on) => host.apply({ kind: "recording", which: sideOf(current()), on }),
    applyRecipe: (recipe: Recipe, target) => {
      const next = applyRecipe(recipe);
      const which: Side = target === "B" ? "B" : sideOf(current());
      host.apply({ kind: "replaceWorld", which, snapshot: next.snapshot(), recording: next.recording });
      if (target === "B") setView("B");
      else selectOrganism(current(), -1);
      paintFeeds();
      refreshMetrics();
    },
  });
  if (sharedRecipe) {
    status(`Recette chargée : ${sharedRecipe.ops.length} action${sharedRecipe.ops.length > 1 ? "s" : ""}.`);
  }
  /** Name the strain after its kit when the genome is an unmodified kit genome. */
  function tagStrain(world: World, seq: string): void {
    const kit = DNA_KITS.find((k) => genomeForKit(k.id) === seq);
    host.apply({ kind: "defineStrain", which: sideOf(world), genome: seq, name: kit ? KIT_COPY[kit.id]!.label : undefined });
  }
  const species = new SpeciesPanel(root.querySelector<HTMLElement>("#panel-species")!, {
    status,
    world: () => current(),
    editorGenome: () => dna.sequence,
    loadGenome: (seq, label) => {
      dna.load(seq);
      setTool("place");
      status(`Génome de « ${label} » chargé. Cliquez sur une cellule libre pour le placer.`);
    },
    inject: (seq, n) => {
      tagStrain(current(), seq);
      const placed = host.apply({ kind: "inject", which: sideOf(current()), genome: seq, count: n }).count ?? 0;
      status(`${placed} organismes injectés dans le monde ${dual.active}.`);
      paintFeeds();
      refreshMetrics();
    },
    defineStrain: (genome, name) => host.apply({ kind: "defineStrain", which: sideOf(current()), genome, name, manual: true }).strain!,
    renameStrain: (id, name) => host.apply({ kind: "renameStrain", which: sideOf(current()), id, name }).ok ?? false,
    onColorByStrain: (on) => {
      renderer.colorByStrain = on;
      if (view3d) view3d.colorByStrain = on;
      status(on ? "Couleur des organismes : souche fondatrice." : "Couleur des organismes : guilde et lignée.");
    },
    openMutation: (inn) => {
      if (!inn.genome) {
        status("Séquence de la mutation absente (instantané ancien).");
        return;
      }
      dna.load(inn.genome, { diffAgainst: inn.parentGenome ?? "" });
      openTab("organisms");
      root.querySelector("#dna-editor")?.scrollIntoView({ block: "nearest" });
      (root.querySelector("#dna-strip-section") as HTMLDetailsElement | null)?.setAttribute("open", "");
      status(`Mutation au pas ${inn.tick} · ${inn.kind} · génome comparé au parent.`);
    },
  });

  function loadSeqIntoBuilder(seq: string): void {
    dna.load(seq);
    (root.querySelector("#dna-builder") as HTMLDetailsElement).open = true;
  }

  function paintFeeds(): void {
    const w = current();
    const board = root.querySelector("#leaderboard")!;
    const top = strongestLiving(w.organisms, 8);
    if (top.length === 0) {
      board.innerHTML = `<p class="muted">Aucun organisme vivant.</p>`;
    } else {
      board.innerHTML = top
        .map((o, i) => {
          const ph = o.ph;
          return `<button type="button" class="feed-row" data-org="${o.id}">
            <div class="feed-head"><b>#${i + 1}</b> Fitness ${o.fitness.toFixed(3)} · Énergie ${o.energy.toFixed(2)}</div>
            <div class="muted">Lignée ${o.lineageId} · Lumière ${ph.photo.toFixed(2)} · Nutrition ${ph.uptake.toFixed(2)}</div>
            <div class="dna">${dnaSnippet(o.genome)}</div>
            <span class="use-dna" data-use="${o.id}">Modifier cet ADN</span>
          </button>`;
        })
        .join("");
    }
    const tally = tallyDeaths(w.deaths);
    const tallyEl = root.querySelector("#death-tally")!;
    const causes = Object.keys(CAUSE_LABEL) as DeathCause[];
    const parts = causes
      .filter((k) => (tally[k] ?? 0) > 0)
      .map((k) => `<span style="color:${CAUSE_COLOR[k]}">${DEATH_LABEL[k]} : ${tally[k]}</span>`);
    tallyEl.innerHTML = parts.length ? parts.join(" · ") : `<span class="muted">Aucun décès pour le moment</span>`;
    const log = root.querySelector("#death-log")!;
    const recent = w.deaths.slice(-16).reverse();
    if (recent.length === 0) {
      log.innerHTML = `<p class="muted">Aucun décès enregistré.</p>`;
    } else {
      log.innerHTML = recent
        .map((d) => {
          return `<button type="button" class="feed-row" data-genome="${d.genome}">
            <div class="feed-head" style="color:${CAUSE_COLOR[d.cause]}">${DEATH_LABEL[d.cause]}</div>
            <div class="muted">Pas ${d.tick} · N° ${d.orgId} · Lignée ${d.lineageId} · Fitness ${d.fitness.toFixed(3)}</div>
            <div class="dna">${dnaSnippet(d.genome)}</div>
          </button>`;
        })
        .join("");
    }
  }

  function setTool(tool: LabTool): void {
    const next = applyTool(tool);
    state.tool = next.tool;
    state.paintMode = next.paintMode;
    hud.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.id === "tool-" + tool);
      b.setAttribute("aria-pressed", String(b.id === "tool-" + tool));
    });
    const hint = tool === "place" ? "Clic sur une cellule libre : place un organisme avec le génome de l’éditeur." : tool === "paint" ? "Clic ou glisser : applique le pinceau sélectionné." : "Clic sur un organisme : génome, phénotype, métabolisme.";
    root.querySelector("#place-hint")!.textContent = hint;
    root.querySelector("#view-hint")!.textContent = state.surface === "3d" ? "Glisser : tourner · Molette : zoomer · Clic : outil actif" : hint;
    canvas.style.cursor = tool === "inspect" ? "crosshair" : "cell";
    openPanel(tool === "paint" ? "environment" : tool === "inspect" ? "analysis" : "organisms");
  }

  function selectKit(id: string): void {
    setTool("place");
    showKit(id);
  }

  function selectOrganism(world: World, id: number, reason: EditorSyncReason = "select"): void {
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
        root.querySelector("#selection-tag")!.textContent = "AUCUN";
        actions.hidden = true;
        meta.textContent = "Cliquez sur un organisme dans le monde.";
        gEl.textContent = "";
        pEl.innerHTML = "";
        genesEl.innerHTML = "";
        pwEl.innerHTML = "";
        brEl.innerHTML = "";
        browser.clear();
      }
      return;
    }
    root.querySelector("#selection-tag")!.textContent = `N° ${org.id}`;
    actions.hidden = false;
    meta.innerHTML = `<div class="selection-metrics"><span>Énergie<b>${org.energy.toFixed(2)}</b></span><span>Fitness<b>${org.fitness.toFixed(3)}</b></span></div><div class="selection-info">Lignée ${org.lineageId} · Position (${org.x}, ${org.y}) · Parent ${org.parentId < 0 ? "fondateur" : org.parentId}</div><div class="selection-info">Corpulence ${(org.mass * 100).toFixed(0)} % · Taille effective ${bodySize(org).toFixed(2)} (génome ${org.ph.size.toFixed(2)}) · Âge ${org.age}</div>`;
    if (reason === "refresh") return;
    const decoded = decodeGenome(org.genome);
    const track = toGenomeTrack(decoded);
    gEl.textContent = org.genome;
    pEl.innerHTML = phenotypeTableHtml(org.ph);
    genesEl.innerHTML = genesHtml(track);
    const env = world.fields.sample(org.x, org.y);
    pwEl.innerHTML = pathwaysHtml(inspectBiochem(decoded, env, org));
    brEl.innerHTML = tracesHtml(world.brain?.traces ?? [], org.id);
    if (shouldWriteEditor(reason)) dna.load(org.genome);
    browser.setSequence(org.genome);
    if (view3d) view3d.selectedId = id;
  }

  function drawCharts(): void {
    if (root.classList.contains("charts-collapsed") && !root.classList.contains("wide-workspace")) return;
    const w = current();
    const hist = w.history.length > 400 ? w.history.filter((_, i) => i % 4 === 0 || i > w.history.length - 80) : w.history;
    const size = (c: HTMLCanvasElement) => [c.parentElement!.clientWidth - 28, Math.max(75, c.parentElement!.clientHeight - 42)] as const;
    drawFitness(cFit, ...size(cFit), hist);
    drawShannon(cShan, ...size(cShan), hist);
    drawPhylogeny(cPhy, ...size(cPhy), w.lineages.values(), w.tick);
  }

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
  const chartsBtn = root.querySelector<HTMLButtonElement>("#btn-charts")!;
  function setChartsCollapsed(collapsed: boolean): void {
    root.classList.toggle("charts-collapsed", collapsed);
    chartsBtn.textContent = collapsed ? "Afficher" : "Réduire";
    chartsBtn.setAttribute("aria-expanded", String(!collapsed));
    try { localStorage.setItem("openavida.charts", collapsed ? "0" : "1"); } catch { /* storage unavailable */ }
    layout();
  }
  chartsBtn.addEventListener("click", () => setChartsCollapsed(!root.classList.contains("charts-collapsed")));

  function refreshMetrics(): void {
    const w = current();
    const last = w.history[w.history.length - 1];
    const set = (id: string, v: string) => {
      const n = document.getElementById(id);
      if (n && n.textContent !== v) n.textContent = v;
    };
    const activeWorld = w === dual.b ? "B" : "A";
    set("chart-world", `MONDE ${activeWorld} · HISTORIQUE`);
    set("world-size", `${w.w} × ${w.h}`);
    set("stage-label", state.view === "split" ? `A · ${dual.a.organisms.length} organismes${activeWorld === "A" ? " · sélectionné" : ""}` : `MONDE ${activeWorld}`);
    set("stage-label-b", `B · ${dual.b.organisms.length} organismes${activeWorld === "B" ? " · sélectionné" : ""}`);
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
        selectOrganism(w, -1);
        root.querySelector("#inspect-meta")!.textContent = "Cet organisme n’est plus vivant. Consultez le journal des décès ci-dessous.";
      }
    }
    const now = performance.now();
    if (now - state.lastUi > 250) {
      drawCharts();
      paintFeeds();
      if (state.selectedId >= 0) selectOrganism(w, state.selectedId, "refresh");
      species.refresh();
      goals.refresh();
      updatePlayback();
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
    };
  }

  window.__openavidaSelectAt = (clientX: number, clientY: number) => {
    const sidePick = renderer.pickWorld(clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(clientX, clientY, world);
    if (!grid) return false;
    const org = world.nearestOrganism(grid.x, grid.y, 6);
    if (!org) return false;
    dual.active = sidePick;
    selectOrganism(world, org.id);
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
      emitOp({ kind: "paint", x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
    }
  }

  function onPointer(ev: PointerEvent, down: boolean): void {
    const sidePick = renderer.pickWorld(ev.clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(ev.clientX, ev.clientY, world);
    if (!grid) return;
    if (dual.active !== sidePick) {
      dual.active = sidePick;
      selectOrganism(world, -1);
    }
    emitCursor(grid.x, grid.y);
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
      emitOp({ kind: "paint", x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
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
        selectOrganism(world, child.id, "peek");
        status(`Organisme placé en (${grid.x}, ${grid.y}).`);
        emitOp({ kind: "place", x: grid.x, y: grid.y, genome: seq });
        paintFeeds();
        refreshMetrics();
      } else {
        const occ = world.organismAt(grid.x, grid.y);
        if (occ) {
          dual.active = sidePick;
          selectOrganism(world, occ.id, "peek");
          refreshMetrics();
        } else status("Cette cellule est bloquée par un obstacle.");
      }
      return;
    }
    const org = world.nearestOrganism(grid.x, grid.y, 4);
    if (org) {
      dual.active = sidePick;
      selectOrganism(world, org.id);
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
      emitCursor(grid.x, grid.y);
      const f = world.fields.sample(grid.x, grid.y);
      const readout = root.querySelector<HTMLElement>("#cell-readout")!;
      readout.hidden = false;
      readout.textContent = `(${grid.x}, ${grid.y}) · Nutr. ${f.nutrient.toFixed(2)} · Tox. ${f.toxin.toFixed(2)} · Temp. ${f.temperature.toFixed(2)} · Lum. ${f.light.toFixed(2)}`;
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
    if (g) emitCursor(g.x, g.y);
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
        selectOrganism(world, child.id, "peek");
        emitOp({ kind: "place", x: grid.x, y: grid.y, genome: seq });
        refreshMetrics();
      }
    } else if (state.tool === "paint") {
      if (state.room && !canMutateWorld(state.room.self.role)) return;
      host.apply({ kind: "paint", which: sideOf(world), x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
      emitOp({ kind: "paint", x: grid.x, y: grid.y, radius: state.radius, brush: state.brush });
    } else if (org) {
      selectOrganism(world, org.id, state.tool === "inspect" ? "select" : "peek");
      refreshMetrics();
    }
  });
  canvas3d.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    ensure3d().zoomBy(ev.deltaY);
  }, { passive: false });
  canvas3d.addEventListener("contextmenu", (ev) => ev.preventDefault());

  root.querySelector("#brushes")!.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const id = t.getAttribute("data-brush") as BrushKind | null;
    if (!id) return;
    state.brush = id;
    root.querySelectorAll("[data-brush]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-brush") === id);
      b.setAttribute("aria-pressed", String(b.getAttribute("data-brush") === id));
    });
    setTool("paint");
  });
  (root.querySelector("#radius") as HTMLInputElement).addEventListener("input", (ev) => {
    state.radius = Number((ev.target as HTMLInputElement).value);
    (root.querySelector("#rad-lab") as HTMLElement).textContent = String(state.radius);
  });
  const speedTop = root.querySelector("#speed-top") as HTMLInputElement;
  function updatePlayback(): void {
    const paused = state.paused || state.speed <= 0;
    const button = root.querySelector<HTMLElement>("#btn-pause")!;
    if (button.dataset.paused !== String(paused)) {
      button.innerHTML = `${icon(paused ? "play" : "pause")}<span>${paused ? "Reprendre" : "Pause"}</span>`;
      button.setAttribute("aria-label", paused ? "Reprendre la simulation" : "Mettre en pause");
      button.dataset.paused = String(paused);
    }
    const label = root.querySelector("#run-state")!;
    const text = !canDriveClock(state.room) ? "Session suivie" : paused ? "En pause" : "En cours";
    if (label.textContent !== text) label.innerHTML = `<i></i>${text}`;
    label.classList.toggle("paused", paused);
  }
  const setSpeed = (n: number) => {
    state.speed = Math.max(0, Math.min(60, n));
    state.paused = state.speed <= 0;
    speedTop.value = String(state.speed);
    root.querySelector("#spd-lab-top")!.textContent = formatSpeed(state.speed);
    updatePlayback();
  };
  speedTop.addEventListener("input", () => setSpeed(Number(speedTop.value)));
  const zoomTop = root.querySelector("#zoom-top") as HTMLInputElement;
  zoomTop.addEventListener("input", () => {
    const pct = Math.max(30, Math.min(100, Number(zoomTop.value)));
    renderer.zoom = pct / 100;
    root.querySelector("#zoom-lab-top")!.textContent = `${pct}%`;
  });
  root.querySelector("#btn-pause")!.addEventListener("click", () => {
    if (state.speed <= 0) setSpeed(2);
    else state.paused = !state.paused;
    updatePlayback();
  });
  const terrainBox = root.querySelector("#opt-terrain input") as HTMLInputElement;
  const disturbBox = root.querySelector("#opt-disturb input") as HTMLInputElement;
  terrainBox.checked = dual.a.randomTerrain;
  disturbBox.checked = dual.a.disturbances;
  terrainBox.addEventListener("change", () => {
    host.apply({ kind: "terrainPreset", on: terrainBox.checked });
    status(terrainBox.checked ? "Relief aléatoire : sources, obstacles et ombre ajoutés." : "Relief prédéfini retiré.");
  });
  disturbBox.addEventListener("change", () => {
    host.apply({ kind: "disturbances", on: disturbBox.checked });
    status(disturbBox.checked ? "Perturbations aléatoires activées." : "Perturbations aléatoires désactivées.");
  });
  const box3d = root.querySelector("#opt-view3d input") as HTMLInputElement;
  const boxBrains = root.querySelector("#opt-brains input") as HTMLInputElement;
  const boxLlm = root.querySelector("#opt-llm input") as HTMLInputElement;
  const boxMp = root.querySelector("#opt-mp input") as HTMLInputElement;
  box3d.checked = state.flags.view3d;
  boxBrains.checked = state.flags.brains;
  boxLlm.checked = state.flags.llmBrains;
  boxMp.checked = state.flags.multiplayer;
  function setBrains(on: boolean): void {
    state.flags.brains = on;
    boxBrains.checked = on;
    host.apply({ kind: "brains", on, llm: state.flags.llmBrains });
    status(on ? (state.flags.llmBrains ? "LLM brains on (fallback baseline if no adapter)" : "baseline brains on") : "brains off — phase-1 movement");
  }
  box3d.addEventListener("change", () => setSurface(box3d.checked ? "3d" : "2d"));
  boxBrains.addEventListener("change", () => setBrains(boxBrains.checked));
  boxLlm.addEventListener("change", () => {
    state.flags.llmBrains = boxLlm.checked;
    if (state.flags.brains) setBrains(true);
  });
  function joinRoom(asHost: boolean): void {
    state.roomClose?.();
    const roomId = (root.querySelector("#mp-room") as HTMLInputElement).value.trim() || "lab";
    const role = (root.querySelector("#mp-role") as HTMLSelectElement).value as PeerRole;
    const self = makeSelf(asHost ? "host" : "peer", state.room?.peers.size ?? 0);
    self.role = asHost ? "host" : role === "host" ? "experimenter" : role;
    self.color = peerColor(asHost ? 0 : 1);
    state.room = new RoomSession(self, { claimHost: asHost });
    state.flags.multiplayer = true;
    boxMp.checked = true;
    const ch = openRoomChannel(roomId, state.room, (op) => {
      if (!state.room) return;
      handleIncoming(state.room, op, current(), (reply) => state.roomPost?.(reply));
      paintPeers();
    });
    state.roomPost = ch.post;
    state.roomClose = ch.close;
    paintPeers();
    status(asHost ? `hosting room ${roomId}` : `joined room ${roomId} as ${self.role}`);
  }
  boxMp.addEventListener("change", () => {
    state.flags.multiplayer = boxMp.checked;
    if (boxMp.checked) joinRoom(true);
    else {
      state.roomClose?.();
      state.room = null;
      state.roomPost = null;
      paintPeers();
      status("multiplayer off");
    }
  });
  root.querySelector("#btn-mp-host")!.addEventListener("click", () => joinRoom(true));
  root.querySelector("#btn-mp-join")!.addEventListener("click", () => joinRoom(false));
  root.querySelector("#btn-slow")!.addEventListener("click", () => setSpeed(2));
  root.querySelector("#btn-step-once")!.addEventListener("click", () => {
    state.paused = true;
    updatePlayback();
    host.step(stepWhich(), 1);
    paintFeeds();
    refreshMetrics();
  });
  function setView(view: ViewMode): void {
    state.view = view;
    renderer.view = view;
    dual.active = view === "B" ? "B" : "A";
    state.selectedId = -1;
    selectOrganism(current(), -1);
    if (view === "split" && state.surface === "3d") setSurface("2d");
    root.querySelectorAll<HTMLElement>(".view").forEach(b => {
      const active = b.dataset.view === view;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    layout();
    refreshMetrics();
  }
  root.querySelectorAll<HTMLElement>(".view").forEach(b => b.addEventListener("click", () => setView(b.dataset.view as ViewMode)));
  function setField(mode: FieldMode): void {
    renderer.fieldMode = mode;
    if (view3d) view3d.fieldMode = mode;
    root.querySelectorAll<HTMLElement>(".fm").forEach(b => {
      const active = Number(b.dataset.fm) === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    const legends = [
      '<i class="dot nutrient"></i>Nutriments <i class="dot toxin"></i>Toxines <i class="dot light"></i>Lumière',
      'Nutriments <span class="legend-scale nutrient-scale"></span> faible → élevé',
      'Toxines <span class="legend-scale toxin-scale"></span> faible → élevé',
      'Température <span class="legend-scale temperature-scale"></span> froid → chaud',
      'Lumière <span class="legend-scale light-scale"></span> faible → élevée',
    ];
    root.querySelector("#field-legend")!.innerHTML = legends[mode]!;
  }
  root.querySelectorAll<HTMLElement>(".fm").forEach(b => b.addEventListener("click", () => setField(Number(b.dataset.fm) as FieldMode)));
  for (const [id, which] of [["#btn-step-a", "A"], ["#btn-step-b", "B"], ["#btn-step-both", "both"]] as const) {
    root.querySelector(id)!.addEventListener("click", () => {
      state.paused = true;
      host.step(which, 1);
      refreshMetrics();
    });
  }
  root.querySelector("#btn-snap")!.addEventListener("click", () => {
    state.snapshot = takeSnapshot(current());
    (root.querySelector("#btn-restore") as HTMLButtonElement).disabled = false;
    root.querySelector("#snapshot-info")!.textContent = `Monde ${dual.active} · pas ${current().tick} · ${current().organisms.length} organismes`;
    status("État mémorisé. Vous pouvez le restaurer depuis Expérience.");
  });
  root.querySelector("#btn-restore")!.addEventListener("click", () => {
    if (!state.snapshot) {
      status("no snapshot");
      return;
    }
    host.apply({ kind: "restore", which: sideOf(current()), snapshot: state.snapshot });
    selectOrganism(current(), -1);
    status(`Monde restauré au pas ${current().tick}.`);
    refreshMetrics();
  });
  root.querySelector("#btn-bottle")!.addEventListener("click", () => {
    const n = host.apply({ kind: "bottleneck", which: sideOf(current()), keep: 0.1 }).count ?? 0;
    status(`Goulot d’étranglement : ${n} organismes conservés.`);
    paintFeeds();
    refreshMetrics();
  });
  root.querySelector("#btn-reseed")!.addEventListener("click", () => {
    const seed = Number((root.querySelector("#seed") as HTMLInputElement).value) >>> 0 || 1;
    const p: SimParams = { ...current().params, seed };
    host.apply({ kind: "reseed", params: p, seedB: (seed ^ 0x9e3779b9) >>> 0 || 1 });
    state.selectedId = -1;
    selectOrganism(current(), -1);
    status(`Mondes A et B réinitialisés avec la graine ${seed}.`);
    refreshMetrics();
  });
  root.querySelector("#btn-share")!.addEventListener("click", async () => {
    const url = (() => {
      const base = buildShareURL(current().params);
      const f = flagsToQuery(state.flags);
      if (!f) return base;
      return base + (base.includes("?") ? "&" : "?") + f;
    })();
    try {
      await navigator.clipboard.writeText(url);
      status("Lien de configuration copié. Pour partager l’état actuel, exportez le monde.");
    } catch {
      status(url);
    }
    history.replaceState(null, "", "?" + url.split("?")[1]);
  });
  root.querySelector("#btn-json")!.addEventListener("click", () => {
    download(`openavida-t${current().tick}.json`, exportJSON(current()), "application/json");
  });
  root.querySelector("#btn-csv")!.addEventListener("click", () => {
    download(`openavida-metrics-t${current().tick}.csv`, exportMetricsCSV(current().history), "text/csv");
  });
  root.querySelector("#btn-phylo")!.addEventListener("click", () => {
    download(`openavida-phylo-t${current().tick}.csv`, exportPhylogenyCSV(current()), "text/csv");
  });
  root.querySelector("#btn-import")!.addEventListener("click", () => {
    (root.querySelector("#import-file") as HTMLInputElement).click();
  });
  (root.querySelector("#import-file") as HTMLInputElement).addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      host.apply({ kind: "restore", which: sideOf(current()), snapshot: parseJSONSnapshot(text) });
      selectOrganism(current(), -1);
      status("Monde importé avec succès.");
      refreshMetrics();
    } catch {
      status("Import impossible : choisissez un fichier JSON exporté depuis OpenAvida.");
    } finally {
      (ev.target as HTMLInputElement).value = "";
    }
  });

  root.querySelector("#btn-edit-selected")!.addEventListener("click", () => {
    const org = current().organisms.find((o) => o.id === state.selectedId);
    if (!org) {
      status("Cet organisme n’est plus vivant.");
      return;
    }
    loadSeqIntoBuilder(org.genome);
    setTool("place");
    root.querySelector("#dna-editor")!.scrollIntoView({ block: "start", behavior: "smooth" });
    status(`ADN de l’organisme ${org.id} ouvert dans l’éditeur. Modifiez-le, puis appliquez-le ou placez un nouvel organisme.`);
  });
  root.querySelector("#leaderboard")!.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const use = t.closest("[data-use]") as HTMLElement | null;
    if (use) {
      const id = Number(use.getAttribute("data-use"));
      const org = current().organisms.find((o) => o.id === id);
      if (org) {
        loadSeqIntoBuilder(org.genome);
        setTool("place");
        status(`ADN de l’organisme ${id} chargé dans l’éditeur.`);
      }
      return;
    }
    const row = t.closest("[data-org]") as HTMLElement | null;
    if (!row) return;
    const id = Number(row.getAttribute("data-org"));
    selectOrganism(current(), id, "select");
    refreshMetrics();
  });
  root.querySelector("#death-log")!.addEventListener("click", (ev) => {
    const row = (ev.target as HTMLElement).closest("[data-genome]") as HTMLElement | null;
    if (!row) return;
    const seq = row.getAttribute("data-genome") ?? "";
    if (!seq) return;
    loadSeqIntoBuilder(seq);
    setTool("place");
    status("ADN chargé : modifiez-le ou placez un nouvel organisme.");
  });
  root.querySelector("#btn-start")!.addEventListener("click", () => (root.querySelector("#btn-inject") as HTMLButtonElement).click());
  root.querySelector("#btn-inject")!.addEventListener("click", () => {
    const seq = dna.sequence || founderHeterotroph();
    tagStrain(current(), seq);
    const n = host.apply({ kind: "inject", which: sideOf(current()), genome: seq, count: 24 }).count ?? 0;
    status(`${n} organismes ajoutés au monde ${dual.active}.`);
    paintFeeds();
    refreshMetrics();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement || (ev.target instanceof HTMLElement && (ev.target.isContentEditable || ev.target.closest("[data-own-keys]"))) || ev.metaKey || ev.ctrlKey || ev.altKey || helpDialog.open) return;
    if (ev.code === "Space" && !(ev.target instanceof HTMLElement && ev.target.closest("button, summary, a"))) {
      ev.preventDefault();
      (root.querySelector("#btn-pause") as HTMLElement).click();
    }
    if (ev.key === "[") setSpeed(state.speed - 1);
    if (ev.key === "]") setSpeed(state.speed + 1);
    if (ev.key.toLowerCase() === "s") (root.querySelector("#btn-snap") as HTMLElement).click();
    if (ev.key.toLowerCase() === "i") setTool("inspect");
    if (ev.key.toLowerCase() === "o") setTool("place");
    if (ev.key.toLowerCase() === "p") setTool("paint");
    if (/^[1-5]$/.test(ev.key)) setField((Number(ev.key) - 1) as FieldMode);
    if (ev.key === "Escape" && root.classList.contains("focus-mode")) (root.querySelector("#btn-focus") as HTMLElement).click();
  });

  window.addEventListener("resize", layout);
  new ResizeObserver(() => layout()).observe(stage);

  hud.querySelector("#tool-inspect")!.addEventListener("click", () => setTool("inspect"));
  hud.querySelector("#tool-paint")!.addEventListener("click", () => setTool("paint"));
  hud.querySelector("#tool-place")!.addEventListener("click", () => setTool("place"));
  root.querySelector("#view-2d")!.addEventListener("click", () => setSurface("2d"));
  root.querySelector("#view-3d")!.addEventListener("click", () => setSurface("3d"));

  window.__openavidaMutate = async (n = 40) => {
    const which = sideOf(current());
    const prev = current().params.mutationRate;
    const steps = Math.max(1, Math.min(400, n | 0));
    host.apply({ kind: "setParams", which, params: { mutationRate: 1 } });
    host.step(which, steps);
    host.apply({ kind: "setParams", which, params: { mutationRate: prev } });
    await host.flush();
    paintFeeds();
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
    selectOrganism(w, child.id, "peek");
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

  let lastFrame = performance.now();
  let tickAccum = 0;
  const loop = (now: number) => {
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
      ensure3d().draw(current());
    } else {
      renderer.draw(dual.a, dual.b, now / 1000);
    }
    if (state.room?.isHost && !state.paused && state.speed > 0 && current().tick % 10 === 0) {
      state.roomPost?.({ kind: "snapshot", snap: current().snapshot() });
    }
    refreshMetrics();
    requestAnimationFrame(loop);
  };

  const tip = el("div", { id: "hover-tip" });
  tip.hidden = true;
  document.body.append(tip);
  attachControlHelp(root, tip);
  window.__openavidaHelp = CONTROL_HELP;

  let chartsPref = "1";
  try { chartsPref = localStorage.getItem("openavida.charts") ?? "1"; } catch { /* storage unavailable */ }
  setChartsCollapsed(chartsPref === "0");
  browser.clear();
  showKit(state.kit);
  setTool("place");
  paintPeers();
  if (state.flags.view3d) setSurface("3d");
  else setSurface("2d");
  if (state.flags.brains) setBrains(true);
  if (state.flags.multiplayer) joinRoom(true);
  requestAnimationFrame(loop);
}
