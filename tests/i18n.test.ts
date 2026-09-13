// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARAM_SPEC } from "../src/sim/index";
import { EN, EN_SECTIONS } from "../src/ui/i18n/en";
import { FR, FR_SECTIONS } from "../src/ui/i18n/fr";
import {
  LOCALES,
  applyDocumentLang,
  duplicateKeys,
  locale,
  localeFromQuery,
  missingTranslations,
  paramDescription,
  paramLabel,
  paramUnit,
  normalizeLocale,
  resetLocale,
  resolveLocale,
  setLocale,
  t,
  tn,
  type MessageKey,
} from "../src/ui/i18n/runtime";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Files that still carry French copy, removed one migration chunk at a time. */
const PENDING_MIGRATION: readonly string[] = [
  "src/app.ts",
  "src/render/charts.ts",
  "src/render/genomeBrowser.ts",
  "src/render/lineageTreeCanvas.ts",
  "src/render/overlay.ts",
  "src/sim/catalog.ts",
  "src/sim/dnaEdit.ts",
  "src/sim/events.ts",
  "src/sim/tournament.ts",
  "src/sim/world.ts",
  "src/ui/dnaEditor.ts",
  "src/ui/explorer.ts",
  "src/ui/experimentHistory.ts",
  "src/ui/goalPanel.ts",
  "src/ui/modelPanel.ts",
  "src/ui/presetStore.ts",
  "src/ui/report.ts",
  "src/ui/researchCard.ts",
  "src/ui/speciesPanel.ts",
];

/** French words that carry no accent, so the accent scan alone would miss them. */
const FRENCH_WORDS =
  /\b(Monde|Salon|Pause|Inspecter|Placer|Peindre|Rejouer|Population|Aucune|Souches?|Lignée|Afficher|Ajouter|Vitesse|Graine|Nouvelle|Exporter|Importer|Champs|Modèle|Mesure|Journal|Course|Réplicat|Objectif|Valeur|Cible|Enregistrer|Charger|Retirer|Remplacer|Depuis|Fichier|Durée|Ouvrir|Fermer|Cocher|Sélection|Moyenne|Vivantes?|Prêt|Réduire|Résultats?)\b/;
const ACCENTED = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙŒ]/;

function sourceFiles(dir = resolve(root, "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Remove line and block comments so only code and literals are scanned. */
function stripComments(source: string): string {
  let out = "";
  let state: "code" | "line" | "block" | "string" = "code";
  let quote = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    const d = source[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && d === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === '"' || c === "'" || c === "`") { state = "string"; quote = c; out += c; continue; }
      out += c;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; } else out += " ";
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; out += "  "; i++; continue; }
      out += c === "\n" ? c : " ";
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if (c === quote) { state = "code"; out += c; continue; }
    out += c;
  }
  return out;
}

/** String, template and quoted literals of a source file. */
function literalsOf(source: string): string[] {
  const text = stripComments(source);
  const out: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of text.matchAll(re)) out.push(match[2]!);
  return out;
}

