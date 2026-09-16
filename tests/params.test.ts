import { describe, expect, it } from "vitest";
import { paramLabel } from "../src/ui/i18n/runtime";
import {
  DEFAULT_PARAMS,
  PARAMS_EXHAUSTIVE,
  PARAM_SPEC,
  QUERY_KEYS,
  World,
  buildShareURL,
  decodeGenome,
  fitness,
  genomeForKit,
  maintenanceCost,
  normalizeParams,
  paramSpec,
  paramsFromQuery,
  paramsToQuery,
  parseShareURL,
  placeOrganismAt,
  upkeepRates,
} from "../src/sim/index";

describe("parameter spec", () => {
  it("covers SimParams exactly once and drives the query keys", () => {
    expect(PARAMS_EXHAUSTIVE).toBe(true);
    const keys = PARAM_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(QUERY_KEYS)).toEqual(new Set(keys));
    expect(keys.length).toBe(Object.keys(DEFAULT_PARAMS).length);
  });

  it("derives defaults from the spec and clamps out-of-range values", () => {
    for (const spec of PARAM_SPEC) expect(DEFAULT_PARAMS[spec.key]).toBe(spec.default);
    expect(normalizeParams({ width: 4 }).width).toBe(8);
    expect(normalizeParams({ width: 999 }).width).toBe(256);
    expect(normalizeParams({ mutationRate: -3 }).mutationRate).toBe(0);
    expect(normalizeParams({ mutationRate: 9 }).mutationRate).toBe(1);
    expect(normalizeParams({ seed: 0 }).seed).toBe(1);
    expect(normalizeParams({ maxPopulation: 20, startPopulation: 999 }).startPopulation).toBe(20);
    expect(normalizeParams({ disturbances: 1 as unknown as boolean }).disturbances).toBe(true);
    expect(Number.isNaN(normalizeParams({ reproduceEnergy: Number.NaN }).reproduceEnergy)).toBe(false);
  });

  it("round-trips every parameter through the query string and the share URL", () => {
    const p = normalizeParams({
      seed: 7,
      width: 64,
      height: 48,
      mutationRate: 0.33,
      disturbances: true,
      maxPopulation: 200,
      startPopulation: 12,
    });
    const back = paramsFromQuery(paramsToQuery(p));
    for (const spec of PARAM_SPEC) expect(back[spec.key], spec.key).toBe(p[spec.key]);
    const url = buildShareURL(p, "https://example.test", "/x");
    const parsed = parseShareURL(url);
    expect(parsed.mutationRate).toBeCloseTo(0.33, 10);
    expect(parsed.disturbances).toBe(true);
    expect(parsed.width).toBe(64);
  });

  // The four trade-off parameters are the model's newest research surfaces.
  // Each assertion below fails if the value stops reaching the model, which is
  // exactly what happened when they were constants: changing one meant editing
  // code, and a refactor could have quietly re-hardcoded them.
  it("drives the ledgers from the upkeep parameters", () => {
    const ph = { ...decodeGenome(genomeForKit("heterotroph")).phenotype, aggression: 0.5, longevity: 1.5 };
    const free = { longevity: 0, aggression: 0 };
    const priced = { longevity: 0.012, aggression: 0.3 };
    expect(maintenanceCost(ph, 1, 0, free)).toBeLessThan(maintenanceCost(ph, 1, 0, priced));
    expect(maintenanceCost(ph, 1, 0, priced) - maintenanceCost(ph, 1, 0, free)).toBeCloseTo(
      0.012 * 0.5 + 0.3 * 0.5,
      10,
    );
    // Both ledgers, not just the energy one.
    const env = { nutrient: 1, toxin: 0, temperature: 0.5, light: 0.5, exudate: 0 };
    const none = { predationGain: 0 };
    expect(fitness(ph, env, none, 1, 0, free)).toBeGreaterThan(fitness(ph, env, none, 1, 0, priced));
    expect(upkeepRates(DEFAULT_PARAMS)).toEqual(priced);
  });

  it("relaxes the climate towards ambientTemperature", () => {
    const w = new World({ width: 8, height: 8, startPopulation: 0, ambientTemperature: 0.2 });
    w.fields.temperature.fill(0.9);
    // Three time constants of temperatureDecay 0.002: the exponential has
    // closed to within 1 % of the ambient.
    for (let i = 0; i < 3000; i++) w.step();
    const mean = [...w.fields.temperature].reduce((s, v) => s + v, 0) / w.fields.temperature.length;
    expect(mean).toBeGreaterThan(0.18);
    expect(mean).toBeLessThan(0.22);
    // Float32 plane: compare with a tolerance, not exactly.
    expect(
      new World({ width: 8, height: 8, startPopulation: 0, ambientTemperature: 0.2 }).fields.temperature[0],
    ).toBeCloseTo(0.2, 6);
  });

  it("rations the graze with nutrientUptakeCap", () => {
    const strip = (cap: number) => {
      const w = new World({ width: 16, height: 16, startPopulation: 0, nutrientUptakeCap: cap, ambientTemperature: 0.5 });
      w.fields.nutrient.fill(4);
      placeOrganismAt(w, 8, 8, genomeForKit("heterotroph"));
      const before = 4;
      w.step();
      return before - w.fields.nutrient[w.fields.idx(8, 8)]!;
    };
    const sip = strip(0.02);
    const gulp = strip(0.4);
    expect(sip).toBeGreaterThan(0);
    expect(gulp).toBeGreaterThan(sip * 5);
  });

  it("exposes metadata the model panel and docs rely on", () => {
    expect(paramSpec("mutationRate")?.group).toBe("evolution");
    expect(paramSpec("width")?.integer).toBe(true);
    expect(paramSpec("disturbances")?.kind).toBe("boolean");
    for (const spec of PARAM_SPEC) {
      // Labels are interface copy and live in the locale catalogs now.
      expect(paramLabel(spec.key), spec.key).not.toBe(`param.${spec.key}.label`);
      expect(spec.description.length, spec.key).toBeGreaterThan(10);
    }
  });
});
