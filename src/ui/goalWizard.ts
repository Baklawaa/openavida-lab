/**
 * Goal definition half of the Expérience panel: the metric catalogue and its
 * options, the ready-made templates, the current goal and its extra goals, the
 * sentence that describes them, the field-threshold row, the seed validation
 * and the start state the next run will begin from.
 */
import {
  FIELD_NAMES,
  TRAIT_NAMES,
  type FieldName,
  type Goal,
  type GoalMetric,
  type Strain,
  type TraitName,
  type WorldSnapshot,
} from "../sim/index";
import { FIELD_LABEL, TRAIT_LABEL } from "./labels";
import { tDynamic } from "./i18n/runtime";
import type { GoalContext } from "./goalContext";

interface GoalTemplate {
  id: string;
  label: string;
  metric: string;
  fieldMin?: number;
  op: ">=" | "<=";
  target: number;
  sustain: number;
}

/** Ready-made goals; the markup lists them in this order. */
export const TEMPLATES: GoalTemplate[] = [
  { id: "toxin", label: tDynamic("goal.template.toxin"), metric: "share:toxin", fieldMin: 0.3, op: ">=", target: 0.5, sustain: 10 },
  { id: "resist", label: tDynamic("goal.template.resist"), metric: "trait:resist:mean", op: ">=", target: 0.5, sustain: 5 },
  { id: "heat", label: tDynamic("goal.template.heat"), metric: "share:temperature", fieldMin: 0.8, op: ">=", target: 0.3, sustain: 10 },
  { id: "photo", label: tDynamic("goal.template.photo"), metric: "trait:photo:mean", op: ">=", target: 0.6, sustain: 5 },
  { id: "pop", label: tDynamic("goal.template.pop"), metric: "population", op: ">=", target: 300, sustain: 1 },
  { id: "diversity", label: tDynamic("goal.template.diversity"), metric: "shannon", op: ">=", target: 2, sustain: 20 },
];

/** The builder keeps the first goal plus at most three extras. */
const MAX_GOALS = 4;

function metricOptions(strains: Strain[]): string {
  const g = (label: string, items: string) => `<optgroup label="${label}">${items}</optgroup>`;
  const traits = TRAIT_NAMES.filter((t) => t !== "hue").map((t) => `<option value="trait:${t}:mean">${tDynamic("goal.metric.trait.mean", { trait: TRAIT_LABEL[t] })}</option><option value="trait:${t}:max">${tDynamic("goal.metric.trait.max", { trait: TRAIT_LABEL[t] })}</option>`).join("");
  const fields = FIELD_NAMES.map((f) => `<option value="share:${f}">${tDynamic("goal.metric.field.share", { field: FIELD_LABEL[f] })}</option>`).join("");
  const strainOpts = strains.map((s) => `<option value="strain-share:${s.id}">${tDynamic("goal.metric.strain.share", { strain: s.name })}</option><option value="strain-count:${s.id}">${tDynamic("goal.metric.strain.count", { strain: s.name })}</option>`).join("");
  return (
    g(tDynamic("goal.metric.group.population"), `<option value="population">${tDynamic("goal.metric.population")}</option><option value="lineages">${tDynamic("goal.metric.lineages")}</option><option value="shannon">${tDynamic("goal.metric.shannon")}</option><option value="meanFitness">${tDynamic("goal.metric.meanFitness")}</option>`) +
    g(tDynamic("goal.metric.group.field"), fields) +
    g(tDynamic("goal.metric.group.trait"), traits) +
    (strainOpts ? g(tDynamic("goal.metric.group.strain"), strainOpts) : "")
  );
}

