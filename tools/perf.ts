/**
 * The performance scenario runner, run with `npm run perf`
 * (`npx vite-node tools/perf.ts`).
 *
 * One plate (128 x 128, seed 0xa7f31ab) and three ways to reach measurement
 * time, because a single number never described both the pinned baseline and
 * the plate a user actually watches:
 * - canonical: 260 founders, 48 warmup ticks. This is the world pinned in
 *   tests/baselines/engine.json: the hash before the measured steps must be
 *   that baseline (e953dcdc on revision 4).
 * - mature: 180 founders stepped to tick 400, where the plate self-regulates
 *   at 670-780 organisms (calibration plate-capacity).
 * - chemostat: the mature plate with dilutionRate 0.02 and inflowNutrient
 *   1.0 (the batch equilibrium), 400 warmup ticks.
 * - snapshot/frame: encodeSnapshot and frameFromWorld on the canonical world
 *   right after its measured steps, reporting the bytes the timeline and the
 *   worker path pay.
 *
 * Prints a table and a JSON blob, and writes $OPENAVIDA_SCRATCH/perf.json when
 * that variable is set. tests/perf.test.ts re-measures the step scenarios and
 * fails when one crosses its budget; keep the two definitions in step.
 */
import { writeFileSync } from "node:fs";
import { World } from "../src/sim/world";
import { frameFromWorld } from "../src/sim/simHost";
import { encodeSnapshot } from "../src/sim/snapshotBin";
import type { SimParams } from "../src/sim/types";

const SEED = 0xa7f31ab;
const GRID = { width: 128, height: 128 } as const;
const WARMUP_CANONICAL = 48;
const WARMUP_MATURE = 400;
const MEASURED_TICKS = 50;

interface StepScenarioSpec {
  name: string;
  startPopulation: number;
  warmupTicks: number;
  /** Extra parameters on top of the 128 x 128 plate; absent = published defaults. */
  params?: Partial<SimParams>;
}

interface StepScenarioReport {
  name: string;
  grid: [number, number];
  startPopulation: number;
  warmupTicks: number;
  measuredTicks: number;
  population: number;
  lineages: number;
  meanStepMs: number;
  p95StepMs: number;
  msPerOrganism: number;
  hashBefore: string;
  hashAfter: string;
  tick: number;
}

interface SnapshotScenarioReport {
  name: string;
  grid: [number, number];
  population: number;
  tick: number;
  hash: string;
  encodeMs: number;
  encodeBytes: number;
  /** JSON header inside the container; the rest is the field grids. */
  encodeHeaderBytes: number;
  frameMs: number;
  frameBytes: number;
  transfers: number;
}

const STEP_SCENARIOS: readonly StepScenarioSpec[] = [
  { name: "canonical", startPopulation: 260, warmupTicks: WARMUP_CANONICAL },
  { name: "mature", startPopulation: 180, warmupTicks: WARMUP_MATURE },
  {
    name: "chemostat",
    startPopulation: 180,
    warmupTicks: WARMUP_MATURE,
    params: { dilutionRate: 0.02, inflowNutrient: 1 },
  },
];

/** Nearest-rank percentile, so the p95 is an observed step and not an interpolation. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function stepScenario(spec: StepScenarioSpec): { report: StepScenarioReport; world: World } {
  const world = new World({
    ...GRID,
    startPopulation: spec.startPopulation,
    seed: SEED,
    ...(spec.params ?? {}),
  });
  for (let i = 0; i < spec.warmupTicks; i++) world.step();
  const population = world.organisms.length;
  const lineages = [...world.lineages.values()].filter((l) => l.count > 0).length;
  const hashBefore = world.hashState();
  const times: number[] = [];
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const t0 = performance.now();
    world.step();
    times.push(performance.now() - t0);
  }
  const meanStepMs = times.reduce((sum, t) => sum + t, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    world,
    report: {
      name: spec.name,
      grid: [GRID.width, GRID.height],
      startPopulation: spec.startPopulation,
      warmupTicks: spec.warmupTicks,
      measuredTicks: MEASURED_TICKS,
      population,
      lineages,
      meanStepMs,
      p95StepMs: percentile(sorted, 95),
      msPerOrganism: population > 0 ? meanStepMs / population : 0,
      hashBefore,
      hashAfter: world.hashState(),
      tick: world.tick,
    },
  };
}

function snapshotScenario(world: World): SnapshotScenarioReport {
  const t0 = performance.now();
  const buffer = encodeSnapshot(world.snapshot());
  const encodeMs = performance.now() - t0;
  const t1 = performance.now();
  const { transfer } = frameFromWorld(world, "A", { historySince: -1, lineages: true, innovations: true });
  const frameMs = performance.now() - t1;
  return {
    name: "snapshot/frame",
    grid: [GRID.width, GRID.height],
    population: world.organisms.length,
    tick: world.tick,
    hash: world.hashState(),
    encodeMs,
    encodeBytes: buffer.byteLength,
    encodeHeaderBytes: new DataView(buffer).getUint32(8, true),
    frameMs,
    frameBytes: transfer.reduce((sum, b) => sum + b.byteLength, 0),
    transfers: transfer.length,
  };
}

function printTable(
  scenarios: readonly StepScenarioReport[],
  snapshot: SnapshotScenarioReport,
): void {
  console.log(
    `OpenAvida perf — ${GRID.width}x${GRID.height}, seed 0x${SEED.toString(16)}, ${MEASURED_TICKS} measured steps`,
  );
  console.log("");
  console.log("scenario    warmup  population  lineages  mean ms/step  p95 ms/step  ms/organism  hash before -> after");
  for (const s of scenarios) {
    console.log(
      [
        s.name.padEnd(11),
        String(s.warmupTicks).padStart(6),
        String(s.population).padStart(10),
        String(s.lineages).padStart(8),
        s.meanStepMs.toFixed(2).padStart(12),
        s.p95StepMs.toFixed(2).padStart(11),
        s.msPerOrganism.toFixed(4).padStart(12),
        `${s.hashBefore} -> ${s.hashAfter}`,
      ].join("  "),
    );
  }
  console.log("");
  console.log("snapshot/frame (canonical world after the measured steps)");
  console.log(
    `  population ${snapshot.population}, tick ${snapshot.tick}, hash ${snapshot.hash}`,
  );
  console.log(
    `  encodeSnapshot ${snapshot.encodeMs.toFixed(2)} ms for ${snapshot.encodeBytes} bytes (${snapshot.encodeHeaderBytes} header)`,
  );
  console.log(
    `  frameFromWorld ${snapshot.frameMs.toFixed(2)} ms for ${snapshot.frameBytes} bytes in ${snapshot.transfers} transfer buffers`,
  );
}

function main(): void {
  const scenarios: StepScenarioReport[] = [];
  let canonical: World | null = null;
  for (const spec of STEP_SCENARIOS) {
    const { report, world } = stepScenario(spec);
    scenarios.push(report);
    if (spec.name === "canonical") canonical = world;
  }
  const snapshot = snapshotScenario(canonical!);
  const report = {
    seed: `0x${SEED.toString(16)}`,
    grid: [GRID.width, GRID.height],
    measuredTicks: MEASURED_TICKS,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    scenarios,
    snapshot,
  };
  printTable(scenarios, snapshot);
  console.log("");
  console.log(JSON.stringify(report, null, 2));
  const scratch = process.env.OPENAVIDA_SCRATCH;
  if (scratch) writeFileSync(`${scratch}/perf.json`, JSON.stringify(report, null, 2));
}

main();
