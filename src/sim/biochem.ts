/**
 * Named molecules, enzymes, and pathways derived from the genome→phenotype
 * map and the live fields. Fluxes use the same coefficients as metabolicDelta
 * / fitness so inspect is a readout of sim state, not a decorative overlay.
 */
import { TRAIT_COLOR, TRAIT_NAMES, type Phenotype, type TraitName } from "./mapping";
import { metabolicDelta } from "./fitness";
import { EXUDATE_YIELD, PHOTO_GAIN, UPTAKE_GAIN } from "./chemistry";
import type { DecodedGenome } from "./genome";
import type { EnvSample, Organism } from "./types";

export type MoleculeId =
  | "glucose"
  | "photon"
  | "xenobiotic"
  | "heat"
  | "atp"
  | "biomass"
  | "autoinducer"
  | "exudate";

export interface MoleculeSpec {
  id: MoleculeId;
  name: string;
  color: string;
  source: "field" | "organism";
  field?: keyof EnvSample;
  description: string;
}

export const MOLECULES: readonly MoleculeSpec[] = [
  {
    id: "glucose",
    name: "glucose (nutrient)",
    color: TRAIT_COLOR.uptake,
    source: "field",
    field: "nutrient",
    description: "Local nutrient field — carbon source for permease",
  },
  {
    id: "photon",
    name: "photons (light)",
    color: TRAIT_COLOR.photo,
    source: "field",
    field: "light",
    description: "Local light field — substrate for photosystem",
  },
  {
    id: "xenobiotic",
    name: "xenobiotic (toxin)",
    color: TRAIT_COLOR.resist,
    source: "field",
    field: "toxin",
    description: "Local toxin field — damage unless hydrolase is high",
  },
  {
    id: "heat",
    name: "heat",
    color: TRAIT_COLOR.tpref,
    source: "field",
    field: "temperature",
    description: "Local temperature — cost scales with |T − tpref|",
  },
  {
    id: "atp",
    name: "ATP (energy)",
    color: TRAIT_COLOR.motility,
    source: "organism",
    description: "Organism energy pool — integral of metabolicDelta",
  },
  {
    id: "biomass",
    name: "biomass",
    color: TRAIT_COLOR.size,
    source: "organism",
    description: "energy × size; maintenance and display scale",
  },
  {
    id: "autoinducer",
    name: "autoinducer (signal)",
    color: TRAIT_COLOR.signal,
    source: "organism",
    description: "Receptor channel 0–7; signal ≥ 1 takes up exudate at a rate scaled by the channel",
  },
  {
    id: "exudate",
    name: "exudate (cross-feeding)",
    color: TRAIT_COLOR.signal,
    source: "field",
    field: "exudate",
    description: "Overflow photosynthesis leaked by rich phototrophs; consumed with an 0.8 yield",
  },
] as const;

export interface EnzymeSpec {
  id: string;
  name: string;
  trait: TraitName;
  color: string;
  description: string;
}

export const ENZYMES: readonly EnzymeSpec[] = [
  { id: "permease", name: "Nutrient permease", trait: "uptake", color: TRAIT_COLOR.uptake, description: "Imports glucose from the nutrient field" },
  { id: "photosystem", name: "Photosystem", trait: "photo", color: TRAIT_COLOR.photo, description: "Converts photons into ATP" },
  { id: "hydrolase", name: "Toxin hydrolase", trait: "resist", color: TRAIT_COLOR.resist, description: "Neutralizes xenobiotic; residual toxin still costs ATP" },
  { id: "thermoregulin", name: "Thermoregulin", trait: "tpref", color: TRAIT_COLOR.tpref, description: "Sets preferred temperature" },
  { id: "motor", name: "Flagellar motor", trait: "motility", color: TRAIT_COLOR.motility, description: "Spends ATP to move" },
  { id: "protease", name: "Hunt protease", trait: "aggression", color: TRAIT_COLOR.aggression, description: "Converts prey biomass into ATP" },
  { id: "synthase", name: "Autoinducer synthase", trait: "signal", color: TRAIT_COLOR.signal, description: "Exudate receptor; gates cross-feeding uptake" },
  { id: "pigment", name: "Pigment", trait: "hue", color: TRAIT_COLOR.hue, description: "Display only — not a fitness input" },
  { id: "replicase", name: "Replicase", trait: "fecundity", color: TRAIT_COLOR.fecundity, description: "Lowers energy threshold to divide" },
  { id: "mutase", name: "Mutase", trait: "mutator", color: TRAIT_COLOR.mutator, description: "Scales the mutation rate of this organism's births" },
  { id: "structin", name: "Structural protein", trait: "size", color: TRAIT_COLOR.size, description: "Body size; raises maintenance" },
] as const;

