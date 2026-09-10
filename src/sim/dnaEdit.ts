/**
 * Pure editing model for the visual DNA editor.
 *
 * The sequence is the single source of truth: every operation returns a new
 * sanitized sequence, and the UI re-annotates it. Nothing here touches the DOM.
 */
import { decodeGenome, geneCassette, sanitizeSequence, type DecodedGenome } from "./genome";
import {
  CODON_INDEX,
  CODON_LEN,
  MAX_GENOME,
  MIN_GENOME,
  REG_MAX,
  START_CODON,
  TRAIT_COLOR,
  TRAIT_NAMES,
  codonsForTrait,
  isStopCodon,
  type Phenotype,
  type TraitName,
} from "./mapping";
import type { Gene } from "./types";

export type CodonRole = "start" | "coding" | "stop" | "junk" | "open" | "reg";

export interface CodonCell {
  /** Index of the first base of this cell in the sequence. */
  start: number;
  /** 1–3 bases. Junk runs are chunked by three for display. */
  bases: string;
  role: CodonRole;
  /** Index into `annotation.decoded.genes`, or -1. */
  gene: number;
  aa: string;
  trait: TraitName | null;
  delta: number;
  /** Rail color for the gene this cell belongs to ("" for junk). */
  color: string;
}

export interface DnaAnnotation {
  decoded: DecodedGenome;
  cells: CodonCell[];
  /** Start of an unclosed ORF that the decoder ignores, or -1. */
  openFrom: number;
}

export interface DnaIssue {
  level: "info" | "warn";
  text: string;
}

export interface SeqHunk {
  /** Inclusive start in `b`. */
  a: number;
  /** Exclusive end in `b`. Empty (`a === b`) for a pure deletion. */
  b: number;
  kind: "sub" | "ins" | "del";
}

/**
 * Ranges in `b` that differ from `a`. Uses a single common-prefix / common-suffix
 * hunk: internal matches inside the changed region are not split (a middle
 * duplication therefore shows as one `sub` or `ins`, not two).
 */
export interface Alignment {
  a: string;
  b: string;
  matches: number;
  mismatches: number;
  gaps: number;
  score: number;
}

const ALIGN_MATCH = 1;
const ALIGN_MISMATCH = -1;
const ALIGN_GAP = -1;
export const ALIGN_BAND = 48;
const ALIGN_NEG = -1_000_000;

/**
 * Banded Needleman–Wunsch (match +1, mismatch −1, gap −1, band 48).
 * The band is widened to |n − m| when the lengths differ by more than 48
 * so a global alignment always exists.
 */
export function alignSequences(seqA: string, seqB: string, band = ALIGN_BAND): Alignment {
  const a = seqA;
  const b = seqB;
  const n = a.length;
  const m = b.length;
  const W = Math.max(1, band, Math.abs(n - m));
  const cols = m + 1;
  const S = new Int32Array((n + 1) * cols);
  const P = new Uint8Array((n + 1) * cols);
  const at = (i: number, j: number) => i * cols + j;
  S.fill(ALIGN_NEG);
  S[0] = 0;
  for (let i = 1; i <= n && i <= W; i++) {
    S[at(i, 0)] = i * ALIGN_GAP;
    P[at(i, 0)] = 1;
  }
  for (let j = 1; j <= m && j <= W; j++) {
    S[at(0, j)] = j * ALIGN_GAP;
    P[at(0, j)] = 2;
  }
  for (let i = 1; i <= n; i++) {
    const j0 = Math.max(1, i - W);
    const j1 = Math.min(m, i + W);
    for (let j = j0; j <= j1; j++) {
      const diag = S[at(i - 1, j - 1)]! + (a[i - 1] === b[j - 1] ? ALIGN_MATCH : ALIGN_MISMATCH);
      const up = S[at(i - 1, j)]! + ALIGN_GAP;
      const left = S[at(i, j - 1)]! + ALIGN_GAP;
      let best = diag;
      let ptr = 0;
      if (up > best) {
        best = up;
        ptr = 1;
      }
      if (left > best) {
        best = left;
        ptr = 2;
      }
      S[at(i, j)] = best;
      P[at(i, j)] = ptr;
    }
  }
  let i = n;
  let j = m;
  let ra = "";
  let rb = "";
  while (i > 0 || j > 0) {
    const ptr = P[at(i, j)]!;
    if (i > 0 && j > 0 && ptr === 0) {
      ra = a[i - 1] + ra;
      rb = b[j - 1] + rb;
      i--;
      j--;
    } else if (i > 0 && (j === 0 || ptr === 1)) {
      ra = a[i - 1] + ra;
      rb = "-" + rb;
      i--;
    } else if (j > 0) {
      ra = "-" + ra;
      rb = b[j - 1] + rb;
      j--;
    } else break;
  }
  let matches = 0;
  let mismatches = 0;
  let gaps = 0;
  for (let k = 0; k < ra.length; k++) {
    const ca = ra[k]!;
    const cb = rb[k]!;
    if (ca === "-" || cb === "-") gaps++;
    else if (ca === cb) matches++;
    else mismatches++;
  }
  return { a: ra, b: rb, matches, mismatches, gaps, score: S[at(n, m)]! };
}

