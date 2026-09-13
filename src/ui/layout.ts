/** Presentation only: simulation state and event handlers live in app.ts. */
import { DNA_KITS } from "../sim/kits";
import { LOCALES, kitDescription, kitLabel, kitShort, locale, t } from "./i18n/runtime";

export function icon(name: string): string {
  const paths: Record<string, string> = {
    life: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="2"/><path d="m15 8 1 1m-2 7 1-1M7 15h1"/>',
    leaf: '<path d="M20 4C8 2 2 9 6 16s16 0 14-12Z"/><path d="m4 20 11-11M9 15v-4m0 4h4"/>',
    inspect: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5m-14-10h7m-3.5-3.5v7"/>',
    paint: '<path d="m14 3 7 7-10 10H4v-7Z M10 7l7 7M4 20h16"/>',
    chart: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    step: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
    save: '<path d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8"/>',
    share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>',
    expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    shield: '<path d="m12 3 8 3v5c0 6-8 10-8 10S4 17 4 11V6Z M8 12l3 3 5-6"/>',
    hunt: '<path d="m13 2-8 12h7l-1 8 8-12h-7Z"/>',
    mutual: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a5 5 0 0 0 0 10h3"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    dna: '<path d="M7 3c0 5 10 7 10 12M17 3c0 5-10 7-10 12M7 21c0-3 2-4 5-5M17 21c0-3-2-4-5-5M8 7h8M8 17h8"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
    warn: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5m0 3h.01"/>',
    revert: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    groups: '<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M9.5 9.5 11 13m3.5-3.5L13 13"/>',
  };
  return `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.life}</svg>`;
}

export interface KitCopy {
  label: string;
  short: string;
  description: string;
  icon: string;
}

/** Icons are presentation, so they stay with the layout; the copy is catalogued. */
const KIT_ICON: Record<string, string> = {
  phototroph: "sun",
  heterotroph: "leaf",
  resistant: "shield",
  predator: "hunt",
  mutualist: "mutual",
};

/** Presentation copy of every starter kit, in the active locale. */
export const KIT_COPY: Record<string, KitCopy> = Object.fromEntries(
  DNA_KITS.map((kit) => [
    kit.id,
    {
      label: kitLabel(kit.id),
      short: kitShort(kit.id),
      description: kitDescription(kit.id),
      icon: KIT_ICON[kit.id] ?? "life",
    },
  ]),
);

/** Options of the language picker, with the active locale selected. */
function languageOptions(): string {
  const active = locale();
  return LOCALES.map((code) => {
    const label = code === "fr" ? t("shell.lang.fr") : t("shell.lang.en");
    return `<option value="${code}"${code === active ? " selected" : ""}>${label}</option>`;
  }).join("");
}

