/**
 * Ancestry helpers over the lineage tree.
 *
 * A lineage is opened by a founder, by a mutant birth, or by "apply genome".
 * Innovations record the phenotype-changing mutations with the lineage they
 * opened, so the chain root → leaf tells how an organism came to be.
 */
import type { Innovation, TraitChange } from "./species";
import type { LineageNode, Organism } from "./types";

export interface AncestryStep {
  lineage: LineageNode;
  /** The mutation that opened this lineage, when it changed the phenotype. */
  innovation: Innovation | null;
  /** Depth from the founder lineage (0 = founder). */
  depth: number;
}

export function lineageChildren(lineages: ReadonlyMap<number, LineageNode>): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const l of lineages.values()) {
    if (l.parentId < 0) continue;
    const list = out.get(l.parentId);
    if (list) list.push(l.id);
    else out.set(l.parentId, [l.id]);
  }
  return out;
}

export function innovationByLineage(innovations: readonly Innovation[]): Map<number, Innovation> {
  const out = new Map<number, Innovation>();
  for (const i of innovations) if (!out.has(i.lineageId)) out.set(i.lineageId, i);
  return out;
}

/** Root → leaf chain of lineage nodes for `lineageId` (empty when unknown). */
export function lineageChain(lineages: ReadonlyMap<number, LineageNode>, lineageId: number): LineageNode[] {
  const chain: LineageNode[] = [];
  let cur = lineages.get(lineageId);
  let guard = 0;
  while (cur && guard++ < 100000) {
    chain.push(cur);
    cur = cur.parentId >= 0 ? lineages.get(cur.parentId) : undefined;
  }
  return chain.reverse();
}

export function ancestry(
  lineages: ReadonlyMap<number, LineageNode>,
  innovations: readonly Innovation[],
  lineageId: number,
): AncestryStep[] {
  const byLineage = innovationByLineage(innovations);
  return lineageChain(lineages, lineageId).map((lineage, depth) => ({ lineage, innovation: byLineage.get(lineage.id) ?? null, depth }));
}

/** Living organisms plus living descendants of every sub-lineage. */
export function subtreeCount(lineages: ReadonlyMap<number, LineageNode>, lineageId: number, children = lineageChildren(lineages)): number {
  let sum = lineages.get(lineageId)?.count ?? 0;
  const stack = [...(children.get(lineageId) ?? [])];
  let guard = 0;
  while (stack.length && guard++ < 1000000) {
    const id = stack.pop()!;
    sum += lineages.get(id)?.count ?? 0;
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return sum;
}

/** Largest absolute phenotype change along a chain, for "biggest changes" highlighting. */
export function biggestChanges(steps: readonly AncestryStep[], limit = 3): Array<{ step: AncestryStep; change: TraitChange }> {
  const all: Array<{ step: AncestryStep; change: TraitChange }> = [];
  for (const step of steps) for (const change of step.innovation?.changes ?? []) all.push({ step, change });
  return all.sort((a, b) => Math.abs(b.change.to - b.change.from) - Math.abs(a.change.to - a.change.from)).slice(0, limit);
}

/** Descendant lineages of `lineageId` in breadth-first order (excluding itself). */
export function descendantLineages(lineages: ReadonlyMap<number, LineageNode>, lineageId: number, limit = 500): LineageNode[] {
  const children = lineageChildren(lineages);
  const out: LineageNode[] = [];
  const queue = [...(children.get(lineageId) ?? [])];
  while (queue.length && out.length < limit) {
    const id = queue.shift()!;
    const node = lineages.get(id);
    if (!node) continue;
    out.push(node);
    for (const c of children.get(id) ?? []) queue.push(c);
  }
  return out;
}

/** Organisms currently alive in a lineage or any of its sub-lineages. */
export function organismsUnderLineage(organisms: readonly Organism[], lineages: ReadonlyMap<number, LineageNode>, lineageId: number): Organism[] {
  const ids = new Set<number>([lineageId, ...descendantLineages(lineages, lineageId, 100000).map((l) => l.id)]);
  return organisms.filter((o) => ids.has(o.lineageId));
}
