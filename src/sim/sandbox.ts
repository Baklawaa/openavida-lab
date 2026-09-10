import {
  buildShareURL,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  paramsFromQuery,
  paramsToQuery,
  parseCSV,
  parseJSONSnapshot,
  parseShareURL,
  provenanceOf,
  type ExportProvenance,
} from "./serialize";
import { Timeline } from "./timeline";
import type { BrushKind, SimParams, WorldSnapshot } from "./types";
import { World, worldFromSnapshot } from "./world";

export type DualSide = "A" | "B" | "both";

/**
 * Sandbox operators over a World. Tests import these functions — they are
 * the shipped API for paint, inject, bottleneck, snapshots, A/B, export.
 */
export function paintTerrain(
  world: World,
  x: number,
  y: number,
  radius: number,
  brush: BrushKind,
  amount?: number,
): void {
  world.paint(x, y, radius, brush, amount);
}

export function injectStrain(
  world: World,
  genome: string,
  count: number,
  x?: number,
  y?: number,
): number {
  return world.injectStrain(genome, count, x, y);
}

/** Place a single organism on a chosen cell. Returns null if the cell is blocked. */
export function placeOrganismAt(
  world: World,
  x: number,
  y: number,
  genome: string,
  energy = 0.9,
): ReturnType<World["birth"]> {
  return world.birth(x, y, genome, null, false, energy);
}

export function applyBottleneck(world: World, keepFraction: number): number {
  return world.bottleneck(keepFraction);
}

export function takeSnapshot(world: World): WorldSnapshot {
  return world.snapshot();
}

export function restoreSnapshot(world: World, snap: WorldSnapshot): void {
  world.restore(snap);
}

export function snapshotEquals(a: WorldSnapshot, b: WorldSnapshot): boolean {
  const wa = worldFromSnapshot(a);
  const wb = worldFromSnapshot(b);
  return wa.hashState() === wb.hashState();
}

export class DualWorld {
  a: World;
  b: World;
  active: "A" | "B" = "A";
  timelineA = new Timeline();
  timelineB = new Timeline();

  constructor(params: Partial<SimParams> = {}, salt = 0x9e3779b9) {
    this.a = new World(params);
    const seedB = ((params.seed ?? this.a.params.seed) ^ salt) >>> 0 || 1;
    this.b = new World({ ...this.a.params, seed: seedB });
    this.timelineA.record(this.a);
    this.timelineB.record(this.b);
    this.a.timelineMeta = this.timelineA.meta();
    this.b.timelineMeta = this.timelineB.meta();
  }

  current(): World {
    return this.active === "A" ? this.a : this.b;
  }

  step(which: DualSide = "both"): void {
    if (which === "A" || which === "both") this.a.step();
    if (which === "B" || which === "both") this.b.step();
  }

  hashes(): { a: string; b: string } {
    return { a: this.a.hashState(), b: this.b.hashState() };
  }
}

export {
  buildShareURL,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  paramsFromQuery,
  paramsToQuery,
  parseCSV,
  parseJSONSnapshot,
  parseShareURL,
  provenanceOf,
  worldFromSnapshot,
  type ExportProvenance,
};
