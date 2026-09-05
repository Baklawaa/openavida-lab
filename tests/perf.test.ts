import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { World } from "../src/sim/index";

describe("128×128 step time", () => {
  it("steps a populated 128×128 world and reports a finite mean step time", () => {
    const w = new World({ width: 128, height: 128, startPopulation: 260, seed: 0xa7f31ab });
    for (let i = 0; i < 8; i++) w.step();
    const n = 40;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) w.step();
    const meanStepMs = (performance.now() - t0) / n;
    expect(Number.isFinite(meanStepMs)).toBe(true);
    expect(meanStepMs).toBeGreaterThan(0);
    expect(w.w).toBe(128);
    expect(w.h).toBe(128);
    expect(w.organisms.length).toBeGreaterThan(0);
    const report = {
      grid: [w.w, w.h],
      population: w.organisms.length,
      lineages: [...w.lineages.values()].filter((l) => l.count > 0).length,
      meanStepMs,
      targetMs: 16.67,
      holds60fps: meanStepMs <= 16.67,
      lastHash: w.hashState(),
      tick: w.tick,
    };
    const scratch = process.env.OPENAVIDA_SCRATCH;
    if (scratch) writeFileSync(`${scratch}/perf.json`, JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log("PERF", JSON.stringify(report));
  });
});
