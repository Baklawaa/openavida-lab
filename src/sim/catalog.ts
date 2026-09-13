/**
 * Organism catalog: one record per organism, living or dead, with the
 * filters and sort presets the explorer offers. Pure; the UI renders it.
 */
import { decodeGenome } from "./genome";
import { TRAIT_NAMES, type Phenotype, type TraitName } from "./mapping";
import { strategyOf, type Strategy } from "./species";
import type { DeathCause, DeathRecord, Organism } from "./types";
import type { World } from "./world";

export interface CatalogEntry {
  id: number;
  alive: boolean;
  genome: string;
  ph: Phenotype;
  strainId: number;
  strategy: Strategy;
  lineageId: number;
  parentId: number;
  bornTick: number;
  age: number;
  deathTick: number | null;
  cause: DeathCause | null;
  fitness: number;
  energy: number | null;
  kills: number;
  births: number;
  mass: number;
  x: number;
  y: number;
}

export type Liveness = "all" | "alive" | "dead";

export interface CatalogFilter {
  liveness: Liveness;
  strainId?: number;
  strategy?: Strategy;
  lineageId?: number;
  cause?: DeathCause;
  minAge?: number;
  maxAge?: number;
  minKills?: number;
  minBirths?: number;
  minFitness?: number;
  /** Trait ≥ value, e.g. { trait: "resist", min: 0.5 }. */
  trait?: { trait: TraitName; min: number };
  /** Substring of the genome (ACGT). */
  genome?: string;
  /** Free text over id, lineage and strain id. */
  text?: string;
}

export const DEFAULT_FILTER: CatalogFilter = { liveness: "all" };

export type CatalogSort =
  | "died-fastest"
  | "died-slowest"
  | "longest-lived"
  | "youngest"
  | "best-fitness"
  | "worst-fitness"
  | "most-kills"
  | "most-births"
  | "most-mass"
  | "most-energy"
  | "newest"
  | "oldest"
  | `trait:${TraitName}`;

/**
 * Sort presets, in menu order. Ids only: the interface renders each label from
 * the locale catalog (`sim.sort.<id>`, and `sim.sort.trait` for the trait
 * presets, whose id is `trait:<trait>`).
 */
export const CATALOG_SORTS: Array<{ id: CatalogSort }> = [
  { id: "died-fastest" },
  { id: "died-slowest" },
  { id: "longest-lived" },
  { id: "youngest" },
  { id: "best-fitness" },
  { id: "worst-fitness" },
  { id: "most-kills" },
  { id: "most-births" },
  { id: "most-mass" },
  { id: "most-energy" },
  { id: "newest" },
  { id: "oldest" },
  ...TRAIT_NAMES.filter((t) => t !== "hue").map((t) => ({ id: `trait:${t}` as CatalogSort })),
];

const phenotypeCache = new Map<string, Phenotype>();
function phenotypeOf(genome: string): Phenotype {
  let p = phenotypeCache.get(genome);
  if (!p) {
    p = decodeGenome(genome).phenotype;
    if (phenotypeCache.size > 5000) phenotypeCache.clear();
    phenotypeCache.set(genome, p);
  }
  return p;
}

export function entryFromOrganism(o: Organism, tick: number, predationThreshold: number): CatalogEntry {
  return {
    id: o.id,
    alive: true,
    genome: o.genome,
    ph: o.ph,
    strainId: o.strainId,
    strategy: strategyOf(o.ph, predationThreshold),
    lineageId: o.lineageId,
    parentId: o.parentId,
    bornTick: tick - o.age,
    age: o.age,
    deathTick: null,
    cause: null,
    fitness: o.fitness,
    energy: o.energy,
    kills: o.kills ?? 0,
    births: o.births ?? 0,
    mass: o.mass ?? 0,
    x: o.x,
    y: o.y,
  };
}

export function entryFromDeath(d: DeathRecord, predationThreshold: number): CatalogEntry {
  const ph = phenotypeOf(d.genome);
  const age = d.age ?? 0;
  return {
    id: d.orgId,
    alive: false,
    genome: d.genome,
    ph,
    strainId: d.strainId ?? 0,
    strategy: strategyOf(ph, predationThreshold),
    lineageId: d.lineageId,
    parentId: d.parentId ?? -1,
    bornTick: d.tick - age,
    age,
    deathTick: d.tick,
    cause: d.cause,
    fitness: d.fitness,
    energy: null,
    kills: d.kills ?? 0,
    births: d.births ?? 0,
    mass: d.mass ?? 0,
    x: d.x,
    y: d.y,
  };
}

