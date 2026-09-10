/**
 * Headless experiment runner.
 *
 *   node dist-cli/openavida.mjs run <manifest.json> --out runs/x [--jobs N] [--resume] [--quiet]
 *   node dist-cli/openavida.mjs shard <manifest.json> --out runs/x --index i --count n
 *
 * Replicates are independent (each gets its own seed and its own world built
 * from the start snapshot), so sharding never changes a result and the merged
 * order is always the replicate order. Shards append one JSON line per result,
 * which makes --resume a matter of counting the lines already written.
 *
 * Node-only: this file lives outside src/ so the browser build never sees it.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, hostname, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { engineInfo } from "../src/sim/engine";
import { runTrial, summarizeTrials, type TrialResult } from "../src/sim/goals";
import { configsForManifest, startSnapshot, validateManifest, type Manifest } from "../src/sim/manifest";
import { exportMetricsCSV, type ExportProvenance } from "../src/sim/serialize";

export interface RunOptions {
  outDir: string;
  jobs?: number;
  resume?: boolean;
  quiet?: boolean;
  /** Run shards in this process even when a bundle exists (tests). */
  inline?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface RunReport {
  outDir: string;
  replicates: number;
  successes: number;
  medianTicks: number | null;
  resultsPath: string;
  summaryPath: string;
  metricsPath: string | null;
  eventsPath: string | null;
}

type ShardOptions = RunOptions & { index: number; count: number };

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function readJsonLines(path: string): TrialResult[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TrialResult);
}

function shardPath(outDir: string, index: number): string {
  return join(outDir, `shard-${index}.jsonl`);
}

/** Run one contiguous block of replicates, appending each result immediately. */
export function runShard(manifest: Manifest, opts: ShardOptions): number {
  mkdirSync(opts.outDir, { recursive: true });
  const configs = configsForManifest(manifest);
  const per = Math.ceil(configs.length / Math.max(1, opts.count));
  const slice = configs.slice(opts.index * per, (opts.index + 1) * per);
  const path = shardPath(opts.outDir, opts.index);
  let done = opts.resume ? readJsonLines(path).length : 0;
  if (!opts.resume) writeFileSync(path, "");
  if (done >= slice.length) return done;
  const snapshot = startSnapshot(manifest);
  for (let i = done; i < slice.length; i++) {
    const result = runTrial(snapshot, manifest.goals, slice[i]!);
    // Snapshots stay out of the result stream; finalHash keeps them checkable.
    const { snapshot: _snapshot, history, events, ...rest } = result;
    const line: Record<string, unknown> = { ...rest };
    if (history) line.history = history;
    if (events) line.events = events;
    appendFileSync(path, JSON.stringify(line) + "\n");
    done++;
    opts.onProgress?.(done, slice.length);
  }
  return done;
}

