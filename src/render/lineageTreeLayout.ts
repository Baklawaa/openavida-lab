/**
 * Layout of a drawn lineage tree centred on one lineage.
 *
 * Time runs along x (birth → extinction or now); each lineage is a
 * horizontal bar on its own row; a child hangs from its parent's bar at the
 * child's birth tick. Every lineage has its own row; rows follow a
 * depth-first order (children right below their parent, the child on the
 * focus path first) so sub-trees stay contiguous. Pure: the canvas view only
 * paints it.
 */
import type { Innovation, TraitChange } from "../sim/species";
import type { LineageNode } from "../sim/types";

export interface TreeNode {
  id: number;
  parentId: number;
  t0: number;
  t1: number;
  row: number;
  depth: number;
  count: number;
  peak: number;
  extinct: boolean;
  /** Ancestor of the focus (or the focus itself). */
  onPath: boolean;
  isFocus: boolean;
  /** Direct descendants shown in the layout. */
  childIds: number[];
  /** Descendants not shown because of the node budget. */
  hiddenDescendants: number;
  /** Largest phenotype change of the mutation that opened this lineage. */
  change: TraitChange | null;
  changes: TraitChange[];
  strainId: number;
}

export interface TreeLayout {
  nodes: TreeNode[];
  byId: Map<number, TreeNode>;
  rows: number;
  tMin: number;
  tMax: number;
  focusId: number;
  /** Ordered root → focus. */
  path: number[];
}

export interface TreeLayoutOptions {
  now: number;
  /** Cap on descendant lineages shown under the focus (breadth-first, largest peak first). */
  maxDescendants?: number;
  /** Also show the direct siblings of every lineage on the path (context). */
  siblings?: boolean;
  /** Hide lineages extinct for longer than this many ticks (Infinity = keep all). */
  extinctFor?: number;
  strainOf?: (lineageId: number) => number;
}

function biggest(changes: readonly TraitChange[]): TraitChange | null {
  let best: TraitChange | null = null;
  for (const c of changes) if (!best || Math.abs(c.to - c.from) > Math.abs(best.to - best.from)) best = c;
  return best;
}

