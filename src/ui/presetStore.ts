/**
 * Local presets: full world snapshots kept in this browser (IndexedDB, with an
 * in-memory fallback when IndexedDB is unavailable). Snapshots are stored as
 * structured clones, so a 128×128 world costs no JSON round trip.
 */
import type { WorldSnapshot } from "../sim/index";

export interface PresetMeta {
  id: string;
  name: string;
  createdAt: number;
  tick: number;
  population: number;
  world: "A" | "B";
  width: number;
  height: number;
}

export interface PresetRecord extends PresetMeta {
  snapshot: WorldSnapshot;
}

const DB_NAME = "openavida-lab";
const STORE = "presets";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function presetMeta(rec: PresetRecord): PresetMeta {
  const { snapshot: _s, ...meta } = rec;
  return meta;
}

export class PresetStore {
  private db: Promise<IDBDatabase | null> | null = null;
  private readonly memory = new Map<string, PresetRecord>();

  private open(): Promise<IDBDatabase | null> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  async list(): Promise<PresetMeta[]> {
    const db = await this.open();
    let records: PresetRecord[];
    if (!db) records = [...this.memory.values()];
    else {
      try {
        records = await request(db.transaction(STORE, "readonly").objectStore(STORE).getAll() as IDBRequest<PresetRecord[]>);
      } catch {
        records = [...this.memory.values()];
      }
    }
    return records.map(presetMeta).sort((a, b) => b.createdAt - a.createdAt);
  }

  async save(name: string, snapshot: WorldSnapshot, world: "A" | "B"): Promise<PresetMeta> {
    const rec: PresetRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || `Préréglage pas ${snapshot.tick}`,
      createdAt: Date.now(),
      tick: snapshot.tick,
      population: snapshot.organisms.length,
      world,
      width: snapshot.params.width,
      height: snapshot.params.height,
      snapshot,
    };
    const db = await this.open();
    if (db) {
      try {
        await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(rec));
        return presetMeta(rec);
      } catch {
        /* fall through to memory */
      }
    }
    this.memory.set(rec.id, rec);
    return presetMeta(rec);
  }

  async load(id: string): Promise<PresetRecord | null> {
    const db = await this.open();
    if (db) {
      try {
        const rec = (await request(db.transaction(STORE, "readonly").objectStore(STORE).get(id) as IDBRequest<PresetRecord | undefined>)) ?? null;
        if (rec) return rec;
      } catch {
        /* fall through */
      }
    }
    return this.memory.get(id) ?? null;
  }

  async remove(id: string): Promise<void> {
    this.memory.delete(id);
    const db = await this.open();
    if (!db) return;
    try {
      await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
    } catch {
      /* ignore */
    }
  }
}