export function sequenceDiff(a: string, b: string): SeqHunk[] {
  if (a === b) return [];
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  let ja = a.length;
  let jb = b.length;
  while (ja > i && jb > i && a[ja - 1] === b[jb - 1]) {
    ja--;
    jb--;
  }
  const aLen = ja - i;
  const bLen = jb - i;
  if (aLen === 0 && bLen === 0) return [];
  if (aLen === 0) return [{ a: i, b: jb, kind: "ins" }];
  if (bLen === 0) return [{ a: i, b: i, kind: "del" }];
  return [{ a: i, b: jb, kind: "sub" }];
}

/** Mirror decodeGenome's scan after the last closed gene to find a dangling ATG. */
export function findOpenOrf(seq: string, from = 0): number {
  let i = from;
  while (i + CODON_LEN <= seq.length) {
    if (seq.slice(i, i + CODON_LEN) === START_CODON) {
      let k = i + CODON_LEN;
      let closed = false;
      while (k + CODON_LEN <= seq.length) {
        const codon = seq.slice(k, k + CODON_LEN);
        k += CODON_LEN;
        if (isStopCodon(codon)) {
          closed = true;
          break;
        }
      }
      if (!closed) return i;
      i = k;
    } else {
      i += 1;
    }
  }
  return -1;
}

export function annotateSequence(sequence: string): DnaAnnotation {
  const decoded = decodeGenome(sequence);
  const seq = decoded.sequence;
  const cells: CodonCell[] = [];
  const junk = (a: number, b: number) => {
    for (let i = a; i < b; i += CODON_LEN) {
      cells.push({
        start: i,
        bases: seq.slice(i, Math.min(b, i + CODON_LEN)),
        role: "junk",
        gene: -1,
        aa: "",
        trait: null,
        delta: 0,
        color: "",
      });
    }
  };
  let cursor = 0;
  decoded.genes.forEach((g, gi) => {
    const color = TRAIT_COLOR[g.dominant as TraitName] ?? "#8aa0b5";
    const reg = decoded.regulation[gi];
    const regFrom = reg ? Math.max(cursor, reg.from) : g.start;
    junk(cursor, regFrom);
    if (reg) {
      for (let i = regFrom; i < g.start; i += CODON_LEN) {
        const codon = seq.slice(i, Math.min(g.start, i + CODON_LEN));
        const rule = codon.length === CODON_LEN ? CODON_INDEX[codon] : undefined;
        cells.push({
          start: i,
          bases: codon,
          role: "reg",
          gene: gi,
          aa: "",
          trait: rule?.trait ?? null,
          delta: 0,
          color,
        });
      }
    }
    cells.push({ start: g.start, bases: seq.slice(g.start, g.start + CODON_LEN), role: "start", gene: gi, aa: "M", trait: null, delta: 0, color });
    for (let k = g.start + CODON_LEN; k < g.stop; k += CODON_LEN) {
      const codon = seq.slice(k, k + CODON_LEN);
      const rule = CODON_INDEX[codon];
      cells.push({ start: k, bases: codon, role: "coding", gene: gi, aa: rule?.aa ?? "", trait: rule?.trait ?? null, delta: rule?.delta ?? 0, color });
    }
    cells.push({ start: g.stop, bases: seq.slice(g.stop, g.end), role: "stop", gene: gi, aa: "", trait: null, delta: 0, color });
    cursor = g.end;
  });
  const openFrom = findOpenOrf(seq, cursor);
  if (openFrom >= 0) {
    junk(cursor, openFrom);
    for (let k = openFrom; k < seq.length; k += CODON_LEN) {
      const codon = seq.slice(k, k + CODON_LEN);
      const rule = codon.length === CODON_LEN ? CODON_INDEX[codon] : undefined;
      cells.push({ start: k, bases: codon, role: "open", gene: -1, aa: k === openFrom ? "M" : rule?.aa ?? "", trait: rule?.trait ?? null, delta: rule?.delta ?? 0, color: "" });
    }
  } else {
    junk(cursor, seq.length);
  }
  return { decoded, cells, openFrom };
}

