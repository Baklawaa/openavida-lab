import { describe, expect, it } from "vitest";
import { HEAT_DECAY, OccupancyHeat, World, founderHeterotroph, founderPhototroph, placeOrganismAt, pushTrail } from "../src/sim/index";

/**
 * The eager algorithm the lazy maps replaced: decay every strain a step feeds
 * once, then add its occupancy. The reference the lazy catch-up must reproduce
 * cell for cell.
 */
function eagerStep(world: World, maps: Map<number, Float32Array>, decay: number): void {
  const n = world.w * world.h;
  const touched = new Set<number>();
  for (const o of world.organisms) {
    let m = maps.get(o.strainId);
    if (!m) {
      m = new Float32Array(n);
      maps.set(o.strainId, m);
    }
    if (!touched.has(o.strainId)) {
      for (let i = 0; i < n; i++) m[i] *= decay;
      touched.add(o.strainId);
    }
    const i = o.y * world.w + o.x;
    if (i >= 0 && i < n) m[i] += 1;
  }
}

function normalizedReference(map: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < map.length; i++) if (map[i]! > max) max = map[i]!;
  const out = new Float32Array(map.length);
  if (max <= 0) return out;
  for (let i = 0; i < map.length; i++) out[i] = map[i]! / max;
  return out;
}

describe("OccupancyHeat", () => {
  it("decays empty cells and normalises the occupied peak to 1", () => {
    const heat = new OccupancyHeat(4, 4, 0.5);
    const w = new World({ width: 4, height: 4, seed: 1, startPopulation: 0 });
    placeOrganismAt(w, 1, 1, founderPhototroph());
    heat.step(w);
    const a = heat.normalized(w.organisms[0]!.strainId)!;
    expect(a[1 * 4 + 1]).toBeCloseTo(1);
    w.organisms[0]!.x = 2;
    w.organisms[0]!.y = 1;
    heat.step(w);
    const b = heat.normalized(w.organisms[0]!.strainId)!;
    expect(b[1 * 4 + 2]).toBeCloseTo(1);
    expect(b[1 * 4 + 1]).toBeCloseTo(0.5);
  });

  it("uses the shared decay constant and ignores missing strains", () => {
    expect(HEAT_DECAY).toBeGreaterThan(0.99);
    expect(HEAT_DECAY).toBeLessThan(1);
    const heat = new OccupancyHeat(2, 2);
    expect(heat.normalized(99)).toBeNull();
  });
});

describe("OccupancyHeat lazy decay", () => {
  it("matches an eager per-step decay cell by cell over the same run", () => {
    const w = new World({ width: 24, height: 24, seed: 7, startPopulation: 0 });
    w.fields.nutrient.fill(1.2);
    w.fields.light.fill(0.8);
    w.injectStrain(founderHeterotroph(), 20);
    w.injectStrain(founderPhototroph(), 14);
    for (let i = 0; i < 30; i++) w.step();
    const lazy = new OccupancyHeat(24, 24, 0.9);
    const eager = new Map<number, Float32Array>();
    for (let i = 0; i < 60; i++) {
      w.step();
      lazy.step(w);
      eagerStep(w, eager, 0.9);
    }
    expect(eager.size).toBeGreaterThan(0);
    const out = new Float32Array(24 * 24);
    for (const [id, reference] of eager) {
      const got = lazy.normalized(id, out);
      expect(got, `strain ${id}`).toBe(out);
      expect(Array.from(got!), `strain ${id}`).toEqual(Array.from(normalizedReference(reference)));
    }
  });

  it("leaves a map the step does not feed alone and reuses the caller's buffer", () => {
    const heat = new OccupancyHeat(4, 4, 0.5);
    const w = new World({ width: 4, height: 4, seed: 1, startPopulation: 0 });
    const ghost = new Float32Array(16);
    ghost[5] = 4;
    heat.maps.set(99, ghost);
    const before = Array.from(ghost);
    for (let i = 0; i < 5; i++) heat.step(w);
    expect(Array.from(ghost)).toEqual(before);
    const out = new Float32Array(16);
    const got = heat.normalized(99, out);
    expect(got).toBe(out);
    expect(out[5]).toBeCloseTo(1);
    // Reading must not decay the map either: the eager loop froze a strain the
    // world no longer fed, and the lazy clock has to agree.
    expect(Array.from(ghost)).toEqual(before);
    expect(heat.normalized(1234)).toBeNull();
    // A caller that does not pass a buffer still owns what it gets: the worker
    // frame transfers that array to the main thread.
    const fresh = heat.normalized(99);
    expect(fresh).not.toBe(out);
    expect(Array.from(fresh!)).toEqual(Array.from(out));
  });
});

describe("pushTrail", () => {
  it("keeps a ring of last positions without duplicating a stay", () => {
    const o = { x: 0, y: 0, trail: [] as Array<[number, number]> };
    pushTrail(o, 3);
    pushTrail(o, 3);
    o.x = 1;
    pushTrail(o, 3);
    o.x = 2;
    pushTrail(o, 3);
    o.x = 3;
    pushTrail(o, 3);
    expect(o.trail).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]].slice(-3));
  });
});
