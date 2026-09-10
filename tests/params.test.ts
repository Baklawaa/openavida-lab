import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  PARAMS_EXHAUSTIVE,
  PARAM_SPEC,
  QUERY_KEYS,
  buildShareURL,
  normalizeParams,
  paramSpec,
  paramsFromQuery,
  paramsToQuery,
  parseShareURL,
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

  it("exposes metadata the model panel and docs rely on", () => {
    expect(paramSpec("mutationRate")?.group).toBe("evolution");
    expect(paramSpec("width")?.integer).toBe(true);
    expect(paramSpec("disturbances")?.kind).toBe("boolean");
    for (const spec of PARAM_SPEC) {
      expect(spec.label.length, spec.key).toBeGreaterThan(1);
      expect(spec.description.length, spec.key).toBeGreaterThan(10);
    }
  });
});
