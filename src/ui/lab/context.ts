/**
 * Shared contract of the lab UI modules. mount() builds one mutable state
 * object, the services it creates and the callbacks a module has to reach in
 * another one, then hands the whole thing to each module as a LabContext, so a
 * moved function still closes over exactly what it did inside app.ts. Fields
 * are filled in as mount() creates each service, which lets a constructor
 * callback close over the context before its neighbours exist. Modules import
 * only this file, never app.ts, so the split stays acyclic.
 */
import type { GenomeBrowser } from "../../render/genomeBrowser";
import type { FieldMode, LabRenderer, ViewMode } from "../../render/webgl";
import type { View3D } from "../../render/view3d";
import type {
  BrushKind,
  DualWorld,
  FeatureFlags,
  RoomOp,
  RoomSession,
  Side,
  SimHost,
  StepSide,
  World,
  WorldSnapshot,
} from "../../sim/index";
import type { DnaEditor } from "../dnaEditor";
import type { EditorSyncReason } from "../editorSync";
import type { Explorer } from "../explorer";
import type { GoalPanel } from "../goalPanel";
import type { ModelPanel } from "../modelPanel";
import type { LabTool } from "../pointer";
import type { SpeciesPanel } from "../speciesPanel";

/** Side-panel tabs, in tab order. */
export type Panel = "organisms" | "environment" | "analysis" | "species" | "experiment";

/** Mutable UI state mount() owns; modules write here instead of private fields. */
export interface LabState {
  /** Active plate view; "split" shows A and B side by side. */
  view: ViewMode;
  /** True while the clock is held, whatever the speed says. */
  paused: boolean;
  /** Simulation steps per second; 0 means paused. */
  speed: number;
  /** Brush the environment controls selected. */
  brush: BrushKind;
  /** Paint radius in cells. */
  radius: number;
  /** True between pointerdown and pointerup while painting. */
  painting: boolean;
  /** True when the active tool paints without shift. */
  paintMode: boolean;
  /** Active plate tool. */
  tool: LabTool;
  /** Starter kit loaded in the DNA editor. */
  kit: string;
  /** Selected organism id, -1 when none. */
  selectedId: number;
  /**
   * Text of #inspect-pathways as last written by the feeds. The window probe
   * reports it, and the pathway markup only moves on selection, so the app
   * refreshes this on the UI cadence instead of reading the DOM every frame.
   */
  pathwaysText: string;
  /** Snapshot saved by the snapshot button. */
  snapshot: WorldSnapshot | null;
  /** performance.now() of the last throttled UI refresh. */
  lastUi: number;
  /** Feature flags from the query string, mirrored by the experimental toggles. */
  flags: FeatureFlags;
  /** 2D plate or 3D continuum. */
  surface: "2d" | "3d";
  /** Active room, null when multiplayer is off. */
  room: RoomSession | null;
  /** Broadcast function of the room channel, null when multiplayer is off. */
  roomPost: ((op: RoomOp) => void) | null;
  /** Teardown function of the room channel, null when multiplayer is off. */
  roomClose: (() => void) | null;
  /** Timeline preview shown in place of the live world, null when live. */
  preview: World | null;
  /** Tick of the preview, null when live. */
  previewTick: number | null;
}

