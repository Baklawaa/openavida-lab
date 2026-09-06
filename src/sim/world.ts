import { CRASH_EVERY, DROUGHT_EVERY, TOXIN_PULSE_EVERY, seasonLight } from "./climate";
import {
  crowdingPenalty,
  emptyNeighbor,
  interactNeighbors,
  metabolize,
  moveOrganisms,
  neighborOccupancyCount,
  sampleNeighborEffects,
  shadeOccupied,
} from "./ecology";
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
import { MAX_GENOME, copyPhenotype } from "./mapping";
import { classifyEnergyDeath, deathFromOrganism } from "./deaths";
import { applyPolicyMoves, type BrainRuntime } from "./brains";
import { parentChildEdges, sampleMetrics } from "./metrics";
import type { DeathRecord } from "./types";
import { mixSeed, Rng } from "./rng";
import { phenotypeChanges, strainColor, strategyOf, type Innovation, type Strain } from "./species";
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
  strains = new Map<number, Strain>();
  nextStrainId = 1;
  innovations: Innovation[] = [];
  nextInnovationId = 1;
  history: MetricsSample[] = [];
  deaths: DeathRecord[] = [];
  lastPredation = 0;
  lastMutualism = 0;
  lastDisplacements = 0;
  lastStepMs = 0;
  randomTerrain: boolean;
  disturbances: boolean;
  /** Off by default — phase-1 step path. */
  brainsEnabled = false;
  brain: BrainRuntime | null = null;

  constructor(partial: Partial<SimParams> = {}) {
    this.params = normalizeParams(partial);
    this.rng = new Rng(this.params.seed);
    const { width: w, height: h } = this.params;
    this.fields = new Fields(w, h);
    this.terrain = new Uint8Array(w * h);
    this.occupancy = new Int32Array(w * h);
    this.occupancy.fill(-1);
    this.randomTerrain = this.params.randomTerrain;
    this.disturbances = this.params.disturbances;
    this.seedEnvironment();
    if (this.randomTerrain) this.seedRandomTerrain();
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
    const { w, h, fields } = this;
    for (let y = 0; y < h; y++) {
      const sun = 0.35 + 0.55 * (1 - y / Math.max(1, h - 1));
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        fields.solar[i] = sun;
        fields.light[i] = sun;
        fields.temperature[i] = 0.5;
        fields.nutrient[i] = 0.12;
        fields.toxin[i] = 0;
      }
    }
  }

  /** Optional preset: random vents, toxin, heat, walls, shade. Off by default. */
  seedRandomTerrain(): void {
    const { w, h, rng, fields, terrain } = this;
    this.randomTerrain = true;
    const vents = 6 + rng.int(5);
    for (let k = 0; k < vents; k++) {
      const x = 4 + rng.int(Math.max(1, w - 8));
      const y = 4 + rng.int(Math.max(1, h - 8));
      const r = 2 + rng.int(4);
      this.paint(x, y, r, "nutrientVent");
      fields.addBlob("nutrient", x, y, r + 3, 0.8);
    }
    const toxN = 3 + rng.int(3);
    for (let k = 0; k < toxN; k++) {
      const x = 4 + rng.int(Math.max(1, w - 8));
      const y = 4 + rng.int(Math.max(1, h - 8));
      this.paint(x, y, 2, "toxinVent");
      fields.addBlob("toxin", x, y, 4, 0.55);
    }
    const hotN = 2 + rng.int(3);
    for (let k = 0; k < hotN; k++) {
      const x = Math.floor(w * 0.55) + rng.int(Math.max(1, Math.floor(w * 0.4)));
      const y = 4 + rng.int(Math.max(1, h - 8));
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

  clearPresetTerrain(): void {
    this.randomTerrain = false;
    this.terrain.fill(TERRAIN.empty);
    this.fields.toxin.fill(0);
    this.fields.nutrient.fill(0.12);
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
      strainId: parent ? parent.strainId : this.strainFor(decoded.sequence, decoded.phenotype).id,
    };
    if (!parent) {
      org.lineageId = this.createLineage(-1, org);
    } else if (mutant) {
      org.lineageId = this.createLineage(parent.lineageId, org);
      const changes = phenotypeChanges(parent.ph, org.ph);
      if (changes.length) {
        this.innovations.push({
          id: this.nextInnovationId++,
          strainId: org.strainId,
          tick: this.tick,
          orgId: org.id,
          parentOrgId: parent.id,
          lineageId: org.lineageId,
          kind: genome.length === parent.genome.length ? "point" : Math.abs(genome.length - parent.genome.length) <= 3 ? "indel" : "duplication",
          changes,
          env: this.fields.sample(x, y),
          parentGenome: parent.genome.length > MAX_GENOME ? parent.genome.slice(0, MAX_GENOME) : parent.genome,
          genome: org.genome.length > MAX_GENOME ? org.genome.slice(0, MAX_GENOME) : org.genome,
        });
        if (this.innovations.length > 900) this.pruneInnovations();
      }
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

  /** Find the strain whose founding genome matches, or create "Souche n". */
  strainFor(genome: string, phenotype?: import("./mapping").Phenotype): Strain {
    const signature = genomeSignature(genome);
    for (const s of this.strains.values()) if (s.signature === signature && s.genome === genome) return s;
    return this.defineStrain(genome, { phenotype });
  }

  /** Pre-define (or rename) a strain for a genome. Manual strains keep their name. */
  defineStrain(genome: string, opts: { name?: string; manual?: boolean; phenotype?: import("./mapping").Phenotype } = {}): Strain {
    const seq = decodeGenome(genome).sequence;
    const signature = genomeSignature(seq);
    for (const s of this.strains.values()) {
      if (s.signature === signature && s.genome === seq) {
        if (opts.name && (opts.manual || !s.manual)) s.name = opts.name;
        if (opts.manual) s.manual = true;
        return s;
      }
    }
    const id = this.nextStrainId++;
    const strain: Strain = {
      id,
      name: opts.name ?? `Souche ${id}`,
      color: strainColor(id - 1),
      genome: seq,
      signature,
      bornTick: this.tick,
      manual: Boolean(opts.manual),
      founderPhenotype: copyPhenotype(opts.phenotype ?? decodeGenome(seq).phenotype),
    };
    this.strains.set(id, strain);
    return strain;
  }

  renameStrain(id: number, name: string): boolean {
    const s = this.strains.get(id);
    if (!s) return false;
    s.name = name.trim() || s.name;
    s.manual = true;
    return true;
  }

  /** Keep the innovations that still have living descendants plus the most recent ones. */
  private pruneInnovations(): void {
    const alive = new Set<number>();
    for (const l of this.lineages.values()) if (l.count > 0) alive.add(l.id);
    const recent = this.innovations.slice(-300);
    const keep = this.innovations.filter((i) => alive.has(i.lineageId) || this.lineageHasLivingDescendant(i.lineageId));
    const ids = new Set(keep.map((i) => i.id));
    for (const r of recent) if (!ids.has(r.id)) keep.push(r);
    keep.sort((a, b) => a.id - b.id);
    this.innovations = keep.slice(-900);
  }

  private lineageHasLivingDescendant(root: number): boolean {
    for (const l of this.lineages.values()) {
      if (l.count <= 0) continue;
      let cur: LineageNode | undefined = l;
      let guard = 0;
      while (cur && guard++ < 10000) {
        if (cur.id === root) return true;
        cur = this.lineages.get(cur.parentId);
      }
    }
    return false;
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
    const neighbors = sampleNeighborEffects(
      org,
      this.occupancy,
      this.organisms,
      this.w,
      this.h,
      this.params,
    );
    org.fitness = fitness(org.ph, env, neighbors);
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
    this.fields.advance(this.terrain, this.params, seasonLight(this.tick));
    shadeOccupied(this.fields.light, this.organisms, this.occupancy, this.w, this.h);
    this.applyDisturbances();
    const orgs = this.organisms;
    for (let i = 0; i < orgs.length; i++) {
      const o = orgs[i]!;
      o.age++;
      metabolize(o, this.fields, this.params);
      if (o.energy <= 0 && !o.pendingDeath) {
        o.pendingDeath = classifyEnergyDeath(o.ph, this.fields.sample(o.x, o.y));
      }
      o.energy -= crowdingPenalty(o.x, o.y, this.occupancy, this.w, this.h);
      if (o.energy <= 0 && !o.pendingDeath) o.pendingDeath = "crowding";
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
    const mv =
      this.brainsEnabled && this.brain
        ? applyPolicyMoves(
            orgs,
            this.occupancy,
            this.terrain,
            this.fields,
            this.w,
            this.h,
            this.rng,
            this.tick,
            this.brain,
          )
        : moveOrganisms(
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

  private applyDisturbances(): void {
    if (!this.disturbances) return;
    const { w, h, rng, tick } = this;
    if (tick >= TOXIN_PULSE_EVERY && tick % TOXIN_PULSE_EVERY === 0) {
      this.fields.addBlob("toxin", rng.int(w), rng.int(h), 5 + rng.int(4), 0.55);
    }
    if (tick >= DROUGHT_EVERY && tick % DROUGHT_EVERY === 0) {
      const nut = this.fields.nutrient;
      for (let i = 0; i < nut.length; i++) nut[i] = nut[i]! * 0.78;
    }
    if (tick >= CRASH_EVERY && tick % CRASH_EVERY === 0 && this.organisms.length > 280) {
      for (const o of this.organisms) {
        if (rng.chance(0.07)) {
          o.energy = 0;
          o.pendingDeath = "crash";
        }
      }
    }
  }

  private reproduceAll(): void {
    const snapshot = this.organisms;
    const n = snapshot.length;
    const pressure = n / Math.max(1, this.params.maxPopulation);
    for (let i = 0; i < n; i++) {
      const parent = snapshot[i]!;
      if (parent.energy <= 0) continue;
      const need = reproduceThreshold(parent.ph, this.params.reproduceEnergy);
      if (parent.energy < need) continue;
      if (this.organisms.length >= this.params.maxPopulation) break;
      if (pressure > 0.52 && !this.rng.chance(Math.max(0.08, 1 - pressure))) continue;
      if (neighborOccupancyCount(parent.x, parent.y, this.occupancy, this.w, this.h) >= 4) continue;
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
        continue;
      }
      const cause =
        o.age >= maxAge ? "old-age" : (o.pendingDeath ?? (o.energy <= 0 ? "starvation" : "old-age"));
      this.deaths.push(deathFromOrganism(o, this.tick, cause));
      if (this.deaths.length > 250) this.deaths.splice(0, this.deaths.length - 200);
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
    const strains: Record<string, number> = {};
    const strategies: Record<string, number> = {};
    for (const o of this.organisms) {
      const sk = String(o.strainId);
      strains[sk] = (strains[sk] ?? 0) + 1;
      const st = strategyOf(o.ph, this.params.predationThreshold);
      strategies[st] = (strategies[st] ?? 0) + 1;
    }
    m.strains = strains;
    m.strategies = strategies;
    const tracks: Record<string, [number, number, number, number, number]> = {};
    const acc = new Map<string, { n: number; sx: number; sy: number; st: number; sn: number }>();
    for (const o of this.organisms) {
      const k = String(o.strainId);
      let a = acc.get(k);
      if (!a) {
        a = { n: 0, sx: 0, sy: 0, st: 0, sn: 0 };
        acc.set(k, a);
      }
      const env = this.fields.sample(o.x, o.y);
      a.n++;
      a.sx += o.x;
      a.sy += o.y;
      a.st += env.temperature;
      a.sn += env.nutrient;
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    for (const [k, a] of acc) {
      const cx = a.sx / a.n;
      const cy = a.sy / a.n;
      let d2 = 0;
      for (const o of this.organisms) {
        if (String(o.strainId) !== k) continue;
        d2 += (o.x - cx) ** 2 + (o.y - cy) ** 2;
      }
      tracks[k] = [r2(cx), r2(cy), r2(Math.sqrt(d2 / a.n)), r2(a.st / a.n), r2(a.sn / a.n)];
    }
    m.strainTracks = tracks;
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
          if (oi >= 0 && this.organisms[oi]) {
            this.organisms[oi]!.energy = 0;
            this.organisms[oi]!.pendingDeath = "wipe";
          }
        }
        if (brush === "erase" || (terrainKind === TERRAIN.barrier && brush === "barrier")) {
          // barrier paint already set; erase also clears occupancy optionally
        }
        if (brush === "barrier") {
          const oi = this.occupancy[i]!;
          if (oi >= 0 && this.organisms[oi]) {
            this.organisms[oi]!.energy = 0;
            this.organisms[oi]!.pendingDeath = "wipe";
          }
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
      this.organisms[order[k]!]!.pendingDeath = "bottleneck";
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
      params: { ...this.params, randomTerrain: this.randomTerrain, disturbances: this.disturbances },
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
      deaths: this.deaths.map((d) => ({ ...d })),
      strains: Array.from(this.strains.values()).map((s) => ({ ...s, founderPhenotype: copyPhenotype(s.founderPhenotype) })),
      nextStrainId: this.nextStrainId,
      innovations: this.innovations.map((i) => ({ ...i, changes: i.changes.map((c) => ({ ...c })), env: { ...i.env } })),
      nextInnovationId: this.nextInnovationId,
    };
  }

  restore(snap: WorldSnapshot): void {
    this.rng.setState(snap.rngState);
    this.tick = snap.tick;
    this.fields.fromArrays(snap);
    this.terrain.set(snap.terrain);
    this.strains = new Map((snap.strains ?? []).map((s) => [s.id, { ...s, founderPhenotype: copyPhenotype(s.founderPhenotype) }]));
    this.nextStrainId = snap.nextStrainId ?? (Math.max(0, ...this.strains.keys()) + 1);
    this.innovations = (snap.innovations ?? []).map((i) => ({ ...i, changes: i.changes.map((c) => ({ ...c })), env: { ...i.env } }));
    this.nextInnovationId = snap.nextInnovationId ?? (Math.max(0, ...this.innovations.map((i) => i.id)) + 1);
    this.organisms = snap.organisms.map((o) => ({
      ...o,
      ph: copyPhenotype(o.ph),
      strainId: o.strainId ?? 0,
    }));
    // Older snapshots carry no strain tags: rebuild them from founders' genomes where possible.
    for (const o of this.organisms) {
      if (o.strainId) continue;
      if (o.parentId < 0) o.strainId = this.strainFor(o.genome, o.ph).id;
    }
    this.nextOrgId = snap.nextOrgId;
    this.nextLineageId = snap.nextLineageId;
    this.lineages = new Map(snap.lineages.map((l) => [l.id, { ...l }]));
    this.extinctions = snap.extinctions.map((e) => ({ ...e }));
    this.history = snap.history.map((h) => ({ ...h }));
    this.deaths = (snap.deaths ?? []).map((d) => ({ ...d }));
    this.randomTerrain = Boolean(snap.params.randomTerrain);
    this.disturbances = Boolean(snap.params.disturbances);
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
