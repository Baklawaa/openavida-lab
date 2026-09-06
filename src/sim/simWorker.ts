/**
 * Web Worker owning the authoritative DualWorld when `?worker=1`.
 * Messages are processed in order; every reply carries the `seq` of the
 * message it answers so the main thread can drop stale frames.
 */
import type { RecipeOp } from "./recipe";
import { DualWorld } from "./sandbox";
import { applySimOp, frameFromWorld, opResetsHistory, opSides, stepSides, worldOf, type Side, type SimOp, type StepSide, type WorldFrame } from "./simHost";
import type { SimParams, WorldSnapshot } from "./types";
import { worldFromSnapshot } from "./world";

export type HostMessage =
  | { type: "init"; seq: number; params: Partial<SimParams>; snapshotA?: WorldSnapshot; recordingA?: RecipeOp[] | null }
  | { type: "op"; seq: number; op: SimOp }
  | { type: "step"; seq: number; which: StepSide; n: number }
  | { type: "snapshot"; seq: number; id: number; which: Side }
  | { type: "hash"; seq: number; id: number; which: Side }
  | { type: "ping"; seq: number; id: number };

export type WorkerMessage =
  | { type: "frames"; seq: number; frames: WorldFrame[]; stepped: boolean }
  | { type: "snapshot"; seq: number; id: number; snapshot: WorldSnapshot }
  | { type: "hash"; seq: number; id: number; hash: string }
  | { type: "pong"; seq: number; id: number };

const port = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<HostMessage>) => void) | null;
};

let dual: DualWorld | null = null;
const sentTick: Record<Side, number> = { A: -1, B: -1 };
const sentDeath: Record<Side, number> = { A: -1, B: -1 };
const sentInnovations: Record<Side, number> = { A: -1, B: -1 };
let frameCount = 0;

function sendFrames(seq: number, sides: Side[], stepped: boolean, full: boolean): void {
  if (!dual) return;
  frameCount++;
  const frames: WorldFrame[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const side of sides) {
    const w = worldOf(dual, side);
    const innovations = full || w.innovations.length !== sentInnovations[side] || frameCount % 30 === 0;
    const { frame, transfer: t } = frameFromWorld(w, side, {
      historySince: full ? -1 : sentTick[side],
      deathsSince: full ? -1 : sentDeath[side],
      lineages: full || !stepped || frameCount % 6 === 0,
      innovations,
    });
    sentTick[side] = w.tick;
    sentDeath[side] = w.nextDeathSeq - 1;
    if (innovations) sentInnovations[side] = w.innovations.length;
    frames.push(frame);
    transfer.push(...t);
  }
  port.postMessage({ type: "frames", seq, frames, stepped } satisfies WorkerMessage, transfer);
}

port.onmessage = (ev: MessageEvent<HostMessage>) => {
  const m = ev.data;
  switch (m.type) {
    case "init": {
      dual = new DualWorld(m.params);
      if (m.snapshotA) {
        dual.a = worldFromSnapshot(m.snapshotA);
        dual.a.recording = m.recordingA === undefined ? dual.a.recording : m.recordingA;
      }
      sendFrames(m.seq, ["A", "B"], false, true);
      return;
    }
    case "op": {
      if (!dual) return;
      applySimOp(dual, m.op);
      sendFrames(m.seq, opSides(m.op), false, opResetsHistory(m.op));
      return;
    }
    case "step": {
      if (!dual) return;
      stepSides(dual, m.which, Math.max(1, m.n | 0));
      sendFrames(m.seq, m.which === "both" ? ["A", "B"] : [m.which], true, false);
      return;
    }
    case "snapshot":
      if (dual) port.postMessage({ type: "snapshot", seq: m.seq, id: m.id, snapshot: worldOf(dual, m.which).snapshot() } satisfies WorkerMessage);
      return;
    case "hash":
      if (dual) port.postMessage({ type: "hash", seq: m.seq, id: m.id, hash: worldOf(dual, m.which).hashState() } satisfies WorkerMessage);
      return;
    case "ping":
      port.postMessage({ type: "pong", seq: m.seq, id: m.id } satisfies WorkerMessage);
      return;
  }
};
