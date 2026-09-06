import { describe, expect, it } from "vitest";
import {
  DEATH_LOG_KEEP,
  DEATH_LOG_MAX,
  DualWorld,
  World,
  ancestry,
  applyFilter,
  applyFrame,
  applySimOp,
  biggestChanges,
  buildCatalog,
  catalogRecords,
  descendantLineages,
  founderHeterotroph,
  founderPredator,
  frameFromWorld,
  groupCatalog,
  lineageChain,
  organismsUnderLineage,
  sortCatalog,
  stepSides,
  subtreeCount,
  takeSnapshot,
  worldFromSnapshot,
} from "../src/sim/index";

function evolved(): World {
  const w = new World({ width: 32, height: 32, seed: 13, mutationRate: 1 });
  w.fields.nutrient.fill(1.5);
  w.injectStrain(founderHeterotroph(), 30);
  w.injectStrain(founderPredator(), 4);
  for (let i = 0; i < 80; i++) w.step();
  return w;
}

describe("organism records: kills, births, death log", () => {
  it("tracks births per parent and kills per predator; death records carry age, kills, births and a monotonic seq", () => {
    const w = evolved();
    expect(w.organisms.some((o) => o.births > 0) || w.deaths.some((d) => (d.births ?? 0) > 0)).toBe(true);
    const preds = [...w.organisms, ...w.deaths].filter((o) => ("ph" in o ? o.ph.aggression : 0) > 0.5 || ("cause" in o && (o.kills ?? 0) > 0));
    expect(w.deaths.some((d) => d.cause === "predation")).toBe(true);
    expect(preds.some((o) => (o.kills ?? 0) > 0)).toBe(true);
    const seqs = w.deaths.map((d) => d.seq!);
    expect(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!)).toBe(true);
    expect(w.deaths.every((d) => typeof d.age === "number" && typeof d.parentId === "number")).toBe(true);
    // Round trip keeps the counters.
    const copy = worldFromSnapshot(takeSnapshot(w));
    expect(copy.nextDeathSeq).toBe(w.nextDeathSeq);
    expect(copy.organisms.map((o) => o.kills + o.births)).toEqual(w.organisms.map((o) => o.kills + o.births));
  });

  it("keeps the death log bounded and mirrors it incrementally through frames", () => {
    const w = new World({ width: 8, height: 8, seed: 1 });
    w.fields.nutrient.fill(0);
    let births = 0;
    for (let i = 0; births < DEATH_LOG_MAX + 50; i++) {
      const o = w.birth(i % 8, Math.floor(i / 8) % 8, founderHeterotroph(), null, false, 0.01);
      if (o) {
        births++;
        o.energy = 0;
      }
      w.step();
    }
    expect(w.deaths.length).toBeLessThanOrEqual(DEATH_LOG_MAX);
    expect(w.deaths.length).toBeGreaterThanOrEqual(DEATH_LOG_KEEP - 10);
    const dual = new DualWorld({ width: 16, height: 16, seed: 3, mutationRate: 1 });
    dual.a.fields.nutrient.fill(0.05);
    applySimOp(dual, { kind: "inject", which: "A", genome: founderHeterotroph(), count: 20 });
    const mirror = new World({ width: 16, height: 16, seed: 3, startPopulation: 0 });
    let since = -1;
    for (let round = 0; round < 4; round++) {
      stepSides(dual, "A", 15);
      const { frame } = frameFromWorld(dual.a, "A", { historySince: -1, deathsSince: since, lineages: true, innovations: true });
      expect(frame.deathsFull).toBe(round === 0);
      applyFrame(mirror, frame);
      since = dual.a.nextDeathSeq - 1;
    }
    expect(mirror.deaths.map((d) => d.seq)).toEqual(dual.a.deaths.map((d) => d.seq));
    expect(mirror.deaths.length).toBeGreaterThan(0);
  });
});

