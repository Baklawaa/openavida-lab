import { DEFAULT_PARAMS, normalizeParams, type MetricsSample, type SimParams, type WorldSnapshot } from "./types";
import type { World } from "./world";

const PARAM_KEYS: (keyof SimParams)[] = [
  "width",
  "height",
  "seed",
  "mutationRate",
  "pointWeight",
  "indelWeight",
  "duplicationWeight",
  "diffusionRate",
  "nutrientDecay",
  "toxinDecay",
  "temperatureDecay",
  "lightDecay",
  "maxPopulation",
  "startPopulation",
  "reproduceEnergy",
  "maxAge",
  "predationThreshold",
  "mutualismShare",
  "randomTerrain",
  "disturbances",
];

export function paramsToQuery(p: SimParams): string {
  const usp = new URLSearchParams();
  for (const k of PARAM_KEYS) {
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
  for (const k of PARAM_KEYS) {
    const s = usp.get(k);
    if (s === null || s === "") continue;
    if (k === "randomTerrain" || k === "disturbances") {
      (partial as Record<string, boolean>)[k] = s === "1" || s === "true";
      continue;
    }
    const n = Number(s);
    if (Number.isFinite(n)) (partial as Record<string, number>)[k] = n;
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
  const data = JSON.parse(text) as WorldSnapshot;
  if (!data || data.version !== 1 || !data.params || !Array.isArray(data.organisms)) {
    throw new Error("invalid OpenAvida snapshot");
  }
  return data;
}

export function exportMetricsCSV(history: MetricsSample[]): string {
  const header =
    "tick,population,meanFitness,maxFitness,shannon,shannonGenotype,lineageCount,extinctTotal,fixationFraction,fixationLineageId";
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
    ].join(","),
  );
  return [header, ...rows].join("\n");
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
  return [header, ...rows].join("\n");
}

export function parseCSV(text: string): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.length);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0]!.split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { header, rows };
}
