/**
 * Locale runtime for the interface.
 *
 * One catalog per locale (src/ui/i18n/fr.ts, en.ts), one active locale for the
 * whole page. Resolution is lazy: the first `t()` call reads the signals
 * (query string, stored preference, <html lang>, browser languages) and
 * `setLocale` overrides the result, so tests can pin the locale before
 * anything renders.
 *
 * The default is French: only an explicit signal (a `?lang=` parameter, a
 * stored preference, an `<html lang="en">` or an English browser) selects
 * English. A missing English message falls back to French rather than to a
 * blank, and a key that exists nowhere returns the key itself so the bug is
 * visible.
 */
import { EN } from "./en";
import { FR, type MessageKey } from "./fr";

export type { MessageKey };

export type Locale = "fr" | "en";
export const LOCALES: readonly Locale[] = ["fr", "en"];

export type Vars = Record<string, string | number>;

const STORAGE_KEY = "openavida.lang";

/** Signals locale resolution depends on; all optional so the resolver is pure. */
export interface LocaleSignals {
  search?: string;
  stored?: string | null;
  htmlLang?: string | null;
  languages?: readonly string[];
}

/** Map a BCP-47 tag or a bare code onto a supported locale. */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return tag === "fr" || tag === "en" ? (tag as Locale) : null;
}

/** `?lang=en` / `?lang=fr`, ignoring anything unsupported. */
export function localeFromQuery(search: string): Locale | null {
  if (!search) return null;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try {
    return normalizeLocale(new URLSearchParams(raw).get("lang"));
  } catch {
    return null;
  }
}

/**
 * Query string, then stored preference, then the document language, then the
 * browser, then French. Explicit choices always beat the environment.
 */
export function resolveLocale(signals: LocaleSignals = {}): Locale {
  const fromQuery = localeFromQuery(signals.search ?? "");
  if (fromQuery) return fromQuery;
  const stored = normalizeLocale(signals.stored);
  if (stored) return stored;
  const html = normalizeLocale(signals.htmlLang);
  if (html) return html;
  for (const tag of signals.languages ?? []) {
    const hit = normalizeLocale(tag);
    if (hit) return hit;
  }
  return "fr";
}

function readSignals(): LocaleSignals {
  const signals: LocaleSignals = {};
  if (typeof location !== "undefined") signals.search = location.search;
  if (typeof document !== "undefined") signals.htmlLang = document.documentElement.lang;
  if (typeof navigator !== "undefined") signals.languages = navigator.languages ?? [];
  if (typeof localStorage !== "undefined") {
    try {
      signals.stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode): fall through to the environment.
    }
  }
  return signals;
}

let current: Locale | null = null;

/** The active locale, resolved once from the environment and then memoized. */
export function locale(): Locale {
  if (current === null) current = resolveLocale(readSignals());
  return current;
}

/** Pin the locale (tests, the language picker). Persists unless asked not to. */
export function setLocale(next: Locale, opts: { persist?: boolean } = {}): void {
  current = next;
  if (opts.persist !== false && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice lives for this page load only.
    }
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

/** Mirror the active locale onto <html lang> (no-op without a document). */
export function applyDocumentLang(): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale();
}

/** Forget the memoized locale (tests that exercise resolution). */
export function resetLocale(): void {
  current = null;
}

/** Store the choice, mirror it into the URL and reload so the page re-renders. */
export function switchLocale(next: Locale): void {
  setLocale(next, { persist: true });
  if (typeof location === "undefined" || typeof window === "undefined") return;
  const url = new URL(location.href);
  if (next === "fr") url.searchParams.delete("lang");
  else url.searchParams.set("lang", next);
  location.assign(url.toString());
}

function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    vars[name] === undefined ? all : String(vars[name]),
  );
}

/** Look up a message; unknown keys fall back to French and then to the key. */
export function t(key: MessageKey, vars?: Vars): string {
  const active = locale();
  const text = (active === "en" ? EN[key] : undefined) ?? FR[key] ?? key;
  return vars ? interpolate(text, vars) : text;
}

/** Count-dependent message: `one` for exactly one, `many` otherwise. */
export function tn(count: number, one: MessageKey, many: MessageKey, vars: Vars = {}): string {
  return t(count === 1 ? one : many, { count, ...vars });
}

/** Lookup for a key assembled at runtime (help texts, per-id controls). */
export function tDynamic(key: string, vars?: Vars): string {
  const catalog = FR as Record<string, string>;
  const active = locale();
  const text = (active === "en" ? (EN as Record<string, string | undefined>)[key] : undefined) ?? catalog[key];
  if (text === undefined) return key;
  return vars ? interpolate(text, vars) : text;
}

/* --------------------------------------------------------------- accessors */

/** Control ids that carry a help text, in catalog order. */
export function helpIds(): string[] {
  return Object.keys(FR).filter((key) => key.startsWith("help.")).map((key) => key.slice("help.".length));
}

/** Hover copy of one control. */
export function helpFor(id: string): string {
  return tDynamic(`help.${id}`);
}

/** Parameter label, description and unit, all catalog-driven. */
export function paramLabel(key: string): string {
  return tDynamic(`param.${key}.label`);
}

export function paramDescription(key: string): string {
  return tDynamic(`param.${key}.desc`);
}

export function paramUnit(unit: string): string {
  return unit === "" ? "" : tDynamic(`unit.${unit}`);
}

/** Trait, field, death, brush, strategy and sort labels. */
export function traitLabel(trait: string): string {
  return tDynamic(`trait.${trait}.label`);
}

export function traitHint(trait: string): string {
  return tDynamic(`trait.${trait}.hint`);
}

export function fieldLabel(field: string): string {
  return tDynamic(`fieldLabel.${field}`);
}

export function deathLabel(cause: string): string {
  return tDynamic(`death.${cause}.label`);
}

export function deathShortLabel(cause: string): string {
  return tDynamic(`death.${cause}.short`);
}

export function brushLabel(brush: string): string {
  return tDynamic(`brush.${brush}`);
}

export function strategyLabel(strategy: string): string {
  return tDynamic(`strategy.${strategy}`);
}

/** Short trait abbreviation used by the species strip and the explorer. */
export function traitAbbr(trait: string): string {
  return tDynamic(`trait.${trait}.abbr`);
}

/** Scheduled-parameter name in the programme list. */
export function schedParamLabel(key: string): string {
  return tDynamic(`schedParam.${key}`);
}

/** Model parameter group heading. */
export function modelGroupTitle(group: string): string {
  return tDynamic(`model.group.${group}`);
}

/** Starter-kit copy; the icon is presentation and stays in layout.ts. */
export function kitLabel(id: string): string {
  return tDynamic(`kit.${id}.label`);
}

export function kitShort(id: string): string {
  return tDynamic(`kit.${id}.short`);
}

export function kitDescription(id: string): string {
  return tDynamic(`kit.${id}.description`);
}

/* ----------------------------------------------------------- completeness */

/** Keys the active (or given) locale does not translate yet. */
export function missingTranslations(loc: Locale = "en"): MessageKey[] {
  const keys = Object.keys(FR) as MessageKey[];
  if (loc !== "en") return [];
  return keys.filter((key) => EN[key] === undefined);
}

/** Keys defined by more than one section of a locale (would silently shadow). */
export function duplicateKeys(sections: ReadonlyArray<Record<string, string>>): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const section of sections) {
    for (const key of Object.keys(section)) {
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
  }
  return [...dupes].sort();
}
