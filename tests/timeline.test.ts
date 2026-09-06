import { describe, expect, it } from "vitest";
import { Timeline, World, estimateSnapshotBytes, founderPhototroph, placeOrganismAt } from "../src/sim/index";

describe("Timeline", () => {
  it("records on the cadence and keeps tick 0", () => {
    const w = new World({ width: 12, height: 12, seed: 3, startPopulation: 0 });
    const tl = new Timeline({ every: 2 });
    tl.record(w);
    for (let i = 0; i < 7; i++) {
      w.step();
      tl.record(w);
    }
    expect(tl.entries().map((e) => e.tick)).toEqual([0, 2, 4, 6]);
    expect(tl.range()).toEqual({ min: 0, max: 6 });
  });

  it("evicts the oldest after the first when the byte budget is exceeded", () => {
    const w = new World({ width: 8, height: 8, seed: 1, startPopulation: 0 });
    placeOrganismAt(w, 2, 2, founderPhototroph());
    const one = estimateSnapshotBytes(w.organisms.length, 64);
    const tl = new Timeline({ every: 1, budgetBytes: Math.floor(one * 2.4) });
    tl.record(w);
    for (let i = 0; i < 5; i++) {
      w.step();
      tl.record(w);
    }
    const ticks = tl.entries().map((e) => e.tick);
    expect(ticks[0]).toBe(0);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThan(6);
    expect(tl.usedBytes()).toBeLessThanOrEqual(tl.budgetBytes + one);
  });

  it("nearest picks the closest tick, lower on a tie", () => {
    const w = new World({ width: 8, height: 8, seed: 2, startPopulation: 0 });
    const tl = new Timeline({ every: 4 });
    tl.record(w);
    for (let i = 0; i < 8; i++) {
      w.step();
      tl.record(w);
    }
    expect(tl.nearest(0)!.tick).toBe(0);
    expect(tl.nearest(8)!.tick).toBe(8);
    expect(tl.nearest(2)!.tick).toBe(0);
    expect(tl.nearest(6)!.tick).toBe(4);
    expect(tl.nearest(100)!.tick).toBe(8);
    const a = tl.nearest(2)!;
    expect(a.snapshot.tick).toBe(a.tick);
  });
});
