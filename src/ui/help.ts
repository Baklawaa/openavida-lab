/**
 * Control help for the lab: every labelled control advertises its copy through
 * the `data-help` attribute, so the tooltip, the attribute and the catalog can
 * never disagree. The strings live in the locale catalogs (src/ui/i18n).
 */
import { helpFor, helpIds } from "./i18n/runtime";

/** Ids that carry a help text, in catalog order. */
export const LAB_CONTROL_IDS: readonly string[] = helpIds();

/** The active locale's help map, as plain data (used by the browser probes). */
export function controlHelp(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of LAB_CONTROL_IDS) out[id] = helpFor(id);
  return out;
}

export function attachControlHelp(root: ParentNode, tip: HTMLElement): number {
  let attached = 0;
  for (const id of LAB_CONTROL_IDS) {
    const node = root.querySelector("#" + id);
    if (!node) continue;
    const text = helpFor(id);
    node.setAttribute("title", text);
    node.setAttribute("data-help", text);
    attached++;
  }
  const show = (ev: Event) => {
    const el = (ev.target as HTMLElement | null)?.closest?.("[data-help]") as HTMLElement | null;
    if (!el || (el instanceof HTMLDetailsElement && !(ev.target as HTMLElement).closest("summary"))) { tip.hidden = true; return; }
    const text = el.getAttribute("data-help") ?? "";
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const x = Math.min(r.left, Math.max(8, window.innerWidth - 308));
    const y = r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.min(y, window.innerHeight - 80)}px`;
  };
  const hide = (ev: Event) => {
    const next = (ev as PointerEvent).relatedTarget as HTMLElement | null;
    if (next && next.closest && next.closest("[data-help]")) return;
    tip.hidden = true;
  };
  root.addEventListener("pointerover", show);
  root.addEventListener("focusin", show);
  root.addEventListener("pointerout", hide);
  root.addEventListener("focusout", () => { tip.hidden = true; });
  root.addEventListener("click", () => { tip.hidden = true; });
  return attached;
}
