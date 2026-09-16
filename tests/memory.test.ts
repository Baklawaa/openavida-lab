/**
 * Memory bounds.
 *
 * Every growing structure in the simulation is supposed to be capped in code,
 * and nothing else crosses those caps on a long run. This file is the
 * enforcement side of the bounds table in docs/model.md: each test pushes a
 * structure past its ceiling so a removed splice fails here instead of in a
 * browser session that has been left open for hours.
 */
import { describe, expect, it } from "vitest";
import {
  DEATH_LOG_MAX,
  HISTORY_KEEP,
  HISTORY_MAX,
  NEUTRAL_LOG_MAX,
  RESEARCH_LOG_KEEP,
  RESEARCH_LOG_MAX,
  Timeline,
  World,
  applyBottleneck,
  founderPhototroph,
  injectStrain,
} from "../src/sim/index";

/** The documented long-run fixture for the history bounds: 96×96, 120 founders. */
function longRunWorld(recordTraitDistribution: boolean): World {
  return new World({
    width: 96,
    height: 96,
    startPopulation: 120,
    seed: 0x5eed11,
    recordTraitDistribution,
  });
}

/** Refill a plate with one founder strain, then kill the whole population. */
function killCycle(world: World, count: number): void {
  injectStrain(world, founderPhototroph(), count);
  applyBottleneck(world, 0);
}

