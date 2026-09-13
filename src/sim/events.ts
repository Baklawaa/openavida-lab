/**
 * Discrete world events derived from metrics — no RNG.
 *
 * "Once" kinds (dominant, sweep, first predation) are gated by EventFlags
 * so a bounded event log can forget old rows without re-firing.
 *
 * Events carry structured fields only (kind, tick, ids): the interface builds
 * their sentence from the locale catalog (src/ui/i18n/sim.fr.ts), so the sim
 * stays free of display language.
 */
import { innovationSpread } from "./species";
import type { Innovation, Strain } from "./species";
import type { LineageNode, MetricsSample } from "./types";

export const EVENT_LOG_MAX = 500;
export const EVENT_WINDOW = 20;

export type WorldEventKind =
  | "lineage-dominant"
  | "lineage-collapse"
  | "first-predation"
  | "innovation-sweep"
  | "strain-extinct"
  | "population-crash"
  | "population-boom";

export interface WorldEvent {
  id: number;
  tick: number;
  kind: WorldEventKind;
  lineageId?: number;
  strainId?: number;
  innovationId?: number;
}

export interface EventFlags {
  dominant: number[];
  sweep: number[];
  firstPredation: boolean;
}

export const EMPTY_EVENT_FLAGS: EventFlags = { dominant: [], sweep: [], firstPredation: false };

export interface EventWorld {
  tick: number;
  organisms: readonly { lineageId: number; strainId: number }[];
  lineages: ReadonlyMap<number, Pick<LineageNode, "id" | "count" | "extinctTick" | "parentId">>;
  strains: ReadonlyMap<number, Pick<Strain, "id" | "name">>;
  innovations: readonly Pick<Innovation, "id" | "strainId" | "lineageId">[];
  lastPredation: number;
  history: readonly Pick<MetricsSample, "tick" | "population">[];
}

function popAt(history: EventWorld["history"], tick: number, lag: number): number | null {
  const target = tick - lag;
  let best: { tick: number; population: number } | null = null;
  for (const h of history) {
    if (h.tick > target) continue;
    if (!best || h.tick > best.tick) best = h;
  }
  return best && best.tick <= target ? best.population : null;
}

function crossed(now: boolean, then: boolean): boolean {
  return now && !then;
}

export function detectEvents(prev: MetricsSample, world: EventWorld, flags: EventFlags): { events: Array<Omit<WorldEvent, "id">>; flags: EventFlags } {
  const events: Array<Omit<WorldEvent, "id">> = [];
  const dominant = new Set(flags.dominant);
  const sweep = new Set(flags.sweep);
  let firstPredation = flags.firstPredation;
  const pop = world.organisms.length;
  const tick = world.tick;

  if (pop > 0) {
    for (const lin of world.lineages.values()) {
      const share = lin.count / pop;
      if (share >= 0.2 && !dominant.has(lin.id)) {
        dominant.add(lin.id);
        events.push({
          tick,
          kind: "lineage-dominant",
          lineageId: lin.id,
        });
      }
    }
  }

  for (const lin of world.lineages.values()) {
    if (!dominant.has(lin.id)) continue;
    if (lin.count === 0 && lin.extinctTick === tick) {
      events.push({
        tick,
        kind: "lineage-collapse",
        lineageId: lin.id,
      });
    }
  }

  if (world.lastPredation > 0 && !firstPredation) {
    firstPredation = true;
    events.push({ tick, kind: "first-predation" });
  }

  if (pop > 0 && world.innovations.length) {
    const spread = innovationSpread(world.lineages as ReadonlyMap<number, LineageNode>, world.innovations as Innovation[]);
    const strainN = new Map<number, number>();
    for (const o of world.organisms) strainN.set(o.strainId, (strainN.get(o.strainId) ?? 0) + 1);
    for (const inn of world.innovations) {
      if (sweep.has(inn.id)) continue;
      const living = spread.get(inn.id) ?? 0;
      const n = strainN.get(inn.strainId) ?? 0;
      if (n > 0 && living / n > 0.3) {
        sweep.add(inn.id);
        events.push({
          tick,
          kind: "innovation-sweep",
          innovationId: inn.id,
          strainId: inn.strainId,
          lineageId: inn.lineageId,
        });
      }
    }
  }

  const prevStrains = prev.strains ?? {};
  const nowStrains: Record<string, number> = {};
  for (const o of world.organisms) nowStrains[String(o.strainId)] = (nowStrains[String(o.strainId)] ?? 0) + 1;
  for (const [k, n] of Object.entries(prevStrains)) {
    if ((n ?? 0) <= 0) continue;
    if ((nowStrains[k] ?? 0) > 0) continue;
    const id = Number(k);
    events.push({
      tick,
      kind: "strain-extinct",
      strainId: id,
    });
  }

  const refPop = popAt(world.history, tick, EVENT_WINDOW);
  const prevRef = popAt(world.history.filter((h) => h.tick <= prev.tick), prev.tick, EVENT_WINDOW);
  if (refPop !== null && refPop > 0) {
    const crashNow = pop <= refPop * 0.6;
    const crashThen = prevRef !== null && prevRef > 0 && prev.population <= prevRef * 0.6;
    if (crossed(crashNow, crashThen)) {
      events.push({ tick, kind: "population-crash" });
    }
    const boomNow = pop >= refPop * 2;
    const boomThen = prevRef !== null && prevRef > 0 && prev.population >= prevRef * 2;
    if (crossed(boomNow, boomThen)) {
      events.push({ tick, kind: "population-boom" });
    }
  }

  return {
    events,
    flags: { dominant: [...dominant], sweep: [...sweep], firstPredation },
  };
}

export const EVENT_COLOR: Record<WorldEventKind, string> = {
  "lineage-dominant": "#a2dfbd",
  "lineage-collapse": "#ed809d",
  "first-predation": "#eac789",
  "innovation-sweep": "#bcaaea",
  "strain-extinct": "#91a2a7",
  "population-crash": "#ed809d",
  "population-boom": "#a2dfbd",
};
