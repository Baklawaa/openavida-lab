import { describe, expect, it } from "vitest";
import { metabolize } from "../src/sim/ecology";
import {
  TERRAIN,
  World,
  founderPhototroph,
  founderPredator,
  lineageShannon,
  parentChildEdges,
  shadeOccupied,
} from "../src/sim/index";

describe("diffusion fields", () => {
  it("nutrient, toxin, temperature, and light all spread from a local source", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 0, seed: 7 });
    w.terrain.fill(TERRAIN.empty);
    w.fields.nutrient.fill(0);
    w.fields.toxin.fill(0);
    w.fields.temperature.fill(0);
    w.fields.light.fill(0);
    w.fields.solar.fill(0);
    const i = 8 * 16 + 8;
    const right = i + 1;
    w.fields.nutrient[i] = 1;
    w.fields.toxin[i] = 1;
    w.fields.temperature[i] = 1;
    w.fields.light[i] = 1;
    const before = {
      nutrient: w.fields.nutrient[right]!,
      toxin: w.fields.toxin[right]!,
      temperature: w.fields.temperature[right]!,
      light: w.fields.light[right]!,
    };
    w.fields.diffuseAll(0.5, w.terrain);
    expect(w.fields.nutrient[right]!).toBeGreaterThan(before.nutrient);
    expect(w.fields.toxin[right]!).toBeGreaterThan(before.toxin);
    expect(w.fields.temperature[right]!).toBeGreaterThan(before.temperature);
    expect(w.fields.light[right]!).toBeGreaterThan(before.light);
  });
});

describe("self-shading", () => {
  it("packed clumps cut light; isolated cells do not", () => {
    const w = 8;
    const light = new Float32Array(w * 2);
    light.fill(1);
    const occ = new Int32Array(w * 2);
    occ.fill(-1);
    // a 2×2 block at (1,0),(2,0),(1,1),(2,1)
    const clump = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ];
    for (let i = 0; i < clump.length; i++) occ[clump[i]!.y * w + clump[i]!.x] = i;
    occ[7] = 99;
    shadeOccupied(light, [...clump, { x: 7, y: 0 }], occ, w, 2);
    expect(light[1]!).toBeLessThan(0.5);
    expect(light[7]!).toBe(1);
  });

  it("World.step shades a dense clump more than an isolated neighbor", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 1 });
    w.terrain.fill(TERRAIN.empty);
    const a = w.birth(1, 1, founderPhototroph(), null, false, 1);
    const b = w.birth(2, 1, founderPhototroph(), null, false, 1);
    const c = w.birth(1, 2, founderPhototroph(), null, false, 1);
    const d = w.birth(2, 2, founderPhototroph(), null, false, 1);
    const iso = w.birth(6, 6, founderPhototroph(), null, false, 1);
    expect(a && b && c && d && iso).toBeTruthy();
    w.fields.light.fill(1);
    w.step();
    const packed = w.fields.light[1 + 1 * 8]!;
    const alone = w.fields.light[6 + 6 * 8]!;
    expect(packed).toBeLessThan(alone);
  });
});

