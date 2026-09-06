import { describe, expect, it } from "vitest";
import { HEAT_DECAY, OccupancyHeat, World, founderPhototroph, placeOrganismAt, pushTrail } from "../src/sim/index";

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