export function parseMetric(value: string, fieldMin: number): GoalMetric | null {
  const [kind, a, b] = value.split(":");
  switch (kind) {
    case "population": return { kind: "population" };
    case "lineages": return { kind: "lineages" };
    case "shannon": return { kind: "shannon" };
    case "meanFitness": return { kind: "meanFitness" };
    case "trait":
      if (!(TRAIT_NAMES as readonly string[]).includes(a ?? "")) return null;
      return { kind: "trait", trait: a as TraitName, stat: b === "max" ? "max" : "mean" };
    case "share":
      if (!(FIELD_NAMES as readonly string[]).includes(a ?? "")) return null;
      return { kind: "share-in-field", field: a as FieldName, min: fieldMin };
    case "strain-share": return { kind: "strain-share", strainId: Number(a) };
    case "strain-count": return { kind: "strain-count", strainId: Number(a) };
    default: return null;
  }
}

export function describeGoal(goal: Goal, strains: Strain[]): string {
  const m = goal.metric;
  const name = (id: number) => strains.find((s) => s.id === id)?.name ?? tDynamic("goal.goal.strainFallback", { id });
  const what =
    m.kind === "population" ? tDynamic("goal.goal.population")
      : m.kind === "lineages" ? tDynamic("goal.goal.lineages")
        : m.kind === "shannon" ? tDynamic("goal.goal.shannon")
          : m.kind === "meanFitness" ? tDynamic("goal.goal.meanFitness")
            : m.kind === "trait" ? tDynamic(m.stat === "max" ? "goal.metric.trait.max" : "goal.metric.trait.mean", { trait: TRAIT_LABEL[m.trait] })
              : m.kind === "share-in-field" ? tDynamic("goal.goal.share", { field: FIELD_LABEL[m.field], min: m.min })
                : m.kind === "strain-share" ? tDynamic("goal.goal.strainShare", { strain: name(m.strainId) })
                  : tDynamic("goal.goal.strainCount", { strain: name(m.strainId) });
  const sustain = goal.sustain > 1 ? tDynamic("goal.goal.sustain", { count: goal.sustain }) : "";
  return `${what} ${goal.op === ">=" ? "≥" : "≤"} ${goal.target}${sustain}`;
}

