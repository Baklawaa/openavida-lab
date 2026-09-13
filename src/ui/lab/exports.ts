/**
 * The data path of the experiment panel: the share link, the JSON / .oav /
 * metrics / phylogeny / manifest / event exports, the event-log toggle and the
 * world-file import. The download helpers are the only writers of user-visible
 * files; every button here reads the active world through the context.
 */
import {
  buildShareURL,
  encodeSnapshot,
  exportEventsJSONL,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  flagsToQuery,
  parseWorldBytes,
  provenanceOf,
} from "../../sim/index";
import { tDynamic } from "../i18n/runtime";
import type { LabContext } from "./context";

function saveBlob(filename: string, blob: Blob): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function download(filename: string, text: string, mime: string): void {
  saveBlob(filename, new Blob([text], { type: mime }));
}

/** Binary twin of download: the .oav container is an ArrayBuffer, not text. */
function downloadBytes(filename: string, bytes: ArrayBuffer, mime: string): void {
  saveBlob(filename, new Blob([bytes], { type: mime }));
}

export function createExports(ctx: LabContext): void {
  const { root, state, dual } = ctx;

  root.querySelector("#btn-share")!.addEventListener("click", async () => {
    const url = (() => {
      const base = buildShareURL(ctx.current().params);
      const f = flagsToQuery(state.flags);
      if (!f) return base;
      return base + (base.includes("?") ? "&" : "?") + f;
    })();
    try {
      await navigator.clipboard.writeText(url);
      ctx.status(tDynamic("app.share.copied"));
    } catch {
      ctx.status(url);
    }
    history.replaceState(null, "", "?" + url.split("?")[1]);
  });
  root.querySelector("#btn-json")!.addEventListener("click", () => {
    download(`openavida-t${ctx.current().tick}.json`, exportJSON(ctx.current()), "application/json");
  });
  root.querySelector("#btn-oav")!.addEventListener("click", () => {
    downloadBytes(`openavida-t${ctx.current().tick}.oav`, encodeSnapshot(ctx.current().snapshot()), "application/octet-stream");
  });
  root.querySelector("#btn-csv")!.addEventListener("click", () => {
    download(`openavida-metrics-t${ctx.current().tick}.csv`, exportMetricsCSV(ctx.current().history, provenanceOf(ctx.current())), "text/csv");
  });
  root.querySelector("#btn-phylo")!.addEventListener("click", () => {
    download(`openavida-phylo-t${ctx.current().tick}.csv`, exportPhylogenyCSV(ctx.current()), "text/csv");
  });
  root.querySelector("#btn-manifest")!.addEventListener("click", () => {
    const manifest = ctx.goals.manifest();
    if (!manifest) {
      ctx.status(tDynamic("app.manifest.none"));
      return;
    }
    download("openavida-manifest.json", JSON.stringify(manifest, null, 2), "application/json");
    ctx.status(tDynamic("app.manifest.exported", { name: manifest.name, replicates: manifest.run.replicates, digest: manifest.paramsDigest }));
  });
  root.querySelector("#btn-events")!.addEventListener("click", () => {
    const w = ctx.current();
    if (w.eventLog.length === 0) {
      ctx.status(tDynamic("app.eventsExport.empty"));
      return;
    }
    download(`openavida-events-t${w.tick}.jsonl`, exportEventsJSONL(w, provenanceOf(w)), "application/x-ndjson");
    ctx.status(tDynamic("app.eventsExport.done", { count: w.eventLog.length }));
  });
  const eventsBox = root.querySelector("#opt-events input") as HTMLInputElement;
  eventsBox.checked = dual.a.params.recordEvents;
  eventsBox.addEventListener("change", () => {
    ctx.host.apply({ kind: "setParams", which: ctx.sideOf(ctx.current()), params: { recordEvents: eventsBox.checked } });
    ctx.status(eventsBox.checked
      ? tDynamic("app.eventsLog.on")
      : tDynamic("app.eventsLog.off"));
  });
  const importFile = root.querySelector<HTMLInputElement>("#import-file")!;
  // The hidden input is a picker proxy, never a control of its own: the button
  // is its only way in and its only tab stop, so Enter or Space on the button
  // opens the picker without a stray focusable input in the row.
  importFile.tabIndex = -1;
  root.querySelector("#btn-import")!.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      // One import path for both world files: parseWorldBytes sniffs OAV2 vs JSON.
      const bytes = await file.arrayBuffer();
      ctx.host.apply({ kind: "restore", which: ctx.sideOf(ctx.current()), snapshot: parseWorldBytes(bytes) });
      ctx.selectOrganism(ctx.current(), -1);
      ctx.status(tDynamic("app.import.done"));
      ctx.refreshMetrics();
    } catch {
      ctx.status(tDynamic("app.import.failed"));
    } finally {
      (ev.target as HTMLInputElement).value = "";
    }
  });
}
