import { describe, expect, it } from "vitest";
import { World, founderHeterotroph, founderPhototroph } from "../src/sim/index";
import { researchHtml, strainSelections } from "../src/ui/researchCard";

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

  it("survives an empty world", () => {
    const w = new World({ width: 12, height: 12, seed: 1, startPopulation: 0 });
    const html = researchHtml(w);
    expect(html).toContain("Aucune souche vivante");
  });
});
