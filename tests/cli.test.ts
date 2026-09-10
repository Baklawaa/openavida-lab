import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { configsForManifest, makeManifest, normalizeParams } from "../src/sim/index";
import { runExperiment, runShard } from "../tools/openavida";

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
});
