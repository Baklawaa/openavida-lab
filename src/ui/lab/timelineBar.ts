/**
 * The timeline row under the plate: the recorded-snapshot range, its tick marks,
 * the label and the memory budget, plus the cursor preview and the resume
 * button. createTimelineBar wires the row and returns the two closures the rest
 * of the app calls — refresh() from the metrics cadence and preview() from the
 * event feed — so the range, marks and budget keep one per-mount handle.
 */
import { worldFromSnapshot } from "../../sim/index";
import { tDynamic } from "../i18n/runtime";
import type { LabContext } from "./context";

/** What the timeline row hands back to the app for the context. */
export interface TimelineBar {
  refresh(): void;
  preview(tick: number): Promise<void>;
}

export function createTimelineBar(ctx: LabContext): TimelineBar {
  const { root, state } = ctx;
  const timelineRange = root.querySelector<HTMLInputElement>("#timeline-range")!;
  const timelineMarks = root.querySelector("#timeline-marks")!;
  const timelineLabel = root.querySelector("#timeline-label")!;
  const timelineBudget = root.querySelector("#timeline-budget")!;

  function timelineEntries(): Array<{ tick: number; population: number; bytes: number }> {
    return ctx.current().timelineMeta?.entries ?? [];
  }

  function refreshTimeline(): void {
    const meta = ctx.current().timelineMeta;
    const entries = meta?.entries ?? [];
    const every = meta?.every ?? 25;
    const ticks = entries.map((e) => e.tick);
    const min = ticks.length ? ticks[0]! : 0;
    const max = ticks.length ? ticks[ticks.length - 1]! : 0;
    timelineRange.min = String(min);
    timelineRange.max = String(Math.max(min, max));
    if (document.activeElement !== timelineRange) {
      timelineRange.value = String(state.previewTick ?? ctx.viewWorld().tick);
    }
    const span = Math.max(1, max - min);
    timelineMarks.innerHTML = ticks.map((t) => `<i style="left:${((t - min) / span) * 100}%"></i>`).join("");
    const shown = state.previewTick ?? ctx.viewWorld().tick;
    timelineLabel.textContent = tDynamic("app.timeline.label", { tick: shown, every });
    if (meta) {
      const usedMo = meta.used / (1024 * 1024);
      const capMo = meta.budget / (1024 * 1024);
      const size = usedMo < 0.1
        ? tDynamic("app.timeline.kb", { kb: Math.round(meta.used / 1024) })
        : tDynamic("app.timeline.mb", { mb: usedMo.toFixed(1) });
      timelineBudget.textContent = tDynamic(entries.length > 1 ? "app.timeline.budget.many" : "app.timeline.budget.one", { count: entries.length, size, cap: capMo.toFixed(0) });
    } else timelineBudget.textContent = "";
  }

  async function previewTick(tick: number): Promise<void> {
    state.paused = true;
    ctx.updatePlayback();
    const entries = timelineEntries();
    if (!entries.length) return;
    let nearest = entries[0]!;
    let best = Math.abs(nearest.tick - tick);
    for (const e of entries) {
      const d = Math.abs(e.tick - tick);
      if (d < best || (d === best && e.tick < nearest.tick)) {
        nearest = e;
        best = d;
      }
    }
    state.previewTick = nearest.tick;
    timelineRange.value = String(nearest.tick);
    const snap = await ctx.host.snapshotAt(ctx.sideOf(ctx.current()), nearest.tick);
    if (!snap || state.previewTick !== nearest.tick) return;
    state.preview = worldFromSnapshot(snap);
    ctx.refreshMetrics();
  }

  timelineRange.addEventListener("input", () => {
    void previewTick(Number(timelineRange.value));
  });
  root.querySelector("#btn-timeline-first")!.addEventListener("click", () => {
    const entries = timelineEntries();
    if (entries[0]) void previewTick(entries[0].tick);
  });
  root.querySelector("#btn-timeline-prev")!.addEventListener("click", () => {
    const entries = timelineEntries();
    const cur = state.previewTick ?? ctx.viewWorld().tick;
    const prev = [...entries].reverse().find((e) => e.tick < cur);
    if (prev) void previewTick(prev.tick);
  });
  root.querySelector("#btn-timeline-next")!.addEventListener("click", () => {
    const entries = timelineEntries();
    const cur = state.previewTick ?? ctx.viewWorld().tick;
    const next = entries.find((e) => e.tick > cur);
    if (next) void previewTick(next.tick);
  });
  root.querySelector("#btn-timeline-resume")!.addEventListener("click", async () => {
    const tick = state.previewTick ?? Number(timelineRange.value);
    const snap = state.preview?.snapshot() ?? (await ctx.host.snapshotAt(ctx.sideOf(ctx.current()), tick));
    if (!snap) {
      ctx.status(tDynamic("app.timeline.none"));
      return;
    }
    const which = ctx.sideOf(ctx.current());
    ctx.host.apply({ kind: "restore", which, snapshot: snap });
    ctx.host.apply({ kind: "timeline", which, trimAfter: snap.tick });
    state.preview = null;
    state.previewTick = null;
    state.paused = true;
    ctx.selectOrganism(ctx.current(), -1);
    ctx.updatePlayback();
    ctx.paintFeeds();
    ctx.refreshMetrics();
    ctx.status(tDynamic("app.timeline.resumed", { world: which, tick: snap.tick }));
  });

  return { refresh: refreshTimeline, preview: previewTick };
}
