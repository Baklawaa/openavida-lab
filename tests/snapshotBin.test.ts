/**
 * Binary snapshot container: exact round trip, bounded size, explicit errors.
 */
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_BIN_MAGIC,
  World,
  decodeSnapshot,
  encodeSnapshot,
  founderHeterotroph,
  founderPhototroph,
  worldFromSnapshot,
} from "../src/sim/index";
import { migrateSnapshot } from "../src/sim/migrate";

function sampleWorld(): World {
  const w = new World({ width: 16, height: 16, seed: 12, startPopulation: 0 });
  w.fields.nutrient.fill(0.4);
  w.fields.light.fill(0.7);
  w.injectStrain(founderHeterotroph(), 10);
  w.injectStrain(founderPhototroph(), 6);
  for (let i = 0; i < 12; i++) w.step();
  return w;
}

describe("binary snapshot container", () => {
  it("round-trips to the same world hash", () => {
    const w = sampleWorld();
    const buf = encodeSnapshot(w.snapshot());
    const decoded = decodeSnapshot(buf);
    expect(decoded.tick).toBe(w.tick);
    expect(decoded.organisms.length).toBe(w.organisms.length);
    expect(worldFromSnapshot(decoded).hashState()).toBe(w.hashState());
  });

  it("is smaller than the JSON payload for the same snapshot", () => {
    const w = sampleWorld();
    const snap = w.snapshot();
    const bin = encodeSnapshot(snap).byteLength;
    const json = JSON.stringify(snap).length;
    expect(bin).toBeLessThan(json);
  });

  it("fills exudate for legacy payloads that lack it", () => {
    const w = sampleWorld();
    const legacy = migrateSnapshot(JSON.parse(JSON.stringify(w.snapshot())) as unknown);
    delete (legacy as { exudate?: number[] }).exudate;
    const decoded = decodeSnapshot(encodeSnapshot(legacy));
    expect(decoded.exudate!.length).toBe(decoded.params.width * decoded.params.height);
    expect(decoded.exudate!.every((v) => v === 0)).toBe(true);
    expect(worldFromSnapshot(decoded).hashState()).toBe(worldFromSnapshot(legacy).hashState());
  });

  it("rejects a buffer that is not an OpenAvida snapshot", () => {
    expect(() => decodeSnapshot(new ArrayBuffer(32))).toThrow(/OpenAvida/);
    const buf = encodeSnapshot(sampleWorld().snapshot());
    new DataView(buf).setUint32(0, SNAPSHOT_BIN_MAGIC + 1, true);
    expect(() => decodeSnapshot(buf)).toThrow(/OpenAvida/);
    const fresh = encodeSnapshot(sampleWorld().snapshot());
    new DataView(fresh).setUint32(4, 99, true);
    expect(() => decodeSnapshot(fresh)).toThrow(/newer/);
  });
});
