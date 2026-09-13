/**
 * Experiment journal: turn a finished run into a storable record and compare
 * stored runs with each other. Pure — no DOM, no storage, no simulation.
 */
import {
  compareConditions,
  type EngineInfo,
  type Manifest,
  type TrialResult,
  type TrialSummary,
} from "../sim/index";

/** Replicates kept per record (the summary keeps the full statistics). */
export const HISTORY_RESULTS_CAP = 200;
/** Curves kept per record, sampled evenly, for the overlay chart. */
export const HISTORY_CURVES = 100;

export interface ExperimentRecord {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  engine: EngineInfo;
  paramsDigest: string;
  manifest: Manifest;
  summary: TrialSummary;
  results: TrialResult[];
  /** Even sample of replicate curves, with the outcome that colours them. */
  curves: ExperimentCurve[];
}

export interface ExperimentCurve {
  /** Metric value at each sampled tick. */
  values: number[];
  reached: boolean;
}

export interface HistoryEffect {
  medianShift: number | null;
  cliffsDelta: number;
  hedgesG: number;
  n: number;
}

export interface HistoryRow {
  id: string;
  name: string;
  createdAt: string;
  n: number;
  successes: number;
  successRate: number;
  successRateCI: [number, number];
  medianTicks: number | null;
  medianTicksCI: [number, number] | null;
  /** Set when the record was produced by a different engine revision. */
  engineMismatch: string | null;
  /** Effect against the reference run (null for the reference itself). */
  effect: HistoryEffect | null;
}

let idCounter = 0;

export function newExperimentId(now = Date.now()): string {
  idCounter += 1;
  return `run-${now.toString(36)}-${idCounter.toString(36)}`;
}

/** Even sample of replicate curves, capped so a 1000-replicate run stays drawable. */
export function sampleCurves(results: readonly TrialResult[], max = HISTORY_CURVES): ExperimentCurve[] {
  if (results.length === 0) return [];
  const step = Math.max(1, Math.ceil(results.length / Math.max(1, max)));
  const out: ExperimentCurve[] = [];
  for (let i = 0; i < results.length; i += step) {
    const result = results[i]!;
    out.push({
      values: result.series.map(([, value]) => value),
      reached: result.reachedTick !== null,
    });
  }
  return out;
}

export function engineDrift(record: EngineInfo, current: EngineInfo): string | null {
  if (record.version === current.version && record.revision === current.revision) return null;
  return `moteur ${record.version} (rév. ${record.revision}) ≠ courant ${current.version} (rév. ${current.revision})`;
}

export function recordFromRun(init: {
  manifest: Manifest;
  results: readonly TrialResult[];
  summary: TrialSummary;
  name?: string;
  notes?: string;
  createdAt?: string;
  id?: string;
}): ExperimentRecord {
  const results = init.results.slice(0, HISTORY_RESULTS_CAP).map((r) => ({ ...r }));
  return {
    id: init.id ?? newExperimentId(),
    name: init.name ?? init.manifest.name,
    notes: init.notes ?? init.manifest.notes ?? "",
    createdAt: init.createdAt ?? new Date().toISOString(),
    engine: init.manifest.engine,
    paramsDigest: init.manifest.paramsDigest,
    manifest: init.manifest,
    summary: init.summary,
    results,
    curves: sampleCurves(init.results),
  };
}

/**
 * One row per stored run, with its interval and its effect against the
 * reference run. Uses the same statistics as the headless runner.
 */
export function historyRows(
  records: readonly ExperimentRecord[],
  opts: { referenceId?: string; current?: EngineInfo } = {},
): HistoryRow[] {
  if (records.length === 0) return [];
  const byLabel: Record<string, readonly TrialResult[]> = {};
  const byId = new Map<string, ExperimentRecord>();
  for (const record of records) {
    byLabel[record.id] = record.results;
    byId.set(record.id, record);
  }
  const reference = opts.referenceId && byLabel[opts.referenceId] ? opts.referenceId : records[0]!.id;
  const comparison = compareConditions(byLabel, { reference, paired: false });
  return comparison.conditions.map((condition) => {
    const record = byId.get(condition.label)!;
    const effect = comparison.effects.find((e) => e.label === condition.label);
    return {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      n: condition.n,
      successes: condition.successes,
      successRate: condition.successRate,
      successRateCI: condition.successRateCI,
      medianTicks: condition.medianTicks,
      medianTicksCI: record.summary.medianTicksCI ?? null,
      engineMismatch: opts.current ? engineDrift(record.engine, opts.current) : null,
      effect:
        condition.label === reference || !effect
          ? null
          : { medianShift: effect.medianShift, cliffsDelta: effect.cliffsDelta, hedgesG: effect.hedgesG, n: effect.n },
    };
  });
}
