/**
 * Species / group tracking.
 *
 * Two groupings, both derived from existing state so the seeded core stays
 * identical (no RNG draws here):
 *
 * - Strain: the founding genome. Every founder (placed, injected, restored)
 *   is tagged with the strain whose signature matches its genome; children,
 *   mutants included, inherit the tag. Strains can be pre-defined by name.
 * - Strategy: a deterministic classification of the current phenotype
 *   (predator / mutualist = exudate consumer / phototroph / heterotroph / mixotroph).
 *
 * Innovations are births whose phenotype differs from the parent's by more
 * than a per-trait threshold; their spread is the number of living
 * descendants of the lineage that mutation created.
 */
import { centroidSpread } from "./geometry";
import { TRAIT_NAMES, type Phenotype, type TraitName } from "./mapping";
import type { DeathCause, DeathRecord, EnvSample, LineageNode, MetricsSample, MutationKind, Organism } from "./types";

export interface Strain {
  id: number;
  name: string;
  color: string;
  genome: string;
  signature: string;
  bornTick: number;
  /** Defined by the user before placement (vs. auto-created at first birth). */
  manual: boolean;
  founderPhenotype: Phenotype;
}

export interface TraitChange {
  trait: TraitName;
  from: number;
  to: number;
}

export interface Innovation {
  id: number;
  strainId: number;
  tick: number;
  orgId: number;
  parentOrgId: number;
  lineageId: number;
  kind: MutationKind;
  changes: TraitChange[];
  /** Local environment where the mutant was born. */
  env: EnvSample;
  /** Parent genome at birth (≤ MAX_GENOME). Optional on legacy snapshots. */
  parentGenome?: string;
  /** Mutant genome at birth (≤ MAX_GENOME). Optional on legacy snapshots. */
  genome?: string;
}

export const STRAIN_COLORS = [
  "#3ee0c0", "#f0d35a", "#ff6b8a", "#6ea8ff", "#c87bff", "#ff9d45", "#9dffb0", "#e8c4ff", "#57c7ff", "#ffd1a1",
] as const;

export interface StrainTrackPoint {
  tick: number;
  cx: number;
  cy: number;
  spread: number;
  temperature: number;
  nutrient: number;
}

/** Sampled centroid path for one strain. `every` keeps every n-th history row plus the last. */
export function strainTrack(
  history: readonly MetricsSample[],
  strainId: string | number,
  every: number,
): StrainTrackPoint[] {
  const key = String(strainId);
  const step = Math.max(1, every | 0);
  const out: StrainTrackPoint[] = [];
  const last = history.length - 1;
  for (let i = 0; i < history.length; i++) {
    if (i !== last && i % step !== 0) continue;
    const t = history[i]!.strainTracks?.[key];
    if (!t) continue;
    out.push({
      tick: history[i]!.tick,
      cx: t[0],
      cy: t[1],
      spread: t[2],
      temperature: t[3],
      nutrient: t[4],
    });
  }
  return out;
}

export function strainColor(index: number): string {
  return STRAIN_COLORS[Math.max(0, index) % STRAIN_COLORS.length]!;
}

/** Minimum phenotype delta that counts as a notable change. */
export const INNOVATION_THRESHOLD: Record<TraitName, number> = {
  uptake: 0.06, photo: 0.06, resist: 0.06, tpref: 0.05, motility: 0.05,
  aggression: 0.06, signal: 1, hue: 1e9, fecundity: 0.05, size: 0.05,
};

export function phenotypeChanges(parent: Phenotype, child: Phenotype): TraitChange[] {
  const out: TraitChange[] = [];
  for (const t of TRAIT_NAMES) {
    const d = child[t] - parent[t];
    if (Math.abs(d) >= INNOVATION_THRESHOLD[t]) out.push({ trait: t, from: parent[t], to: child[t] });
  }
  return out;
}

/* ---------- strategies ---------- */

export type Strategy = "phototroph" | "heterotroph" | "mixotroph" | "predator" | "mutualist";
export const STRATEGIES: readonly Strategy[] = ["phototroph", "heterotroph", "mixotroph", "predator", "mutualist"];
export const STRATEGY_LABEL: Record<Strategy, string> = {
  phototroph: "Phototrophes",
  heterotroph: "Hétérotrophes",
  mixotroph: "Mixotrophes",
  predator: "Prédateurs",
  mutualist: "Mutualistes",
};
export const STRATEGY_COLOR: Record<Strategy, string> = {
  phototroph: "#f0d35a",
  heterotroph: "#3ee0c0",
  mixotroph: "#9dffb0",
  predator: "#ff4d6d",
  mutualist: "#c87bff",
};

export function strategyOf(ph: Phenotype, predationThreshold = 0.26): Strategy {
  if (ph.aggression >= predationThreshold) return "predator";
  if (ph.signal >= 1) return "mutualist";
  if (ph.photo >= 0.5 && ph.uptake >= 0.5) return "mixotroph";
  return ph.photo > ph.uptake ? "phototroph" : "heterotroph";
}

/* ---------- group statistics ---------- */

