// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  World,
  makeManifest,
  normalizeParams,
  type Manifest,
} from "../../src/sim/index";
import { GoalPanel } from "../../src/ui/goalPanel";

const GOAL = { metric: { kind: "population" as const }, op: ">=" as const, target: 10, sustain: 1 };

function makeRun(name: string): Manifest {
  return makeManifest({
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    params: normalizeParams({ width: 12, height: 12, seed: 2, startPopulation: 6 }),
    goals: [GOAL],
    run: { replicates: 2, seed: 101, maxTicks: 10, sampleEvery: 5 },
  });
}

/** The plate starts empty, so only the manifest's own start state can make a run legal. */
function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const world = new World({ width: 12, height: 12, seed: 2, startPopulation: 0 });
  const statuses: string[] = [];
  const panel = new GoalPanel(root, {
    status: (msg) => {
      statuses.push(msg);
    },
    world: () => world,
    activeWorld: () => "A",
    restoreInto: vi.fn(),
    replayInto: vi.fn(),
    openCatalog: vi.fn(),
    setRecording: vi.fn(),
    applyRecipe: vi.fn(),
    reportExtras: () => ({ treePng: null }),
  });
  return { root, panel, statuses };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("manifest import", () => {
  it("shows a banner for a valid manifest and returns it unchanged", async () => {
    const { root, panel, statuses } = mount();
    const manifest = makeRun("Course A");
    const text = JSON.stringify(manifest, null, 2);
    await panel.loadManifest(text);

    const note = root.querySelector<HTMLElement>("#manifest-note")!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("Course A");
    expect(note.textContent).toContain("2 réplicats");
    expect(note.textContent).toContain("1 objectifs");
    expect(note.textContent).toContain(manifest.paramsDigest);

    const clear = root.querySelector<HTMLButtonElement>("#btn-manifest-clear")!;
    expect(clear.disabled).toBe(false);

    // Export -> import -> export is byte-identical: the same object comes back out.
    expect(panel.manifest()).toEqual(manifest);
    expect(JSON.stringify(panel.manifest(), null, 2)).toBe(text);
    expect(statuses[statuses.length - 1]).toContain("Course A");
  });

  it("reports invalid JSON and a rejected manifest, keeping neither", async () => {
    const { root, panel, statuses } = mount();
    await panel.loadManifest("{ not json");
    expect(panel.manifest()).toBeNull();
    expect(statuses[statuses.length - 1]).toContain("invalide");
    expect(root.querySelector<HTMLElement>("#manifest-note")!.hidden).toBe(true);

    const raw = JSON.parse(JSON.stringify(makeRun("Version 99"))) as Record<string, unknown>;
    raw.manifestVersion = 99;
    await panel.loadManifest(JSON.stringify(raw));
    expect(panel.manifest()).toBeNull();
    expect(statuses[statuses.length - 1]).toContain("manifestVersion");
    expect(root.querySelector<HTMLElement>("#manifest-note")!.hidden).toBe(true);
  });

  it("clears the imported manifest and hands the panel back its configuration", async () => {
    const { root, panel } = mount();
    await panel.loadManifest(JSON.stringify(makeRun("Course A")));
    expect(panel.manifest()).not.toBeNull();

    root.querySelector<HTMLButtonElement>("#btn-manifest-clear")!.click();
    expect(panel.manifest()).toBeNull();
    const note = root.querySelector<HTMLElement>("#manifest-note")!;
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe("");
  });

  it("reads a picked file through #manifest-file and resets the input", async () => {
    const button = document.createElement("button");
    button.id = "btn-manifest-import";
    const input = document.createElement("input");
    input.id = "manifest-file";
    input.type = "file";
    document.body.append(button, input);
    const { panel } = mount();

    const file = new File([JSON.stringify(makeRun("Fichier"))], "manifest.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();
    expect(panel.manifest()?.name).toBe("Fichier");
    expect(input.value).toBe("");

    button.remove();
    input.remove();
  });

  it("runs from the imported start state and seed plan, not from the fields", async () => {
    const { root, panel, statuses } = mount();
    await panel.loadManifest(JSON.stringify(makeRun("Course A")));

    root.querySelector<HTMLButtonElement>("#btn-goal-run")!.click();
    // The progress bar is built synchronously: 2 replicates come from the manifest, not the form (6).
    const bar = root.querySelector<HTMLElement>("#goal-progress [role=progressbar]")!;
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
    expect(statuses.some((s) => s.includes("Course A"))).toBe(true);
    expect(statuses.some((s) => /aucun organisme/i.test(s))).toBe(false);

    // Stop the workers before the run can finish: the panel state above is all this test needs.
    root.querySelector<HTMLButtonElement>("#btn-goal-stop")!.click();
    await flush();
    await flush();
  });
});
