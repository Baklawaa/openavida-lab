import { describe, expect, it } from "vitest";
import {
  DualWorld,
  InlineHost,
  World,
  applyFrame,
  applySimOp,
  founderHeterotroph,
  founderPhototroph,
  frameFromWorld,
  opResetsHistory,
  opSides,
  stepSides,
  type SimOp,
} from "../src/sim/index";

const params = { width: 24, height: 24, seed: 99, mutationRate: 0.5 };

function scripted(): SimOp[] {
  return [
    { kind: "defineStrain", which: "A", genome: founderPhototroph(), name: "Solaires", manual: true },
    { kind: "paint", which: "A", x: 6, y: 6, radius: 3, brush: "nutrientBlob" },
    { kind: "paint", which: "A", x: 16, y: 16, radius: 2, brush: "thermalVent" },
    { kind: "inject", which: "A", genome: founderHeterotroph(), count: 12, x: 6, y: 6 },
    { kind: "place", which: "A", x: 20, y: 3, genome: founderPhototroph() },
    { kind: "disturbances", on: true },
    { kind: "setParams", which: "A", params: { mutationRate: 1 } },
  ];
}

describe("SimHost: shared op application and frames", () => {
  it("applySimOp reproduces direct World calls exactly (same hash)", () => {
    const direct = new DualWorld(params);
    direct.a.defineStrain(founderPhototroph(), { name: "Solaires", manual: true });
    direct.a.paint(6, 6, 3, "nutrientBlob");
    direct.a.paint(16, 16, 2, "thermalVent");
    direct.a.injectStrain(founderHeterotroph(), 12, 6, 6);
    direct.a.birth(20, 3, founderPhototroph(), null, false, 0.9);
    direct.a.disturbances = true;
    direct.b.disturbances = true;
    Object.assign(direct.a.params, { mutationRate: 1 });
    for (let i = 0; i < 30; i++) direct.a.step();

    const viaOps = new DualWorld(params);
    const results = scripted().map((op) => applySimOp(viaOps, op));
    expect(results[3]!.count).toBe(12);
    expect(results[4]!.child?.id).toBeGreaterThan(0);
    stepSides(viaOps, "A", 30);
    expect(viaOps.a.hashState()).toBe(direct.a.hashState());
    expect(viaOps.a.strains.get(1)!.name).toBe("Solaires");
    expect(opSides({ kind: "reseed", params: viaOps.a.params, seedB: 5 })).toEqual(["A", "B"]);
    expect(opSides({ kind: "paint", which: "B", x: 0, y: 0, radius: 1, brush: "erase" })).toEqual(["B"]);
    expect(opResetsHistory({ kind: "restore", which: "A", snapshot: viaOps.a.snapshot() })).toBe(true);
    expect(opResetsHistory({ kind: "paint", which: "A", x: 0, y: 0, radius: 1, brush: "erase" })).toBe(false);
  });

  it("a frame applied to a fresh mirror reproduces the source world state", () => {
    const dual = new DualWorld(params);
    for (const op of scripted()) applySimOp(dual, op);
    stepSides(dual, "A", 40);
    const src = dual.a;
    const { frame, transfer } = frameFromWorld(src, "A", { historySince: -1, lineages: true, innovations: true });
    expect(transfer.length).toBe(7);
    const mirror = new World({ ...params, startPopulation: 0 });
    expect(applyFrame(mirror, frame)).toBe(true);
    expect(mirror.hashState()).toBe(src.hashState());
    expect(mirror.tick).toBe(src.tick);
    expect(mirror.history.length).toBe(src.history.length);
    // The bounded per-lineage series used by the selection readout crosses the
    // worker boundary inside the history rows.
    expect(mirror.history.at(-1)?.lineageTop).toEqual(src.history.at(-1)?.lineageTop);
    expect(mirror.strains.size).toBe(src.strains.size);
    expect(mirror.innovations.length).toBe(src.innovations.length);
    expect(mirror.lineages.size).toBe(src.lineages.size);
    expect(mirror.deaths.length).toBe(src.deaths.length);
    expect(mirror.disturbances).toBe(true);
    expect(mirror.params.mutationRate).toBe(1);
    expect(mirror.recording?.length).toBe(src.recording?.length);
    // The mirror can continue stepping identically (rng state was carried over).
    src.step();
    mirror.step();
    expect(mirror.hashState()).toBe(src.hashState());
    // Size mismatch is reported, not silently applied.
    const other = new World({ width: 8, height: 8, seed: 1 });
    expect(applyFrame(other, frame)).toBe(false);
  });

  it("incremental history frames append without duplicating ticks", () => {
    const dual = new DualWorld(params);
    applySimOp(dual, { kind: "inject", which: "A", genome: founderHeterotroph(), count: 6 });
    const mirror = new World({ ...params, startPopulation: 0 });
    let since = -1;
    for (let round = 0; round < 3; round++) {
      stepSides(dual, "A", 5);
      const { frame } = frameFromWorld(dual.a, "A", { historySince: since, lineages: round === 0, innovations: round === 0 });
      applyFrame(mirror, frame);
      since = dual.a.tick;
    }
    expect(mirror.history.map((h) => h.tick)).toEqual(dual.a.history.map((h) => h.tick));
    expect(mirror.hashState()).toBe(dual.a.hashState());
  });

  it("InlineHost steps synchronously and answers snapshot/hash immediately", async () => {
    const host = new InlineHost(new DualWorld(params));
    host.apply({ kind: "inject", which: "B", genome: founderPhototroph(), count: 4 });
    host.step("B", 3);
    expect(host.dual.b.tick).toBe(3);
    expect(host.dual.a.tick).toBe(0);
    host.step("both", 2);
    expect(host.dual.a.tick).toBe(2);
    expect(host.pendingSteps()).toBe(0);
    expect(await host.hash("B")).toBe(host.dual.b.hashState());
    expect((await host.snapshot("B")).tick).toBe(5);
    await host.flush();
    const seed = host.dual.a.params.seed;
    host.apply({ kind: "reseed", params: { ...host.dual.a.params, seed: seed + 1 }, seedB: 77 });
    expect(host.dual.a.tick).toBe(0);
    expect(host.dual.b.params.seed).toBe(77);
  });
});