export function createLabLayout(root: HTMLElement) {
  root.innerHTML = `
    <header class="top">
      <a class="brand" href="#" aria-label="OpenAvida Lab">${icon("life")}<span>OpenAvida<span class="brand-lab">LAB</span></span></a>
      <span class="header-divider"></span><span class="header-subtitle">${t("shell.subtitle")}</span>
      <div class="spacer"></div>
      <select id="lang-select" class="lang-select" aria-label="${t("shell.lang.aria")}">${languageOptions()}</select>
      <button id="btn-help" class="icon-button" aria-label="${t("shell.help.aria")}">${icon("help")}</button>
      <button id="btn-share" class="quiet">${icon("share")}<span>${t("shell.share")}</span></button>
      <button id="btn-json">${icon("save")}<span>${t("shell.export")}</span></button>
    </header>
    <main class="workspace" aria-label="${t("main.aria")}">
      <section class="metrics" aria-label="${t("metrics.aria")}">
        <div class="metric"><span>${t("metric.population")}</span><b id="m-pop">0</b><small>${t("metric.population.unit")}</small></div>
        <div class="metric"><span>${t("metric.lineages")}</span><b id="m-lin">0</b><small>${t("metric.lineages.unit")}</small></div>
        <div class="metric violet"><span>${t("metric.diversity")}</span><b id="m-h">0.000</b><small>Shannon H′</small></div>
        <div class="metric amber"><span>${t("metric.fitness")}</span><b id="m-fit">0.000</b><small>${t("metric.fitness.unit")}</small></div>
      </section>
      <section class="world-panel" aria-label="${t("world.aria")}">
        <div class="world-toolbar">
          <div class="segmented world-switch" aria-label="${t("world.switch.aria")}">
            <button id="view-A" data-view="A" class="view active" aria-pressed="true">${t("world.A")}</button>
            <button id="view-B" data-view="B" class="view" aria-pressed="false">${t("world.B")}</button>
            <button id="view-split" data-view="split" class="view" aria-pressed="false">A / B</button>
          </div>
          <span id="world-size" class="tiny world-size">128 × 128</span>
          <div class="segmented field-toolbar" role="group" aria-label="${t("world.layers.aria")}">
            <button id="fm-0" data-fm="0" class="fm active" aria-pressed="true">${t("layer.all")}</button>
            <button id="fm-1" data-fm="1" class="fm" aria-pressed="false"><i class="dot nutrient"></i><span>${t("field.nutrient")}</span></button>
            <button id="fm-2" data-fm="2" class="fm" aria-pressed="false"><i class="dot toxin"></i><span>${t("field.toxin")}</span></button>
            <button id="fm-3" data-fm="3" class="fm" aria-pressed="false"><i class="dot temperature"></i><span>${t("field.temperature")}</span></button>
            <button id="fm-4" data-fm="4" class="fm" aria-pressed="false"><i class="dot light"></i><span>${t("field.light")}</span></button>
            <button id="fm-5" data-fm="5" class="fm" aria-pressed="false"><i class="dot diversity"></i><span>${t("field.exudate")}</span></button>
          </div>
          <div class="spacer"></div>
          <span id="run-state" class="run-state"><i></i> ${t("runstate.playing")}</span>
          <div class="segmented"><button id="view-2d" class="active" aria-pressed="true">2D</button><button id="view-3d" aria-pressed="false">3D</button></div>
          <button id="btn-focus" class="icon-button" aria-label="${t("world.focus.aria")}" aria-pressed="false">${icon("expand")}</button>
        </div>
        <div class="stage">
          <div class="viz"><canvas id="gl" aria-label="${t("stage.2d.aria")}"></canvas><canvas id="gl-trail" aria-hidden="true"></canvas><canvas id="gl3d" aria-label="${t("stage.3d.aria")}"></canvas><div id="mp-cursors"></div></div>
          <div class="stage-label" id="stage-label">MONDE A</div><div class="stage-label stage-label-b" id="stage-label-b" hidden>MONDE B</div>
          <div class="empty-world" id="empty-world"><span class="empty-icon">${icon("life")}</span><div><h2>${t("empty.title")}</h2><p>${t("empty.hint")}</p></div><button id="btn-start" class="primary">${icon("plus")}${t("btn.inject")}</button></div>
          <div class="viz-hud" role="group" aria-label="${t("hud.aria")}">
            <button id="tool-inspect" aria-pressed="false">${icon("inspect")}<span>${t("tool.inspect")}</span><kbd>I</kbd></button>
            <button id="tool-place" class="active" aria-pressed="true">${icon("plus")}<span>${t("tool.place")}</span><kbd>O</kbd></button>
            <button id="tool-paint" aria-pressed="false">${icon("paint")}<span>${t("tool.paint")}</span><kbd>P</kbd></button>
          </div>
          <div class="stage-notes"><span id="field-legend" class="field-legend"><i class="dot nutrient"></i>${t("field.nutrient")} <i class="dot toxin"></i>${t("field.toxin")} <i class="dot light"></i>${t("field.light")}</span><span id="field-note" class="field-note"></span></div>
          <div id="cell-readout" class="cell-readout" hidden></div>
        </div>
        <div class="playback-stack">
        <div class="playback">
          <button id="btn-pause" class="primary">${icon("pause")}<span>${t("btn.pause")}</span></button>
          <button id="btn-step-once" class="icon-button" aria-label="${t("btn.step.aria")}">${icon("step")}</button>
          <span class="tick-counter">${t("playback.tick")} <b id="m-tick">0</b></span>
          <span id="view-hint" class="view-hint">${t("playback.hint")}</span>
          <div class="speed-ctl"><label for="speed-top">${t("playback.speed")}</label><input id="speed-top" type="range" min="0" max="60" step="1" value="2"><b id="spd-lab-top">2 /s</b><button id="btn-slow" class="quiet">×1</button></div>
          <div class="zoom-ctl"><label for="zoom-top">${t("playback.zoom")}</label><input id="zoom-top" type="range" min="30" max="100" step="1" value="100"><b id="zoom-lab-top">100%</b></div>
        </div>
        <div id="timeline-row">
          <button type="button" id="btn-timeline-first" class="icon-button" aria-label="${t("timeline.first.aria")}">⏮</button>
          <button type="button" id="btn-timeline-prev" class="icon-button" aria-label="${t("timeline.prev.aria")}">◀</button>
          <div class="timeline-track">
            <input id="timeline-range" type="range" min="0" max="0" value="0" step="1" aria-label="${t("timeline.range.aria")}">
            <div id="timeline-marks" aria-hidden="true"></div>
          </div>
          <button type="button" id="btn-timeline-next" class="icon-button" aria-label="${t("timeline.next.aria")}">▶</button>
          <button type="button" id="btn-timeline-resume">${t("timeline.resume")}</button>
          <span id="timeline-label" class="tiny">${t("timeline.label", { tick: 0, every: 25 })}</span>
          <span id="timeline-budget" class="tiny"></span>
        </div>
        </div>
      </section>
      <section class="charts-section" aria-label="${t("charts.aria")}">
        <div class="section-heading"><h2>${t("charts.title")}</h2><span id="chart-world" class="tiny">${t("charts.world", { world: "A" })}</span><button id="btn-charts" class="quiet" aria-expanded="true">${t("btn.charts.collapse")}</button></div>
        <div class="charts">
          <article class="chart-card"><div class="chart-heading"><h3>${t("chart.fitness")}</h3><span><i class="dot nutrient"></i>${t("chart.mean")} <i class="dot light"></i>${t("chart.max")}</span></div><canvas id="chart-fit" role="img" aria-label="${t("chart.fit.aria")}"></canvas></article>
          <article class="chart-card"><div class="chart-heading"><h3>${t("chart.diversity")}</h3><span><i class="dot diversity"></i>Shannon H′</span></div><canvas id="chart-shan" role="img" aria-label="${t("chart.shannon.aria")}"></canvas></article>
          <article class="chart-card"><div class="chart-heading"><h3>${t("chart.lineageTree")}</h3><span>${t("chart.ancestry")}</span></div><canvas id="chart-phy" role="img" aria-label="${t("chart.phy.aria")}"></canvas></article>
        </div>
      </section>
    </main>
    <aside class="side" aria-label="${t("side.aria")}">
      <div class="side-tabs" role="tablist" aria-label="${t("tabs.aria")}">
        <button id="tab-organisms" data-panel="organisms" role="tab" aria-controls="panel-organisms" aria-selected="true" class="active">${icon("life")}${t("tab.organisms")}</button>
        <button id="tab-environment" data-panel="environment" role="tab" aria-controls="panel-environment" aria-selected="false" tabindex="-1">${icon("paint")}${t("tab.environment")}</button>
        <button id="tab-analysis" data-panel="analysis" role="tab" aria-controls="panel-analysis" aria-selected="false" tabindex="-1">${icon("chart")}${t("tab.analysis")}</button>
        <button id="tab-species" data-panel="species" role="tab" aria-controls="panel-species" aria-selected="false" tabindex="-1">${icon("groups")}${t("tab.species")}</button>
        <button id="tab-experiment" data-panel="experiment" role="tab" aria-controls="panel-experiment" aria-selected="false" tabindex="-1">${icon("settings")}${t("tab.experiment")}</button>
      </div>
      <div class="side-scroll">
        <div id="panel-organisms" role="tabpanel" aria-labelledby="tab-organisms">
          <section class="block"><div class="section-heading"><h2>${t("panel.organisms.kits")}</h2><span class="tag">${t("panel.organisms.kits.tag")}</span></div><p class="muted" id="place-hint">${t("panel.organisms.hint")}</p><div id="dna-kits" class="kit-grid"></div>
            <div class="kit-description"><span class="eyebrow">${t("panel.organisms.kitSelected")}</span><p id="kit-blurb"></p><div id="kit-traits" class="kit-focus"></div></div>
            <button id="btn-inject" class="primary full">${icon("plus")}${t("btn.inject")}</button>
          </section>
          <section class="block dna-editor" id="dna-editor" aria-label="${t("panel.dna.aria")}"></section>
        </div>
        <div id="panel-environment" role="tabpanel" aria-labelledby="tab-environment" hidden>
          <section class="block"><div class="section-heading"><h2>${t("panel.environment.title")}</h2><span class="tag">${t("panel.environment.tag")}</span></div><p class="muted">${t("panel.environment.hint")}</p><div class="brush-grid" id="brushes"></div><div class="range-label"><label for="radius">${t("panel.environment.radius")}</label><span><b id="rad-lab">3</b> ${t("unit.cells")}</span></div><input id="radius" type="range" min="0" max="12" value="3"></section>
          <section class="block"><h2>${t("panel.environment.dynamics")}</h2><label class="toggle-row" id="opt-terrain"><span>${t("opt.terrain")}<small>${t("opt.terrain.hint")}</small></span><input type="checkbox"></label><label class="toggle-row" id="opt-disturb"><span>${t("opt.disturb")}<small>${t("opt.disturb.hint")}</small></span><input type="checkbox"></label></section>
          <section class="block" id="schedule-block">
            <div class="section-heading"><h2>${t("panel.schedule.title")}</h2><span class="tag">${t("panel.schedule.tag")}</span></div>
            <p class="muted">${t("panel.schedule.hint")}</p>
            <div class="goal-row">
              <input id="sched-at" type="number" min="1" step="1" value="50" aria-label="${t("sched.at.aria")}">
              <select id="sched-action" aria-label="${t("sched.action.aria")}">
                <option value="scale:nutrient">${t("sched.scale.nutrient")}</option>
                <option value="scale:toxin">${t("sched.scale.toxin")}</option>
                <option value="scale:temperature">${t("sched.scale.temperature")}</option>
                <option value="scale:light">${t("sched.scale.light")}</option>
                <option value="params:mutationRate">${t("sched.params.mutationRate")}</option>
                <option value="params:maxPopulation">${t("sched.params.maxPopulation")}</option>
                <option value="params:reproduceEnergy">${t("sched.params.reproduceEnergy")}</option>
                <option value="paint:toxinBlob">${t("sched.paint.toxinBlob")}</option>
                <option value="paint:nutrientBlob">${t("sched.paint.nutrientBlob")}</option>
              </select>
              <input id="sched-arg" type="number" step="0.05" value="0.5" aria-label="${t("sched.arg.aria")}">
              <button type="button" id="btn-sched-add">${t("btn.sched.add")}</button>
            </div>
            <div id="sched-list"></div>
          </section>
          <section class="block" id="model-panel"><div class="section-heading"><h2>${t("panel.model.title")}</h2><span class="tag">${t("panel.model.tag")}</span></div><p class="muted">${t("panel.model.hint")}</p><div id="model-form"></div></section>
          <section class="block info-note">${icon("sun")}<p>${t("panel.environment.note")}</p></section>
        </div>
        <div id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" hidden>
          <section class="block"><div class="section-heading"><h2>${t("panel.analysis.selected")}</h2><span class="tag" id="selection-tag">${t("tag.none")}</span></div><div id="inspect-meta" class="muted">${t("panel.analysis.hint")}</div><div id="inspect-phenotype"></div><div class="row inspect-actions" id="inspect-actions" hidden><button id="btn-edit-selected">${icon("dna")}<span>${t("btn.editSelected")}</span></button><button id="btn-ancestry">${icon("chart")}<span>${t("btn.ancestry")}</span></button></div><details class="inspect-detail"><summary>${t("panel.analysis.genomeGenes")}</summary><div id="inspect-genome"></div><div id="browser-wrap"><canvas id="gbrowser"></canvas></div><div id="inspect-genes"></div></details><details class="inspect-detail"><summary>${t("panel.analysis.metabolism")}</summary><div id="inspect-pathways"></div><div id="inspect-brain"></div></details></section>
          <section class="block"><div class="section-heading"><h2>${t("panel.explorer.title")}</h2><span class="tag">${t("panel.explorer.tag")}</span></div><p class="muted">${t("panel.explorer.hint")}</p><button id="btn-explorer" class="primary full">${icon("inspect")}${t("btn.explorer")}</button></section>
          <section class="block">
            <div class="section-heading"><h2>${t("panel.events.title")}</h2><span class="tag" id="event-count">0</span></div>
            <div id="event-log" class="feed"></div>
          </section>
          <section class="block"><div class="section-heading"><h2>${t("panel.research.title")}</h2><span class="tag">${t("panel.research.tag")}</span></div><div id="research-body"></div></section>
          <section class="block"><h2>${t("panel.leaderboard.title")}</h2><div id="leaderboard" class="feed"></div></section>
          <section class="block"><h2>${t("panel.deaths.title")}</h2><div id="death-tally" class="death-tally"></div><div id="death-log" class="feed"></div></section>
          <section class="block"><details><summary>${t("panel.codon.title")}</summary><p class="muted">${t("panel.codon.hint")}</p><div class="mapping-legend" id="legend"></div></details></section>
        </div>
        <div id="panel-species" role="tabpanel" aria-labelledby="tab-species" hidden></div>
        <div id="panel-experiment" role="tabpanel" aria-labelledby="tab-experiment" hidden>
          <div id="panel-goals"></div>
          <section class="block"><h2>${t("panel.restore.title")}</h2><p class="muted">${t("panel.restore.hint")}</p><div class="row"><button id="btn-snap">${icon("save")}${t("btn.snap")}</button><button id="btn-restore" disabled>${t("btn.restore")}</button></div><p id="snapshot-info" class="micro">${t("snapshot.none")}</p></section>
          <section class="block"><h2>${t("panel.worlds.title")}</h2><p class="muted">${t("panel.worlds.hint")}</p><div class="row"><button id="btn-step-a">${t("btn.step.a")}</button><button id="btn-step-b">${t("btn.step.b")}</button><button id="btn-step-both">${t("btn.step.both")}</button></div></section>
          <section class="block"><h2>${t("panel.newRun.title")}</h2><label class="tiny" for="seed">${t("seed.label")}</label><div class="row"><input id="seed" type="number"><button id="btn-reseed">${t("btn.reseed")}</button></div><p class="micro">${t("panel.newRun.hint")}</p><button id="btn-bottle" class="danger">${t("btn.bottle")}</button></section>
          <section class="block"><h2>${t("panel.data.title")}</h2><div class="row"><button id="btn-csv">${t("btn.csv")}</button><button id="btn-phylo">${t("btn.phylo")}</button><button id="btn-events">${t("btn.events")}</button><button id="btn-manifest">${t("btn.manifest")}</button><button id="btn-manifest-import">${t("btn.manifestImport")}</button><button id="btn-oav">${icon("save")}<span>${t("btn.oav")}</span></button><button id="btn-import">${t("btn.import")}</button></div><input id="import-file" type="file" accept="application/json,.json,.oav,application/octet-stream" hidden><input id="manifest-file" type="file" accept="application/json,.json" hidden><label class="toggle-row" id="opt-events"><span>${t("opt.events")}<small>${t("opt.events.hint")}</small></span><input type="checkbox"></label></section>
          <section class="block"><details><summary>${t("panel.experimental")}</summary><label class="toggle-row" id="opt-view3d"><span>${t("opt.view3d")}</span><input type="checkbox"></label><label class="toggle-row" id="opt-brains"><span>${t("opt.brains")}<small>${t("opt.brains.hint")}</small></span><input type="checkbox"></label><label class="toggle-row" id="opt-llm"><span>${t("opt.llm")}<small>${t("opt.llm.hint")}</small></span><input type="checkbox"></label><label class="toggle-row" id="opt-mp"><span>${t("opt.mp")}<small>${t("opt.mp.hint")}</small></span><input type="checkbox"></label><div id="mp-panel" class="stack"><label for="mp-room">${t("mp.room")}</label><input id="mp-room" type="text" value="lab"><label for="mp-role">${t("mp.role")}</label><select id="mp-role"><option value="host">${t("mp.role.host")}</option><option value="experimenter">${t("mp.role.experimenter")}</option><option value="spectator">${t("mp.role.spectator")}</option></select><div class="row"><button id="btn-mp-host">${t("btn.mp.host")}</button><button id="btn-mp-join">${t("btn.mp.join")}</button></div><div id="mp-peers" class="muted"></div></div></details></section>
          <section class="block diagnostics"><span>${t("diag.fixation")} <b id="m-fix">—</b></span><span>${t("diag.extinctions")} <b id="m-ex">0</b></span><span>${t("diag.ms")} <b id="m-ms">—</b></span></section>
        </div>
      </div>
    </aside>
    <footer class="status-bar"><span id="status-line" role="status" aria-live="polite">${t("status.ready")}</span><span id="m-seed" class="mono"></span><span class="keyboard-hint"><kbd>Espace</kbd> ${t("footer.keyboard")}</span></footer>
    <dialog id="help-dialog"><form method="dialog"><button class="close-dialog" aria-label="${t("guide.close.aria")}">×</button></form><span class="eyebrow">${t("guide.eyebrow")}</span><h2>${t("guide.title")}</h2><ol><li>${t("guide.step1")}</li><li>${t("guide.step2")}</li><li>${t("guide.step3")}</li></ol><div class="shortcut-grid"><span><kbd>Espace</kbd> ${t("guide.pause")}</span><span><kbd>I</kbd> ${t("guide.inspect")}</span><span><kbd>O</kbd> ${t("guide.place")}</span><span><kbd>P</kbd> ${t("guide.paint")}</span><span><kbd>1–5</kbd> ${t("guide.layers")}</span><span><kbd>S</kbd> ${t("guide.snap")}</span></div><p class="muted">${t("guide.footer")}</p><p class="muted" id="guide-reduced-motion">${t("guide.reducedMotion")}</p></dialog>
    <dialog id="explorer-dialog" class="explorer-dialog" aria-label="${t("explorer.dialog.aria")}"></dialog>
  `;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  root.querySelectorAll<HTMLButtonElement>("button:not([type])").forEach(b => b.type = b.closest("form") ? "submit" : "button");
  return {
    header: get<HTMLElement>(".top"), viz: get<HTMLDivElement>(".viz"), stage: get<HTMLDivElement>(".stage"),
    canvas: get<HTMLCanvasElement>("#gl"), canvas3d: get<HTMLCanvasElement>("#gl3d"),
    hud: get<HTMLDivElement>(".viz-hud"), cursors: get<HTMLDivElement>("#mp-cursors"), side: get<HTMLElement>(".side"),
    charts: get<HTMLDivElement>(".charts"), cFit: get<HTMLCanvasElement>("#chart-fit"), cShan: get<HTMLCanvasElement>("#chart-shan"), cPhy: get<HTMLCanvasElement>("#chart-phy"),
  };
}
