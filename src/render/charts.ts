import type { LineageNode, MetricsSample } from "../sim/types";

const INK = "#91a2a7";
const GRID = "#253138";
const PAD = { left: 34, right: 9, top: 9, bottom: 20 };

function prepare(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${Math.max(0, w)}px`;
  canvas.style.height = `${Math.max(0, h)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context required");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
  return ctx;
}

/** Round a positive magnitude to a readable tick value. */
export function chartCeiling(values: number[]): number {
  const max = values.reduce((m, v) => Number.isFinite(v) ? Math.max(m, v) : m, 0);
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude * 2) / 2 * magnitude;
}

export function chartDomain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  const min = finite.reduce((m, v) => Math.min(m, v), 0);
  const max = finite.reduce((m, v) => Math.max(m, v), 0);
  if (min === 0 && max === 0) return [0, 1];
  return [min < 0 ? -chartCeiling([-min]) : 0, max > 0 ? chartCeiling([max]) : 0];
}

function format(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v === 0 ? "0" : v >= 10 ? v.toFixed(0) : v.toFixed(2);
}

function axes(ctx: CanvasRenderingContext2D, w: number, h: number, floor: number, ceiling: number, start: number, end: number): void {
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 2; i++) {
    const y = PAD.top + i / 2 * plotH;
    ctx.textAlign = "right";
    ctx.fillText(format(floor + (ceiling - floor) * (1 - i / 2)), PAD.left - 7, y);
    ctx.strokeStyle = GRID;
    ctx.setLineDash(i === 2 ? [] : [2, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.fillText(String(start), PAD.left, h - 6);
  ctx.textAlign = "right";
  ctx.fillText(`${end} pas`, w - PAD.right, h - 6);
  ctx.textAlign = "left";
}

function empty(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  ctx.fillStyle = "#91a2a7";
  ctx.textAlign = "center";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(text, w / 2, h / 2, Math.max(0, w - 20));
  ctx.textAlign = "left";
}

function curve(ctx: CanvasRenderingContext2D, w: number, h: number, hist: MetricsSample[], key: "maxFitness" | "meanFitness" | "shannon", floor: number, ceiling: number, color: string, fill = false): void {
  const start = hist[0]!.tick;
  const duration = Math.max(1, hist[hist.length - 1]!.tick - start);
  const points = hist.map(m => ({ x: PAD.left + (m.tick - start) / duration * (w - PAD.left - PAD.right), y: PAD.top + (1 - (m[key] - floor) / (ceiling - floor)) * (h - PAD.top - PAD.bottom) }));
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) { const p = points[i]!; if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
  ctx.strokeStyle = color; ctx.lineWidth = 1.7; ctx.lineJoin = "round"; ctx.stroke();
  const last = points[points.length - 1]!;
  if (fill) {
    const zeroY = PAD.top + ceiling / (ceiling - floor) * (h - PAD.top - PAD.bottom);
    ctx.lineTo(last.x, zeroY); ctx.lineTo(PAD.left, zeroY); ctx.closePath();
    const gradient = ctx.createLinearGradient(0, PAD.top, 0, h - PAD.bottom);
    gradient.addColorStop(0, color + "25"); gradient.addColorStop(1, color + "02"); ctx.fillStyle = gradient; ctx.fill();
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(last.x, last.y, 2.4, 0, Math.PI * 2); ctx.fill();
}

export function drawFitness(canvas: HTMLCanvasElement, w: number, h: number, hist: MetricsSample[], marks: readonly number[] = []): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return;
  if (!hist.length) { empty(ctx, w, h, "La fitness apparaîtra ici"); return; }
  const [floor, ceiling] = chartDomain(hist.flatMap(m => [m.maxFitness, m.meanFitness]));
  const start = hist[0]!.tick;
  const end = hist[hist.length - 1]!.tick;
  axes(ctx, w, h, floor, ceiling, start, end);
  const duration = Math.max(1, end - start);
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  if (marks.length) {
    ctx.save();
    ctx.strokeStyle = "#c45c6a88";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const t of marks) {
      if (t < start || t > end) continue;
      const x = PAD.left + (t - start) / duration * plotW;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + plotH);
      ctx.stroke();
    }
    ctx.restore();
  }
  curve(ctx, w, h, hist, "maxFitness", floor, ceiling, "#eac789");
  curve(ctx, w, h, hist, "meanFitness", floor, ceiling, "#a2dfbd", true);
}

