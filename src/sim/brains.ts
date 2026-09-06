/**
 * Optional per-organism policies. Default is off — World.step is unchanged.
 * Baseline is a deterministic greedy chemotaxis readout. LLM is an optional
 * adapter with a per-tick call budget; missing/failed LLM falls back to baseline.
 */
import {
  DX,
  DY,
  chemotaxisDir,
  neighborIndex,
  neighborOccupancyCount,
} from "./ecology";
import type { Fields } from "./fields";
import type { Organism } from "./types";
import { TERRAIN } from "./types";
import type { Rng } from "./rng";

export interface Percept {
  nutrient: number;
  toxin: number;
  light: number;
  temperature: number;
  energy: number;
  neighbors: number;
  preyNearby: boolean;
}

export type BrainAction =
  | { type: "stay" }
  | { type: "move"; dir: number }
  | { type: "hunt"; dir: number };

export interface BrainTrace {
  tick: number;
  orgId: number;
  percept: Percept;
  action: BrainAction;
  policy: string;
  cost: number;
  reason: string;
}

export interface Policy {
  name: string;
  decide(org: Organism, percept: Percept, rng: Rng): { action: BrainAction; reason: string; cost: number };
}

export interface LlmAdapter {
  /** Sync hook for tests. Return null to fall back. */
  decide?(percept: Percept): BrainAction | null;
}

export function collectPercept(
  org: Organism,
  fields: Fields,
  occupancy: Int32Array,
  organisms: Organism[],
  w: number,
  h: number,
): Percept {
  const env = fields.sample(org.x, org.y);
  let preyNearby = false;
  for (let d = 0; d < 8; d++) {
    const ni = neighborIndex(org.x, org.y, d, w, h);
    if (ni === null) continue;
    const j = occupancy[ni]!;
    if (j < 0) continue;
    const other = organisms[j]!;
    if (other && other.energy > 0 && org.ph.aggression - other.ph.aggression >= 0.1) {
      preyNearby = true;
      break;
    }
  }
  return {
    nutrient: env.nutrient,
    toxin: env.toxin,
    light: env.light,
    temperature: env.temperature,
    energy: org.energy,
    neighbors: neighborOccupancyCount(org.x, org.y, occupancy, w, h),
    preyNearby,
  };
}

export type Ablation = "none" | "no-hunt" | "no-flee";

export function baselinePolicyWith(ablation: Ablation = "none"): Policy {
  const tag = ablation === "none" ? "baseline" : `baseline-${ablation}`;
  return {
    name: tag,
    decide(org, percept, rng) {
      if (ablation !== "no-flee" && percept.toxin > 0.4 && org.ph.resist < 0.5) {
        return { action: { type: "move", dir: rng.int(8) }, reason: "flee toxin", cost: 1 };
      }
      if (ablation !== "no-hunt" && percept.preyNearby && org.ph.aggression > 0.26) {
        return { action: { type: "hunt", dir: rng.int(8) }, reason: "hunt neighbor", cost: 1 };
      }
      if (org.ph.motility < 0.02) return { action: { type: "stay" }, reason: "sessile", cost: 0 };
      return { action: { type: "move", dir: rng.int(8) }, reason: "baseline wander", cost: 1 };
    },
  };
}

export const baselinePolicy: Policy = baselinePolicyWith("none");

export function llmPolicy(adapter: LlmAdapter | null, fallback: Policy = baselinePolicy): Policy {
  return {
    name: "llm",
    decide(org, percept, rng) {
      const a = adapter?.decide?.(percept) ?? null;
      if (a) return { action: a, reason: "llm", cost: 4 };
      const fb = fallback.decide(org, percept, rng);
      return { ...fb, reason: `llm-fallback:${fb.reason}`, cost: fb.cost };
    },
  };
}

export class BrainRuntime {
  policy: Policy;
  traces: BrainTrace[] = [];
  maxDecisionsPerTick: number;
  maxLlmCallsPerTick: number;
  usedThisTick = 0;
  llmUsedThisTick = 0;
  totalDecisions = 0;
  totalCost = 0;

  constructor(policy: Policy, maxDecisionsPerTick = 64, maxLlmCallsPerTick = 2) {
    this.policy = policy;
    this.maxDecisionsPerTick = maxDecisionsPerTick;
    this.maxLlmCallsPerTick = maxLlmCallsPerTick;
  }

  beginTick(): void {
    this.usedThisTick = 0;
    this.llmUsedThisTick = 0;
  }

