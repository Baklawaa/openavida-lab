/**
 * The programmed-change list of the environment panel: the add row (#sched-at,
 * #sched-action, #sched-arg, #btn-sched-add) and the removable #sched-list.
 * refreshScheduleList rewrites the list only when its key changes, so the
 * metrics cadence can call it every frame; describeSched formats one op.
 */
import type { BrushKind, FieldName, ScheduledOp } from "../../sim/index";
import { tDynamic } from "../i18n/runtime";
import { FIELD_LABEL, SCHED_PARAM_LABEL } from "../labels";
import type { LabContext } from "./context";

function describeSched(item: ScheduledOp): string {
  const op = item.op;
  if (op.type === "scale") return tDynamic("app.schedule.scale", { k: op.k, field: FIELD_LABEL[op.field] ?? op.field });
  if (op.type === "params") {
    const e = Object.entries(op.params)[0];
    return e ? `${SCHED_PARAM_LABEL[e[0]] ?? e[0]} → ${e[1]}` : tDynamic("app.schedule.params");
  }
  if (op.type === "paint") return tDynamic("app.schedule.paint", { brush: op.brush, radius: op.radius });
  if (op.type === "inject") return tDynamic("app.schedule.inject", { count: op.count });
  if (op.type === "place") return tDynamic("app.schedule.place", { x: op.x, y: op.y });
  if (op.type === "strain") return tDynamic("app.schedule.strain", { name: op.name });
  return op.type;
}

/** What the schedule panel hands back to the app for the context. */
export interface SchedulePanel {
  refresh(): void;
}

export function createSchedulePanel(ctx: LabContext): SchedulePanel {
  const { root } = ctx;
  const schedAt = root.querySelector<HTMLInputElement>("#sched-at")!;
  const schedAction = root.querySelector<HTMLSelectElement>("#sched-action")!;
  const schedArg = root.querySelector<HTMLInputElement>("#sched-arg")!;
  const schedList = root.querySelector<HTMLElement>("#sched-list")!;
  let schedListKey = "";

  function refreshScheduleList(): void {
    const list = ctx.current().schedule;
    const key = list.map((s) => `${s.at}:${s.op.type}`).join("|");
    if (key === schedListKey) return;
    schedListKey = key;
    if (!list.length) {
      schedList.innerHTML = tDynamic("app.schedule.empty");
      return;
    }
    schedList.innerHTML = list
      .map((s, i) => `<div class="sched-row"><span class="mono">${tDynamic("app.schedule.step", { tick: s.at })}</span><span>${describeSched(s)}</span><button type="button" class="quiet" data-sched-i="${i}" aria-label="${tDynamic("app.schedule.remove")}">×</button></div>`)
      .join("");
  }

  root.querySelector("#btn-sched-add")!.addEventListener("click", () => {
    const at = Math.max(0, Math.round(Number(schedAt.value) || 0));
    const [kind, key] = schedAction.value.split(":");
    const arg = Number(schedArg.value);
    if (!kind || !key || !Number.isFinite(arg)) {
      ctx.status(tDynamic("app.schedule.incomplete"));
      return;
    }
    const w = ctx.current();
    let op: ScheduledOp["op"];
    if (kind === "scale") op = { type: "scale", field: key as FieldName, k: arg };
    else if (kind === "params") {
      if (key === "mutationRate") op = { type: "params", params: { mutationRate: Math.max(0, Math.min(1, arg)) } };
      else if (key === "maxPopulation") op = { type: "params", params: { maxPopulation: Math.max(16, Math.round(arg)) } };
      else op = { type: "params", params: { reproduceEnergy: Math.max(0.05, arg) } };
    } else {
      op = { type: "paint", x: Math.floor(w.w / 2), y: Math.floor(w.h / 2), radius: 4, brush: key as BrushKind, amount: arg };
    }
    ctx.host.apply({ kind: "schedule", which: ctx.sideOf(w), schedule: [...w.schedule, { at, op }] });
    schedListKey = "";
    refreshScheduleList();
    ctx.drawCharts();
    ctx.status(tDynamic("app.schedule.added", { op: describeSched({ at, op }), tick: at }));
  });
  schedList.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-sched-i]");
    if (!btn) return;
    const i = Number(btn.dataset.schedI);
    const w = ctx.current();
    const next = w.schedule.filter((_, k) => k !== i);
    ctx.host.apply({ kind: "schedule", which: ctx.sideOf(w), schedule: next });
    schedListKey = "";
    refreshScheduleList();
    ctx.drawCharts();
  });
  refreshScheduleList();

  return { refresh: refreshScheduleList };
}
