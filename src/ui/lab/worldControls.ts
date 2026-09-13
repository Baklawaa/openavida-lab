/**
 * The world toolbar and its keyboard: the A/B/split view switch, the 2D/3D
 * surface, the field-layer buttons, the paint brushes, the environment toggles,
 * the playback speed and zoom, the snapshot/bottleneck/reseed actions, the chart
 * collapse button, the focus mode, the side-panel tabs and the global key
 * handler. Every function here reads and writes the shared state through the
 * LabContext, so the toolbar keeps working when the app only wires it.
 */
import { canDriveClock, takeSnapshot, type BrushKind, type SimParams } from "../../sim/index";
import type { FieldMode, ViewMode } from "../../render/webgl";
import { tDynamic } from "../i18n/runtime";
import { icon } from "../layout";
import { BRUSH_LABEL, BRUSH_ORDER } from "../labels";
import { formatSpeed } from "../speed";
import { el, type LabContext, type Panel } from "./context";

/** Brushes in palette order, with the label the catalogue gives them. */
const BRUSHES: { id: BrushKind; label: string }[] = BRUSH_ORDER.map((id) => ({
  id,
  label: BRUSH_LABEL[id],
}));

/** Side-panel tabs, in tab order. */
const PANELS: readonly Panel[] = ["organisms", "environment", "analysis", "species", "experiment"];

/** What the world toolbar hands back to the app for the context. */
export interface WorldControls {
  openPanel(panel: Panel, focus?: boolean): void;
  openTab(panel: Panel): void;
  setView(view: ViewMode): void;
  setField(mode: FieldMode): void;
  setSurface(which: "2d" | "3d"): void;
  setSpeed(n: number): void;
  updatePlayback(): void;
  setChartsCollapsed(collapsed: boolean): void;
}