export interface GroupStats {
  key: string;
  label: string;
  color: string;
  count: number;
  share: number;
  meanFitness: number;
  meanEnergy: number;
  meanAge: number;
  traits: Phenotype;
  centroid: { x: number; y: number };
  /** RMS distance to the centroid, in cells. */
  spread: number;
  env: EnvSample;
  deaths: Partial<Record<DeathCause, number>>;
  deathTotal: number;
}

export interface GroupMeta {
  label: string;
  color: string;
}

function zeroPhenotype(): Phenotype {
  const p = {} as Phenotype;
  for (const t of TRAIT_NAMES) p[t] = 0;
  return p;
}

export function groupStats(
  organisms: readonly Organism[],
  sampleEnv: (x: number, y: number) => EnvSample,
  keyOf: (o: Organism) => string,
  meta: (key: string) => GroupMeta,
  deaths: readonly DeathRecord[] = [],
  deathKeyOf: (d: DeathRecord) => string = () => "",
): GroupStats[] {
  const acc = new Map<string, { orgs: Organism[]; fit: number; energy: number; age: number; traits: Phenotype; sx: number; sy: number; env: EnvSample }>();
  for (const o of organisms) {
    const k = keyOf(o);
    let a = acc.get(k);
    if (!a) {
      a = { orgs: [], fit: 0, energy: 0, age: 0, traits: zeroPhenotype(), sx: 0, sy: 0, env: { nutrient: 0, toxin: 0, temperature: 0, light: 0, exudate: 0 } };
      acc.set(k, a);
    }
    a.orgs.push(o);
    a.fit += o.fitness;
    a.energy += o.energy;
    a.age += o.age;
    for (const t of TRAIT_NAMES) a.traits[t] += o.ph[t];
    a.sx += o.x;
    a.sy += o.y;
    const e = sampleEnv(o.x, o.y);
    a.env.nutrient += e.nutrient;
    a.env.toxin += e.toxin;
    a.env.temperature += e.temperature;
    a.env.light += e.light;
    a.env.exudate += e.exudate;
  }
  const deathAcc = new Map<string, Partial<Record<DeathCause, number>>>();
  for (const d of deaths) {
    const k = deathKeyOf(d);
    if (!k) continue;
    const m = deathAcc.get(k) ?? {};
    m[d.cause] = (m[d.cause] ?? 0) + 1;
    deathAcc.set(k, m);
  }
  const total = organisms.length;
  const out: GroupStats[] = [];
  for (const [key, a] of acc) {
    const n = a.orgs.length;
    const { cx, cy, spread } = centroidSpread(a.orgs.map((o) => o.x), a.orgs.map((o) => o.y));
    const traits = zeroPhenotype();
    for (const t of TRAIT_NAMES) traits[t] = a.traits[t] / n;
    const m = meta(key);
    const dm = deathAcc.get(key) ?? {};
    out.push({
      key,
      label: m.label,
      color: m.color,
      count: n,
      share: total ? n / total : 0,
      meanFitness: a.fit / n,
      meanEnergy: a.energy / n,
      meanAge: a.age / n,
      traits,
      centroid: { x: cx, y: cy },
      spread,
      env: { nutrient: a.env.nutrient / n, toxin: a.env.toxin / n, temperature: a.env.temperature / n, light: a.env.light / n, exudate: a.env.exudate / n },
      deaths: dm,
      deathTotal: Object.values(dm).reduce((s, v) => s + (v ?? 0), 0),
    });
  }
  return out.sort((x, y) => y.count - x.count);
}

/** Living descendants of each innovation's lineage (the lineage itself and every sub-lineage). */
export function innovationSpread(lineages: ReadonlyMap<number, LineageNode>, innovations: readonly Innovation[]): Map<number, number> {
  const children = new Map<number, number[]>();
  for (const l of lineages.values()) {
    if (l.parentId < 0) continue;
    const list = children.get(l.parentId);
    if (list) list.push(l.id);
    else children.set(l.parentId, [l.id]);
  }
  const memo = new Map<number, number>();
  const total = (id: number): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    let sum = lineages.get(id)?.count ?? 0;
    for (const c of children.get(id) ?? []) sum += total(c);
    memo.set(id, sum);
    return sum;
  };
  const out = new Map<number, number>();
  for (const inn of innovations) out.set(inn.id, total(inn.lineageId));
  return out;
}

/** Innovations of one strain, most widespread first. */
export function keyInnovations(
  innovations: readonly Innovation[],
  spread: ReadonlyMap<number, number>,
  strainId: number,
  limit = 5,
): Array<Innovation & { living: number }> {
  return innovations
    .filter((i) => i.strainId === strainId)
    .map((i) => ({ ...i, living: spread.get(i.id) ?? 0 }))
    .sort((a, b) => b.living - a.living || b.tick - a.tick)
    .slice(0, limit);
}

/** Traits whose current mean drifted from the founder by more than the innovation threshold / 2. */
export function traitDrift(founder: Phenotype, current: Phenotype): TraitChange[] {
  const out: TraitChange[] = [];
  for (const t of TRAIT_NAMES) {
    if (t === "hue") continue;
    const d = current[t] - founder[t];
    if (Math.abs(d) >= INNOVATION_THRESHOLD[t] / 2) out.push({ trait: t, from: founder[t], to: current[t] });
  }
  return out.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
}
