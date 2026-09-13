/**
 * Shared helpers for the copy gates: drive the interface into a fixed state,
 * then read back every string the user can see.
 *
 * The dump is deliberately coarse (one entry per panel) but total for the
 * controls: each element carrying a `data-help` attribute contributes its id,
 * title and help text, which is how the ~230-entry help catalog stays covered.
 * Numbers are normalised away, so the fixture records copy, not simulation
 * state.
 *
 *   node tools/verify-copy.mjs [url]        compare with the fixture
 *   node tools/verify-copy.mjs --update     rewrite the fixture
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_PATH = resolve(root, "tests/fixtures/ui-copy.fr.json");

/** Panels and chrome the fixture covers, in a stable order. */
export const BUCKETS = [
  ["header", ".top"],
  ["metrics", ".metrics"],
  ["toolbar", ".world-toolbar"],
  ["stage", ".stage"],
  ["playback", ".playback-stack"],
  ["charts", ".charts-section"],
  ["tabs", ".side-tabs"],
  ["panel.organisms", "#panel-organisms"],
  ["panel.environment", "#panel-environment"],
  ["panel.analysis", "#panel-analysis"],
  ["panel.species", "#panel-species"],
  ["panel.experiment", "#panel-experiment"],
  ["footer", ".status-bar"],
  ["help", "#help-dialog"],
];

/**
 * Put the page into the state the fixture is captured in: paused, one
 * phototroph population, a fixed number of steps. Deterministic on purpose —
 * the dump still normalises digits so a change in the model cannot fail a copy
 * gate.
 */
export async function scriptedState(page, opts = {}) {
  const steps = opts.steps ?? 30;
  await page.waitForFunction(() => window.__openavida, null, { timeout: 30000 });
  await page.locator("#btn-pause").click();
  await page.waitForTimeout(120);
  await page.locator("#tab-organisms").click();
  await page.locator("#kit-phototroph strong").click();
  await page.locator("#btn-inject").click();
  await page.waitForFunction(() => (window.__openavida?.population ?? 0) >= 24, null, { timeout: 15000 });
  await page.evaluate((n) => window.__openavidaStep(n), steps);
  // Let two UI cadences run so every panel has painted from the same state.
  await page.waitForTimeout(700);
  await page.mouse.move(0, 0);
}

/** Read every bucket plus each `data-help` control out of the live page. */
export async function dumpUiText(page) {
  return page.evaluate((buckets) => {
    /** Collapse whitespace and replace every number run, so copy is compared, not state. */
    const normalise = (text) =>
      text
        .replace(/\u00a0/g, " ")
        .replace(/0x[0-9a-f]+/gi, "#hex")
        .replace(/\d+(?:[.,]\d+)?/g, "#")
        .replace(/\s+/g, " ")
        .trim();
    const text = {};
    for (const [id, selector] of buckets) {
      const el = document.querySelector(selector);
      text[id] = el ? normalise(el.textContent || "") : "<missing>";
    }
    const helps = {};
    for (const el of document.querySelectorAll("[data-help]")) {
      const key = el.id || el.className;
      helps[key] = {
        title: normalise(el.getAttribute("title") || ""),
        help: normalise(el.getAttribute("data-help") || ""),
      };
    }
    return { text, helps };
  }, BUCKETS);
}

export function readFixture(path = FIXTURE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeFixture(data, path = FIXTURE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** First differing region of two strings, for an actionable failure message. */
export function firstDifference(expected, actual) {
  const n = Math.min(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      const from = Math.max(0, i - 40);
      return `at character ${i}\n  expected: …${expected.slice(from, i + 60)}\n  actual:   …${actual.slice(from, i + 60)}`;
    }
  }
  return `length differs: expected ${expected.length} characters, got ${actual.length}\n  expected tail: …${expected.slice(-80)}\n  actual tail:   …${actual.slice(-80)}`;
}
