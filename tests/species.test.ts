import { describe, expect, it } from "vitest";
import {
  World,
  decodeGenome,
  founderHeterotroph,
  founderPhototroph,
  founderPredator,
  groupStats,
  innovationSpread,
  keyInnovations,
  phenotypeChanges,
  placeOrganismAt,
  restoreSnapshot,
  strainTrack,
  strategyOf,
  takeSnapshot,
  traitDrift,
  worldFromSnapshot,
} from "../src/sim/index";
import type { MetricsSample } from "../src/sim/types";

describe("strains (founding-genome groups)", () => {
  it("tags founders by genome and children inherit the tag, mutants included", () => {
    const w = new World({ width: 32, height: 32, seed: 5, mutationRate: 1 });
    const photo = founderPhototroph();
    const hetero = founderHeterotroph();
    const a = placeOrganismAt(w, 4, 4, photo)!;
    const b = placeOrganismAt(w, 20, 20, hetero)!;
    const c = placeOrganismAt(w, 6, 6, photo)!;
    w.fields.nutrient.fill(1.2);
    w.fields.light.fill(1);
    expect(a.strainId).toBe(c.strainId);
    expect(a.strainId).not.toBe(b.strainId);
    expect(w.strains.size).toBe(2);
    expect(w.strains.get(a.strainId)!.name).toBe("Souche 1");
    expect(w.strains.get(a.strainId)!.genome).toBe(decodeGenome(photo).sequence);
    for (let i = 0; i < 60; i++) w.step();
    const tags = new Set(w.organisms.map((o) => o.strainId));
    expect([...tags].every((t) => t === a.strainId || t === b.strainId)).toBe(true);
    expect(w.organisms.length).toBeGreaterThan(3);
    const last = w.history.at(-1)!;
    expect(Object.values(last.strains!).reduce((s, v) => s + v, 0)).toBe(w.organisms.length);
    expect(Object.values(last.strategies!).reduce((s, v) => s + v, 0)).toBe(w.organisms.length);
  });

  it("manual strains keep their name; auto names can be overridden by kit labels", () => {
    const w = new World({ width: 16, height: 16, seed: 2 });
    const s = w.defineStrain(founderPredator(), { name: "Chasseurs", manual: true });
    const o = placeOrganismAt(w, 3, 3, founderPredator())!;
    expect(o.strainId).toBe(s.id);
    expect(w.defineStrain(founderPredator(), { name: "Prédateur" }).name).toBe("Chasseurs");
    const auto = w.strainFor(founderPhototroph());
    expect(w.defineStrain(founderPhototroph(), { name: "Phototrophe" }).name).toBe("Phototrophe");
    expect(w.renameStrain(auto.id, "Solaires")).toBe(true);
    expect(w.strains.get(auto.id)!.manual).toBe(true);
  });

  it("records innovations for phenotype-changing mutations and measures their spread", () => {
    const w = new World({ width: 40, height: 40, seed: 11, mutationRate: 1 });
    w.injectStrain(founderHeterotroph(), 30);
    w.fields.nutrient.fill(1.5);
    for (let i = 0; i < 80; i++) w.step();
    expect(w.innovations.length).toBeGreaterThan(0);
    const inn = w.innovations[0]!;
    expect(inn.changes.length).toBeGreaterThan(0);
    expect(inn.genome).toBeTruthy();
    expect(inn.parentGenome).toBeTruthy();
    expect(inn.genome).not.toBe(inn.parentGenome);
    expect(inn.strainId).toBe(1);
    const restored = worldFromSnapshot(takeSnapshot(w));
    expect(restored.innovations[0]!.genome).toBe(inn.genome);
    expect(restored.innovations[0]!.parentGenome).toBe(inn.parentGenome);
    expect(w.lineages.has(inn.lineageId)).toBe(true);
    const spread = innovationSpread(w.lineages, w.innovations);
    expect(spread.size).toBe(w.innovations.length);
    const key = keyInnovations(w.innovations, spread, 1, 3);
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < key.length; i++) expect(key[i - 1]!.living).toBeGreaterThanOrEqual(key[i]!.living);
    // A death record carries the strain of the organism.
    if (w.deaths.length) expect(w.deaths[0]!.strainId).toBe(1);
  });

  it("phenotype change detection ignores hue and sub-threshold drift", () => {
    const p = decodeGenome(founderPhototroph()).phenotype;
    expect(phenotypeChanges(p, { ...p })).toEqual([]);
    expect(phenotypeChanges(p, { ...p, hue: 0.1 })).toEqual([]);
    expect(phenotypeChanges(p, { ...p, tpref: p.tpref - 0.2 })).toEqual([{ trait: "tpref", from: p.tpref, to: p.tpref - 0.2 }]);
    expect(traitDrift(p, { ...p, photo: p.photo + 0.04 })[0]!.trait).toBe("photo");
  });

  it("strategy classification is deterministic and covers the kits", () => {
    expect(strategyOf(decodeGenome(founderPhototroph()).phenotype)).toBe("phototroph");
    expect(strategyOf(decodeGenome(founderHeterotroph()).phenotype)).toBe("heterotroph");
    expect(strategyOf(decodeGenome(founderPredator()).phenotype)).toBe("predator");
  });

  it("group statistics aggregate count, share, traits, centroid, spread, env and deaths", () => {
    const w = new World({ width: 24, height: 24, seed: 3 });
    placeOrganismAt(w, 2, 2, founderPhototroph());
    placeOrganismAt(w, 4, 2, founderPhototroph());
    placeOrganismAt(w, 20, 20, founderHeterotroph());
    w.fields.temperature.fill(0.9);
    const stats = groupStats(
      w.organisms,
      (x, y) => w.fields.sample(x, y),
      (o) => String(o.strainId),
      (k) => ({ label: w.strains.get(Number(k))!.name, color: w.strains.get(Number(k))!.color }),
      [{ tick: 1, orgId: 9, lineageId: 1, genome: "", fitness: 0, cause: "toxin", x: 0, y: 0, strainId: 1 }],
      (d) => String(d.strainId ?? 0),
    );
    expect(stats).toHaveLength(2);
    expect(stats[0]!.count).toBe(2);
    expect(stats[0]!.share).toBeCloseTo(2 / 3);
    expect(stats[0]!.centroid).toEqual({ x: 3, y: 2 });
    expect(stats[0]!.spread).toBeCloseTo(1);
    expect(stats[0]!.env.temperature).toBeCloseTo(0.9);
    expect(stats[0]!.traits.photo).toBeCloseTo(decodeGenome(founderPhototroph()).phenotype.photo);
    expect(stats[0]!.deaths.toxin).toBe(1);
    expect(stats[1]!.deathTotal).toBe(0);
  });

  it("strains and innovations survive snapshot / restore, and old snapshots get tags rebuilt", () => {
    const w = new World({ width: 24, height: 24, seed: 7, mutationRate: 1 });
    w.defineStrain(founderPhototroph(), { name: "Solaires", manual: true });
    w.injectStrain(founderPhototroph(), 10);
    for (let i = 0; i < 30; i++) w.step();
    const snap = takeSnapshot(w);
    const copy = worldFromSnapshot(snap);
    expect(copy.strains.get(1)!.name).toBe("Solaires");
    expect(copy.innovations.length).toBe(w.innovations.length);
    expect(copy.organisms.every((o) => o.strainId === 1)).toBe(true);
    const legacy = JSON.parse(JSON.stringify(snap));
    delete legacy.strains;
    delete legacy.innovations;
    for (const o of legacy.organisms) delete o.strainId;
    const w2 = new World({ width: 24, height: 24, seed: 7 });
    restoreSnapshot(w2, legacy);
    const founders = w2.organisms.filter((o) => o.parentId < 0);
    expect(founders.every((o) => o.strainId > 0)).toBe(true);
    expect(w2.organisms.every((o) => o.strainId >= 0)).toBe(true);
  });
});

