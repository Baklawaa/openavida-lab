/**
 * The French message catalog: the single source of user-visible French in the
 * interface. Sections are spread in order; tests/i18n.test.ts asserts no key is
 * defined twice and that nothing outside this directory carries French copy.
 */
import { HELP_FR } from "./fr.help";
import { LABELS_FR } from "./fr.labels";
import { PARAMS_FR } from "./fr.params";
import { SHELL_FR } from "./fr.shell";

export const FR = {
  ...SHELL_FR,
  ...HELP_FR,
  ...LABELS_FR,
  ...PARAMS_FR,
} as const;

/** Every message key, derived from the French catalog so it cannot be invented. */
export type MessageKey = keyof typeof FR;

/** Sections in assembly order, for the duplicate-key check. */
export const FR_SECTIONS: ReadonlyArray<Record<string, string>> = [SHELL_FR, HELP_FR, LABELS_FR, PARAMS_FR];
