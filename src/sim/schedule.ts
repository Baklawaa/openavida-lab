/**
 * Scheduled environment changes: applied inside World.step when tick === at,
 * after disturbances and before organisms act. An empty list is a no-op, so
 * the seeded core hash is unchanged.
 */
import type { FieldName } from "./fields";
import { FIELD_NAMES } from "./fields";
import { normalizeParams } from "./params";
import { applyRecipeOp, isRecipeOp, type RecipeOp } from "./recipe";
import type { SimParams } from "./types";
import type { World } from "./world";

export type ScheduleParams = Partial<Pick<SimParams, "mutationRate" | "maxPopulation" | "reproduceEnergy" | "disturbances">>;

export type ScheduleAction =
  | RecipeOp
  | { type: "scale"; field: FieldName; k: number }
  | { type: "params"; params: ScheduleParams };

export interface ScheduledOp {
  at: number;
  op: ScheduleAction;
}

export function isScheduleAction(v: unknown): v is ScheduleAction {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type === "scale") {
    return typeof o.k === "number" && Number.isFinite(o.k) && typeof o.field === "string" && (FIELD_NAMES as readonly string[]).includes(o.field);
  }
  if (o.type === "params") {
    return !!o.params && typeof o.params === "object";
  }
  return isRecipeOp(v);
}

export function isScheduledOp(v: unknown): v is ScheduledOp {
  if (!v || typeof v !== "object") return false;
  const o = v as { at?: unknown; op?: unknown };
  return typeof o.at === "number" && Number.isFinite(o.at) && isScheduleAction(o.op);
}

export function copySchedule(list: readonly ScheduledOp[]): ScheduledOp[] {
  return list.map((item) => {
    if (item.op.type === "params") return { at: item.at, op: { type: "params", params: { ...item.op.params } } };
    return { at: item.at, op: { ...item.op } as ScheduleAction };
  });
}

export function applyScheduledOp(world: World, item: ScheduledOp): void {
  const op = item.op;
  if (op.type === "scale") {
    const arr = world.fields[op.field];
    const k = op.k;
    if (!Number.isFinite(k)) return;
    for (let i = 0; i < arr.length; i++) arr[i] = arr[i]! * k;
    return;
  }
  if (op.type === "params") {
    Object.assign(world.params, normalizeParams({ ...world.params, ...op.params }));
    if (op.params.disturbances !== undefined) world.disturbances = Boolean(op.params.disturbances);
    return;
  }
  if (op.type === "step") return;
  applyRecipeOp(world, op);
}
