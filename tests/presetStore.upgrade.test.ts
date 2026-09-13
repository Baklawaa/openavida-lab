// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  World,
  makeManifest,
  normalizeParams,
  summarizeTrials,
  type TrialResult,
} from "../src/sim/index";
import { recordFromRun, type ExperimentRecord } from "../src/ui/experimentHistory";
import { GoalPanel } from "../src/ui/goalPanel";
import { tDynamic } from "../src/ui/i18n/runtime";
import {
  PresetStore,
  STORE_DEFS,
  STORE_EXPERIMENTS,
  STORE_KEY_PATH,
  STORE_ORGANISMS,
  STORE_PRESETS,
  ensureStores,
  isQuotaExceeded,
  type SavedOrganism,
  type StoreProblem,
} from "../src/ui/presetStore";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/* ---------- the upgrade path ---------- */

interface CreatedStore {
  name: string;
  keyPath: unknown;
}

/** The two members ensureStores uses, with a real upgrade's refusal to overwrite an existing store. */
function fakeSchemaDb(existing: readonly string[]) {
  const names = new Set(existing);
  const created: CreatedStore[] = [];
  const db = {
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore: (name: string, options?: { keyPath?: unknown }) => {
      // A real createObjectStore throws on a name that is already there: keeping that
      // here makes a recreate bug fail loudly instead of silently wiping the data.
      if (names.has(name)) throw new Error(`store "${name}" already exists`);
      names.add(name);
      created.push({ name, keyPath: options?.keyPath });
      return {};
    },
  };
  return { db: db as unknown as Pick<IDBDatabase, "objectStoreNames" | "createObjectStore">, created, names };
}

describe("ensureStores", () => {
  it("creates the three stores of a fresh database, keyed by the schema", () => {
    const { db, created } = fakeSchemaDb([]);
    expect(ensureStores(db)).toEqual([STORE_PRESETS, STORE_ORGANISMS, STORE_EXPERIMENTS]);
    expect(created.map((s) => s.name)).toEqual([STORE_PRESETS, STORE_ORGANISMS, STORE_EXPERIMENTS]);
    for (const store of created) expect(store.keyPath).toBe(STORE_KEY_PATH);
  });

  it("gives a v1 database the organism and experiment stores only", () => {
    const { db, created, names } = fakeSchemaDb([STORE_PRESETS]);
    expect(ensureStores(db)).toEqual([STORE_ORGANISMS, STORE_EXPERIMENTS]);
    expect(created.map((s) => s.name)).toEqual([STORE_ORGANISMS, STORE_EXPERIMENTS]);
    expect(names.has(STORE_PRESETS)).toBe(true);
  });

  it("gives a v2 database the experiment store only", () => {
    const { db, created } = fakeSchemaDb([STORE_PRESETS, STORE_ORGANISMS]);
    expect(ensureStores(db)).toEqual([STORE_EXPERIMENTS]);
    expect(created.map((s) => s.name)).toEqual([STORE_EXPERIMENTS]);
  });

  it("never recreates an existing store", () => {
    const { db, created } = fakeSchemaDb([STORE_PRESETS, STORE_ORGANISMS, STORE_EXPERIMENTS]);
    expect(ensureStores(db)).toEqual([]);
    expect(created).toEqual([]);
    expect(() => ensureStores(db)).not.toThrow();
  });

  it("names and keys every store through the exported constants", () => {
    // The literals live in the exported constants once, and ensureStores follows STORE_DEFS:
    // a rename cannot drift from what the writes open.
    expect([STORE_PRESETS, STORE_ORGANISMS, STORE_EXPERIMENTS]).toEqual(["presets", "organisms", "experiments"]);
    expect(STORE_KEY_PATH).toBe("id");
    expect(STORE_DEFS.map((s) => s.name)).toEqual([STORE_PRESETS, STORE_ORGANISMS, STORE_EXPERIMENTS]);
    for (const def of STORE_DEFS) expect(def.keyPath).toBe(STORE_KEY_PATH);
    const { db, created } = fakeSchemaDb([]);
    ensureStores(db);
    expect(created).toEqual(STORE_DEFS.map((s) => ({ name: s.name, keyPath: s.keyPath })));
  });
});

/* ---------- a database that runs for real ---------- */

