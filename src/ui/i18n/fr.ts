/**
 * The French message catalog: the single source of user-visible French in the
 * interface. Sections are spread in order; tests/i18n.test.ts asserts no key is
 * defined twice and that nothing outside this directory carries French copy.
 */
import { APP_FR } from "./fr.app";
import { DNA_FR } from "./fr.dna";
import { EXPLORER_FR } from "./fr.explorer";
import { GOAL_FR } from "./fr.goal";
import { HELP_FR } from "./fr.help";
import { LABELS_FR } from "./fr.labels";
import { MODEL_FR } from "./fr.model";
import { PARAMS_FR } from "./fr.params";
import { RENDER_FR } from "./fr.render";
import { SHELL_FR } from "./fr.shell";
import { SIM_FR } from "./fr.sim";

export const FR = {
  ...SHELL_FR,
  ...HELP_FR,
  ...LABELS_FR,
  ...PARAMS_FR,
  ...DNA_FR,
  ...APP_FR,
  ...EXPLORER_FR,
  ...GOAL_FR,
  ...SIM_FR,
  ...RENDER_FR,
  ...MODEL_FR,
} as const;

/** Every message key, derived from the French catalog so it cannot be invented. */
export type MessageKey = keyof typeof FR;

/** Sections in assembly order, for the duplicate-key check. */
export const FR_SECTIONS: ReadonlyArray<Record<string, string>> = [
  SHELL_FR,
  HELP_FR,
  LABELS_FR,
  PARAMS_FR,
  DNA_FR,
  APP_FR,
  EXPLORER_FR,
  GOAL_FR,
  SIM_FR,
  RENDER_FR,
  MODEL_FR,
];
