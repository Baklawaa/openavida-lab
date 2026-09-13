/**
 * English copy for the simulation layer (see sim.fr.ts for the same keys).
 */
export const SIM_EN = {
  /* world events (kind ids of src/sim/events.ts) ----------------------------- */
  "sim.event.lineage-dominant": "Lineage {lineage} exceeds 20% of the population.",
  "sim.event.lineage-collapse": "Lineage {lineage} dies out after exceeding 20%.",
  "sim.event.first-predation": "First predation.",
  "sim.event.innovation-sweep": "Innovation {innovation}: more than 30% of the strain's descendants.",
  "sim.event.strain-extinct": "Strain “{name}” extinct.",
  "sim.event.population-crash": "Population crash (−40% over 20 steps).",
  "sim.event.population-boom": "Population boom (+100% over 20 steps).",

  /* catalog sort presets (ids of src/sim/catalog.ts) ------------------------- */
  "sim.sort.died-fastest": "Died soonest (age at death, ascending)",
  "sim.sort.died-slowest": "Died latest (age at death, descending)",
  "sim.sort.longest-lived": "Longest lived",
  "sim.sort.youngest": "Youngest",
  "sim.sort.best-fitness": "Best fitness",
  "sim.sort.worst-fitness": "Worst fitness",
  "sim.sort.most-kills": "Most prey killed",
  "sim.sort.most-births": "Most direct descendants",
  "sim.sort.most-mass": "Greatest mass",
  "sim.sort.most-energy": "Most energy (living)",
  "sim.sort.newest": "Most recently born",
  "sim.sort.oldest": "Earliest born",
  "sim.sort.trait": "Max trait: {trait}",

  /* DNA editor validation (ids of src/sim/dnaEdit.ts) ------------------------ */
  "sim.dna.empty": "Empty genome: add a gene or pick a starter kit.",
  "sim.dna.too-short": "Very short genome ({bases} bases). Viable organisms have at least {min} bases.",
  "sim.dna.too-long": "Maximum size reached ({max} bases). Insertions are truncated.",
  "sim.dna.open-gene": "Unfinished gene from base {from}: add TAA, TAG or TGA. This part is ignored.",
  "sim.dna.max-expression": "Gene {gene} at maximum expression (×{multiplier}): extra upstream codons add nothing.",
  "sim.dna.no-readable-gene": "No readable gene: the phenotype stays basal.",
} as const;
