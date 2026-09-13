/**
 * Gate: the research surfaces added in Stage 5.
 *
 * Milieu -> Modèle is checked against the parameter specification parsed out of
 * src/sim/params.ts (one control per parameter, spec bounds, only edited values
 * sent, per-world targeting, defaults, the legacy profile, clamping), and
 * Analyse -> Recherche is checked for its four readouts, the single-strain
 * lineage fallback and the neutral-drift count. Everything runs in both hosts:
 * a mirror that silently stops updating a readout is a bug this gate exists to
 * catch.
 *
 *   node tools/verify-research.mjs [url]
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || "http://127.0.0.1:5174/";

/** Parameter keys and groups, straight from the specification the form is built from. */
function specEntries() {
  const src = readFileSync(resolve(root, "src/sim/params.ts"), "utf8");
  return [...src.matchAll(/^\s+key: "([A-Za-z]+)".*group: "([a-z]+)"/gm)].map((m) => ({ key: m[1], group: m[2] }));
}

const SPEC = specEntries();
const KEYS = SPEC.map((s) => s.key);
/** Display order of the groups in the form (src/ui/modelPanel.ts MODEL_GROUPS). */
const GROUP_ORDER = ["world", "metabolism", "ecology", "chemistry", "evolution"];

const browser = await chromium.launch({ headless: true, channel: "chrome" });

async function run(mode) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
  });
  const url = `${base}${base.includes("?") ? "&" : "?"}seed=4711${mode === "worker" ? "&worker=1" : ""}`;
  const params = async (side) => page.evaluate((s) => window.__openavidaParams(s), side);
  const status = () => page.locator("#status-line").textContent();
  const setParam = (key, value) =>
    page.locator(`[data-param="${key}"]`).evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });
  await page.locator("#btn-pause").click();
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.__openavida.host), mode, `${mode}: host`);

  // --- Milieu -> Modèle -----------------------------------------------------
  await page.locator("#tab-environment").click();
  await page.waitForSelector("#model-form [data-param]");
  const domKeys = await page.evaluate(() =>
    [...document.querySelectorAll("#model-form [data-param]")].map((el) => el.dataset.param),
  );
  assert.deepEqual([...domKeys].sort(), [...KEYS].sort(), `${mode}: one control per parameter`);
  const rank = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  const groupOf = new Map(SPEC.map((s) => [s.key, s.group]));
  const ranks = domKeys.map((k) => rank.get(groupOf.get(k)) ?? -1);
  assert.ok(ranks.every((r) => r >= 0), `${mode}: every control belongs to a displayed group`);
  assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y), `${mode}: controls are grouped in display order`);
  const groups = await page.evaluate(() => [...document.querySelectorAll(".model-group h3")].map((h) => h.textContent));
  assert.ok(groups.length >= 4, `${mode}: the form is grouped`);
  assert.ok(groups.every((g) => (g ?? "").length > 1), `${mode}: every group is titled`);

  const before = await params("A");
  const title = await page
    .locator('[data-param="nutrientInflow"]')
    .evaluate((el) => el.closest("label")?.getAttribute("title") ?? "");
  assert.ok(title.length > 10, `${mode}: controls advertise the spec description`);

  // Targeting: only world A receives the edit.
  await page.locator("#model-target").selectOption("A");
  await setParam("nutrientInflow", 0.02);
  await setParam("exudateLeak", 0.3);
  await page.locator("#model-apply").click();
  await page.waitForTimeout(250);
  const a = await params("A");
  const b = await params("B");
  assert.equal(a.nutrientInflow, 0.02, `${mode}: A took the edit`);
  assert.equal(a.exudateLeak, 0.3, `${mode}: A took the second edit`);
  assert.equal(b.nutrientInflow, before.nutrientInflow, `${mode}: B was not touched`);
  assert.match(await status(), /monde A/, `${mode}: the status line names the target`);

  // Nothing edited: nothing sent.
  await page.locator("#model-apply").click();
  await page.waitForTimeout(150);
  assert.match(await status(), /Aucun paramètre modifié/, `${mode}: an empty apply is reported`);

  // Values are clamped by the specification, not written through.
  await setParam("maxMealsPerTick", 99);
  await page.locator("#model-apply").click();
  await page.waitForTimeout(250);
  assert.equal((await params("A")).maxMealsPerTick, 8, `${mode}: an out-of-range value is clamped`);

  // The legacy profile approximates the pre-upgrade engine.
  await page.locator("#model-legacy").click();
  await page.waitForTimeout(250);
  const legacy = await params("A");
  assert.equal(legacy.senescenceRate, 0, `${mode}: legacy senescence`);
  assert.equal(legacy.regulationEnabled, false, `${mode}: legacy regulation`);
  assert.equal(legacy.maxMealsPerTick, 8, `${mode}: legacy meal budget`);
  assert.equal(legacy.lightDiffusion, 0.22, `${mode}: legacy light diffusion`);

  // Defaults restore the published values.
  await page.locator("#model-reset").click();
  await page.waitForTimeout(250);
  const defaults = await params("A");
  assert.equal(defaults.nutrientInflow, 0.004, `${mode}: defaults restored`);
  assert.equal(defaults.maxMealsPerTick, 1, `${mode}: defaults restored the meal budget`);

  // --- Analyse -> Recherche -------------------------------------------------
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-phototroph strong").click();
  await page.locator("#btn-inject").click();
  await page.waitForFunction(() => (window.__openavida?.population ?? 0) >= 24, null, { timeout: 15000 });
  await page.evaluate(() => window.__openavidaMutate(120));
  await page.locator("#tab-analysis").click();
  await page.waitForTimeout(700);
  const card = (await page.locator("#research-body").textContent()) ?? "";
  for (const heading of ["SÉLECTION", "DÉRIVE NEUTRE", "FITNESS RÉALISÉE", "DISTRIBUTION DES TRAITS"]) {
    assert.ok(card.includes(heading), `${mode}: the research card shows ${heading}`);
  }
  assert.match(card, /décédé/, `${mode}: realised fitness is reported`);
  const neutral = await page.evaluate(() => window.__openavida.neutralSubstitutions);
  assert.ok(neutral > 0, `${mode}: neutral substitutions were recorded (${neutral})`);
  const shownCount = Number((card.match(/(\d+)\s+substitution/) ?? [])[1] ?? NaN);
  assert.equal(shownCount, neutral, `${mode}: the card reports the live neutral log (${shownCount} vs ${neutral})`);
  assert.deepEqual(errors, [], `${mode}: page errors`);

  const probe = await page.evaluate(() => window.__openavida);
  await page.close();
  return { mode, population: probe.population, tick: probe.tick, neutral };
}

try {
  const inline = await run("inline");
  const worker = await run("worker");
  console.log(JSON.stringify({ inline, worker }, null, 1));
  assert.equal(worker.population, inline.population, "both hosts hold the same population");
  assert.equal(worker.neutral, inline.neutral, "both hosts record the same neutral substitutions");
  console.log(
    `Research interfaces verified: ${KEYS.length} parameter controls, targeting, defaults, legacy profile and clamping in both hosts; research card with ${inline.neutral} neutral substitutions, identical inline and in the worker.`,
  );
} finally {
  await browser.close();
}
