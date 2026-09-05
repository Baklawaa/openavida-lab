import { emptyNeighbor, interactNeighbors, metabolize, moveOrganisms } from "./ecology";
import { Fields } from "./fields";
import { fitness, reproduceThreshold } from "./fitness";
import {
  decodeGenome,
  founderHeterotroph,
  founderMutualist,
  founderPhototroph,
  founderPredator,
  founderResistant,
  genomeSignature,
  mutate,
  randomGenome,
} from "./genome";
import { copyPhenotype } from "./mapping";
import { parentChildEdges, sampleMetrics } from "./metrics";
import { mixSeed, Rng } from "./rng";
import {
  DEFAULT_PARAMS,
  TERRAIN,
  normalizeParams,
  type BrushKind,
  type ExtinctionRecord,
  type LineageNode,
  type MetricsSample,
  type MutationRates,
  type Organism,
  type SimParams,
  type TerrainKind,
  type WorldSnapshot,
} from "./types";

const BRUSH_TERRAIN: Partial<Record<BrushKind, TerrainKind>> = {
  barrier: TERRAIN.barrier,
  erase: TERRAIN.empty,
  nutrientVent: TERRAIN.nutrientVent,
  toxinVent: TERRAIN.toxinVent,
  thermalVent: TERRAIN.thermalVent,
  shade: TERRAIN.shade,
};

export class World {
  readonly params: SimParams;
  rng: Rng;
  tick = 0;
  fields: Fields;
  terrain: Uint8Array;
  occupancy: Int32Array;
  organisms: Organism[] = [];
  nextOrgId = 1;
  nextLineageId = 1;
  lineages = new Map<number, LineageNode>();
  extinctions: ExtinctionRecord[] = [];
  history: MetricsSample[] = [];
  lastPredation = 0;
  lastMutualism = 0;
  lastDisplacements = 0;
  lastStepMs = 0;

  constructor(partial: Partial<SimParams> = {}) {
    this.params = normalizeParams(partial);
    this.rng = new Rng(this.params.seed);
    const { width: w, height: h } = this.params;
    this.fields = new Fields(w, h);
    this.terrain = new Uint8Array(w * h);
    this.occupancy = new Int32Array(w * h);
    this.occupancy.fill(-1);
    this.seedEnvironment();
    this.seedPopulation();
    this.recordMetrics();
  }

  get w(): number {
    return this.params.width;
  }
  get h(): number {
    return this.params.height;
  }

  mutationRates(): MutationRates {
    return {
      rate: this.params.mutationRate,
      point: this.params.pointWeight,
      indel: this.params.indelWeight,
      duplication: this.params.duplicationWeight,
    };
  }

