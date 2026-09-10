/**
 * Invariant fuzzing: a seeded op sequence must never break the physical and
 * structural invariants of the world, and must stay deterministic. These are
 * the cheap checks that catch the bug class which invalidates a long run.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { World, founderHeterotroph, randomGenome, worldFromSnapshot } from "../src/sim/index";
import { Rng } from "../src/sim/rng";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIELDS = ["nutrient", "toxin", "temperature", "light"] as const;

function checkInvariants(w: World, label: string): void {
  const cells = w.w * w.h;
  if (w.occupancy.length !== cells) throw new Error(`${label}: occupancy size`);
  const claimed = new Set<number>();
  for (let i = 0; i < w.organisms.length; i++) {
    const o = w.organisms[i]!;
    if (!Number.isFinite(o.energy) || o.energy <= 0) throw new Error(`${label}: organism ${o.id} energy ${o.energy}`);
    if (!Number.isFinite(o.fitness)) throw new Error(`${label}: organism ${o.id} fitness ${o.fitness}`);
    if (o.x < 0 || o.y < 0 || o.x >= w.w || o.y >= w.h) throw new Error(`${label}: organism ${o.id} out of bounds`);
    if (!w.lineages.has(o.lineageId)) throw new Error(`${label}: organism ${o.id} has unknown lineage ${o.lineageId}`);
    const cell = o.y * w.w + o.x;
    if (w.occupancy[cell] !== i) throw new Error(`${label}: occupancy mismatch at (${o.x},${o.y})`);
    if (claimed.has(cell)) throw new Error(`${label}: two organisms share cell (${o.x},${o.y})`);
    claimed.add(cell);
  }
  for (const name of FIELDS) {
    const arr = w.fields[name];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!;
      if (!Number.isFinite(v) || v < 0) throw new Error(`${label}: field ${name}[${i}] = ${v}`);
    }
  }
  const restored = worldFromSnapshot(w.snapshot());
  if (restored.hashState() !== w.hashState()) {
    throw new Error(`${label}: snapshot round trip changed the hash`);
  }
}

/** One seeded stream of world mutations; every world draw stays inside World. */
function runOps(w: World, rng: Rng, ops: number): void {
  for (let i = 0; i < ops; i++) {
    const pick = rng.int(9);
    switch (pick) {
      case 0:
        w.paint(rng.int(w.w), rng.int(w.h), rng.int(4), "nutrientBlob", 0.5);
        break;
      case 1:
        w.paint(rng.int(w.w), rng.int(w.h), rng.int(3), "toxinBlob", 0.4);
        break;
      case 2:
        w.paint(rng.int(w.w), rng.int(w.h), rng.int(3), "barrier");
        break;
      case 3:
        w.birth(rng.int(w.w), rng.int(w.h), randomGenome(rng), null, false, 0.9);
        break;
      case 4:
        w.injectStrain(founderHeterotroph(), 4);
        break;
      case 5:
        w.bottleneck(0.6);
        break;
      case 6:
        w.step();
        break;
      case 7:
        w.restore(w.snapshot());
        break;
      case 8:
        w.schedule = [{ at: w.tick + 1, op: { type: "scale", field: "nutrient", k: 1.2 } }];
        break;
    }
    checkInvariants(w, `op ${i} (kind ${pick})`);
  }
}

function fuzzWorld(): World {
  return new World({ width: 24, height: 24, seed: 11, startPopulation: 24 });
}

describe("world invariants under random operations", () => {
  it("never produces a non-finite value, an occupancy mismatch or a lost snapshot", () => {
    const w = fuzzWorld();
    checkInvariants(w, "init");
    runOps(w, new Rng(0xf00d), 200);
    expect(w.tick).toBeGreaterThan(0);
  });

  it("is deterministic for an identical operation sequence", () => {
    const a = fuzzWorld();
    const b = fuzzWorld();
    runOps(a, new Rng(1234), 80);
    runOps(b, new Rng(1234), 80);
    expect(a.hashState()).toBe(b.hashState());
    expect(a.organisms.map((o) => o.id)).toEqual(b.organisms.map((o) => o.id));
  });

  it("keeps every simulation draw inside the seeded Rng", () => {
    const dir = resolve(root, "src/sim");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "rng.ts")) {
      const text = readFileSync(resolve(dir, file), "utf8");
      expect(text.includes("Math.random"), file).toBe(false);
    }
  });
});
