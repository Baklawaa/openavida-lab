// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  World,
  makeManifest,
  normalizeParams,
  summarizeTrials,
  type TrialResult,
} from "../../src/sim/index";
import { recordFromRun } from "../../src/ui/experimentHistory";
import { GoalPanel } from "../../src/ui/goalPanel";

function trialResult(seed: number, ticks: number | null): TrialResult {
  return {
    seed,
    startTick: 0,
    ticks: ticks ?? 20,
    reachedTick: ticks,
    reachedTicks: [ticks],
    finalValue: 1,
    finalPopulation: 8,
    extinct: false,
    unreachable: false,
    series: [[0, 4], [5, 6], [10, ticks === null ? 9 : 12]],
    finalHash: "deadbeef",
  };
}

function record(name: string, ticks: Array<number | null>) {
  const results = ticks.map((t, i) => trialResult(100 + i, t));
  const manifest = makeManifest({
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    params: normalizeParams({ width: 12, height: 12, seed: 2, startPopulation: 6 }),
    goals: [{ metric: { kind: "population" }, op: ">=", target: 10, sustain: 1 }],
    run: { replicates: ticks.length, seed: 100, maxTicks: 20, sampleEvery: 5 },
  });
  return recordFromRun({
    manifest,
    results,
    summary: summarizeTrials(results),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const world = new World({ width: 12, height: 12, seed: 2, startPopulation: 6 });
  const replayInto = vi.fn();
  const restoreInto = vi.fn();
  const panel = new GoalPanel(root, {
    status: () => {},
    world: () => world,
    activeWorld: () => "A",
    restoreInto,
    replayInto,
    openCatalog: vi.fn(),
    setRecording: vi.fn(),
    applyRecipe: vi.fn(),
    reportExtras: () => ({ treePng: null }),
  });
  return { root, panel, replayInto, restoreInto };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("history panel", () => {
  it("renders one row per stored run and a comparison once two are picked", async () => {
    const { root, panel } = mount();
    await panel.store.saveExperiment(record("Course A", [5, 6, 7]));
    await panel.store.saveExperiment(record("Course B", [15, 16, 17]));
    await panel.refreshHistory();

    const picks = root.querySelectorAll<HTMLInputElement>("[data-history-pick]");
    expect(picks.length).toBe(2);
    expect(root.textContent).toContain("Course A");
    expect(root.textContent).toContain("Course B");

    // Picking a run marks it and redraws the comparison against the reference.
    picks[0]!.checked = true;
    picks[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const picked = root.querySelectorAll<HTMLInputElement>("[data-history-pick]");
    picked[1]!.checked = true;
    picked[1]!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(root.querySelectorAll(".history-table tr").length).toBeGreaterThanOrEqual(3);
    expect(root.textContent).toContain("IC");
    expect(root.textContent).toContain("référence");
  });

  it("replays the first replicate of a stored run into world B from its manifest", async () => {
    const { root, panel, replayInto } = mount();
    await panel.store.saveExperiment(record("Course A", [5, 6]));
    await panel.refreshHistory();

    root.querySelector<HTMLElement>("[data-history-replay]")!.click();
    expect(replayInto).toHaveBeenCalledTimes(1);
    const snapshot = replayInto.mock.calls[0]![0] as { organisms: unknown[]; tick: number };
    expect(snapshot.organisms.length).toBeGreaterThan(0);
    expect(snapshot.tick).toBe(0);
    expect(root.textContent).toContain("historique");
  });

  it("saves a note and removes a run", async () => {
    const { root, panel } = mount();
    const stored = record("Course A", [5]);
    await panel.store.saveExperiment(stored);
    await panel.refreshHistory();

    const note = root.querySelector<HTMLInputElement>("[data-history-note]")!;
    note.value = "à revoir";
    note.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect((await panel.store.getExperiment(stored.id))!.notes).toBe("à revoir");

    root.querySelector<HTMLElement>("[data-history-remove]")!.click();
    await flush();
    await flush();
    expect(await panel.store.getExperiment(stored.id)).toBeNull();
    expect(root.querySelectorAll("[data-history-pick]").length).toBe(0);
  });

  it("shows an empty state with no stored runs", async () => {
    const { root, panel } = mount();
    await panel.refreshHistory();
    expect(root.textContent).toContain("Aucune course conservée");
    expect(root.querySelectorAll("[data-history-pick]").length).toBe(0);
  });
});
