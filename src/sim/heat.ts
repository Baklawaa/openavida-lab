/**
 * Per-strain occupancy heat: exponential decay, no RNG.
 * Not stored in snapshots; rebuilt by stepping after restore.
 *
 * Decay is lazy: every map records the heat step it was last decayed to and
 * catches up in one `decay ** delta` pass when it is next stepped, so a map the
 * world no longer feeds is left exactly where the old eager loop left it. Reads
 * never mutate: `normalized` takes an optional output buffer, so the renderer
 * reuses one and a steady frame allocates nothing.
 */
import type { World } from "./world";

export const HEAT_STEPS = 200;
export const HEAT_DECAY = Math.exp(-1 / HEAT_STEPS);
export const TRAIL_LENGTH = 120;

export class OccupancyHeat {
  readonly width: number;
  readonly height: number;
  readonly decay: number;
  readonly maps = new Map<number, Float32Array>();
  /** Heat steps seen so far: World.step calls step() once per tick. */
  private clock = 0;
  /**
   * Heat step each map was last decayed to. Keyed by the array itself, so a map
   * replaced from outside (the worker mirror installs a frame's map) starts
   * current instead of inheriting the previous array's decay history.
   */
  private decayedAt = new WeakMap<Float32Array, number>();

  constructor(width: number, height: number, decay = HEAT_DECAY) {
    this.width = width;
    this.height = height;
    this.decay = decay;
  }

  step(world: World): void {
    const n = this.width * this.height;
    const now = ++this.clock;
    const touched = new Set<number>();
    for (const o of world.organisms) {
      let m = this.maps.get(o.strainId);
      if (!m || m.length !== n) {
        m = new Float32Array(n);
        this.maps.set(o.strainId, m);
      }
      if (!touched.has(o.strainId)) {
        touched.add(o.strainId);
        const from = this.decayedAt.get(m);
        // A map with no entry is either brand new (all zeros) or was installed
        // by a frame: both are current, so only a real gap costs a pass.
        if (from !== undefined && from < now) {
          const factor = this.decay ** (now - from);
          for (let i = 0; i < n; i++) m[i] *= factor;
        }
        this.decayedAt.set(m, now);
      }
      const i = o.y * this.width + o.x;
      if (i >= 0 && i < n) m[i] += 1;
    }
  }

  /**
   * Normalised copy of one strain's map (peak = 1), or null when the strain has
   * no map. Pass `out` to write into a caller-owned buffer (the renderer keeps
   * one); without it a fresh array is returned, which is what callers that
   * transfer the buffer to another thread — the worker frame — need.
   */
  normalized(strainId: number, out?: Float32Array): Float32Array | null {
    const m = this.maps.get(strainId);
    if (!m) return null;
    const dst = out !== undefined && out.length === m.length ? out : new Float32Array(m.length);
    let max = 0;
    for (let i = 0; i < m.length; i++) if (m[i]! > max) max = m[i]!;
    if (max <= 0) {
      if (dst !== m) dst.fill(0);
      return dst;
    }
    const inv = 1 / max;
    for (let i = 0; i < m.length; i++) dst[i] = m[i]! * inv;
    return dst;
  }
}

export function pushTrail(org: { x: number; y: number; trail?: Array<[number, number]> }, max = TRAIL_LENGTH): void {
  const trail = org.trail ?? (org.trail = []);
  const last = trail[trail.length - 1];
  if (!last || last[0] !== org.x || last[1] !== org.y) trail.push([org.x, org.y]);
  if (trail.length > max) trail.splice(0, trail.length - max);
}
