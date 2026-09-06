import type { TraitName } from "../sim/mapping";
import type { DeathCause } from "../sim/types";

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