function metric(tick: number, tracks?: MetricsSample["strainTracks"]): MetricsSample {
  return {
    tick,
    population: 0,
    meanFitness: 0,
    maxFitness: 0,
    shannon: 0,
    shannonGenotype: 0,
    lineageCount: 0,
    extinctTotal: 0,
    fixationFraction: 0,
    fixationLineageId: 0,
    strainTracks: tracks,
  };
}

describe("strainTrack", () => {
  it("keeps every n-th history row plus the last, and skips missing keys", () => {
    const history: MetricsSample[] = [
      metric(0, { "1": [10, 10, 1, 0.2, 0.5] }),
      metric(1, { "1": [11, 10, 1, 0.2, 0.5] }),
      metric(2, { "1": [12, 11, 1.5, 0.3, 0.4] }),
      metric(3, { "2": [0, 0, 0, 0, 0] }),
      metric(4, { "1": [20, 18, 2, 0.5, 0.1] }),
    ];
    const pts = strainTrack(history, 1, 2);
    expect(pts.map((p) => p.tick)).toEqual([0, 2, 4]);
    expect(pts[0]).toEqual({ tick: 0, cx: 10, cy: 10, spread: 1, temperature: 0.2, nutrient: 0.5 });
    expect(pts[2]!.cx).toBe(20);
    const short = [metric(0, { "1": [0, 0, 0, 0, 0] }), metric(1, { "1": [1, 1, 0, 0, 0] }), metric(2, { "1": [2, 2, 0, 0, 0] }), metric(3, { "1": [9, 8, 0, 0.4, 0.1] })];
    expect(strainTrack(short, "1", 2).map((p) => p.tick)).toEqual([0, 2, 3]);
    expect(strainTrack(history, 2, 1)).toHaveLength(1);
    expect(strainTrack([metric(0), metric(1)], 1, 1)).toEqual([]);
  });

  it("records 2-decimal centroid tracks on the world history", () => {
    const w = new World({ width: 16, height: 16, seed: 1 });
    placeOrganismAt(w, 2, 3, founderPhototroph());
    placeOrganismAt(w, 4, 3, founderPhototroph());
    w.recordMetrics();
    const t = w.history.at(-1)!.strainTracks!["1"];
    expect(t).toBeTruthy();
    expect(t![0]).toBe(3);
    expect(t![1]).toBe(3);
    expect(t![2]).toBe(1);
    for (const v of t!) expect(v).toBe(Math.round(v * 100) / 100);
    const restored = worldFromSnapshot(takeSnapshot(w));
    expect(restored.history.at(-1)!.strainTracks!["1"]).toEqual(t);
  });
});
