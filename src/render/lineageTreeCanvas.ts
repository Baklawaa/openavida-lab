/**
 * Interactive drawing of a `TreeLayout`: pan, zoom, hover, click, double
 * click to refocus. Time runs left → right; every lineage is a bar; children
 * hang from their parent at their birth tick. The root → focus path is the
 * bright trunk; the biggest phenotype change of each lineage is written at
 * its birth when there is room.
 */
import { tDynamic } from "../ui/i18n/runtime";
import type { TreeLayout, TreeNode } from "./lineageTreeLayout";

export interface TreeViewOptions {
  onSelect(id: number): void;
  onFocus(id: number): void;
  strainColor(strainId: number): string;
  strainName(strainId: number): string;
  changeLabel(node: TreeNode): string;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

const PAD = { left: 24, right: 90, top: 22, bottom: 30 };
const ROW_PX = 26;
const MIN_ROW_PX_FOR_LABELS = 13;

export class LineageTreeView {
  readonly canvas: HTMLCanvasElement;
  private readonly tip: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: TreeViewOptions;
  private layout: TreeLayout | null = null;
  private now = 0;
  private view: View = { scale: 1, tx: 0, ty: 0 };
  private sx = 1;
  private cssW = 1;
  private cssH = 1;
  private hover = -1;
  private selected = -1;
  private drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private frame = 0;

  constructor(canvas: HTMLCanvasElement, tip: HTMLElement, opts: TreeViewOptions) {
    this.canvas = canvas;
    this.tip = tip;
    this.opts = opts;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas required");
    this.ctx = ctx;
    this.bind();
  }

  setLayout(layout: TreeLayout, now: number): void {
    this.layout = layout;
    this.now = now;
    this.hover = -1;
    this.selected = layout.focusId;
    this.canvas.dataset.nodes = String(layout.nodes.length);
    this.fit();
  }

  setSelected(id: number): void {
    this.selected = id;
    this.schedule();
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fit();
  }

  /** Fit the whole layout into the canvas (rows capped so a dense tree is still one screen). */
  fit(): void {
    const l = this.layout;
    if (!l) {
      this.schedule();
      return;
    }
    const plotW = Math.max(40, this.cssW - PAD.left - PAD.right);
    const plotH = Math.max(40, this.cssH - PAD.top - PAD.bottom);
    this.sx = plotW / Math.max(1, l.tMax - l.tMin);
    const rowsPx = Math.max(1, l.rows) * ROW_PX;
    const scale = Math.min(1, plotH / rowsPx);
    this.view = { scale, tx: PAD.left, ty: PAD.top + Math.max(0, (plotH - rowsPx * scale) / 2) };
    this.schedule();
  }

  /** Zoom so the rows around the focus are readable (labels on), keeping the focus centred. */
  focusZoom(): void {
    const l = this.layout;
    if (!l) return;
    const f = l.byId.get(l.focusId);
    if (!f) return;
    const scale = Math.max(this.view.scale, MIN_ROW_PX_FOR_LABELS / ROW_PX * 1.4);
    this.view.scale = Math.min(scale, 6);
    this.centerOn(f.t0, f.row);
  }

  private centerOn(t: number, row: number): void {
    const l = this.layout!;
    const x = (t - l.tMin) * this.sx * this.view.scale;
    const y = row * ROW_PX * this.view.scale;
    this.view.tx = this.cssW / 2 - x;
    this.view.ty = this.cssH / 2 - y;
    this.schedule();
  }

  private X(t: number): number {
    return (t - (this.layout?.tMin ?? 0)) * this.sx * this.view.scale + this.view.tx;
  }

