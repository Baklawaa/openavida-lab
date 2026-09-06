/**
 * Phase-2 feature flags. All default off so a bare URL is the phase-1 2D lab.
 * Flags are URL/UI state, not SimParams — they must not change World.step
 * unless the corresponding subsystem is explicitly enabled on the World.
 */
export interface FeatureFlags {
  view3d: boolean;
  multiplayer: boolean;
  brains: boolean;
  llmBrains: boolean;
  /** Run the visible simulation in a Web Worker (`?worker=1`). */
  worker: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  view3d: false,
  multiplayer: false,
  brains: false,
  llmBrains: false,
  worker: false,
};

function truthy(s: string | null): boolean {
  if (s === null || s === "") return false;
  const v = s.toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function flagsFromQuery(qs: string): FeatureFlags {
  const raw = qs.startsWith("?") ? qs.slice(1) : qs;
  const cut = raw.indexOf("#");
  const usp = new URLSearchParams(cut >= 0 ? raw.slice(0, cut) : raw);
  return {
    view3d: truthy(usp.get("view3d")),
    multiplayer: truthy(usp.get("mp")),
    brains: truthy(usp.get("brains")),
    llmBrains: truthy(usp.get("llm")),
    worker: truthy(usp.get("worker")),
  };
}

export function flagsToQuery(f: FeatureFlags): string {
  const usp = new URLSearchParams();
  if (f.view3d) usp.set("view3d", "1");
  if (f.multiplayer) usp.set("mp", "1");
  if (f.brains) usp.set("brains", "1");
  if (f.llmBrains) usp.set("llm", "1");
  if (f.worker) usp.set("worker", "1");
  return usp.toString();
}

export function flagsEqual(a: FeatureFlags, b: FeatureFlags): boolean {
  return (
    a.view3d === b.view3d &&
    a.multiplayer === b.multiplayer &&
    a.brains === b.brains &&
    a.llmBrains === b.llmBrains &&
    a.worker === b.worker
  );
}
