/**
 * French copy for the simulation layer (src/sim): the sentences the interface
 * builds from the structured values the sim returns — world events
 * (src/sim/events.ts), catalog sort presets (src/sim/catalog.ts) and the DNA
 * editor's validation messages (src/sim/dnaEdit.ts).
 *
 * The sim never imports this catalog: it returns stable ids and named values,
 * and the interface (src/app.ts, src/ui/explorer.ts, src/ui/dnaEditor.ts)
 * renders them through tDynamic.
 */
export const SIM_FR = {
  /* world events (kind ids of src/sim/events.ts) ----------------------------- */
  "sim.event.lineage-dominant": "Lignée {lineage} dépasse 20 % de la population.",
  "sim.event.lineage-collapse": "Lignée {lineage} s’éteint après avoir dépassé 20 %.",
  "sim.event.first-predation": "Première prédation.",
  "sim.event.innovation-sweep": "Innovation {innovation} : plus de 30 % des descendants de la souche.",
  "sim.event.strain-extinct": "Souche « {name} » éteinte.",
  "sim.event.population-crash": "Chute de population (−40 % en 20 pas).",
  "sim.event.population-boom": "Essor de population (+100 % en 20 pas).",

  /* catalog sort presets (ids of src/sim/catalog.ts) ------------------------- */
  "sim.sort.died-fastest": "Morts le plus vite (âge au décès croissant)",
  "sim.sort.died-slowest": "Morts le plus tard (âge au décès décroissant)",
  "sim.sort.longest-lived": "Plus longue vie",
  "sim.sort.youngest": "Plus jeunes",
  "sim.sort.best-fitness": "Meilleure fitness",
  "sim.sort.worst-fitness": "Pire fitness",
  "sim.sort.most-kills": "Plus de proies tuées",
  "sim.sort.most-births": "Plus de descendants directs",
  "sim.sort.most-mass": "Plus forte corpulence",
  "sim.sort.most-energy": "Plus d’énergie (vivants)",
  "sim.sort.newest": "Nés le plus récemment",
  "sim.sort.oldest": "Nés le plus tôt",
  "sim.sort.trait": "Trait maximal : {trait}",

  /* DNA editor validation (ids of src/sim/dnaEdit.ts) ------------------------ */
  "sim.dna.empty": "Génome vide : ajoutez un gène ou choisissez un kit.",
  "sim.dna.too-short": "Génome très court ({bases} bases). Les organismes viables ont au moins {min} bases.",
  "sim.dna.too-long": "Taille maximale atteinte ({max} bases). Les insertions sont tronquées.",
  "sim.dna.open-gene": "Gène non terminé à partir de la base {from} : ajoutez TAA, TAG ou TGA. Cette partie est ignorée.",
  "sim.dna.max-expression": "Gène {gene} à expression maximale (×{multiplier}) : les codons amont supplémentaires n’ajoutent rien.",
  "sim.dna.no-readable-gene": "Aucun gène lisible : le phénotype reste basal.",
} as const;
