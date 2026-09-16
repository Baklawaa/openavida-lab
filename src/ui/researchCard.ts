/**
 * Research readout for the Analyse panel: what the run has measured so far.
 * Everything here is derived from the world's own history and neutral log, so
 * nothing needs re-simulation and nothing draws RNG.
 */
import {
  molecularClock,
  selectionCoefficient,
  traitDistribution,
  type FrequencyPoint,
  type TraitName,
  type World,
} from "../sim/index";
import { tDynamic } from "./i18n/runtime";

const TRACKED_TRAITS: readonly TraitName[] = ["uptake", "photo", "resist", "size", "mutator", "longevity"];

export interface StrainSelection {
  strainId: number;
  name: string;
  /** Per-tick selection coefficient from the strain's frequency trajectory. */
  coefficient: number | null;
  share: number;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** Leading strains by living count, with the slope of their frequency trajectory. */
export function strainSelections(world: World, limit = 3): StrainSelection[] {
  const counts = new Map<number, number>();
  for (const o of world.organisms) counts.set(o.strainId, (counts.get(o.strainId) ?? 0) + 1);
  const total = Math.max(1, world.organisms.length);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([strainId, count]) => {
      const series = world.history.map((h) => ({
        tick: h.tick,
        count: h.strains?.[String(strainId)] ?? 0,
        total: h.population,
      }));
      return {
        strainId,
        name: world.strains.get(strainId)?.name ?? tDynamic("render.strain.defaultName", { id: strainId }),
        coefficient: selectionCoefficient(series),
        share: count / total,
      };
    });
}

export type SelectionGrouping = "strain" | "lineage" | "none";

export interface SelectionRow {
  id: number;
  name: string;
  share: number;
  /** Per-tick slope of logit(frequency); null when no trend can be estimated. */
  coefficient: number | null;
  /** Why the coefficient is null, when it is. */
  reason?: string;
}

export interface SelectionReport {
  grouping: SelectionGrouping;
  rows: SelectionRow[];
  note: string;
}

/** Reason keys, translated where the reason is reported. */
const REASON_CLONAL = "render.research.reason.clonal";
const REASON_SHORT = "render.research.reason.short";
const REASON_FIXED = "render.research.reason.fixed";
const REASON_EMPTY = "render.research.reason.empty";

/** Frequency series of one lineage, from the bounded per-tick lineage samples. */
function lineageSeries(world: World, lineageId: number): FrequencyPoint[] {
  const series: FrequencyPoint[] = [];
  let started = false;
  for (const row of world.history) {
    const entry = row.lineageTop?.find(([id]) => id === lineageId);
    if (!entry) {
      // Rows before the lineage existed (tick 0 has no organisms at all) carry
      // no lineage series: skip them. A gap after it was tracked ends the
      // series, because the lineage left the window or went extinct.
      if (started) break;
      continue;
    }
    started = true;
    series.push({ tick: row.tick, count: entry[1], total: row.population });
  }
  return series;
}

function nullReason(world: World, series: readonly FrequencyPoint[]): string {
  if (world.organisms.length === 0) return tDynamic(REASON_EMPTY);
  const usable = series.filter((p) => p.total > 0 && p.count > 0 && p.count < p.total).length;
  if (usable >= 2) return tDynamic(REASON_FIXED);
  if (series.length < 2) return tDynamic(REASON_SHORT);
  return tDynamic(new Set(world.organisms.map((o) => o.strainId)).size <= 1 ? REASON_CLONAL : REASON_FIXED);
}

/**
 * Selection report for the card. Strains are primary; when a single strain
 * holds the plate the estimate falls back to the lineages inside it — a
 * monoculture still competes — and when neither can produce a trend the
 * reason is reported instead of a bare dash.
 */