/** Request stub: the store only sets onsuccess/onerror and reads result/error. */
class FakeRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  result: unknown = undefined;
  error: unknown = null;

  succeed(result: unknown): void {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }

  fail(error: unknown): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

function quotaError(): Error {
  return Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" });
}

/**
 * The smallest IndexedDB the store talks to: named object stores over maps, an
 * open that fires the upgrade, and a put() that can be told to fail the way a
 * full browser does.
 */
function fakeIndexedDb(opts: { existing?: readonly string[]; seed?: Record<string, unknown[]>; putError?: unknown } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  for (const name of opts.existing ?? []) stores.set(name, new Map());
  for (const [name, records] of Object.entries(opts.seed ?? {})) {
    const map = stores.get(name) ?? new Map<string, unknown>();
    for (const record of records) map.set((record as { id: string }).id, record);
    stores.set(name, map);
  }
  const records = (name: string): Map<string, unknown> => {
    const map = stores.get(name);
    if (!map) throw new Error(`store "${name}" does not exist`);
    return map;
  };
  const objectStore = (name: string) => ({
    put(value: { id: string }) {
      const req = new FakeRequest();
      if (opts.putError) req.fail(opts.putError);
      else req.succeed(records(name).set(value.id, value));
      return req;
    },
    get(id: string) {
      const req = new FakeRequest();
      req.succeed(records(name).get(id));
      return req;
    },
    getAll() {
      const req = new FakeRequest();
      req.succeed([...records(name).values()]);
      return req;
    },
    delete(id: string) {
      records(name).delete(id);
      const req = new FakeRequest();
      req.succeed(undefined);
      return req;
    },
  });
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.set(name, new Map());
      return objectStore(name);
    },
    transaction: (name: string) => ({ objectStore: () => objectStore(name) }),
  };
  const factory = {
    open: () => {
      const req = new FakeRequest();
      queueMicrotask(() => {
        req.result = db;
        // A database older than DB_VERSION fires the upgrade before it opens.
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory, stores };
}

function watch(store: PresetStore): StoreProblem[] {
  const problems: StoreProblem[] = [];
  store.onProblem((problem) => problems.push(problem));
  return problems;
}

function trialResult(seed: number): TrialResult {
  return {
    seed,
    startTick: 0,
    ticks: 6,
    reachedTick: 6,
    reachedTicks: [6],
    finalValue: 1,
    finalPopulation: 4,
    extinct: false,
    unreachable: false,
    series: [[0, 1]],
    finalHash: "abc12345",
  };
}

function experiment(name: string): ExperimentRecord {
  const results = [trialResult(7)];
  const manifest = makeManifest({
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    params: normalizeParams({ width: 8, height: 8, seed: 3, startPopulation: 4 }),
    goals: [{ metric: { kind: "population" }, op: ">=", target: 1, sustain: 1 }],
    run: { replicates: 1, seed: 7, maxTicks: 6, sampleEvery: 1 },
  });
  return recordFromRun({ manifest, results, summary: summarizeTrials(results) });
}

function organism(name: string): SavedOrganism {
  // The store needs the identity fields only; the catalogue entry is opaque to it.
  return {
    id: `org-${name}`,
    name,
    savedAt: Date.now(),
    source: { world: "A", tick: 0, seed: 1, label: "world A" },
    entry: {} as SavedOrganism["entry"],
    ancestry: [],
    strainName: name,
  };
}

describe("store upgrade on open", () => {
  it("keeps a v1 database's presets while adding the new stores", async () => {
    const old = { id: "p1", name: "Ancien", createdAt: 1, tick: 3, population: 4, world: "A", width: 8, height: 8, snapshot: {} };
    const { factory, stores } = fakeIndexedDb({ existing: [STORE_PRESETS], seed: { presets: [old] } });
    vi.stubGlobal("indexedDB", factory);
    const list = await new PresetStore().list();
    expect(stores.has(STORE_ORGANISMS)).toBe(true);
    expect(stores.has(STORE_EXPERIMENTS)).toBe(true);
    expect(list.map((p) => p.name)).toEqual(["Ancien"]);
  });
});

/* ---------- quota ---------- */

describe("quota failures", () => {
  it("matches the quota by name, not by class", () => {
    expect(isQuotaExceeded(quotaError())).toBe(true);
    expect(isQuotaExceeded(new Error("quota exceeded"))).toBe(false);
    expect(isQuotaExceeded(null)).toBe(false);
    expect(isQuotaExceeded(undefined)).toBe(false);
    expect(isQuotaExceeded("QuotaExceededError")).toBe(false);
  });

  it("reports a refused experiment and caches nothing", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb({ putError: quotaError() }).factory);
    const store = new PresetStore();
    const problems = watch(store);
    const rec = experiment("Course pleine");
    await expect(store.saveExperiment(rec)).resolves.toBe(false);
    expect(problems).toEqual([{ kind: "quota", label: "Course pleine" }]);
    // No half-written record: neither the database nor the memory cache may hold it.
    expect(await store.getExperiment(rec.id)).toBeNull();
    expect(await store.listExperiments()).toEqual([]);
  });

  it("reports a refused preset, organism and last run, and keeps none of them", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb({ putError: quotaError() }).factory);
    const store = new PresetStore();
    const problems = watch(store);
    const world = new World({ width: 8, height: 8, seed: 5, startPopulation: 4 });
    // Both saves report the refusal by resolving null/false, so a caller can
    // avoid printing a success message on top of the warning.
    expect(await store.save("Grand monde", world.snapshot(), "A")).toBeNull();
    expect(await store.saveOrganism(organism("Souche A"))).toBe(false);
    await store.saveLastRun({
      savedAt: Date.now(),
      label: "Course longue",
      snapshot: world.snapshot(),
      goal: { metric: { kind: "population" }, op: ">=", target: 1, sustain: 1 },
      configs: [],
      results: [],
      maxTicks: 10,
    });
    expect(problems.map((p) => p.label)).toEqual(["Grand monde", "Souche A", "Course longue"]);
    expect(await store.list()).toEqual([]);
    expect(await store.listOrganisms()).toEqual([]);
    expect(await store.loadLastRun()).toBeNull();
  });

  it("still falls back to memory when a write fails for another reason", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb({ putError: new Error("transaction aborted") }).factory);
    const store = new PresetStore();
    const rec = experiment("Repli");
    await expect(store.saveExperiment(rec)).resolves.toBe(true);
    expect((await store.getExperiment(rec.id))!.name).toBe("Repli");
  });
});

