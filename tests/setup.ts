import { setLocale } from "../src/ui/i18n/runtime";

/**
 * The test suite speaks French.
 *
 * Module-level catalogs (src/ui/labels.ts, the report headings, the goal panel's
 * sort and template lists) resolve the locale when they are loaded, and Node's
 * navigator reports an English language, so the pin has to happen before the
 * test files are imported — which is exactly what a setup file runs for.
 * tests/i18n.test.ts switches locales explicitly where it tests the runtime.
 */
setLocale("fr", { persist: false });
