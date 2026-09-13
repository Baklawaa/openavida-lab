/**
 * Self-contained HTML experiment report. Pure: canvases are passed as
 * data URLs; the builder never touches the DOM. The copy comes from the locale
 * catalogs (src/ui/i18n), so the report follows the active language.
 */
import type { RecipeOp, ScheduledOp, SimParams, TrialResult, TrialSummary, Goal } from "../sim/index";
import { locale, tDynamic } from "./i18n/runtime";

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

/** Section heading keys, in report order. */
const HEADING_KEYS = [
  "render.report.heading.configuration",
  "render.report.heading.recipe",
  "render.report.heading.schedule",
  "render.report.heading.goals",
  "render.report.heading.summary",
  "render.report.heading.table",
  "render.report.heading.measure",
  "render.report.heading.tree",
  "render.report.heading.saved",
] as const;

/**
 * The active locale is fixed for the life of a page (switching language
 * reloads), so the headings are resolved once at module load; the builder below
 * resolves its own copy at call time.
 */
export const REPORT_HEADINGS: readonly string[] = HEADING_KEYS.map((key) => tDynamic(key));

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function opLine(op: RecipeOp): string {
  switch (op.type) {
    case "paint": return tDynamic("render.report.op.paint", { brush: op.brush, x: op.x, y: op.y, radius: op.radius });
    case "place": return tDynamic("render.report.op.place", { x: op.x, y: op.y });
    case "inject": return tDynamic("render.report.op.inject", { count: op.count });
    case "strain": return tDynamic("render.report.op.strain", { name: op.name });
    case "step": return tDynamic("render.report.op.step", { n: op.n });
  }
}

function schedLine(s: ScheduledOp): string {
  const op = s.op;
  if (op.type === "scale") return tDynamic("render.report.sched.scale", { at: s.at, k: op.k, field: op.field });
  if (op.type === "params") return tDynamic("render.report.sched.params", { at: s.at, params: JSON.stringify(op.params) });
  return tDynamic("render.report.sched.op", { at: s.at, op: opLine(op) });
}

export function buildReportHtml(data: ReportData): string {
  const n = data.results.length;
  const goalList = data.goalLabels.length
    ? `<ol>${data.goalLabels.map((g) => `<li>${esc(g)}</li>`).join("")}</ol>`
    : `<p>${tDynamic("render.report.goals.none")}</p>`;
  const s = data.summary;
  const rows = data.results.map((r, i) => {
    const ticks = r.reachedTicks?.length ? r.reachedTicks : [r.reachedTick];
    const pas = ticks.map((t) => (t === null || t === undefined ? "—" : String(t - r.startTick))).join(" / ");
    const outcome = tDynamic(r.reachedTick === null ? "render.report.outcome.missed" : "render.report.outcome.reached");
    return `<tr><td>${i + 1}</td><td>${r.seed}</td><td>${outcome}</td><td>${pas}</td><td>${r.finalValue.toFixed(3)}</td><td>${r.finalPopulation}</td></tr>`;
  }).join("");
  const css = `body{font:14px/1.45 system-ui,sans-serif;color:#142018;background:#f4f7f5;margin:0;padding:24px}
h1,h2{font-weight:600}h1{font-size:22px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #c5d0c8;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #c5d0c8;padding:4px 6px;text-align:left}
th{background:#e4eee8}img{max-width:100%;background:#0e1612}code{font:12px ui-monospace,monospace}
.muted{color:#5b6d63;font-size:12px}ol{margin:0;padding-left:1.2em}`;
  return `<!DOCTYPE html>
<html lang="${locale()}"><head><meta charset="utf-8"><title>${tDynamic("render.report.title")}</title><style>${css}</style></head>
<body>
<h1>${tDynamic("render.report.h1")}</h1>
<p class="muted">${esc(data.generatedAt)} · ${tDynamic("render.report.meta.start", { label: esc(data.startLabel) })} · ${tDynamic("render.report.meta.budget", { steps: data.maxTicks })}</p>
<h2>${tDynamic("render.report.heading.configuration")}</h2>
<ul>
<li>${tDynamic("render.report.config.grid", { w: data.params.width, h: data.params.height })}</li>
<li>${tDynamic("render.report.config.seed", { seed: data.params.seed })}</li>
<li>${tDynamic("render.report.config.mutation", { rate: data.params.mutationRate })}</li>
<li>${tDynamic("render.report.config.maxPopulation", { max: data.params.maxPopulation })}</li>
<li>${tDynamic("render.report.config.reproduce", { energy: data.params.reproduceEnergy })}</li>
</ul>
<h2>${tDynamic("render.report.heading.recipe")}</h2>
${data.recipeOps.length ? `<ol>${data.recipeOps.map((op) => `<li>${esc(opLine(op))}</li>`).join("")}</ol>` : `<p>${tDynamic("render.report.recipe.none")}</p>`}
<h2>${tDynamic("render.report.heading.schedule")}</h2>
${data.schedule.length ? `<ol>${data.schedule.map((s) => `<li>${esc(schedLine(s))}</li>`).join("")}</ol>` : `<p>${tDynamic("render.report.schedule.none")}</p>`}
<h2>${tDynamic("render.report.heading.goals")}</h2>
${goalList}
<h2>${tDynamic("render.report.heading.summary")}</h2>
<p>${tDynamic("render.report.summary", { successes: s.successes, n: s.n, median: s.medianTicks ?? "—", extinctions: s.extinctions, unreachable: s.unreachable })}</p>
<h2>${tDynamic("render.report.heading.table")}</h2>
<p class="muted">${tDynamic("render.report.rows", { n })}</p>
<table><thead><tr><th>#</th><th>${tDynamic("render.report.th.seed")}</th><th>${tDynamic("render.report.th.outcome")}</th><th>${tDynamic("render.report.th.steps")}</th><th>${tDynamic("render.report.th.value")}</th><th>${tDynamic("render.report.th.pop")}</th></tr></thead><tbody>${rows}</tbody></table>
<h2>${tDynamic("render.report.heading.measure")}</h2>
${data.chartPng ? `<img alt="${tDynamic("render.report.heading.measure")}" src="${data.chartPng}">` : `<p>${tDynamic("render.report.chart.none")}</p>`}
<h2>${tDynamic("render.report.heading.tree")}</h2>
${data.treePng ? `<img alt="${tDynamic("render.report.heading.tree")}" src="${data.treePng}">` : `<p>${tDynamic("render.report.tree.none")}</p>`}
<h2>${tDynamic("render.report.heading.saved")}</h2>
${data.saved.length
    ? `<ul>${data.saved.map((o) => `<li>${esc(o.name)} · ${esc(o.strainName)} · <code>${esc(o.genome.slice(0, 48))}${o.genome.length > 48 ? "…" : ""}</code></li>`).join("")}</ul>`
    : `<p>${tDynamic("render.report.saved.none")}</p>`}
</body></html>`;
}
