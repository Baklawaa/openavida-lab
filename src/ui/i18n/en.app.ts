/**
 * English copy for the application wiring (see app.fr.ts for the same keys).
 */
export const APP_EN = {
  /* focus and kits ----------------------------------------------------------- */
  "app.focus.restore": "Restore the full interface",
  "app.focus.enlarge": "Enlarge the visualisation",
  "app.kit.traits": "Light {light} · Uptake {uptake} · Resist. {resist}",
  "app.view.hint3d": "Drag: rotate · Wheel: zoom · Click: active tool",

  /* shared session ----------------------------------------------------------- */
  "app.mp.enable": "Turn on the shared session to open a room.",

  /* DNA editor --------------------------------------------------------------- */
  "app.dna.selectFirst": "Select an organism with Inspect first, or place one with this genome.",
  "app.dna.applied": "Genome applied to the selection: a new lineage was created.",
  "app.dna.placeHint": "Click in the world to place an organism with this genome.",
  "app.dna.envCell": "Cell environment ({x}, {y})",
  "app.dna.envCenter": "Centre environment ({x}, {y})",

  /* recipe ------------------------------------------------------------------- */
  "app.recipe.loaded.one": "Recipe loaded: {count} action.",
  "app.recipe.loaded.many": "Recipe loaded: {count} actions.",

  /* species and strains ------------------------------------------------------ */
  "app.strain.genomeLoaded": "Genome of “{label}” loaded. Click a free cell to place it.",
  "app.inject.count": "{n} organisms injected into world {world}.",
  "app.strain.colorStrain": "Organism colour: founding strain.",
  "app.strain.colorGuild": "Organism colour: guild and lineage.",
  "app.strain.heatOff": "Presence map hidden.",
  "app.strain.heatOn": "Presence map: strain {id}.",
  "app.mutation.missing": "Mutation sequence missing (older snapshot).",
  "app.mutation.loaded": "Mutation at step {tick} · {kind} · genome compared with the parent.",

  /* explorer ----------------------------------------------------------------- */
  "app.explorer.genomeCompared": "Genome of {label} loaded, compared with the reference.",
  "app.explorer.genomeLoaded": "Genome of {label} loaded into the editor.",

  /* leaderboard -------------------------------------------------------------- */
  "app.leaderboard.empty": "<p class=\"muted\">No living organism.</p>",
  "app.leaderboard.head": "Fitness {fitness} · Energy {energy}",
  "app.leaderboard.traits": "Lineage {lineage} · Light {light} · Uptake {uptake}",
  "app.leaderboard.useDna": "Edit this DNA",

  /* events feed -------------------------------------------------------------- */
  "app.events.empty": "<p class=\"muted\">No event yet.</p>",
  "app.events.tick": "Step {tick}",

  /* death log ---------------------------------------------------------------- */
  "app.deaths.tally": "{label}: {count}",
  "app.deaths.none": "<span class=\"muted\">No death yet</span>",
  "app.deaths.empty": "<p class=\"muted\">No death recorded.</p>",
  "app.deaths.row": "Step {tick} · No. {org} · Lineage {lineage} · Fitness {fitness}",

  /* tool hints --------------------------------------------------------------- */
  "app.hint.place": "Click a free cell: places an organism with the editor genome.",
  "app.hint.paint": "Click or drag: applies the selected brush.",
  "app.hint.inspect": "Click an organism: genome, phenotype, metabolism.",

  /* inspect panel ------------------------------------------------------------ */
  "app.inspect.none": "NONE",
  "app.inspect.clickOrganism": "Click an organism in the world.",
  "app.inspect.number": "No. {id}",
  "app.inspect.energy": "Energy<b>{value}</b>",
  "app.inspect.fitness": "Fitness <b>{value}</b>",
  "app.inspect.identity": "Lineage {lineage} · Position ({x}, {y}) · Parent {parent}",
  "app.inspect.founder": "founder",
  "app.inspect.body": "Mass {mass} % · Effective size {size} (genome {genome}) · Age {age}",
  "app.inspect.dead": "This organism is no longer alive. See the death log below.",
  "app.inspect.gone": "This organism is no longer alive.",
  "app.inspect.selectFirst": "Select an organism first.",

  /* charts and stage --------------------------------------------------------- */
  "app.chart.lineageTitle": "Lineage no. {id} · born at step {born} · {count} alive (max {peak})",
  "app.charts.show": "Show",
  "app.charts.hide": "Collapse",
  "app.charts.world": "WORLD {world} · HISTORY",
  "app.stage.side": "{side} · {count} organisms{selected}",
  "app.stage.selected": " · selected",
  "app.stage.world": "WORLD {world}",

  /* world editing ------------------------------------------------------------ */
  "app.place.done": "Organism placed at ({x}, {y}).",
  "app.place.blocked": "This cell is blocked by a barrier.",
  "app.readout.cell": "({x}, {y}) · Nutr. {nutrient} · Tox. {toxin} · Temp. {temperature} · Light {light} · Exs. {exudate}",

  /* playback ----------------------------------------------------------------- */
  "app.playback.resumeAria": "Resume the simulation",
  "app.playback.pauseAria": "Pause the simulation",
  "app.playback.followed": "Followed session",
  "app.playback.paused": "Paused",
  "app.playback.running": "Running",

  /* timeline ----------------------------------------------------------------- */
  "app.timeline.label": "step {tick} (recorded every {every})",
  "app.timeline.kb": "{kb} KB",
  "app.timeline.mb": "{mb} MB",
  "app.timeline.budget.one": "{count} snapshot · {size} / {cap} MB",
  "app.timeline.budget.many": "{count} snapshots · {size} / {cap} MB",
  "app.timeline.none": "No snapshot at this point.",
  "app.timeline.resumed": "World {world} resumed at step {tick}.",

  /* environment switches ----------------------------------------------------- */
  "app.terrain.on": "Random terrain: sources, barriers and shade added.",
  "app.terrain.off": "Preset terrain removed.",
  "app.disturb.on": "Random disturbances enabled.",
  "app.disturb.off": "Random disturbances disabled.",

  /* schedule ----------------------------------------------------------------- */
  "app.schedule.scale": "× {k} on {field}",
  "app.schedule.params": "parameters",
  "app.schedule.paint": "brush {brush} r={radius}",
  "app.schedule.inject": "inject {count}",
  "app.schedule.place": "place ({x},{y})",
  "app.schedule.strain": "strain {name}",
  "app.schedule.empty": "<p class=\"muted\">No entry.</p>",
  "app.schedule.step": "step {tick}",
  "app.schedule.remove": "Remove",
  "app.schedule.incomplete": "Incomplete schedule.",
  "app.schedule.added": "Schedule: {op} at step {tick}.",

  /* field legend ------------------------------------------------------------- */
  "app.legend.all": "<i class=\"dot nutrient\"></i>Nutrient <i class=\"dot toxin\"></i>Toxin <i class=\"dot light\"></i>Light",
  "app.legend.nutrient": "Nutrient <span class=\"legend-scale nutrient-scale\"></span> low → high",
  "app.legend.toxin": "Toxin <span class=\"legend-scale toxin-scale\"></span> low → high",
  "app.legend.temperature": "Temperature <span class=\"legend-scale temperature-scale\"></span> cold → hot",
  "app.legend.light": "Light <span class=\"legend-scale light-scale\"></span> low → high",
  "app.legend.exudate": "Exudate <span class=\"legend-scale\"></span> low → high",

  /* world state -------------------------------------------------------------- */
  "app.snapshot.info": "World {world} · step {tick} · {count} organisms",
  "app.snapshot.saved": "State remembered. You can restore it from Experiment.",
  "app.snapshot.restored": "World restored at step {tick}.",
  "app.bottleneck.done": "Bottleneck: {n} organisms kept.",
  "app.reseed.done": "Worlds A and B reset with seed {seed}.",

  /* sharing and export ------------------------------------------------------- */
  "app.share.copied": "Configuration link copied. To share the current state, export the world.",
  "app.manifest.none": "No run to describe: start a targeted experiment, then export its manifest.",
  "app.manifest.exported": "Manifest exported: {name} · {replicates} replicates · {digest}.",
  "app.eventsExport.empty": "Event log empty: turn on “Event log” and let the simulation run.",
  "app.eventsExport.done": "{count} events exported.",
  "app.eventsLog.on": "Event log enabled (bounded, JSONL export).",
  "app.eventsLog.off": "Event log disabled.",

  /* import ------------------------------------------------------------------- */
  "app.import.done": "World imported successfully.",
  "app.import.failed": "Import failed: choose a JSON file exported from OpenAvida.",

  /* editor and selection ----------------------------------------------------- */
  "app.dna.opened": "DNA of organism {id} opened in the editor. Edit it, then apply it or place a new organism.",
  "app.dna.loaded": "DNA of organism {id} loaded into the editor.",
  "app.dna.loadedGeneric": "DNA loaded: edit it or place a new organism.",
  "app.inject.added": "{n} organisms added to world {world}.",

  /* runtime ------------------------------------------------------------------ */
  "app.error.runtime": "Runtime error: {message}",
} as const;
