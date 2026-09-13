/**
 * Gate: the interface copy is unchanged.
 *
 * Drives the app into a fixed seeded state, reads every visible panel and every
 * `data-help` control (which is how the whole help catalog is covered), and
 * compares the result with tests/fixtures/ui-copy.fr.json. Numbers are
 * normalised, so this gate fails on copy, not on a model change.
 *
 *   node tools/verify-copy.mjs [url]        compare (exit 1 on a difference)
 *   node tools/verify-copy.mjs --update     rewrite the fixture deliberately
 *
 * The French fixture is the reference a localisation refactor must not move;
 * the English fixture is the same dump taken with ?lang=en.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  BUCKETS,
  FIXTURE_PATH,
  dumpUiText,
  firstDifference,
  readFixture,
  scriptedState,
  writeFixture,
} from "./ui-text.mjs";

const args = process.argv.slice(2);
const update = args.includes("--update");
const locale = args.includes("--en") ? "en" : "fr";
// The locale is pinned in the URL, so the same gate can be run twice.
const target = new URL(args.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:5174/");
target.searchParams.set("lang", locale);
const base = target.toString();
const fixturePath = locale === "en" ? FIXTURE_PATH.replace(".fr.json", ".en.json") : FIXTURE_PATH;

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text());
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
  await scriptedState(page);
  const dump = await dumpUiText(page);

  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  for (const [id] of BUCKETS) {
    assert.ok(dump.text[id] !== undefined && dump.text[id] !== "<missing>", `${id} must exist in the page`);
    assert.ok((dump.text[id] ?? "").length > 0, `${id} must not be empty`);
  }
  const helpIds = Object.keys(dump.helps);
  assert.ok(helpIds.length >= 40, `help coverage is too thin: ${helpIds.length} controls carry data-help`);

  if (update) {
    writeFixture(dump, fixturePath);
    console.log(
      JSON.stringify(
        { updated: fixturePath, buckets: BUCKETS.length, helps: helpIds.length, characters: JSON.stringify(dump).length },
        null,
        1,
      ),
    );
    console.log(`✓ ${locale} copy fixture rewritten (${BUCKETS.length} buckets, ${helpIds.length} controls)`);
    process.exit(0);
  }

  const expected = readFixture(fixturePath);
  const failures = [];
  for (const [id] of BUCKETS) {
    const want = expected.text[id];
    const got = dump.text[id];
    if (want !== got) failures.push(`${id}: ${firstDifference(want ?? "<absent>", got ?? "<absent>")}`);
  }
  for (const id of Object.keys(expected.helps)) {
    const want = expected.helps[id];
    const got = dump.helps[id];
    if (!got) { failures.push(`${id}: control lost its help`); continue; }
    if (want.title !== got.title) failures.push(`${id} title: ${firstDifference(want.title, got.title)}`);
    if (want.help !== got.help) failures.push(`${id} help: ${firstDifference(want.help, got.help)}`);
  }
  for (const id of helpIds) {
    if (!expected.helps[id]) failures.push(`${id}: new control without a recorded help text`);
  }
  assert.deepEqual(failures, [], `interface copy changed (run with --update only when that is intentional)\n${failures.join("\n")}`);
  console.log(
    JSON.stringify(
      {
        locale,
        fixture: fixturePath,
        buckets: BUCKETS.length,
        helps: helpIds.length,
        characters: JSON.stringify(dump).length,
      },
      null,
      1,
    ),
  );
  console.log(`✓ ${locale} interface copy matches the fixture`);
} finally {
  await browser.close();
}
