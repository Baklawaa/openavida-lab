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
  founderHeterotroph,
  founderMutualist,
  founderPhototroph,
  founderPredator,
  founderResistant,
  indelMutate,
  injectStrain,
  mappingLegend,
  paintTerrain,
  parseJSONSnapshot,
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

const FOUNDERS: Record<string, () => string> = {
  phototroph: founderPhototroph,
  heterotroph: founderHeterotroph,
  resistant: founderResistant,
  predator: founderPredator,
  mutualist: () => founderMutualist(2),
};

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
    speed: 1,
    brush: "nutrientBlob" as BrushKind,
    radius: 3,
    painting: false,
    paintMode: false,
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
    <div class="spacer"></div>
    <div class="clock" id="m-seed"></div>
  `;
  const viz = el("div", { class: "viz" });
  const canvas = el("canvas", { id: "gl" });
  const hud = el("div", { class: "viz-hud" });
  hud.innerHTML = `<button type="button" id="paint-toggle">inspect (shift-drag paints)</button>`;
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
      <h2>Inspect</h2>
      <div id="inspect-meta" class="muted">Click an organism on the plate.</div>
      <div id="inspect-genome"></div>
      <div id="inspect-phenotype"></div>
      <div id="inspect-genes"></div>
    </section>
    <section class="block">
      <h2>Genome browser</h2>
      <div id="browser-wrap"><canvas id="gbrowser"></canvas></div>
    </section>
    <section class="block">
      <h2>Edit / inject</h2>
      <div class="stack">
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
    </section>
    <section class="block">
      <h2>Sandbox</h2>
      <div class="row" id="brushes"></div>
      <label class="tiny">brush radius <span id="rad-lab">3</span></label>
      <input id="radius" type="range" min="0" max="12" value="3" />
      <div class="row" style="margin-top:8px">
        <button type="button" id="btn-pause">pause</button>
        <button type="button" data-spd="1" class="spd active">1×</button>
        <button type="button" data-spd="2" class="spd">2×</button>
        <button type="button" data-spd="4" class="spd">4×</button>
        <button type="button" data-spd="8" class="spd">8×</button>
      </div>
      <div class="row">
        <button type="button" data-view="A" class="view active">world A</button>
        <button type="button" data-view="B" class="view">world B</button>
        <button type="button" data-view="split" class="view">A | B</button>
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
        <button type="button" data-fm="0" class="fm active">composite</button>
        <button type="button" data-fm="1" class="fm">nutrient</button>
        <button type="button" data-fm="2" class="fm">toxin</button>
        <button type="button" data-fm="3" class="fm">temp</button>
        <button type="button" data-fm="4" class="fm">light</button>
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
    const btn = el("button", { type: "button", "data-brush": b.id }, b.label);
    if (b.id === state.brush) btn.classList.add("active");
    brushRow.append(btn);
  }
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

  function selectOrganism(world: World, id: number): void {
    state.selectedId = id;
    renderer.selectedId = id;
    const org = world.organisms.find((o) => o.id === id) ?? null;
    const meta = side.querySelector("#inspect-meta")!;
    const gEl = side.querySelector("#inspect-genome")!;
    const pEl = side.querySelector("#inspect-phenotype")!;
    const genesEl = side.querySelector("#inspect-genes")!;
    const ta = side.querySelector("#genome-edit") as HTMLTextAreaElement;
    if (!org) {
      meta.textContent = "Click an organism on the plate.";
      gEl.textContent = "";
      pEl.innerHTML = "";
      genesEl.innerHTML = "";
      browser.clear();
      return;
    }
    const decoded = decodeGenome(org.genome);
    const track = toGenomeTrack(decoded);
    meta.innerHTML = `id ${org.id} · lin ${org.lineageId} · parent ${org.parentId} · E ${org.energy.toFixed(2)} · fit ${org.fitness.toFixed(3)} · (${org.x},${org.y})`;
    gEl.textContent = org.genome;
    pEl.innerHTML = phenotypeTableHtml(org.ph);
    genesEl.innerHTML = genesHtml(track);
    ta.value = org.genome;
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
      if (org) selectOrganism(w, org.id);
    }
    const now = performance.now();
    if (now - state.lastUi > 120) {
      const cr = charts.getBoundingClientRect();
      drawFitness(cFit, cr.width / 3, cr.height, w.history);
      drawShannon(cShan, cr.width / 3, cr.height, w.history);
      drawPhylogeny(cPhy, cr.width / 3, cr.height, w.lineages.values(), w.tick);
      state.lastUi = now;
    }
    const gl = renderer.gl;
    window.__openavida = {
      tick: w.tick,
      population: w.organisms.length,
      selectedGenome: (document.getElementById("inspect-genome") as HTMLElement).textContent ?? "",
      selectedPhenotype: (document.getElementById("inspect-phenotype") as HTMLElement).textContent ?? "",
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
    const paint = state.paintMode || ev.shiftKey || ev.altKey || ev.buttons === 2;
    if (paint) {
      state.painting = true;
      paintTerrain(world, grid.x, grid.y, state.radius, state.brush);
      return;
    }
    if (down) {
      const org = world.nearestOrganism(grid.x, grid.y, 4);
      if (org) {
        dual.active = sidePick;
        selectOrganism(world, org.id);
        refreshMetrics();
      }
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
  side.querySelector("#btn-pause")!.addEventListener("click", () => {
    state.paused = !state.paused;
    (side.querySelector("#btn-pause") as HTMLElement).textContent = state.paused ? "run" : "pause";
  });
  side.querySelectorAll(".spd").forEach((b) => {
    b.addEventListener("click", () => {
      state.speed = Number((b as HTMLElement).dataset.spd);
      side.querySelectorAll(".spd").forEach((x) => x.classList.toggle("active", x === b));
    });
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
    selectOrganism(current(), state.selectedId);
    status("genome applied (new lineage)");
  });
  side.querySelector("#btn-load-founder")!.addEventListener("click", () => {
    const key = (side.querySelector("#founder") as HTMLSelectElement).value;
    ta().value = (FOUNDERS[key] ?? founderHeterotroph)();
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
      state.paused = !state.paused;
      (side.querySelector("#btn-pause") as HTMLElement).textContent = state.paused ? "run" : "pause";
    }
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

  hud.querySelector("#paint-toggle")!.addEventListener("click", () => {
    state.paintMode = !state.paintMode;
    const b = hud.querySelector("#paint-toggle") as HTMLButtonElement;
    b.textContent = state.paintMode ? "paint mode" : "inspect (shift-drag paints)";
    b.classList.toggle("active", state.paintMode);
  });

  window.__openavidaOrgPixel = (index = 0) => {
    const w = current();
    const o =
      w.organisms[index] ??
      w.organisms.find((org) => org.x > w.w * 0.25 && org.y > w.h * 0.25) ??
      w.organisms[0];
    if (!o) return null;
    const rect = canvas.getBoundingClientRect();
    const u = (o.x + 0.5) / w.w;
    const v = (o.y + 0.5) / w.h;
    return { x: rect.left + u * rect.width, y: rect.top + v * rect.height, id: o.id };
  };

  const loop = (now: number) => {
    if (!state.paused) {
      const budget = 14;
      let used = 0;
      const n = state.speed;
      for (let i = 0; i < n && used < budget; i++) {
        const t0 = performance.now();
        if (state.view === "split") dual.step("both");
        else if (state.view === "B") dual.b.step();
        else dual.a.step();
        used += performance.now() - t0;
      }
    }
    renderer.draw(dual.a, dual.b, now / 1000);
    refreshMetrics();
    requestAnimationFrame(loop);
  };

  layout();
  browser.clear();
  ta().value = founderHeterotroph();
  requestAnimationFrame(loop);
}
