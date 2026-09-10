import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_VERSION,
  World,
  migrateSnapshot,
  snapshotVersion,
  worldFromSnapshot,
} from "../src/sim/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v1 = JSON.parse(readFileSync(resolve(root, "tests/fixtures/snapshot-v1.json"), "utf8")) as Record<string, unknown>;

describe("snapshot migration", () => {
  it("reports versions and refuses missing or future payloads", () => {
    expect(snapshotVersion(v1)).toBe(1);
    expect(snapshotVersion({ version: SNAPSHOT_VERSION })).toBe(2);
    expect(snapshotVersion({})).toBe(-1);
    expect(snapshotVersion(null)).toBe(-1);
    expect(() => migrateSnapshot({ version: 99, params: {}, organisms: [] })).toThrow(/newer/);
    expect(() => migrateSnapshot({ params: {}, organisms: [] })).toThrow(/version/);
  });

  it("upgrades the frozen v1 fixture to a playable, deterministic world", () => {
    const snap = migrateSnapshot(v1);
    expect(snap.version).toBe(2);
    expect(snap.engine?.version).toBeTruthy();
    expect(snap.paramsDigest).toBeTruthy();
    expect(snap.organisms.length).toBeGreaterThan(0);
    for (const o of snap.organisms) expect(o.genome.length).toBeGreaterThan(0);
    const a = worldFromSnapshot(snap);
    const b = worldFromSnapshot(snap);
    for (let i = 0; i < 12; i++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
    expect(a.tick).toBe(snap.tick + 12);
    expect(a.hashState()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("fills documented defaults for legacy optional fields", () => {
    const legacy = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    const organisms = legacy.organisms as Array<Record<string, unknown>>;
    for (const o of organisms) {
      delete o.mass;
      delete o.kills;
      delete o.births;
      delete o.strainId;
    }
    delete legacy.strains;
    delete legacy.deaths;
    delete legacy.schedule;
    const snap = migrateSnapshot(legacy);
    expect(snap.organisms.every((o) => o.mass === 0 && o.kills === 0 && o.births === 0)).toBe(true);
    expect(snap.strains).toEqual([]);
    const w = worldFromSnapshot(snap);
    for (let i = 0; i < 5; i++) w.step();
    expect(w.hashState()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("round-trips a current snapshot unchanged", () => {
    const w = new World({ width: 16, height: 16, seed: 3, startPopulation: 8 });
    const snap = w.snapshot();
    expect(snap.version).toBe(SNAPSHOT_VERSION);
    const again = migrateSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(again).toEqual(snap);
  });
});
