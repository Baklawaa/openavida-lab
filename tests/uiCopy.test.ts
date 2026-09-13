import { describe, expect, it } from "vitest";
import { BRUSH_KINDS, DNA_KITS, PARAM_SPEC } from "../src/sim/index";
import { BRUSH_LABEL, BRUSH_ORDER, FIELD_LABEL, TRAIT_HINT, TRAIT_LABEL } from "../src/ui/labels";
import { KIT_COPY } from "../src/ui/layout";
import { paramDescription as paramDescriptionLocale, paramLabel as paramLabelLocale } from "../src/ui/i18n/runtime";
import { FIELD_NAMES, TRAIT_NAMES } from "../src/sim/index";

describe("UI copy stays in sync with the simulation", () => {
  it("covers every kit with presentation copy", () => {
    expect(Object.keys(KIT_COPY).sort()).toEqual(DNA_KITS.map((k) => k.id).sort());
    for (const kit of DNA_KITS) {
      const copy = KIT_COPY[kit.id]!;
      expect(copy.label.length, kit.id).toBeGreaterThan(1);
      expect(copy.description.length, kit.id).toBeGreaterThan(10);
    }
  });

  it("labels every brush exactly once, in palette order", () => {
    expect(new Set(BRUSH_ORDER)).toEqual(new Set(BRUSH_KINDS));
    expect(BRUSH_ORDER.length).toBe(BRUSH_KINDS.length);
    for (const brush of BRUSH_KINDS) expect(BRUSH_LABEL[brush]!.length).toBeGreaterThan(1);
  });

  it("labels every trait, field and parameter", () => {
    for (const trait of TRAIT_NAMES) {
      expect(TRAIT_LABEL[trait]!.length).toBeGreaterThan(1);
      expect(TRAIT_HINT[trait]!.length).toBeGreaterThan(10);
    }
    for (const field of FIELD_NAMES) expect(FIELD_LABEL[field]!.length).toBeGreaterThan(1);
    for (const spec of PARAM_SPEC) {
      expect(paramLabelLocale(spec.key).length, spec.key).toBeGreaterThan(1);
      expect(paramDescriptionLocale(spec.key).length, spec.key).toBeGreaterThan(10);
    }
  });
});