/* ---------- availability ---------- */

function mountPanel(): { root: HTMLElement; panel: GoalPanel; statuses: string[] } {
  const root = document.createElement("div");
  document.body.append(root);
  const world = new World({ width: 8, height: 8, seed: 2, startPopulation: 4 });
  const statuses: string[] = [];
  const panel = new GoalPanel(root, {
    status: (msg) => statuses.push(msg),
    world: () => world,
    activeWorld: () => "A",
    restoreInto: vi.fn(),
    replayInto: vi.fn(),
    openCatalog: vi.fn(),
    setRecording: vi.fn(),
    applyRecipe: vi.fn(),
    reportExtras: () => ({ treePng: null }),
  });
  return { root, panel, statuses };
}

describe("storage availability", () => {
  it("tells durable storage from memory-only storage", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await new PresetStore().isDurable()).toBe(false);
    vi.stubGlobal("indexedDB", fakeIndexedDb().factory);
    expect(await new PresetStore().isDurable()).toBe(true);
  });

  it("says once, above the journal, that data is memory-only without IndexedDB", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { root, panel } = mountPanel();
    await panel.refreshHistory();
    await panel.refreshHistory();
    const notes = root.querySelectorAll("#history-storage-note");
    expect(notes.length).toBe(1);
    expect(notes[0]!.classList.contains("micro")).toBe(true);
    expect(notes[0]!.textContent).toBe(tDynamic("goal.storage.memoryOnly"));
  });

  it("shows no notice when the database opens", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb().factory);
    const { root, panel } = mountPanel();
    await panel.refreshHistory();
    expect(root.querySelector("#history-storage-note")).toBeNull();
  });

  it("puts a refused save on the panel status line", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb({ putError: quotaError() }).factory);
    const { panel, statuses } = mountPanel();
    await panel.store.saveExperiment(experiment("Course pleine"));
    expect(statuses).toContain(tDynamic("goal.storage.full", { name: "Course pleine" }));
  });
});
