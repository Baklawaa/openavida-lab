// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS, PARAM_SPEC, type SimParams } from "../../src/sim/index";
import { LEGACY_V1_PROFILE, MODEL_GROUPS, ModelPanel } from "../../src/ui/modelPanel";

/**
 * DOM contract of the Milieu -> Modèle form. The panel is generated from
 * PARAM_SPEC, so this test pins the wiring — one control per spec in group
 * order, spec bounds on every input, only edited parameters sent, defaults and
 * legacy profile — that the browser gate then exercises on the running app.
 */

function mount(params: SimParams = DEFAULT_PARAMS) {
  const host = document.createElement("div");
  document.body.append(host);
  const apply = vi.fn();
  const status = vi.fn();
  const panel = new ModelPanel(host, { status, apply, params: () => params });
  return { host, panel, apply, status };
}

const input = (host: HTMLElement, key: string) => host.querySelector<HTMLInputElement>(`[data-param="${key}"]`)!;

describe("model panel DOM", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one control per spec, grouped in display order, bounded by the spec", () => {
    const { host } = mount();
    const controls = [...host.querySelectorAll<HTMLInputElement>("[data-param]")];
    expect(controls).toHaveLength(PARAM_SPEC.length);
    expect(new Set(controls.map((c) => c.dataset.param))).toEqual(new Set(PARAM_SPEC.map((s) => s.key)));

    const groups = [...host.querySelectorAll(".model-group h3")].map((h) => h.textContent);
    expect(groups).toHaveLength(MODEL_GROUPS.length);

    for (const spec of PARAM_SPEC) {
      const el = input(host, spec.key);
      expect(el.id, spec.key).toBe(`param-${spec.key}`);
      if (spec.kind === "boolean") {
        expect(el.type, spec.key).toBe("checkbox");
        expect(el.checked, spec.key).toBe(Boolean(spec.default));
      } else {
        expect(el.type, spec.key).toBe("number");
        expect(el.value, spec.key).toBe(String(spec.default));
        expect(el.min, spec.key).toBe(String(spec.min));
        expect(el.max, spec.key).toBe(String(spec.max));
        expect(el.step, spec.key).toBe(String(spec.step));
      }
    }
  });

  it("applies only the edited parameters, to the selected world", () => {
    const { host, apply, status } = mount();
    host.querySelector<HTMLSelectElement>("#model-target")!.value = "A";
    input(host, "mutationRate").value = "0.5";
    input(host, "nutrientInflow").value = "0.01";
    host.querySelector<HTMLElement>("#model-apply")!.click();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toEqual({ mutationRate: 0.5, nutrientInflow: 0.01 });
    expect(apply.mock.calls[0]![1]).toBe("A");
    expect(status.mock.calls[0]![0]).toContain("monde A");
  });

  it("says so and sends nothing when no parameter was edited", () => {
    const { host, apply, status } = mount();
    host.querySelector<HTMLElement>("#model-apply")!.click();
    expect(apply).not.toHaveBeenCalled();
    expect(status.mock.calls[0]![0]).toContain("Aucun paramètre modifié");
  });

  it("restores the published defaults, or the legacy v1 profile, on request", () => {
    const legacy = { ...DEFAULT_PARAMS, senescenceRate: 0, regulationEnabled: false, maxMealsPerTick: 8 };
    const { host, apply } = mount(legacy);
    host.querySelector<HTMLSelectElement>("#model-target")!.value = "both";

    host.querySelector<HTMLElement>("#model-reset")!.click();
    expect(apply).toHaveBeenCalledTimes(1);
    const defaults = apply.mock.calls[0]![0] as Record<string, unknown>;
    for (const spec of PARAM_SPEC) expect(defaults[spec.key], spec.key).toBe(spec.default);

    host.querySelector<HTMLElement>("#model-legacy")!.click();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toEqual(LEGACY_V1_PROFILE);
  });

  it("copies the world parameters into the form on refresh", () => {
    const params = { ...DEFAULT_PARAMS, mutationRate: 0.03, disturbances: true };
    const { host, panel } = mount(params);
    input(host, "mutationRate").value = "0.9";
    panel.refresh();
    expect(input(host, "mutationRate").value).toBe("0.03");
    expect(input(host, "disturbances").checked).toBe(true);
  });
});
