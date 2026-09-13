/**
 * Local and CI gate: build the production bundle, serve dist/, run every
 * browser verifier against the served URL, then tear the server down.
 *
 *   node tools/gates.mjs [--port 4175] [--skip-build]
 *
 * The verifiers take the base URL as their first argument and launch the
 * system Chrome (channel: "chrome").
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const portIndex = argv.indexOf("--port");
const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 4175;
const skipBuild = argv.includes("--skip-build");
const base = `http://127.0.0.1:${port}/`;

const TOOLS = [
  ["tools/verify-interface.mjs"],
  ["tools/verify-exudate.mjs"],
  // Interface perf: step and frame budgets measured on the live page.
  ["tools/verify-perf.mjs"],
  ["tools/verify-research.mjs"],
  ["tools/verify-history.mjs"],
  // Interface copy is pinned in both locales: French must never move silently,
  // and English must stay a translation of it.
  ["tools/verify-copy.mjs"],
  ["tools/verify-copy.mjs", "--en"],
  ["tools/verify-i18n.mjs"],
  ["tools/verify-worker.mjs"],
  ["tools/verify-determinism.mjs"],
  ["tools/launch.mjs"],
];

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return false;
}

let server = null;
const failed = [];
try {
  if (!skipBuild) {
    console.log("gates: building");
    const code = await run("npm", ["run", "build"]);
    if (code !== 0) {
      console.error("gates: build failed");
      process.exit(code);
    }
  }
  console.log(`gates: preview on ${base}`);
  server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!(await waitForServer(base))) {
    console.error("gates: preview server did not answer in time");
    process.exit(1);
  }
  for (const [tool, ...extra] of TOOLS) {
    const code = await run("node", [tool, base, ...extra]);
    const label = [tool, ...extra].join(" ");
    console.log(`gates: ${label} ${code === 0 ? "OK" : "FAILED"}`);
    if (code !== 0) failed.push(label);
  }
} finally {
  server?.kill("SIGTERM");
}

if (failed.length) {
  console.error(`gates failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("gates: all checks passed");