describe("message catalogs", () => {
  beforeEach(() => setLocale("fr", { persist: false }));
  afterEach(() => resetLocale());

  it("defines every key exactly once per locale", () => {
    expect(duplicateKeys(FR_SECTIONS)).toEqual([]);
    expect(duplicateKeys(EN_SECTIONS)).toEqual([]);
    expect(Object.keys(FR).length).toBe(FR_SECTIONS.reduce((n, s) => n + Object.keys(s).length, 0));
    expect(Object.keys(FR).length).toBeGreaterThan(150);
  });

  it("translates every French key into English, with no empty message", () => {
    expect(missingTranslations()).toEqual([]);
    for (const key of Object.keys(EN) as Array<keyof typeof EN>) {
      expect(FR[key], `${key} is not a French key`).toBeDefined();
      expect((EN[key] ?? "").trim().length, key).toBeGreaterThan(0);
      expect((FR[key] ?? "").trim().length, key).toBeGreaterThan(0);
    }
  });

  it("keeps the two locales apart, except for names and symbols", () => {
    const identical = (Object.keys(FR) as Array<keyof typeof FR>).filter((key) => FR[key] === EN[key]);
    // The same word in both languages, or a proper noun: these are translated,
    // they simply happen to be identical.
    const allowed = new Set([
      "shell.lang.fr",
      "shell.lang.en",
      "main.aria",
      "metric.population",
      "metric.fitness",
      "chart.fitness",
      "btn.pause",
      "sched.action.aria",
      "diag.fixation",
      "diag.extinctions",
      "guide.eyebrow",
      "trait.fecundity.label",
      "param.diffusionRate.label",
      "unit.aggression",
      "unit.concentration",
      "unit.fraction",
    ]);
    // Trait abbreviations are symbols and the kit summaries name trait ids, so
    // some of them coincide across locales by design.
    const allowedShape = /^(trait\.[a-z]+\.abbr|kit\.[a-z]+\.short)$/;
    for (const key of identical) {
      expect(allowed.has(key) || allowedShape.test(key), `${key} is untranslated`).toBe(true);
    }
  });

  it("documents every parameter in both locales, matching the specification", () => {
    for (const spec of PARAM_SPEC) {
      // The English column of docs/model.md is the spec's own text: no drift.
      expect((EN as Record<MessageKey, string | undefined>)[`param.${spec.key}.desc` as MessageKey], spec.key).toBe(
        spec.description,
      );
      expect(paramLabel(spec.key), spec.key).not.toContain("param.");
      expect(paramLabel(spec.key).length, spec.key).toBeGreaterThan(1);
      expect(paramDescription(spec.key).length, spec.key).toBeGreaterThan(10);
      if (spec.unit !== "") expect(paramUnit(spec.unit).length, spec.unit).toBeGreaterThan(1);
    }
  });

  it("interpolates named placeholders and leaves unknown ones visible", () => {
    expect(t("timeline.label", { tick: 25, every: 25 })).toBe("pas 25 (enregistré toutes les 25)");
    expect(t("timeline.label", { tick: 0 })).toContain("{every}");
    setLocale("en", { persist: false });
    expect(t("timeline.label", { tick: 3, every: 50 })).toBe("step 3 (recorded every 50)");
  });

  it("picks the singular or plural message by count", () => {
    setLocale("en", { persist: false });
    expect(tn(1, "status.ready", "status.ready", {})).toBe("Ready.");
    expect(tn(4, "status.ready", "status.ready", {})).toBe("Ready.");
  });
});

describe("locale resolution", () => {
  it("normalizes tags, including region subtags and unknown values", () => {
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(normalizeLocale("fr_FR")).toBe("fr");
    expect(normalizeLocale("de")).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(localeFromQuery("?lang=en")).toBe("en");
    expect(localeFromQuery("?seed=4&lang=FR")).toBe("fr");
    expect(localeFromQuery("?lang=de")).toBeNull();
    expect(localeFromQuery("")).toBeNull();
  });

  it("follows the documented precedence, with French as the fallback", () => {
    expect(resolveLocale({})).toBe("fr");
    expect(resolveLocale({ languages: ["de-DE", "en-US"] })).toBe("en");
    expect(resolveLocale({ languages: ["en-US"], htmlLang: "fr" })).toBe("fr");
    expect(resolveLocale({ languages: ["en-US"], htmlLang: "fr", stored: "en" })).toBe("en");
    expect(resolveLocale({ search: "?lang=fr", stored: "en", htmlLang: "en", languages: ["en"] })).toBe("fr");
    expect(resolveLocale({ stored: "nonsense", htmlLang: "nonsense", languages: ["nonsense"] })).toBe("fr");
  });

  it("switches the active locale and mirrors it onto <html lang>", () => {
    resetLocale();
    setLocale("en", { persist: false });
    applyDocumentLang();
    expect(locale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    setLocale("fr", { persist: false });
    applyDocumentLang();
    expect(document.documentElement.lang).toBe("fr");
    expect(LOCALES).toEqual(["fr", "en"]);
  });
});

describe("no French copy outside the catalog", () => {
  it("keeps every source file free of French, except the ones still pending", () => {
    const pending = new Set(PENDING_MIGRATION);
    const offenders: string[] = [];
    const stale: string[] = [];
    for (const file of sourceFiles()) {
      const path = relative(root, file).replaceAll("\\", "/");
      if (path.startsWith("src/ui/i18n/")) continue;
      const literals = literalsOf(readFileSync(file, "utf8"));
      const french = literals.filter((text) => ACCENTED.test(text) || FRENCH_WORDS.test(text));
      if (pending.has(path)) {
        if (french.length > 0) stale.push(path);
        continue;
      }
      if (french.length > 0) {
        offenders.push(`${path}: ${french.slice(0, 3).map((s) => JSON.stringify(s.slice(0, 60))).join(", ")}`);
      }
    }
    expect(offenders, "move these strings into src/ui/i18n/fr.*.ts").toEqual([]);
    // The pending list must shrink: an entry with no French left is stale.
    expect(
      PENDING_MIGRATION.filter((path) => !stale.includes(path)),
      "these files are migrated: remove them from PENDING_MIGRATION",
    ).toEqual([]);
  });

  it("never leaves markup text in index.html", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(ACCENTED.test(html)).toBe(false);
  });
});
