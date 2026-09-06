import { describe, expect, it } from "vitest";
import { BASAL, DNA_KITS, decodeGenome, genomeForKit, kitMatchesFocus, phenotypeForKit } from "../src/sim/index";

describe("DNA kits", () => {
  it("each named kit decodes to the advertised focus trait", () => {
    expect(DNA_KITS.length).toBeGreaterThanOrEqual(5);
    for (const kit of DNA_KITS) {
      expect(kit.label.trim().length).toBeGreaterThan(3);
      expect(kit.blurb.trim().length).toBeGreaterThan(8);
      const seq = genomeForKit(kit.id);
      const ph = decodeGenome(seq).phenotype;
      expect(ph).toEqual(phenotypeForKit(kit.id));
      expect(kitMatchesFocus(kit.id)).toBe(true);
    }
    const photo = phenotypeForKit("phototroph");
    const hetero = phenotypeForKit("heterotroph");
    const resist = phenotypeForKit("resistant");
    const pred = phenotypeForKit("predator");
    expect(photo.photo).toBeGreaterThan(hetero.photo);
    expect(hetero.uptake).toBeGreaterThan(photo.uptake);
    expect(resist.resist).toBeGreaterThan(BASAL.resist);
    expect(pred.aggression).toBeGreaterThan(photo.aggression);
  });
});
