/**
 * Gate: the run journal (Expérience -> Historique des courses).
 *
 * Runs two seeded experiments, keeps both, then exercises the stored-run
 * surface end to end: the comparison table with intervals and effect sizes,
 * the overlaid curve chart, notes that survive a reload, the manifest export
 * and its import back into the panel, replaying a stored run into world B,
 * opening its final state, and removal.
 * A fresh browser context starts with an empty IndexedDB, so the gate owns the
 * whole store.
 *
 *   node tools/verify-history.mjs [url]
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5174/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
});

const input = (selector, value) =>
  page.locator(selector).evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);

/** Put a population on the plate: a goal run refuses an empty start state. */
async function seedPlate() {
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-phototroph strong").click();
  await page.locator("#btn-inject").click();
  await page.waitForFunction(() => (window.__openavida?.population ?? 0) >= 24, null, { timeout: 15000 });
}

/** Run one goal experiment from a template and keep it in the journal. */
async function keepRun(template, seed, reps, maxTicks) {
  await page.locator("#tab-experiment").click();
  await page.locator("#goal-example").evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, template);
  await input("#goal-seed", seed);
  await input("#goal-reps", reps);
  await input("#goal-max", maxTicks);
  await page.locator("#btn-goal-run").click();
  await page.waitForFunction((n) => document.querySelectorAll("#goal-results tbody tr").length >= n, reps, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector("#btn-goal-keep")?.disabled === false, null, { timeout: 30000 });
  await page.locator("#btn-goal-keep").click();
}

const rowCount = () => page.locator("[data-history-pick]").count();

try {
  await page.goto(`${base}${base.includes("?") ? "&" : "?"}seed=20260914`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });
  await page.locator("#btn-pause").click();
  await page.locator("#tab-experiment").click();
  await page.waitForSelector("#history-body");
  assert.match(await page.locator("#history-body").textContent(), /Aucune course conservée/, "an empty journal says so");

  const stored = await rowCount();
  await seedPlate();
  await keepRun("toxin", 101, 2, 60);
  await page.waitForFunction((n) => document.querySelectorAll("[data-history-pick]").length === n + 1, stored, { timeout: 20000 });
  await seedPlate();
  await keepRun("pop", 700, 3, 40);
  await page.waitForFunction((n) => document.querySelectorAll("[data-history-pick]").length === n + 2, stored, { timeout: 20000 });

  // --- comparison -----------------------------------------------------------
  const picks = page.locator("[data-history-pick]");
  assert.equal(await picks.count(), 2, "two runs are stored");
  await picks.nth(0).check();
  await picks.nth(1).check();
  await page.waitForFunction(() => document.querySelectorAll(".history-table tr").length >= 3);
  const table = (await page.locator("#history-body").textContent()) ?? "";
  assert.match(table, /IC/, "the table reports confidence intervals");
  assert.match(table, /référence/, "the first picked run is the reference");
  assert.match(table, /Δ .*δ .*g /s, "the comparison reports median shift, Cliff's delta and Hedges' g");
  assert.ok((await page.locator(".history-table tr.picked").count()) === 2, "both picked runs are marked");

  const painted = await page.evaluate(() => {
    const chart = document.querySelector("#chart-history");
    const ctx = chart.getContext("2d");
    const data = ctx.getImageData(0, 0, chart.width, chart.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) n++;
    return n;
  });
  assert.ok(painted > 200, `the stored curves are drawn (${painted} painted pixels)`);
  assert.match(await page.locator("#history-chart-note").textContent(), /course\(s\).*courbe\(s\)/s, "the chart note counts runs and curves");

  // --- note survives a reload ----------------------------------------------
  await page.locator("[data-history-note]").first().fill("à revoir demain");
  await page.locator("[data-history-note]").first().dispatchEvent("change");
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });
  await page.locator("#btn-pause").click();
  await page.locator("#tab-experiment").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-history-pick]").length === 2, null, { timeout: 20000 });
  assert.equal(await page.locator("[data-history-note]").first().inputValue(), "à revoir demain", "the note is persisted");

  // --- manifest export ------------------------------------------------------
  const download = page.waitForEvent("download");
  await page.locator("[data-history-manifest]").first().click();
  const file = await download;
  assert.match(file.suggestedFilename(), /^openavida-.*\.json$/, "the manifest downloads as JSON");
  const manifestPath = await file.path();
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifestVersion, 1, "the exported manifest carries its version");
  assert.ok(manifest.run.replicates >= 2, "the exported manifest carries the replicate plan");
  assert.ok(manifest.engine?.version, "the exported manifest carries the engine identity");

  // --- manifest import ------------------------------------------------------
  const importedPath = "scratch/history-manifest.json";
  mkdirSync("scratch", { recursive: true });
  writeFileSync(importedPath, manifestText);
  await page.locator("#manifest-file").setInputFiles(importedPath);
  await page.waitForFunction(() => document.querySelector("#manifest-note")?.hidden === false, null, { timeout: 20000 });
  const note = (await page.locator("#manifest-note").textContent()) ?? "";
  assert.match(note, /Manifeste importé/, "the banner announces the imported manifest");
  assert.ok(note.includes(manifest.name), "the banner names the imported run");
  assert.ok(note.includes(manifest.paramsDigest), "the banner quotes the parameter digest");

  // Launch order makes the first row the manifest's own first replicate; the DOM seed field no longer decides.
  await page.locator("#goal-sort").selectOption("launch");
  await page.locator("#btn-goal-run").click();
  await page.waitForFunction((n) => document.querySelectorAll("#goal-results tbody tr").length >= n, manifest.run.replicates, { timeout: 60000 });
  const importedFirstSeed = (await page.locator("#goal-results tbody tr td.seed").first().textContent())?.trim();
  assert.equal(importedFirstSeed, String(manifest.run.seed), "the run follows the imported manifest seed");

  // --- replay into world B --------------------------------------------------
  const firstSeed = manifest.run.seed;
  await page.locator("[data-history-replay]").first().click();
  await page.waitForFunction(() => window.__openavida?.world === "B", null, { timeout: 20000 });
  assert.equal(await page.locator("#replay-seed").inputValue(), String(firstSeed), "the replay uses the run's first replicate seed");
  const info = await page.locator("#replay-info").textContent();
  assert.match(info ?? "", /Monde B relancé depuis l’historique/, "the replay banner names the source");
  assert.match(info ?? "", /Dans la course, ce réplicat/, "the replay banner quotes the reference outcome");
  assert.equal(await page.evaluate(() => window.__openavida.seed), firstSeed, "world B carries the replicate seed");

  // --- open the stored final state -----------------------------------------
  await page.locator("[data-history-open]").first().click();
  await page.waitForFunction(() => (window.__openavida?.population ?? 0) > 0 && window.__openavida?.world === "B", null, { timeout: 20000 });
  assert.match(await page.locator("#status-line").textContent(), /État final de « .* » ouvert dans le monde B/, "opening a stored final state is reported");

  // --- removal --------------------------------------------------------------
  while (await rowCount()) {
    await page.locator("[data-history-remove]").first().click();
    await page.waitForTimeout(150);
  }
  assert.match(await page.locator("#history-body").textContent(), /Aucune course conservée/, "removing every run restores the empty state");
  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify({ runs: 2, comparisons: true, paintedPixels: painted, manifestReplicates: manifest.run.replicates, importedSeed: importedFirstSeed, errors: errors.length }, null, 1),
  );
  console.log("History verified: kept runs, comparison table with intervals and effects, overlaid curves, persisted notes, manifest export and import round-trip, replay into B, stored final state, removal.");
} finally {
  await browser.close();
}
