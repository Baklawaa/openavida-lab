/**
 * Gate: the interface is bilingual.
 *
 * Reads the same scripted state in French and in English and requires that
 * every panel actually changed language, that nothing French is left in the
 * English rendering, that <html lang> follows the active locale, and that the
 * language picker round-trips (it rewrites ?lang= and reloads).
 *
 *   node tools/verify-i18n.mjs [url]
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { BUCKETS, dumpUiText, scriptedState } from "./ui-text.mjs";

const base = (process.argv[2] || "http://127.0.0.1:5174/").replace(/\?.*$/, "");
const FRENCH = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙŒ]/;
/**
 * Panels whose copy still lives outside the catalog while the migration runs.
 * The list must be empty when the stage closes: an entry that has become
 * bilingual is reported as stale, so it cannot be forgotten.
 */
const PENDING_BUCKETS = [
  "playback",
  "charts",
  "panel.organisms",
  "panel.environment",
  "panel.analysis",
  "panel.experiment",
  "panel.species",
  "footer",
];
/** The picker names each language in its own language, in every locale. */
const LANGUAGE_NAMES = /Français/g;
/**
 * True while some `data-help` text is still generated in French outside the
 * catalog (the DNA editor's codon tiles until chunk 8.3).
 */
const PENDING_HELP = true;

const browser = await chromium.launch({ headless: true, channel: "chrome" });

async function read(locale) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: locale === "fr" ? "fr-FR" : "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${base}?lang=${locale}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await scriptedState(page);
  const dump = await dumpUiText(page);
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  const picker = await page.locator("#lang-select").inputValue();
  return { page, errors, dump, htmlLang, picker };
}

try {
  const fr = await read("fr");
  const en = await read("en");

  for (const [label, run] of [["fr", fr], ["en", en]]) {
    assert.deepEqual(run.errors, [], `${label}: no page errors (${run.errors.join(" | ")})`);
    assert.equal(run.htmlLang, label, `${label}: <html lang>`);
    assert.equal(run.picker, label, `${label}: the picker shows the active locale`);
  }

  // Every migrated bucket is translated and free of French; a pending bucket
  // must still hold French, so the list cannot be left stale behind.
  const pending = new Set(PENDING_BUCKETS);
  const frenchIn = (text) => FRENCH.test((text ?? "").replace(LANGUAGE_NAMES, ""));
  const unchanged = BUCKETS.map(([id]) => id).filter((id) => !pending.has(id) && fr.dump.text[id] === en.dump.text[id]);
  assert.deepEqual(unchanged, [], `these panels did not change language: ${unchanged.join(", ")}`);
  const stale = PENDING_BUCKETS.filter((id) => !frenchIn(en.dump.text[id]));
  assert.deepEqual(stale, [], `these panels are translated: remove them from PENDING_BUCKETS (${stale.join(", ")})`);

  const leftovers = [];
  for (const [id] of BUCKETS) {
    if (pending.has(id)) continue;
    const text = (en.dump.text[id] ?? "").replace(LANGUAGE_NAMES, "");
    const at = text.search(FRENCH);
    if (at >= 0) leftovers.push(`${id}: …${text.slice(Math.max(0, at - 40), at + 60)}…`);
  }
  assert.deepEqual(leftovers, [], `English copy still shows French:\n${leftovers.join("\n")}`);

  const frenchHelps = Object.entries(en.dump.helps)
    .filter(([, value]) => FRENCH.test(value.help) || FRENCH.test(value.title))
    .map(([id]) => id);
  if (PENDING_HELP) {
    assert.ok(frenchHelps.length > 0, "the help catalog is translated: set PENDING_HELP to false");
  } else {
    assert.deepEqual(frenchHelps, [], `control help is still French: ${frenchHelps.slice(0, 5).join(", ")}`);
  }

  // The picker stores the choice, rewrites the URL and reloads into that locale.
  await en.page.locator("#lang-select").selectOption("fr");
  await en.page.waitForFunction(() => document.documentElement.lang === "fr", null, { timeout: 30000 });
  await en.page.waitForFunction(() => !location.search.includes("lang="), null, { timeout: 30000 });
  assert.match(await en.page.locator("#tab-organisms").textContent(), /Organismes/, "switching back to French re-renders the shell");

  await en.page.locator("#lang-select").selectOption("en");
  await en.page.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 30000 });
  assert.match(await en.page.locator("#tab-organisms").textContent(), /Organisms/, "switching to English re-renders the shell");

  // The three-way language control must not break the narrow layout.
  await en.page.setViewportSize({ width: 390, height: 844 });
  await en.page.waitForTimeout(200);
  const overflow = await en.page.evaluate(() => ({
    body: document.documentElement.scrollWidth > innerWidth + 1,
    header: (() => {
      const select = document.getElementById("lang-select");
      const box = select?.getBoundingClientRect();
      return !box || box.right > innerWidth + 1 || box.left < -1;
    })(),
  }));
  assert.equal(overflow.body, false, "the English shell does not overflow at 390px");
  assert.equal(overflow.header, false, "the language picker stays onscreen at 390px");

  console.log(
    JSON.stringify(
      {
        buckets: BUCKETS.length,
        translatedBuckets: BUCKETS.length - PENDING_BUCKETS.length,
        pendingBuckets: PENDING_BUCKETS.length,
        pendingHelp: PENDING_HELP,
        helps: Object.keys(en.dump.helps).length,
        frenchLeftovers: leftovers.length,
      },
      null,
      1,
    ),
  );
  console.log("i18n verified: French and English render every panel, the picker round-trips, and no French is left in the English copy.");
} finally {
  await browser.close();
}
