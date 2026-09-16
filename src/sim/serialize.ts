import { engineInfo, paramsDigest, type EngineInfo } from "./engine";
import { migrateSnapshot } from "./migrate";
import { PARAM_SPEC, QUERY_KEYS } from "./params";
import { SNAPSHOT_BIN_MAGIC, decodeSnapshot } from "./snapshotBin";
import { DEFAULT_PARAMS, normalizeParams, type MetricsSample, type SimParams, type WorldSnapshot } from "./types";
import type { World } from "./world";

export function paramsToQuery(p: SimParams): string {
  const usp = new URLSearchParams();
  for (const k of QUERY_KEYS) {
    const v = p[k];
    const def = DEFAULT_PARAMS[k];
    if (v !== def) usp.set(k, String(v));
  }
  if (!usp.has("seed")) usp.set("seed", String(p.seed));
  return usp.toString();
}

export function paramsFromQuery(qs: string): SimParams {
  const raw = qs.startsWith("?") ? qs.slice(1) : qs;
  const usp = new URLSearchParams(raw);
  const partial: Partial<SimParams> = {};
  for (const spec of PARAM_SPEC) {
    const s = usp.get(spec.key);
    if (s === null || s === "") continue;
    if (spec.kind === "boolean") {
      (partial as Record<string, boolean>)[spec.key] = s === "1" || s === "true";
      continue;
    }
    const n = Number(s);
    if (Number.isFinite(n)) (partial as Record<string, number>)[spec.key] = n;
  }
  return normalizeParams(partial);
}

export function buildShareURL(p: SimParams, origin?: string, path?: string): string {
  const base =
    origin && path !== undefined
      ? origin + path
      : typeof location !== "undefined"
        ? location.origin + location.pathname
        : "https://openavida.lab/";
  const q = paramsToQuery(p);
  return q ? `${base}?${q}` : base;
}

export function parseShareURL(url: string): SimParams {
  const qIndex = url.indexOf("?");
  const qs = qIndex >= 0 ? url.slice(qIndex + 1) : url;
  const hash = qs.indexOf("#");
  return paramsFromQuery(hash >= 0 ? qs.slice(0, hash) : qs);
}

export function exportJSON(world: World): string {
  const snap = world.snapshot();
  return JSON.stringify(snap);
}

export function parseJSONSnapshot(text: string): WorldSnapshot {
  const snap = migrateSnapshot(JSON.parse(text) as unknown);
  if (!snap.params || !Array.isArray(snap.organisms)) {
    throw new Error("invalid OpenAvida snapshot");
  }
  return snap;
}

/**
 * Read a world file without trusting its extension: the first four bytes decide
 * the format.
 *
 * Two forms are accepted. The "OAV2" binary container (see ./snapshotBin) starts
 * with SNAPSHOT_BIN_MAGIC and carries a JSON header followed by the field planes
 * as typed arrays; the JSON text written by exportJSON is read as UTF-8. A
 * leading byte-order mark is tolerated on the text form, because files saved by
 * Windows tooling often carry one. A binary payload whose container is malformed
 * or truncated throws here rather than being silently parsed as text.
 */
export function parseWorldBytes(bytes: ArrayBuffer): WorldSnapshot {
  const view = new DataView(bytes);
  if (bytes.byteLength >= 4 && view.getUint32(0, true) === SNAPSHOT_BIN_MAGIC) {
    // The container is a shape, not a compatibility key: migrate what it holds,
    // exactly as the JSON branch does.
    return migrateSnapshot(decodeSnapshot(bytes));
  }
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return parseJSONSnapshot(text.replace(/^\uFEFF/, ""));
}

/** Provenance record embedded in every export so a result can be tied to an engine and a run. */
export interface ExportProvenance {
  engine: EngineInfo;
  paramsDigest: string;
  seed: number;
  tick: number;
}

export function provenanceOf(world: World): ExportProvenance {
  return {
    engine: engineInfo(),
    paramsDigest: paramsDigest({
      ...world.params,
      randomTerrain: world.randomTerrain,
      disturbances: world.disturbances,
    }),
    seed: world.params.seed,
    tick: world.tick,
  };
}

function provenanceLine(p: ExportProvenance): string {
  return `# openavida engine=${p.engine.version} revision=${p.engine.revision} algo=${p.engine.hashAlgo} params=${p.paramsDigest} seed=${p.seed} tick=${p.tick}`;
}

export function exportMetricsCSV(history: MetricsSample[], provenance?: ExportProvenance): string {
  const header =
    "tick,population,meanFitness,maxFitness,shannon,shannonGenotype,lineageCount,extinctTotal,fixationFraction,fixationLineageId,hill1,hill2,richness,evenness,meanOffspringPerAdult";
  const rows = history.map((m) =>
    [
      m.tick,
      m.population,
      m.meanFitness,
      m.maxFitness,
      m.shannon,
      m.shannonGenotype,
      m.lineageCount,
      m.extinctTotal,
      m.fixationFraction,
      m.fixationLineageId,
      m.hill1 ?? "",
      m.hill2 ?? "",
      m.richness ?? "",
      m.evenness ?? "",
      m.meanOffspringPerAdult ?? "",
    ].join(","),
  );
  const head = provenance ? [provenanceLine(provenance), header] : [header];
  return [...head, ...rows].join("\n");
}

export function exportPhylogenyCSV(world: World): string {
  const header = "id,parentId,bornTick,extinctTick,count,peakCount,hue,signature";
  const rows = Array.from(world.lineages.values()).map((l) =>
    [
      l.id,
      l.parentId,
      l.bornTick,
      l.extinctTick === null ? "" : l.extinctTick,
      l.count,
      l.peakCount,
      l.hue,
      l.signature,
    ].join(","),
  );
  return [provenanceLine(provenanceOf(world)), header, ...rows].join("\n");
}

/**
 * One research event per line (JSON Lines). The first line is a provenance
 * comment starting with '#'; readers should skip comment lines.
 */
export function exportEventsJSONL(world: World, provenance?: ExportProvenance): string {
  const lines: string[] = [];
  if (provenance) lines.push(provenanceLine(provenance));
  for (const e of world.eventLog) lines.push(JSON.stringify(e));
  return lines.join("\n");
}

export function parseCSV(text: string): { header: string[]; rows: string[][] } {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.length && !l.startsWith("#"));
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0]!.split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { header, rows };
}
