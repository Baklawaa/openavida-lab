import assert from "node:assert/strict";
import { chromium } from "playwright";

// Gate for the worker-hosted simulation: the same ops and 48 steps must hash
// identically whether the world runs inline or in the worker, and the probe
// must report which host is active.
const base = process.argv[2] || "http://127.0.0.1:5174/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });

async function run(mode) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text()); });
  const url = base + (base.includes("?") ? "&" : "?") + `seed=4242${mode === "worker" ? "&worker=1" : ""}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__openavida);
  await page.locator("#btn-pause").click();
  await page.waitForTimeout(150);
  const host = await page.evaluate(() => window.__openavida.host);
  // Same scripted setup in both modes: paint, inject, place, then 48 steps.
  await page.locator("#tab-environment").click();
  await page.locator("#brush-nutrientVent").click();
  const box = await page.locator("#gl").boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-heterotroph").click();
  await page.locator("#btn-inject").click();
  await page.waitForFunction(() => window.__openavida.population >= 24);
  assert.equal(await page.evaluate(() => window.__openavidaPlaceAt(10, 10)), true, `${mode}: placement is immediate`);
  await page.evaluate(() => window.__openavidaStep(48));
  const probe = await page.evaluate(() => window.__openavida);
  const hash = await page.evaluate(() => window.__openavidaHash());
  const t0 = Date.now();
  await page.locator("#btn-pause").click();
  await page.waitForFunction(() => window.__openavida.tick >= 48 + 30, null, { timeout: 30000 });
  const ms = Date.now() - t0;
  await page.close();
  return { mode, host, hash, tick: probe.tick, population: probe.population, errors, ms30: ms };
}

try {
  const inline = await run("inline");
  const worker = await run("worker");
  console.log(JSON.stringify({ inline, worker }, null, 2));
  assert.deepEqual(inline.errors, [], "inline: no page errors");
  assert.deepEqual(worker.errors, [], "worker: no page errors");
  assert.equal(inline.host, "inline");
  assert.equal(worker.host, "worker");
  assert.equal(inline.tick, 48, "inline stepped 48 ticks");
  assert.equal(worker.tick, 48, "worker stepped 48 ticks and mirrored the result");
  assert.ok(inline.population > 0);
  assert.equal(worker.population, inline.population, "populations match");
  assert.equal(worker.hash, inline.hash, "world hash after 48 steps is identical in both hosts");
  console.log(`Worker host verified: identical hash ${inline.hash} after 48 steps, population ${inline.population}; 30 live steps in ${inline.ms30} ms inline vs ${worker.ms30} ms worker.`);
} finally {
  await browser.close();
}