export type PathwayId =
  | "carbon-uptake"
  | "photosynthesis"
  | "detox"
  | "thermostasis"
  | "maintenance"
  | "motility"
  | "predation"
  | "exudation"
  | "replication";

export interface PathwaySpec {
  id: PathwayId;
  name: string;
  enzymeId: string;
  reactants: MoleculeId[];
  products: MoleculeId[];
  description: string;
}

export const PATHWAYS: readonly PathwaySpec[] = [
  {
    id: "carbon-uptake",
    name: "Carbon uptake",
    enzymeId: "permease",
    reactants: ["glucose"],
    products: ["atp"],
    description: "uptake × nutrient × 0.21 (metabolicDelta harvest)",
  },
  {
    id: "photosynthesis",
    name: "Photosynthesis",
    enzymeId: "photosystem",
    reactants: ["photon"],
    products: ["atp"],
    description: "photo × light × 0.14 (metabolicDelta harvest)",
  },
  {
    id: "detox",
    name: "Detoxification",
    enzymeId: "hydrolase",
    reactants: ["xenobiotic", "atp"],
    products: [],
    description: "toxin × (1 − resist) × 0.3 — ATP drain from residual toxin",
  },
  {
    id: "thermostasis",
    name: "Thermostasis",
    enzymeId: "thermoregulin",
    reactants: ["heat", "atp"],
    products: [],
    description: "|temperature − tpref| × 0.12",
  },
  {
    id: "maintenance",
    name: "Maintenance",
    enzymeId: "structin",
    reactants: ["atp"],
    products: ["biomass"],
    description: "0.04 + 0.028 × size",
  },
  {
    id: "motility",
    name: "Motility",
    enzymeId: "motor",
    reactants: ["atp"],
    products: [],
    description: "Per-tick move attempt probability = motility trait",
  },
  {
    id: "predation",
    name: "Predation",
    enzymeId: "protease",
    reactants: ["biomass"],
    products: ["atp"],
    description: "Neighbor predationGain when aggression exceeds threshold",
  },
  {
    id: "exudation",
    name: "Exudate overflow",
    enzymeId: "synthase",
    reactants: ["atp"],
    products: ["exudate"],
    description: "producer leaks a share of its photosynthetic surplus; signal ≥ 1 consumers take it up at an 0.8 yield",
  },
  {
    id: "replication",
    name: "Replication",
    enzymeId: "replicase",
    reactants: ["atp"],
    products: ["biomass"],
    description: "Division when energy ≥ reproduceThreshold(fecundity)",
  },
];

export interface EnzymeLevel {
  id: string;
  name: string;
  trait: TraitName;
  color: string;
  level: number;
  geneEvidence: number;
  description: string;
}

export interface MoleculeAmount {
  id: MoleculeId;
  name: string;
  color: string;
  amount: number;
  source: "field" | "organism";
  description: string;
}

export interface PathwayFlux {
  id: PathwayId;
  name: string;
  enzymeId: string;
  reactants: MoleculeId[];
  products: MoleculeId[];
  flux: number;
  description: string;
}

export interface BiochemInspect {
  enzymes: EnzymeLevel[];
  molecules: MoleculeAmount[];
  pathways: PathwayFlux[];
  netDelta: number;
}

const TRAIT_ENZYME: Record<TraitName, string> = {
  uptake: "permease",
  photo: "photosystem",
  resist: "hydrolase",
  tpref: "thermoregulin",
  motility: "motor",
  aggression: "protease",
  signal: "synthase",
  hue: "pigment",
  fecundity: "replicase",
  size: "structin",
  mutator: "mutase",
};

export function enzymesFromDecoded(decoded: DecodedGenome): EnzymeLevel[] {
  const evidence: Record<string, number> = {};
  for (const g of decoded.genes) {
    const trait = (TRAIT_NAMES as readonly string[]).includes(g.dominant)
      ? (g.dominant as TraitName)
      : "uptake";
    const id = TRAIT_ENZYME[trait];
    const mag = Math.abs(g.contrib[trait] ?? 0) + g.translation.length * 0.01;
    evidence[id] = (evidence[id] ?? 0) + mag;
  }
  return enzymesFromPhenotype(decoded.phenotype, evidence);
}

export function enzymesFromPhenotype(
  ph: Phenotype,
  geneEvidence: Record<string, number> = {},
): EnzymeLevel[] {
  return ENZYMES.map((e) => ({
    id: e.id,
    name: e.name,
    trait: e.trait,
    color: e.color,
    level: Number(ph[e.trait]),
    geneEvidence: geneEvidence[e.id] ?? 0,
    description: e.description,
  }));
}

