import { describe, expect, it } from "vitest";
import {
  BASAL,
  BrainRuntime,
  World,
  applyPolicyMoves,
  baselinePolicy,
  baselinePolicyWith,
  collectPercept,
  genomeForKit,
  llmPolicy,
  type Percept,
} from "../src/sim/index";
import { Rng } from "../src/sim/rng";
import type { Organism } from "../src/sim/types";

describe("creature brains", () => {
  it("brains-off seeded runs stay identical", () => {
    const p = { width: 16, height: 16, seed: 21, startPopulation: 10 };
    const a = new World(p);
    const b = new World(p);
    a.brainsEnabled = false;
    b.brainsEnabled = false;
    for (let i = 0; i < 12; i++) {
      a.step();
      b.step();
    }
    expect(a.hashState()).toBe(b.hashState());
  });

  it("enabling brains on a fresh world does not change the hash until a step", () => {
    const p = { width: 16, height: 16, seed: 21, startPopulation: 10 };
    const off = new World(p);
    const primed = new World(p);
    primed.brainsEnabled = true;
    primed.brain = new BrainRuntime(baselinePolicy);
    expect(primed.hashState()).toBe(off.hashState());
  });

  it("baseline policy records perception → action traces under a budget", () => {
    const w = new World({ width: 16, height: 16, seed: 8, startPopulation: 12 });
    w.brainsEnabled = true;
    w.brain = new BrainRuntime(baselinePolicy, 32, 0);
    w.step();
    expect(w.brain.traces.length).toBeGreaterThan(0);
    const t = w.brain.traces[0]!;
    expect(t.policy).toBe("baseline");
    expect(t.percept).toBeDefined();
    expect(Number.isFinite(t.percept.nutrient)).toBe(true);
    expect(t.action.type === "stay" || t.action.type === "move" || t.action.type === "hunt").toBe(true);
    expect(t.cost).toBeGreaterThanOrEqual(0);
    expect(w.brain.usedThisTick).toBeLessThanOrEqual(32);
    const org = w.organisms[0];
    if (org) {
      const p = collectPercept(org, w.fields, w.occupancy, w.organisms, w.w, w.h);
      expect(p.energy).toBe(org.energy);
    }
  });

  it("LLM adapter uses the injected decide hook and falls back when it returns null", () => {
    const w = new World({ width: 12, height: 12, seed: 4, startPopulation: 8 });
    let calls = 0;
    w.brainsEnabled = true;
    w.brain = new BrainRuntime(
      llmPolicy({
        decide() {
          calls++;
          return calls === 1 ? { type: "stay" } : null;
        },
      }),
      64,
      8,
    );
    for (let i = 0; i < 12 && w.brain.traces.length === 0; i++) w.step();
    expect(w.brain.traces.length).toBeGreaterThan(0);
    expect(w.brain.traces.some((t) => t.reason === "llm" || t.reason.startsWith("llm-fallback"))).toBe(true);
  });

  it("maxLlmCallsPerTick caps adapter calls and falls back to baseline", () => {
    const w = new World({ width: 16, height: 16, seed: 1, startPopulation: 0 });
    const g = genomeForKit("phototroph");
    for (let i = 0; i < 12; i++) {
      const o = w.birth(i % 8, 1 + Math.floor(i / 8), g, null, false, 1);
      expect(o).toBeTruthy();
      o!.ph.motility = 1;
    }
    w.rebuildOccupancy();
    let calls = 0;
    w.brain = new BrainRuntime(
      llmPolicy({
        decide() {
          calls++;
          return { type: "stay" };
        },
      }),
      64,
      2,
    );
    applyPolicyMoves(
      w.organisms,
      w.occupancy,
      w.terrain,
      w.fields,
      w.w,
      w.h,
      w.rng,
      w.tick,
      w.brain,
    );
    expect(calls).toBe(2);
    expect(w.brain.llmUsedThisTick).toBe(2);
    expect(w.brain.traces.filter((t) => t.reason === "llm").length).toBe(2);
    expect(w.brain.traces.some((t) => t.reason.startsWith("llm-capped:"))).toBe(true);
    expect(w.brain.canLlm()).toBe(false);
  });

  it("ablating hunt or toxin-flee changes recorded actions vs the full baseline", () => {
    const rng = new Rng(3);
    const org = {
      ph: { ...BASAL, resist: 0.05, aggression: 0.9, motility: 0.8 },
    } as Organism;
    const toxicPrey: Percept = {
      nutrient: 0.2,
      toxin: 0.9,
      light: 0.4,
      temperature: 0.5,
      energy: 1,
      neighbors: 1,
      preyNearby: true,
    };
    const fullToxic = baselinePolicy.decide(org, toxicPrey, rng.clone());
    const noFlee = baselinePolicyWith("no-flee").decide(org, toxicPrey, rng.clone());
    expect(fullToxic.reason).toBe("flee toxin");
    expect(noFlee.reason).toBe("hunt neighbor");
    expect(noFlee.action.type).toBe("hunt");
    expect(baselinePolicyWith("no-flee").name).toBe("baseline-no-flee");

    const huntOnly: Percept = { ...toxicPrey, toxin: 0 };
    const fullHunt = baselinePolicy.decide(org, huntOnly, rng.clone());
    const noHunt = baselinePolicyWith("no-hunt").decide(org, huntOnly, rng.clone());
    expect(fullHunt.reason).toBe("hunt neighbor");
    expect(noHunt.reason).toBe("baseline wander");
    expect(noHunt.action.type).toBe("move");
  });
});
