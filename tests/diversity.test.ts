import { describe, expect, it } from "vitest";
import { chao1, hillNumbers, rarefy, richness, shannonEvenness } from "../src/sim/index";

describe("diversity", () => {
  it("computes Hill numbers that agree for an even community", () => {
    const [q0, q1, q2] = hillNumbers([10, 10, 10, 10]);
    expect(q0).toBeCloseTo(4, 10);
    expect(q1).toBeCloseTo(4, 10);
    expect(q2).toBeCloseTo(4, 10);
    const [r0, r1, r2] = hillNumbers([100, 0, 0]);
    expect(r0).toBe(1);
    expect(r1).toBeCloseTo(1, 10);
    expect(r2).toBeCloseTo(1, 10);
  });

  it("reports lower Hill numbers for an uneven community", () => {
    const [q0, q1, q2] = hillNumbers([90, 5, 5]);
    expect(q0).toBe(3);
    expect(q1).toBeLessThan(q0);
    expect(q2).toBeLessThan(q1);
  });

  it("measures evenness, richness and unseen species", () => {
    expect(shannonEvenness([5, 5])).toBeCloseTo(1, 10);
    expect(shannonEvenness([10, 0])).toBe(0);
    expect(richness([0, 1, 2])).toBe(2);
    expect(chao1([1, 1, 1, 5])).toBeGreaterThan(4);
    expect(chao1([2, 2, 2])).toBe(3);
  });

  it("rarefies reproducibly", () => {
    const counts = [50, 30, 20, 5];
    const a = rarefy(counts, 20, 11);
    const b = rarefy(counts, 20, 11);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(1);
    expect(a).toBeLessThanOrEqual(richness(counts));
    expect(rarefy(counts, 10_000, 11)).toBe(richness(counts));
  });
});
