/**
 * Headless experiment runner.
 *
 *   node dist-cli/openavida.mjs run <manifest.json> --out runs/x [options]
 *   node dist-cli/openavida.mjs shard <manifest.json> --out runs/x --index i --count n
 *
 * Run overrides, folded into the payload before validation so the effective
 * manifest — not the file's original values — is what the run directory records:
 *   --replicates N    replicate count (run.replicates)
 *   --seed N          first replicate seed (run.seed; replicate i uses N+i)
 *   --max-ticks N     tick budget per replicate (run.maxTicks)
 *   --sample-every N  metric sampling cadence (run.sampleEvery)
 *   --events          record the research event stream (run.recordEvents)
 *   --no-events       do not record it
 *   --name "<text>"   replace the manifest name
 *
 * Runner flags:
 *   --out <dir>          run directory (default: the manifest's directory/run)
 *   --jobs N             shard processes (default 1)
 *   --resume             keep the replicates already written
 *   --progress-every N   one progress line every N replicates (0: none)
 *   --quiet              print nothing but errors
 *   --index i --count n  shard mode: which block of replicates this process runs
 *
 * Replicates are independent (each gets its own seed and its own world built
 * from the start snapshot), so sharding never changes a result and the merged
 * order is always the replicate order. Shards append one JSON line per result,
 * which makes --resume a matter of counting the lines already written; a resume
 * refuses when the run-defining fields recorded in env.json have changed.
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
import { exportMetricsCSV, exportTraitsCSV, type ExportProvenance } from "../src/sim/serialize";

export interface RunOptions {
  outDir: string;
  jobs?: number;
  resume?: boolean;
  quiet?: boolean;
  /** Replicate cadence handed to forked shard children (0 or absent: no lines). */
  progressEvery?: number;
  /** Run shards in this process even when a bundle exists (tests). */
  inline?: boolean;
  /** Called after each replicate this process completes. */
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
  /** Long-format per-trait series; null when the recorder stored no distributions. */
  traitsPath: string | null;
  eventsPath: string | null;
}

type ShardOptions = RunOptions & { index: number; count: number };

/** The run-defining fields a resume must find unchanged in env.json. */
interface RunSignature {
  replicates: number;
  seed: number;
  maxTicks: number;
  sampleEvery: number;
  recordEvents: boolean;
}

const SIGNATURE_FIELDS = ["replicates", "seed", "maxTicks", "sampleEvery", "recordEvents"] as const;

