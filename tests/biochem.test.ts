import { describe, expect, it } from "vitest";
import {
  ENZYMES,
  MOLECULES,
  PATHWAYS,
  decodeGenome,
  enzymesFromDecoded,
  genomeForKit,
  inspectBiochem,
  metabolicDelta,
  pathwayFluxes,
} from "../src/sim/index";

describe("genome → enzyme → pathway inspect", () => {
  it("every displayed molecule and pathway is a named sim quantity", () => {
    expect(MOLECULES.length).toBeGreaterThanOrEqual(6);
    expect(PATHWAYS.length).toBeGreaterThanOrEqual(5);
    expect(ENZYMES.length).toBe(10);
    for (const m of MOLECULES) {
      expect(m.color.startsWith("#")).toBe(true);
      expect(m.description.length).toBeGreaterThan(8);
    }
  });

  it("phototroph genomes score a higher photosystem than heterotrophs", () => {
    const photo = enzymesFromDecoded(decodeGenome(genomeForKit("phototroph")));
    const hetero = enzymesFromDecoded(decodeGenome(genomeForKit("heterotroph")));
    const ps = (list: typeof photo) => list.find((e) => e.id === "photosystem")!.level;
    const perm = (list: typeof photo) => list.find((e) => e.id === "permease")!.level;
    expect(ps(photo)).toBeGreaterThan(ps(hetero));
    expect(perm(hetero)).toBeGreaterThan(perm(photo));
    expect(photo.find((e) => e.id === "photosystem")!.geneEvidence).toBeGreaterThan(0);
  });

  it("pathway fluxes are the same coefficients metabolicDelta uses", () => {
    const decoded = decodeGenome(genomeForKit("phototroph"));
    const env = { nutrient: 0.2, toxin: 0.4, temperature: 0.5, light: 0.9, exudate: 0 };
    const fluxes = pathwayFluxes(decoded.phenotype, env);
    const carbon = fluxes.find((p) => p.id === "carbon-uptake")!.flux;
    const photo = fluxes.find((p) => p.id === "photosynthesis")!.flux;
    const detox = fluxes.find((p) => p.id === "detox")!.flux;
    const therm = fluxes.find((p) => p.id === "thermostasis")!.flux;
    const maint = fluxes.find((p) => p.id === "maintenance")!.flux;
    expect(carbon).toBeCloseTo(decoded.phenotype.uptake * env.nutrient * 0.21, 10);
    expect(photo).toBeCloseTo(decoded.phenotype.photo * env.light * 0.14, 10);
    expect(detox).toBeCloseTo(env.toxin * (1 - decoded.phenotype.resist) * 0.3, 10);
    expect(therm).toBeCloseTo(Math.abs(env.temperature - decoded.phenotype.tpref) * 0.12, 10);
    expect(maint).toBeCloseTo(0.04 + 0.028 * decoded.phenotype.size, 10);
    expect(carbon + photo - detox - therm - maint).toBeCloseTo(metabolicDelta(decoded.phenotype, env), 10);
    const org = { energy: 1.1, ph: decoded.phenotype };
    const inspect = inspectBiochem(decoded, env, org);
    expect(inspect.molecules.find((m) => m.id === "photon")!.amount).toBe(env.light);
    expect(inspect.molecules.find((m) => m.id === "atp")!.amount).toBe(1.1);
    expect(inspect.netDelta).toBeCloseTo(metabolicDelta(decoded.phenotype, env), 10);
    const hydrolase = inspect.enzymes.find((e) => e.id === "hydrolase")!;
    expect(hydrolase.level).toBe(decoded.phenotype.resist);
  });
});