export function validateSequence(annotation: DnaAnnotation): DnaIssue[] {
  const { decoded, openFrom } = annotation;
  const out: DnaIssue[] = [];
  const n = decoded.sequence.length;
  if (n === 0) out.push({ level: "info", text: "Génome vide : ajoutez un gène ou choisissez un kit." });
  else if (n < MIN_GENOME) out.push({ level: "warn", text: `Génome très court (${n} bases). Les organismes viables ont au moins ${MIN_GENOME} bases.` });
  if (n >= MAX_GENOME) out.push({ level: "warn", text: `Taille maximale atteinte (${MAX_GENOME} bases). Les insertions sont tronquées.` });
  if (openFrom >= 0) out.push({ level: "warn", text: `Gène non terminé à partir de la base ${openFrom} : ajoutez TAA, TAG ou TGA. Cette partie est ignorée.` });
  for (const r of decoded.regulation) {
    if (r.multiplier >= REG_MAX - 1e-9) {
      out.push({ level: "info", text: `Gène ${r.geneIndex + 1} à expression maximale (×${r.multiplier.toFixed(2)}) : les codons amont supplémentaires n’ajoutent rien.` });
    }
  }
  if (n > 0 && decoded.genes.length === 0 && openFrom < 0) out.push({ level: "info", text: "Aucun gène lisible : le phénotype reste basal." });
  return out;
}

/* ---------- range operations ---------- */

export function replaceRange(seq: string, a: number, b: number, text: string): string {
  const lo = Math.max(0, Math.min(a, b, seq.length));
  const hi = Math.max(lo, Math.min(Math.max(a, b), seq.length));
  return sanitizeSequence(seq.slice(0, lo) + text + seq.slice(hi));
}

export function setBase(seq: string, i: number, base: string): string {
  if (i < 0 || i >= seq.length) return seq;
  return replaceRange(seq, i, i + 1, base);
}

export function insertAt(seq: string, i: number, text: string): string {
  return replaceRange(seq, i, i, text);
}

export function deleteRange(seq: string, a: number, b: number): string {
  return replaceRange(seq, a, b, "");
}

export function duplicateRange(seq: string, a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return insertAt(seq, hi, seq.slice(lo, hi));
}

/* ---------- gene-level operations ---------- */

export function geneStrength(gene: Gene): number {
  return gene.translation.length;
}

function dominantCodon(gene: Gene): string {
  const list = codonsForTrait(gene.dominant as TraitName);
  return list[0] ?? "GAA";
}

