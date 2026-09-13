import { describe, expect, it } from "vitest";
import { EMPTY_EVENT_FLAGS, detectEvents, type EventWorld } from "../src/sim/events";
import type { MetricsSample } from "../src/sim/types";

function metrics(partial: Partial<MetricsSample> & { tick: number; population: number }): MetricsSample {
  return {
    meanFitness: 0,
    maxFitness: 0,
    shannon: 0,
    shannonGenotype: 0,
    lineageCount: 1,
    extinctTotal: 0,
    fixationFraction: 0,
    fixationLineageId: 0,
    ...partial,
  };
}

function baseWorld(over: Partial<EventWorld> = {}): EventWorld {
  return {
    tick: 1,
    organisms: [{ lineageId: 1, strainId: 1 }],
    lineages: new Map([[1, { id: 1, count: 1, extinctTick: null, parentId: -1 }]]),
    strains: new Map([[1, { id: 1, name: "Alpha" }]]),
    innovations: [],
    lastPredation: 0,
    history: [metrics({ tick: 0, population: 1 }), metrics({ tick: 1, population: 1 })],
    ...over,
  };
}

describe("detectEvents", () => {
  it("emits lineage-dominant once when a lineage crosses 20 %", () => {
    const prev = metrics({ tick: 0, population: 10 });
    const orgs = Array.from({ length: 10 }, (_, i) => ({ lineageId: i < 3 ? 1 : 2, strainId: 1 }));
    const world = baseWorld({
      organisms: orgs,
      lineages: new Map([
        [1, { id: 1, count: 3, extinctTick: null, parentId: -1 }],
        [2, { id: 2, count: 7, extinctTick: null, parentId: -1 }],
      ]),
      history: [prev, metrics({ tick: 1, population: 10 })],
    });
    const a = detectEvents(prev, world, EMPTY_EVENT_FLAGS);
    expect(a.events.filter((e) => e.kind === "lineage-dominant")).toHaveLength(2);
    const b = detectEvents(prev, world, a.flags);
    expect(b.events.filter((e) => e.kind === "lineage-dominant")).toHaveLength(0);
  });

  it("emits lineage-collapse once when a former dominant lineage goes extinct", () => {
    const prev = metrics({ tick: 4, population: 5 });
    const world = baseWorld({
      tick: 5,
      organisms: [{ lineageId: 2, strainId: 1 }],
      lineages: new Map([
        [1, { id: 1, count: 0, extinctTick: 5, parentId: -1 }],
        [2, { id: 2, count: 1, extinctTick: null, parentId: -1 }],
      ]),
    });
    const a = detectEvents(prev, world, { dominant: [1], sweep: [], firstPredation: false });
    expect(a.events.filter((e) => e.kind === "lineage-collapse" && e.lineageId === 1)).toHaveLength(1);
    const b = detectEvents(prev, { ...world, tick: 6, lineages: new Map([[1, { id: 1, count: 0, extinctTick: 5, parentId: -1 }]]) }, a.flags);
    expect(b.events.filter((e) => e.kind === "lineage-collapse")).toHaveLength(0);
  });

  it("emits first-predation once", () => {
    const prev = metrics({ tick: 0, population: 2 });
    const world = baseWorld({ lastPredation: 3 });
    const a = detectEvents(prev, world, EMPTY_EVENT_FLAGS);
    expect(a.events.filter((e) => e.kind === "first-predation")).toHaveLength(1);
    const b = detectEvents(prev, world, a.flags);
    expect(b.events.filter((e) => e.kind === "first-predation")).toHaveLength(0);
  });

  it("emits innovation-sweep once above 30 % of the strain", () => {
    const prev = metrics({ tick: 0, population: 10 });
    const orgs = Array.from({ length: 10 }, (_, i) => ({ lineageId: i < 4 ? 2 : 1, strainId: 1 }));
    const world = baseWorld({
      organisms: orgs,
      lineages: new Map([
        [1, { id: 1, count: 6, extinctTick: null, parentId: -1 }],
        [2, { id: 2, count: 4, extinctTick: null, parentId: 1 }],
      ]),
      innovations: [{ id: 9, strainId: 1, lineageId: 2 }],
      history: [prev, metrics({ tick: 1, population: 10 })],
    });
    const a = detectEvents(prev, world, EMPTY_EVENT_FLAGS);
    expect(a.events.filter((e) => e.kind === "innovation-sweep" && e.innovationId === 9)).toHaveLength(1);
    const b = detectEvents(prev, world, a.flags);
    expect(b.events.filter((e) => e.kind === "innovation-sweep")).toHaveLength(0);
  });

  it("emits strain-extinct when a previously counted strain hits zero", () => {
    const prev = metrics({ tick: 0, population: 2, strains: { "1": 1, "2": 1 } });
    const world = baseWorld({
      organisms: [{ lineageId: 2, strainId: 2 }],
      strains: new Map([
        [1, { id: 1, name: "Alpha" }],
        [2, { id: 2, name: "Beta" }],
      ]),
    });
    const a = detectEvents(prev, world, EMPTY_EVENT_FLAGS);
    const extinct = a.events.filter((e) => e.kind === "strain-extinct" && e.strainId === 1);
    expect(extinct).toHaveLength(1);
    // The sentence is rendered by the interface: the event carries the strain id.
    expect(extinct[0]!.strainId).toBe(1);
  });

  it("emits population-crash and population-boom when the 20-step window crosses the threshold", () => {
    const histCrash = Array.from({ length: 21 }, (_, i) => metrics({ tick: i, population: i === 20 ? 50 : 100 }));
    const prevC = histCrash[19]!;
    const worldC = baseWorld({
      tick: 20,
      organisms: Array.from({ length: 50 }, () => ({ lineageId: 1, strainId: 1 })),
      lineages: new Map([[1, { id: 1, count: 50, extinctTick: null, parentId: -1 }]]),
      history: histCrash,
    });
    const crash = detectEvents(prevC, worldC, EMPTY_EVENT_FLAGS);
    expect(crash.events.filter((e) => e.kind === "population-crash")).toHaveLength(1);
    expect(detectEvents(histCrash[20]!, worldC, crash.flags).events.filter((e) => e.kind === "population-crash")).toHaveLength(0);

    const histBoom = Array.from({ length: 21 }, (_, i) => metrics({ tick: i, population: i === 20 ? 40 : 10 }));
    const prevB = histBoom[19]!;
    const worldB = baseWorld({
      tick: 20,
      organisms: Array.from({ length: 40 }, () => ({ lineageId: 1, strainId: 1 })),
      lineages: new Map([[1, { id: 1, count: 40, extinctTick: null, parentId: -1 }]]),
      history: histBoom,
    });
    const boom = detectEvents(prevB, worldB, EMPTY_EVENT_FLAGS);
    expect(boom.events.filter((e) => e.kind === "population-boom")).toHaveLength(1);
    expect(detectEvents(histBoom[20]!, worldB, boom.flags).events.filter((e) => e.kind === "population-boom")).toHaveLength(0);
  });
});
