/**
 * Gate: the exudate layer must be visible. Injects a productive phototroph
 * population, steps it, then compares the plate pixels with the exudate layer
 * off and on: the violet overlay has to change the image measurably, and the
 * plate note has to say what the layer holds. The same comparison then runs in
 * the 3D view, where layer 5 has to tint its own plane instead of falling back
 * to the composite rendering.
 *
 *   node tools/verify-exudate.mjs [url]
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5174/";
/** Minimum mean violet lift (0-255) the overlay must produce on the plate. */
const MIN_VIOLET_DELTA = 0.4;
/**
 * The 3D bar is lower on purpose. The terrain covers only part of that frame,
 * so its mean moves less than the plate's, and the plane is a colour mix over
 * the surface rather than a per-cell overlay. Measured on the scripted plate:
 * 0.274 with the plane drawn and 0.000 with the composite fallback this gate
 * guards against, so 0.15 sits between them with ~2x margin on the passing
 * side. (The 0.4 the 2D bar uses came from a plate whose exudate field was
 * several times thicker; that was the pre-repair economy.)
 */
const MIN_VIOLET_DELTA_3D = 0.15;

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
});

/** Mean of (R+B)/2 − G over a canvas: the violet signature of the layer. */
const violetMean = (selector) =>
  page.evaluate((sel) => {
    const canvas = document.querySelector(sel);
    const off = document.createElement("canvas");
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext("2d");
    ctx.drawImage(canvas, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 2]) / 2 - data[i + 1];
    return sum / (data.length / 4);
  }, selector);

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });
  await page.locator("#btn-pause").click();
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-phototroph").click();
  for (let i = 0; i < 3; i++) await page.locator("#btn-inject").click();
  // 120 steps, not 260: with the repaired economy a 260-step plate is packed
  // (900+ organisms), every cell is shaded by its neighbours and the overflow
  // surplus — the thing this layer draws — is a thin film of ~0.07 per cell.
  // A sparser plate puts the plane well above the gate's bar.
  await page.evaluate(() => window.__openavidaStep?.(120));
  await page.waitForTimeout(400);

  await page.locator("#fm-0").click();
  await page.waitForTimeout(400);
  const without = await violetMean("#gl");

  await page.locator("#fm-5").click();
  await page.waitForTimeout(400);
  const withLayer = await violetMean("#gl");
  const note = (await page.locator("#field-note").textContent()) ?? "";

  const delta = withLayer - without;

  // The note must not collide with the paint HUD (the bug that started this).
  const overlap = await page.evaluate(() => {
    const note = document.querySelector("#field-note");
    const hud = document.querySelector(".viz-hud");
    const a = note?.getBoundingClientRect();
    const b = hud?.getBoundingClientRect();
    if (!a || !b || a.width === 0) return false;
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  });

  // 3D: the same population, layer 5 against the composite rendering. The 3D
  // view used to fall back to the composite for layer 5, which this delta is
  // the regression test for.
  await page.locator("#fm-0").click();
  await page.locator("#view-3d").click();
  await page.waitForTimeout(600);
  const surface = await page.evaluate(() => window.__openavida?.surface);
  const composite3d = await violetMean("#gl3d");
  await page.locator("#fm-5").click();
  await page.waitForTimeout(600);
  const exudate3d = await violetMean("#gl3d");
  const note3d = (await page.locator("#field-note").textContent()) ?? "";
  const delta3d = exudate3d - composite3d;

  console.log(
    JSON.stringify(
      {
        plateVioletOff: Number(without.toFixed(3)),
        plateVioletOn: Number(withLayer.toFixed(3)),
        delta: Number(delta.toFixed(3)),
        note,
        population: await page.evaluate(() => window.__openavida?.population),
        surface,
        canvas3dVioletComposite: Number(composite3d.toFixed(3)),
        canvas3dVioletExudate: Number(exudate3d.toFixed(3)),
        delta3d: Number(delta3d.toFixed(3)),
        note3d,
      },
      null,
      1,
    ),
  );

  assert.equal(errors.length, 0, `page errors: ${errors.join(" | ")}`);
  assert.ok(note.includes("producteur"), `exudate note should report producers, got "${note}"`);
  assert.ok(note.includes("éclairée"), `exudate note should count lit cells, got "${note}"`);
  assert.ok(!overlap, "the exudate note must not overlap the paint HUD");
  assert.ok(delta >= MIN_VIOLET_DELTA, `exudate layer is too faint: violet delta ${delta.toFixed(3)} < ${MIN_VIOLET_DELTA}`);
  assert.equal(surface, "3d", `the 3D case should run on the 3D surface, got "${surface}"`);
  assert.ok(
    note3d.includes("producteur") && note3d.includes("éclairée"),
    `the 3D layer note should still describe the layer, got "${note3d}"`,
  );
  assert.ok(
    delta3d >= MIN_VIOLET_DELTA_3D,
    `3D exudate plane is too faint: violet delta ${delta3d.toFixed(3)} < ${MIN_VIOLET_DELTA_3D}`,
  );
  console.log("✓ exudate layer visible and described in 2D and 3D");
} finally {
  await browser.close();
}
