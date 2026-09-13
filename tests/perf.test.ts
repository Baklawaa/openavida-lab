import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { World } from "../src/sim/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Budgets, with the measurement and the command that produced them.
 *
 * `npx vite-node tools/perf.ts` on darwin/arm64, node v26.5.0, 2026-09-13,
 * six runs (50 measured steps each):
 *   canonical  74 organisms, 48 warmup ticks  3.78-3.92 ms/step  -> 16.67 ms
 *   mature    672 organisms, tick 400         4.97-5.16 ms/step  -> 12.9 ms
 *   chemostat 705 organisms, tick 400         4.72-4.97 ms/step  -> 12.4 ms
 * Canonical carries the 60 fps target (4.2x the slowest run); mature and
 * chemostat carry 2.5x the slowest run: enough for a shared CI runner whose
 * clock is slower, tight enough to fail on a 2.5x regression. Under
 * `npx vitest run tests/perf.test.ts` the harness adds ~15%, reading up to
 * 4.29 / 6.06 / 5.14 ms/step.
 */
const BUDGETS = {
  canonical: 16.67,
  mature: 12.9,
  chemostat: 12.4,
} as const;

const TIMEOUTS = {
  canonical: 60_000,
  mature: 120_000,
  chemostat: 120_000,
} as const;

const MEASURED_TICKS = 50;
const SEED = 0xa7f31ab;

interface ScenarioSpec {
  name: keyof typeof BUDGETS;
  startPopulation: number;
  warmupTicks: number;
  params?: { dilutionRate: number; inflowNutrient: number };
}

/**
 * Kept in step with tools/perf.ts. The runner cannot be imported here: it
 * calls main() on import, by design, so the test re-measures the same worlds.
 */
const SCENARIOS: readonly ScenarioSpec[] = [
  { name: "canonical", startPopulation: 260, warmupTicks: 48 },
  { name: "mature", startPopulation: 180, warmupTicks: 400 },
  {
    name: "chemostat",
    startPopulation: 180,
    warmupTicks: 400,
    params: { dilutionRate: 0.02, inflowNutrient: 0.12 },
  },
];

interface ScenarioResult {
  name: string;
  grid: [number, number];
  population: number;
  lineages: number;
  meanStepMs: number;
  p95StepMs: number;
  msPerOrganism: number;
  hashBefore: string;
  hashAfter: string;
  tick: number;
}

/** Nearest-rank percentile, matching the runner so both report the same p95. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function measure(spec: ScenarioSpec): ScenarioResult {
  const w = new World({
    width: 128,
    height: 128,
    startPopulation: spec.startPopulation,
    seed: SEED,
    ...(spec.params ?? {}),
  });
  for (let i = 0; i < spec.warmupTicks; i++) w.step();
  const population = w.organisms.length;
  const lineages = [...w.lineages.values()].filter((l) => l.count > 0).length;
  const hashBefore = w.hashState();
  const times: number[] = [];
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const t0 = performance.now();
    w.step();
    times.push(performance.now() - t0);
  }
  const meanStepMs = times.reduce((sum, t) => sum + t, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    name: spec.name,
    grid: [w.w, w.h],
    population,
    lineages,
    meanStepMs,
    p95StepMs: percentile(sorted, 95),
    msPerOrganism: population > 0 ? meanStepMs / population : 0,
    hashBefore,
    hashAfter: w.hashState(),
    tick: w.tick,
  };
}

const measured = new Map<string, ScenarioResult>();

afterAll(() => {
  const scratch = process.env.OPENAVIDA_SCRATCH;
  if (!scratch) return;
  const payload = {
    measuredTicks: MEASURED_TICKS,
    budgets: BUDGETS,
    scenarios: [...measured.values()],
  };
  writeFileSync(`${scratch}/perf.json`, JSON.stringify(payload, null, 2));
});

describe("128x128 step budgets", () => {
  const baseline = JSON.parse(
    readFileSync(resolve(root, "tests/baselines/engine.json"), "utf8"),
  ) as { perfHash: string };

  for (const spec of SCENARIOS) {
    it(
      `keeps the ${spec.name} scenario under ${BUDGETS[spec.name]} ms/step`,
      () => {
        // calibration:perf-budget
        const result = measure(spec);
        measured.set(spec.name, result);
        // eslint-disable-next-line no-console
        console.log("PERF", JSON.stringify({ ...result, budgetMs: BUDGETS[spec.name], measuredTicks: MEASURED_TICKS }));

        // Smoke assertions kept from the original perf test.
        expect(Number.isFinite(result.meanStepMs)).toBe(true);
        expect(result.meanStepMs).toBeGreaterThan(0);
        expect(result.grid).toEqual([128, 128]);
        expect(result.population).toBeGreaterThan(0);
        expect(result.p95StepMs).toBeGreaterThan(0);
        // The canonical scenario is the pinned-hash world: 48 warmup steps
        // must land exactly on the baseline tests/engine.test.ts pins.
        if (spec.name === "canonical") expect(result.hashBefore).toBe(baseline.perfHash);
        expect(
          result.meanStepMs,
          `${spec.name} averaged ${result.meanStepMs.toFixed(2)} ms/step at ${result.population} organisms, budget ${BUDGETS[spec.name]} ms`,
        ).toBeLessThanOrEqual(BUDGETS[spec.name]);
      },
      TIMEOUTS[spec.name],
    );
  }
});
