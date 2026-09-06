import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  MASS_DECAY,
  MASS_TO_BREED,
  World,
  bodySize,
  canBreed,
  chemotaxisDir,
  decayMass,
  energyCap,
  feed,
  founderHeterotroph,
  founderPredator,
  huntingPower,
  interactNeighbors,
  moveOrganisms,
  preyGap,
  takeSnapshot,
  worldFromSnapshot,
} from "../src/sim/index";
import { DX, DY } from "../src/sim/ecology";
import { Rng } from "../src/sim/rng";

function arena(): World {
  const w = new World({ width: 16, height: 16, seed: 3, mutationRate: 0 });
  w.fields.nutrient.fill(0.3);
  return w;
}

describe("predators feed, grow and hunt", () => {
  it("a kill transfers energy and adds body mass; mass enlarges the body and the energy cap", () => {
    const w = arena();
    const pred = w.birth(5, 5, founderPredator(), null, false, 1)!;
    const prey = w.birth(6, 5, founderHeterotroph(), null, false, 1.2)!;
    expect(pred.mass).toBe(0);
    const size0 = bodySize(pred);
    const cap0 = energyCap(pred);
    const r = interactNeighbors(w.organisms, w.occupancy, w.w, w.h, w.rng, w.params);
    expect(r.kills).toBe(1);
    expect(prey.pendingDeath).toBe("predation");
    expect(pred.energy).toBeGreaterThan(1);
    expect(pred.mass).toBeGreaterThan(0.2);
    expect(bodySize(pred)).toBeGreaterThan(size0);
    expect(energyCap(pred)).toBeGreaterThan(cap0);
    expect(huntingPower(pred)).toBeGreaterThan(pred.ph.aggression);
    // Mass saturates at 1 after repeated meals.
    for (let i = 0; i < 10; i++) feed(pred, { ...prey, energy: 1 });
    expect(pred.mass).toBe(1);
    expect(bodySize(pred)).toBeCloseTo(pred.ph.size * 1.6);
  });

  it("mass decays slowly without prey and never below zero", () => {
    const w = arena();
    w.fields.nutrient.fill(2);
    const pred = w.birth(5, 5, founderPredator(), null, false, 3)!;
    pred.mass = 0.5;
    decayMass(pred);
    expect(pred.mass).toBeCloseTo(0.5 - MASS_DECAY);
    for (let i = 0; i < 20; i++) w.step();
    const alive = w.organisms.find((o) => o.id === pred.id);
    expect(alive).toBeTruthy();
    expect(alive!.mass).toBeCloseTo(0.5 - 21 * MASS_DECAY, 5);
    pred.mass = 0.001;
    decayMass(pred);
    decayMass(pred);
    expect(pred.mass).toBe(0);
  });

  it("chemotaxis steers predators toward edible prey and others away from occupied cells", () => {
    const w = arena();
    const pred = w.birth(8, 8, founderPredator(), null, false, 1)!;
    const prey = w.birth(9, 8, founderHeterotroph(), null, false, 1)!;
    const other = w.birth(2, 2, founderHeterotroph(), null, false, 1)!;
    const neighbor = w.birth(3, 2, founderHeterotroph(), null, false, 1)!;
    expect(preyGap(pred, prey, DEFAULT_PARAMS.predationThreshold)).toBeGreaterThan(0.5);
    expect(preyGap(other, neighbor, DEFAULT_PARAMS.predationThreshold)).toBe(null);
    let towardPrey = 0;
    let towardNeighbor = 0;
    for (let t = 0; t < 40; t++) {
      const rng = new Rng(100 + t);
      const d = chemotaxisDir(pred, w.fields, w.terrain, w.occupancy, w.w, w.h, rng, w.organisms, DEFAULT_PARAMS.predationThreshold);
      if (pred.x + DX[d]! === prey.x && pred.y + DY[d]! === prey.y) towardPrey++;
      const d2 = chemotaxisDir(other, w.fields, w.terrain, w.occupancy, w.w, w.h, rng, w.organisms, DEFAULT_PARAMS.predationThreshold);
      if (other.x + DX[d2]! === neighbor.x && other.y + DY[d2]! === neighbor.y) towardNeighbor++;
    }
    expect(towardPrey).toBe(40);
    expect(towardNeighbor).toBe(0);
  });

  it("a predator moving onto prey eats it instead of merely displacing it", () => {
    const w = arena();
    const pred = w.birth(8, 8, founderPredator(), null, false, 1)!;
    const prey = w.birth(9, 8, founderHeterotroph(), null, false, 1)!;
    Object.assign(pred.ph, { motility: 1 });
    let eaten = false;
    for (let t = 0; t < 30 && !eaten; t++) {
      moveOrganisms(w.organisms, w.occupancy, w.terrain, w.fields, w.w, w.h, new Rng(7 + t), w.params);
      eaten = prey.pendingDeath === "predation";
    }
    expect(eaten).toBe(true);
    expect(pred.mass).toBeGreaterThan(0);
    expect(pred.x).toBe(9);
    expect(pred.y).toBe(8);
  });

  it("mass survives snapshots and defaults to zero on legacy snapshots", () => {
    const w = arena();
    const pred = w.birth(5, 5, founderPredator(), null, false, 1)!;
    pred.mass = 0.42;
    const snap = takeSnapshot(w);
    expect(worldFromSnapshot(snap).organisms[0]!.mass).toBeCloseTo(0.42);
    const legacy = JSON.parse(JSON.stringify(snap));
    for (const o of legacy.organisms) delete o.mass;
    expect(worldFromSnapshot(legacy).organisms[0]!.mass).toBe(0);
  });

  it("predators hunt, grow, and only breed once fed; a lean predator never reproduces", () => {
    const w = new World({ width: 32, height: 32, seed: 9, mutationRate: 0 });
    w.fields.nutrient.fill(0.6);
    w.injectStrain(founderHeterotroph(), 60);
    w.injectStrain(founderPredator(), 6);
    let fedPredators = 0;
    let aliveAt60 = 0;
    let predatorChildren = 0;
    for (let i = 1; i <= 120; i++) {
      w.step();
      const preds = w.organisms.filter((o) => o.ph.aggression > 0.5);
      fedPredators = Math.max(fedPredators, preds.filter((o) => o.mass > 0).length);
      if (i === 60) aliveAt60 = preds.length;
      predatorChildren += preds.filter((o) => o.parentId >= 0 && o.age === 0).length;
    }
    expect(w.deaths.filter((d) => d.cause === "predation").length).toBeGreaterThan(5);
    expect(fedPredators).toBeGreaterThan(0);
    expect(aliveAt60).toBeGreaterThan(0);
    // Breeding is gated on body condition.
    const lean = w.birth(1, 1, founderPredator(), null, false, 3)!;
    expect(canBreed(lean, DEFAULT_PARAMS.predationThreshold)).toBe(false);
    lean.mass = MASS_TO_BREED;
    expect(canBreed(lean, DEFAULT_PARAMS.predationThreshold)).toBe(true);
    expect(canBreed(w.birth(2, 1, founderHeterotroph(), null, false, 3)!, DEFAULT_PARAMS.predationThreshold)).toBe(true);
    void predatorChildren;
  });
});