  private Y(row: number): number {
    return row * ROW_PX * this.view.scale + this.view.ty;
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw(): void {
    const { ctx, cssW: W, cssH: H } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#070b10";
    ctx.fillRect(0, 0, W, H);
    const l = this.layout;
    if (!l || !l.nodes.length) {
      ctx.fillStyle = "#91a2a7";
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(tDynamic("render.tree.empty"), W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }
    const rowPx = ROW_PX * this.view.scale;
    const labels = rowPx >= MIN_ROW_PX_FOR_LABELS;
    this.drawAxis(l);

    // Edges first (elbow from the parent's bar down/up to the child's row at the child's birth).
    for (const n of l.nodes) {
      if (n.parentId < 0) continue;
      const p = l.byId.get(n.parentId);
      if (!p) continue;
      const x = this.X(n.t0);
      const y0 = this.Y(p.row);
      const y1 = this.Y(n.row);
      const trunk = n.onPath && p.onPath;
      ctx.strokeStyle = trunk ? "#a2dfbd" : n.extinct ? "#2b3a40" : "#3c4f56";
      ctx.lineWidth = trunk ? 2.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }

    // Bars.
    const sortedForLabels = l.nodes.slice().sort((a, b) => b.peak - a.peak).slice(0, 12);
    const labelSet = new Set(sortedForLabels.map((n) => n.id));
    for (const n of l.nodes) {
      const x0 = this.X(n.t0);
      const x1 = Math.max(x0 + 3, this.X(n.t1));
      const y = this.Y(n.row);
      if (y < -20 || y > H + 20 || x1 < -20 || x0 > W + 20) continue;
      const color = this.opts.strainColor(n.strainId);
      const hovered = n.id === this.hover;
      const selected = n.id === this.selected;
      const width = Math.min(9, 1.5 + Math.log2(1 + n.peak) * 1.1) * Math.max(0.6, Math.min(1, this.view.scale * 1.2));
      ctx.lineCap = "round";
      if (n.onPath) {
        ctx.strokeStyle = "#e6f1e9";
        ctx.lineWidth = width + 3;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
      ctx.globalAlpha = n.extinct ? 0.5 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Birth dot; a change badge when the lineage opened with a phenotype change.
      const r = Math.max(2.5, width * 0.75);
      ctx.fillStyle = n.change ? "#eac789" : color;
      ctx.beginPath();
      ctx.arc(x0, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (n.isFocus || selected || hovered) {
        ctx.strokeStyle = n.isFocus ? "#ffffff" : "#a2dfbd";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x0, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (n.hiddenDescendants > 0) {
        ctx.fillStyle = "#91a2a7";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(`+${n.hiddenDescendants}`, x1 + 5, y + 3);
      }
      const showLabel = labels || n.onPath || hovered || selected || labelSet.has(n.id);
      if (showLabel) {
        const text = `n° ${n.id}${n.count ? ` · ${n.count}` : ""}`;
        ctx.font = `${n.onPath ? "600 " : ""}10px ui-monospace, SFMono-Regular, monospace`;
        ctx.fillStyle = n.onPath ? "#e6f1e9" : n.extinct ? "#6f8288" : "#b9c9c1";
        ctx.fillText(text, x1 + 6, y + 3.5);
        if (n.change && (n.onPath || hovered || rowPx >= 18)) {
          const lab = this.opts.changeLabel(n);
          ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.fillStyle = "#eac789";
          ctx.fillText(lab, x0 + r + 6, y - r - 3);
        }
      }
    }
  }

  private drawAxis(l: TreeLayout): void {
    const { ctx, cssW: W, cssH: H } = this;
    const span = l.tMax - l.tMin;
    const pxPerTick = this.sx * this.view.scale;
    const target = 90 / pxPerTick;
    const pow = 10 ** Math.floor(Math.log10(Math.max(1, target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target) ?? pow * 10;
    ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    for (let t = Math.ceil(l.tMin / step) * step; t <= l.tMin + span + step; t += step) {
      const x = this.X(t);
      if (x < 0 || x > W) continue;
      ctx.strokeStyle = "#16222a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - PAD.bottom + 6);
      ctx.stroke();
      ctx.fillStyle = "#6f8288";
      ctx.fillText(`${t}`, x, H - 10);
    }
    const xNow = this.X(this.now);
    if (xNow >= 0 && xNow <= W) {
      ctx.strokeStyle = "#a2dfbd55";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(xNow, 0);
      ctx.lineTo(xNow, H - PAD.bottom + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#a2dfbd";
      ctx.fillText(tDynamic("render.tree.now"), xNow, 10);
    }
    ctx.textAlign = "left";
  }

  /* ---------- hit testing & interaction ---------- */

  hitAt(px: number, py: number): TreeNode | null {
    const l = this.layout;
    if (!l) return null;
    let best: TreeNode | null = null;
    let bestD = 9;
    for (const n of l.nodes) {
      const y = this.Y(n.row);
      const dy = Math.abs(y - py);
      if (dy > bestD) continue;
      const x0 = this.X(n.t0);
      const x1 = Math.max(x0 + 3, this.X(n.t1));
      const dx = px < x0 - 6 ? x0 - 6 - px : px > x1 + 40 ? px - x1 - 40 : 0;
      const d = Math.max(dy, dx);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (ev) => {
      c.setPointerCapture(ev.pointerId);
      this.drag = { x: ev.clientX, y: ev.clientY, tx: this.view.tx, ty: this.view.ty, moved: false };
    });
    c.addEventListener("pointermove", (ev) => {
      const rect = c.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      if (this.drag && ev.buttons) {
        const dx = ev.clientX - this.drag.x;
        const dy = ev.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        if (this.drag.moved) {
          this.view.tx = this.drag.tx + dx;
          this.view.ty = this.drag.ty + dy;
          this.tip.hidden = true;
          this.schedule();
        }
        return;
      }
      const hit = this.hitAt(px, py);
      const id = hit?.id ?? -1;
      c.style.cursor = hit ? "pointer" : "grab";
      if (id !== this.hover) {
        this.hover = id;
        this.schedule();
      }
      if (hit) this.showTip(hit, ev.clientX, ev.clientY);
      else this.tip.hidden = true;
    });
    c.addEventListener("pointerup", (ev) => {
      const drag = this.drag;
      this.drag = null;
      if (!drag || drag.moved) return;
      const rect = c.getBoundingClientRect();
      const hit = this.hitAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (hit) {
        this.selected = hit.id;
        this.schedule();
        this.opts.onSelect(hit.id);
      }
    });
    c.addEventListener("pointerleave", () => {
      this.tip.hidden = true;
      if (this.hover !== -1) {
        this.hover = -1;
        this.schedule();
      }
    });
    c.addEventListener("dblclick", (ev) => {
      const rect = c.getBoundingClientRect();
      const hit = this.hitAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (hit) this.opts.onFocus(hit.id);
    });
    c.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const rect = c.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const factor = Math.exp(-ev.deltaY * 0.0015);
        const next = Math.max(0.15, Math.min(12, this.view.scale * factor));
        const k = next / this.view.scale;
        this.view.tx = px - (px - this.view.tx) * k;
        this.view.ty = py - (py - this.view.ty) * k;
        this.view.scale = next;
        this.schedule();
      },
      { passive: false },
    );
  }

  private showTip(n: TreeNode, clientX: number, clientY: number): void {
    const state = n.count > 0
      ? tDynamic(n.count > 1 ? "render.tree.state.alive.many" : "render.tree.state.alive.one", { count: n.count })
      : n.extinct ? tDynamic("render.tree.state.extinct", { tick: n.t1 }) : tDynamic("render.tree.state.empty");
    const change = n.changes.length ? `<br>${n.changes.map((c) => `${this.opts.changeLabel({ ...n, change: c })}`).join(" · ")}` : n.parentId >= 0 || n.depth > 0 ? `<br>${tDynamic("render.tree.change.silent")}` : `<br>${tDynamic("render.tree.change.founder")}`;
    const head = tDynamic("render.tree.tip.head", { id: n.id, strain: this.opts.strainName(n.strainId) });
    const body = tDynamic("render.tree.tip.body", { from: n.t0, to: n.t1, state, peak: n.peak });
    this.tip.innerHTML = `${head}<br>${body}${change}<br><span class="tiny">${tDynamic("render.tree.tip.hint")}</span>`;
    this.tip.hidden = false;
    const x = Math.min(clientX + 14, window.innerWidth - 320);
    const y = Math.min(clientY + 14, window.innerHeight - 110);
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }
}
