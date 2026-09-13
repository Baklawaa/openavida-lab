/**
 * World files: parseWorldBytes sniffs the container, so one import path accepts
 * both the "OAV2" binary and the JSON text written by exportJSON.
 */
import { describe, expect, it } from "vitest";
import {
  World,
  encodeSnapshot,
  exportJSON,
  founderHeterotroph,
  founderPhototroph,
  worldFromSnapshot,
} from "../src/sim/index";
import { parseWorldBytes } from "../src/sim/serialize";

function sampleWorld(): World {
  const w = new World({ width: 12, height: 12, seed: 7, startPopulation: 0 });
  w.injectStrain(founderHeterotroph(), 6);
  w.injectStrain(founderPhototroph(), 4);
  for (let i = 0; i < 8; i++) w.step();
  return w;
}

/** The bytes of a UTF-8 text file, as the browser hands them over on import. */
function utf8Bytes(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

describe("parseWorldBytes", () => {
  it("decodes an OAV2 buffer to the same world", () => {
    const w = sampleWorld();
    const parsed = parseWorldBytes(encodeSnapshot(w.snapshot()));
    expect(parsed.organisms.length).toBe(w.organisms.length);
    expect(worldFromSnapshot(parsed).hashState()).toBe(w.hashState());
  });

  it("reads the JSON export from its UTF-8 bytes", () => {
    const w = sampleWorld();
    const parsed = parseWorldBytes(utf8Bytes(exportJSON(w)));
    expect(parsed.organisms.length).toBe(w.organisms.length);
    expect(worldFromSnapshot(parsed).hashState()).toBe(w.hashState());
  });

  it("tolerates a leading BOM on the JSON form", () => {
    const w = sampleWorld();
    const parsed = parseWorldBytes(utf8Bytes("\uFEFF" + exportJSON(w)));
    expect(worldFromSnapshot(parsed).hashState()).toBe(w.hashState());
  });

  it("rejects a truncated OAV2 buffer instead of reading it as text", () => {
    const bytes = encodeSnapshot(sampleWorld().snapshot());
    expect(() => parseWorldBytes(bytes.slice(0, Math.floor(bytes.byteLength / 2)))).toThrow();
  });

  it("rejects bytes that are neither a container nor JSON", () => {
    const noise = Uint8Array.from({ length: 48 }, (_, i) => (i * 37 + 11) & 0xff);
    expect(() => parseWorldBytes(noise.buffer)).toThrow();
  });
});
