import type { LineageNode, MetricsSample } from "../sim/types";

function cssSize(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d");
  return ctx;
}

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string): void {
  ctx.fillStyle = "#070b10";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#1a2833";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = "#7f93a3";
  ctx.font = `${11 * (w > 400 ? 1.1 : 1)}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillText(title, 10, 14);
}

function series(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  values: number[],
  color: string,
  yMin?: number,
  yMax?: number,
): void {
  if (values.length < 2) return;
  let lo = yMin ?? Infinity;
  let hi = yMax ?? -Infinity;
  if (yMin === undefined || yMax === undefined) {
    for (const v of values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (hi === lo) {
    hi += 0.1;
    lo -= 0.1;
  }
  const padL = 8;
  const padR = 8;
  const padT = 22;
  const padB = 8;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  for (let i = 0; i < values.length; i++) {
    const x = padL + (i / (values.length - 1)) * innerW;
    const y = padT + (1 - (values[i]! - lo) / (hi - lo)) * innerH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.12;
  ctx.lineTo(padL + innerW, padT + innerH);
  ctx.lineTo(padL, padT + innerH);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#8aa0b5";
  ctx.font = `10px ui-monospace, monospace`;
  ctx.fillText(hi.toFixed(2), padL, padT - 2);
  ctx.fillText(lo.toFixed(2), padL, h - 4);
}

export function drawFitness(canvas: HTMLCanvasElement, cssW: number, cssH: number, hist: MetricsSample[]): void {
  const ctx = cssSize(canvas, cssW, cssH);
  const w = canvas.width;
  const h = canvas.height;
  frame(ctx, w, h, "mean / max fitness");
  series(
    ctx,
    w,
    h,
    hist.map((m) => m.maxFitness),
    "#f0d35a",
  );
  series(
    ctx,
    w,
    h,
    hist.map((m) => m.meanFitness),
    "#3ee0c0",
  );
}

export function drawShannon(canvas: HTMLCanvasElement, cssW: number, cssH: number, hist: MetricsSample[]): void {
  const ctx = cssSize(canvas, cssW, cssH);
  const w = canvas.width;
  const h = canvas.height;
  frame(ctx, w, h, "Shannon diversity (lineages)");
  series(
    ctx,
    w,
    h,
    hist.map((m) => m.shannon),
    "#c87bff",
    0,
  );
}

export function drawPhylogeny(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  lineages: Iterable<LineageNode>,
  tick: number,
): void {
  const ctx = cssSize(canvas, cssW, cssH);
  const w = canvas.width;
  const h = canvas.height;
  frame(ctx, w, h, "phylogeny");
  const all = Array.from(lineages);
  const live = all.filter((n) => n.count > 0);
  const recentDead = all
    .filter((n) => n.count === 0 && n.extinctTick !== null && tick - n.extinctTick < 180)
    .sort((a, b) => (b.peakCount || 0) - (a.peakCount || 0))
    .slice(0, 24);
  const nodes = (live.length > 80 ? live.sort((a, b) => b.count - a.count).slice(0, 80) : live).concat(recentDead);
  if (nodes.length === 0) return;

  const byParent = new Map<number, LineageNode[]>();
  const roots: LineageNode[] = [];
  for (const n of nodes) {
    if (n.parentId < 0) roots.push(n);
    else {
      const arr = byParent.get(n.parentId) ?? [];
      arr.push(n);
      byParent.set(n.parentId, arr);
    }
  }

  type Laid = { n: LineageNode; depth: number; row: number };
  const laid: Laid[] = [];
  let row = 0;
  const visit = (n: LineageNode, depth: number) => {
    laid.push({ n, depth, row });
    row++;
    const kids = byParent.get(n.id) ?? [];
    kids.sort((a, b) => a.bornTick - b.bornTick);
    for (const k of kids) visit(k, depth + 1);
  };
  roots.sort((a, b) => a.bornTick - b.bornTick);
  for (const r of roots) visit(r, 0);
  // orphans whose parent died from the visible set
  const seen = new Set(laid.map((l) => l.n.id));
  for (const n of nodes) {
    if (!seen.has(n.id)) visit(n, 0);
  }
  const laidById = new Map(laid.map((l) => [l.n.id, l]));

  const maxDepth = laid.reduce((m, l) => Math.max(m, l.depth), 1);
  const maxTick = Math.max(tick, 1);
  const padL = 10;
  const padR = 10;
  const padT = 22;
  const padB = 8;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const nShow = laid.length;
  const rowH = Math.min(10, innerH / Math.max(1, nShow));

  for (const L of laid) {
    const y = padT + (nShow <= 1 ? innerH / 2 : (L.row / Math.max(1, nShow - 1)) * innerH);
    const x0 = padL + (L.n.bornTick / maxTick) * innerW * 0.85 + L.depth * (innerW * 0.02);
    const x1 =
      padL +
      ((L.n.extinctTick ?? maxTick) / maxTick) * innerW * 0.85 +
      L.depth * (innerW * 0.02);
    const hue = L.n.hue;
    const alive = L.n.count > 0;
    ctx.strokeStyle = alive ? `hsla(${hue * 360}, 70%, 62%, 0.95)` : `hsla(${hue * 360}, 30%, 40%, 0.45)`;
    ctx.lineWidth = Math.max(1, Math.min(5, 1 + Math.log2(1 + L.n.peakCount)));
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(Math.max(x0 + 2, x1), y);
    ctx.stroke();
    if (L.n.parentId >= 0) {
      const parent = laidById.get(L.n.parentId);
      if (parent) {
        const py = padT + (nShow <= 1 ? innerH / 2 : (parent.row / Math.max(1, nShow - 1)) * innerH);
        ctx.strokeStyle = "rgba(80,110,120,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0, py);
        ctx.stroke();
      }
    }
    void maxDepth;
    void rowH;
  }
}
