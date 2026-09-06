import { describe, expect, it } from "vitest";
import { chartCeiling, chartDomain } from "../src/render/charts";

describe("chart scales", () => {
  it("covers both fitness curves with a common, zero-based scale", () => {
    expect(chartCeiling([0.1, 0.2, 1.4, 1.7])).toBe(2);
    expect(chartCeiling([0.0012, 0.0017])).toBe(0.002);
  });
  it("keeps empty, extinct and non-finite samples drawable", () => {
    expect(chartCeiling([])).toBe(1);
    expect(chartCeiling([0, 0])).toBe(1);
    expect(chartCeiling([NaN, Infinity, 0.3])).toBeCloseTo(0.3);
  });
  it("includes negative energy balances and a zero reference", () => {
    expect(chartDomain([-0.2, 0.5])).toEqual([-0.2, 0.5]);
    expect(chartDomain([-0.5, -0.1])).toEqual([-0.5, 0]);
    expect(chartDomain([0, 0])).toEqual([0, 1]);
  });
});
