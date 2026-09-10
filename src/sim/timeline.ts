/**
 * Bounded ring of world snapshots for rewind.
 *
 * Cadence is `every` steps (default 25). A byte budget (default 150 MB)
 * drops the oldest entries first but never the first snapshot. Same-tick
 * records replace in place so a placement at tick 0 updates the origin.
 */
import type { WorldSnapshot } from "./types";
import type { World } from "./world";

export const DEFAULT_TIMELINE_EVERY = 25;
export const DEFAULT_TIMELINE_BUDGET = 150 * 1024 * 1024;

export interface TimelineEntry {
  tick: number;
  population: number;
  bytes: number;
}

export interface TimelineMeta {
  every: number;
  used: number;
  budget: number;
  entries: TimelineEntry[];
}

export interface StoredInstant {
  tick: number;
  population: number;
  bytes: number;
  snapshot: WorldSnapshot;
}

/** Rough payload size: 5 float32 fields + terrain + a per-organism allowance. */
export function estimateSnapshotBytes(organismCount: number, fieldLength: number): number {
  const n = Math.max(0, organismCount | 0);
  const cells = Math.max(0, fieldLength | 0);
  const fieldBytes = cells * (4 * 6 + 1);
  const orgBytes = n * 192;
  const meta = 4096 + n * 64;
  return fieldBytes + orgBytes + meta;
}

export class Timeline {
  every: number;
  readonly budgetBytes: number;
  private readonly items: StoredInstant[] = [];

  constructor(opts: { every?: number; budgetBytes?: number } = {}) {
    this.every = Math.max(1, (opts.every ?? DEFAULT_TIMELINE_EVERY) | 0);
    this.budgetBytes = Math.max(1, opts.budgetBytes ?? DEFAULT_TIMELINE_BUDGET);
  }

  record(world: World): void {
    const last = this.items[this.items.length - 1];
    if (last && last.tick === world.tick) {
      this.write(this.items.length - 1, world);
      this.evict();
      return;
    }
    if (this.items.length > 0 && world.tick % this.every !== 0) return;
    this.items.push(this.capture(world));
    this.evict();
  }

  nearest(tick: number): StoredInstant | null {
    if (!this.items.length) return null;
    let best = this.items[0]!;
    let bestD = Math.abs(best.tick - tick);
    for (let i = 1; i < this.items.length; i++) {
      const it = this.items[i]!;
      const d = Math.abs(it.tick - tick);
      if (d < bestD || (d === bestD && it.tick < best.tick)) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }

  range(): { min: number; max: number } | null {
    if (!this.items.length) return null;
    return { min: this.items[0]!.tick, max: this.items[this.items.length - 1]!.tick };
  }

  clear(): void {
    this.items.length = 0;
  }

  trimAfter(tick: number): void {
    let n = this.items.length;
    while (n > 0 && this.items[n - 1]!.tick > tick) n--;
    this.items.length = n;
  }

  entries(): TimelineEntry[] {
    return this.items.map((it) => ({ tick: it.tick, population: it.population, bytes: it.bytes }));
  }

  usedBytes(): number {
    let s = 0;
    for (const it of this.items) s += it.bytes;
    return s;
  }

  meta(): TimelineMeta {
    return { every: this.every, used: this.usedBytes(), budget: this.budgetBytes, entries: this.entries() };
  }

  private capture(world: World): StoredInstant {
    const snapshot = world.snapshot();
    return {
      tick: world.tick,
      population: world.organisms.length,
      bytes: estimateSnapshotBytes(world.organisms.length, world.w * world.h),
      snapshot,
    };
  }

  private write(index: number, world: World): void {
    this.items[index] = this.capture(world);
  }

  private evict(): void {
    while (this.items.length > 1 && this.usedBytes() > this.budgetBytes) {
      if (this.items.length === 1) break;
      this.items.splice(1, 1);
    }
  }
}