  canDecide(): boolean {
    return this.usedThisTick < this.maxDecisionsPerTick;
  }

  canLlm(): boolean {
    return this.llmUsedThisTick < this.maxLlmCallsPerTick;
  }

  record(t: BrainTrace): void {
    this.traces.push(t);
    this.usedThisTick++;
    this.totalDecisions++;
    this.totalCost += t.cost;
    if (t.policy === "llm" && t.reason === "llm") this.llmUsedThisTick++;
    if (this.traces.length > 400) this.traces.splice(0, this.traces.length - 300);
  }

  lastFor(orgId: number): BrainTrace | undefined {
    for (let i = this.traces.length - 1; i >= 0; i--) {
      if (this.traces[i]!.orgId === orgId) return this.traces[i];
    }
    return undefined;
  }
}

export interface PolicyMoveResult {
  moved: number;
  displacements: number;
  decided: number;
}

/**
 * When brains are enabled, this replaces moveOrganisms. Off-path: World.step
 * still calls moveOrganisms and this function is never entered.
 */
export function applyPolicyMoves(
  organisms: Organism[],
  occupancy: Int32Array,
  terrain: Uint8Array,
  fields: Fields,
  w: number,
  h: number,
  rng: Rng,
  tick: number,
  brain: BrainRuntime,
): PolicyMoveResult {
  brain.beginTick();
  let moved = 0;
  let displacements = 0;
  let decided = 0;
  const n = organisms.length;
  for (let i = 0; i < n; i++) {
    const org = organisms[i]!;
    if (org.energy <= 0) continue;
    if (!rng.chance(org.ph.motility)) continue;
    let dir: number;
    if (brain.canDecide()) {
      const percept = collectPercept(org, fields, occupancy, organisms, w, h);
      let d: { action: BrainAction; reason: string; cost: number };
      if (brain.policy.name === "llm" && !brain.canLlm()) {
        const fb = baselinePolicy.decide(org, percept, rng);
        d = { action: fb.action, reason: `llm-capped:${fb.reason}`, cost: fb.cost };
      } else {
        d = brain.policy.decide(org, percept, rng);
      }
      brain.record({
        tick,
        orgId: org.id,
        percept,
        action: d.action,
        policy: brain.policy.name,
        cost: d.cost,
        reason: d.reason,
      });
      decided++;
      if (d.action.type === "stay") continue;
      dir = d.action.dir;
    } else {
      dir = chemotaxisDir(org, fields, terrain, occupancy, w, h, rng);
    }
    dir = ((dir % 8) + 8) % 8;
    const ni = neighborIndex(org.x, org.y, dir, w, h);
    if (ni === null) continue;
    if (terrain[ni] === TERRAIN.barrier) continue;
    const occ = occupancy[ni]!;
    const nx = org.x + DX[dir]!;
    const ny = org.y + DY[dir]!;
    if (occ < 0) {
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      moved++;
      continue;
    }
    if (occ === i) continue;
    const other = organisms[occ]!;
    if (other.energy <= 0) {
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      moved++;
      continue;
    }
    if (org.fitness > other.fitness) {
      occupancy[other.y * w + other.x] = -1;
      other.energy = 0;
      other.pendingDeath = "competition";
      occupancy[org.y * w + org.x] = -1;
      org.x = nx;
      org.y = ny;
      occupancy[ni] = i;
      displacements++;
      moved++;
    }
  }
  return { moved, displacements, decided };
}

export function tracesHtml(traces: readonly BrainTrace[], orgId?: number): string {
  const rows = traces.filter((t) => orgId === undefined || t.orgId === orgId).slice(-12).reverse();
  if (!rows.length) return `<p class="muted">No brain traces yet. Enable brains (baseline) to log perception → action.</p>`;
  return rows
    .map((t) => {
      const act =
        t.action.type === "stay" ? "stay" : `${t.action.type} dir ${t.action.dir}`;
      return `<div class="feed-row">
        <div class="feed-head">${t.policy} · ${act}</div>
        <div class="muted">t${t.tick} · org ${t.orgId} · cost ${t.cost} · ${t.reason}</div>
        <div class="muted">N ${t.percept.nutrient.toFixed(2)} · T ${t.percept.toxin.toFixed(2)} · L ${t.percept.light.toFixed(2)} · E ${t.percept.energy.toFixed(2)} · prey ${t.percept.preyNearby ? "yes" : "no"}</div>
      </div>`;
    })
    .join("");
}
