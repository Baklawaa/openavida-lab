/**
 * Local presets: full world snapshots kept in this browser (IndexedDB, with an
 * in-memory fallback when IndexedDB is unavailable). Snapshots are stored as
 * structured clones, so a 128×128 world costs no JSON round trip.
 */
import type { AncestryStep, CatalogEntry, Goal, TrialConfig, TrialResult, WorldSnapshot } from "../sim/index";

import type { ExperimentRecord } from "./experimentHistory";
import { tDynamic } from "./i18n/runtime";

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
  /** Full goal list when the run used more than one objective. Absent on older records. */
  goals?: Goal[];
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
const DB_VERSION = 3;

/** Object stores of the schema, named once so the upgrade and every write agree. */
export const STORE_PRESETS = "presets";
export const STORE_ORGANISMS = "organisms";
export const STORE_EXPERIMENTS = "experiments";
/** Every record of every store is keyed by its own id. */
export const STORE_KEY_PATH = "id";

/** The stores the schema needs, in creation order. */
export const STORE_DEFS: ReadonlyArray<{ name: string; keyPath: string }> = [
  { name: STORE_PRESETS, keyPath: STORE_KEY_PATH },
  { name: STORE_ORGANISMS, keyPath: STORE_KEY_PATH },
  { name: STORE_EXPERIMENTS, keyPath: STORE_KEY_PATH },
];

/**
 * Create only the stores the schema is missing, and return the names created.
 * An upgrade must never recreate a store it already has: `createObjectStore`
 * would add a second, empty store under the same name and take the presets,
 * organisms or runs held by a v1 or v2 database with it.
 */
export function ensureStores(db: Pick<IDBDatabase, "objectStoreNames" | "createObjectStore">): string[] {
  const created: string[] = [];
  for (const { name, keyPath } of STORE_DEFS) {
    if (db.objectStoreNames.contains(name)) continue;
    db.createObjectStore(name, { keyPath });
    created.push(name);
  }
  return created;
}

/** A write the browser refused. Quota is the one the user can act on. */
export interface StoreProblem {
  kind: "quota";
  /** Name of the record that was refused, for the message. */
  label: string;
}

export type StoreProblemListener = (problem: StoreProblem) => void;

