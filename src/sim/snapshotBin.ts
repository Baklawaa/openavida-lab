/**
 * Binary snapshot container ("OAV2").
 *
 * Layout:  magic u32 | version u32 | headerLength u32 | header JSON (UTF-8,
 *          zero-padded to 4 bytes) | 6 × Float32Array(cells) | Uint8Array(cells)
 *
 * The header carries everything except the numeric field grids, which are
 * stored as typed arrays. Fields are already Float32Array-backed in the world,
 * so the round trip is exact. Timeline stores these buffers instead of decoded
 * snapshot objects, which cuts its memory roughly fourfold.
 */
import { SNAPSHOT_VERSION, type WorldSnapshot } from "./types";

export const SNAPSHOT_BIN_MAGIC = 0x4f415632; // "OAV2" little-endian
export const SNAPSHOT_BIN_VERSION = 1;

type FieldName = "nutrient" | "toxin" | "temperature" | "light" | "exudate" | "solar";
const FIELDS: readonly FieldName[] = ["nutrient", "toxin", "temperature", "light", "exudate", "solar"];

export type SnapshotHeader = Omit<WorldSnapshot, FieldName | "terrain">;

function pad4(n: number): number {
  return (n + 3) & ~3;
}

export function encodeSnapshot(s: WorldSnapshot): ArrayBuffer {
  const { nutrient, toxin, temperature, light, exudate, solar, terrain, ...rest } = s;
  const header: SnapshotHeader = { ...rest, version: s.version ?? SNAPSHOT_VERSION };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const cells = nutrient.length;
  const headerPad = pad4(headerBytes.length);
  const total = 12 + headerPad + cells * (4 * FIELDS.length + 1);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, SNAPSHOT_BIN_MAGIC, true);
  view.setUint32(4, SNAPSHOT_BIN_VERSION, true);
  view.setUint32(8, headerBytes.length, true);
  new Uint8Array(buf, 12, headerBytes.length).set(headerBytes);
  let offset = 12 + headerPad;
  const arrays: Record<FieldName, number[] | undefined> = {
    nutrient,
    toxin,
    temperature,
    light,
    exudate,
    solar,
  };
  for (const name of FIELDS) {
    const source = arrays[name] ?? new Array(cells).fill(0);
    new Float32Array(buf, offset, cells).set(source);
    offset += cells * 4;
  }
  new Uint8Array(buf, offset, cells).set(terrain as unknown as ArrayLike<number>);
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): WorldSnapshot {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== SNAPSHOT_BIN_MAGIC) {
    throw new Error("not an OpenAvida binary snapshot");
  }
  const version = view.getUint32(4, true);
  if (version > SNAPSHOT_BIN_VERSION) {
    throw new Error(`binary snapshot version ${version} is newer than this engine (${SNAPSHOT_BIN_VERSION})`);
  }
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 12, headerLength)),
  ) as SnapshotHeader;
  const cells = header.params.width * header.params.height;
  let offset = 12 + pad4(headerLength);
  const readField = (): number[] => {
    const out = Array.from(new Float32Array(buf, offset, cells));
    offset += cells * 4;
    return out;
  };
  const nutrient = readField();
  const toxin = readField();
  const temperature = readField();
  const light = readField();
  const exudate = readField();
  const solar = readField();
  const terrain = Array.from(new Uint8Array(buf, offset, cells));
  return { ...header, nutrient, toxin, temperature, light, exudate, solar, terrain };
}
