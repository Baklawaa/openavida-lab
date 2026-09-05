import { describe, expect, it } from "vitest";
import { World } from "../src/sim/index";

describe("default-seeded long run (World.step)", () => {
  it("does not cap-out as a lawn and keeps Shannon, turnover, and moving fitness", () => {
    const w = new World();
    expect(w.w).toBe(128);
    expect(w.h).toBe(128);
    let peak = w.organisms.length;
    while (w.tick < 80) {
      w.step();
      peak = Math.max(peak, w.organisms.length);
    }
    const ext80 = w.extinctions.length;
    const lin80 = w.nextLineageId;
    const lateShannon: number[] = [];
    const lateFit: number[] = [];
    while (w.tick < 220) {
      const m = w.step();
      peak = Math.max(peak, w.organisms.length);
      if (m.tick % 20 === 0) lateShannon.push(m.shannon);
      if (m.tick >= 170) lateFit.push(m.meanFitness);
    }
    expect(peak).toBeLessThan(w.params.maxPopulation);
    expect(w.organisms.length).toBeLessThan(w.params.maxPopulation);
    expect(lateShannon.length).toBeGreaterThan(3);
    for (const h of lateShannon) expect(h).toBeGreaterThan(0.5);
    expect(w.extinctions.length > ext80 || w.nextLineageId > lin80).toBe(true);
    const uniq = new Set(lateFit.map((f) => f.toFixed(4)));
    expect(uniq.size).toBeGreaterThan(1);
  });
});
