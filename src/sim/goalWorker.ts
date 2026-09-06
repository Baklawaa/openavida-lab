/** Web Worker: runs one goal trial per request and streams progress. */
import { runTrial, type Goal, type TrialConfig } from "./goals";
import type { WorldSnapshot } from "./types";

export interface TrialRequest {
  type: "run";
  id: number;
  snapshot: WorldSnapshot;
  goal: Goal;
  config: TrialConfig;
}

const port = self as unknown as { postMessage(message: unknown): void; onmessage: ((ev: MessageEvent<TrialRequest>) => void) | null };

port.onmessage = (ev: MessageEvent<TrialRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "run") return;
  const result = runTrial(msg.snapshot, msg.goal, msg.config, (tick, value) => {
    port.postMessage({ type: "progress", id: msg.id, tick, value });
  });
  port.postMessage({ type: "result", id: msg.id, result });
};
