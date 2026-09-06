import { describe, expect, it } from "vitest";
import { compareResults, parseSeed } from "../src/ui/goalPanel";
import type { TrialResult } from "../src/sim/index";

const mk = (seed: number, reached: number | null, ticks: number, extinct = false): TrialResult => ({
  seed, startTick: 100, ticks, reachedTick: reached === null ? null : 100 + reached, reachedTicks: [reached === null ? null : 100 + reached], finalValue: ticks, finalPopulation: extinct ? 0 : 5, extinct, unreachable: false, series: [],
});

describe("goal panel helpers", () => {
  it("parseSeed accepts 32-bit integers only and never truncates", () => {
    expect(parseSeed("1540483486")).toBe(1540483486);
    expect(parseSeed(" 42 ")).toBe(42);
    expect(parseSeed("4294967295")).toBe(4294967295);
    expect(parseSeed("4294967296")).toBe(null);
    expect(parseSeed("1370414021570")).toBe(null);
    expect(parseSeed("0")).toBe(null);
    expect(parseSeed("")).toBe(null);
    expect(parseSeed("12a")).toBe(null);
    expect(parseSeed("1.5")).toBe(null);
  });

  it("sort presets order successes and failures by speed", () => {
    const rows: Array<[number, TrialResult]> = [
      [0, mk(1, 50, 50)],
      [1, mk(2, null, 300)],
      [2, mk(3, 20, 20)],
      [3, mk(4, null, 40, true)],
      [4, mk(5, 50, 50)],
    ];
    const order = (sort: Parameters<typeof compareResults>[0]) => rows.slice().sort(compareResults(sort)).map(([, r]) => r.seed);
    expect(order("hit-fast")).toEqual([3, 1, 5, 4, 2]);
    expect(order("hit-slow")).toEqual([1, 5, 3, 2, 4]);
    expect(order("fail-fast")).toEqual([4, 2, 3, 1, 5]);
    expect(order("fail-slow")).toEqual([2, 4, 1, 5, 3]);
    expect(order("launch")).toEqual([1, 2, 3, 4, 5]);
  });
});
