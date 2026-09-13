import { describe, expect, it } from "vitest";
import {
  World,
  founderHeterotroph,
  founderPhototroph,
  founderResistant,
  pairOutcome,
  runTrial,
  takeSnapshot,
  tournamentConfigs,
  summarizeTournament,
  worldForTrial,
  type Goal,
  type TrialResult,
} from "../src/sim/index";

const dummy: Goal = { metric: { kind: "population" }, op: ">=", target: 1e9, sustain: 1 };

function fake(pair: [number, number], shareI: number, shareJ: number): TrialResult {
  return {
    seed: 1,
    startTick: 0,
    ticks: 10,
    reachedTick: null,
    reachedTicks: [null],
    finalValue: 0,
    finalPopulation: 10,
    extinct: false,
    unreachable: false,
    series: [],
    finalHash: "00000000",
    pair,
    shares: [shareI, shareJ],
  };
}

describe("strain tournaments", () => {
  it("skips self-pairs and builds a symmetric win matrix with the 10 % draw rule", () => {
    const w = new World({ width: 16, height: 16, seed: 3 });
    const contestants = [
      { name: "P", genome: founderPhototroph() },
      { name: "H", genome: founderHeterotroph() },
      { name: "R", genome: founderResistant() },
    ];
    const configs = tournamentConfigs(takeSnapshot(w), contestants, 2, 10);
    expect(configs).toHaveLength(6);
    expect(configs.every((c) => c.pair && c.pair[0] < c.pair[1])).toBe(true);
    expect(configs.some((c) => c.pair![0] === c.pair![1])).toBe(false);
    expect(new Set(configs.map((c) => c.seed)).size).toBe(6);
    expect(configs[0]!.seed).toBe(10);
    expect(configs[0]!.ops?.filter((o) => o.type === "inject")).toHaveLength(2);
    const inj = configs[0]!.ops!.filter((o) => o.type === "inject") as Array<{ count: number }>;
    expect(inj[0]!.count).toBe(inj[1]!.count);

    expect(pairOutcome(0.48, 0.52)).toBe("draw");
    expect(pairOutcome(0.55, 0.45)).toBe("draw");
    expect(pairOutcome(0.70, 0.20)).toBe("i");
    expect(pairOutcome(0.10, 0.40)).toBe("j");

    const summary = summarizeTournament([
      fake([0, 1], 0.7, 0.2),
      fake([0, 1], 0.6, 0.3),
      fake([0, 2], 0.48, 0.52),
      fake([1, 2], 0.2, 0.7),
    ]);
    expect(summary.nContestants).toBe(3);
    expect(summary.wins).toHaveLength(3);
    expect(summary.wins.every((row) => row.length === 3)).toBe(true);
    expect(summary.wins[0]![0]).toBe(0);
    expect(summary.wins[1]![1]).toBe(0);
    expect(summary.wins[2]![2]).toBe(0);
    expect(summary.wins[0]![1]).toBe(2);
    expect(summary.wins[1]![0]).toBe(0);
    expect(summary.draws[0]![2]).toBe(1);
    expect(summary.draws[2]![0]).toBe(1);
    expect(summary.wins[2]![1]).toBe(1);
    expect(summary.cells).toHaveLength(3);
  });

  it("injects both contestants equally inside the trial seed", () => {
    const w = new World({ width: 24, height: 24, seed: 8 });
    w.fields.nutrient.fill(0.8);
    w.fields.light.fill(0.8);
    const snap = takeSnapshot(w);
    const [p, h] = [founderPhototroph(), founderHeterotroph()];
    const configs = tournamentConfigs(snap, [{ name: "P", genome: p }, { name: "H", genome: h }], 1, 5, {
      inject: 4,
      maxTicks: 5,
    });
    expect(configs).toHaveLength(1);
    const trialWorld = worldForTrial(snap, configs[0]!);
    expect(trialWorld.organisms.length).toBeGreaterThanOrEqual(6);
    const shares = configs[0]!.pairGenomes!;
    const n0 = trialWorld.organisms.filter((o) => o.strainId === [...trialWorld.strains.values()].find((s) => s.genome === shares[0])!.id).length;
    const n1 = trialWorld.organisms.filter((o) => o.strainId === [...trialWorld.strains.values()].find((s) => s.genome === shares[1])!.id).length;
    expect(n0).toBe(n1);
    expect(snap.organisms.length).toBe(0);

    const r = runTrial(snap, dummy, configs[0]!);
    expect(r.pair).toEqual([0, 1]);
    expect(r.shares).toHaveLength(2);
    expect(r.ticks).toBe(5);
  });
});
