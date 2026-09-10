/**
 * Stage 1 mortality: an age-dependent hazard on top of the hard age ceiling.
 */
import { describe, expect, it } from "vitest";
import { World, founderHeterotroph } from "../src/sim/index";

function cohortOldAgeDeaths(senescenceRate: number): number {
  const w = new World({
    width: 16,
    height: 16,
    startPopulation: 0,
    seed: 9,
    mutationRate: 0,
    maxAge: 400,
  });
  w.fields.nutrient.fill(2);
  Object.assign(w.params, { senescenceRate });
  for (let i = 0; i < 24; i++) {
    w.birth(4 + (i % 6), 4 + Math.floor(i / 6), founderHeterotroph(), null, false, 3);
  }
  for (let t = 0; t < 120; t++) w.step();
  return w.deaths.filter((d) => d.cause === "old-age").length;
}

describe("senescence", () => {
  it("kills some of a cohort before the hard age ceiling, and none without it", () => {
    expect(cohortOldAgeDeaths(0)).toBe(0);
    expect(cohortOldAgeDeaths(0.5)).toBeGreaterThan(0);
  });

  it("still honours the hard maxAge ceiling", () => {
    const w = new World({ width: 12, height: 12, startPopulation: 0, seed: 4, mutationRate: 0, maxAge: 30 });
    w.fields.nutrient.fill(2);
    const org = w.birth(6, 6, founderHeterotroph(), null, false, 3)!;
    for (let t = 0; t < 60; t++) w.step();
    expect(w.organisms.find((o) => o.id === org.id)).toBeUndefined();
    expect(w.deaths.some((d) => d.orgId === org.id && d.cause === "old-age")).toBe(true);
  });
});
