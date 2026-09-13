import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, MODEL_REVISION, engineInfo, paramsDigest } from "../src/sim/engine";
import { World } from "../src/sim/world";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(root, "tests/baselines/engine.json");

/** The canonical benchmark world, unchanged since the phase-1 baseline. */
export function perfWorld(): World {
  return new World({ width: 128, height: 128, startPopulation: 260, seed: 0xa7f31ab });
}

export function perfWorldHash(steps = 48): string {
  const w = perfWorld();
  for (let i = 0; i < steps; i++) w.step();
  return w.hashState();
}

interface Baseline {
  version: string;
  revision: number;
  hashAlgo: string;
  seed: string;
  steps: number;
  perfHash: string;
}

describe("engine identity and baseline", () => {
  it("pins the canonical perf-world hash so behaviour changes cannot land silently", () => {
    const actual = perfWorldHash();
    let baseline: Baseline = { version: "", revision: 0, hashAlgo: "", seed: "", steps: 0, perfHash: "" };
    try {
      baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
    } catch {
      // First run: the update branch below writes the file.
    }
    if (process.env.OPENAVIDA_UPDATE_BASELINE === "1") {
      const next: Baseline = {
        version: ENGINE_VERSION,
        revision: MODEL_REVISION,
        hashAlgo: engineInfo().hashAlgo,
        seed: "0xa7f31ab",
        steps: 48,
        perfHash: actual,
      };
      mkdirSync(dirname(baselinePath), { recursive: true });
      writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
      return;
    }
    expect(baseline.version).toBe(ENGINE_VERSION);
    expect(baseline.revision).toBe(MODEL_REVISION);
    expect(
      actual,
      `perf hash changed from ${baseline.perfHash} to ${actual}: bump MODEL_REVISION and run npm run baseline`,
    ).toBe(baseline.perfHash);
  });

  it("reports matching engine info and a key-order-independent params digest", () => {
    expect(engineInfo()).toEqual({ version: ENGINE_VERSION, revision: MODEL_REVISION, hashAlgo: "fnv1a-32" });
    const a = paramsDigest({ b: 2, a: 1 });
    const b = paramsDigest({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(paramsDigest({ a: 2, b: 2 })).not.toBe(a);
  });
});
