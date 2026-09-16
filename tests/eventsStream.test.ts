/**
 * Research event stream: off by default, bounded when on, and exportable as
 * JSON Lines with a provenance comment.
 */
import { describe, expect, it } from "vitest";
import {
  RESEARCH_LOG_MAX,
  World,
  exportEventsJSONL,
  founderHeterotroph,
  founderPhototroph,
  founderPredator,
  provenanceOf,
} from "../src/sim/index";

describe("research event stream", () => {
  it("records nothing unless the parameter is on", () => {
    const w = new World({ width: 16, height: 16, seed: 5, startPopulation: 24 });
    for (let i = 0; i < 20; i++) w.step();
    expect(w.eventLog.length).toBe(0);
    expect(w.params.recordEvents).toBe(false);
  });

  it("records births, deaths, meals and exudation when enabled", () => {
    const w = new World({ width: 20, height: 20, seed: 7, startPopulation: 0, recordEvents: true });
    w.fields.nutrient.fill(1.5);
    w.fields.light.fill(0.8);
    w.injectStrain(founderHeterotroph(), 16);
    // Phototrophs are the exudate producers, so a mixed plate is required.
    w.injectStrain(founderPhototroph(), 8);
    // Let the prey establish first: predation follows need, so a predator pays
    // its aggression upkeep while it searches, and four freshly injected
    // hunters can die before they meet anything on a bare plate.
    for (let i = 0; i < 25; i++) w.step();
    w.injectStrain(founderPredator(), 8);
    let predationInSteps = 0;
    for (let i = 0; i < 60; i++) {
      w.step();
      predationInSteps += w.lastPredation;
    }
    const kinds = new Map<string, number>();
    for (const e of w.eventLog) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    const births = kinds.get("birth") ?? 0;
    const deaths = kinds.get("death") ?? 0;
    const meals = kinds.get("meal") ?? 0;
    // Every birth since world creation, the injected founders included.
    expect(births).toBe(w.nextOrgId - 1);
    expect(deaths).toBe(w.deaths.length);
    expect(meals).toBeGreaterThan(0);
    expect(meals).toBeGreaterThanOrEqual(predationInSteps);
    expect(kinds.get("exudate") ?? 0).toBeGreaterThan(0);
    // Every event carries the provenance fields research needs.
    for (const e of w.eventLog) {
      // Founders are placed at tick 0, so events start there.
      expect(e.tick).toBeGreaterThanOrEqual(0);
      expect(e.lineageId).toBeGreaterThan(0);
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.y)).toBe(true);
      expect(Number.isFinite(e.energy)).toBe(true);
    }
    const meal = w.eventLog.find((e) => e.kind === "meal")!;
    expect(meal.preyId).toBeGreaterThan(0);
    expect(meal.amount).toBeGreaterThan(0);
  });

  it("exports JSON Lines with a provenance comment first", () => {
    const w = new World({ width: 12, height: 12, seed: 4, startPopulation: 0, recordEvents: true });
    w.fields.nutrient.fill(1);
    w.injectStrain(founderHeterotroph(), 10);
    for (let i = 0; i < 30; i++) w.step();
    const text = exportEventsJSONL(w, provenanceOf(w));
    const lines = text.split("\n");
    expect(lines[0]!.startsWith("# openavida engine=")).toBe(true);
    expect(lines.length).toBe(w.eventLog.length + 1);
    for (const line of lines.slice(1)) {
      const parsed = JSON.parse(line) as { kind: string; tick: number };
      expect(typeof parsed.kind).toBe("string");
      expect(parsed.tick).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the log bounded on a long run", () => {
    const w = new World({ width: 24, height: 24, seed: 9, startPopulation: 60, recordEvents: true });
    for (let i = 0; i < 200; i++) w.step();
    expect(w.eventLog.length).toBeLessThanOrEqual(RESEARCH_LOG_MAX);
    expect(new Set(w.eventLog.map((e) => e.kind)).size).toBeGreaterThan(1);
  });

  it("drops the log when a snapshot is restored", () => {
    const w = new World({ width: 12, height: 12, seed: 6, startPopulation: 12, recordEvents: true });
    for (let i = 0; i < 10; i++) w.step();
    expect(w.eventLog.length).toBeGreaterThan(0);
    const snap = w.snapshot();
    expect((snap as { eventLog?: unknown }).eventLog).toBeUndefined();
    w.restore(snap);
    expect(w.eventLog.length).toBe(0);
  });
});
