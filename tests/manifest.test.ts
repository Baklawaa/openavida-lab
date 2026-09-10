import { describe, expect, it } from "vitest";
import {
  MANIFEST_VERSION,
  World,
  configsForManifest,
  makeManifest,
  manifestFromWorld,
  normalizeParams,
  startSnapshot,
  validateManifest,
} from "../src/sim/index";

const GOAL = { metric: { kind: "population" as const }, op: ">=" as const, target: 10, sustain: 1 };

function base() {
  return makeManifest({
    name: "test run",
    createdAt: "2026-01-01T00:00:00.000Z",
    params: normalizeParams({ width: 16, height: 16, seed: 3, startPopulation: 12 }),
    goals: [GOAL],
    run: { replicates: 3, seed: 100, maxTicks: 30, sampleEvery: 5 },
  });
}

describe("experiment manifest", () => {
  it("carries version, engine identity and a parameter digest", () => {
    const m = base();
    expect(m.manifestVersion).toBe(MANIFEST_VERSION);
    expect(m.engine.version).toBeTruthy();
    expect(m.paramsDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(m.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(m.start.kind).toBe("params");
  });

  it("round-trips through validation", () => {
    const m = base();
    const { manifest, errors } = validateManifest(JSON.parse(JSON.stringify(m)) as unknown);
    expect(errors).toEqual([]);
    expect(manifest!.name).toBe(m.name);
    expect(manifest!.params.width).toBe(16);
    expect(manifest!.goals).toHaveLength(1);
    expect(manifest!.run.replicates).toBe(3);
  });

  it("rejects malformed payloads with reasons", () => {
    expect(validateManifest(null).errors.length).toBeGreaterThan(0);
    expect(validateManifest({ manifestVersion: 99, name: "x", params: {}, goals: [], run: {} }).errors.length).toBeGreaterThan(0);
    const half = validateManifest({ ...base(), goals: [] });
    expect(half.manifest).toBeNull();
    expect(half.errors.join(" ")).toMatch(/goal/);
    const badRun = validateManifest({ ...base(), run: { replicates: 0, seed: 1, maxTicks: 0, sampleEvery: 1 } });
    expect(badRun.manifest).toBeNull();
    const badSchedule = validateManifest({ ...base(), schedule: [{ at: "soon" }] });
    expect(badSchedule.manifest).toBeNull();
  });

  it("derives replicate configs and marks the reference replicate", () => {
    const m = base();
    const configs = configsForManifest(m);
    expect(configs.map((c) => c.seed)).toEqual([100, 101, 102]);
    expect(configs[0]!.collectHistory).toBe(true);
    expect(configs[1]!.collectHistory).toBe(false);
    expect(configs[0]!.collectEvents).toBe(false);

    const recording = { ...m, run: { ...m.run, recordEvents: true } };
    const withEvents = configsForManifest(recording);
    expect(withEvents[0]!.overrides!.recordEvents).toBe(true);
    expect(withEvents[0]!.collectEvents).toBe(true);
    expect(withEvents[1]!.collectEvents).toBe(false);
  });

  it("builds a start snapshot for the params and snapshot kinds", () => {
    const fromParams = startSnapshot(base());
    expect(fromParams.organisms.length).toBe(12);

    const world = new World({ width: 16, height: 16, seed: 3, startPopulation: 6 });
    const fromWorld = manifestFromWorld(world, {
      name: "from world",
      createdAt: "2026-01-01T00:00:00.000Z",
      goals: [GOAL],
      run: { replicates: 1, seed: 1, maxTicks: 10, sampleEvery: 1 },
    });
    expect(fromWorld.start.kind).toBe("snapshot");
    expect(startSnapshot(fromWorld).organisms.length).toBe(6);
    expect(validateManifest(JSON.parse(JSON.stringify(fromWorld)) as unknown).errors).toEqual([]);
  });
});
