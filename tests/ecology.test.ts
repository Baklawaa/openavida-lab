import { describe, expect, it } from "vitest";
import {
  TERRAIN,
  World,
  founderPhototroph,
  founderPredator,
  lineageShannon,
  parentChildEdges,
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

describe("ecology", () => {
  it("predation kills a weaker adjacent prey (aggression gap ≥ 0.5 is certain)", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 3 });
    w.terrain.fill(TERRAIN.empty);
    const pred = w.birth(2, 2, founderPredator(), null, false, 2);
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

  it("matching mutualism raises the shipped fitness score via neighbor terms", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4 });
    w.terrain.fill(TERRAIN.empty);
    const a = w.birth(2, 2, founderPhototroph(), null, false, 1);
    expect(a).toBeTruthy();
    a!.ph.signal = 2;
    a!.ph.aggression = 0;
    w.refreshFitness(a!);
    const solo = a!.fitness;
    const b = w.birth(3, 2, founderPhototroph(), null, false, 1);
    expect(b).toBeTruthy();
    b!.ph.signal = 2;
    b!.ph.aggression = 0;
    w.refreshFitness(a!);
    expect(a!.fitness).toBeGreaterThan(solo);
  });

  it("matching mutualism signals register on adjacent organisms", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 4 });
    w.terrain.fill(TERRAIN.empty);
    const a = w.birth(2, 2, founderPhototroph(), null, false, 1);
    const b = w.birth(3, 2, founderPhototroph(), null, false, 1);
    expect(a && b).toBeTruthy();
    a!.ph.signal = 2;
    b!.ph.signal = 2;
    a!.ph.aggression = 0;
    b!.ph.aggression = 0;
    w.step();
    expect(w.lastMutualism).toBeGreaterThan(0);
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
