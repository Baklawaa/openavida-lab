import { describe, expect, it } from "vitest";
import { World, founderPhototroph } from "../src/sim/index";
import {
  describeExudate,
  EXUDATE_OVERLAY_ALPHA,
  normalizeOverlay,
  overlayByte,
} from "../src/render/overlay";

describe("overlay rendering helpers", () => {
  it("normalises to the maximum and reports the statistics", () => {
    const src = new Float32Array([0, 0.5, 2, 1]);
    const out = new Float32Array(4);
    const stats = normalizeOverlay(src, out);
    expect(stats.max).toBe(2);
    expect(stats.producers).toBe(3);
    expect(Array.from(out)).toEqual([0, 0.25, 1, 0.5]);
  });

  it("leaves an empty field empty instead of dividing by zero", () => {
    const out = new Float32Array([9, 9, 9]);
    const stats = normalizeOverlay(new Float32Array(3), out);
    expect(stats.max).toBe(0);
    expect(stats.producers).toBe(0);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it("keeps faint cells visible through the gamma LUT", () => {
    expect(overlayByte(0)).toBe(0);
    expect(overlayByte(1)).toBe(255);
    expect(overlayByte(2)).toBe(255);
    expect(overlayByte(-1)).toBe(0);
    // The regression this fixes: a cell at 2 % of the maximum used to round to
    // 5/255 with a linear mapping and vanish under a 0.42 alpha.
    expect(overlayByte(0.02)).toBeGreaterThan(30);
    expect(overlayByte(0.02)).toBeLessThan(60);
    expect(overlayByte(0.25)).toBeLessThan(overlayByte(0.5));
    expect(overlayByte(0.5)).toBeLessThan(overlayByte(0.9));
  });

  it("measures an empty and a populated exudate layer", () => {
    // Structured on purpose: the sentence is composed by the caller's locale
    // catalog, so the plate note can be translated without touching the renderer.
    const empty = new World({ width: 12, height: 12, startPopulation: 0, seed: 3 });
    const none = describeExudate(empty);
    expect(none.max).toBe(0);
    expect(none.producers).toBe(0);
    expect(none.total).toBe(0);
    expect(none.visible).toBe(0);

    const w = new World({ width: 12, height: 12, startPopulation: 0, seed: 3 });
    w.fields.nutrient.fill(0);
    w.fields.light.fill(1);
    w.fields.solar.fill(1);
    const producer = w.birth(6, 6, founderPhototroph(), null, false, 3)!;
    producer.ph.photo = 2.2;
    producer.ph.signal = 0;
    for (let i = 0; i < 12; i++) w.step();
    const stats = describeExudate(w);
    expect(stats.max).toBeGreaterThan(0);
    expect(stats.producers).toBeGreaterThan(0);
    expect(stats.visible).toBeGreaterThan(0);
    expect(stats.visible).toBeLessThanOrEqual(w.w * w.h);
    expect(stats.total).toBeGreaterThan(0);
    expect(w.fields.exudate.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
  });

  it("exposes the alpha the app applies to the exudate layer", () => {
    expect(EXUDATE_OVERLAY_ALPHA).toBeGreaterThan(0.42);
  });
});