export function drawShannon(canvas: HTMLCanvasElement, w: number, h: number, hist: MetricsSample[]): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return;
  if (!hist.length) { empty(ctx, w, h, "La diversité apparaîtra ici"); return; }
  const ceiling = chartCeiling(hist.map(m => m.shannon));
  axes(ctx, w, h, 0, ceiling, hist[0]!.tick, hist[hist.length - 1]!.tick);
  curve(ctx, w, h, hist, "shannon", 0, ceiling, "#bcaaea", true);
}

export interface PhylogenyHit {
  id: number;
  y: number;
  x0: number;
  x1: number;
}

/** Draws the lineage tree and returns one hit row per drawn lineage (CSS pixels) so the canvas can be clicked. */
export function drawPhylogeny(canvas: HTMLCanvasElement, w: number, h: number, lineages: Iterable<LineageNode>, tick: number, highlightId = -1): PhylogenyHit[] {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return [];
  const all = Array.from(lineages);
  const live = all.filter(n => n.count > 0).sort((a, b) => b.count - a.count).slice(0, 80);
  const dead = all.filter(n => n.count === 0 && n.extinctTick !== null && tick - n.extinctTick < 180).sort((a, b) => b.peakCount - a.peakCount).slice(0, 24);
  const nodes = live.concat(dead);
  const wanted = all.find(n => n.id === highlightId);
  if (wanted && !nodes.includes(wanted)) nodes.push(wanted);
  if (!nodes.length) { empty(ctx, w, h, "Les lignées prendront racine ici"); return []; }
  const ids = new Set(nodes.map(n => n.id));
  const children = new Map<number, LineageNode[]>();
  for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const laid: LineageNode[] = [];
  const visited = new Set<number>();
  const visit = (n: LineageNode) => { if (visited.has(n.id)) return; visited.add(n.id); laid.push(n); for (const c of children.get(n.id) ?? []) visit(c); };
  for (const n of nodes.filter(n => !ids.has(n.parentId)).sort((a, b) => a.bornTick - b.bornTick)) visit(n);
  for (const n of nodes) visit(n);
  const rows = new Map(laid.map((n, i) => [n.id, 9 + (i + .5) / laid.length * (h - 34)]));
  const x = (t: number) => 7 + t / Math.max(1, tick) * (w - 18);
  const hits: PhylogenyHit[] = [];
  for (const n of laid) {
    const y = rows.get(n.id)!;
    const parentY = rows.get(n.parentId);
    const hi = n.id === highlightId;
    if (parentY !== undefined) { ctx.strokeStyle = hi ? "#a2dfbd" : "#41534b"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(n.bornTick), parentY); ctx.lineTo(x(n.bornTick), y); ctx.stroke(); }
    ctx.strokeStyle = hi ? "#e6f1e9" : `hsla(${n.hue * 360}, ${n.count ? 48 : 20}%, 68%, ${n.count ? 1 : .4})`;
    ctx.lineWidth = hi ? 4 : Math.min(3, 1 + Math.log2(1 + n.peakCount) / 3);
    const x0 = x(n.bornTick);
    const x1 = Math.max(x0 + 2, x(n.extinctTick ?? tick));
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    if (hi) { ctx.fillStyle = "#e6f1e9"; ctx.beginPath(); ctx.arc(x0, y, 3, 0, Math.PI * 2); ctx.fill(); }
    hits.push({ id: n.id, y, x0, x1 });
  }
  ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.fillText("0", 7, h - 6);
  ctx.textAlign = "right"; ctx.fillText(`${tick} pas`, w - 9, h - 6); ctx.textAlign = "left";
  return hits;
}