export function layoutLineageTree(
  lineages: ReadonlyMap<number, LineageNode>,
  innovations: readonly Innovation[],
  focusId: number,
  opts: TreeLayoutOptions,
): TreeLayout {
  const maxDescendants = opts.maxDescendants ?? 400;
  const extinctFor = opts.extinctFor ?? Infinity;
  const children = new Map<number, LineageNode[]>();
  for (const l of lineages.values()) {
    if (l.parentId < 0) continue;
    const list = children.get(l.parentId);
    if (list) list.push(l);
    else children.set(l.parentId, [l]);
  }
  for (const list of children.values()) list.sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
  const innovation = new Map<number, Innovation>();
  for (const i of innovations) if (!innovation.has(i.lineageId)) innovation.set(i.lineageId, i);
  const visible = (l: LineageNode) => l.count > 0 || l.extinctTick === null || opts.now - l.extinctTick <= extinctFor;

  // Path root → focus.
  const path: LineageNode[] = [];
  let cur = lineages.get(focusId);
  let guard = 0;
  while (cur && guard++ < 100000) {
    path.unshift(cur);
    cur = cur.parentId >= 0 ? lineages.get(cur.parentId) : undefined;
  }
  const empty: TreeLayout = { nodes: [], byId: new Map(), rows: 0, tMin: 0, tMax: opts.now, focusId, path: [] };
  if (!path.length) return empty;
  const pathIds = new Set(path.map((p) => p.id));

  // Node set: the path, the focus' descendants (budgeted), optionally siblings along the path.
  const chosen = new Map<number, LineageNode>();
  for (const p of path) chosen.set(p.id, p);
  const hidden = new Map<number, number>();
  const queue: LineageNode[] = [...(children.get(focusId) ?? [])].filter(visible).sort((a, b) => b.peakCount - a.peakCount);
  let budget = maxDescendants;
  while (queue.length) {
    const n = queue.shift()!;
    if (budget <= 0) {
      hidden.set(n.parentId, (hidden.get(n.parentId) ?? 0) + 1);
      continue;
    }
    chosen.set(n.id, n);
    budget--;
    for (const c of (children.get(n.id) ?? []).filter(visible).sort((a, b) => b.peakCount - a.peakCount)) queue.push(c);
  }
  if (opts.siblings) {
    for (const p of path) {
      if (p.parentId < 0) continue;
      for (const s of children.get(p.parentId) ?? []) if (!chosen.has(s.id) && visible(s)) chosen.set(s.id, s);
    }
  }

  // Ladder rows: every lineage gets its own row; a lineage's children follow directly below it (pre-order),
  // the child on the focus path first so the highlighted trunk stays adjacent to its parent.
  const shownChildren = (id: number) => (children.get(id) ?? []).filter((c) => chosen.has(c.id));
  const rowOf = new Map<number, number>();
  let nextRow = 0;
  const place = (n: LineageNode): number => {
    const r = nextRow++;
    rowOf.set(n.id, r);
    const kids = shownChildren(n.id);
    const ordered = kids.slice().sort((a, b) => Number(pathIds.has(b.id)) - Number(pathIds.has(a.id)) || a.bornTick - b.bornTick || a.id - b.id);
    for (const k of ordered) place(k);
    return r;
  };
  const root = path[0]!;
  place(root);

  const nodes: TreeNode[] = [];
  let tMin = Infinity;
  let tMax = -Infinity;
  const depthOf = new Map<number, number>();
  for (const n of chosen.values()) {
    let d = 0;
    let p: LineageNode | undefined = n;
    let g = 0;
    while (p && p.parentId >= 0 && chosen.has(p.parentId) && g++ < 100000) {
      d++;
      p = lineages.get(p.parentId);
    }
    depthOf.set(n.id, d);
  }
  for (const n of chosen.values()) {
    const t1 = n.extinctTick ?? opts.now;
    const inn = innovation.get(n.id);
    const changes = inn?.changes ?? [];
    tMin = Math.min(tMin, n.bornTick);
    tMax = Math.max(tMax, t1);
    nodes.push({
      id: n.id,
      parentId: chosen.has(n.parentId) ? n.parentId : -1,
      t0: n.bornTick,
      t1: Math.max(t1, n.bornTick),
      row: rowOf.get(n.id) ?? 0,
      depth: depthOf.get(n.id) ?? 0,
      count: n.count,
      peak: n.peakCount,
      extinct: n.count === 0 && n.extinctTick !== null,
      onPath: pathIds.has(n.id),
      isFocus: n.id === focusId,
      childIds: shownChildren(n.id).map((c) => c.id),
      hiddenDescendants: hidden.get(n.id) ?? 0,
      change: biggest(changes),
      changes,
      strainId: opts.strainOf?.(n.id) ?? 0,
    });
  }
  nodes.sort((a, b) => a.row - b.row || a.t0 - b.t0);
  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    rows: nextRow,
    tMin: Number.isFinite(tMin) ? tMin : 0,
    tMax: Number.isFinite(tMax) ? Math.max(tMax, tMin + 1) : opts.now,
    focusId,
    path: path.map((p) => p.id),
  };
}

/** Lineage → strain from any organism (living or dead) or innovation that carries both ids. */
export function lineageStrainMap(
  organisms: readonly { lineageId: number; strainId: number }[],
  deaths: readonly { lineageId: number; strainId?: number }[],
  innovations: readonly { lineageId: number; strainId: number }[],
  lineages: ReadonlyMap<number, LineageNode>,
): (lineageId: number) => number {
  const map = new Map<number, number>();
  for (const i of innovations) map.set(i.lineageId, i.strainId);
  for (const d of deaths) if (d.strainId) map.set(d.lineageId, d.strainId);
  for (const o of organisms) map.set(o.lineageId, o.strainId);
  return (id: number): number => {
    let cur = lineages.get(id);
    let guard = 0;
    while (cur && guard++ < 100000) {
      const s = map.get(cur.id);
      if (s !== undefined) return s;
      cur = cur.parentId >= 0 ? lineages.get(cur.parentId) : undefined;
    }
    // Inherit downward too: a parent's strain is its children's strain.
    return 0;
  };
}
