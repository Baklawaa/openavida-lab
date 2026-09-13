/**
 * Model parameter panel (Milieu).
 *
 * The form is generated from PARAM_SPEC, so a parameter added to the spec
 * appears here, in the query string and in the generated documentation at the
 * same time. Values are clamped by the spec on the way back in; only the
 * parameters the user actually changed are sent to the host.
 */
import { PARAM_SPEC, type ParamGroup, type ParamSpec, type SimParams } from "../sim/index";
import { helpFor, modelGroupTitle, paramDescription, paramLabel, paramUnit, tDynamic } from "./i18n/runtime";

export const MODEL_GROUPS: readonly ParamGroup[] = [
  "world",
  "metabolism",
  "ecology",
  "chemistry",
  "evolution",
];

/**
 * Values that restore the shape of the pre-upgrade engine. Not promised to be
 * bit-identical to tag engine-v1: the meal budget and the decoder differ.
 */
export const LEGACY_V1_PROFILE: Partial<SimParams> = {
  senescenceRate: 0,
  regulationEnabled: false,
  recombinationRate: 0,
  exudateLeak: 0,
  genomeUpkeep: 0,
  replicationCost: 0,
  maxMealsPerTick: 8,
  kinThreshold: 0.1,
  dilutionRate: 0,
  lightDiffusion: 0.22,
};

export interface ModelControl {
  spec: ParamSpec;
  value: number | boolean;
}

/** One control per spec entry, in display order. */
export function modelControls(params: SimParams): ModelControl[] {
  return PARAM_SPEC.map((spec) => ({ spec, value: params[spec.key] }));
}

/**
 * Coerce raw form values back to a parameter patch. Values are bounded by the
 * spec here, not written through, so the panel cannot put the world into a
 * state the specification calls invalid (the host clamps again at the op
 * boundary).
 */
export function paramsFromForm(
  raw: Readonly<Record<string, string>>,
  booleans: ReadonlySet<string>,
): Partial<SimParams> {
  const patch: Record<string, number | boolean> = {};
  for (const spec of PARAM_SPEC) {
    const value = raw[spec.key];
    if (booleans.has(spec.key)) {
      patch[spec.key] = value === "1" || value === "true";
      continue;
    }
    if (value === undefined || value.trim() === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const clamped = Math.min(spec.max, Math.max(spec.min, spec.integer ? Math.round(n) : n));
    patch[spec.key] = clamped;
  }
  return patch as Partial<SimParams>;
}

export interface ModelPanelOptions {
  status: (message: string) => void;
  params: () => SimParams;
  apply: (patch: Partial<SimParams>, target: "A" | "B" | "both") => void;
}

export class ModelPanel {
  private readonly host: HTMLElement;

  constructor(host: HTMLElement, private readonly opts: ModelPanelOptions) {
    this.host = host;
    this.render();
    this.refresh();
    this.host.querySelector("#model-apply")!.addEventListener("click", () => this.applyFromForm());
    this.host.querySelector("#model-reset")!.addEventListener("click", () => {
      const defaults: Partial<SimParams> = {};
      for (const spec of PARAM_SPEC) (defaults as Record<string, unknown>)[spec.key] = spec.default;
      this.opts.apply(defaults, this.target());
      this.refresh();
      this.opts.status(tDynamic("model.status.reset"));
    });
    this.host.querySelector("#model-legacy")!.addEventListener("click", () => {
      this.opts.apply(LEGACY_V1_PROFILE, this.target());
      this.refresh();
      this.opts.status(tDynamic("model.status.legacy"));
    });
    // Keep the control help catalog honest: every control advertises its text.
    for (const id of ["model-target", "model-apply", "model-reset", "model-legacy"]) {
      const el = this.host.querySelector<HTMLElement>("#" + id);
      const text = helpFor(id);
      if (el && text && text !== `help.${id}`) {
        el.setAttribute("title", text);
        el.setAttribute("data-help", text);
      }
    }
  }

  private target(): "A" | "B" | "both" {
    const select = this.host.querySelector<HTMLSelectElement>("#model-target");
    const value = select?.value;
    return value === "A" || value === "B" ? value : "both";
  }

  private input(spec: ParamSpec): HTMLInputElement | null {
    return this.host.querySelector<HTMLInputElement>(`[data-param="${spec.key}"]`);
  }

  private render(): void {
    const groups = MODEL_GROUPS.map((group) => {
      const specs = PARAM_SPEC.filter((spec) => spec.group === group);
      if (specs.length === 0) return "";
      const rows = specs
        .map((spec) => {
          const control =
            spec.kind === "boolean"
              ? `<input type="checkbox" data-param="${spec.key}" id="param-${spec.key}">`
              : `<input type="number" data-param="${spec.key}" id="param-${spec.key}" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
          const label = paramLabel(spec.key);
          const description = paramDescription(spec.key);
          return `<label class="model-row" for="param-${spec.key}" title="${description}"><span>${label}<small>${description}</small></span><span class="model-input">${control}<em>${paramUnit(spec.unit)}</em></span></label>`;
        })
        .join("");
      return `<div class="model-group"><h3>${modelGroupTitle(group)}</h3>${rows}</div>`;
    }).join("");
    this.host.innerHTML = `${groups}
      <div class="row model-actions">
        <select id="model-target" aria-label="${tDynamic("model.target.aria")}">
          <option value="both">${tDynamic("model.target.both")}</option>
          <option value="A">${tDynamic("model.target.worldA")}</option>
          <option value="B">${tDynamic("model.target.worldB")}</option>
        </select>
        <button type="button" id="model-apply">${tDynamic("model.apply")}</button>
        <button type="button" id="model-reset">${tDynamic("model.reset")}</button>
        <button type="button" id="model-legacy">${tDynamic("model.legacy")}</button>
      </div>`;
  }

  /** Copy the current world parameters into the form. */
  refresh(): void {
    const params = this.opts.params() as unknown as Record<string, number | boolean>;
    for (const spec of PARAM_SPEC) {
      const el = this.input(spec);
      if (!el) continue;
      const value = params[spec.key];
      if (spec.kind === "boolean") el.checked = Boolean(value);
      else el.value = String(value);
    }
  }

  /** Send only the parameters that differ from the current world. */
  applyFromForm(): void {
    const raw: Record<string, string> = {};
    const booleans = new Set<string>();
    for (const spec of PARAM_SPEC) {
      const el = this.input(spec);
      if (!el) continue;
      if (spec.kind === "boolean") {
        booleans.add(spec.key);
        raw[spec.key] = el.checked ? "1" : "0";
      } else {
        raw[spec.key] = el.value;
      }
    }
    const patch = paramsFromForm(raw, booleans) as Record<string, unknown>;
    const current = this.opts.params() as unknown as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (patch[key] !== current[key]) changed[key] = patch[key];
    }
    if (Object.keys(changed).length === 0) {
      this.opts.status(tDynamic("model.status.none"));
      return;
    }
    const target = this.target();
    this.opts.apply(changed as Partial<SimParams>, target);
    this.refresh();
    const who = target === "both" ? tDynamic("model.target.both") : tDynamic("model.target.worldOf", { world: target });
    const count = Object.keys(changed).length;
    this.opts.status(tDynamic(count > 1 ? "model.status.applied.many" : "model.status.applied.one", { n: count, target: who }));
  }
}
