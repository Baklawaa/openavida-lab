import type { TraitName } from "../sim/mapping";
import type { FieldName } from "../sim/fields";
import type { BrushKind, DeathCause } from "../sim/types";

export const DEATH_LABEL: Record<DeathCause, string> = {
  starvation: "Manque de nourriture ou de lumière", toxin: "Intoxication", crowding: "Surpopulation",
  "old-age": "Vieillesse", predation: "Prédation", competition: "Compétition",
  crash: "Événement aléatoire", wipe: "Retrait au pinceau", bottleneck: "Goulot d’étranglement",
};

export const TRAIT_LABEL: Record<TraitName, string> = {
  uptake: "Nutrition", photo: "Photosynthèse", resist: "Résistance", tpref: "Température",
  motility: "Mobilité", aggression: "Prédation", signal: "Coopération", hue: "Couleur",
  fecundity: "Reproduction", size: "Taille",
};

export const TRAIT_HINT: Record<TraitName, string> = {
  uptake: "Absorbe les nutriments disponibles dans le milieu.",
  photo: "Transforme la lumière locale en énergie.",
  resist: "Réduit les dommages causés par les toxines.",
  tpref: "Définit la température idéale de l’organisme.",
  motility: "Augmente la capacité à se déplacer.",
  aggression: "Permet de tirer de l’énergie de ses proies.",
  signal: "Définit le canal de coopération entre organismes.",
  hue: "Modifie la couleur, sans effet sur la fitness.",
  fecundity: "Modifie la capacité à se reproduire.",
  size: "Modifie la taille et le coût énergétique d’entretien.",
};

/** Every brush, in the order the Milieu palette shows them. */
export const BRUSH_ORDER: readonly BrushKind[] = [
  "nutrientBlob", "toxinBlob", "heatBlob", "lightBlob", "barrier", "erase",
  "nutrientVent", "toxinVent", "thermalVent", "shade", "wipeOrgs",
];

export const BRUSH_LABEL: Record<BrushKind, string> = {
  barrier: "Obstacle",
  erase: "Gomme",
  nutrientVent: "Source nutritive",
  toxinVent: "Source toxique",
  thermalVent: "Source de chaleur",
  shade: "Ombre",
  nutrientBlob: "Nutriments",
  toxinBlob: "Toxines",
  heatBlob: "Chaleur",
  lightBlob: "Lumière",
  wipeOrgs: "Retirer la vie",
};

export const FIELD_LABEL: Record<FieldName, string> = {
  nutrient: "nutriments",
  toxin: "toxines",
  temperature: "température",
  light: "lumière",
};

/** Parameters a scheduled programme can write. */
export const SCHED_PARAM_LABEL: Record<string, string> = {
  mutationRate: "taux de mutation",
  maxPopulation: "population max",
  reproduceEnergy: "seuil de reproduction",
};
