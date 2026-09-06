import assert from "node:assert/strict";
import { chromium } from "playwright";

// Headless determinism check: two runs of replicate #1 with keepSnapshot
// must hash identically (hashState of worldFromSnapshot).
const base = process.argv[2] || "http://127.0.0.1:5174/";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text()); });

try {
  await page.goto(base);
  await page.waitForFunction(() => window.__openavida);
  await page.locator("#btn-pause").click();
  await page.waitForTimeout(120);
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-phototroph").click();
  await page.locator("#btn-inject").click();
  await page.waitForFunction(() => window.__openavida.population >= 24);
  await page.locator("#tab-experiment").click();
  await page.locator("#goal-example").selectOption("pop");
  await page.locator("#goal-max").fill("40");
  await page.locator("#btn-goal-det").click();
  await page.waitForFunction(() => {
    const t = document.querySelector("#goal-det-result")?.textContent ?? "";
    return t.includes("identiques") || t.includes("≠") || t.includes("instantanés");
  }, null, { timeout: 60000 });
  const text = await page.locator("#goal-det-result").innerText();
  console.log(JSON.stringify({ text, errors, population: await page.evaluate(() => window.__openavida.population) }));
  assert.deepEqual(errors, [], "no page errors");
  assert.match(text, /identiques/, `expected identical hashes, got: ${text}`);
  console.log("Determinism verified:", text.trim());
} finally {
  await browser.close();
}