export function createWorldControls(ctx: LabContext): WorldControls {
  const { root, state, dual, host, renderer } = ctx;

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
    requestAnimationFrame(ctx.layout);
  }

  function openTab(panel: Panel): void {
    if (panel === "experiment" || panel === "species") openPanel(panel);
    else ctx.setTool(panel === "environment" ? "paint" : panel === "analysis" ? "inspect" : "place");
  }

  function setSurface(which: "2d" | "3d"): void {
    state.surface = which;
    state.flags.view3d = which === "3d";
    ctx.canvas.classList.toggle("off", which === "3d");
    ctx.canvas3d.classList.toggle("on", which === "3d");
    root.querySelector("#view-2d")!.classList.toggle("active", which === "2d");
    root.querySelector("#view-3d")!.classList.toggle("active", which === "3d");
    root.querySelector("#view-2d")!.setAttribute("aria-pressed", String(which === "2d"));
    root.querySelector("#view-3d")!.setAttribute("aria-pressed", String(which === "3d"));
    (root.querySelector("#zoom-top") as HTMLInputElement).disabled = which === "3d";
    root.querySelector("#view-hint")!.textContent = which === "3d" ? tDynamic("app.view.hint3d") : root.querySelector("#place-hint")!.textContent;
    if (which === "3d" && state.view === "split") setView(dual.active);
    (root.querySelector("#opt-view3d input") as HTMLInputElement).checked = which === "3d";
    if (which === "3d") {
      const v = ctx.ensure3d();
      const r = ctx.viz.getBoundingClientRect();
      v.resize(r.width, r.height);
    }
    ctx.layout();
  }

  function updatePlayback(): void {
    const paused = state.paused || state.speed <= 0;
    const button = root.querySelector<HTMLElement>("#btn-pause")!;
    if (button.dataset.paused !== String(paused)) {
      button.innerHTML = `${icon(paused ? "play" : "pause")}<span>${tDynamic(paused ? "btn.play" : "btn.pause")}</span>`;
      button.setAttribute("aria-label", paused ? tDynamic("app.playback.resumeAria") : tDynamic("app.playback.pauseAria"));
      button.dataset.paused = String(paused);
    }
    const label = root.querySelector("#run-state")!;
    const text = !canDriveClock(state.room) ? tDynamic("app.playback.followed") : paused ? tDynamic("app.playback.paused") : tDynamic("app.playback.running");
    if (label.textContent !== text) label.innerHTML = `<i></i>${text}`;
    label.classList.toggle("paused", paused);
  }

  function setSpeed(n: number): void {
    state.speed = Math.max(0, Math.min(60, n));
    state.paused = state.speed <= 0;
    const speedTop = root.querySelector("#speed-top") as HTMLInputElement;
    speedTop.value = String(state.speed);
    root.querySelector("#spd-lab-top")!.textContent = formatSpeed(state.speed);
    updatePlayback();
  }

  function setView(view: ViewMode): void {
    state.view = view;
    renderer.view = view;
    ctx.model?.refresh();
    dual.active = view === "B" ? "B" : "A";
    // The highlighted lineage belongs to the world we are leaving.
    renderer.highlightLineage = -1;
    state.selectedId = -1;
    ctx.selectOrganism(ctx.current(), -1);
    if (view === "split" && state.surface === "3d") setSurface("2d");
    root.querySelectorAll<HTMLElement>(".view").forEach(b => {
      const active = b.dataset.view === view;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    ctx.layout();
    ctx.refreshMetrics();
  }

  function setField(mode: FieldMode): void {
    renderer.fieldMode = mode;
    // 3D has no exudate plane of its own; layer 5 falls back to the composite there.
    const view3d = ctx.view3d();
    if (view3d) view3d.fieldMode = (mode === 5 ? 0 : mode) as FieldMode;
    root.querySelectorAll<HTMLElement>(".fm").forEach(b => {
      const active = Number(b.dataset.fm) === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    const legends = [
      tDynamic("app.legend.all"),
      tDynamic("app.legend.nutrient"),
      tDynamic("app.legend.toxin"),
      tDynamic("app.legend.temperature"),
      tDynamic("app.legend.light"),
      tDynamic("app.legend.exudate"),
    ];
    root.querySelector("#field-legend")!.innerHTML = legends[mode]!;
  }

  function setChartsCollapsed(collapsed: boolean): void {
    root.classList.toggle("charts-collapsed", collapsed);
    const chartsBtn = root.querySelector<HTMLButtonElement>("#btn-charts")!;
    chartsBtn.textContent = collapsed ? tDynamic("app.charts.show") : tDynamic("app.charts.hide");
    chartsBtn.setAttribute("aria-expanded", String(!collapsed));
    try { localStorage.setItem("openavida.charts", collapsed ? "0" : "1"); } catch { /* storage unavailable */ }
    ctx.layout();
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
    root.querySelector("#btn-focus")!.setAttribute("aria-label", focused ? tDynamic("app.focus.restore") : tDynamic("app.focus.enlarge"));
    ctx.layout();
  });
  ctx.side.addEventListener("toggle", () => requestAnimationFrame(ctx.layout), true);

  const brushRow = root.querySelector("#brushes")!;
  for (const b of BRUSHES) {
    const btn = el("button", { type: "button", id: "brush-" + b.id, "data-brush": b.id }, b.label);
    if (b.id === state.brush) btn.classList.add("active");
    brushRow.append(btn);
  }
  root.querySelector("#brushes")!.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const id = t.getAttribute("data-brush") as BrushKind | null;
    if (!id) return;
    state.brush = id;
    root.querySelectorAll("[data-brush]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-brush") === id);
      b.setAttribute("aria-pressed", String(b.getAttribute("data-brush") === id));
    });
    ctx.setTool("paint");
  });
  (root.querySelector("#radius") as HTMLInputElement).addEventListener("input", (ev) => {
    state.radius = Number((ev.target as HTMLInputElement).value);
    (root.querySelector("#rad-lab") as HTMLElement).textContent = String(state.radius);
  });
  const speedTop = root.querySelector("#speed-top") as HTMLInputElement;
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
    if (!state.paused) {
      state.preview = null;
      state.previewTick = null;
    }
    updatePlayback();
  });
  const terrainBox = root.querySelector("#opt-terrain input") as HTMLInputElement;
  const disturbBox = root.querySelector("#opt-disturb input") as HTMLInputElement;
  terrainBox.checked = dual.a.randomTerrain;
  disturbBox.checked = dual.a.disturbances;
  terrainBox.addEventListener("change", () => {
    host.apply({ kind: "terrainPreset", on: terrainBox.checked });
    ctx.status(terrainBox.checked ? tDynamic("app.terrain.on") : tDynamic("app.terrain.off"));
  });
  disturbBox.addEventListener("change", () => {
    host.apply({ kind: "disturbances", on: disturbBox.checked });
    ctx.status(disturbBox.checked ? tDynamic("app.disturb.on") : tDynamic("app.disturb.off"));
  });
  root.querySelector("#btn-slow")!.addEventListener("click", () => setSpeed(2));
  root.querySelector("#btn-step-once")!.addEventListener("click", () => {
    state.paused = true;
    state.preview = null;
    state.previewTick = null;
    updatePlayback();
    host.step(ctx.stepWhich(), 1);
    ctx.paintFeeds();
    ctx.refreshMetrics();
  });
  root.querySelectorAll<HTMLElement>(".view").forEach(b => b.addEventListener("click", () => setView(b.dataset.view as ViewMode)));
  root.querySelectorAll<HTMLElement>(".fm").forEach(b => b.addEventListener("click", () => setField(Number(b.dataset.fm) as FieldMode)));
  for (const [id, which] of [["#btn-step-a", "A"], ["#btn-step-b", "B"], ["#btn-step-both", "both"]] as const) {
    root.querySelector(id)!.addEventListener("click", () => {
      state.paused = true;
      host.step(which, 1);
      ctx.refreshMetrics();
    });
  }
  root.querySelector("#btn-snap")!.addEventListener("click", () => {
    state.snapshot = takeSnapshot(ctx.current());
    (root.querySelector("#btn-restore") as HTMLButtonElement).disabled = false;
    root.querySelector("#snapshot-info")!.textContent = tDynamic("app.snapshot.info", { world: dual.active, tick: ctx.current().tick, count: ctx.current().organisms.length });
    ctx.status(tDynamic("app.snapshot.saved"));
  });
  root.querySelector("#btn-restore")!.addEventListener("click", () => {
    if (!state.snapshot) {
      ctx.status("no snapshot");
      return;
    }
    host.apply({ kind: "restore", which: ctx.sideOf(ctx.current()), snapshot: state.snapshot });
    ctx.selectOrganism(ctx.current(), -1);
    ctx.status(tDynamic("app.snapshot.restored", { tick: ctx.current().tick }));
    ctx.refreshMetrics();
  });
  root.querySelector("#btn-bottle")!.addEventListener("click", () => {
    const n = host.apply({ kind: "bottleneck", which: ctx.sideOf(ctx.current()), keep: 0.1 }).count ?? 0;
    ctx.status(tDynamic("app.bottleneck.done", { n }));
    ctx.paintFeeds();
    ctx.refreshMetrics();
  });
  root.querySelector("#btn-reseed")!.addEventListener("click", () => {
    const seed = Number((root.querySelector("#seed") as HTMLInputElement).value) >>> 0 || 1;
    const p: SimParams = { ...ctx.current().params, seed };
    host.apply({ kind: "reseed", params: p, seedB: (seed ^ 0x9e3779b9) >>> 0 || 1 });
    renderer.highlightLineage = -1;
    state.selectedId = -1;
    ctx.selectOrganism(ctx.current(), -1);
    ctx.status(tDynamic("app.reseed.done", { seed }));
    ctx.refreshMetrics();
  });

  root.querySelector("#btn-charts")!.addEventListener("click", () => setChartsCollapsed(!root.classList.contains("charts-collapsed")));

  window.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement || (ev.target instanceof HTMLElement && (ev.target.isContentEditable || ev.target.closest("[data-own-keys]"))) || ev.metaKey || ev.ctrlKey || ev.altKey || helpDialog.open || ctx.explorer.isOpen) return;
    if (ev.code === "Space" && !(ev.target instanceof HTMLElement && ev.target.closest("button, summary, a"))) {
      ev.preventDefault();
      (root.querySelector("#btn-pause") as HTMLElement).click();
    }
    if (ev.key === "[") setSpeed(state.speed - 1);
    if (ev.key === "]") setSpeed(state.speed + 1);
    if (ev.key.toLowerCase() === "s") (root.querySelector("#btn-snap") as HTMLElement).click();
    if (ev.key.toLowerCase() === "i") ctx.setTool("inspect");
    if (ev.key.toLowerCase() === "o") ctx.setTool("place");
    if (ev.key.toLowerCase() === "p") ctx.setTool("paint");
    if (/^[1-6]$/.test(ev.key)) setField((Number(ev.key) - 1) as FieldMode);
    if (ev.key === "Escape" && root.classList.contains("focus-mode")) (root.querySelector("#btn-focus") as HTMLElement).click();
  });

  window.addEventListener("resize", ctx.layout);
  new ResizeObserver(() => ctx.layout()).observe(ctx.stage);

  ctx.hud.querySelector("#tool-inspect")!.addEventListener("click", () => ctx.setTool("inspect"));
  ctx.hud.querySelector("#tool-paint")!.addEventListener("click", () => ctx.setTool("paint"));
  ctx.hud.querySelector("#tool-place")!.addEventListener("click", () => ctx.setTool("place"));
  root.querySelector("#view-2d")!.addEventListener("click", () => setSurface("2d"));
  root.querySelector("#view-3d")!.addEventListener("click", () => setSurface("3d"));

  return { openPanel, openTab, setView, setField, setSurface, setSpeed, updatePlayback, setChartsCollapsed };
}