/** Nearest drawn lineage to a point (CSS pixels), within `tolerance` px vertically. */
export function phylogenyHitAt(hits: readonly PhylogenyHit[], px: number, py: number, tolerance = 6): PhylogenyHit | null {
  let best: PhylogenyHit | null = null;
  let bestD = tolerance + 0.01;
  for (const h of hits) {
    const dy = Math.abs(h.y - py);
    const dx = px < h.x0 ? h.x0 - px : px > h.x1 ? px - h.x1 : 0;
    const d = Math.max(dy, dx * 0.5);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

export interface GroupSeries {
  key: string;
  label: string;
  color: string;
}

/** One line per group: living count over time, read from `hist[i][field][key]`. */
export function drawGroupSeries(canvas: HTMLCanvasElement, w: number, h: number, hist: MetricsSample[], groups: GroupSeries[], field: "strains" | "strategies"): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return;
  const rows = hist.filter(m => m[field]);
  if (!rows.length || !groups.length) { empty(ctx, w, h, "Les effectifs par groupe apparaîtront ici"); return; }
  let max = 0;
  for (const m of rows) for (const g of groups) max = Math.max(max, m[field]![g.key] ?? 0);
  const ceiling = chartCeiling([max]);
  const start = rows[0]!.tick;
  const end = rows[rows.length - 1]!.tick;
  axes(ctx, w, h, 0, ceiling, start, end);
  const duration = Math.max(1, end - start);
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  for (const g of groups) {
    ctx.beginPath();
    let started = false;
    let lastX = 0; let lastY = 0;
    for (const m of rows) {
      const v = m[field]![g.key] ?? 0;
      const x = PAD.left + (m.tick - start) / duration * plotW;
      const y = PAD.top + (1 - v / ceiling) * plotH;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      lastX = x; lastY = y;
    }
    ctx.strokeStyle = g.color; ctx.lineWidth = 1.7; ctx.lineJoin = "round"; ctx.stroke();
    ctx.fillStyle = g.color; ctx.beginPath(); ctx.arc(lastX, lastY, 2.4, 0, Math.PI * 2); ctx.fill();
  }
}

export interface TrialRun {
  series: Array<[number, number]>;
  reached: boolean;
}

/** One line per replicate (teal when the goal was reached, grey otherwise) plus a dashed target line. */
export function drawTrialSeries(canvas: HTMLCanvasElement, w: number, h: number, runs: TrialRun[], target: number | null): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return;
  if (!runs.length) { empty(ctx, w, h, "Lancez des réplicats pour tracer la mesure"); return; }
  const values = runs.flatMap(r => r.series.map(p => p[1]));
  if (target !== null) values.push(target);
  const [floor, ceiling] = chartDomain(values);
  const start = Math.min(...runs.map(r => r.series[0]?.[0] ?? 0));
  const end = Math.max(...runs.map(r => r.series[r.series.length - 1]?.[0] ?? 0), start + 1);
  axes(ctx, w, h, floor, ceiling, start, end);
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const X = (t: number) => PAD.left + (t - start) / Math.max(1, end - start) * plotW;
  const Y = (v: number) => PAD.top + (1 - (v - floor) / Math.max(1e-9, ceiling - floor)) * plotH;
  if (target !== null) {
    ctx.strokeStyle = "#eac789"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, Y(target)); ctx.lineTo(PAD.left + plotW, Y(target)); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const r of runs) {
    ctx.beginPath();
    r.series.forEach(([t, v], i) => { if (i === 0) ctx.moveTo(X(t), Y(v)); else ctx.lineTo(X(t), Y(v)); });
    ctx.strokeStyle = r.reached ? "#a2dfbdcc" : "#91a2a788"; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.stroke();
  }
}

