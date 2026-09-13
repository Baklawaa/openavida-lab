/**
 * Gate: the exudate layer must be visible. Injects a productive phototroph
 * population, steps it, then compares the plate pixels with the exudate layer
 * off and on: the violet overlay has to change the image measurably, and the
 * plate note has to say what the layer holds.
 *
 *   node tools/verify-exudate.mjs [url]
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5174/";
/** Minimum mean violet lift (0-255) the overlay must produce on the plate. */
const MIN_VIOLET_DELTA = 0.4;

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
});

/** Mean of (R+B)/2 − G over the plate: the violet signature of the overlay. */
const violetMean = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("#gl");
    const off = document.createElement("canvas");
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext("2d");
    ctx.drawImage(canvas, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 2]) / 2 - data[i + 1];
    return sum / (data.length / 4);
  });

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });
  await page.locator("#btn-pause").click();
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-phototroph").click();
  for (let i = 0; i < 3; i++) await page.locator("#btn-inject").click();
  await page.evaluate(() => window.__openavidaStep?.(260));
  await page.waitForTimeout(400);

  await page.locator("#fm-0").click();
  await page.waitForTimeout(400);
  const without = await violetMean();

  await page.locator("#fm-5").click();
  await page.waitForTimeout(400);
  const withLayer = await violetMean();
  const note = (await page.locator("#field-note").textContent()) ?? "";

  const delta = withLayer - without;
  console.log(
    JSON.stringify(
      { plateVioletOff: Number(without.toFixed(3)), plateVioletOn: Number(withLayer.toFixed(3)), delta: Number(delta.toFixed(3)), note, population: await page.evaluate(() => window.__openavida?.population) },
      null,
      1,
    ),
  );

  // The note must not collide with the paint HUD (the bug that started this).
  const overlap = await page.evaluate(() => {
    const note = document.querySelector("#field-note");
    const hud = document.querySelector(".viz-hud");
    const a = note?.getBoundingClientRect();
    const b = hud?.getBoundingClientRect();
    if (!a || !b || a.width === 0) return false;
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  });

  assert.equal(errors.length, 0, `page errors: ${errors.join(" | ")}`);
  assert.ok(note.includes("producteur"), `exudate note should report producers, got "${note}"`);
  assert.ok(note.includes("éclairée"), `exudate note should count lit cells, got "${note}"`);
  assert.ok(!overlap, "the exudate note must not overlap the paint HUD");
  assert.ok(delta >= MIN_VIOLET_DELTA, `exudate layer is too faint: violet delta ${delta.toFixed(3)} < ${MIN_VIOLET_DELTA}`);
  console.log("✓ exudate layer visible and described");
} finally {
  await browser.close();
}