describe("memory bounds", () => {
  it("never lets the metrics history pass its trim window", () => {
    const w = longRunWorld(false);
    for (let batch = 1; batch <= 5; batch++) {
      for (let i = 0; i < 300; i++) w.step();
      expect(
        w.history.length,
        `history held ${w.history.length} rows after ${batch * 300} ticks (window ${HISTORY_MAX})`,
      ).toBeLessThanOrEqual(HISTORY_MAX);
    }
    expect(w.tick, "the fixture ran the documented 1500 ticks").toBe(1500);
    expect(w.history.length, "one row per tick plus the constructor row").toBe(1501);

    // 1500 ticks never reach the window above, so cross it on a tiny plate:
    // each extra row is a fresh object, and crossing must drop the oldest.
    const tiny = new World({ width: 8, height: 8, startPopulation: 2, seed: 3 });
    const oldest = tiny.history[0]!;
    for (let i = 1; i <= HISTORY_MAX; i++) {
      tiny.recordMetrics();
      if (i % 500 === 0) {
        expect(
          tiny.history.length,
          `history reached ${tiny.history.length} rows at row ${i} (window ${HISTORY_MAX})`,
        ).toBeLessThanOrEqual(HISTORY_MAX);
      }
    }
    expect(
      tiny.history.length,
      `history settled at ${tiny.history.length} rows after crossing ${HISTORY_MAX}`,
    ).toBe(HISTORY_KEEP);
    expect(tiny.history.includes(oldest), "the oldest history rows were dropped").toBe(false);
  });

  it("keeps the mean serialised history row under 1600 bytes with trait distributions", () => {
    // The trait distribution is rounded to 3 decimals on purpose
    // (selection.ts traitDistribution) because it lands in every row; once the
    // founder-strain transient is amortised it is nearly the whole row, so its
    // cost must stay put here. The twelfth trait (longevity) added about 37
    // bytes, which is why the budget reads 1600 rather than 1500: the extra 100
    // is headroom for one more trait, not for a new field on every trait.
    const w = longRunWorld(true);
    for (let i = 0; i < 1500; i++) w.step();
    const rows = w.history;
    expect(rows.at(-1)!.traitDist, "the fixture recorded trait distributions").toBeDefined();
    const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
    const mean = bytes / rows.length;
    expect(
      mean,
      `mean history row was ${mean.toFixed(1)} bytes over ${rows.length} rows (budget 1600)`,
    ).toBeLessThan(1600);
  });

  it("never lets the death log pass DEATH_LOG_MAX", () => {
    const w = new World({ width: 32, height: 32, startPopulation: 0, seed: 17 });
    for (let cycle = 0; cycle < 80; cycle++) {
      killCycle(w, 160);
      expect(
        w.deaths.length,
        `death log reached ${w.deaths.length} records (max ${DEATH_LOG_MAX})`,
      ).toBeLessThanOrEqual(DEATH_LOG_MAX);
    }
    // 80 cycles × 160 deaths: the run produced more records than the cap.
    expect(w.nextDeathSeq - 1, "the run killed more organisms than the cap").toBeGreaterThan(
      DEATH_LOG_MAX,
    );
    // The retained window is the most recent suffix of the monotonic seq.
    expect(w.deaths[0]!.seq, "the log keeps the most recent records").toBe(
      w.nextDeathSeq - w.deaths.length,
    );
    expect(w.deaths.at(-1)!.seq, "the newest death is retained").toBe(w.nextDeathSeq - 1);
  });

  it("never lets the research event log pass RESEARCH_LOG_MAX", () => {
    const w = new World({
      width: 32,
      height: 32,
      startPopulation: 0,
      seed: 19,
      recordEvents: true,
    });
    for (let cycle = 0; cycle < 80; cycle++) {
      w.step();
      // 160 births + 160 deaths per cycle, on a plate that is empty each time.
      killCycle(w, 160);
      expect(
        w.eventLog.length,
        `research log reached ${w.eventLog.length} events (max ${RESEARCH_LOG_MAX})`,
      ).toBeLessThanOrEqual(RESEARCH_LOG_MAX);
    }
    expect(w.eventLog.length, "the run passed the log window").toBeGreaterThan(RESEARCH_LOG_KEEP);
    expect(w.eventLog[0]!.tick, "the oldest research events were dropped").toBeGreaterThan(0);
  });

  it("never lets the neutral substitution log pass NEUTRAL_LOG_MAX", () => {
    const w = new World({ width: 12, height: 12, startPopulation: 0, seed: 23 });
    // One silent base appended after the stop codon: the child phenotype is
    // identical, which is exactly what the neutral log counts as a substitution.
    const parent = w.birth(0, 0, "ATGAAATAAGGGCCCTAA", null, false, 1)!;
    w.birth(1, 0, "ATGAAATAAGGGCCCTAAA", parent, true, 1);
    expect(w.neutralLog.length, "the fixture birth is recorded as neutral").toBe(1);
    const oldest = w.neutralLog[0]!;
    for (let cycle = 0; cycle < 20; cycle++) {
      for (let y = 0; y < w.h; y++) {
        for (let x = 0; x < w.w; x++) {
          if (w.organismAt(x, y)) continue;
          w.birth(x, y, "ATGAAATAAGGGCCCTAAA", parent, true, 1);
        }
      }
      expect(
        w.neutralLog.length,
        `neutral log reached ${w.neutralLog.length} entries (max ${NEUTRAL_LOG_MAX})`,
      ).toBeLessThanOrEqual(NEUTRAL_LOG_MAX);
      applyBottleneck(w, 0);
    }
    expect(w.neutralLog.length, "the log settles at its cap once wrapped").toBe(NEUTRAL_LOG_MAX);
    expect(w.neutralLog[0]!.orgId, "the oldest neutral entries were dropped").toBeGreaterThan(
      oldest.orgId,
    );
  });

  it("keeps the timeline ring inside its byte budget and holds the origin", () => {
    const build = () => new World({ width: 16, height: 16, startPopulation: 3, seed: 4 });
    const record200 = (w: World, tl: Timeline) => {
      tl.record(w);
      for (let i = 0; i < 200; i++) {
        w.step();
        tl.record(w);
      }
    };

    // Probe the same seeded run unbounded to size the budget so the ring can
    // always keep the origin plus the largest single snapshot: eviction then
    // happens on every record without ever collapsing to the origin alone.
    const probeWorld = build();
    const probe = new Timeline({ every: 1 });
    record200(probeWorld, probe);
    const originBytes = probe.entries()[0]!.bytes;
    const biggest = Math.max(...probe.entries().map((e) => e.bytes));
    const budget = originBytes + biggest + 1;

    const w = build();
    const tl = new Timeline({ every: 1, budgetBytes: budget });
    tl.record(w);
    for (let i = 0; i < 200; i++) {
      w.step();
      tl.record(w);
      expect(
        tl.usedBytes(),
        `timeline used ${tl.usedBytes()} bytes after tick ${w.tick} (budget ${budget})`,
      ).toBeLessThanOrEqual(budget);
    }
    const entries = tl.entries();
    expect(entries[0]!.tick, "the origin snapshot was kept").toBe(0);
    expect(entries.length, "the ring evicted old snapshots").toBeLessThan(201);
    const sum = entries.reduce((s, e) => s + e.bytes, 0);
    expect(tl.usedBytes(), "usedBytes is the sum of the entry sizes").toBe(sum);
  });
});