export function selectionRows(world: World): SelectionReport {
  const livingStrains = new Set(world.organisms.map((o) => o.strainId)).size;
  if (livingStrains >= 2) {
    const rows: SelectionRow[] = strainSelections(world).map((s) => {
      const series: FrequencyPoint[] = world.history.map((h) => ({
        tick: h.tick,
        count: h.strains?.[String(s.strainId)] ?? 0,
        total: h.population,
      }));
      return {
        id: s.strainId,
        name: s.name,
        share: s.share,
        coefficient: s.coefficient,
        ...(s.coefficient === null ? { reason: nullReason(world, series) } : {}),
      };
    });
    return {
      grouping: "strain",
      rows,
      note: tDynamic("render.research.note.strain"),
    };
  }

  // Lineage fallback. Rank by trajectory length first, so the card reports the
  // lineages that actually have a fittable series: the tracked window holds the
  // most populated lineages and churns, so a recent arrival may have one sample.
  const trackedIds = new Set<number>();
  for (const row of world.history) for (const [id] of row.lineageTop ?? []) trackedIds.add(id);
  const candidates = [...trackedIds]
    .map((id) => ({ id, series: lineageSeries(world, id), count: world.lineages.get(id)?.count ?? 0 }))
    .sort((a, b) => b.series.length - a.series.length || b.count - a.count);
  const fittable = candidates.filter((c) => c.series.length >= 2);
  if (fittable.length >= 2) {
    const rows: SelectionRow[] = fittable.slice(0, 3).map((c) => {
      const coefficient = selectionCoefficient(c.series);
      const last = c.series.at(-1)!;
      return {
        id: c.id,
        name: tDynamic("render.lineage.defaultName", { id: c.id }),
        share: last.count / Math.max(1, last.total),
        coefficient,
        ...(coefficient === null ? { reason: tDynamic(REASON_FIXED) } : {}),
      };
    });
    return {
      grouping: "lineage",
      rows,
      note: tDynamic("render.research.note.lineage"),
    };
  }
  const livingLineages = [...world.lineages.values()].filter((l) => l.count > 0).length;
  const reason =
    world.organisms.length === 0
      ? REASON_EMPTY
      : world.history.length < 2
        ? REASON_SHORT
        : livingLineages < 2
          ? REASON_CLONAL
          : REASON_FIXED;
  // The reason is reported inside a sentence, so the key is resolved here.
  return { grouping: "none", rows: [], note: tDynamic("render.research.note.none", { reason: tDynamic(reason) }) };
}

export function researchHtml(world: World): string {
  const livingLineages = [...world.lineages.values()].filter((l) => l.count > 0).length;
  const clock = molecularClock(world.neutralLog, Math.max(1, world.tick), Math.max(1, livingLineages));
  const latest = world.history.at(-1);
  const dist = traitDistribution(world.organisms);
  const selection = selectionRows(world);

  const selectionHeading =
    selection.grouping === "strain"
      ? tDynamic("render.research.heading.strain")
      : selection.grouping === "lineage"
        ? tDynamic("render.research.heading.lineage")
        : tDynamic("render.research.heading.selection");
  const selectionHtml = selection.rows.length
    ? `${selection.rows
        .map(
          (s) =>
            `<div class="research-row"><b>${escapeHtml(s.name)}</b><span>${tDynamic("render.research.share", { share: (s.share * 100).toFixed(0) })}</span><span class="mono">s = ${s.coefficient === null ? `— ${escapeHtml(s.reason ?? "")}` : `${s.coefficient.toFixed(4)} ${tDynamic("render.research.perStep")}`}</span></div>`,
        )
        .join("")}<p class="micro">${escapeHtml(selection.note)}</p>`
    : `<p class="muted">${escapeHtml(selection.note)}</p>`;

  const traits = TRACKED_TRAITS.filter((t) => dist[t])
    .map((t) => `<span title="${t}"><b>${t}</b> ${dist[t]!.mean.toFixed(2)} ± ${dist[t]!.sd.toFixed(2)}</span>`)
    .join("");

  return `<div class="research-grid">
    <div><span class="eyebrow">${selectionHeading}</span>${selectionHtml}</div>
    <div><span class="eyebrow">${tDynamic("render.research.heading.drift")}</span><p><b>${world.neutralLog.length}</b> ${tDynamic("render.research.neutral.substitutions")} · ${tDynamic("render.research.neutral.clock", { clock: clock.toFixed(2) })}</p></div>
    <div><span class="eyebrow">${tDynamic("render.research.heading.fitness")}</span><p><b>${latest?.meanOffspringPerAdult !== undefined ? latest.meanOffspringPerAdult.toFixed(2) : "—"}</b> ${tDynamic("render.research.fitness.descendants")} · ${tDynamic("render.research.fitness.fixation", { pct: latest ? (latest.fixationFraction * 100).toFixed(0) : 0 })}</p></div>
    <div><span class="eyebrow">${tDynamic("render.research.heading.traits")}</span><p class="research-traits">${traits || "—"}</p></div>
  </div>`;
}
