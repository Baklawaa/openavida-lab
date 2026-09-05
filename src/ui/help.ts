/**
 * Hover copy for lab controls. UI attach and Vitest both import this map —
 * do not duplicate strings in markup.
 */
export const CONTROL_HELP: Record<string, string> = {
  "speed-top": "Simulation speed in ticks per second. 0 pauses; 2 is slow enough to watch; 60 is the old full-rate.",
  "zoom-top": "How much of the 128×128 plate you see. 100% is the whole world (no camera chase).",
  "paint-toggle": "Inspect mode: click an organism to read its genome. Shift-drag always paints with the current brush.",
  "genome-edit": "Editable ACGT sequence. ORFs from ATG to TAA/TAG/TGA become named genes. Edits stay until you Apply or Inject.",
  "btn-point": "Point mutation: change exactly one base in the editor sequence.",
  "btn-indel": "Insertion or deletion of 1–3 bases (frameshift). Uses the editor, not the plate.",
  "btn-dup": "Copy a short contiguous subsequence and insert it (gene duplication).",
  "btn-apply": "Write the editor sequence into the selected organism and start a new lineage (lab CRISPR).",
  founder: "Pick a designed starter genome (phototroph, heterotroph, resistant, predator, mutualist).",
  "btn-load-founder": "Load the chosen founder genome into the editor without injecting yet.",
  "btn-inject": "Place 24 copies of the editor genome onto the current world as one strain.",
  radius: "Brush radius in cells when painting terrain or fields (Shift-drag on the plate).",
  speed: "Same speed control as the top bar: ticks per second for this view.",
  "btn-pause": "Pause or resume the clock. Space does the same. The world stays inspectable.",
  "btn-slow": "Jump speed to 2 ticks/s — slow enough to see births, deaths, and field flow.",
  "btn-step-once": "Advance exactly one tick then stay paused (single-step the experiment).",
  "view-A": "Show world A only. A and B share params but different seeds.",
  "view-B": "Show world B only — an independent replicate for A/B comparison.",
  "view-split": "Split view: world A on the left, world B on the right.",
  "btn-step-a": "Step world A one tick without touching B.",
  "btn-step-b": "Step world B one tick without touching A.",
  "btn-step-both": "Step A and B once each.",
  "btn-snap": "Snapshot the current world (fields, genomes, RNG) so you can restore it.",
  "btn-restore": "Rewind to the last snapshot. Same seed+params stay deterministic.",
  "btn-bottle": "Bottleneck: keep a random 10% of organisms (seeded), simulating a crash.",
  seed: "Integer seed for a new run. Same seed and params replay the same trajectory.",
  "btn-reseed": "Rebuild both A and B from the seed field (B uses a derived seed).",
  "btn-share": "Copy a URL with seed and params so someone else can replay this setup.",
  "btn-json": "Download a full JSON snapshot (organisms, fields, phylogeny, fitness history).",
  "btn-csv": "Download metrics over time as CSV (fitness, Shannon, lineages, extinctions).",
  "btn-phylo": "Download the phylogeny table (parent lineage, born/extinct ticks, counts).",
  "btn-import": "Load a previously exported JSON snapshot into the current world.",
  "fm-0": "Composite overlay: nutrient, toxin, temperature, and light together.",
  "fm-1": "Show only the nutrient field (teal).",
  "fm-2": "Show only the toxin field (magenta).",
  "fm-3": "Show only temperature (blue cold → orange hot).",
  "fm-4": "Show only light (gold).",
  "brush-nutrientBlob": "Paint a nutrient blob onto the field (food, not a permanent vent).",
  "brush-toxinBlob": "Paint toxin into the field.",
  "brush-heatBlob": "Raise local temperature.",
  "brush-lightBlob": "Boost local light.",
  "brush-barrier": "Paint walls organisms cannot cross; diffusion will not go through.",
  "brush-erase": "Clear terrain back to empty plate.",
  "brush-nutrientVent": "Place a lasting nutrient vent (source each tick).",
  "brush-toxinVent": "Place a lasting toxin vent.",
  "brush-thermalVent": "Place a lasting heat vent.",
  "brush-shade": "Shade: cuts incoming light.",
  "brush-wipeOrgs": "Kill organisms under the brush.",
};

export const LAB_CONTROL_IDS: readonly string[] = Object.keys(CONTROL_HELP);

export function attachControlHelp(root: ParentNode, tip: HTMLElement): number {
  let attached = 0;
  for (const id of LAB_CONTROL_IDS) {
    const node = root.querySelector("#" + id);
    if (!node) continue;
    const text = CONTROL_HELP[id]!;
    node.setAttribute("title", text);
    node.setAttribute("data-help", text);
    attached++;
  }
  const show = (ev: Event) => {
    const el = (ev.target as HTMLElement | null)?.closest?.("[data-help]") as HTMLElement | null;
    if (!el) return;
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
  return attached;
}