export function moleculeAmounts(env: EnvSample, org: { energy: number; ph: Phenotype }): MoleculeAmount[] {
  return MOLECULES.map((m) => {
    let amount = 0;
    if (m.field) amount = env[m.field];
    else if (m.id === "atp") amount = org.energy;
    else if (m.id === "biomass") amount = org.energy * org.ph.size;
    else if (m.id === "autoinducer") amount = org.ph.signal;
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      amount,
      source: m.source,
      description: m.description,
    };
  });
}

export function pathwayFluxes(
  ph: Phenotype,
  env: EnvSample,
  neighbors: { predationGain: number } = { predationGain: 0 },
): PathwayFlux[] {
  const carbon = ph.uptake * env.nutrient * UPTAKE_GAIN;
  const photo = ph.photo * env.light * PHOTO_GAIN;
  const detox = env.toxin * (1 - ph.resist) * 0.3;
  const therm = Math.abs(env.temperature - ph.tpref) * 0.12;
  const maintain = 0.04 + 0.028 * ph.size;
  // Potential overflow out of the organism plus the uptake a receptor enables.
  const exudation =
    ph.photo * env.light * PHOTO_GAIN +
    (ph.signal >= 1 ? ph.uptake * env.exudate * EXUDATE_YIELD : 0);
  const fluxes: Record<PathwayId, number> = {
    "carbon-uptake": carbon,
    photosynthesis: photo,
    detox,
    thermostasis: therm,
    maintenance: maintain,
    motility: ph.motility,
    predation: neighbors.predationGain,
    exudation,
    replication: ph.fecundity,
  };
  return PATHWAYS.map((p) => ({
    id: p.id,
    name: p.name,
    enzymeId: p.enzymeId,
    reactants: [...p.reactants],
    products: [...p.products],
    flux: fluxes[p.id] ?? 0,
    description: p.description,
  }));
}

export function inspectBiochem(
  decoded: DecodedGenome,
  env: EnvSample,
  org: Pick<Organism, "energy" | "ph">,
  neighbors?: { predationGain: number },
): BiochemInspect {
  const pathways = pathwayFluxes(org.ph, env, neighbors);
  return {
    enzymes: enzymesFromDecoded(decoded),
    molecules: moleculeAmounts(env, org),
    pathways,
    netDelta: metabolicDelta(org.ph, env),
  };
}

export function moleculeById(id: MoleculeId): MoleculeSpec {
  return MOLECULES.find((m) => m.id === id)!;
}

export function pathwaysHtml(b: BiochemInspect): string {
  const mol = b.molecules
    .map((m) => {
      const w = Math.max(2, Math.min(100, Math.abs(m.amount) * 40));
      return `<div class="pw-row">
        <span class="swatch" style="background:${m.color}"></span>
        <span class="trait-name">${m.name}</span>
        <span class="trait-val mono">${m.amount.toFixed(3)}</span>
        <span class="trait-bar"><i style="width:${w}%;background:${m.color}"></i></span>
      </div>`;
    })
    .join("");
  const enz = b.enzymes
    .map((e) => {
      const w = Math.max(2, Math.min(100, Math.abs(e.level) * 40));
      return `<div class="pw-row">
        <span class="swatch" style="background:${e.color}"></span>
        <span class="trait-name">${e.name}</span>
        <span class="trait-val mono">${e.level.toFixed(3)}</span>
        <span class="muted">${e.geneEvidence > 0 ? "ORF" : "basal"}</span>
        <span class="trait-bar"><i style="width:${w}%;background:${e.color}"></i></span>
      </div>`;
    })
    .join("");
  const paths = b.pathways
    .map((p) => {
      const enz = b.enzymes.find((e) => e.id === p.enzymeId);
      const color = enz?.color ?? "#8aa0b5";
      const rx = p.reactants.join(" + ") || "∅";
      const px = p.products.join(" + ") || "∅";
      const w = Math.max(2, Math.min(100, Math.abs(p.flux) * 80));
      return `<div class="pw-path" style="border-left-color:${color}">
        <strong>${p.name}</strong>
        <div class="muted">${rx} → ${px} · ${p.enzymeId}</div>
        <div class="mono">flux ${p.flux.toFixed(3)}</div>
        <span class="trait-bar"><i style="width:${w}%;background:${color}"></i></span>
        <div class="hint">${p.description}</div>
      </div>`;
    })
    .join("");
  return `<div class="biochem">
    <div class="tiny">Molecules (sim state)</div>
    ${mol}
    <div class="tiny" style="margin-top:8px">Enzymes (genome → trait)</div>
    ${enz}
    <div class="tiny" style="margin-top:8px">Pathways · net ΔE ${b.netDelta.toFixed(3)}</div>
    ${paths}
  </div>`;
}
