/**
 * SimHost backed by src/sim/simWorker.ts. The main thread keeps a mirror
 * DualWorld that every panel reads; mutations are applied to the mirror at
 * once and forwarded to the worker, whose frames then overwrite the mirror.
 *
 * Every frame is applied (the worker's incremental bookkeeping depends on
 * it). A frame built before some already-sent ops would undo their
 * optimistic effect, so after applying it the ops the worker has not yet
 * acknowledged are re-applied to the sides that frame overwrote. Ops are
 * deterministic given the mirror's RNG state, which the frame carries.
 */
import type { RecipeOp } from "../sim/recipe";
import { DualWorld } from "../sim/sandbox";
import { applyFrame, applySimOp, opSides, type Side, type SimHost, type SimOp, type SimOpResult, type StepSide, type WorldFrame } from "../sim/simHost";
import type { HostMessage, WorkerMessage } from "../sim/simWorker";
import type { SimParams, WorldSnapshot } from "../sim/types";
import { World, worldFromSnapshot } from "../sim/world";

export class WorkerHost implements SimHost {
  readonly kind = "worker" as const;
  readonly dual: DualWorld;
  /** Called after every applied frame (the app redraws on rAF anyway). */
  onFrame: (() => void) | null = null;
  private readonly worker: Worker;
  private seq = 0;
  private pending = 0;
  private readonly unacked: Array<{ seq: number; op: SimOp }> = [];
  private nextId = 1;
  private readonly waiters = new Map<number, (value: unknown) => void>();
  private framesApplied = 0;

  constructor(params: Partial<SimParams>, opts: { snapshotA?: WorldSnapshot; recordingA?: RecipeOp[] | null } = {}) {
    this.dual = new DualWorld(params);
    if (opts.snapshotA) {
      this.dual.a = worldFromSnapshot(opts.snapshotA);
      this.dual.a.recording = opts.recordingA === undefined ? this.dual.a.recording : opts.recordingA;
    }
    this.worker = new Worker(new URL("../sim/simWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerMessage>) => this.onMessage(ev.data);
    this.post({ type: "init", seq: 0, params, snapshotA: opts.snapshotA, recordingA: opts.recordingA });
  }

  get frames(): number {
    return this.framesApplied;
  }

  private post(msg: HostMessage): number {
    const seq = ++this.seq;
    this.worker.postMessage({ ...msg, seq });
    return seq;
  }

  apply(op: SimOp): SimOpResult {
    const result = applySimOp(this.dual, op);
    const seq = this.post({ type: "op", seq: 0, op });
    this.unacked.push({ seq, op });
    return result;
  }

  step(which: StepSide, n = 1): void {
    this.pending++;
    this.post({ type: "step", seq: 0, which, n });
  }

  private request<T>(build: (id: number) => HostMessage): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.waiters.set(id, resolve as (value: unknown) => void);
      this.post(build(id));
    });
  }

  snapshot(which: Side): Promise<WorldSnapshot> {
    return this.request<WorldSnapshot>((id) => ({ type: "snapshot", seq: 0, id, which }));
  }

  hash(which: Side): Promise<string> {
    return this.request<string>((id) => ({ type: "hash", seq: 0, id, which }));
  }

  flush(): Promise<void> {
    return this.request<void>((id) => ({ type: "ping", seq: 0, id }));
  }

  pendingSteps(): number {
    return this.pending;
  }

  dispose(): void {
    this.worker.terminate();
  }

  private onMessage(m: WorkerMessage): void {
    switch (m.type) {
      case "frames": {
        if (m.stepped) this.pending = Math.max(0, this.pending - 1);
        for (const f of m.frames) this.applyFrame(f);
        // Ops the worker processed before building this frame are now reflected in it.
        let k = 0;
        while (k < this.unacked.length && this.unacked[k]!.seq <= m.seq) k++;
        if (k) this.unacked.splice(0, k);
        // Newer ops were undone on the overwritten sides: replay them there.
        if (this.unacked.length) {
          const touched = new Set(m.frames.map((f) => f.which));
          for (const u of this.unacked) if (opSides(u.op).some((s) => touched.has(s))) applySimOp(this.dual, u.op);
        }
        this.framesApplied++;
        this.onFrame?.();
        return;
      }
      case "snapshot":
        this.waiters.get(m.id)?.(m.snapshot);
        this.waiters.delete(m.id);
        return;
      case "hash":
        this.waiters.get(m.id)?.(m.hash);
        this.waiters.delete(m.id);
        return;
      case "pong":
        this.waiters.get(m.id)?.(undefined);
        this.waiters.delete(m.id);
        return;
    }
  }

  private applyFrame(f: WorldFrame): void {
    const side = f.which;
    const w = side === "B" ? this.dual.b : this.dual.a;
    if (!applyFrame(w, f)) {
      const fresh = new World({ ...f.params, startPopulation: 0 });
      applyFrame(fresh, { ...f, historyFull: true });
      if (side === "B") this.dual.b = fresh;
      else this.dual.a = fresh;
    }
  }
}