export function runExperiment(manifest: Manifest, opts: RunOptions): RunReport {
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const configs = configsForManifest(manifest);
  const jobs = Math.max(1, Math.min(opts.jobs ?? 1, Math.max(1, configs.length)));
  const manifestPath = join(outDir, "manifest.json");
  // Shard files are per-job-count: resuming into a different layout would
  // merge incompatible files, so refuse instead of silently mixing them.
  const envPath = join(outDir, "env.json");
  if (opts.resume && existsSync(envPath)) {
    try {
      const previous = JSON.parse(readFileSync(envPath, "utf8")) as { jobs?: number };
      if (typeof previous.jobs === "number" && previous.jobs !== jobs) {
        throw new Error(
          `cannot resume: this run used --jobs ${previous.jobs}, now ${jobs}. Delete the run directory or use the original job count.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("cannot resume")) throw err;
      // An unreadable env.json is not a reason to refuse a resume.
    }
  }
  writeJson(manifestPath, { ...manifest, engine: engineInfo() });

  const bundle = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist-cli", "openavida.mjs");
  if (jobs > 1 && !opts.inline && existsSync(bundle)) {
    for (let i = 0; i < jobs; i++) {
      const args = [bundle, "shard", manifestPath, "--out", outDir, "--index", String(i), "--count", String(jobs)];
      if (opts.resume) args.push("--resume");
      if (opts.quiet) args.push("--quiet");
      const res = spawnSync(process.execPath, args, { stdio: "inherit" });
      if (res.status !== 0) throw new Error(`shard ${i} exited with ${res.status}`);
    }
  } else {
    if (jobs > 1 && !opts.quiet && !opts.inline) {
      console.warn("no dist-cli bundle found: running shards in one process (npm run sim builds it)");
    }
    for (let i = 0; i < jobs; i++) runShard(manifest, { ...opts, outDir, index: i, count: jobs });
  }

  const results: TrialResult[] = [];
  for (let i = 0; i < jobs; i++) results.push(...readJsonLines(shardPath(outDir, i)));
  results.length = Math.min(results.length, configs.length);
  const resultsPath = join(outDir, "results.jsonl");
  writeFileSync(resultsPath, results.map((r) => JSON.stringify(r)).join("\n") + (results.length ? "\n" : ""));

  const summary = summarizeTrials(results);
  const summaryPath = join(outDir, "summary.json");
  writeJson(summaryPath, {
    name: manifest.name,
    engine: engineInfo(),
    paramsDigest: manifest.paramsDigest,
    goals: manifest.goals.length,
    replicates: results.length,
    successes: summary.successes,
    successRate: summary.successRate,
    successRateCI: summary.successRateCI,
    medianTicks: summary.medianTicks,
    medianTicksCI: summary.medianTicksCI,
    extinctions: summary.extinctions,
    unreachable: summary.unreachable,
    generatedAt: new Date().toISOString(),
  });

  // The reference replicate (index 0) carries the per-tick history and events.
  const reference = results[0];
  const provenance: ExportProvenance = {
    engine: engineInfo(),
    paramsDigest: manifest.paramsDigest,
    seed: manifest.run.seed,
    tick: reference?.history?.at(-1)?.tick ?? 0,
  };
  let metricsPath: string | null = null;
  if (reference?.history?.length) {
    writeFileSync(join(outDir, "metrics.csv"), exportMetricsCSV(reference.history, provenance));
    metricsPath = "metrics.csv";
  }
  let eventsPath: string | null = null;
  if (reference?.events?.length) {
    const comment = `# openavida engine=${provenance.engine.version} revision=${provenance.engine.revision} algo=${provenance.engine.hashAlgo} params=${provenance.paramsDigest} seed=${provenance.seed} tick=${provenance.tick}`;
    writeFileSync(
      join(outDir, "events.jsonl"),
      [comment, ...reference.events.map((e) => JSON.stringify(e))].join("\n") + "\n",
    );
    eventsPath = "events.jsonl";
  }
  writeJson(join(outDir, "env.json"), {
    engine: engineInfo(),
    node: process.version,
    platform: platform(),
    arch: arch(),
    release: release(),
    host: hostname(),
    cpus: cpus().length,
    jobs,
    createdAt: new Date().toISOString(),
  });

  return {
    outDir,
    replicates: results.length,
    successes: summary.successes,
    medianTicks: summary.medianTicks,
    resultsPath,
    summaryPath,
    metricsPath,
    eventsPath,
  };
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const needsValue = ["out", "jobs", "index", "count"].includes(key);
    if (!needsValue) {
      flags[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) continue;
    flags[key] = value;
    i++;
  }
  return flags;
}

function printUsage(): void {
  console.log(`OpenAvida headless runner

  openavida run <manifest.json> --out <dir> [--jobs N] [--resume] [--quiet]
  openavida shard <manifest.json> --out <dir> --index i --count n [--resume]

Outputs: manifest.json, results.jsonl, summary.json, metrics.csv,
events.jsonl (when the manifest records events), env.json, shard-*.jsonl`);
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
  }
  if (command !== "run" && command !== "shard") {
    console.error(`unknown command: ${command}`);
    printUsage();
    return 1;
  }
  const manifestPath = rest[0];
  if (!manifestPath) {
    console.error("a manifest path is required");
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`cannot read ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const { manifest, errors } = validateManifest(raw);
  if (!manifest) {
    for (const error of errors) console.error(`manifest error: ${error}`);
    return 1;
  }
  const flags = parseFlags(rest.slice(1));
  const outDir = typeof flags.out === "string" ? flags.out : join(dirname(resolve(manifestPath)), "run");
  const common: RunOptions = {
    outDir,
    resume: flags.resume === true,
    quiet: flags.quiet === true,
  };
  try {
    if (command === "shard") {
      runShard(manifest, {
        ...common,
        index: Number(flags.index ?? 0),
        count: Math.max(1, Number(flags.count ?? 1)),
      });
      return 0;
    }
    const report = runExperiment(manifest, {
      ...common,
      jobs: flags.jobs === undefined ? 1 : Math.max(1, Number(flags.jobs)),
    });
    if (!common.quiet) {
      console.log(
        `${report.replicates} réplicats · ${report.successes} succès · médiane ${report.medianTicks ?? "—"} pas · ${report.outDir}`,
      );
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exit(main(process.argv.slice(2)));
