import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, flagsEqual, flagsFromQuery, flagsToQuery, World } from "../src/sim/index";

describe("phase-2 feature flags", () => {
  it("default off so a bare URL is the phase-1 lab", () => {
    expect(flagsFromQuery("")).toEqual(DEFAULT_FLAGS);
    expect(flagsFromQuery("?seed=1")).toEqual(DEFAULT_FLAGS);
    expect(DEFAULT_FLAGS.view3d).toBe(false);
    expect(DEFAULT_FLAGS.multiplayer).toBe(false);
    expect(DEFAULT_FLAGS.brains).toBe(false);
    expect(DEFAULT_FLAGS.llmBrains).toBe(false);
    expect(DEFAULT_FLAGS.worker).toBe(false);
  });

  it("parses view3d/mp/brains/llm from the query string", () => {
    const f = flagsFromQuery("?view3d=1&mp=true&brains=on&llm=1&worker=1");
    expect(f.worker).toBe(true);
    expect(f.view3d).toBe(true);
    expect(f.multiplayer).toBe(true);
    expect(f.brains).toBe(true);
    expect(f.llmBrains).toBe(true);
    expect(flagsFromQuery("?" + flagsToQuery(f))).toEqual(f);
    expect(flagsEqual(f, DEFAULT_FLAGS)).toBe(false);
  });

  it("does not change a seeded World.step hash (flags live off World)", () => {
    const p = { width: 16, height: 16, seed: 42, startPopulation: 12 };
    const a = new World(p);
    const b = new World(p);
    expect(a.brainsEnabled).toBe(false);
    for (let i = 0; i < 8; i++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
  });
});
