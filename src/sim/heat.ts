/**
 * Per-strain occupancy heat: exponential decay, no RNG.
 * Not stored in snapshots; rebuilt by stepping after restore.
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

  constructor(width: number, height: number, decay = HEAT_DECAY) {
    this.width = width;
    this.height = height;
    this.decay = decay;
  }

  step(world: World): void {
    const n = this.width * this.height;
    const touched = new Set<number>();
    for (const o of world.organisms) {
      let m = this.maps.get(o.strainId);
      if (!m || m.length !== n) {
        m = new Float32Array(n);
        this.maps.set(o.strainId, m);
      }
      if (!touched.has(o.strainId)) {
        for (let i = 0; i < n; i++) m[i] *= this.decay;
        touched.add(o.strainId);
      }
      const i = o.y * this.width + o.x;
      if (i >= 0 && i < n) m[i] += 1;
    }
  }

  normalized(strainId: number): Float32Array | null {
    const m = this.maps.get(strainId);
    if (!m) return null;
    let max = 0;
    for (let i = 0; i < m.length; i++) if (m[i]! > max) max = m[i]!;
    const out = new Float32Array(m.length);
    if (max <= 0) return out;
    const inv = 1 / max;
    for (let i = 0; i < m.length; i++) out[i] = m[i]! * inv;
    return out;
  }
}

export function pushTrail(org: { x: number; y: number; trail?: Array<[number, number]> }, max = TRAIL_LENGTH): void {
  const trail = org.trail ?? (org.trail = []);
  const last = trail[trail.length - 1];
  if (!last || last[0] !== org.x || last[1] !== org.y) trail.push([org.x, org.y]);
  if (trail.length > max) trail.splice(0, trail.length - max);
}