/** Quota is a DOMException in browsers but a plain object in some test doubles: match on the name. */
export function isQuotaExceeded(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "QuotaExceededError";
}

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
      ensureStores(req.result);
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
  private readonly memoryExperiments = new Map<string, ExperimentRecord>();
  private readonly problemListeners = new Set<StoreProblemListener>();

  /** Subscribe to refused writes; the panel turns them into catalog copy. Returns the unsubscribe. */
  onProblem(listener: StoreProblemListener): () => void {
    this.problemListeners.add(listener);
    return () => {
      this.problemListeners.delete(listener);
    };
  }

  private report(problem: StoreProblem): void {
    for (const listener of this.problemListeners) listener(problem);
  }

  private open(): Promise<IDBDatabase | null> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  /** True when the database opened: what is written survives a reload. False means this tab only. */
  async isDurable(): Promise<boolean> {
    return (await this.open()) !== null;
  }

  async list(): Promise<PresetMeta[]> {
    const db = await this.open();
    let records: PresetRecord[];
    if (!db) records = [...this.memory.values()];
    else {
      try {
        records = await request(db.transaction(STORE_PRESETS, "readonly").objectStore(STORE_PRESETS).getAll() as IDBRequest<PresetRecord[]>);
      } catch {
        records = [...this.memory.values()];
      }
    }
    return records.filter((r) => !r.id.startsWith("__")).map(presetMeta).sort((a, b) => b.createdAt - a.createdAt);
  }

  /* ---------- saved organisms ---------- */

  /** Returns false when the browser refused the write (quota): nothing was stored. */
  async saveOrganism(rec: SavedOrganism): Promise<boolean> {
    const db = await this.open();
    if (db) {
      try {
        await request(db.transaction(STORE_ORGANISMS, "readwrite").objectStore(STORE_ORGANISMS).put(rec));
        return true;
      } catch (err) {
        if (isQuotaExceeded(err)) {
          // A refused record must not look saved: report it and cache nothing.
          this.report({ kind: "quota", label: rec.name });
          return false;
        }
        /* fall through */
      }
    }
    this.memoryOrganisms.set(rec.id, rec);
    return true;
  }

  async listOrganisms(): Promise<SavedOrganismMeta[]> {
    const db = await this.open();
    let records: SavedOrganism[] = [...this.memoryOrganisms.values()];
    if (db) {
      try {
        records = await request(db.transaction(STORE_ORGANISMS, "readonly").objectStore(STORE_ORGANISMS).getAll() as IDBRequest<SavedOrganism[]>);
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
        const rec = (await request(db.transaction(STORE_ORGANISMS, "readonly").objectStore(STORE_ORGANISMS).get(id) as IDBRequest<SavedOrganism | undefined>)) ?? null;
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
      await request(db.transaction(STORE_ORGANISMS, "readwrite").objectStore(STORE_ORGANISMS).delete(id));
    } catch {
      /* ignore */
    }
  }

  /* ---------- experiment journal ---------- */

  /**
   * Store one run. Resolves false when the browser refused it (quota), so the
   * caller can avoid claiming it was kept; a refused record is never cached.
   */
  async saveExperiment(record: ExperimentRecord): Promise<boolean> {
    const db = await this.open();
    if (db) {
      try {
        await request(db.transaction(STORE_EXPERIMENTS, "readwrite").objectStore(STORE_EXPERIMENTS).put(record));
        return true;
      } catch (err) {
        if (isQuotaExceeded(err)) {
          this.report({ kind: "quota", label: record.name });
          return false;
        }
        /* fall through to memory */
      }
    }
    this.memoryExperiments.set(record.id, record);
    return true;
  }

  /** Stored runs, newest first. */
  async listExperiments(): Promise<ExperimentRecord[]> {
    const db = await this.open();
    let records: ExperimentRecord[] = [...this.memoryExperiments.values()];
    if (db) {
      try {
        records = await request(db.transaction(STORE_EXPERIMENTS, "readonly").objectStore(STORE_EXPERIMENTS).getAll() as IDBRequest<ExperimentRecord[]>);
      } catch {
        /* keep memory */
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getExperiment(id: string): Promise<ExperimentRecord | null> {
    const db = await this.open();
    if (db) {
      try {
        const rec = (await request(db.transaction(STORE_EXPERIMENTS, "readonly").objectStore(STORE_EXPERIMENTS).get(id) as IDBRequest<ExperimentRecord | undefined>)) ?? null;
        if (rec) return rec;
      } catch {
        /* fall through */
      }
    }
    return this.memoryExperiments.get(id) ?? null;
  }

  async removeExperiment(id: string): Promise<void> {
    this.memoryExperiments.delete(id);
    const db = await this.open();
    if (!db) return;
    try {
      await request(db.transaction(STORE_EXPERIMENTS, "readwrite").objectStore(STORE_EXPERIMENTS).delete(id));
    } catch {
      /* ignore */
    }
  }

  async saveLastRun(run: LastRunRecord): Promise<void> {
    const rec = { id: LAST_RUN_ID, ...run };
    const db = await this.open();
    if (db) {
      try {
        await request(db.transaction(STORE_PRESETS, "readwrite").objectStore(STORE_PRESETS).put(rec));
        return;
      } catch (err) {
        if (isQuotaExceeded(err)) {
          // The previous last run (if any) stays in place; the refused one is cached nowhere.
          this.report({ kind: "quota", label: run.label });
          return;
        }
        /* fall through to memory */
      }
    }
    this.memory.set(LAST_RUN_ID, rec as unknown as PresetRecord);
  }

  async loadLastRun(): Promise<LastRunRecord | null> {
    const db = await this.open();
    if (db) {
      try {
        const rec = (await request(db.transaction(STORE_PRESETS, "readonly").objectStore(STORE_PRESETS).get(LAST_RUN_ID) as IDBRequest<(LastRunRecord & { id: string }) | undefined>)) ?? null;
        if (rec) return rec;
      } catch {
        /* fall through */
      }
    }
    return (this.memory.get(LAST_RUN_ID) as unknown as LastRunRecord | undefined) ?? null;
  }

  /** Returns null when the browser refused the write (quota): nothing was stored. */
  async save(name: string, snapshot: WorldSnapshot, world: "A" | "B"): Promise<PresetMeta | null> {
    const rec: PresetRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || tDynamic("render.preset.defaultName", { tick: snapshot.tick }),
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
        await request(db.transaction(STORE_PRESETS, "readwrite").objectStore(STORE_PRESETS).put(rec));
        return presetMeta(rec);
      } catch (err) {
        if (isQuotaExceeded(err)) {
          // The list reads storage, so a refused preset simply does not appear; cache nothing.
          this.report({ kind: "quota", label: rec.name });
          return null;
        }
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
        const rec = (await request(db.transaction(STORE_PRESETS, "readonly").objectStore(STORE_PRESETS).get(id) as IDBRequest<PresetRecord | undefined>)) ?? null;
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
      await request(db.transaction(STORE_PRESETS, "readwrite").objectStore(STORE_PRESETS).delete(id));
    } catch {
      /* ignore */
    }
  }
}