export function buildCatalog(world: World): CatalogEntry[] {
  const th = world.params.predationThreshold;
  const out = world.organisms.map((o) => entryFromOrganism(o, world.tick, th));
  for (const d of world.deaths) out.push(entryFromDeath(d, th));
  return out;
}

export function applyFilter(entries: readonly CatalogEntry[], f: CatalogFilter): CatalogEntry[] {
  const genome = f.genome?.toUpperCase().replace(/[^ACGT]/g, "") ?? "";
  const text = f.text?.trim().toLowerCase() ?? "";
  return entries.filter((e) => {
    if (f.liveness === "alive" && !e.alive) return false;
    if (f.liveness === "dead" && e.alive) return false;
    if (f.strainId !== undefined && e.strainId !== f.strainId) return false;
    if (f.strategy !== undefined && e.strategy !== f.strategy) return false;
    if (f.lineageId !== undefined && e.lineageId !== f.lineageId) return false;
    if (f.cause !== undefined && e.cause !== f.cause) return false;
    if (f.minAge !== undefined && e.age < f.minAge) return false;
    if (f.maxAge !== undefined && e.age > f.maxAge) return false;
    if (f.minKills !== undefined && e.kills < f.minKills) return false;
    if (f.minBirths !== undefined && e.births < f.minBirths) return false;
    if (f.minFitness !== undefined && e.fitness < f.minFitness) return false;
    if (f.trait && e.ph[f.trait.trait] < f.trait.min) return false;
    if (genome && !e.genome.includes(genome)) return false;
    if (text && !`${e.id} l${e.lineageId} s${e.strainId} ${e.cause ?? ""}`.includes(text)) return false;
    return true;
  });
}

export function sortCatalog(entries: readonly CatalogEntry[], sort: CatalogSort): CatalogEntry[] {
  const out = entries.slice();
  const dead = (e: CatalogEntry) => (e.alive ? 1 : 0);
  const cmp: (a: CatalogEntry, b: CatalogEntry) => number = sort.startsWith("trait:")
    ? ((t: TraitName) => (a, b) => b.ph[t] - a.ph[t])(sort.slice(6) as TraitName)
    : sort === "died-fastest" ? (a, b) => dead(a) - dead(b) || a.age - b.age
      : sort === "died-slowest" ? (a, b) => dead(a) - dead(b) || b.age - a.age
        : sort === "longest-lived" ? (a, b) => b.age - a.age
          : sort === "youngest" ? (a, b) => a.age - b.age
            : sort === "best-fitness" ? (a, b) => b.fitness - a.fitness
              : sort === "worst-fitness" ? (a, b) => a.fitness - b.fitness
                : sort === "most-kills" ? (a, b) => b.kills - a.kills || b.fitness - a.fitness
                  : sort === "most-births" ? (a, b) => b.births - a.births || b.age - a.age
                    : sort === "most-mass" ? (a, b) => b.mass - a.mass
                      : sort === "most-energy" ? (a, b) => (b.energy ?? -1) - (a.energy ?? -1)
                        : sort === "newest" ? (a, b) => b.bornTick - a.bornTick
                          : (a, b) => a.bornTick - b.bornTick;
  return out.sort((a, b) => cmp(a, b) || a.id - b.id);
}

export type GroupMode = "strain" | "strategy" | "lineage" | "none";

export interface CatalogGroup {
  key: string;
  entries: CatalogEntry[];
  alive: number;
  meanFitness: number;
}

export function groupCatalog(entries: readonly CatalogEntry[], mode: GroupMode): CatalogGroup[] {
  const map = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const key = mode === "strain" ? String(e.strainId) : mode === "strategy" ? e.strategy : mode === "lineage" ? String(e.lineageId) : "all";
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      entries: list,
      alive: list.filter((e) => e.alive).length,
      meanFitness: list.reduce((s, e) => s + e.fitness, 0) / list.length,
    }))
    .sort((a, b) => b.entries.length - a.entries.length);
}

/** Quick "records": the organism that is the extreme of each preset (null when the catalog is empty). */
export function catalogRecords(entries: readonly CatalogEntry[]): Array<{ sort: CatalogSort; entry: CatalogEntry }> {
  const out: Array<{ sort: CatalogSort; entry: CatalogEntry }> = [];
  for (const s of CATALOG_SORTS) {
    const pool = s.id === "died-fastest" || s.id === "died-slowest" ? entries.filter((e) => !e.alive) : s.id === "most-energy" ? entries.filter((e) => e.alive) : entries;
    const top = sortCatalog(pool, s.id)[0];
    if (top) out.push({ sort: s.id, entry: top });
  }
  return out;
}