  seedEnvironment(): void {
    const { w, h, rng, fields, terrain } = this;
    for (let y = 0; y < h; y++) {
      const sun = 0.28 + 0.72 * (1 - y / Math.max(1, h - 1));
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        fields.solar[i] = sun * (0.85 + rng.next() * 0.15);
        fields.light[i] = fields.solar[i]!;
        fields.temperature[i] = 0.35 + 0.45 * (x / Math.max(1, w - 1)) + (rng.next() - 0.5) * 0.04;
        fields.nutrient[i] = 0;
        fields.toxin[i] = 0;
      }
    }
    const vents = 6 + rng.int(5);
    for (let k = 0; k < vents; k++) {
      const x = 4 + rng.int(w - 8);
      const y = 4 + rng.int(h - 8);
      const r = 2 + rng.int(4);
      this.paint(x, y, r, "nutrientVent");
      fields.addBlob("nutrient", x, y, r + 3, 0.8);
    }
    const toxN = 3 + rng.int(3);
    for (let k = 0; k < toxN; k++) {
      const x = 4 + rng.int(w - 8);
      const y = 4 + rng.int(h - 8);
      this.paint(x, y, 2, "toxinVent");
      fields.addBlob("toxin", x, y, 4, 0.55);
    }
    const hotN = 2 + rng.int(3);
    for (let k = 0; k < hotN; k++) {
      const x = Math.floor(w * 0.55) + rng.int(Math.max(1, Math.floor(w * 0.4)));
      const y = 4 + rng.int(h - 8);
      this.paint(x, y, 2, "thermalVent");
    }
    const walls = 4 + rng.int(6);
    for (let k = 0; k < walls; k++) {
      const x0 = rng.int(w);
      const y0 = rng.int(h);
      const len = 6 + rng.int(18);
      const horiz = rng.chance(0.5);
      for (let t = 0; t < len; t++) {
        const x = horiz ? x0 + t : x0;
        const y = horiz ? y0 : y0 + t;
        if (x >= 0 && y >= 0 && x < w && y < h) terrain[y * w + x] = TERRAIN.barrier;
      }
    }
    const shadeN = 2 + rng.int(3);
    for (let k = 0; k < shadeN; k++) {
      this.paint(rng.int(w), rng.int(h), 3 + rng.int(4), "shade");
    }
  }

  seedPopulation(): void {
    const founders = [
      founderPhototroph(),
      founderHeterotroph(),
      founderResistant(),
      founderPredator(),
      founderMutualist(2),
      founderMutualist(3),
    ];
    const n = this.params.startPopulation;
    for (let i = 0; i < n; i++) {
      const g =
        i < founders.length
          ? founders[i]!
          : i < founders.length + 8
            ? founders[i % founders.length]!
            : randomGenome(this.rng);
      this.spawnRandom(g, -1);
    }
  }

  spawnRandom(genome: string, parentOrgId: number): Organism | null {
    const { w, h } = this;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = this.rng.int(w);
      const y = this.rng.int(h);
      const child = this.birth(x, y, genome, null, false, 0.7);
      if (child) {
        if (parentOrgId >= 0) child.parentId = parentOrgId;
        return child;
      }
    }
    return null;
  }

  /**
   * Spawn at (x,y) with explicit lineage handling:
   * - founder: parentOrgId=-1, asNewLineage=true
   * - clone: inherit parent's lineage
   * - mutant: new lineage whose parent is the parent's lineage
   */
  birth(
    x: number,
    y: number,
    genome: string,
    parent: Organism | null,
    mutant: boolean,
    energy: number,
  ): Organism | null {
    if (this.organisms.length >= this.params.maxPopulation) return null;
    if (!this.fields.inBounds(x, y)) return null;
    const i = y * this.w + x;
    if (this.terrain[i] === TERRAIN.barrier) return null;
    if (this.occupancy[i] >= 0) return null;
    const decoded = decodeGenome(genome);
    const org: Organism = {
      id: this.nextOrgId++,
      x,
      y,
      genome: decoded.sequence,
      ph: decoded.phenotype,
      energy,
      age: 0,
      lineageId: 0,
      parentId: parent ? parent.id : -1,
      fitness: 0,
    };
    if (!parent) {
      org.lineageId = this.createLineage(-1, org);
    } else if (mutant) {
      org.lineageId = this.createLineage(parent.lineageId, org);
    } else {
      org.lineageId = parent.lineageId;
      const lin = this.lineages.get(org.lineageId);
      if (lin) {
        lin.count++;
        if (lin.count > lin.peakCount) lin.peakCount = lin.count;
      }
    }
    this.organisms.push(org);
    this.occupancy[i] = this.organisms.length - 1;
    this.refreshFitness(org);
    return org;
  }

  private createLineage(parentLineageId: number, org: Organism): number {
    const id = this.nextLineageId++;
    this.lineages.set(id, {
      id,
      parentId: parentLineageId,
      bornTick: this.tick,
      extinctTick: null,
      count: 1,
      peakCount: 1,
      hue: org.ph.hue,
      signature: genomeSignature(org.genome),
    });
    return id;
  }

  refreshFitness(org: Organism): void {
    const env = this.fields.sample(org.x, org.y);
    org.fitness = fitness(org.ph, env, { predationGain: 0, mutualismGain: 0 });
  }

  rebuildOccupancy(): void {
    this.occupancy.fill(-1);
    for (let i = 0; i < this.organisms.length; i++) {
      const o = this.organisms[i]!;
      this.occupancy[o.y * this.w + o.x] = i;
    }
  }

  step(): MetricsSample {
    const t0 =
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    this.tick++;
    this.fields.advance(this.terrain, this.params);
    const orgs = this.organisms;
    for (let i = 0; i < orgs.length; i++) {
      const o = orgs[i]!;
      o.age++;
      metabolize(o, this.fields, this.params);
      this.refreshFitness(o);
    }
    const inter = interactNeighbors(
      orgs,
      this.occupancy,
      this.w,
      this.h,
      this.rng,
      this.params,
    );
    this.lastPredation = inter.predationEvents;
    this.lastMutualism = inter.mutualismEvents;
    for (let i = 0; i < orgs.length; i++) {
      const o = orgs[i]!;
      const cap = 3.2 + 1.2 * o.ph.size;
      if (o.energy > cap) o.energy = cap;
    }
    const mv = moveOrganisms(
      orgs,
      this.occupancy,
      this.terrain,
      this.fields,
      this.w,
      this.h,
      this.rng,
    );
    this.lastDisplacements = mv.displacements;
    this.reproduceAll();
    this.reap();
    const m = this.recordMetrics();
    const t1 =
      typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    this.lastStepMs = t1 - t0;
    return m;
  }

  private reproduceAll(): void {
    const snapshot = this.organisms;
    const n = snapshot.length;
    for (let i = 0; i < n; i++) {
      const parent = snapshot[i]!;
      if (parent.energy <= 0) continue;
      const need = reproduceThreshold(parent.ph, this.params.reproduceEnergy);
      if (parent.energy < need) continue;
      if (this.organisms.length >= this.params.maxPopulation) break;
      const spot = emptyNeighbor(
        parent.x,
        parent.y,
        this.occupancy,
        this.terrain,
        this.w,
        this.h,
        this.rng,
      );
      if (!spot) continue;
      const mut = mutate(parent.genome, this.rng, this.mutationRates());
      const mutant = mut.kind !== null && mut.seq !== parent.genome;
      const childEnergy = parent.energy * 0.42;
      parent.energy *= 0.5;
      this.birth(spot.x, spot.y, mut.seq, parent, mutant, childEnergy);
    }
  }

  private reap(): void {
    const kept: Organism[] = [];
    const maxAge = this.params.maxAge;
    const counts = new Map<number, number>();
    for (const o of this.organisms) {
      if (o.energy > 0 && o.age < maxAge) {
        kept.push(o);
        counts.set(o.lineageId, (counts.get(o.lineageId) ?? 0) + 1);
      }
    }
    for (const lin of this.lineages.values()) {
      const next = counts.get(lin.id) ?? 0;
      if (lin.count > 0 && next === 0 && lin.extinctTick === null) {
        lin.extinctTick = this.tick;
        this.extinctions.push({ lineageId: lin.id, tick: this.tick, peakCount: lin.peakCount });
      }
      lin.count = next;
    }
    this.organisms = kept;
    this.rebuildOccupancy();
  }

  recordMetrics(): MetricsSample {
    const m = sampleMetrics(this.tick, this.organisms, this.lineages.values(), this.extinctions.length);
    this.history.push(m);
    if (this.history.length > 4000) this.history.splice(0, this.history.length - 3000);
    return m;
  }

  paint(cx: number, cy: number, radius: number, brush: BrushKind, amount = 0.6): void {
    const r = Math.max(0, radius);
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const terrainKind = BRUSH_TERRAIN[brush];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r2) continue;
        const i = y * this.w + x;
        if (terrainKind !== undefined) this.terrain[i] = terrainKind;
        if (brush === "nutrientBlob") this.fields.nutrient[i] = Math.min(4, this.fields.nutrient[i]! + amount);
        if (brush === "toxinBlob") this.fields.toxin[i] = Math.min(4, this.fields.toxin[i]! + amount);
        if (brush === "heatBlob") this.fields.temperature[i] = Math.min(1.5, this.fields.temperature[i]! + amount * 0.5);
        if (brush === "lightBlob") this.fields.light[i] = Math.min(2, this.fields.light[i]! + amount);
        if (brush === "wipeOrgs") {
          const oi = this.occupancy[i]!;
          if (oi >= 0 && this.organisms[oi]) this.organisms[oi]!.energy = 0;
        }
        if (brush === "erase" || (terrainKind === TERRAIN.barrier && brush === "barrier")) {
          // barrier paint already set; erase also clears occupancy optionally
        }
        if (brush === "barrier") {
          const oi = this.occupancy[i]!;
          if (oi >= 0 && this.organisms[oi]) this.organisms[oi]!.energy = 0;
        }
      }
    }
    if (brush === "wipeOrgs" || brush === "barrier") this.reap();
  }

  injectStrain(genome: string, count: number, cx?: number, cy?: number): number {
    const decoded = decodeGenome(genome);
    let placed = 0;
    let founder: Organism | null = null;
    const r = Math.max(2, Math.ceil(Math.sqrt(count)));
    for (let k = 0; k < count * 8 && placed < count; k++) {
      let x: number;
      let y: number;
      if (cx !== undefined && cy !== undefined) {
        x = Math.max(0, Math.min(this.w - 1, cx + this.rng.intRange(-r, r)));
        y = Math.max(0, Math.min(this.h - 1, cy + this.rng.intRange(-r, r)));
      } else {
        x = this.rng.int(this.w);
        y = this.rng.int(this.h);
      }
      const child = this.birth(x, y, decoded.sequence, founder, false, 0.9);
      if (child) {
        placed++;
        if (!founder) founder = child;
      }
    }
    this.rebuildOccupancy();
    return placed;
  }

  replaceGenome(orgId: number, genome: string): boolean {
    const org = this.organisms.find((o) => o.id === orgId);
    if (!org) return false;
    const decoded = decodeGenome(genome);
    org.genome = decoded.sequence;
    org.ph = decoded.phenotype;
    org.lineageId = this.createLineage(org.lineageId, org);
    this.refreshFitness(org);
    return true;
  }

  bottleneck(keepFraction: number): number {
    const keep = Math.max(0, Math.min(1, keepFraction));
    const n = this.organisms.length;
    const target = Math.floor(n * keep);
    const order = this.organisms.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    for (let k = target; k < order.length; k++) {
      this.organisms[order[k]!]!.energy = 0;
    }
    this.reap();
    return this.organisms.length;
  }

  organismAt(x: number, y: number): Organism | null {
    if (!this.fields.inBounds(x, y)) return null;
    const i = this.occupancy[y * this.w + x]!;
    if (i < 0) return null;
    return this.organisms[i] ?? null;
  }

  nearestOrganism(x: number, y: number, radius = 3): Organism | null {
    let best: Organism | null = null;
    let bestD = radius * radius + 0.01;
    for (const o of this.organisms) {
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  snapshot(): WorldSnapshot {
    return {
      version: 1,
      params: { ...this.params },
      rngState: this.rng.state(),
      tick: this.tick,
      ...this.fields.toArrays(),
      terrain: Array.from(this.terrain),
      organisms: this.organisms.map((o) => ({
        ...o,
        ph: copyPhenotype(o.ph),
      })),
      nextOrgId: this.nextOrgId,
      nextLineageId: this.nextLineageId,
      lineages: Array.from(this.lineages.values()).map((l) => ({ ...l })),
      extinctions: this.extinctions.map((e) => ({ ...e })),
      history: this.history.map((h) => ({ ...h })),
    };
  }

  restore(snap: WorldSnapshot): void {
    this.rng.setState(snap.rngState);
    this.tick = snap.tick;
    this.fields.fromArrays(snap);
    this.terrain.set(snap.terrain);
    this.organisms = snap.organisms.map((o) => ({
      ...o,
      ph: copyPhenotype(o.ph),
    }));
    this.nextOrgId = snap.nextOrgId;
    this.nextLineageId = snap.nextLineageId;
    this.lineages = new Map(snap.lineages.map((l) => [l.id, { ...l }]));
    this.extinctions = snap.extinctions.map((e) => ({ ...e }));
    this.history = snap.history.map((h) => ({ ...h }));
    this.rebuildOccupancy();
  }

  cloneWorld(): World {
    const w = new World({ ...this.params, startPopulation: 0 });
    w.restore(this.snapshot());
    return w;
  }

  hashState(): string {
    let h = 2166136261 >>> 0;
    const mix = (n: number) => {
      h ^= n | 0;
      h = Math.imul(h, 16777619);
    };
    mix(this.tick);
    mix(this.organisms.length);
    mix(this.rng.state());
    mix(this.fields.checksum());
    for (const o of this.organisms) {
      mix(o.id);
      mix(o.x);
      mix(o.y);
      mix(o.lineageId);
      mix(Math.round(o.energy * 1000));
      mix(o.genome.length);
      for (let i = 0; i < o.genome.length; i++) mix(o.genome.charCodeAt(i));
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  lineageEdges(): Array<{ parent: number; child: number }> {
    return parentChildEdges(this.lineages.values());
  }

  killLineage(lineageId: number): number {
    let n = 0;
    for (const o of this.organisms) {
      if (o.lineageId === lineageId) {
        o.energy = 0;
        n++;
      }
    }
    this.reap();
    return n;
  }
}

export function worldFromSnapshot(snap: WorldSnapshot): World {
  const w = new World({ ...snap.params, startPopulation: 0, seed: snap.params.seed });
  w.restore(snap);
  return w;
}

export { DEFAULT_PARAMS, mixSeed };
