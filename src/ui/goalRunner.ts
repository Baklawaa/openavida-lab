/**
 * Runs replicate trials in parallel Web Workers (falls back to the main
 * thread when workers are unavailable). Cancelling terminates the workers.
 */
import { runTrial, type Goal, type TrialConfig, type TrialResult, type WorldSnapshot } from "../sim/index";

export interface RunHooks {
  onProgress?(index: number, tick: number, value: number): void;
  onResult?(index: number, result: TrialResult): void;
}

export interface RunHandle {
  promise: Promise<TrialResult[]>;
  cancel(): void;
}

export function workerCount(n: number): number {
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(n, cores - 1, 6));
}

export function runReplicates(snapshot: WorldSnapshot, goal: Goal, configs: TrialConfig[], hooks: RunHooks = {}): RunHandle {
  const results: TrialResult[] = new Array(configs.length);
  let cancelled = false;
  let done = 0;
  let resolveAll: (r: TrialResult[]) => void = () => {};
  const promise = new Promise<TrialResult[]>((resolve) => {
    resolveAll = resolve;
  });
  const finish = () => resolveAll(results.filter(Boolean));
  if (configs.length === 0) {
    finish();
    return { promise, cancel: () => {} };
  }

  if (typeof Worker === "undefined") {
    let i = 0;
    const next = () => {
      if (cancelled || i >= configs.length) {
        finish();
        return;
      }
      const index = i++;
      const r = runTrial(snapshot, goal, configs[index]!, (tick, value) => {
        hooks.onProgress?.(index, tick, value);
        return !cancelled;
      });
      results[index] = r;
      hooks.onResult?.(index, r);
      setTimeout(next, 0);
    };
    setTimeout(next, 0);
    return { promise, cancel: () => { cancelled = true; } };
  }

  const workers: Worker[] = [];
  let nextIndex = 0;
  const assign = (w: Worker) => {
    if (cancelled || nextIndex >= configs.length) return;
    const index = nextIndex++;
    w.postMessage({ type: "run", id: index, snapshot, goal, config: configs[index] });
  };
  for (let k = 0; k < workerCount(configs.length); k++) {
    const w = new Worker(new URL("../sim/goalWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<{ type: string; id: number; tick?: number; value?: number; result?: TrialResult }>) => {
      const m = ev.data;
      if (m.type === "progress") hooks.onProgress?.(m.id, m.tick ?? 0, m.value ?? 0);
      else if (m.type === "result" && m.result) {
        results[m.id] = m.result;
        hooks.onResult?.(m.id, m.result);
        done++;
        if (done >= configs.length) {
          for (const x of workers) x.terminate();
          finish();
        } else assign(w);
      }
    };
    w.onerror = () => {
      done++;
      if (done >= configs.length) finish();
      else assign(w);
    };
    workers.push(w);
    assign(w);
  }
  return {
    promise,
    cancel: () => {
      cancelled = true;
      for (const w of workers) w.terminate();
      finish();
    },
  };
}
