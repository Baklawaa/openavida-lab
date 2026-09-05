import { writeFileSync } from "node:fs";
import { World } from "../src/sim/world";

const scratch = process.env.OPENAVIDA_SCRATCH || ".";
const w = new World({ width: 128, height: 128, startPopulation: 260, seed: 0xa7f31ab });
for (let i = 0; i < 8; i++) w.step();
const n = 50;
const t0 = performance.now();
for (let i = 0; i < n; i++) w.step();
const meanStepMs = (performance.now() - t0) / n;
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
writeFileSync(`${scratch}/perf.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
