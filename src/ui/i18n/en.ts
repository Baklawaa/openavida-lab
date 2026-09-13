/**
 * The English message catalog, keyed exactly like the French one.
 *
 * While the interface is being migrated this object is partial and the runtime
 * falls back to French; tests/i18n.test.ts caps the number of missing keys and
 * the cap is zero once the migration is complete, at which point the annotation
 * becomes `Record<MessageKey, string>` and the compiler proves completeness.
 */
import type { MessageKey } from "./fr";
import { SHELL_EN } from "./en.shell";

export const EN: Partial<Record<MessageKey, string>> = {
  ...SHELL_EN,
};

/** Sections in assembly order, for the duplicate-key check. */
export const EN_SECTIONS: ReadonlyArray<Record<string, string>> = [SHELL_EN];