export interface SweepChartPoint {
  value: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface TrackSeries {
  key: string;
  color: string;
  points: Array<{ tick: number; value: number }>;
}

export interface StrainMapSeries {
  color: string;
  points: Array<{ cx: number; cy: number }>;
}

export interface StrainMapVent {
  x: number;
  y: number;
  kind: "nutrient" | "toxin" | "thermal";
}

const VENT_FILL: Record<StrainMapVent["kind"], string> = {
  nutrient: "#a2dfbd",
  toxin: "#ed809d",
  thermal: "#df9d6b",
};

/** World-aspect map of strain centroids. Paths fade old → new; a disc marks the current centre; diamonds mark vents. */
export function drawStrainMap(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  worldW: number,
  worldH: number,
  series: StrainMapSeries[],
  vents: StrainMapVent[],
): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0 || h <= 0) return;
  const pad = 8;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  if (innerW <= 0 || innerH <= 0) return;
  const aspect = worldW / Math.max(1, worldH);
  let plotW = innerW;
  let plotH = innerH;
  if (plotW / plotH > aspect) plotW = plotH * aspect;
  else plotH = plotW / aspect;
  const ox = pad + (innerW - plotW) / 2;
  const oy = pad + (innerH - plotH) / 2;
  const X = (x: number) => ox + (x / Math.max(1, worldW - 1)) * plotW;
  const Y = (y: number) => oy + (y / Math.max(1, worldH - 1)) * plotH;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, plotW, plotH);
  for (const v of vents) {
    const x = X(v.x);
    const y = Y(v.y);
    ctx.fillStyle = VENT_FILL[v.kind];
    ctx.beginPath();
    ctx.moveTo(x, y - 3.2);
    ctx.lineTo(x + 3.2, y);
    ctx.lineTo(x, y + 3.2);
    ctx.lineTo(x - 3.2, y);
    ctx.closePath();
    ctx.fill();
  }
  if (!series.some((s) => s.points.length)) {
    empty(ctx, w, h, "Les trajectoires de souche apparaîtront ici");
    return;
  }
  for (const s of series) {
    const pts = s.points;
    if (!pts.length) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = i / (pts.length - 1);
      ctx.globalAlpha = 0.18 + 0.82 * a;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(X(pts[i - 1]!.cx), Y(pts[i - 1]!.cy));
      ctx.lineTo(X(pts[i]!.cx), Y(pts[i]!.cy));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const last = pts[pts.length - 1]!;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(X(last.cx), Y(last.cy), 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0b1014";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** One line per series of (tick, value) samples — e.g. mean local temperature per strain. */
export function drawTrackSeries(canvas: HTMLCanvasElement, w: number, h: number, series: TrackSeries[]): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) { empty(ctx, w, h, "Les trajectoires de température apparaîtront ici"); return; }
  const values = pts.map((p) => p.value);
  const [floor, ceiling] = chartDomain(values);
  const start = Math.min(...pts.map((p) => p.tick));
  const end = Math.max(...pts.map((p) => p.tick), start + 1);
  axes(ctx, w, h, floor, ceiling, start, end);
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const X = (t: number) => PAD.left + ((t - start) / Math.max(1, end - start)) * plotW;
  const Y = (v: number) => PAD.top + (1 - (v - floor) / Math.max(1e-9, ceiling - floor)) * plotH;
  for (const s of series) {
    if (!s.points.length) continue;
    ctx.beginPath();
    s.points.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.tick), Y(p.value)); else ctx.lineTo(X(p.tick), Y(p.value)); });
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.7; ctx.lineJoin = "round"; ctx.stroke();
    const last = s.points[s.points.length - 1]!;
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X(last.tick), Y(last.value), 2.4, 0, Math.PI * 2); ctx.fill();
  }
}

/** Median ticks-to-goal vs sweep value, with a min–max band. */
export function drawSweep(canvas: HTMLCanvasElement, w: number, h: number, points: SweepChartPoint[]): void {
  const ctx = prepare(canvas, w, h);
  if (w <= 0) return;
  const usable = points.filter((p) => p.median !== null && p.min !== null && p.max !== null);
  if (!usable.length) { empty(ctx, w, h, "Lancez un balayage pour tracer le délai"); return; }
  const xs = points.map((p) => p.value);
  const ys = usable.flatMap((p) => [p.min!, p.max!, p.median!]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const [floor, ceiling] = chartDomain(ys);
  axes(ctx, w, h, floor, ceiling, 0, 0);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText(format(x0), PAD.left, h - 6);
  ctx.textAlign = "right";
  ctx.fillText(format(x1), w - PAD.right, h - 6);
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const span = Math.max(1e-9, x1 - x0);
  const X = (v: number) => PAD.left + ((v - x0) / span) * plotW;
  const Y = (v: number) => PAD.top + (1 - (v - floor) / Math.max(1e-9, ceiling - floor)) * plotH;
  ctx.beginPath();
  usable.forEach((p, i) => { const x = X(p.value); if (i === 0) ctx.moveTo(x, Y(p.max!)); else ctx.lineTo(x, Y(p.max!)); });
  for (let i = usable.length - 1; i >= 0; i--) ctx.lineTo(X(usable[i]!.value), Y(usable[i]!.min!));
  ctx.closePath();
  ctx.fillStyle = "#a2dfbd33";
  ctx.fill();
  ctx.beginPath();
  usable.forEach((p, i) => { const x = X(p.value); if (i === 0) ctx.moveTo(x, Y(p.median!)); else ctx.lineTo(x, Y(p.median!)); });
  ctx.strokeStyle = "#a2dfbd"; ctx.lineWidth = 1.7; ctx.lineJoin = "round"; ctx.stroke();
  for (const p of usable) {
    ctx.fillStyle = "#a2dfbd";
    ctx.beginPath(); ctx.arc(X(p.value), Y(p.median!), 2.4, 0, Math.PI * 2); ctx.fill();
  }
}
