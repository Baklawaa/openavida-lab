/**
 * The English message catalog, keyed exactly like the French one.
 *
 * The annotation is the completeness proof: `Record<MessageKey, string>` makes
 * a missing or misspelled English message a type error, so the compiler — not a
 * test — is what guarantees full coverage. tests/i18n.test.ts adds the checks a
 * type cannot express (no empty message, no accidental duplicate of the French
 * text, structural parity between the two catalogs).
 */
import type { MessageKey } from "./fr";
import { APP_EN } from "./en.app";
import { DNA_EN } from "./en.dna";
import { EXPLORER_EN } from "./en.explorer";
import { GOAL_EN } from "./en.goal";
import { HELP_EN } from "./en.help";
import { LABELS_EN } from "./en.labels";
import { MODEL_EN } from "./en.model";
import { PARAMS_EN } from "./en.params";
import { RENDER_EN } from "./en.render";
import { SHELL_EN } from "./en.shell";
import { SIM_EN } from "./en.sim";

export const EN: Record<MessageKey, string> = {
  ...SHELL_EN,
  ...HELP_EN,
  ...LABELS_EN,
  ...PARAMS_EN,
  ...DNA_EN,
  ...APP_EN,
  ...EXPLORER_EN,
  ...GOAL_EN,
  ...SIM_EN,
  ...RENDER_EN,
  ...MODEL_EN,
};

/** Sections in assembly order, for the duplicate-key check. */
export const EN_SECTIONS: ReadonlyArray<Record<string, string>> = [
  SHELL_EN,
  HELP_EN,
  LABELS_EN,
  PARAMS_EN,
  DNA_EN,
  APP_EN,
  EXPLORER_EN,
  GOAL_EN,
  SIM_EN,
  RENDER_EN,
  MODEL_EN,
];
