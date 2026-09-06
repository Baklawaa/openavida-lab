/**
 * Local presets: full world snapshots kept in this browser (IndexedDB, with an
 * in-memory fallback when IndexedDB is unavailable). Snapshots are stored as
 * structured clones, so a 128×128 world costs no JSON round trip.
 */
import type { AncestryStep, CatalogEntry, Goal, TrialConfig, TrialResult, WorldSnapshot } from "../sim/index";

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

/** The last goal run: enough to rebuild the table and replay any seed after a reload. */
export interface LastRunRecord {
  savedAt: number;
  label: string;
  snapshot: WorldSnapshot;
  goal: Goal;
  configs: TrialConfig[];
  results: TrialResult[];
  maxTicks: number;
}

/** An organism saved for later: its record, its evolutionary branch, and optionally the whole world it lived in. */
export interface SavedOrganism {
  id: string;
  name: string;
  savedAt: number;
  source: { world: "A" | "B"; tick: number; seed: number; label: string };
  entry: CatalogEntry;
  ancestry: AncestryStep[];
  strainName: string;
  snapshot?: WorldSnapshot;
}

export type SavedOrganismMeta = Omit<SavedOrganism, "snapshot" | "ancestry"> & { hasSnapshot: boolean; steps: number };

/** Reserved ids (never listed as presets). */
const LAST_RUN_ID = "__last-run__";

const DB_NAME = "openavida-lab";
const DB_VERSION = 2;
const STORE = "presets";
const ORG_STORE = "organisms";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ORG_STORE)) db.createObjectStore(ORG_STORE, { keyPath: "id" });
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
  private readonly memoryOrganisms = new Map<string, SavedOrganism>();

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
    return records.filter((r) => !r.id.startsWith("__")).map(presetMeta).sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------- saved organisms ---------- */

  async saveOrganism(rec: SavedOrganism): Promise<void> {
    const db = await this.open();
    if (db) {
      try {
        await request(db.transaction(ORG_STORE, "readwrite").objectStore(ORG_STORE).put(rec));
        return;
      } catch {
        /* fall through */
      }
    }
    this.memoryOrganisms.set(rec.id, rec);
  }

  async listOrganisms(): Promise<SavedOrganismMeta[]> {
    const db = await this.open();
    let records: SavedOrganism[] = [...this.memoryOrganisms.values()];
    if (db) {
      try {
        records = await request(db.transaction(ORG_STORE, "readonly").objectStore(ORG_STORE).getAll() as IDBRequest<SavedOrganism[]>);
      } catch {
        /* keep memory */
      }
    }
    return records
      .map(({ snapshot, ancestry, ...meta }) => ({ ...meta, hasSnapshot: Boolean(snapshot), steps: ancestry.length }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async loadOrganism(id: string): Promise<SavedOrganism | null> {
    const db = await this.open();
    if (db) {
      try {
        const rec = (await request(db.transaction(ORG_STORE, "readonly").objectStore(ORG_STORE).get(id) as IDBRequest<SavedOrganism | undefined>)) ?? null;
        if (rec) return rec;
      } catch {
        /* fall through */
      }
    }
    return this.memoryOrganisms.get(id) ?? null;
  }

  async removeOrganism(id: string): Promise<void> {
    this.memoryOrganisms.delete(id);
    const db = await this.open();
    if (!db) return;
    try {
      await request(db.transaction(ORG_STORE, "readwrite").objectStore(ORG_STORE).delete(id));
    } catch {
      /* ignore */
    }
  }

  async saveLastRun(run: LastRunRecord): Promise<void> {
    const rec = { id: LAST_RUN_ID, ...run };
    const db = await this.open();
    if (db) {
      try {
        await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(rec));
        return;
      } catch {
        /* fall through to memory */
      }
    }
    this.memory.set(LAST_RUN_ID, rec as unknown as PresetRecord);
  }

  async loadLastRun(): Promise<LastRunRecord | null> {
    const db = await this.open();
    if (db) {
      try {
        const rec = (await request(db.transaction(STORE, "readonly").objectStore(STORE).get(LAST_RUN_ID) as IDBRequest<(LastRunRecord & { id: string }) | undefined>)) ?? null;
        if (rec) return rec;
      } catch {
        /* fall through */
      }
    }
    return (this.memory.get(LAST_RUN_ID) as unknown as LastRunRecord | undefined) ?? null;
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
