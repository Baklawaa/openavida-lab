import type { LineageNode, MetricsSample, Organism } from "./types";

export function shannonFromCounts(counts: Iterable<number>, total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return Number.isFinite(h) ? h : 0;
}

export function lineageShannon(lineages: Iterable<LineageNode>, population: number): number {
  return shannonFromCounts(
    Array.from(lineages, (l) => l.count).filter((c) => c > 0),
    population,
  );
}

export function genotypeShannon(organisms: Organism[]): number {
  if (organisms.length === 0) return 0;
  const map = new Map<string, number>();
  for (const o of organisms) {
    map.set(o.genome, (map.get(o.genome) ?? 0) + 1);
  }
  return shannonFromCounts(map.values(), organisms.length);
}

export function fixation(
  lineages: Iterable<LineageNode>,
  population: number,
  threshold = 0.9,
): { lineageId: number; fraction: number } | null {
  if (population <= 0) return null;
  let best: LineageNode | null = null;
  for (const l of lineages) {
    if (!best || l.count > best.count) best = l;
  }
  if (!best || best.count <= 0) return null;
  const fraction = best.count / population;
  if (fraction >= threshold) return { lineageId: best.id, fraction };
  return { lineageId: best.id, fraction };
}

export function sampleMetrics(
  tick: number,
  organisms: Organism[],
  lineages: Iterable<LineageNode>,
  extinctTotal: number,
): MetricsSample {
  const population = organisms.length;
  let sum = 0;
  let max = 0;
  for (const o of organisms) {
    sum += o.fitness;
    if (o.fitness > max) max = o.fitness;
  }
  const lin = Array.from(lineages);
  const fix = fixation(lin, population, 0.9);
  let lineageCount = 0;
  for (const l of lin) if (l.count > 0) lineageCount++;
  return {
    tick,
    population,
    meanFitness: population ? sum / population : 0,
    maxFitness: max,
    shannon: lineageShannon(lin, population),
    shannonGenotype: genotypeShannon(organisms),
    lineageCount,
    extinctTotal,
    fixationFraction: fix ? fix.fraction : 0,
    fixationLineageId: fix ? fix.lineageId : -1,
  };
}

export function parentChildEdges(lineages: Iterable<LineageNode>): Array<{ parent: number; child: number }> {
  const edges: Array<{ parent: number; child: number }> = [];
  for (const l of lineages) {
    if (l.parentId >= 0) edges.push({ parent: l.parentId, child: l.id });
  }
  return edges;
}
