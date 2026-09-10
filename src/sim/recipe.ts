/**
 * Shareable, replayable setups: parameters plus a short op list.
 *
 * Encoding is base64url JSON in `?recipe=`. Payloads longer than
 * RECIPE_QUERY_MAX characters cannot live in the URL; the share helper
 * then falls back to the params-only link.
 */
import { buildShareURL } from "./serialize";
import { copySchedule, isScheduledOp, type ScheduledOp } from "./schedule";
import { BRUSH_KINDS, normalizeParams, type BrushKind, type SimParams } from "./types";
import { World } from "./world";

export const RECIPE_VERSION = 1;
export const RECIPE_QUERY_MAX = 6000;

export type RecipeOp =
  | { type: "paint"; x: number; y: number; radius: number; brush: BrushKind; amount?: number }
  | { type: "place"; x: number; y: number; genome: string }
  | { type: "inject"; genome: string; count: number; x?: number; y?: number }
  | { type: "strain"; name: string; genome: string }
  | { type: "step"; n: number };

export interface Recipe {
  version: 1;
  params: SimParams;
  ops: RecipeOp[];
  schedule?: ScheduledOp[];
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += B64[(n >> 6) & 63];
    out += B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += B64[(n >> 6) & 63];
  }
  return out;
}

function decodeBase64Url(s: string): string {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
  const clean = s.replace(/[^A-Za-z0-9\-_]/g, "");
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = table[clean.charCodeAt(i)] ?? -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function isBrush(v: unknown): v is BrushKind {
  return typeof v === "string" && (BRUSH_KINDS as readonly string[]).includes(v);
}

export function isRecipeOp(v: unknown): v is RecipeOp {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "paint":
      return [o.x, o.y, o.radius].every((n) => typeof n === "number" && Number.isFinite(n)) && isBrush(o.brush);
    case "place":
      return typeof o.x === "number" && typeof o.y === "number" && typeof o.genome === "string";
    case "inject":
      return typeof o.genome === "string" && typeof o.count === "number" && Number.isFinite(o.count);
    case "strain":
      return typeof o.name === "string" && typeof o.genome === "string";
    case "step":
      return typeof o.n === "number" && Number.isFinite(o.n);
    default:
      return false;
  }
}

export function parseRecipe(data: unknown): Recipe | null {
  if (!data || typeof data !== "object") return null;
  const o = data as { version?: unknown; params?: unknown; ops?: unknown };
  if (o.version !== RECIPE_VERSION || !o.params || typeof o.params !== "object" || !Array.isArray(o.ops)) return null;
  const ops = o.ops.filter(isRecipeOp);
  const schedule = Array.isArray((o as { schedule?: unknown }).schedule)
    ? ((o as { schedule: unknown[] }).schedule.filter(isScheduledOp))
    : undefined;
  return { version: 1, params: normalizeParams(o.params as Partial<SimParams>), ops, ...(schedule?.length ? { schedule } : {}) };
}

export function recipeFromWorld(world: World): Recipe {
  return {
    version: 1,
    params: { ...world.params, randomTerrain: world.randomTerrain, disturbances: world.disturbances },
    ops: world.recording ? world.recording.map((op) => ({ ...op })) : [],
    ...(world.schedule.length ? { schedule: copySchedule(world.schedule) } : {}),
  };
}

export function applyRecipeOp(world: World, op: RecipeOp): void {
  switch (op.type) {
    case "paint":
      world.paint(op.x, op.y, op.radius, op.brush, op.amount);
      break;
    case "place":
      world.birth(Math.round(op.x), Math.round(op.y), op.genome, null, false, 0.9);
      break;
    case "inject":
      world.injectStrain(op.genome, Math.max(0, Math.round(op.count)), op.x, op.y);
      break;
    case "strain":
      world.defineStrain(op.genome, { name: op.name, manual: true });
      break;
    case "step": {
      const n = Math.max(0, Math.round(op.n));
      for (let i = 0; i < n; i++) world.step();
      break;
    }
  }
}

/** Fresh world from `recipe.params`, then replay. Recording is restored to a copy of the ops. */
export function applyRecipe(recipe: Recipe): World {
  const w = new World(recipe.params);
  w.recording = null;
  if (recipe.schedule?.length) w.schedule = copySchedule(recipe.schedule);
  for (const op of recipe.ops) applyRecipeOp(w, op);
  w.recording = recipe.ops.map((op) => ({ ...op }));
  return w;
}

export function recipeToQuery(recipe: Recipe): string {
  return "recipe=" + encodeBase64Url(JSON.stringify(recipe));
}

export function recipeFromQuery(qs: string): Recipe | null {
  const cut = qs.indexOf("?");
  const raw = cut >= 0 ? qs.slice(cut + 1) : qs;
  const hash = raw.indexOf("#");
  const usp = new URLSearchParams(hash >= 0 ? raw.slice(0, hash) : raw);
  const enc = usp.get("recipe");
  if (!enc) return null;
  try {
    return parseRecipe(JSON.parse(decodeBase64Url(enc)));
  } catch {
    return null;
  }
}

export function buildRecipeShareURL(
  recipe: Recipe,
  origin?: string,
  path?: string,
): { url: string; truncated: boolean } {
  const q = recipeToQuery(recipe);
  const payload = q.slice("recipe=".length);
  if (payload.length > RECIPE_QUERY_MAX) {
    return { url: buildShareURL(recipe.params, origin, path), truncated: true };
  }
  const base =
    origin && path !== undefined
      ? origin + path
      : typeof location !== "undefined"
        ? location.origin + location.pathname
        : "https://openavida.lab/";
  return { url: `${base}?${q}`, truncated: false };
}
