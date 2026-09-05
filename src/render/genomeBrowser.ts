import { BASE_COLOR, TRAIT_COLOR, type TraitName } from "../sim/mapping";
import { decodeGenome, toGenomeTrack, type GenomeTrack } from "../sim/genome";
import type { Phenotype } from "../sim/mapping";

export class GenomeBrowser {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  track: GenomeTrack | null = null;
  hoverBase = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas required");
    this.ctx = ctx;
  }

  setSequence(seq: string): void {
    this.track = toGenomeTrack(decodeGenome(seq));
    this.draw();
  }

  clear(): void {
    this.track = null;
    const { canvas, ctx } = this;
    ctx.fillStyle = "#070b10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.draw();
  }

  draw(): void {
    const { ctx, canvas, track } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#070b10";
    ctx.fillRect(0, 0, w, h);
    if (!track || track.sequence.length === 0) {
      ctx.fillStyle = "#5a6a78";
      ctx.font = `${12 * (window.devicePixelRatio || 1)}px ui-monospace, monospace`;
      ctx.fillText("No genome selected — click an organism", 12, h * 0.5);
      return;
    }
    const seq = track.sequence;
    const pad = 8;
    const geneH = Math.max(18, h * 0.28);
    const seqY = pad + geneH + 10;
    const seqH = h - seqY - pad;
    const n = seq.length;
    const bw = (w - pad * 2) / n;

    for (const g of track.genes) {
      const x = pad + g.start * bw;
      const gw = Math.max(2, (g.end - g.start) * bw);
      ctx.fillStyle = g.color + "cc";
      ctx.fillRect(x, pad, gw, geneH);
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, pad + 0.5, gw - 1, geneH - 1);
      ctx.fillStyle = "#081018";
      ctx.font = `600 ${Math.max(9, Math.min(13, gw / Math.max(1, g.name.length))) * (canvas.width / (this.canvas.clientWidth || canvas.width))}px ui-monospace, SFMono-Regular, monospace`;
      ctx.textBaseline = "middle";
      if (gw > 28) ctx.fillText(g.name, x + 4, pad + geneH / 2, gw - 8);
    }

    for (let i = 0; i < n; i++) {
      const b = seq[i] as "A" | "C" | "G" | "T";
      ctx.fillStyle = BASE_COLOR[b] ?? "#888";
      const x = pad + i * bw;
      ctx.globalAlpha = this.hoverBase === i ? 1 : 0.92;
      ctx.fillRect(x, seqY, Math.max(1, bw - 0.4), seqH);
    }
    ctx.globalAlpha = 1;

    if (bw > 8) {
      ctx.fillStyle = "#081018";
      ctx.font = `${Math.min(11, bw * 0.8)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < n; i++) {
        ctx.fillText(seq[i]!, pad + i * bw + bw / 2, seqY + seqH / 2);
      }
      ctx.textAlign = "left";
    }
  }
}

export function phenotypeTableHtml(ph: Phenotype): string {
  const rows = (Object.keys(ph) as (keyof Phenotype)[]).map((k) => {
    const color = TRAIT_COLOR[k as TraitName] ?? "#8aa0b5";
    const v = ph[k];
    const shown = typeof v === "number" ? v.toFixed(3) : String(v);
    const pct = k === "signal" ? (v / 7) * 100 : Math.max(0, Math.min(100, v * 50));
    return `<tr>
      <td class="trait-name"><span class="swatch" style="background:${color}"></span>${k}</td>
      <td class="trait-val">${shown}</td>
      <td class="trait-bar"><i style="width:${pct}%;background:${color}"></i></td>
    </tr>`;
  });
  return `<table class="pheno">${rows.join("")}</table>`;
}

export function genesHtml(track: GenomeTrack): string {
  if (track.genes.length === 0) return `<p class="muted">No ORFs (ATG…stop) in this sequence.</p>`;
  return track.genes
    .map((g) => {
      const bits = Object.entries(g.contrib)
        .filter(([, v]) => v !== 0)
        .map(([t, v]) => `${t} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`)
        .join(" · ");
      return `<div class="gene-row">
        <span class="swatch" style="background:${g.color}"></span>
        <strong>${g.name}</strong>
        <span class="muted">${g.start}–${g.end}</span>
        <span class="aa">${g.translation}</span>
        <div class="muted">${bits}</div>
      </div>`;
    })
    .join("");
}
