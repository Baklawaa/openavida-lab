import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, PARAM_SPEC, normalizeParams } from "../src/sim/index";
import { LEGACY_V1_PROFILE, MODEL_GROUPS, modelControls, paramsFromForm } from "../src/ui/modelPanel";

describe("model panel data", () => {
  it("offers exactly one control per parameter spec", () => {
    const controls = modelControls(DEFAULT_PARAMS);
    expect(controls).toHaveLength(PARAM_SPEC.length);
    expect(new Set(controls.map((c) => c.spec.key))).toEqual(new Set(PARAM_SPEC.map((s) => s.key)));
    for (const spec of PARAM_SPEC) expect(MODEL_GROUPS).toContain(spec.group);
  });

  it("coerces form values back into a parameter patch", () => {
    const patch = paramsFromForm(
      { width: "64", mutationRate: "0.4", disturbances: "1", regulationEnabled: "0", ignored: "9" },
      new Set(["disturbances", "regulationEnabled"]),
    );
    expect(patch.width).toBe(64);
    expect(patch.mutationRate).toBe(0.4);
    expect(patch.disturbances).toBe(true);
    expect(patch.regulationEnabled).toBe(false);
    expect((patch as Record<string, unknown>).ignored).toBeUndefined();
    expect(paramsFromForm({ width: "" }, new Set()).width).toBeUndefined();
    expect(paramsFromForm({ width: "abc" }, new Set()).width).toBeUndefined();
  });

  it("bounds typed values by the specification instead of writing them through", () => {
    const tooBig = paramsFromForm({ maxMealsPerTick: "99", nutrientInflow: "9" }, new Set());
    expect(tooBig.maxMealsPerTick).toBe(8);
    expect(tooBig.nutrientInflow).toBe(0.2);
    const tooSmall = paramsFromForm({ senescenceRate: "-2", width: "3.7" }, new Set());
    expect(tooSmall.senescenceRate).toBe(0);
    expect(tooSmall.width).toBe(8);
  });

  it("keeps the legacy profile inside the current spec", () => {
    const keys = new Set(PARAM_SPEC.map((s) => s.key));
    for (const key of Object.keys(LEGACY_V1_PROFILE)) {
      expect(keys.has(key as never), key).toBe(true);
    }
    const applied = normalizeParams({ ...DEFAULT_PARAMS, ...LEGACY_V1_PROFILE });
    expect(applied.maxMealsPerTick).toBe(8);
    expect(applied.regulationEnabled).toBe(false);
    expect(applied.exudateLeak).toBe(0);
    expect(applied.senescenceRate).toBe(0);
    // Every override survives normalization (no value is out of spec).
    for (const [key, value] of Object.entries(LEGACY_V1_PROFILE)) {
      expect((applied as unknown as Record<string, unknown>)[key], key).toBe(value);
    }
  });
});
