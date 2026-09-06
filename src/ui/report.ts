/**
 * Self-contained HTML experiment report. Pure: canvases are passed as
 * data URLs; the builder never touches the DOM.
 */
import type { RecipeOp, ScheduledOp, SimParams, TrialResult, TrialSummary, Goal } from "../sim/index";

export interface ReportSavedOrganism {
  name: string;
  genome: string;
  strainName: string;
}

export interface ReportData {
  generatedAt: string;
  startLabel: string;
  params: SimParams;
  recipeOps: RecipeOp[];
  schedule: ScheduledOp[];
  goals: Goal[];
  goalLabels: string[];
  summary: TrialSummary;
  results: TrialResult[];
  maxTicks: number;
  chartPng?: string;
  treePng?: string;
  saved: ReportSavedOrganism[];
}

const HEADINGS = [
  "Configuration",
  "Recette",
  "Programme",
  "Objectifs",
  "Synthèse des réplicats",
  "Tableau des réplicats",
  "Mesure par réplicat",
  "Arbre des lignées",
  "Organismes enregistrés",
] as const;

export const REPORT_HEADINGS: readonly string[] = HEADINGS;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function opLine(op: RecipeOp): string {
  switch (op.type) {
    case "paint": return `peindre ${op.brush} (${op.x},${op.y}) r=${op.radius}`;
    case "place": return `placer (${op.x},${op.y})`;
    case "inject": return `injecter ${op.count}`;
    case "strain": return `souche ${op.name}`;
    case "step": return `avancer ${op.n} pas`;
  }
}

function schedLine(s: ScheduledOp): string {
  const op = s.op;
  if (op.type === "scale") return `pas ${s.at} · × ${op.k} sur ${op.field}`;
  if (op.type === "params") return `pas ${s.at} · paramètres ${JSON.stringify(op.params)}`;
  return `pas ${s.at} · ${opLine(op)}`;
}

export function buildReportHtml(data: ReportData): string {
  const n = data.results.length;
  const goalList = data.goalLabels.length
    ? `<ol>${data.goalLabels.map((g) => `<li>${esc(g)}</li>`).join("")}</ol>`
    : "<p>Aucun objectif.</p>";
  const s = data.summary;
  const rows = data.results.map((r, i) => {
    const ticks = r.reachedTicks?.length ? r.reachedTicks : [r.reachedTick];
    const pas = ticks.map((t) => (t === null || t === undefined ? "—" : String(t - r.startTick))).join(" / ");
    return `<tr><td>${i + 1}</td><td>${r.seed}</td><td>${r.reachedTick === null ? "non atteint" : "atteint"}</td><td>${pas}</td><td>${r.finalValue.toFixed(3)}</td><td>${r.finalPopulation}</td></tr>`;
  }).join("");
  const css = `body{font:14px/1.45 system-ui,sans-serif;color:#142018;background:#f4f7f5;margin:0;padding:24px}
h1,h2{font-weight:600}h1{font-size:22px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #c5d0c8;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #c5d0c8;padding:4px 6px;text-align:left}
th{background:#e4eee8}img{max-width:100%;background:#0e1612}code{font:12px ui-monospace,monospace}
.muted{color:#5b6d63;font-size:12px}ol{margin:0;padding-left:1.2em}`;
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Rapport OpenAvida Lab</title><style>${css}</style></head>
<body>
<h1>Rapport d’expérience</h1>
<p class="muted">${esc(data.generatedAt)} · départ ${esc(data.startLabel)} · budget ${data.maxTicks} pas</p>
<h2>Configuration</h2>
<ul>
<li>Grille ${data.params.width} × ${data.params.height}</li>
<li>Graine ${data.params.seed}</li>
<li>Taux de mutation ${data.params.mutationRate}</li>
<li>Population max ${data.params.maxPopulation}</li>
<li>Seuil de reproduction ${data.params.reproduceEnergy}</li>
</ul>
<h2>Recette</h2>
${data.recipeOps.length ? `<ol>${data.recipeOps.map((op) => `<li>${esc(opLine(op))}</li>`).join("")}</ol>` : "<p>Aucune action enregistrée.</p>"}
<h2>Programme</h2>
${data.schedule.length ? `<ol>${data.schedule.map((s) => `<li>${esc(schedLine(s))}</li>`).join("")}</ol>` : "<p>Aucun changement programmé.</p>"}
<h2>Objectifs</h2>
${goalList}
<h2>Synthèse des réplicats</h2>
<p>Réussite ${s.successes}/${s.n} · médiane ${s.medianTicks ?? "—"} pas · extinctions ${s.extinctions} · impossibles ${s.unreachable}.</p>
<h2>Tableau des réplicats</h2>
<p class="muted">${n} lignes (CSV).</p>
<table><thead><tr><th>#</th><th>Graine</th><th>Issue</th><th>Pas</th><th>Valeur</th><th>Pop.</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Mesure par réplicat</h2>
${data.chartPng ? `<img alt="Mesure par réplicat" src="${data.chartPng}">` : "<p>Graphique absent.</p>"}
<h2>Arbre des lignées</h2>
${data.treePng ? `<img alt="Arbre des lignées" src="${data.treePng}">` : "<p>Explorateur fermé : arbre non inclus.</p>"}
<h2>Organismes enregistrés</h2>
${data.saved.length
    ? `<ul>${data.saved.map((o) => `<li>${esc(o.name)} · ${esc(o.strainName)} · <code>${esc(o.genome.slice(0, 48))}${o.genome.length > 48 ? "…" : ""}</code></li>`).join("")}</ul>`
    : "<p>Aucun organisme enregistré cité par cette course.</p>"}
</body></html>`;
}
