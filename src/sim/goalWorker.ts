/** Web Worker: receives the start snapshot and goal once, then runs one trial per request and streams progress. */
import { runTrial, type Goal, type TrialConfig } from "./goals";
import type { WorldSnapshot } from "./types";

export type TrialRequest =
  | { type: "init"; snapshot: WorldSnapshot; goal: Goal }
  | { type: "run"; id: number; config: TrialConfig };

const port = self as unknown as { postMessage(message: unknown): void; onmessage: ((ev: MessageEvent<TrialRequest>) => void) | null };

let snapshot: WorldSnapshot | null = null;
let goal: Goal | null = null;

port.onmessage = (ev: MessageEvent<TrialRequest>) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === "init") {
    snapshot = msg.snapshot;
    goal = msg.goal;
    return;
  }
  if (msg.type !== "run" || !snapshot || !goal) return;
  const result = runTrial(snapshot, goal, msg.config, (tick, value) => {
    port.postMessage({ type: "progress", id: msg.id, tick, value });
  });
  port.postMessage({ type: "result", id: msg.id, result });
};