function runSignature(manifest: Manifest): RunSignature {
  return {
    replicates: manifest.run.replicates,
    seed: manifest.run.seed,
    maxTicks: manifest.run.maxTicks,
    sampleEvery: manifest.run.sampleEvery,
    recordEvents: manifest.run.recordEvents === true,
  };
}

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
  const signature = runSignature(manifest);
  // Shard files are per-job-count, and the replicate plan defines what each
  // line means: resuming into a different layout or plan would merge
  // incompatible results, so refuse instead of silently mixing them.
  const envPath = join(outDir, "env.json");
  if (opts.resume && existsSync(envPath)) {
    try {
      const previous = JSON.parse(readFileSync(envPath, "utf8")) as {
        jobs?: number;
        signature?: Partial<RunSignature>;
      };
      if (typeof previous.jobs === "number" && previous.jobs !== jobs) {
        throw new Error(
          `cannot resume: this run used --jobs ${previous.jobs}, now ${jobs}. Delete the run directory or use the original job count.`,
        );
      }
      // A run directory written before signatures existed still resumes.
      const stored = previous.signature;
      if (stored && typeof stored === "object") {
        const changed = SIGNATURE_FIELDS.filter((key) => stored[key] !== signature[key]);
        if (changed.length) {
          const detail = changed
            .map((key) => `${key} ${String(stored[key])} → ${String(signature[key])}`)
            .join(", ");
          throw new Error(
            `cannot resume: the run signature changed (${detail}). Delete the run directory or use the original run settings.`,
          );
        }
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
      // Children print the replicate lines; the parent reports shard completion.
      if (opts.progressEvery) args.push("--progress-every", String(opts.progressEvery));
      const res = spawnSync(process.execPath, args, { stdio: "inherit" });
      if (res.status !== 0) throw new Error(`shard ${i} exited with ${res.status}`);
      if (!opts.quiet) console.log(`shard ${i + 1}/${jobs} done`);
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
  let traitsPath: string | null = null;
  if (reference?.history?.length) {
    writeFileSync(join(outDir, "metrics.csv"), exportMetricsCSV(reference.history, provenance));
    metricsPath = "metrics.csv";
    // Per-trait series live only in results.jsonl otherwise, which a CSV-only
    // pipeline cannot read. Written whenever the recorder stored distributions.
    if (reference.history.some((m) => m.traitDist)) {
      writeFileSync(join(outDir, "traits.csv"), exportTraitsCSV(reference.history, provenance));
      traitsPath = "traits.csv";
    }
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
    signature,
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
    traitsPath,
    eventsPath,
  };
}

/** Flags that consume the next argument as their value; every other flag is boolean. */
const VALUE_FLAGS = new Set([
  "out",
  "jobs",
  "index",
  "count",
  "replicates",
  "seed",
  "max-ticks",
  "sample-every",
  "name",
  "progress-every",
]);

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (!VALUE_FLAGS.has(key)) {
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

/** Run fields a flag may replace, as [flag, manifest key] pairs. */
const RUN_OVERRIDES: ReadonlyArray<readonly [string, "replicates" | "seed" | "maxTicks" | "sampleEvery"]> = [
  ["replicates", "replicates"],
  ["seed", "seed"],
  ["max-ticks", "maxTicks"],
  ["sample-every", "sampleEvery"],
];

/**
 * Fold the command-line overrides into the parsed payload before validation,
 * so the runner validates — and records — the effective run rather than the
 * values the manifest file happened to carry.
 */
function applyOverrides(raw: unknown, flags: Record<string, string | boolean>): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const payload = { ...(raw as Record<string, unknown>) };
  const run = {
    ...((payload.run && typeof payload.run === "object" ? payload.run : {}) as Record<string, unknown>),
  };
  for (const [flag, key] of RUN_OVERRIDES) {
    const value = flags[flag];
    if (typeof value !== "string") continue;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`--${flag} expects a number (got "${value}")`);
    run[key] = n;
  }
  if (flags.events === true) run.recordEvents = true;
  if (flags["no-events"] === true) run.recordEvents = false;
  if (typeof flags.name === "string") payload.name = flags.name;
  payload.run = run;
  return payload;
}

function printUsage(): void {
  console.log(`OpenAvida headless runner

  openavida run <manifest.json> --out <dir> [options]
  openavida shard <manifest.json> --out <dir> --index i --count n [options]

Overrides — applied before validation; the effective manifest lands in the run directory:
  --replicates N    replicate count
  --seed N          first replicate seed (replicate i uses N+i)
  --max-ticks N     tick budget per replicate
  --sample-every N  metric sampling cadence
  --events          record the research event stream
  --no-events       do not record it
  --name "<text>"   replace the manifest name

Runner:
  --out <dir>          run directory (default: <manifest dir>/run)
  --jobs N             shard processes (default 1)
  --resume             keep the replicates already written
  --progress-every N   print a line every N completed replicates (0: none)
  --quiet              print nothing but errors
  --index i --count n  shard mode: this shard's index and shard count

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
  // Flags are parsed first: the overrides they carry are part of the payload
  // validation sees, and of the manifest the run directory records.
  const flags = parseFlags(rest.slice(1));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    console.error(`cannot read ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  let payload: unknown;
  try {
    payload = applyOverrides(raw, flags);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const { manifest, errors } = validateManifest(payload);
  if (!manifest) {
    for (const error of errors) console.error(`manifest error: ${error}`);
    return 1;
  }
  const outDir = typeof flags.out === "string" ? flags.out : join(dirname(resolve(manifestPath)), "run");
  const progressEvery =
    typeof flags["progress-every"] === "string"
      ? Math.max(0, Math.floor(Number(flags["progress-every"]) || 0))
      : 0;
  const common: RunOptions = {
    outDir,
    resume: flags.resume === true,
    quiet: flags.quiet === true,
    progressEvery,
    // No callback at all when progress is off or silenced: --quiet must leave
    // stdout to errors only.
    ...(progressEvery > 0 && flags.quiet !== true
      ? {
          onProgress: (done: number, total: number) => {
            // The last line always prints, so a run never ends without a trace.
            if (done % progressEvery === 0 || done === total) console.log(`replicate ${done}/${total}`);
          },
        }
      : {}),
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
