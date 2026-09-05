import { describe, expect, it } from "vitest";
import {
  DualWorld,
  TERRAIN,
  World,
  applyBottleneck,
  buildShareURL,
  decodeGenome,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  founderHeterotroph,
  injectStrain,
  paintTerrain,
  paramsFromQuery,
  paramsToQuery,
  parseCSV,
  parseJSONSnapshot,
  parseShareURL,
  restoreSnapshot,
  takeSnapshot,
  worldFromSnapshot,
} from "../src/sim/index";
import { normalizeParams } from "../src/sim/types";

describe("paint / inject / bottleneck", () => {
  it("paint terrain changes cells and fields", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 0, seed: 1 });
    const i = 5 * 16 + 5;
    expect(w.terrain[i]).not.toBe(TERRAIN.barrier);
    paintTerrain(w, 5, 5, 0, "barrier");
    expect(w.terrain[i]).toBe(TERRAIN.barrier);
    const nut = 8 * 16 + 8;
    const before = w.fields.nutrient[nut]!;
    paintTerrain(w, 8, 8, 2, "nutrientBlob", 0.9);
    expect(w.fields.nutrient[nut]!).toBeGreaterThan(before);
  });

  it("inject strain increases a known genotype’s count", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 4, seed: 2 });
    const g = decodeGenome(founderHeterotroph()).sequence;
    const before = w.organisms.filter((o) => o.genome === g).length;
    const placed = injectStrain(w, g, 12, 8, 8);
    expect(placed).toBeGreaterThan(0);
    const after = w.organisms.filter((o) => o.genome === g).length;
    expect(after).toBe(before + placed);
  });

  it("bottleneck reduces population to floor(n * keep)", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 40, seed: 3 });
    const n = w.organisms.length;
    const kept = applyBottleneck(w, 0.25);
    expect(kept).toBe(Math.floor(n * 0.25));
    expect(w.organisms.length).toBeLessThan(n);
  });
});

describe("snapshots, A/B, export, URL", () => {
  it("snapshot restore matches pre-snapshot state", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 18, seed: 9 });
    w.step();
    w.step();
    const snap = takeSnapshot(w);
    const hash = w.hashState();
    w.step();
    w.step();
    expect(w.hashState()).not.toBe(hash);
    restoreSnapshot(w, snap);
    expect(w.hashState()).toBe(hash);
    expect(worldFromSnapshot(snap).hashState()).toBe(hash);
  });

  it("A/B worlds step independently", () => {
    const dual = new DualWorld({ width: 16, height: 16, startPopulation: 12, seed: 7 });
    const hb0 = dual.b.hashState();
    const tickB = dual.b.tick;
    dual.step("A");
    expect(dual.a.tick).toBe(1);
    expect(dual.b.tick).toBe(tickB);
    expect(dual.b.hashState()).toBe(hb0);
    dual.step("B");
    expect(dual.b.tick).toBe(tickB + 1);
    expect(dual.hashes().a).not.toBe(dual.hashes().b);
  });

  it("export JSON and CSV are parseable and contain fitness and phylogeny records", () => {
    const w = new World({ width: 12, height: 12, startPopulation: 10, seed: 8, mutationRate: 1 });
    for (const o of w.organisms) o.energy = 3;
    for (let i = 0; i < 12; i++) w.step();
    const json = exportJSON(w);
    const snap = parseJSONSnapshot(json);
    expect(snap.history.length).toBeGreaterThan(0);
    expect(snap.history[0]).toHaveProperty("meanFitness");
    expect(snap.lineages.length).toBeGreaterThan(0);
    expect(snap.lineages[0]).toHaveProperty("parentId");

    const metrics = exportMetricsCSV(w.history);
    const parsed = parseCSV(metrics);
    expect(parsed.header).toContain("meanFitness");
    expect(parsed.header).toContain("shannon");
    expect(parsed.rows.length).toBe(w.history.length);

    const phylo = exportPhylogenyCSV(w);
    const pparsed = parseCSV(phylo);
    expect(pparsed.header).toContain("parentId");
    expect(pparsed.header).toContain("signature");
    expect(pparsed.rows.length).toBe(w.lineages.size);
  });

  it("seed+params URL/query round-trips to the same config", () => {
    const p = normalizeParams({
      seed: 42,
      mutationRate: 0.2,
      width: 128,
      height: 96,
      startPopulation: 100,
    });
    const q = paramsToQuery(p);
    const p2 = paramsFromQuery(q);
    expect(p2.seed).toBe(p.seed);
    expect(p2.mutationRate).toBe(p.mutationRate);
    expect(p2.width).toBe(p.width);
    expect(p2.height).toBe(p.height);
    expect(p2.startPopulation).toBe(p.startPopulation);
    const url = buildShareURL(p, "https://example.test", "/lab");
    expect(url.startsWith("https://example.test/lab?")).toBe(true);
    const p3 = parseShareURL(url);
    expect(p3.seed).toBe(p.seed);
    expect(p3.height).toBe(p.height);
  });
});
