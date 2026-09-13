/**
 * Contrast gate for the lab palette.
 *
 * The interface is dark and hand-tuned, so the text colours that carry copy —
 * on the panel background and on the metric cards — are measured against WCAG
 * AA (4.5:1 for normal text) instead of being trusted. src/style.css is the
 * source of truth: the custom properties are read from :root, the literal
 * colours from the rules that use them, and a `var()` reference is resolved
 * through the same table, so retuning the palette is what this test follows.
 *
 * The sRGB relative-luminance maths is spelled out here (no dependency) and
 * checked against known values, so a broken formula cannot quietly pass every
 * pair.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(resolve(root, "src/style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Declarations of every rule whose selector list contains `selector`. Nested
 * rules (the responsive @media blocks) are matched one by one, and a later
 * declaration wins, exactly as the cascade orders them.
 */
function declarations(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!rule[1]!.split(",").map((s) => s.trim()).includes(selector)) continue;
    for (const part of rule[2]!.split(";")) {
      const at = part.indexOf(":");
      if (at < 0) continue;
      out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
  }
  return out;
}

/** Custom properties of :root as hex colours, keyed without their leading dashes. */
const PALETTE: Record<string, string> = Object.fromEntries(
  Object.entries(declarations(":root"))
    .filter(([name, value]) => name.startsWith("--") && /^#[0-9a-f]{3,6}$/i.test(value))
    .map(([name, value]) => [name.slice(2), value]),
);

/** A palette token, e.g. `token("--panel")`. */
function token(name: string): string {
  const value = PALETTE[name.replace(/^--/, "")];
  if (!value) throw new Error(`src/style.css no longer defines ${name}`);
  return value;
}

/** The colour a rule declares, e.g. `ruleColor(".metric small")`. */
function ruleColor(selector: string, property = "color"): string {
  const value = declarations(selector)[property];
  if (!value) throw new Error(`src/style.css: ${selector} no longer declares ${property}`);
  return value;
}

/** Resolve `#rgb`, `#rrggbb` and `var(--x[, fallback])` to six hex digits. */
function colorOf(value: string): string {
  const named = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (named) return colorOf(PALETTE[named[1]!.slice(2)] ?? named[2] ?? "");
  const hex = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(hex)) throw new Error(`not a hex colour: "${value}"`);
  return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
}

/** The three sRGB channels of a colour, 0–255. */
function channels(value: string): [number, number, number] {
  const n = parseInt(colorOf(value).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB relative luminance, WCAG 2.x: linearise each channel, then weight it. */
function luminance(value: string): number {
  const [r, g, b] = channels(value).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two colours, from 1:1 to 21:1. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for normal-size text: 4.5:1. */
const AA_NORMAL = 4.5;

/** The side-panel surface every block inherits, and the metric-card surface. */
const PANEL = ruleColor(".side", "background");
const CARD = ruleColor(".metric", "background");
/** Buttons and inputs paint their own surface, one step lighter. */
const CONTROL = token("--panel-2");

interface Pair {
  /** What carries the copy, so a failure names it rather than two hex codes. */
  what: string;
  fg: string;
  bg: string;
}

/** Copy on the panel: headings, hints, tables, chips and control surfaces. */
const PANEL_CASES: readonly Pair[] = [
  { what: "panel body text", fg: token("--text"), bg: PANEL },
  { what: "panel muted copy (hints, labels, tables)", fg: token("--muted"), bg: PANEL },
  { what: "panel teal values", fg: token("--teal"), bg: PANEL },
  { what: "panel amber values", fg: token("--amber"), bg: PANEL },
  { what: "panel violet values", fg: token("--violet"), bg: PANEL },
  { what: "panel rose values", fg: token("--rose"), bg: PANEL },
  { what: "phenotype delta of an unchanged trait", fg: ruleColor(".trait-delta"), bg: PANEL },
  { what: "tag chip", fg: ruleColor(".tag"), bg: ruleColor(".tag", "background") },
  { what: "control text (buttons, inputs)", fg: token("--text"), bg: CONTROL },
  { what: "muted copy on a control surface", fg: token("--muted"), bg: CONTROL },
  { what: "sticky table header", fg: ruleColor(".ex-table th"), bg: ruleColor(".ex-table th", "background") },
];

/** Copy on the metric cards: same --panel surface, with its own literal greys. */
const METRIC_CASES: readonly Pair[] = [
  { what: "metric caption", fg: ruleColor(".metric > span"), bg: CARD },
  { what: "metric value (population)", fg: ruleColor(".metric b"), bg: CARD },
  { what: "metric unit", fg: ruleColor(".metric small"), bg: CARD },
  { what: "metric value (diversity)", fg: ruleColor(".metric.violet b"), bg: CARD },
  { what: "metric value (fitness)", fg: ruleColor(".metric.amber b"), bg: CARD },
];

describe("WCAG AA contrast of the lab palette", () => {
  it("parses the palette and the surfaces out of src/style.css", () => {
    for (const name of ["--bg", "--panel", "--panel-2", "--text", "--muted", "--teal", "--amber", "--rose", "--violet"]) {
      expect(token(name), name).toMatch(/^#[0-9a-f]{6}$/);
    }
    // The pairs below assume panel and metric cards share one surface: say so
    // here, where a rule that stopped parsing would otherwise make them vacuous.
    expect(colorOf(PANEL)).toBe(colorOf(token("--panel")));
    expect(colorOf(CARD)).toBe(colorOf(token("--panel")));
    expect(colorOf(ruleColor(".metric small"))).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("computes the WCAG ratio with the documented sRGB maths", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
    expect(luminance("#000000")).toBeCloseTo(0, 6);
    expect(luminance("#808080")).toBeCloseTo(0.2159, 3);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it.each([...PANEL_CASES, ...METRIC_CASES])("$what clears 4.5:1", ({ fg, bg }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