/** Seeds are unsigned 32-bit: digits only, 1 … 4294967295. Returns null otherwise (never silently truncates). */
export function parseSeed(text: string): number | null {
  const t = text.trim().replace(/[\s_'’]/g, "");
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 0xffffffff ? n : null;
}
export const SEED_HINT = tDynamic("goal.seed.hint");

/** Copy the active world's parameters into the run configuration fields. */
export function syncDefaults(ctx: GoalContext): void {
  const w = ctx.world();
  ctx.q<HTMLInputElement>("#goal-seed").value = String((w.params.seed ^ 0x5bd1e995) >>> 0 || 1);
  ctx.q<HTMLInputElement>("#goal-mut").value = String(w.params.mutationRate);
  ctx.q<HTMLInputElement>("#goal-popmax").value = String(w.params.maxPopulation);
  ctx.q<HTMLInputElement>("#goal-disturb").checked = w.disturbances;
  updateGoalText(ctx);
}

/** Rebuild the metric options when the strains change, keeping the current pick when it survives. */
export function refreshMetricOptions(ctx: GoalContext, force: boolean): void {
  const strains = [...ctx.world().strains.values()];
  const key = strains.map((s) => `${s.id}:${s.name}`).join("|");
  if (!force && key === ctx.state.lastMetricKey) return;
  ctx.state.lastMetricKey = key;
  ctx.state.lastStrains = strains;
  const sel = ctx.q<HTMLSelectElement>("#goal-metric");
  const prev = sel.value;
  sel.innerHTML = metricOptions(strains);
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (!prev) sel.value = "share:toxin";
  toggleFieldMin(ctx);
  if (ctx.state.extraGoals.length) renderExtraGoals(ctx);
}

export function toggleFieldMin(ctx: GoalContext): void {
  const isShare = ctx.q<HTMLSelectElement>("#goal-metric").value.startsWith("share:");
  ctx.q("#goal-field-min-row").hidden = !isShare;
}

export function currentGoal(ctx: GoalContext): Goal | null {
  const metric = parseMetric(ctx.q<HTMLSelectElement>("#goal-metric").value, Number(ctx.q<HTMLInputElement>("#goal-field-min").value) || 0);
  if (!metric) return null;
  const target = Number(ctx.q<HTMLInputElement>("#goal-target").value);
  if (!Number.isFinite(target)) return null;
  return {
    metric,
    op: ctx.q<HTMLSelectElement>("#goal-op").value === "<=" ? "<=" : ">=",
    target,
    sustain: Math.max(1, Math.round(Number(ctx.q<HTMLInputElement>("#goal-sustain").value) || 1)),
  };
}

/** Builder goal plus the extra list, capped at 4. */
export function currentGoals(ctx: GoalContext): Goal[] | null {
  const g = currentGoal(ctx);
  if (!g) return null;
  return [g, ...ctx.state.extraGoals].slice(0, MAX_GOALS);
}

export function addExtraGoal(ctx: GoalContext): void {
  const g = currentGoal(ctx);
  if (!g) {
    ctx.status(tDynamic("goal.status.incomplete"));
    return;
  }
  if (ctx.state.extraGoals.length >= MAX_GOALS - 1) {
    ctx.status(tDynamic("goal.status.maxGoals"));
    return;
  }
  ctx.state.extraGoals.push(g);
  renderExtraGoals(ctx);
  updateGoalText(ctx);
}

export function renderExtraGoals(ctx: GoalContext): void {
  const host = ctx.q("#goal-extra");
  const add = ctx.q<HTMLButtonElement>("#btn-goal-add");
  add.disabled = ctx.state.extraGoals.length >= MAX_GOALS - 1;
  if (!ctx.state.extraGoals.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = ctx.state.extraGoals
    .map((g, i) => `<div class="goal-extra-row" data-i="${i}"><b>${tDynamic("goal.extra.heading", { n: i + 2 })}</b><span>${describeGoal(g, ctx.state.lastStrains)}</span><button type="button" class="quiet" data-remove-goal="${i}" aria-label="${tDynamic("goal.extra.remove", { n: i + 2 })}">×</button></div>`)
    .join("");
}

export function updateGoalText(ctx: GoalContext): void {
  const g = currentGoal(ctx);
  const n = 1 + ctx.state.extraGoals.length;
  ctx.q("#goal-text").textContent = g
    ? n > 1
      ? tDynamic("goal.goalText.multi", {
        first: describeGoal(g, ctx.state.lastStrains),
        others: tDynamic(ctx.state.extraGoals.length > 1 ? "goal.goalText.others.many" : "goal.goalText.others.one", { count: ctx.state.extraGoals.length }),
      })
      : tDynamic("goal.goalText.single", { goal: describeGoal(g, ctx.state.lastStrains) })
    : tDynamic("goal.goalText.incomplete");
}

export function applyTemplate(ctx: GoalContext, id: string): void {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  ctx.q<HTMLSelectElement>("#goal-metric").value = t.metric;
  if (t.fieldMin !== undefined) ctx.q<HTMLInputElement>("#goal-field-min").value = String(t.fieldMin);
  ctx.q<HTMLSelectElement>("#goal-op").value = t.op;
  ctx.q<HTMLInputElement>("#goal-target").value = String(t.target);
  ctx.q<HTMLInputElement>("#goal-sustain").value = String(t.sustain);
  toggleFieldMin(ctx);
  updateGoalText(ctx);
}

/** The selected start state: the active world as it stands, or a stored preset. */
export async function startSnapshot(ctx: GoalContext): Promise<{ snapshot: WorldSnapshot; label: string } | null> {
  const id = ctx.q<HTMLSelectElement>("#goal-source").value;
  if (id === "current") return { snapshot: ctx.world().snapshot(), label: tDynamic("goal.source.label", { world: ctx.activeWorld() }) };
  const rec = await ctx.store.load(id);
  if (!rec) {
    ctx.status(tDynamic("goal.preset.missing"));
    return null;
  }
  return { snapshot: rec.snapshot, label: rec.name };
}
