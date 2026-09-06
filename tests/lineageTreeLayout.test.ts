import { describe, expect, it } from "vitest";
import { layoutLineageTree, lineageStrainMap } from "../src/render/lineageTreeLayout";
import { World, founderHeterotroph, founderPredator } from "../src/sim/index";
import type { LineageNode } from "../src/sim/types";

function node(id: number, parentId: number, born: number, extinct: number | null, count: number, peak = Math.max(count, 1)): LineageNode {
  return { id, parentId, bornTick: born, extinctTick: extinct, count, peakCount: peak, hue: 0.3, signature: `sig${id}` };
}

describe("lineage tree layout", () => {
  it("lays the root-to-focus path with the focus' descendants, rows contiguous per sub-tree, parents over children", () => {
    const L = new Map<number, LineageNode>();
    for (const n of [
      node(1, -1, 0, null, 5, 30),
      node(2, 1, 10, 40, 0, 4),
      node(3, 1, 20, null, 8, 12),
      node(4, 3, 30, null, 2),
      node(5, 3, 35, 60, 0, 3),
      node(6, 5, 50, null, 1),
      node(7, 2, 15, 20, 0, 1),
    ]) L.set(n.id, n);
    const innovations = [
      { id: 1, strainId: 1, tick: 20, orgId: 0, parentOrgId: 0, lineageId: 3, kind: "point" as const, changes: [{ trait: "resist" as const, from: 0.1, to: 0.4 }, { trait: "uptake" as const, from: 0.5, to: 0.55 }], env: { nutrient: 0, toxin: 0, temperature: 0, light: 0 } },
    ];
    const t = layoutLineageTree(L, innovations, 3, { now: 100 });
    expect(t.path).toEqual([1, 3]);
    expect(t.nodes.map((n) => n.id).sort()).toEqual([1, 3, 4, 5, 6]);
    const by = t.byId;
    expect(by.get(3)!.isFocus).toBe(true);
    expect(by.get(1)!.onPath && by.get(3)!.onPath).toBe(true);
    expect(by.get(4)!.onPath).toBe(false);
    expect(by.get(3)!.change).toEqual({ trait: "resist", from: 0.1, to: 0.4 });
    expect(by.get(5)!.t1).toBe(60);
    expect(by.get(4)!.t1).toBe(100);
    // Every lineage has its own row; children follow their parent, the path child first.
    const rows = t.nodes.map((n) => n.row);
    expect(new Set(rows).size).toBe(rows.length);
    expect(by.get(1)!.row).toBe(0);
    expect(by.get(3)!.row).toBe(1);
    expect(by.get(4)!.row).toBeGreaterThan(by.get(3)!.row);
    expect(by.get(6)!.row).toBe(by.get(5)!.row + 1);
    expect(t.rows).toBe(5);
    const withPath = layoutLineageTree(L, innovations, 6, { now: 100 });
    expect(withPath.byId.get(5)!.row).toBe(withPath.byId.get(3)!.row + 1); // path child (5) placed before sibling 4
    expect(t.tMin).toBe(0);
    expect(t.tMax).toBe(100);
    // Siblings option adds lineage 2 (sibling of the focus) but not its child 7.
    const s = layoutLineageTree(L, innovations, 3, { now: 100, siblings: true });
    expect(s.byId.has(2)).toBe(true);
    expect(s.byId.has(7)).toBe(false);
    // Budget hides descendants and reports them on the parent.
    const b = layoutLineageTree(L, innovations, 1, { now: 100, maxDescendants: 2 });
    expect(b.nodes.length).toBe(3);
    expect(b.nodes.reduce((sum, n) => sum + n.hiddenDescendants, 0)).toBeGreaterThan(0);
    // Long-extinct lineages can be dropped.
    const e = layoutLineageTree(L, innovations, 1, { now: 100, extinctFor: 30 });
    expect(e.byId.has(2)).toBe(false);
    expect(layoutLineageTree(L, innovations, 999, { now: 100 }).nodes).toEqual([]);
  });

  it("maps lineages to strains from organisms, deaths and innovations, inheriting from ancestors", () => {
    const w = new World({ width: 24, height: 24, seed: 4, mutationRate: 1 });
    w.fields.nutrient.fill(1.5);
    w.injectStrain(founderHeterotroph(), 10);
    w.injectStrain(founderPredator(), 3);
    for (let i = 0; i < 40; i++) w.step();
    const strainOf = lineageStrainMap(w.organisms, w.deaths, w.innovations, w.lineages);
    for (const o of w.organisms) expect(strainOf(o.lineageId)).toBe(o.strainId);
    const t = layoutLineageTree(w.lineages, w.innovations, 1, { now: w.tick, strainOf });
    expect(t.nodes.every((n) => n.strainId === 1)).toBe(true);
  });
});