describe("ecology", () => {
  it("predation kills a weaker adjacent prey (aggression gap ≥ 0.5 is certain)", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 3 });
    w.terrain.fill(TERRAIN.empty);
    const pred = w.birth(2, 2, founderPredator(), null, false, 1);
    const prey = w.birth(3, 2, founderPhototroph(), null, false, 2);
    expect(pred).toBeTruthy();
    expect(prey).toBeTruthy();
    pred!.ph.aggression = 1;
    prey!.ph.aggression = 0;
    const preyId = prey!.id;
    w.step();
    expect(w.lastPredation).toBeGreaterThan(0);
    expect(w.organisms.find((o) => o.id === preyId)).toBeUndefined();
  });

  it("exudation is a transfer: the producer pays exactly what the field receives", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4 });
    w.fields.light.fill(1);
    w.fields.nutrient.fill(0);
    const producer = w.birth(2, 2, founderPhototroph(), null, false, 3)!;
    producer.ph.signal = 0; // produces but cannot take up
    producer.ph.aggression = 0;
    const before = producer.energy;
    const met = metabolize(producer, w.fields, w.params);
    const cell = w.fields.exudate[w.fields.idx(2, 2)]!;
    expect(met.leaked).toBeGreaterThan(0);
    expect(cell).toBeCloseTo(met.leaked, 6);
    expect(producer.energy).toBeCloseTo(before + met.delta - met.leaked, 6);
    expect(met.taken).toBe(0);
  });

  it("a receptor takes up exudate and a non-receptor cannot", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4 });
    w.fields.light.fill(0);
    w.fields.nutrient.fill(0);
    const consumer = w.birth(3, 2, founderPhototroph(), null, false, 3)!;
    consumer.ph.photo = 0; // no producer role, receptor only
    consumer.ph.signal = 7;
    consumer.ph.aggression = 0;
    w.fields.exudate[w.fields.idx(3, 2)] = 0.5;
    const before = consumer.energy;
    const met = metabolize(consumer, w.fields, w.params);
    expect(met.taken).toBeGreaterThan(0);
    expect(consumer.energy).toBeGreaterThan(before + met.delta);
    expect(w.fields.exudate[w.fields.idx(3, 2)]!).toBeLessThan(0.5);
    // Without a receptor the same field is untouched.
    const blind = w.birth(4, 2, founderPhototroph(), null, false, 3)!;
    blind.ph.photo = 0;
    blind.ph.signal = 0;
    blind.ph.aggression = 0;
    w.fields.exudate[w.fields.idx(4, 2)] = 0.5;
    const blindMet = metabolize(blind, w.fields, w.params);
    expect(blindMet.taken).toBe(0);
    expect(w.fields.exudate[w.fields.idx(4, 2)]!).toBeCloseTo(0.5, 6);
  });

  it("competition / occupancy changes on a crowded grid", () => {
    const w = new World({
      width: 8,
      height: 8,
      startPopulation: 22,
      seed: 99,
      mutationRate: 0,
    });
    for (const o of w.organisms) o.ph.motility = 1;
    let displaced = 0;
    const pop0 = w.organisms.length;
    for (let i = 0; i < 30; i++) {
      w.step();
      displaced += w.lastDisplacements;
    }
    expect(displaced > 0 || w.organisms.length < pop0).toBe(true);
  });

  it("records an extinction when a lineage count hits zero", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 6, seed: 5 });
    const victim = w.organisms[0]!;
    const id = victim.lineageId;
    const killed = w.killLineage(id);
    expect(killed).toBeGreaterThan(0);
    expect(w.lineages.get(id)?.count).toBe(0);
    expect(w.lineages.get(id)?.extinctTick).not.toBeNull();
    expect(w.extinctions.some((e) => e.lineageId === id)).toBe(true);
  });

  it("reports Shannon diversity, fixation fraction, and a parent→child lineage edge", () => {
    const w = new World({
      width: 12,
      height: 12,
      startPopulation: 8,
      seed: 21,
      mutationRate: 1,
      pointWeight: 1,
      indelWeight: 0,
      duplicationWeight: 0,
      reproduceEnergy: 0.5,
    });
    for (const o of w.organisms) o.energy = 4;
    for (let i = 0; i < 25; i++) {
      for (const o of w.organisms) {
        if (o.energy < 2) o.energy = 3;
      }
      w.step();
    }
    const last = w.history[w.history.length - 1]!;
    expect(last.shannon).toBeGreaterThanOrEqual(0);
    expect(lineageShannon(w.lineages.values(), w.organisms.length)).toBeCloseTo(last.shannon, 8);
    expect(last.fixationFraction).toBeGreaterThan(0);
    const edges = parentChildEdges(w.lineages.values());
    expect(edges.length).toBeGreaterThan(0);
    expect(w.lineageEdges()).toEqual(edges);
    const child = [...w.lineages.values()].find((l) => l.parentId >= 0);
    expect(child).toBeTruthy();
    expect(w.lineages.has(child!.parentId)).toBe(true);
  });
});
