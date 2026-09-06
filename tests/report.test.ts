import { describe, expect, it } from "vitest";
import { REPORT_HEADINGS, buildReportHtml, type ReportData } from "../src/ui/report";
import { DEFAULT_PARAMS, type TrialResult } from "../src/sim/index";

describe("experiment HTML report", () => {
  it("contains every section heading and the CSV row count", () => {
    const results: TrialResult[] = [1, 2, 3].map((i) => ({
      seed: 10 + i,
      startTick: 0,
      ticks: 20,
      reachedTick: i === 3 ? null : 10 + i,
      reachedTicks: [i === 3 ? null : 10 + i],
      finalValue: 0.4,
      finalPopulation: 8,
      extinct: false,
      unreachable: false,
      series: [],
    }));
    const data: ReportData = {
      generatedAt: "7 sept. 2026",
      startLabel: "monde A",
      params: { ...DEFAULT_PARAMS, seed: 42, width: 32, height: 32 },
      recipeOps: [{ type: "step", n: 4 }, { type: "inject", genome: "ATG", count: 3 }],
      schedule: [{ at: 10, op: { type: "scale", field: "toxin", k: 2 } }],
      goals: [{ metric: { kind: "population" }, op: ">=", target: 10, sustain: 1 }],
      goalLabels: ["population ≥ 10"],
      summary: {
        n: 3, successes: 2, successRate: 2 / 3, medianTicks: 12, meanTicks: 12, minTicks: 11, maxTicks: 13,
        p25Ticks: 11, p75Ticks: 13, meanFinalValue: 0.4, extinctions: 0, unreachable: 0,
        perGoal: [{ successes: 2, successRate: 2 / 3, medianTicks: 12, meanTicks: 12, minTicks: 11, maxTicks: 13 }],
      },
      results,
      maxTicks: 50,
      saved: [{ name: "Alpha", genome: "ATGAAATAA", strainName: "Phototrophe" }],
    };
    const html = buildReportHtml(data);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    for (const h of REPORT_HEADINGS) expect(html, h).toContain(`<h2>${h}</h2>`);
    expect(html).toContain("3 lignes (CSV).");
    expect(html.match(/<tbody>/)?.length).toBe(1);
    expect((html.match(/<tbody>[\s\S]*?<tr>/g) ?? []).length).toBeGreaterThan(0);
    expect(html.split("<tbody>")[1]!.split("</tbody>")[0]!.match(/<tr>/g)?.length).toBe(3);
    expect(html).toContain("population ≥ 10");
    expect(html).toContain("Alpha");
  });
});
