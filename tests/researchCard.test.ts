import { describe, expect, it } from "vitest";
import { World, founderHeterotroph, founderPhototroph, type MetricsSample } from "../src/sim/index";
import { researchHtml, selectionRows, strainSelections } from "../src/ui/researchCard";

/** Synthetic history rows, so lineage-level estimates are tested deterministically. */
function historyRows(rows: Array<[number, Array<[number, number]>]>): MetricsSample[] {
  return rows.map(([tick, lineageTop]) => ({
    tick,
    population: lineageTop.reduce((s, [, c]) => s + c, 0),
    meanFitness: 0,
    maxFitness: 0,
    shannon: 0,
    shannonGenotype: 0,
    lineageCount: lineageTop.length,
    extinctTotal: 0,
    fixationFraction: 0,
    fixationLineageId: -1,
    lineageTop,
  })) as unknown as MetricsSample[];
}

/** One strain (a single injected genome) with a supplied lineage history. */
function singleStrainWorld(history: MetricsSample[]): World {
  const w = new World({ width: 12, height: 12, seed: 2, startPopulation: 0 });
  w.injectStrain(founderHeterotroph(), 4);
  w.history = history;
  return w;
}

function populated(): World {
  const w = new World({ width: 20, height: 20, seed: 4, startPopulation: 0, mutationRate: 0.3 });
  w.fields.nutrient.fill(1.2);
  w.fields.light.fill(0.8);
  w.injectStrain(founderHeterotroph(), 14);
  w.injectStrain(founderPhototroph(), 8);
  for (let i = 0; i < 40; i++) w.step();
  return w;
}

describe("research card", () => {
  it("ranks living strains and estimates their selection slope", () => {
    const w = populated();
    const selections = strainSelections(w, 2);
    expect(selections.length).toBeGreaterThan(0);
    expect(selections.length).toBeLessThanOrEqual(2);
    for (const s of selections) {
      expect(s.share).toBeGreaterThan(0);
      expect(s.share).toBeLessThanOrEqual(1);
      if (s.coefficient !== null) expect(Number.isFinite(s.coefficient)).toBe(true);
    }
    // Shares are ordered by living count.
    if (selections.length === 2) expect(selections[0]!.share).toBeGreaterThanOrEqual(selections[1]!.share);
  });

  it("renders the four research readouts", () => {
    const html = researchHtml(populated());
    expect(html).toContain("SÉLECTION PAR SOUCHE");
    expect(html).toContain("DÉRIVE NEUTRE");
    expect(html).toContain("FITNESS RÉALISÉE");
    expect(html).toContain("DISTRIBUTION DES TRAITS");
    expect(html).toContain("horloge");
  });

  it("escapes strain names instead of injecting markup", () => {
    const w = populated();
    w.renameStrain([...w.strains.keys()][0]!, "<img src=x onerror=alert(1)>");
    const html = researchHtml(w);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("falls back to lineages inside a single strain, with signed estimates", () => {
    const w = singleStrainWorld(
      historyRows([
        [0, [[1, 80], [2, 20]]],
        [10, [[1, 60], [2, 40]]],
        [20, [[1, 40], [2, 60]]],
      ]),
    );
    const report = selectionRows(w);
    expect(report.grouping).toBe("lineage");
    expect(report.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(report.rows.find((r) => r.id === 1)!.coefficient!).toBeLessThan(0);
    expect(report.rows.find((r) => r.id === 2)!.coefficient!).toBeGreaterThan(0);
    expect(report.note).toContain("entre lignées");

    const html = researchHtml(w);
    expect(html).toContain("SÉLECTION PAR LIGNÉE (souche unique)");
    expect(html).toContain("/ pas");
  });

  it("skips rows that predate a lineage instead of abandoning the series", () => {
    // Tick 0 has no organisms, so its history row carries no lineage series;
    // this used to end every series before it started.
    const rows = historyRows([
      [10, [[1, 60], [2, 40]]],
      [20, [[1, 40], [2, 60]]],
    ]);
    // Tick 0 of a world that started empty: no organisms, so no lineage series.
    const tickZero = { ...rows[0]!, tick: 0, population: 0, lineageCount: 0 } as MetricsSample;
    delete (tickZero as { lineageTop?: unknown }).lineageTop;
    const w = singleStrainWorld([tickZero, ...rows]);
    const report = selectionRows(w);
    expect(report.grouping).toBe("lineage");
    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((r) => r.coefficient !== null)).toBe(true);
  });

  it("explains a clonal population instead of printing a bare dash", () => {
    const w = singleStrainWorld(
      historyRows([
        [0, [[1, 10]]],
        [10, [[1, 12]]],
      ]),
    );
    const report = selectionRows(w);
    expect(report.grouping).toBe("none");
    expect(report.rows).toHaveLength(0);
    expect(report.note).toContain("clonale");
    expect(researchHtml(w)).toContain("clonale");
  });

  it("names the reason when the lineage history is too short to fit", () => {
    const w = singleStrainWorld(historyRows([[0, [[1, 5], [2, 5]]]]));
    const report = selectionRows(w);
    expect(report.grouping).toBe("none");
    expect(report.rows).toHaveLength(0);
    expect(report.note).toContain("historique trop court");
    expect(researchHtml(w)).toContain("historique trop court");
  });

  it("survives an empty world", () => {
    const w = new World({ width: 12, height: 12, seed: 1, startPopulation: 0 });
    const html = researchHtml(w);
    expect(html).toContain("aucun organisme vivant");
  });
});
