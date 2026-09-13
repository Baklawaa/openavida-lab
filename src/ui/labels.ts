/**
 * Label maps for the interface, built from the locale catalog.
 *
 * The active locale is fixed for the life of a page — switching language
 * reloads — so these can be plain objects built once at module load: every call
 * site keeps indexing them (`TRAIT_LABEL[trait]`, `Object.keys(DEATH_LABEL)`)
 * while the copy itself lives in src/ui/i18n.
 */
import type { TraitName } from "../sim/mapping";
import { TRAIT_NAMES } from "../sim/mapping";
import type { Strategy } from "../sim/species";
import { STRATEGIES } from "../sim/species";
import { BRUSH_KINDS, type BrushKind, type DeathCause } from "../sim/types";
import type { FieldName } from "../sim/fields";
import { FIELD_NAMES } from "../sim/fields";
import {
  brushLabel,
  deathLabel,
  deathShortLabel,
  fieldLabel,
  schedParamLabel,
  strategyLabel,
  traitAbbr,
  traitHint,
  traitLabel,
} from "./i18n/runtime";

function labelMap<T extends string>(keys: readonly T[], value: (key: T) => string): Record<T, string> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<T, string>;
}

/** Every death cause; the simulation keeps the list, the labels live here. */
export const DEATH_CAUSES: readonly DeathCause[] = [
  "starvation", "toxin", "crowding", "old-age", "predation",
  "competition", "crash", "wipe", "bottleneck", "washout",
];

export const DEATH_LABEL: Record<DeathCause, string> = labelMap(DEATH_CAUSES, deathLabel);
export const DEATH_SHORT: Record<DeathCause, string> = labelMap(DEATH_CAUSES, deathShortLabel);
export const TRAIT_LABEL: Record<TraitName, string> = labelMap(TRAIT_NAMES, traitLabel);
export const TRAIT_HINT: Record<TraitName, string> = labelMap(TRAIT_NAMES, traitHint);
export const TRAIT_ABBR: Record<TraitName, string> = labelMap(TRAIT_NAMES, traitAbbr);
export const BRUSH_LABEL: Record<BrushKind, string> = labelMap(BRUSH_KINDS, brushLabel);
export const FIELD_LABEL: Record<FieldName, string> = labelMap(FIELD_NAMES, fieldLabel);
export const STRATEGY_LABEL: Record<Strategy, string> = labelMap(STRATEGIES, strategyLabel);

/** Every brush, in the order the Milieu palette shows them. */
export const BRUSH_ORDER: readonly BrushKind[] = [
  "nutrientBlob", "toxinBlob", "heatBlob", "lightBlob", "barrier", "erase",
  "nutrientVent", "toxinVent", "thermalVent", "shade", "wipeOrgs",
];

/** Parameters a scheduled programme can write. */
export const SCHED_PARAM_LABEL: Record<string, string> = Object.fromEntries(
  ["mutationRate", "maxPopulation", "reproduceEnergy"].map((key) => [key, schedParamLabel(key)]),
);
