import { drawFitness, drawPhylogeny, drawShannon } from "./render/charts";
import { GenomeBrowser, genesHtml, phenotypeTableHtml } from "./render/genomeBrowser";
import { LabRenderer, type FieldMode, type ViewMode } from "./render/webgl";
import {
  DualWorld,
  World,
  applyBottleneck,
  buildShareURL,
  decodeGenome,
  duplicateMutate,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  DNA_KITS,
  founderHeterotroph,
  genomeForKit,
  indelMutate,
  injectStrain,
  kitById,
  mappingLegend,
  paintTerrain,
  parseJSONSnapshot,
  phenotypeForKit,
  placeOrganismAt,
  parseShareURL,
  pointMutate,
  restoreSnapshot,
  takeSnapshot,
  toGenomeTrack,
  type BrushKind,
  type SimParams,
  type WorldSnapshot,
} from "./sim/index";
import { Rng } from "./sim/rng";
import { syncGenomeEditor, type EditorSyncReason } from "./ui/editorSync";
import { formatSpeed, ticksDue } from "./ui/speed";
import { CONTROL_HELP, attachControlHelp } from "./ui/help";

const BRUSHES: { id: BrushKind; label: string }[] = [
  { id: "nutrientBlob", label: "nutrient" },
  { id: "toxinBlob", label: "toxin" },
  { id: "heatBlob", label: "heat" },
  { id: "lightBlob", label: "light" },
  { id: "barrier", label: "wall" },
  { id: "erase", label: "erase" },
  { id: "nutrientVent", label: "N-vent" },
  { id: "toxinVent", label: "T-vent" },
  { id: "thermalVent", label: "hot-vent" },
  { id: "shade", label: "shade" },
  { id: "wipeOrgs", label: "wipe" },
];