/** Add (+1) or remove (−1) one codon of the gene's dominant trait, before its stop. */
export function bumpGene(seq: string, gene: Gene, dir: 1 | -1): string {
  if (dir > 0) return insertAt(seq, gene.stop, dominantCodon(gene));
  if (geneStrength(gene) <= 1) return seq;
  let victim = -1;
  for (let k = gene.stop - CODON_LEN; k >= gene.start + CODON_LEN; k -= CODON_LEN) {
    const rule = CODON_INDEX[seq.slice(k, k + CODON_LEN)];
    if (rule) {
      if (victim < 0) victim = k;
      if (rule.trait === gene.dominant) {
        victim = k;
        break;
      }
    }
  }
  return victim < 0 ? seq : deleteRange(seq, victim, victim + CODON_LEN);
}

/** Set the gene's codon count exactly by bumping repeatedly on a re-decoded sequence. */
export function setGeneStrength(seq: string, geneIndex: number, strength: number): string {
  let out = seq;
  const target = Math.max(1, Math.min(64, Math.round(strength)));
  for (let guard = 0; guard < 80; guard++) {
    const gene = decodeGenome(out).genes[geneIndex];
    if (!gene) return out;
    const cur = geneStrength(gene);
    if (cur === target) return out;
    const next = bumpGene(out, gene, cur < target ? 1 : -1);
    if (next === out) return out;
    out = next;
  }
  return out;
}

export function removeGene(seq: string, gene: Gene): string {
  return deleteRange(seq, gene.start, gene.end);
}

export function moveGene(seq: string, genes: readonly Gene[], index: number, dir: -1 | 1): string {
  const j = index + dir;
  if (index < 0 || index >= genes.length || j < 0 || j >= genes.length) return seq;
  const first = genes[Math.min(index, j)]!;
  const second = genes[Math.max(index, j)]!;
  const between = seq.slice(first.end, second.start);
  const a = seq.slice(first.start, first.end);
  const b = seq.slice(second.start, second.end);
  return sanitizeSequence(seq.slice(0, first.start) + b + between + a + seq.slice(second.end));
}

/** Append a full cassette. Returns the input unchanged when it would not fit. */
export function appendGene(seq: string, trait: TraitName, strength = 3): string {
  const cassette = geneCassette(trait, Math.max(1, Math.min(64, Math.round(strength))));
  const spacer = seq.length ? "CC" : "";
  if (seq.length + spacer.length + cassette.length > MAX_GENOME) return seq;
  return sanitizeSequence(seq + spacer + cassette);
}

/** Insert a full cassette at a base index (used by the strip palette). */
export function insertGeneAt(seq: string, i: number, trait: TraitName, strength = 3): string {
  const cassette = geneCassette(trait, Math.max(1, Math.min(64, Math.round(strength))));
  if (seq.length + cassette.length > MAX_GENOME) return seq;
  return insertAt(seq, i, cassette);
}

/* ---------- phenotype comparison ---------- */

export function phenotypeDelta(next: Phenotype, ref: Phenotype): Record<TraitName, number> {
  const out = {} as Record<TraitName, number>;
  for (const t of TRAIT_NAMES) out[t] = next[t] - ref[t];
  return out;
}

/* ---------- undo / redo ---------- */

export class EditHistory {
  private past: string[] = [];
  private future: string[] = [];
  present: string;
  readonly cap: number;

  constructor(initial = "", cap = 120) {
    this.present = sanitizeSequence(initial);
    this.cap = cap;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record a new state. Returns false (and records nothing) when unchanged. */
  push(next: string): boolean {
    const clean = sanitizeSequence(next);
    if (clean === this.present) return false;
    this.past.push(this.present);
    if (this.past.length > this.cap) this.past.shift();
    this.present = clean;
    this.future = [];
    return true;
  }

  /** Replace the present state without touching the undo stack (drag coalescing). */
  amend(next: string): void {
    this.present = sanitizeSequence(next);
    this.future = [];
  }

  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  reset(seq: string): void {
    this.present = sanitizeSequence(seq);
    this.past = [];
    this.future = [];
  }
}
