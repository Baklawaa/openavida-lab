/**
 * Pairwise strain tournaments: each unordered pair is injected in equal
 * numbers into a start snapshot and scored on living share after a budget.
 *
 * Configs carry a recipe op list; any RNG they consume runs inside the trial
 * after the replicate seed is set.
 */
import { decodeGenome } from "./genome";
import type { RecipeOp } from "./recipe";
import type { WorldSnapshot } from "./types";
import type { TrialConfig, TrialResult } from "./goals";

export const TOURNAMENT_DRAW = 0.1;
export const TOURNAMENT_INJECT = 12;

export interface TournamentContestant {
  name: string;
  genome: string;
}

export interface TournamentCell {
  i: number;
  j: number;
  n: number;
  winsI: number;
  winsJ: number;
  draws: number;
  meanShareI: number;
  meanShareJ: number;
}

export interface TournamentSummary {
  nContestants: number;
  /** wins[row][col] = replicates where row beat col. Diagonal stays 0. */
  wins: number[][];
  draws: number[][];
  meanShare: number[][];
  cells: TournamentCell[];
}

function decoded(genome: string): string {
  return decodeGenome(genome).sequence;
}

export function tournamentConfigs(
  start: WorldSnapshot,
  contestants: TournamentContestant[],
  perPair: number,
  seedBase: number,
  opts: { inject?: number; maxTicks?: number; sampleEvery?: number } = {},
): TrialConfig[] {
  const n = contestants.length;
  const R = Math.max(1, Math.round(perPair));
  const inject = Math.max(1, Math.round(opts.inject ?? TOURNAMENT_INJECT));
  const maxTicks = Math.max(1, Math.round(opts.maxTicks ?? 400));
  const sampleEvery = Math.max(1, Math.round(opts.sampleEvery ?? Math.max(1, Math.round(maxTicks / 80))));
  const w = start.params.width;
  const h = start.params.height;
  const y = Math.floor(h / 2);
  const xA = Math.floor(w / 4);
  const xB = Math.floor((3 * w) / 4);
  const out: TrialConfig[] = [];
  let seed = seedBase >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = contestants[i]!;
      const b = contestants[j]!;
      const ga = decoded(a.genome);
      const gb = decoded(b.genome);
      const ops: RecipeOp[] = [
        { type: "strain", name: a.name || `Strain ${i + 1}`, genome: ga },
        { type: "strain", name: b.name || `Strain ${j + 1}`, genome: gb },
        { type: "inject", genome: ga, count: inject, x: xA, y },
        { type: "inject", genome: gb, count: inject, x: xB, y },
      ];
      for (let r = 0; r < R; r++) {
        const s = seed;
        seed = ((seed + 1) >>> 0) || 1;
        out.push({
          seed: s,
          maxTicks,
          sampleEvery,
          ops,
          pair: [i, j],
          pairGenomes: [ga, gb],
        });
      }
    }
  }
  return out;
}

export function pairOutcome(shareI: number, shareJ: number): "i" | "j" | "draw" {
  if (Math.abs(shareI - shareJ) <= TOURNAMENT_DRAW + 1e-9) return "draw";
  return shareI > shareJ ? "i" : "j";
}

export function summarizeTournament(results: readonly TrialResult[]): TournamentSummary {
  let nContestants = 0;
  for (const r of results) {
    if (!r.pair) continue;
    nContestants = Math.max(nContestants, r.pair[0] + 1, r.pair[1] + 1);
  }
  const wins = Array.from({ length: nContestants }, () => Array<number>(nContestants).fill(0));
  const draws = Array.from({ length: nContestants }, () => Array<number>(nContestants).fill(0));
  const shareSum = Array.from({ length: nContestants }, () => Array<number>(nContestants).fill(0));
  const shareN = Array.from({ length: nContestants }, () => Array<number>(nContestants).fill(0));
  const grouped = new Map<string, TrialResult[]>();
  for (const r of results) {
    if (!r.pair) continue;
    const key = `${r.pair[0]},${r.pair[1]}`;
    const list = grouped.get(key);
    if (list) list.push(r);
    else grouped.set(key, [r]);
  }
  const cells: TournamentCell[] = [];
  for (const group of grouped.values()) {
    const [i, j] = group[0]!.pair!;
    let winsI = 0;
    let winsJ = 0;
    let drawCount = 0;
    let sumI = 0;
    let sumJ = 0;
    for (const r of group) {
      const shares = r.shares ?? [0, 0];
      const a = shares[0] ?? 0;
      const b = shares[1] ?? 0;
      sumI += a;
      sumJ += b;
      const o = pairOutcome(a, b);
      if (o === "draw") drawCount++;
      else if (o === "i") winsI++;
      else winsJ++;
    }
    const n = group.length;
    wins[i]![j] = winsI;
    wins[j]![i] = winsJ;
    draws[i]![j] = drawCount;
    draws[j]![i] = drawCount;
    shareSum[i]![j] = sumI;
    shareSum[j]![i] = sumJ;
    shareN[i]![j] = n;
    shareN[j]![i] = n;
    cells.push({
      i,
      j,
      n,
      winsI,
      winsJ,
      draws: drawCount,
      meanShareI: n ? sumI / n : 0,
      meanShareJ: n ? sumJ / n : 0,
    });
  }
  cells.sort((a, b) => a.i - b.i || a.j - b.j);
  const meanShare = shareSum.map((row, i) => row.map((s, j) => (shareN[i]![j]! ? s / shareN[i]![j]! : 0)));
  return { nContestants, wins, draws, meanShare, cells };
}