/** Everything a moved module needs from mount(): state, services, plate elements and shared callbacks. */
export interface LabContext {
  /** Application root the shell was rendered into. */
  root: HTMLElement;
  /** Mutable UI state, shared by every module. */
  state: LabState;
  /** The two worlds the host drives. */
  dual: DualWorld;
  /** Where the simulation runs; modules send ops and steps through it. */
  host: SimHost;
  /** World the controls act on: B when B is selected, the active one in split. */
  current(): World;
  /** World currently shown, timeline preview included. */
  viewWorld(): World;
  /** Side letter of a world instance. */
  sideOf(world: World): Side;
  /** Which side a step applies to for the active view. */
  stepWhich(): StepSide;
  /** Write the status line. */
  status(msg: string): void;
  /** Emit a room op, with the host's snapshot rule. */
  emitOp(op: RoomOp): void;
  /** Broadcast this peer's plate cursor. */
  emitCursor(x: number, y: number): void;
  /** 2D plate renderer. */
  renderer: LabRenderer;
  /** The 3D view once it exists, without creating it. */
  view3d(): View3D | null;
  /** Lazily create the 3D view. */
  ensure3d(): View3D;
  /** Recompute the plate and side-panel sizes. */
  layout(): void;
  /** Refresh metrics, charts, feeds and the window probe. */
  refreshMetrics(): void;
  /** Redraw the fitness, diversity and phylogeny charts. */
  drawCharts(): void;
  /** DNA editor of the organisms panel. */
  dna: DnaEditor;
  /** Experiment panel, which also owns the preset store. */
  goals: GoalPanel;
  /** Species panel. */
  species: SpeciesPanel;
  /** Organism explorer dialog. */
  explorer: Explorer;
  /** Parameter form, null until the environment panel built it. */
  model: ModelPanel | null;
  /** Genome browser canvas of the inspect panel. */
  browser: GenomeBrowser;
  /** 2D canvas of the plate. */
  canvas: HTMLCanvasElement;
  /** 3D canvas of the continuum view. */
  canvas3d: HTMLCanvasElement;
  /** Plate container the renderer sizes itself from. */
  viz: HTMLDivElement;
  /** Stage that holds the plate and its labels. */
  stage: HTMLDivElement;
  /** Tool HUD over the plate. */
  hud: HTMLDivElement;
  /** Layer that paints the multiplayer cursors. */
  cursors: HTMLDivElement;
  /** Side panel, watched for the tab-panel toggle event. */
  side: HTMLElement;
  /** Open a side-panel tab, optionally focusing its button. */
  openPanel(panel: Panel, focus?: boolean): void;
  /** Open the side panel a toolbar action belongs to. */
  openTab(panel: Panel): void;
  /** Select a plate tool and open its panel. */
  setTool(tool: LabTool): void;
  /** Switch the plate view between A, B and split. */
  setView(view: ViewMode): void;
  /** Select a field layer of the 2D plate. */
  setField(mode: FieldMode): void;
  /** Switch between the 2D plate and the 3D continuum. */
  setSurface(which: "2d" | "3d"): void;
  /** Set the clock speed and refresh the playback chrome. */
  setSpeed(n: number): void;
  /** Refresh the pause button and the run-state label. */
  updatePlayback(): void;
  /** Collapse or restore the chart section. */
  setChartsCollapsed(collapsed: boolean): void;
  /** Repaint the leaderboard, events, deaths and inspect panel. */
  paintFeeds(): void;
  /** Select an organism and fill the inspect panel. */
  selectOrganism(world: World, id: number, reason?: EditorSyncReason): void;
  /** Load a genome into the DNA editor from a feed row or the inspect panel. */
  loadSeqIntoBuilder(seq: string): void;
  /** Name and record the strain of a genome about to be placed or injected. */
  tagStrain(world: World, seq: string): void;
  /** Show the timeline entry nearest to a tick, paused. */
  previewTick(tick: number): Promise<void>;
  /** Refresh the timeline range, marks, label and budget. */
  refreshTimeline(): void;
  /** Refresh the programmed-change list. */
  refreshScheduleList(): void;
  /** Paint the multiplayer peer list and cursors. */
  paintPeers(): void;
  /** Turn the neural brains on or off. */
  setBrains(on: boolean): void;
  /** Open the multiplayer room, as host or peer. */
  joinRoom(asHost: boolean): void;
}

/** Build a lab control element; the modules that create rows and cursors share it. */
export function el<K extends keyof HTMLElementTagNameMap>(
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
