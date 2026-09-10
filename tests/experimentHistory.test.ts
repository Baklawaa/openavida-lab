import { describe, expect, it } from "vitest";
import {
  World,
  engineInfo,
  makeManifest,
  normalizeParams,
  summarizeTrials,
  type TrialResult,
} from "../src/sim/index";
import {
  HISTORY_CURVES,
  HISTORY_RESULTS_CAP,
  engineDrift,
  historyRows,
  newExperimentId,
  recordFromRun,
  sampleCurves,
} from "../src/ui/experimentHistory";
import { PresetStore } from "../src/ui/presetStore";

function result(seed: number, ticks: number | null, series: Array<[number, number]> = []): TrialResult {
  return {
    seed,
    startTick: 0,
    ticks: ticks ?? 50,
    reachedTick: ticks,
    reachedTicks: [ticks],
    finalValue: 1,
    finalPopulation: 10,
    extinct: false,
    unreachable: false,
    series,
    finalHash: "abc12345",
  };
}

function manifest(name = "journal test") {
  return makeManifest({
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    params: normalizeParams({ width: 16, height: 16, seed: 3, startPopulation: 10 }),
    goals: [{ metric: { kind: "population" }, op: ">=", target: 10, sustain: 1 }],
    run: { replicates: 4, seed: 9, maxTicks: 40, sampleEvery: 5 },
  });
}

function record(name: string, ticks: Array<number | null>) {
  const results = ticks.map((t, i) => result(100 + i, t, [[0, 1], [10, i + 1]]));
  return recordFromRun({ manifest: manifest(name), results, summary: summarizeTrials(results), createdAt: "2026-01-01T00:00:00.000Z" });
}

describe("experiment journal", () => {
  it("builds a record from a finished run", () => {
    const rec = record("A", [10, 12, 14, null]);
    expect(rec.name).toBe("A");
    expect(rec.results).toHaveLength(4);
    expect(rec.paramsDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(rec.engine.version).toBe(engineInfo().version);
    expect(rec.curves).toHaveLength(4);
    expect(rec.curves[0]).toEqual([1, 1]);
    expect(rec.summary.successes).toBe(3);
    expect(rec.id).toMatch(/^run-/);
  });

  it("caps stored replicates and sampled curves", () => {
    const many = Array.from({ length: HISTORY_RESULTS_CAP + 50 }, (_, i) => result(i, i + 1));
    const rec = recordFromRun({ manifest: manifest(), results: many, summary: summarizeTrials(many) });
    expect(rec.results).toHaveLength(HISTORY_RESULTS_CAP);
    expect(rec.curves.length).toBeLessThanOrEqual(HISTORY_CURVES);
    const curves = sampleCurves(many, 10);
    expect(curves.length).toBeLessThanOrEqual(10);
    expect(sampleCurves([], 10)).toEqual([]);
    expect(newExperimentId(1)).toMatch(/^run-1-/);
  });

  it("compares stored runs against the reference with intervals and effects", () => {
    const fast = record("rapide", [10, 11, 12, 13]);
    const slow = record("lente", [40, 42, 44, 46]);
    const rows = historyRows([fast, slow], { referenceId: fast.id, current: engineInfo() });
    expect(rows).toHaveLength(2);
    const reference = rows.find((r) => r.id === fast.id)!;
    const other = rows.find((r) => r.id === slow.id)!;
    expect(reference.effect).toBeNull();
    expect(reference.successRateCI[1]).toBeLessThanOrEqual(1);
    expect(other.effect).not.toBeNull();
    expect(other.effect!.medianShift).toBeGreaterThan(0);
    expect(other.effect!.cliffsDelta).toBe(1);
    expect(other.effect!.n).toBe(4);
    expect(other.engineMismatch).toBeNull();
    expect(historyRows([])).toEqual([]);
    expect(historyRows([fast], { referenceId: "missing" })[0]!.id).toBe(fast.id);
  });

  it("flags a run produced by another engine revision", () => {
    const rec = record("ancienne", [10, 12]);
    expect(engineDrift(rec.engine, engineInfo())).toBeNull();
    const older = { ...rec, engine: { ...rec.engine, revision: rec.engine.revision - 1 } };
    const drift = engineDrift(older.engine, engineInfo());
    expect(drift).toContain("rév.");
    const rows = historyRows([older], { current: engineInfo() });
    expect(rows[0]!.engineMismatch).toContain("≠");
  });

  it("stores, lists, updates and removes records (memory fallback)", async () => {
    const store = new PresetStore();
    const a = record("A", [10, 12]);
    const b = { ...record("B", [20, 22]), createdAt: "2026-02-01T00:00:00.000Z" };
    await store.saveExperiment(a);
    await store.saveExperiment(b);
    const list = await store.listExperiments();
    expect(list.map((r) => r.name)).toEqual(["B", "A"]);
    expect((await store.getExperiment(a.id))!.name).toBe("A");
    const updated = { ...a, notes: "note" };
    await store.saveExperiment(updated);
    expect((await store.getExperiment(a.id))!.notes).toBe("note");
    await store.removeExperiment(a.id);
    expect(await store.getExperiment(a.id)).toBeNull();
    expect((await store.listExperiments()).map((r) => r.name)).toEqual(["B"]);
  });

  it("keeps the journal independent of world snapshots", () => {
    // A record must not carry a live World; it stores plain result objects.
    const world = new World({ width: 8, height: 8, startPopulation: 4, seed: 1 });
    const rec = recordFromRun({
      manifest: manifest(),
      results: [result(1, 5)],
      summary: summarizeTrials([result(1, 5)]),
    });
    expect(world.organisms.length).toBe(4);
    expect(JSON.parse(JSON.stringify(rec)).results[0].finalHash).toBe("abc12345");
  });
});
