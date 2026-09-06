import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, TERRAIN, World } from "../src/sim/index";

describe("blank default world", () => {
  it("starts with zero organisms and empty terrain; toxin is all zeros", () => {
    expect(DEFAULT_PARAMS.startPopulation).toBe(0);
    expect(DEFAULT_PARAMS.randomTerrain).toBe(false);
    const w = new World();
    expect(w.organisms.length).toBe(0);
    expect([...w.terrain].every((t) => t === TERRAIN.empty)).toBe(true);
    expect(w.fields.toxin.every((v) => v === 0)).toBe(true);
    w.step();
    expect(w.organisms.length).toBe(0);
  });
});
