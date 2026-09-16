import { describe, expect, it } from "vitest";
import {
  World,
  classifyEnergyDeath,
  decodeGenome,
  founderPhototroph,
  founderPredator,
  genomeForKit,
  paintTerrain,
  placeOrganismAt,
  strongestLiving,
  tallyDeaths,
} from "../src/sim/index";

describe("death causes", () => {
  it("classifies toxin vs starvation from phenotype × environment", () => {
    const ph = decodeGenome(genomeForKit("heterotroph")).phenotype;
    expect(
      classifyEnergyDeath(ph, { nutrient: 0, toxin: 0.8, temperature: 0.5, light: 0, exudate: 0 }),
    ).toBe("toxin");
    expect(
      classifyEnergyDeath(ph, { nutrient: 0, toxin: 0, temperature: 0.5, light: 0, exudate: 0 }),
    ).toBe("starvation");
  });

  it("World.reap records starvation on an empty plate", () => {
    const w = new World({ width: 8, height: 8, seed: 11, startPopulation: 0, maxAge: 400 });
    w.fields.nutrient.fill(0);
    w.fields.light.fill(0);
    w.fields.toxin.fill(0);
    expect(placeOrganismAt(w, 2, 2, genomeForKit("heterotroph"))).toBeTruthy();
    for (let i = 0; i < 80; i++) w.step();
    expect(w.organisms.length).toBe(0);
    expect(w.deaths.length).toBeGreaterThan(0);
    expect(w.deaths.some((d) => d.cause === "starvation")).toBe(true);
    expect(w.deaths[0]!.genome.length).toBeGreaterThan(0);
    const tally = tallyDeaths(w.deaths);
    expect((tally.starvation ?? 0) + (tally.crowding ?? 0)).toBeGreaterThan(0);
  });

  it("wipe brush and bottleneck write their causes", () => {
    const w = new World({ width: 8, height: 8, seed: 5, startPopulation: 0 });
    w.fields.nutrient.fill(1);
    w.fields.light.fill(1);
    expect(placeOrganismAt(w, 1, 1, founderPhototroph())).toBeTruthy();
    expect(placeOrganismAt(w, 3, 3, founderPhototroph())).toBeTruthy();
    expect(placeOrganismAt(w, 5, 5, founderPhototroph())).toBeTruthy();
    paintTerrain(w, 1, 1, 0, "wipeOrgs");
    expect(w.deaths.some((d) => d.cause === "wipe")).toBe(true);
    w.bottleneck(0);
    expect(w.organisms.length).toBe(0);
    expect(w.deaths.some((d) => d.cause === "bottleneck")).toBe(true);
  });

  it("predation is recorded on the prey", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, seed: 3 });
    const pred = w.birth(2, 2, founderPredator(), null, false, 1);
    const prey = w.birth(3, 2, founderPhototroph(), null, false, 2);
    expect(pred && prey).toBeTruthy();
    pred!.ph.aggression = 1;
    prey!.ph.aggression = 0;
    const preyId = prey!.id;
    w.step();
    expect(w.organisms.find((o) => o.id === preyId)).toBeUndefined();
    expect(w.deaths.some((d) => d.orgId === preyId && d.cause === "predation")).toBe(true);
  });
});

describe("strongest living", () => {
  it("ranks by fitness then energy and includes DNA", () => {
    const w = new World({ width: 8, height: 8, seed: 2, startPopulation: 0 });
    const a = w.birth(1, 1, founderPhototroph(), null, false, 1);
    const b = w.birth(4, 4, founderPredator(), null, false, 0.4);
    expect(a && b).toBeTruthy();
    a!.fitness = 0.2;
    b!.fitness = 1.4;
    const top = strongestLiving(w.organisms, 8);
    expect(top[0]!.id).toBe(b!.id);
    expect(top[0]!.genome).toBe(b!.genome);
    expect(top[1]!.id).toBe(a!.id);
  });
});
