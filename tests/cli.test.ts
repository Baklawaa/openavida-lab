import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { configsForManifest, makeManifest, normalizeParams, type Manifest } from "../src/sim/index";
import { main, runExperiment, runShard } from "../tools/openavida";

function manifest() {
  return makeManifest({
    name: "cli test",
    createdAt: "2026-01-01T00:00:00.000Z",
    params: normalizeParams({ width: 16, height: 16, seed: 5, startPopulation: 12 }),
    goals: [{ metric: { kind: "population" }, op: ">=", target: 20, sustain: 1 }],
    run: { replicates: 4, seed: 7, maxTicks: 40, sampleEvery: 5, recordEvents: true },
  });
}

function hashes(dir: string): string[] {
  return readFileSync(join(dir, "results.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => (JSON.parse(line) as { finalHash: string }).finalHash);
}

/** Write a manifest into the temp directory so main() can be driven like the CLI. */
function writeManifest(dir: string, file: string, m: Manifest): string {
  const path = join(dir, file);
  writeFileSync(path, JSON.stringify(m));
  return path;
}

/**
 * A manifest whose goal no replicate can reach, so every trial runs its whole
 * tick budget and the recorded ticks are exactly the ones the flags ask for.
 */
function fullRunManifest(): Manifest {
  const m = manifest();
  m.goals = [{ metric: { kind: "population" }, op: ">=", target: 100000, sustain: 1 }];
  return m;
}

function resultLines(dir: string): Array<{ seed: number; finalHash: string }> {
  return readFileSync(join(dir, "results.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { seed: number; finalHash: string });
}

/** Ticks of the reference replicate, read from the exported metrics.csv. */
function metricTicks(dir: string): number[] {
  return readFileSync(join(dir, "metrics.csv"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(1) // the header row
    .map((line) => Number(line.split(",")[0]));
}

/** The messages collected by a console spy, one string per call. */
function messages(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

describe("headless runner", () => {
  it("writes the full run directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-run-"));
    try {
      const report = runExperiment(manifest(), { outDir: dir, jobs: 1, inline: true });
      expect(report.replicates).toBe(4);
      for (const file of ["manifest.json", "results.jsonl", "summary.json", "metrics.csv", "events.jsonl", "env.json"]) {
        expect(existsSync(join(dir, file)), file).toBe(true);
      }
      const results = JSON.parse(`[${readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n").join(",")}]`) as Array<{
        seed: number;
        finalHash: string;
        history?: unknown[];
        events?: unknown[];
        snapshot?: unknown;
      }>;
      expect(results.map((r) => r.seed)).toEqual([7, 8, 9, 10]);
      for (const result of results) expect(result.finalHash).toMatch(/^[0-9a-f]{8}$/);
      expect(results[0]!.history!.length).toBeGreaterThan(0);
      expect(results[0]!.events!.length).toBeGreaterThan(0);
      expect(results[0]!.snapshot).toBeUndefined();

      const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as { replicates: number };
      expect(summary.replicates).toBe(4);

      const events = readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter((l) => l.trim().length > 0);
      expect(events[0]!.startsWith("# openavida engine=")).toBe(true);
      expect((JSON.parse(events[1]!) as { kind: string }).kind.length).toBeGreaterThan(1);

      const metrics = readFileSync(join(dir, "metrics.csv"), "utf8").split("\n");
      expect(metrics[0]!.startsWith("# openavida")).toBe(true);
      expect(metrics[1]!).toContain("hill1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("produces identical results whatever the shard count", () => {
    const one = mkdtempSync(join(tmpdir(), "oav-one-"));
    const many = mkdtempSync(join(tmpdir(), "oav-many-"));
    try {
      runExperiment(manifest(), { outDir: one, jobs: 1, inline: true });
      runExperiment(manifest(), { outDir: many, jobs: 3, inline: true });
      expect(hashes(many)).toEqual(hashes(one));
    } finally {
      rmSync(one, { recursive: true, force: true });
      rmSync(many, { recursive: true, force: true });
    }
  });

  it("resumes a shard without repeating replicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-resume-"));
    try {
      const m = manifest();
      const perShard = configsForManifest(m).length / 2;
      runShard(m, { outDir: dir, index: 0, count: 2, inline: true });
      const first = readFileSync(join(dir, "shard-0.jsonl"), "utf8").trim().split("\n").length;
      expect(first).toBe(perShard);
      runShard(m, { outDir: dir, index: 0, count: 2, resume: true, inline: true });
      const after = readFileSync(join(dir, "shard-0.jsonl"), "utf8").trim().split("\n").length;
      expect(after).toBe(perShard);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is readable by the standard-library Python reader", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-py-"));
    try {
      runExperiment(manifest(), { outDir: dir, jobs: 1, inline: true });
      const probe = spawnSync("python3", ["tools/openavida_reader.py", dir], { encoding: "utf8" });
      if (probe.error || probe.status === null) return; // python3 unavailable
      expect(probe.status).toBe(0);
      expect(probe.stdout).toContain("cli test");
      expect(probe.stdout).toContain("replicates  4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies run overrides from the command line", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-flags-"));
    try {
      const manifestPath = writeManifest(dir, "manifest.json", fullRunManifest());
      const outDir = join(dir, "run");
      const code = main([
        "run",
        manifestPath,
        "--out",
        outDir,
        "--quiet",
        "--replicates",
        "2",
        "--seed",
        "7",
        "--max-ticks",
        "5",
        "--name",
        "renamed",
      ]);
      expect(code).toBe(0);

      expect(resultLines(outDir).map((r) => r.seed)).toEqual([7, 8]);
      // The reference history is what metrics.csv exports: it stops at the budget.
      expect(metricTicks(outDir).at(-1)).toBe(5);
      // The effective manifest — overrides included — is what the run records.
      const written = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
        name: string;
        run: Manifest["run"];
      };
      expect(written.name).toBe("renamed");
      expect(written.run).toMatchObject({ replicates: 2, seed: 7, maxTicks: 5 });

      // --sample-every drives the goal series kept on the reference result.
      const sampled = join(dir, "sampled");
      expect(
        main([
          "run",
          manifestPath,
          "--out",
          sampled,
          "--quiet",
          "--replicates",
          "1",
          "--max-ticks",
          "6",
          "--sample-every",
          "2",
        ]),
      ).toBe(0);
      const reference = JSON.parse(readFileSync(join(sampled, "results.jsonl"), "utf8").split("\n")[0]!) as {
        series: Array<[number, number]>;
      };
      expect(reference.series.map(([tick]) => tick)).toEqual([0, 2, 4, 6]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records or drops the event stream from the command line", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-events-"));
    try {
      const silenced = manifest();
      silenced.run.recordEvents = false;
      const silencedPath = writeManifest(dir, "silenced.json", silenced);
      const recordingPath = writeManifest(dir, "recording.json", manifest());

      const onDir = join(dir, "on");
      expect(main(["run", silencedPath, "--out", onDir, "--events", "--quiet"])).toBe(0);
      expect(existsSync(join(onDir, "events.jsonl"))).toBe(true);

      const offDir = join(dir, "off");
      expect(main(["run", recordingPath, "--out", offDir, "--no-events", "--quiet"])).toBe(0);
      expect(existsSync(join(offDir, "events.jsonl"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints one progress line per replicate with --progress-every", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-progress-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const manifestPath = writeManifest(dir, "manifest.json", fullRunManifest());
      const args = ["run", manifestPath, "--replicates", "2", "--max-ticks", "3", "--progress-every", "1"];
      expect(main([...args, "--out", join(dir, "run")])).toBe(0);
      expect(messages(log).filter((line) => line.startsWith("replicate "))).toEqual([
        "replicate 1/2",
        "replicate 2/2",
      ]);

      // --quiet suppresses the progress lines along with everything else.
      log.mockClear();
      expect(main([...args, "--out", join(dir, "quiet"), "--quiet"])).toBe(0);
      expect(messages(log).filter((line) => line.startsWith("replicate "))).toEqual([]);
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a resume whose run signature changed, and keeps the lines otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-signature-"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const manifestPath = writeManifest(dir, "manifest.json", fullRunManifest());
      const outDir = join(dir, "run");
      const stored = ["--replicates", "2", "--max-ticks", "3", "--quiet"];
      expect(main(["run", manifestPath, "--out", outDir, ...stored])).toBe(0);
      const original = resultLines(outDir);
      expect(original.length).toBe(2);

      // A different replicate plan cannot be merged into the stored shards.
      const changed = ["run", manifestPath, "--out", outDir, "--resume", "--replicates", "3", "--max-ticks", "3", "--quiet"];
      expect(main(changed)).toBe(1);
      const refusal = messages(errors).join("\n");
      expect(refusal).toContain("cannot resume");
      expect(refusal).toContain("replicates");
      expect(resultLines(outDir)).toEqual(original);

      // The same plan resumes: the stored result lines are kept unchanged.
      expect(main(["run", manifestPath, "--out", outDir, "--resume", ...stored])).toBe(0);
      expect(resultLines(outDir)).toEqual(original);
    } finally {
      errors.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resumes a run directory written before signatures existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "oav-legacy-"));
    try {
      const manifestPath = writeManifest(dir, "manifest.json", fullRunManifest());
      const outDir = join(dir, "run");
      const args = ["run", manifestPath, "--out", outDir, "--replicates", "2", "--max-ticks", "3", "--quiet"];
      expect(main(args)).toBe(0);

      // env.json from before this change: no signature to compare against.
      const env = JSON.parse(readFileSync(join(outDir, "env.json"), "utf8")) as Record<string, unknown>;
      delete env.signature;
      writeFileSync(join(outDir, "env.json"), JSON.stringify(env, null, 2) + "\n");

      const resumed = ["run", manifestPath, "--out", outDir, "--resume", "--replicates", "3", "--max-ticks", "3", "--quiet"];
      expect(main(resumed)).toBe(0);
      expect(resultLines(outDir).map((r) => r.seed)).toEqual([7, 8, 9]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