type LabTool = "inspect" | "paint" | "place";

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
  const initial = parseShareURL(typeof location !== "undefined" ? location.search : "");
  const dual = new DualWorld(initial);
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
  };

  root.innerHTML = "";
  const header = el("header", { class: "top" });
  header.innerHTML = `
    <div class="brand">OPENAVIDA <span>LAB</span></div>
    <div class="stat teal"><i>tick</i><b id="m-tick">0</b></div>
    <div class="stat"><i>N</i><b id="m-pop">0</b></div>
    <div class="stat"><i>lineages</i><b id="m-lin">0</b></div>
    <div class="stat violet"><i>H′</i><b id="m-h">0</b></div>
    <div class="stat amber"><i>fit</i><b id="m-fit">0</b></div>
    <div class="stat"><i>fixed</i><b id="m-fix">—</b></div>
    <div class="stat"><i>extinct</i><b id="m-ex">0</b></div>
    <div class="stat"><i>step</i><b id="m-ms">—</b></div>
    <div class="speed-ctl">
      <label class="tiny" for="speed-top">speed</label>
      <input id="speed-top" type="range" min="0" max="60" step="1" value="2" />
      <b id="spd-lab-top">2 /s</b>
    </div>
    <div class="speed-ctl">
      <label class="tiny" for="zoom-top">zoom</label>
      <input id="zoom-top" type="range" min="30" max="100" step="1" value="100" />
      <b id="zoom-lab-top">100%</b>
    </div>
    <div class="spacer"></div>
    <div class="clock" id="m-seed"></div>
  `;
  const viz = el("div", { class: "viz" });
  const canvas = el("canvas", { id: "gl" });
  const hud = el("div", { class: "viz-hud" });
  hud.innerHTML = `
    <button type="button" id="tool-inspect">inspect</button>
    <button type="button" id="tool-paint">paint</button>
    <button type="button" id="tool-place" class="active">place organism</button>
  `;
  viz.append(canvas, hud);
  const side = el("aside", { class: "side" });
  const charts = el("footer", { class: "charts" });
  const cFit = el("canvas", { id: "chart-fit" });
  const cShan = el("canvas", { id: "chart-shan" });
  const cPhy = el("canvas", { id: "chart-phy" });
  charts.append(cFit, cShan, cPhy);
  root.append(header, viz, side, charts);

  side.innerHTML = `
    <section class="block">
      <h2>DNA kit</h2>
      <p class="muted" id="place-hint" style="margin:0 0 8px;font-size:12px">Pick a kit, then click an empty cell on the plate.</p>
      <div id="dna-kits" class="kit-grid"></div>
      <div id="kit-blurb" class="muted" style="margin-top:8px;font-size:12px"></div>
      <div id="kit-traits" class="kit-focus"></div>
      <details id="dna-advanced" style="margin-top:10px">
        <summary class="tiny">Advanced sequence</summary>
        <div class="stack" style="margin-top:8px">
          <textarea id="genome-edit" spellcheck="false" placeholder="ACGT sequence — ORFs ATG…TAA"></textarea>
          <div class="row">
            <button type="button" id="btn-point">point</button>
            <button type="button" id="btn-indel">indel</button>
            <button type="button" id="btn-dup">duplication</button>
            <button type="button" id="btn-apply">apply to selected</button>
          </div>
          <div class="row">
            <select id="founder">
              <option value="heterotroph">heterotroph</option>
              <option value="phototroph">phototroph</option>
              <option value="resistant">resistant</option>
              <option value="predator">predator</option>
              <option value="mutualist">mutualist</option>
            </select>
            <button type="button" id="btn-load-founder">load founder</button>
            <button type="button" id="btn-inject">inject ×24</button>
          </div>
        </div>
      </details>
    </section>
    <section class="block">
      <h2>Inspect</h2>
      <div id="inspect-meta" class="muted">Blank plate. Choose a DNA kit, then click an empty cell.</div>
      <div id="inspect-genome"></div>
      <div id="inspect-phenotype"></div>
      <div id="inspect-genes"></div>
    </section>
    <section class="block">
      <h2>Genome browser</h2>
      <div id="browser-wrap"><canvas id="gbrowser"></canvas></div>
    </section>
    <section class="block">
      <h2>Sandbox</h2>
      <div class="row" id="brushes"></div>
      <label class="tiny">brush radius <span id="rad-lab">3</span></label>
      <input id="radius" type="range" min="0" max="12" value="3" />
      <label class="tiny">speed <span id="spd-lab">2 /s</span></label>
      <input id="speed" type="range" min="0" max="60" step="1" value="2" />
      <div class="row" style="margin-top:8px">
        <label class="tiny" id="opt-terrain"><input type="checkbox" /> random vents & walls</label>
        <label class="tiny" id="opt-disturb"><input type="checkbox" /> random events</label>
      </div>
      <div class="row" style="margin-top:8px">
        <button type="button" id="btn-pause">pause</button>
        <button type="button" id="btn-slow">slow</button>
        <button type="button" id="btn-step-once">1 tick</button>
      </div>
      <div class="row">
        <button type="button" id="view-A" data-view="A" class="view active">world A</button>
        <button type="button" id="view-B" data-view="B" class="view">world B</button>
        <button type="button" id="view-split" data-view="split" class="view">A | B</button>
      </div>
      <div class="row">
        <button type="button" id="btn-step-a">step A</button>
        <button type="button" id="btn-step-b">step B</button>
        <button type="button" id="btn-step-both">step both</button>
      </div>
      <div class="row">
        <button type="button" id="btn-snap">snapshot</button>
        <button type="button" id="btn-restore">restore</button>
        <button type="button" id="btn-bottle" class="danger">bottleneck 10%</button>
      </div>
      <div class="row">
        <label class="tiny">seed</label>
        <input id="seed" type="number" />
        <button type="button" id="btn-reseed">reseed</button>
        <button type="button" id="btn-share">copy URL</button>
      </div>
      <div class="row">
        <button type="button" id="btn-json">export JSON</button>
        <button type="button" id="btn-csv">export CSV</button>
        <button type="button" id="btn-phylo">export phylogeny</button>
        <button type="button" id="btn-import">import JSON</button>
      </div>
      <input id="import-file" type="file" accept="application/json" hidden />
      <div id="status-line"></div>
    </section>
    <section class="block">
      <h2>Field overlay</h2>
      <div class="row">
        <button type="button" id="fm-0" data-fm="0" class="fm active">composite</button>
        <button type="button" id="fm-1" data-fm="1" class="fm">nutrient</button>
        <button type="button" id="fm-2" data-fm="2" class="fm">toxin</button>
        <button type="button" id="fm-3" data-fm="3" class="fm">temp</button>
        <button type="button" id="fm-4" data-fm="4" class="fm">light</button>
      </div>
    </section>
    <section class="block">
      <h2>Gene → trait map</h2>
      <p class="muted" style="font-size:11px;margin:0 0 8px">
        ORFs start at ATG, stop at TAA/TAG/TGA. Each codon adds a documented delta.
        Hue is display-only and is not a fitness input.
      </p>
      <div class="mapping-legend" id="legend"></div>
    </section>
  `;

  const brushRow = side.querySelector("#brushes")!;
  for (const b of BRUSHES) {
    const btn = el("button", { type: "button", id: "brush-" + b.id, "data-brush": b.id }, b.label);
    if (b.id === state.brush) btn.classList.add("active");
    brushRow.append(btn);
  }
  const kitRow = side.querySelector("#dna-kits")!;
  const showKit = (id: string) => {
    state.kit = id;
    kitRow.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.id === "kit-" + id));
    const kit = kitById(id);
    (side.querySelector("#kit-blurb") as HTMLElement).textContent = kit.blurb;
    const ph = phenotypeForKit(id);
    const focus = kit.focus;
    (side.querySelector("#kit-traits") as HTMLElement).textContent =
      `${focus} ${Number(ph[focus]).toFixed(2)} · uptake ${ph.uptake.toFixed(2)} · photo ${ph.photo.toFixed(2)} · resist ${ph.resist.toFixed(2)}`;
    (side.querySelector("#genome-edit") as HTMLTextAreaElement).value = genomeForKit(id);
    (side.querySelector("#founder") as HTMLSelectElement).value = id;
  };
  for (const kit of DNA_KITS) {
    const btn = el("button", { type: "button", id: "kit-" + kit.id, class: "kit-btn" }, kit.label);
    kitRow.append(btn);
  }
  kitRow.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const id = t.id.startsWith("kit-") ? t.id.slice(4) : "";
    if (id) {
      state.tool = "place";
      hud.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.id === "tool-place"));
      showKit(id);
    }
  });
  const legend = side.querySelector("#legend")!;
  legend.innerHTML = mappingLegend()
    .map((r) => `<div>${r.codon} ${r.aa} → ${r.trait} ${r.delta >= 0 ? "+" : ""}${r.delta}</div>`)
    .join("");

  const renderer = new LabRenderer(canvas);
  const gbCanvas = side.querySelector("#gbrowser") as HTMLCanvasElement;
  const browser = new GenomeBrowser(gbCanvas);
  (side.querySelector("#seed") as HTMLInputElement).value = String(dual.a.params.seed);

  const current = (): World => (state.view === "B" ? dual.b : dual.a);

  function status(msg: string): void {
    (side.querySelector("#status-line") as HTMLElement).textContent = msg;
  }

  function setTool(tool: LabTool): void {
    state.tool = tool;
    state.paintMode = tool === "paint";
    hud.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.id === "tool-" + tool));
    const hint = side.querySelector("#place-hint") as HTMLElement;
    if (tool === "place") hint.textContent = "Pick a kit, then click an empty cell on the plate.";
    else if (tool === "paint") hint.textContent = "Click or drag to paint the selected substance (nutrient, toxin, wall…).";
    else hint.textContent = "Click an organism to inspect its genome.";
  }

  function selectOrganism(world: World, id: number, reason: EditorSyncReason = "select"): void {
    state.selectedId = id;
    renderer.selectedId = id;
    const org = world.organisms.find((o) => o.id === id) ?? null;
    const meta = side.querySelector("#inspect-meta")!;
    const gEl = side.querySelector("#inspect-genome")!;
    const pEl = side.querySelector("#inspect-phenotype")!;
    const genesEl = side.querySelector("#inspect-genes")!;
    const ta = side.querySelector("#genome-edit") as HTMLTextAreaElement;
    if (!org) {
      if (reason === "select") {
        meta.textContent = "Click an organism on the plate.";
        gEl.textContent = "";
        pEl.innerHTML = "";
        genesEl.innerHTML = "";
        browser.clear();
      }
      return;
    }
    meta.innerHTML = `id ${org.id} · lin ${org.lineageId} · parent ${org.parentId} · E ${org.energy.toFixed(2)} · fit ${org.fitness.toFixed(3)} · (${org.x},${org.y})`;
    if (reason === "refresh") return;
    const decoded = decodeGenome(org.genome);
    const track = toGenomeTrack(decoded);
    gEl.textContent = org.genome;
    pEl.innerHTML = phenotypeTableHtml(org.ph);
    genesEl.innerHTML = genesHtml(track);
    syncGenomeEditor(ta, org.genome, reason);
    browser.setSequence(org.genome);
  }

  function layout(): void {
    const r = viz.getBoundingClientRect();
    renderer.resize(r.width, r.height);
    const br = gbCanvas.parentElement!.getBoundingClientRect();
    browser.resize(br.width, 108);
    const cr = charts.getBoundingClientRect();
    const cw = cr.width / 3;
    const ch = cr.height;
    drawFitness(cFit, cw, ch, current().history);
    drawShannon(cShan, cw, ch, current().history);
    drawPhylogeny(cPhy, cw, ch, current().lineages.values(), current().tick);
  }

  function refreshMetrics(): void {
    const w = current();
    const last = w.history[w.history.length - 1];
    const set = (id: string, v: string) => {
      const n = document.getElementById(id);
      if (n) n.textContent = v;
    };
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
      if (org) selectOrganism(w, org.id, "refresh");
    }
    const now = performance.now();
    if (now - state.lastUi > 250) {
      const cr = charts.getBoundingClientRect();
      const hist = w.history.length > 400 ? w.history.filter((_, i) => i % 4 === 0 || i > w.history.length - 80) : w.history;
      drawFitness(cFit, cr.width / 3, cr.height, hist);
      drawShannon(cShan, cr.width / 3, cr.height, hist);
      drawPhylogeny(cPhy, cr.width / 3, cr.height, w.lineages.values(), w.tick);
      state.lastUi = now;
    }
    const gl = renderer.gl;
    window.__openavida = {
      tick: w.tick,
      population: w.organisms.length,
      selectedGenome: (document.getElementById("inspect-genome") as HTMLElement).textContent ?? "",
      selectedPhenotype: (document.getElementById("inspect-phenotype") as HTMLElement).textContent ?? "",
      editorValue: (document.getElementById("genome-edit") as HTMLTextAreaElement | null)?.value ?? "",
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      drawingBufferWidth: gl.drawingBufferWidth,
      drawingBufferHeight: gl.drawingBufferHeight,
      lastStepMs: w.lastStepMs,
      seed: w.params.seed,
      world: state.view === "B" ? "B" : "A",
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
    const sidePick = renderer.pickWorld(ev.clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(ev.clientX, ev.clientY, world);
    if (grid) paintTerrain(world, grid.x, grid.y, state.radius, state.brush);
  }

  function onPointer(ev: PointerEvent, down: boolean): void {
    const sidePick = renderer.pickWorld(ev.clientX);
    const world = sidePick === "B" ? dual.b : dual.a;
    const grid = renderer.canvasToGrid(ev.clientX, ev.clientY, world);
    if (!grid) return;
    const paint = state.tool === "paint" || state.paintMode || ev.shiftKey || ev.altKey || ev.buttons === 2;
    if (paint) {
      state.painting = true;
      paintTerrain(world, grid.x, grid.y, state.radius, state.brush);
      return;
    }
    if (!down) return;
    if (state.tool === "place") {
      const seq = (side.querySelector("#genome-edit") as HTMLTextAreaElement).value || genomeForKit(state.kit);
      const child = placeOrganismAt(world, grid.x, grid.y, seq);
      if (child) {
        dual.active = sidePick;
        selectOrganism(world, child.id, "select");
        status(`placed ${kitById(state.kit).label} at (${grid.x},${grid.y})`);
        refreshMetrics();
      } else {
        const occ = world.organismAt(grid.x, grid.y);
        if (occ) {
          dual.active = sidePick;
          selectOrganism(world, occ.id);
          refreshMetrics();
        } else status("cell blocked");
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
    if (ev.buttons === 0) return;
    if (state.painting || state.paintMode || ev.shiftKey) paintAt(ev);
  });
  canvas.addEventListener("pointerup", () => {
    state.painting = false;
  });
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  side.querySelector("#brushes")!.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const id = t.getAttribute("data-brush") as BrushKind | null;
    if (!id) return;
    state.brush = id;
    side.querySelectorAll("[data-brush]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-brush") === id));
  });
  (side.querySelector("#radius") as HTMLInputElement).addEventListener("input", (ev) => {
    state.radius = Number((ev.target as HTMLInputElement).value);
    (side.querySelector("#rad-lab") as HTMLElement).textContent = String(state.radius);
  });
  const speedTop = header.querySelector("#speed-top") as HTMLInputElement;
  const speedSide = side.querySelector("#speed") as HTMLInputElement;
  const setSpeed = (n: number, from?: "top" | "side") => {
    const v = Math.max(0, Math.min(60, n));
    state.speed = v;
    if (v > 0) state.paused = false;
    else state.paused = true;
    const label = formatSpeed(v);
    (header.querySelector("#spd-lab-top") as HTMLElement).textContent = label;
    (side.querySelector("#spd-lab") as HTMLElement).textContent = label;
    if (from !== "top") speedTop.value = String(v);
    if (from !== "side") speedSide.value = String(v);
    (side.querySelector("#btn-pause") as HTMLElement).textContent = state.paused ? "run" : "pause";
  };
  speedTop.addEventListener("input", () => setSpeed(Number(speedTop.value), "top"));
  speedSide.addEventListener("input", () => setSpeed(Number(speedSide.value), "side"));
  const zoomTop = header.querySelector("#zoom-top") as HTMLInputElement;
  zoomTop.addEventListener("input", () => {
    const pct = Math.max(30, Math.min(100, Number(zoomTop.value)));
    renderer.zoom = pct / 100;
    (header.querySelector("#zoom-lab-top") as HTMLElement).textContent = `${pct}%`;
  });
  side.querySelector("#btn-pause")!.addEventListener("click", () => {
    if (state.paused || state.speed <= 0) {
      if (state.speed <= 0) setSpeed(2, "top");
      else {
        state.paused = false;
        (side.querySelector("#btn-pause") as HTMLElement).textContent = "pause";
      }
    } else {
      state.paused = true;
      (side.querySelector("#btn-pause") as HTMLElement).textContent = "run";
    }
  });
  const terrainBox = side.querySelector("#opt-terrain input") as HTMLInputElement;
  const disturbBox = side.querySelector("#opt-disturb input") as HTMLInputElement;
  terrainBox.checked = dual.a.randomTerrain;
  disturbBox.checked = dual.a.disturbances;
  terrainBox.addEventListener("change", () => {
    if (terrainBox.checked) {
      dual.a.seedRandomTerrain();
      dual.b.seedRandomTerrain();
      status("random vents & walls on");
    } else {
      dual.a.clearPresetTerrain();
      dual.b.clearPresetTerrain();
      status("cleared preset terrain — paint your own");
    }
  });
  disturbBox.addEventListener("change", () => {
    dual.a.disturbances = disturbBox.checked;
    dual.b.disturbances = disturbBox.checked;
    status(disturbBox.checked ? "random events on" : "random events off");
  });
  side.querySelector("#btn-slow")!.addEventListener("click", () => setSpeed(2));
  side.querySelector("#btn-step-once")!.addEventListener("click", () => {
    state.paused = true;
    (side.querySelector("#btn-pause") as HTMLElement).textContent = "run";
    if (state.view === "split") dual.step("both");
    else if (state.view === "B") dual.b.step();
    else dual.a.step();
    refreshMetrics();
  });
  side.querySelectorAll(".view").forEach((b) => {
    b.addEventListener("click", () => {
      state.view = ((b as HTMLElement).dataset.view ?? "A") as ViewMode;
      renderer.view = state.view;
      dual.active = state.view === "B" ? "B" : "A";
      side.querySelectorAll(".view").forEach((x) => x.classList.toggle("active", x === b));
      refreshMetrics();
    });
  });
  side.querySelectorAll(".fm").forEach((b) => {
    b.addEventListener("click", () => {
      renderer.fieldMode = Number((b as HTMLElement).dataset.fm) as FieldMode;
      side.querySelectorAll(".fm").forEach((x) => x.classList.toggle("active", x === b));
    });
  });
  side.querySelector("#btn-step-a")!.addEventListener("click", () => {
    dual.a.step();
    refreshMetrics();
  });
  side.querySelector("#btn-step-b")!.addEventListener("click", () => {
    dual.b.step();
    refreshMetrics();
  });
  side.querySelector("#btn-step-both")!.addEventListener("click", () => {
    dual.step("both");
    refreshMetrics();
  });
  side.querySelector("#btn-snap")!.addEventListener("click", () => {
    state.snapshot = takeSnapshot(current());
    status(`snapshot t=${current().tick} N=${current().organisms.length}`);
  });
  side.querySelector("#btn-restore")!.addEventListener("click", () => {
    if (!state.snapshot) {
      status("no snapshot");
      return;
    }
    restoreSnapshot(current(), state.snapshot);
    status(`restored t=${current().tick}`);
    refreshMetrics();
  });
  side.querySelector("#btn-bottle")!.addEventListener("click", () => {
    const n = applyBottleneck(current(), 0.1);
    status(`bottleneck → N=${n}`);
    refreshMetrics();
  });
  side.querySelector("#btn-reseed")!.addEventListener("click", () => {
    const seed = Number((side.querySelector("#seed") as HTMLInputElement).value) >>> 0 || 1;
    const p: Partial<SimParams> = { ...current().params, seed };
    dual.a = new World(p);
    dual.b = new World({ ...p, seed: (seed ^ 0x9e3779b9) >>> 0 || 1 });
    state.selectedId = -1;
    status(`reseeded ${seed}`);
    refreshMetrics();
  });
  side.querySelector("#btn-share")!.addEventListener("click", async () => {
    const url = buildShareURL(current().params);
    try {
      await navigator.clipboard.writeText(url);
      status("URL copied");
    } catch {
      status(url);
    }
    history.replaceState(null, "", "?" + url.split("?")[1]);
  });
  side.querySelector("#btn-json")!.addEventListener("click", () => {
    download(`openavida-t${current().tick}.json`, exportJSON(current()), "application/json");
  });
  side.querySelector("#btn-csv")!.addEventListener("click", () => {
    download(`openavida-metrics-t${current().tick}.csv`, exportMetricsCSV(current().history), "text/csv");
  });
  side.querySelector("#btn-phylo")!.addEventListener("click", () => {
    download(`openavida-phylo-t${current().tick}.csv`, exportPhylogenyCSV(current()), "text/csv");
  });
  side.querySelector("#btn-import")!.addEventListener("click", () => {
    (side.querySelector("#import-file") as HTMLInputElement).click();
  });
  (side.querySelector("#import-file") as HTMLInputElement).addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    restoreSnapshot(current(), parseJSONSnapshot(text));
    status("imported JSON");
    refreshMetrics();
  });

  const ta = () => side.querySelector("#genome-edit") as HTMLTextAreaElement;
  const mutRng = new Rng(0x51ed);
  side.querySelector("#btn-point")!.addEventListener("click", () => {
    ta().value = pointMutate(ta().value || founderHeterotroph(), mutRng);
  });
  side.querySelector("#btn-indel")!.addEventListener("click", () => {
    ta().value = indelMutate(ta().value || founderHeterotroph(), mutRng);
  });
  side.querySelector("#btn-dup")!.addEventListener("click", () => {
    ta().value = duplicateMutate(ta().value || founderHeterotroph(), mutRng).seq;
  });
  side.querySelector("#btn-apply")!.addEventListener("click", () => {
    const seq = ta().value;
    if (state.selectedId < 0) {
      status("select an organism first");
      return;
    }
    current().replaceGenome(state.selectedId, seq);
    selectOrganism(current(), state.selectedId, "apply");
    status("genome applied (new lineage)");
  });
  side.querySelector("#btn-load-founder")!.addEventListener("click", () => {
    const key = (side.querySelector("#founder") as HTMLSelectElement).value;
    ta().value = genomeForKit(key);
  });
  side.querySelector("#btn-inject")!.addEventListener("click", () => {
    const seq = ta().value || founderHeterotroph();
    const n = injectStrain(current(), seq, 24);
    status(`injected ${n}`);
    refreshMetrics();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    if (ev.code === "Space") {
      ev.preventDefault();
      (side.querySelector("#btn-pause") as HTMLElement).click();
    }
    if (ev.key === "[") setSpeed(Math.max(0, state.speed - 1));
    if (ev.key === "]") setSpeed(Math.min(60, state.speed + 1));
    if (ev.key === "s") {
      state.snapshot = takeSnapshot(current());
      status("snapshot");
    }
    if (ev.key === "1") renderer.fieldMode = 0;
    if (ev.key === "2") renderer.fieldMode = 1;
    if (ev.key === "3") renderer.fieldMode = 2;
    if (ev.key === "4") renderer.fieldMode = 3;
    if (ev.key === "5") renderer.fieldMode = 4;
  });

  window.addEventListener("resize", layout);

  hud.querySelector("#tool-inspect")!.addEventListener("click", () => setTool("inspect"));
  hud.querySelector("#tool-paint")!.addEventListener("click", () => setTool("paint"));
  hud.querySelector("#tool-place")!.addEventListener("click", () => setTool("place"));

  window.__openavidaPlaceAt = (x: number, y: number) => {
    const w = current();
    const seq = (side.querySelector("#genome-edit") as HTMLTextAreaElement).value || genomeForKit(state.kit);
    const child = placeOrganismAt(w, x, y, seq);
    if (!child) return false;
    selectOrganism(w, child.id, "select");
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
    if (!state.paused && state.speed > 0) {
      const due = ticksDue(tickAccum, dt, state.speed, 3);
      tickAccum = due.accumMs;
      let used = 0;
      for (let i = 0; i < due.ticks && used < 10; i++) {
        const t0 = performance.now();
        if (state.view === "split") dual.step("both");
        else if (state.view === "B") dual.b.step();
        else dual.a.step();
        used += performance.now() - t0;
      }
    } else {
      tickAccum = 0;
    }
    renderer.draw(dual.a, dual.b, now / 1000);
    refreshMetrics();
    requestAnimationFrame(loop);
  };

  const tip = el("div", { id: "hover-tip" });
  tip.hidden = true;
  document.body.append(tip);
  attachControlHelp(root, tip);
  window.__openavidaHelp = CONTROL_HELP;

  layout();
  browser.clear();
  showKit(state.kit);
  setTool("place");
  requestAnimationFrame(loop);
}
