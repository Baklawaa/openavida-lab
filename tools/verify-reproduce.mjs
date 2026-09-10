/**
 * Reproduce a stored run: re-run its first replicate from the run's own
 * manifest and compare the final world hash.
 *
 *   node tools/verify-reproduce.mjs <runDir>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "dist-cli", "openavida.mjs");
const runDir = process.argv[2];

if (!runDir) {
  console.error("usage: node tools/verify-reproduce.mjs <runDir>");
  process.exit(2);
}
if (!existsSync(bundle)) {
  console.error("build the CLI first: node tools/build-cli.mjs");
  process.exit(2);
}
const resultsPath = join(runDir, "results.jsonl");
if (!existsSync(resultsPath)) {
  console.error(`no results.jsonl in ${runDir}`);
  process.exit(2);
}
const lines = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

const original = lines(resultsPath);
const out = mkdtempSync(join(tmpdir(), "oav-reproduce-"));
const res = spawnSync(
  process.execPath,
  [bundle, "run", join(runDir, "manifest.json"), "--out", out, "--jobs", "1", "--quiet"],
  { stdio: "inherit" },
);
if (res.status !== 0) {
  console.error("re-run failed");
  process.exit(res.status ?? 1);
}
const again = lines(join(out, "results.jsonl"));
let mismatches = 0;
for (let i = 0; i < original.length; i++) {
  const a = original[i];
  const b = again[i];
  if (!b || a.seed !== b.seed || a.finalHash !== b.finalHash) {
    mismatches++;
    if (mismatches <= 5) {
      console.error(`replicate ${i} (seed ${a.seed}): ${a.finalHash} != ${b ? b.finalHash : "missing"}`);
    }
  }
}
if (mismatches > 0) {
  console.error(`\u2717 ${mismatches}/${original.length} replicate hashes differ`);
  process.exit(1);
}
console.log(`\u2713 ${original.length} replicate hashes identical (first ${original[0].finalHash})`);