describe("lineage ancestry", () => {
  it("chains root → leaf, matches innovations, counts subtrees and lists descendants", () => {
    const w = evolved();
    const deepest = [...w.lineages.values()].map((l) => ({ l, chain: lineageChain(w.lineages, l.id) })).sort((a, b) => b.chain.length - a.chain.length)[0]!;
    expect(deepest.chain.length).toBeGreaterThan(1);
    expect(deepest.chain[0]!.parentId).toBe(-1);
    expect(deepest.chain.at(-1)!.id).toBe(deepest.l.id);
    const steps = ancestry(w.lineages, w.innovations, deepest.l.id);
    expect(steps.map((s) => s.depth)).toEqual(steps.map((_, i) => i));
    expect(steps.some((s) => s.innovation !== null)).toBe(true);
    const big = biggestChanges(steps, 2);
    expect(big.length).toBeGreaterThan(0);
    for (let i = 1; i < big.length; i++) expect(Math.abs(big[i - 1]!.change.to - big[i - 1]!.change.from)).toBeGreaterThanOrEqual(Math.abs(big[i]!.change.to - big[i]!.change.from));
    const root = deepest.chain[0]!;
    expect(subtreeCount(w.lineages, root.id)).toBe(organismsUnderLineage(w.organisms, w.lineages, root.id).length);
    expect(descendantLineages(w.lineages, root.id).length).toBeGreaterThan(0);
    expect(lineageChain(w.lineages, 999999)).toEqual([]);
  });
});

describe("catalog", () => {
  it("lists living and dead organisms with filters, sorts, groups and records", () => {
    const w = evolved();
    const all = buildCatalog(w);
    expect(all.length).toBe(w.organisms.length + w.deaths.length);
    expect(all.filter((e) => e.alive).length).toBe(w.organisms.length);
    const dead = applyFilter(all, { liveness: "dead" });
    expect(dead.every((e) => !e.alive && e.deathTick !== null && e.cause !== null)).toBe(true);
    const fastest = sortCatalog(dead, "died-fastest");
    for (let i = 1; i < fastest.length; i++) expect(fastest[i - 1]!.age).toBeLessThanOrEqual(fastest[i]!.age);
    const slowest = sortCatalog(dead, "died-slowest");
    expect(slowest[0]!.age).toBe(Math.max(...dead.map((e) => e.age)));
    const killers = sortCatalog(all, "most-kills");
    expect(killers[0]!.kills).toBe(Math.max(...all.map((e) => e.kills)));
    expect(killers[0]!.kills).toBeGreaterThan(0);
    const byResist = sortCatalog(all, "trait:resist");
    expect(byResist[0]!.ph.resist).toBe(Math.max(...all.map((e) => e.ph.resist)));
    expect(applyFilter(all, { liveness: "all", strainId: 2 }).every((e) => e.strainId === 2)).toBe(true);
    expect(applyFilter(all, { liveness: "all", minKills: 1 }).every((e) => e.kills >= 1)).toBe(true);
    expect(applyFilter(all, { liveness: "all", cause: "predation" }).every((e) => e.cause === "predation")).toBe(true);
    expect(applyFilter(all, { liveness: "all", genome: "atg" }).length).toBe(all.length);
    expect(applyFilter(all, { liveness: "all", genome: "TTTTTTTTTTTTTTTTTTTTTTTTTTTT" }).length).toBe(0);
    expect(applyFilter(all, { liveness: "all", trait: { trait: "aggression", min: 0.5 } }).every((e) => e.ph.aggression >= 0.5)).toBe(true);
    const groups = groupCatalog(all, "strain");
    expect(groups.reduce((s, g) => s + g.entries.length, 0)).toBe(all.length);
    expect(groups.map((g) => g.key)).toContain("1");
    expect(groupCatalog(all, "strategy").every((g) => g.entries.every((e) => e.strategy === g.key))).toBe(true);
    const records = catalogRecords(all);
    expect(records.find((r) => r.sort === "most-kills")!.entry.kills).toBe(killers[0]!.kills);
    expect(records.find((r) => r.sort === "died-fastest")!.entry.alive).toBe(false);
  });
});
