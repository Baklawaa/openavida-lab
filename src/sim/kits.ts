import { decodeGenome, founderHeterotroph, founderMutualist, founderPhototroph, founderPredator, founderResistant } from "./genome";
import { BASAL, type Phenotype, type TraitName } from "./mapping";

export interface DnaKit {
  id: string;
  label: string;
  blurb: string;
  focus: TraitName;
  genome: () => string;
}

/** Named starter genomes. UI labels and tests both read this list. */
export const DNA_KITS: readonly DnaKit[] = [
  {
    id: "phototroph",
    label: "Phototroph",
    blurb: "Lives on light. Best in bright areas of the plate.",
    focus: "photo",
    genome: founderPhototroph,
  },
  {
    id: "heterotroph",
    label: "Heterotroph",
    blurb: "Eats nutrient. Paint food or it will starve.",
    focus: "uptake",
    genome: founderHeterotroph,
  },
  {
    id: "resistant",
    label: "Resistant",
    blurb: "Ignores most toxin damage. Survives magenta patches.",
    focus: "resist",
    genome: founderResistant,
  },
  {
    id: "predator",
    label: "Predator",
    blurb: "Hunts weaker neighbors and converts them to energy.",
    focus: "aggression",
    genome: founderPredator,
  },
  {
    id: "mutualist",
    label: "Mutualist",
    blurb: "Shares energy with others on the same signal channel.",
    focus: "signal",
    genome: () => founderMutualist(2),
  },
];

export function kitById(id: string): DnaKit {
  return DNA_KITS.find((k) => k.id === id) ?? DNA_KITS[1]!;
}

export function genomeForKit(id: string): string {
  return kitById(id).genome();
}

export function phenotypeForKit(id: string): Phenotype {
  return decodeGenome(genomeForKit(id)).phenotype;
}

export function kitMatchesFocus(id: string): boolean {
  const kit = kitById(id);
  const ph = phenotypeForKit(id);
  if (kit.focus === "signal") return ph.signal > BASAL.signal;
  if (kit.focus === "resist") return ph.resist > BASAL.resist + 0.2;
  if (kit.focus === "photo") return ph.photo > phenotypeForKit("heterotroph").photo;
  if (kit.focus === "uptake") return ph.uptake > phenotypeForKit("phototroph").uptake;
  if (kit.focus === "aggression") return ph.aggression > phenotypeForKit("phototroph").aggression;
  return ph[kit.focus] > BASAL[kit.focus];
}
