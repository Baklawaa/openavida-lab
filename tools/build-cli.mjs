/**
 * Bundle the headless runner for plain Node.
 *
 * The simulation sources use extensionless imports, which Node's own TypeScript
 * support does not resolve, so the CLI is bundled with esbuild (the copy Vite
 * already ships) into dist-cli/openavida.mjs. The web build never sees this file.
 */
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  await build({
    entryPoints: [resolve(root, "tools/openavida.ts")],
    outfile: resolve(root, "dist-cli/openavida.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    logLevel: "warning",
  });
  console.log("dist-cli/openavida.mjs written");
} catch (err) {
  console.error("cannot bundle the CLI:", err instanceof Error ? err.message : String(err));
  console.error("run it from source instead: npx vite-node tools/openavida.ts run <manifest.json>");
  process.exit(1);
}
