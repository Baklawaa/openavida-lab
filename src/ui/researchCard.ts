/**
 * Research readout for the Analyse panel: what the run has measured so far.
 * Everything here is derived from the world's own history and neutral log, so
 * nothing needs re-simulation and nothing draws RNG.
 */
import {
  molecularClock,
  selectionCoefficient,
  traitDistribution,
  type TraitName,
  type World,
} from "../sim/index";

const TRACKED_TRAITS: readonly TraitName[] = ["uptake", "photo", "resist", "size", "mutator"];

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
        name: world.strains.get(strainId)?.name ?? `Souche ${strainId}`,
        coefficient: selectionCoefficient(series),
        share: count / total,
      };
    });
}

export function researchHtml(world: World): string {
  const livingLineages = [...world.lineages.values()].filter((l) => l.count > 0).length;
  const clock = molecularClock(world.neutralLog, Math.max(1, world.tick), Math.max(1, livingLineages));
  const latest = world.history.at(-1);
  const dist = traitDistribution(world.organisms);
  const selections = strainSelections(world);

  const selectionRows = selections.length
    ? selections
        .map(
          (s) =>
            `<div class="research-row"><b>${escapeHtml(s.name)}</b><span>${(s.share * 100).toFixed(0)} % de la population</span><span class="mono">s = ${s.coefficient === null ? "—" : s.coefficient.toFixed(4)} / pas</span></div>`,
        )
        .join("")
    : '<p class="muted">Aucune souche vivante.</p>';

  const traits = TRACKED_TRAITS.filter((t) => dist[t])
    .map((t) => `<span title="${t}"><b>${t}</b> ${dist[t]!.mean.toFixed(2)} ± ${dist[t]!.sd.toFixed(2)}</span>`)
    .join("");

  return `<div class="research-grid">
    <div><span class="eyebrow">SÉLECTION PAR SOUCHE</span>${selectionRows}<p class="micro">Pente de logit(fréquence) par pas, estimée sur l’historique. Positif = souche en progression.</p></div>
    <div><span class="eyebrow">DÉRIVE NEUTRE</span><p><b>${world.neutralLog.length}</b> substitution(s) neutre(s) (couleur) · horloge <b>${clock.toFixed(2)}</b> / 100 pas / lignée</p></div>
    <div><span class="eyebrow">FITNESS RÉALISÉE</span><p><b>${latest?.meanOffspringPerAdult !== undefined ? latest.meanOffspringPerAdult.toFixed(2) : "—"}</b> descendants par adulte décédé · fixation <b>${latest ? (latest.fixationFraction * 100).toFixed(0) : 0} %</b></p></div>
    <div><span class="eyebrow">DISTRIBUTION DES TRAITS</span><p class="research-traits">${traits || "—"}</p></div>
  </div>`;
}
