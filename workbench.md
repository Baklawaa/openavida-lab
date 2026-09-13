# OpenAvida Lab — workbench

Evidence log for phase 1. Screenshots live in `workbench/`.

## What shipped

Isolated Vite + TypeScript + Vitest app at `openavida-lab/`. Sim core (`src/sim/`) is pure and seeded; WebGL/DOM are `src/render` + `src/app.ts`.

- Explicit ACGT genome, ORF scan (ATG…stop), codon table is the single source of truth for tests + genome browser + inspect panel
- Mutations: point, indel, duplication
- Phenotype: uptake, photo, resist, tpref, motility, aggression, signal, hue, fecundity, size — squash rules in `TRAIT_SPEC`
- Fitness: finite scalar of phenotype × {nutrient, toxin, temperature, light} + predation/mutualism
- 128×128 fields with 4-neighbor diffusion that does not cross barriers
- Ecology: competition (displacement), predation, mutualism, extinctions, Shannon, fixation, parent→child lineages
- Sandbox: paint, inject, bottleneck, snapshots, A/B worlds, shareable seed+params URL, JSON/CSV export
- WebGL2 plate (fields as RGBA texture + additive organism points), click-to-inspect, genome browser tracks, fitness / Shannon / phylogeny charts

Phase 2 hooks (comments only): 3D continuum, biochemistry, multiplayer, LLM brains.

## Pointer: kit after paint

`applyTool("place")` clears `paintMode`. `pointerAction` is what `onPointer` uses. Kit buttons call `selectKit` → `setTool("place")`. Test: paint then kit-select → action is place (`tests/pointer.test.ts`).

## Round: blank start + place DNA kits (2026-09-06)

- Default `startPopulation` 0, no random orbs. Launch `pop0=0`.
- `placeOrganismAt` + DNA kits (Phototroph / Heterotroph / Resistant / Predator / Mutualist). Launch placed one phototroph; inspect genome filled.
- Paint substances still via brushes; tools: inspect / paint / place.
- Hover catalog includes `tool-place` and `kit-*`.

## Round: less bloom, lasting dynamics, hover help (2026-09-06)

- Hover catalog `src/ui/help.ts` (`CONTROL_HELP`) attached as `title` + visible `#hover-tip`. Launch: pause and inject titles match the catalog; tip visible.
- Bloom: default `maxPopulation` 1800, crowding + scarcer photo, seasons, toxin pulses / drought / crashes after a delay. Dynamics test: 220 default `World.step`s stay **below cap**, Shannon **> 0.5** after tick 80, new lineage or extinction, late fitness not a constant.
- Visuals: organisms draw at ~58% cover so nutrient/toxin/light stay readable; full-plate zoom default (no chase).
- Step ~3.3 ms on 128×128 (`{SCRATCH}/perf.json`).

## Round: visual DNA editor + scientific copy (2026-09-06)

- `src/sim/dnaEdit.ts`: `annotateSequence` tiles the sequence into start/coding/stop/junk/open cells (mirrors `decodeGenome`, including the unclosed-ORF break), range ops, ORF-level ops (`bumpGene`, `setGeneStrength`, `moveGene`, `removeGene`, `appendGene`), `validateSequence`, `EditHistory` (undo/redo with `amend` for slider coalescing). Tests: `tests/dnaEdit.test.ts` (6).
- `src/ui/dnaEditor.ts` replaces the lossy block builder (blocks → regenerate genome) with sequence-first editing: gene cards, base strip with selection editing, codon palette, phenotype diff vs reference, warnings, raw textarea two-way. Ids kept for probes: `#genome-edit`, `#btn-point/indel/dup/apply`, `#founder`, `#btn-load-founder`, `#gene-add-*`, `.gene-chip .mono`, `[data-act]`, `#dna-builder`, `#dna-advanced`.
- Editor sync policy: `"select"` and `"apply"` load the editor; new `"peek"` (Place tool clicking an occupied cell, or after placing) does not. `load()` pushes history so a misclick is one undo away.
- Copy: removed taglines ("Façonnez votre monde", "La vie commence ici", footer motto); labels are now descriptive (kits show their cassettes, help dialog is a protocol).
- Gating: Vitest 77/77; `tools/verify-interface.mjs` extended (strip typing/undo/redo, codon insert, slider, minimap, pheno delta, `#btn-edit-selected`) passes at 5 sizes; `tools/launch.mjs` ×2 → 0 errors, `wipedByRaf=false`, `pointStuck=true`; `npm run build` ok.

## Round: plate-first workspace (2026-09-06)

User screenshot: on a wide, short window the plate got ~300 px and was stretched to the stage aspect; the empty-state overlay collided with the tool HUD.

- `layout()` letterboxes the 2D canvas to the world aspect (square, or 2:1 in A / B); 3D keeps the full stage.
- Workspace rows: 40 px metric strip · world · 156 px charts (heading + charts collapsible via `#btn-charts`, persisted in `localStorage["openavida.charts"]`). Heading row, metric cards, field toolbar row and caption row removed; field selector, run state and 2D/3D live in one toolbar; hint, speed and view zoom live in the playback bar; legend and cell readout are stage overlays.
- `wide-workspace` (workspace aspect > 1.9, > 900 px): charts stack in a column beside the plate.
- Empty state is a compact top card (button stays clickable, never under the HUD).
- Plate size at 1440×900: 237 px → 476 px (608 px with charts collapsed); at 2000×700: ~300 px stretched → 452 px square.

## Round: species tab (2026-09-06)

User question: organisms stuck around a thermal vent + nutrient source, then a sub-group expanded away. Needed per-group tracking with the changes that enabled it.

- `src/sim/species.ts`: strains (founding genome → `Organism.strainId`, inherited; `World.defineStrain` / `strainFor` / `renameStrain`), strategy classification (`strategyOf`), `groupStats`, innovations (`phenotypeChanges` at mutant birth, stored with local env; `innovationSpread` = living descendants of the lineage the mutation opened), `traitDrift`. Per-tick `strains` / `strategies` counts on `MetricsSample`. Snapshot v1 carries `strains` / `innovations`; legacy snapshots get founder tags rebuilt. No RNG use: perf hash still **9d4c0f2b**.
- `src/ui/speciesPanel.ts` + tab `#tab-species`: mode Souches / Stratégies, "Colorer le monde par souche" (`LabRenderer.colorByStrain`, 2D), `drawGroupSeries` chart, cards, strain definition from the editor, rename inline, Placer / +24 per strain. Kit genomes name their strain after the kit.
- Tests: `tests/species.test.ts` (7). Vitest 84/84, verify-interface OK, launch ×2 OK, build OK.

## Round: presets + goal-directed replicates (2026-09-06)

- Existing: in-memory restore point (session only) and JSON file export. Added `src/ui/presetStore.ts`: IndexedDB store of full snapshots (structured clone), memory fallback; list / save / load / remove; verified persisting across reload.
- `src/sim/goals.ts`: `GoalMetric` (population, lineages, shannon, meanFitness, trait mean/max, share-in-field ≥ min, strain count/share), `Goal` (op, target, sustain), `runTrial(snapshot, goal, config)` with per-trial seed + param overrides (mutationRate, maxPopulation, disturbances) applied to the trial world only, early stop on extinction, abortable progress callback, `summarizeTrials`, `replicateSeeds`. Tests `tests/goals.test.ts` (3): metrics, sustain, budget, determinism per seed, overrides isolation, extinction, abort, summary.
- `src/sim/goalWorker.ts` + `src/ui/goalRunner.ts`: worker pool (≤ cores−1, ≤ 6) with main-thread fallback; cancel terminates workers. Vite emits `goalWorker-*.js`.
- `src/ui/goalPanel.ts` in Expérience: presets block, start-state select, goal templates, metric builder (strain options follow the world), config grid, progress bars, summary, per-replicate chart with target line (`drawTrialSeries`), CSV, "Ouvrir dans B".
- E2E (Playwright, dev server): preset saved and listed → template "toxines" → 4 replicates (workers) → results + summary → open replicate in B → load preset into A → reload: preset persists → remove. 0 page errors. Vitest 87/87, perf hash 9d4c0f2b, verify-interface OK, launch ×2 OK, build OK.

## Task 0 — Baseline commit (2026-09-06)

No code changes. GATES on the uncommitted tree:

- `npx tsc --noEmit` ok
- `npx vitest run` 87/87, `lastHash":"9d4c0f2b"`
- `npm run build` emits `dist/` (html+css+js+goalWorker)
- `node tools/verify-interface.mjs` → Interface verified
- `node tools/launch.mjs http://127.0.0.1:5174/` exit 0, ×2, frac 1.0, inspect genome 49 bases

Did not include `.claude/` or `docs/archive/grok-gauntlet.md` (agent scratch, not product; the transcripts moved to `docs/archive/` in Stage 12).

## Task 1 — Parameter sweeps (2026-09-06)

- `SweepVariable`, `fieldScale` on `TrialConfig.overrides`, `worldForTrial` multiplies snapshot field copies only.
- `sweepValues` / `sweepConfigs` / `summarizeSweep`: seeds continue across values; count = values × replicates.
- Expérience → Balayage: variable, de/à/points, réplicats/valeur, table + `drawSweep` (médiane, bande min–max), CSV.
- Decision: default grid toxinScale 0.25–2, 5 points, 4 replicates; reuses `#goal-progress` and the same goal/budget as Expérience ciblée.

## Task 2 — Show the mutation (2026-09-06)

- `Innovation.parentGenome` / `genome` set at mutant birth, clipped to 384, optional on restore.
- `sequenceDiff`: one prefix/suffix hunk in the child (`sub`/`ins`/`del`). Internal matches inside the hunk are not split.
- DNA editor `load(seq, { diffAgainst })` outlines `.nt-diff`, compares phenotype to the parent.
- Espèces → Changements clés → « Voir la mutation » opens Organismes and scrolls the editor.
- Probe `window.__openavidaMutate(n)` steps with mutationRate 1 (test only). verify-interface asserts `#dna-strip .nt-diff` ≥ 1.

## Task 3 — Group trajectories over time (2026-09-06)

- `MetricsSample.strainTracks`: per strain `[cx, cy, spread, temperature, nutrient]`, 2-decimal, no RNG. Optional on snapshots.
- `strainTrack(history, id, every)` keeps every n-th row plus the last. Tests on a hand-built history and a two-organism centroid.
- Espèces (Souches): Trajectoires card — world-aspect centroid map (fade old→new, current disc, vent diamonds) + mean local T° (`drawTrackSeries`). Cards: « Déplacement du centre depuis le fondateur : n cellules ».
- Decision: letterbox the square world inside the 140 px-tall map so the path is not stretched on a wide card. Hidden in Stratégies mode.

## Task 4 — Scenario recipes (2026-09-06)

- `Recipe` v1: `params` + ops (`paint`, `place`, `inject`, `strain`, `step`). Consecutive `step` collapse. `World.recording` on (`[]`) after construct; `null` = off. Founder `birth`, `paint`, manual `defineStrain`, `injectStrain` (not the inner places), `step` append. `seedRandomTerrain` and inject internals muted so vents from the param are not double-recorded.
- `applyRecipe` builds a fresh world and replays; same seed → same `hashState()`. `?recipe=` base64url JSON; payload > 6000 → params-only URL (`truncated`).
- Expérience → Recette: toggle, op count, copy link / export / import / replay in B. `parseShareURL` path applies `?recipe=` to world A at startup.
- Decision: `worldFromSnapshot` clears recording so goal trials do not accumulate a step op. Toggle off drops the list; on again starts empty.

## Task 5 — Interface coverage (2026-09-06)

- `tools/verify-interface.mjs` (still one linear script): Espèces define/inject/color/stratégies/rename; presets save/load/remove to empty list; goal toxin template, 2×60, two `.goal-result`, `#goal-summary` « Réussite », Ouvrir dans B → `__openavida.world === "B"`, CSV download.
- Runtime ~8 s. Strain defined from the heterotroph kit so the card starts « non placée » (phototrophs already occupy the plate).

## Task 6 — Strain colors in 3D (2026-09-06)

- `View3D.colorByStrain` reads `world.strains.get(org.strainId)?.color` (same hex as 2D). `app.ts` sets it with the 2D renderer; a late-created 3D view copies the flag.
- `opt-color-strain` help now covers both surfaces. `launch.mjs ?view3d=1` still required.

## Task 7 — visible simulation in a worker (2026-09-06)

- `src/sim/simHost.ts`: `SimHost` interface, `SimOp` union and `applySimOp` (single implementation of every mutation: paint, place, inject, define/rename strain, replaceGenome, restore, replaceWorld, bottleneck, reseed, terrain preset, disturbances, brains, recording, setParams), `stepSides`, `frameFromWorld` / `applyFrame` (typed-array fields transferred; incremental history; lineages every 6th frame; innovations when their count changes), `InlineHost` (default; honours the 10 ms step budget).
- `src/sim/simWorker.ts` owns the authoritative `DualWorld`; every reply carries the request `seq`. `src/ui/workerHost.ts` keeps the mirror, applies ops optimistically, and after each frame replays the ops the worker has not yet acknowledged on the sides that frame overwrote (an earlier "drop stale frames" rule lost innovations/history rows because the worker's incremental bookkeeping assumes every frame is applied).
- `src/app.ts` no longer touches worlds directly: `host.apply(op)` / `host.step(which, n, budget)`; the rAF loop sends one step batch per frame with backpressure (`pendingSteps() < 2`). Panels mutate through app callbacks (`defineStrain` / `renameStrain` added to `SpeciesPanel` options). Probes: `__openavida.host`, `__openavidaStep(n)`, `__openavidaHash()`; `__openavidaMutate` is async.
- Flag `worker` in `src/sim/flags.ts` (`?worker=1`). Inline stays the default.
- Gates: Vitest 100/100 (`tests/simHost.test.ts` adds 4: op parity with direct calls by hash, frame round trip by hash, incremental history, InlineHost), perf hash **9d4c0f2b**; `tools/verify-worker.mjs` → identical hash in both hosts after 48 steps; `verify-interface.mjs` passes inline and with `?worker=1`; `launch.mjs` passes inline, `?worker=1`, and `?view3d=1&worker=1`; build emits `simWorker-*.js`.
- Known limits: multiplayer host snapshots and the room protocol read the mirror (not the authoritative snapshot); in worker mode `takeSnapshot` for restore points also reads the mirror (its RNG state is carried by frames, so it is exact between frames but can lag one batch).

## Round: predators feed, grow and hunt (2026-09-06)

User: « Les prédateurs devraient se nourrir et grossir en mangeant d'autres organismes. » Before: a kill gave `prey.energy × (0.35+0.4·agg)`, movement ignored prey, size was purely genetic, all organisms rendered at one size. Control run (96×96, 240 prey, 12 predators): every predator starved by step 50 with 8 kills total.

- `src/sim/body.ts`: `mass` (Organism, snapshot-compatible, default 0), `bodySize`, `maintenanceScale`, `huntingPower`, `preyGap` (genome-only eligibility), `feed` (energy + biomass bonus 0.45 × body, mass +0.22 +0.1·agg), `decayMass` (0.004/step), `energyCap`, `canBreed` (predators need mass ≥ 0.25).
- `src/sim/ecology.ts`: `nearestPrey` (radius 6 window), chemotaxis pulls predators toward it; `moveOrganisms` eats prey on entry and eats movers that walk into a predator; `params` passed for the threshold. `fitness`/`metabolicDelta` take a maintenance scale.
- Render: per-organism `aSize` attribute (stride 28) in `src/render/webgl.ts`; 3D column height uses `bodySize`. Inspect shows Corpulence · Taille effective · Âge.
- Iterations recorded by control sims (`scratch/pred-sim.ts`, `pred-causes.ts`): (1) sensing raised kills 8 → 41 but predators still starved (meal ≈ 16 steps of upkeep); (2) biomass bonus 0.12 → 0.45 made them grow (mass 0.66 mean) but 37/55 predator deaths were cannibalism from the mass bonus; (3) genome-only eligibility removed cannibalism; (4) breeding gate on mass. Final: 8 fed predators at step 100 (mass up to 1.0), 87 kills; boom-and-bust afterwards on a uniform plate.
- **Perf hash baseline changed deliberately: 9d4c0f2b → c2c03a81** (the perf world seeds predators). `tests/predation.test.ts` (6). Vitest 106/106; verify-interface, verify-worker (hash identical inline/worker), launch, build all green.

## Round: goal runs at scale (2026-09-06)

User: finish a replicate as soon as no organism is left; raise the replicate limit from 32 to 1000 even if runs take longer.

- Early stops in `runTrial`: extinction already ended a trial; added `goalUnreachable` (a "≥" goal on a strain with no living member) → `TrialResult.unreachable`, counted in `summarizeTrials` with P25/P75 quantiles.
- Throughput: start snapshot sent once per worker (`init` message) instead of once per replicate; pool = all cores but one (cap 16); progress messages every 50 ticks instead of 20.
- UI (`goalPanel.ts`): `MAX_REPLICATES` 1000, `MAX_SWEEP_REPLICATES` 200; DOM updates coalesced to one per 200 ms; aggregate progress bar with counts and ≤ 16 active bars instead of one bar per replicate; result list capped at 100 rows (CSV keeps all, with an `unreachable` column); chart draws an even sample of 100 curves.
- Load test (Playwright, 10-core laptop): 1000 replicates × 300 steps → 18.0 s, rAF interval mean 16.6 ms / max 17 ms during the run, 0 page errors. Vitest 106/106; verify-interface OK; build OK.

## Round: replay a replicate, full sortable table (2026-09-06)

User: after 1000 replicates with 6 successes, where do I put a seed to watch it? Then: show every result, sortable by fast/slow success and fast/slow failure.

- Replay: `GoalPanel.lastRun` keeps the run's start snapshot and configs; `replay(config)` builds `worldForTrial(snapshot, config).snapshot()` and the app replaces world B with it (`replaceWorld` op), pauses, and switches to B. Entry points: ▶ on each row, seed chips under the summary (with Copier), `#replay-seed` + `#btn-replay-seed` (any seed; uses the last run's parameters, or the form when nothing ran). `worldForTrial` now also sets `params.seed` to the replicate seed so the status bar and share link report it (`tests/goals.test.ts`).
- Table: `renderTable` builds all rows in one HTML string (rebuilt at most once per second during a run, once at the end); `compareResults` presets in `RESULT_SORTS`. Limits raised: 5000 replicates, 500 per sweep value.
- Checks: verify-interface asserts the replay fills the seed field, opens B paused with the replicate seed, and that sorting keeps every row. Browser replay check (phototrophs, population ≥ 40): the replayed seed reaches the goal at the same step as the trial. Load: 2000 × 200 steps → 16 s, table sort 19 ms, rAF ≤ 17 ms.

## Round: last run survives a reload (2026-09-06)

User reloaded after a 1000-replicate run, kept the CSV and a seed, and had no way to replay it. `PresetStore.saveLastRun` / `loadLastRun` store the run (start snapshot, goal, configs, results without final-state snapshots, curves for an even sample of 100) under a reserved id in the presets store (filtered out of `list()`). `GoalPanel.restoreLastRun` rebuilds table, sort, summary and replays on construction and labels the table note "course du … restaurée". verify-interface reloads mid-script and replays seed #1 from the restored run.

## Round: Expérience tab restructured, seeds validated (2026-09-06)

User screenshot: cramped goal builder, a 13-digit seed silently truncated by a number input (seeds are uint32), world B "empty" after replaying with the wrong seed and mutation 1. Changes: the goal block is five numbered steps (état de départ, objectif, paramètres, résultats, rejeu) with full-width selects and the field threshold on its own labelled row; seed inputs are text fields validated by `parseSeed` (digits, 1…4294967295) with an explicit refusal message; after a replay `#replay-info` states the start state, seed, parameters, what the replicate did in the run (step reached, extinction, budget) and how to play. Browser check: invalid seed refused; typed valid seed replays; Reprendre advances world B from tick 0 with the 24 organisms; verify-interface OK; Vitest 108/108 (`tests/goalPanel.test.ts` adds parseSeed + sort presets).

## Round: explorer, clickable lineage tree, saved organisms (2026-09-06)

User: make the lineage tree clickable to understand what happened; per replicate a catalogue of all organisms by species with precise filters (died fastest/slowest, best stats, most kills…); show how an organism got there with a tree and the biggest changes; save organisms locally with their branch and optionally the whole simulation.

- Sim: `Organism.kills` / `births` (set in `feed` and `birth`), `DeathRecord` gains `seq, age, kills, births, parentId, mass`; death log bounded at 4000/3000 (`DEATH_LOG_MAX/KEEP`) and mirrored incrementally in worker frames (`deathsSince`, `deathsFull`). `src/sim/lineageTree.ts` (chain, ancestry with innovations, subtree counts, descendants, biggest changes). `src/sim/catalog.ts` (entries for living + dead, filters, sort presets, grouping, records). Tests `tests/catalog.test.ts` (4).
- Render: `drawPhylogeny` returns hit rows and highlights a lineage; `phylogenyHitAt`; `LabRenderer.highlightLineage` rings the lineage on the plate.
- UI: `src/ui/explorer.ts` dialog (Organismes / Lignées / Enregistrés); `PresetStore` v2 with an `organisms` store (`SavedOrganism`: entry, ancestry, strain name, optional snapshot). Entry points: Analyse (Ouvrir l’explorateur, Évolution on the selected organism), click on `#chart-phy`, per-replicate catalogue buttons in Expérience (deterministic rebuild to the replicate's last step, chunked). Implemented with two Opus subagents (app/layout/CSS/help; goal panel) after the plan and the sim/explorer core were written here.
- Perf hash unchanged: counters draw no RNG.
- Arbre dessiné: the text branch was not enough to see who descends from whom, so the lineage graph is now drawn. `src/render/lineageTreeLayout.ts` holds a pure tidy layout (founder → focus trunk, sibling and descendant selection under a budget, extinct filtering, x = step, y = packed rows, no DOM and no canvas), unit-tested in `tests/lineageTreeLayout.test.ts`; `src/render/lineageTreeCanvas.ts` is the canvas view on top of it (device-pixel sizing, pan/zoom transform, hit testing for hover tooltip, click select and double-click re-centre). Both are wired into a fourth Explorateur tab **Arbre** (`#ex-tab-tree`: toolbar, canvas, detail pane), reachable from any organism or lineage record via `data-act="tree"`; its controls carry `CONTROL_HELP` entries and the flow is covered in `tools/verify-interface.mjs` inside the Explorateur block.

## Task 1 — Timeline scrubber (2026-09-07)

- `src/sim/timeline.ts`: cadence snapshots (default every 25), 150 MB budget, drop oldest after the origin, same-tick replace. Tests: spacing, eviction keeps tick 0, nearest (lower on a tie).
- Recording in `stepSides` / `applySimOp` on `DualWorld.timelineA/B`. Frames carry `timelineMeta`. `SimOp.timeline` sets `every` / `trimAfter`. `SimHost.snapshotAt`.
- UI `#timeline-row` under playback. Scrub pauses and previews a temp World; « Reprendre ici » restores + trims. Plate, charts, Espèces, Explorateur read `viewWorld()`.
- Decision: tick-0 snapshot is updated in place when the user places/injects before the first step, so rewind to origin is not an empty plate.

## Task 2 — Event log (2026-09-07)

- `src/sim/events.ts`: `detectEvents` is pure (flags carry the “once” memory). Kinds: lineage-dominant / collapse, first-predation, innovation-sweep, strain-extinct, population-crash/boom (±20 pas). Log bounded at 500, optional on snapshots, copied in frames.
- Analyse `#event-log`: last 40, newest first; click scrubs the timeline and opens the explorer on the lineage or strain.
- Tests: each kind fires exactly once on a synthetic world.

## Task 3 — Spatial trails and heat maps (2026-09-07)

- `OccupancyHeat`: per-strain Float32 occupancy, decay `exp(-1/200)`, no RNG, not in snapshots. Frames send the selected strain’s normalised map. `SimOp.heatStrain`.
- LabRenderer draws that map as an R8 texture under organisms. Espèces card « Carte de présence ». Selected organism: 120-cell trail polyline on `#gl-trail`.
- Trails omitted from snapshots (`delete copy.trail`). Heat rebuilt after restore.

## Task 4 — Multi-goal experiments (2026-09-07)

- `runTrial` accepts `Goal | Goal[]` (single-goal signature unchanged). `TrialResult.reachedTicks` is one entry per goal; `reachedTick` is the last of them when all hit, else the single-goal tick, else null. Stop when all are reached, the world is empty, or every remaining goal is unreachable.
- `summarizeTrials.perGoal` reports successes and median ticks per objective. Workers and `runReplicates` take the same union.
- UI: step 2 « + Ajouter un objectif » (max 4 = builder + extras). Table and CSV add one « Pas » column per goal; chart still traces goal 1. Last-run records store optional `goals`.
- Decision: extras are additional to the builder, not a replacement list, so a single-goal run still needs no click on Ajouter.
- Tests: two population goals at ticks 0 and 4; first reached then second strain-share unreachable stops at 3 steps of 200.
- GATES: tsc ok; vitest 127/127 `lastHash":"c2c03a81"`; build ok (goalWorker + simWorker); verify-interface inline and `?worker=1`; verify-worker hash `afbcc3ec`; launch.mjs exit 0. Screenshot `scratch/interface/multi-goal.png`.

## Task 5 — Strain tournaments (2026-09-07)

- `src/sim/tournament.ts`: `tournamentConfigs` emits one `TrialConfig` per unordered pair × replicates, with a recipe op list (`strain` + `inject` at left/right of the plate). Ops run inside `worldForTrial` after the replicate seed, so no RNG is drawn while building the list.
- `summarizeTournament`: win = larger founding-strain share; `|Δshare| ≤ 0.10` is a draw. Matrix is n×n with zeros on the diagonal.
- UI `#tournament-block` in Expérience: 2–4 contestants from live strains or saved organisms, replicates/pair, budget, colour matrix, CSV.
- Decision: identify contestants by founding genome (`foundingShare`), not by name, so a mutant still counts for its strain.
- GATES: tsc ok; vitest 129/129 `lastHash":"c2c03a81"`; build ok; verify-interface inline and `?worker=1`; verify-worker `afbcc3ec`; launch.mjs exit 0. Screenshot `scratch/interface/tournament-block.png`.

## Task 6 — Environment scripts (2026-09-07)

- `ScheduledOp = { at, op }` where `op` is a `RecipeOp`, `{ type: "scale"; field; k }` or `{ type: "params"; params }`. Applied in `World.step` after `applyDisturbances` and before organisms act. Empty list returns immediately: perf hash stays **c2c03a81**.
- Snapshots (optional `schedule`), recipes, frames, `SimOp.schedule`, `TrialConfig.schedule`. `applyRecipe` installs the programme before replaying ops so recorded steps fire it.
- UI Milieu « Programme »: pas / action / paramètre, add/remove through the host. Fitness chart: dashed vertical marks at scheduled ticks.
- Decision: skip `type: "step"` inside a scheduled op (would recurse). Identify scale vs params in the UI; paint blobs land at the plate centre.
- GATES: tsc ok; vitest 132/132 `lastHash":"c2c03a81"`; build ok; verify-interface inline and `?worker=1`; verify-worker `afbcc3ec`; launch.mjs exit 0. Screenshot `scratch/interface/schedule-panel.png`.

## Task 7 — Fitness landscape probe (2026-09-07)

- `src/sim/landscape.ts`: 61 sense codons × coding cells, skip identity and duplicate phenotypes, score with `fitness(..., zeroNeighbors)`. Returns top/bottom N with position, codon, trait deltas. No RNG.
- DNA editor `#dna-landscape`: env from the selected organism’s cell or the plate centre; click a hit → `replaceRange` + history.
- Tests: 61 sense, GAT→TAT on the phototroph raises photo, lists sorted, every hit is a coding cell.
- GATES: tsc ok; vitest 133/133 `lastHash":"c2c03a81"`; build ok; verify-interface inline and `?worker=1`; verify-worker `afbcc3ec`; launch.mjs exit 0. Screenshot `scratch/interface/landscape-desktop.png`.

## Task 8 — Genome alignment (2026-09-07)

- `alignSequences` in `dnaEdit.ts`: banded Needleman–Wunsch, match +1, mismatch −1, gap −1, band 48 (widened to `|n−m|` when lengths differ more). Returns gapped strings plus matches / mismatches / gaps / score.
- Explorateur: « Comparer à… » picker (organism id, saved, plate selection); two aligned DNA strips; « Charger la comparaison » → editor `diffAgainst`.
- Decision: widen the band to `|n−m|` so a global alignment always exists when lengths differ by more than 48.
- GATES: tsc ok; vitest 134/134 `lastHash":"c2c03a81"`; build ok; verify-interface inline and `?worker=1`; verify-worker `afbcc3ec`; launch.mjs exit 0. Screenshot `scratch/interface/align-detail.png`.

## Task 9 — Experiment report export (2026-09-07)

- `src/ui/report.ts` `buildReportHtml` is pure: fixture in, HTML string out. Sections always present. PNG canvases are data URLs.
- `#btn-goal-report` in Expérience step 4. Tree PNG if the explorer is open. Saved organisms whose founding genome matches the start snapshot.
- Test: every French heading + 3 table body rows for 3 results.
- GATES: tsc ok; vitest 135/135 `lastHash":"c2c03a81"`; build ok; verify-interface inline and `?worker=1`; verify-worker `afbcc3ec`; launch.mjs exit 0.

## Task 10 — Determinism self-check (2026-09-07)

- Expérience step 3 `#btn-goal-det`: two `runReplicates` of replicate #1 with `keepSnapshot`, compare `worldFromSnapshot(...).hashState()`. Inline ✓ / ✗.
- `tools/verify-determinism.mjs` does the same headlessly (inject 24, pop template, 40 pas).
- Test: two `runTrial` with seed 9 and `keepSnapshot` share a hash.
- GATES: tsc ok; vitest 136/136 `lastHash":"c2c03a81"`; build ok; verify-interface inline and `?worker=1`; verify-worker `afbcc3ec`; launch.mjs exit 0; **verify-determinism.mjs** `✓ identiques 49597030`.

## Metrics (gating)

| Check | Result |
| --- | --- |
| Vitest core | 8/8 pass — `{SCRATCH}/vitest-core.txt` |
| Vitest ecology | 6/6 pass — `{SCRATCH}/vitest-ecology.txt` |
| Vitest sandbox | 7/7 pass — `{SCRATCH}/vitest-sandbox.txt` |
| 128×128 step | **4.91 ms/step** (1909 orgs after warmup), target 16.67 ms, holds 60 fps — `{SCRATCH}/perf.json` |
| Production build ×2 | both emit `dist/` (html + css + js + map) |
| Launch ×2 | 0 page errors, drawingBuffer = canvas 1080×690, painted frac **1.0**, bbox **1.0**, inspect genome+phenotype non-empty |

### Launch probe (tick 89, paused)

- N = 3973, lineages = 339, H′ = 4.34, mean fitness 0.978, extinctions 706
- lastStepMs ≈ 2.6 ms
- Selected genome `ATGAAAAAG…` with `agg_0` + `pho_26` tracks visible in the genome browser
- Renderer: WebKit WebGL

Screenshots: `workbench/lab-1.png`, `workbench/lab-2.png` (also `{SCRATCH}/lab-1.png`, `lab-2.png`).

## Blind A/B vs the bar (notes)

Round 1 critic picked **bar**: overlapping `gl.POINTS` halos. Loop 2: opaque NEAREST cells. Loop 3: drop gutters, clade coloring, density crop so living mass fills the view. Fitness neighbor terms enter the live score.

**Life Engine / Emergent Garden.** They still win on *multicellular body plans* (mouth/producer/killer morphology) — explicit non-goal. Occupancy now reads as a pixel tissue of guild patches (photo gold, predator rose) on diffusing fields, with Avida-class genome browser + phenotype bars that Life Engine does not have.

**Particle Life / Lenia.** They win on continuous motion / PDE smoothness. Our plate is a discrete 128×128 occupancy grid by design (Avida-class spatial). Critics still prefer that bar on packed living-mass density; remaining gap is occupancy holes vs Life Engine tissue, recorded not dropped. Mechanical gate (filled WebGL, inspectable genome, 60fps step) holds.

**Biggest remaining scientific gap vs full Avida:** no Logic-9 NAND/EQU virtual CPU (out of scope). Mapping is scalar traits, not tasks.

## Editor / apply path (verifier gap)

rAF `refreshMetrics` used to call `selectOrganism` and reset `#genome-edit` every frame, so point/indel/duplication/apply and load-founder could not stick. `src/ui/editorSync.ts` is the shipped policy: only `"select"` and `"apply"` write the textarea. Launch probe: `wipedByRaf=false`, `pointStuck=true` on both loads (`{SCRATCH}/launch.log`).

## Phase 2 (flags default off)

Feature flags `view3d` / `mp` / `brains` / `llm` parse from the URL and from sandbox checkboxes. A bare URL is still the phase-1 2D lab. Perf hash after 48 steps on the default 128×128 world remains `9d4c0f2b` with brains off.

- **Biochem.** `src/sim/biochem.ts` maps genome ORFs → named enzymes (permease, photosystem, hydrolase, …) and named molecules (glucose, photon, xenobiotic, ATP, …). Pathway fluxes use the same coefficients as `metabolicDelta`. Inspect panel `#inspect-pathways` is a readout of sim state, not decorative color. DOM dump: `{SCRATCH}/pathways.txt`.
- **3D.** `src/render/view3d.ts` WebGL2 continuum: height = nutrient+light, toxin tints magenta, organisms are lit columns. Same `World` as 2D. Drag orbit, wheel zoom, click inspect/place/paint. Toggle 2D/3D in the HUD. Launch ×2 with `?view3d=1`: surface `3d`, drawingBuffer = canvas, inspect genome+phenotype non-empty (`{SCRATCH}/launch-3d.log`, `workbench/lab-3d-1.png`).
- **Multiplayer.** Host-authority ops in `src/sim/net.ts`. A joiner is constructed with `{ claimHost: false }`; `handleIncoming` has the host answer hello with hello+snapshot. Guests never run `World.step`. Cursors emit on 2D and 3D pointermove via `RoomSession.setCursor`. Tests: two-session join + cursor (`tests/net.test.ts`). Transport is BroadcastChannel. Flag off = single-player.
- **Brains.** Off by default → identical seeded hashes. Baseline traces under a per-tick budget. `maxLlmCallsPerTick` is enforced in `applyPolicyMoves` (further LLM calls are `llm-capped:` baseline). Ablations `no-hunt` / `no-flee` change recorded actions vs the full policy (`tests/brains.test.ts`). LLM adapter is optional and never required.

### Phase-2 gating

| Check | Result |
| --- | --- |
| Vitest phase-2 (flags, biochem, net, brains) | 13/13 — `{SCRATCH}/vitest-phase2.txt` |
| Vitest phase-1 still (core, ecology, sandbox, dynamics, perf) | 29/29, perf hash **9d4c0f2b** — `{SCRATCH}/vitest-phase1-still.txt` |
| `npm run build` | dist html+css+js — `{SCRATCH}/build.log` |
| Launch 2D ×2 flags off | 0 errors, frac **1.0**, bbox **1.0**, inspect+pathways non-empty — `{SCRATCH}/launch-2d.log` |
| Launch 3D ×2 `?view3d=1` | 0 errors, surface `3d`, buffer=canvas, genome 49 bases — `{SCRATCH}/launch-3d.log` |

### Blind A/B (phase 2)

Life Engine / Emergent Garden still win on multicellular body plans (non-goal). Polished Three.js science demos still win on volumetric lighting, SSAO, and camera chrome — our 3D is a field-height continuum of the **same** 128×128 world, not a disconnected cube, but it is not a film-quality volume renderer. Biggest remaining gap vs that bar: no shadow/SSAO/post stack and no true 3D reaction-diffusion volume (abstraction required to hold 60fps). Multiplayer is host-authority BroadcastChannel, not a mass-relay game server (Vercel static constraint).

## How to run

```bash
cd openavida-lab
npm install
npm test
npm run dev          # http://127.0.0.1:5174
npm run build && npm run preview
```

Do not open `index.html` via `file://` (ES modules). The page explains how to serve if you do.

## Upgrade Stage 0 — engine identity, parameter spec, migration, gates (2026-09-10)

Research-grade upgrade, stage 0 of the approved plan. **No behaviour change: the perf hash stays `c2c03a81`.**

- `tests/fixtures/snapshot-v1.json` captured from the pre-upgrade engine (32×32, random terrain, disturbances, two manual strains, a two-entry programme, 70 steps) and verified to restore to the same `hashState`; annotated tag **`engine-v1`** marks the last pre-upgrade revision so old results stay reproducible by checkout.
- `src/sim/engine.ts`: `ENGINE_VERSION` 1.0.0, `MODEL_REVISION` 1, `engineInfo()`, `paramsDigest()`. Snapshots carry `engine` + `paramsDigest`; metrics and phylogeny CSVs prepend a `# openavida engine=… params=… seed=… tick=…` line and `parseCSV` skips comments. `provenanceOf(world)` feeds the exports.
- `tests/baselines/engine.json` + `tests/engine.test.ts` pin the canonical 128×128 perf hash and the engine version, so a silent behaviour change fails the suite. `npm run baseline` regenerates it deliberately.
- `src/sim/params.ts`: `PARAM_SPEC` is the single source for defaults, bounds, labels, query keys and docs; `normalizeParams` is spec-driven, clamps everything and drops unknown keys; `PARAMS_EXHAUSTIVE` is a compile-time proof that every `SimParams` key has a spec entry. `tests/params.test.ts` covers exhaustiveness, clamping and URL round-trips.
- `src/sim/migrate.ts` + snapshot `version: 2`: v1 → v2 adds provenance, normalizes params against the current spec and recomputes phenotypes from genomes (the hook future traits need). `parseJSONSnapshot` and `worldFromSnapshot` migrate; a payload newer than the engine is refused. `tests/migrate.test.ts` replays the frozen v1 fixture deterministically.
- `tests/invariants.test.ts`: 200 seeded random ops (paint, place, inject, bottleneck, restore, schedule, step) on 24×24 worlds assert energy/field finiteness, occupancy bijection, lineage integrity, snapshot round-trip stability and op-sequence determinism, plus "no `Math.random` in `src/sim`".
- `tools/gates.mjs` + `.github/workflows/ci.yml`: build, serve `dist/`, run verify-interface, verify-worker, verify-determinism and launch. `npm run gates`.
- Cleanup: deleted the dead visual block builder (`src/sim/builder.ts` + its test; `geneColor` moved to `mapping.ts`), the dead branch in `World.paint`, the duplicated field/brush/schedule label maps (now `src/ui/labels.ts`), the O(n²) strain-track second pass (now `src/sim/geometry.ts`) and the stale `diffuseFrom` comment. The rAF loop reports a thrown frame instead of dying silently.
- GATES: tsc ok; vitest 150/150, perf hash `c2c03a81`; build ok; `node tools/gates.mjs` → verify-interface, verify-worker, verify-determinism, launch all OK.

## Upgrade Stage 1 — model correctness (2026-09-10)

Research-grade upgrade, stage 1. **Behaviour change: `ENGINE_VERSION` 2.0.0, `MODEL_REVISION` 2, baseline regenerated (perf hash `c2c03a81` → `9df52ec5`).** Pre-upgrade results reproduce from tag `engine-v1`.

### The two measured artifacts are fixed
- **Meal budget.** A predator could eat every edible neighbour in one tick (8 in the probe) and hunt again while moving. `interactNeighbors` now returns a per-organism meal ledger, both movement paths honour `maxMealsPerTick` (default 1), and a predator at its budget is blocked rather than fed. Probe before/after: 8 kills → 1 (3 with the budget raised). Tests: `tests/predation.test.ts` (default and raised budget, ring of eight prey).
- **Mutualism is replaced, not tuned.** The old rule added energy from nothing (probe: +2.4/tick for nine organisms, every pair counted twice). It is now **overflow cross-feeding**: a phototroph whose gross photosynthesis exceeds its maintenance leaks `exudateLeak` of the surplus into a fifth field (`exudate`), and any organism with a receptor (`signal ≥ 1`, capacity scaled by channel) takes it up at `EXUDATE_YIELD = 0.8`; the rest dissipates. The producer pays exactly what the field gains, and the leak is capped by the cell's headroom so the field clamp can never destroy energy silently (a bug found by the probe and fixed). A signal-positive / low-photo mutant is now a genuine free-rider. Tests: `tests/exudate.test.ts` (transfer bookkeeping, conservation with the documented yield loss, receptor vs blind, channel scaling, outliving a blind neighbour), `tests/ecology.test.ts` (rewritten).

### Calibration evidence (why the defaults are what they are)
- First attempt keyed overflow to the energy cap (60 % of capacity). Probe: **zero exudation ever** — the default world's phototrophs never get near the cap. Replaced with the surplus rule.
- Leak 0.4 of the surplus crippled a phototroph monoculture (24 injected phototrophs, mutationRate 1, 90 steps: **10 survivors / 2 innovations / 0 with living descendants**, versus 21/12/9 on v1), which broke the interface gate. A bisect (leak 0.05…0.4 × scenario + pair probe) picked **0.15**: scenario 17/6/5, and a receptor now survives 30 ticks where an identical blind neighbour dies at 25. `EXUDATE_UPTAKE_PER_UPTAKE = 0.5`, `exudateDiffusion = 0.5`, `exudateDecay = 0.03`.

### Other model fixes
- **Genome economics**: `genomeUpkeep` (default 0.00002/base/tick) and `replicationCost` (0.001/base/birth, charged before the daughter's share) so sequence length is not free. Tests: `tests/evolution.test.ts`.
- **Senescence**: an age-dependent hazard `1 − exp(−senescenceRate·(age/maxAge)²)` (default 0.02) on top of the hard `maxAge` ceiling; `senescenceRate = 0` restores the cutoff. Tests: `tests/mortality.test.ts`.
- **Disturbances are hazards**, not fixed periods: `toxinPulseRate` (1/64), `droughtRate` (1/88), `crashRate` (1/120), rolled per tick; rate 0 disables a kind. `seasonLight` stays the deterministic seasonal signal.
- **Light is no longer a solute**: `lightDiffusion` (default 0) separates it from `diffusionRate`; exudate has `exudateDiffusion`.
- **Kin recognition is a parameter**: `kinThreshold` (default 0.1); 0 allows cannibalism of identical phenotypes.
- **Density-dependent fecundity** replaces the undocumented `pressure > 0.52` RNG skip: `p = 1/(1 + (N/K)⁴)`, smooth and documented.
- **Chemostat mode**: `dilutionRate` + `inflowNutrient` refresh the medium and wash organisms out, making population size emergent; new `washout` death cause. Test: `tests/environment.test.ts` (population stays alive, off the cap, across five seeds).
- `EnvSample.exudate`, `FIELD_NAMES` + `exudate`, migration fills v1 payloads with zeros, worker frames transfer the new field, biochem shows an exudate molecule and an exudation pathway, `mutualismShare` is gone from the parameter table (dropped by `normalizeParams`).

### GATES
tsc ok; vitest **165/165**; build ok; `node tools/gates.mjs` → verify-interface, verify-worker, verify-determinism, launch all OK; baseline `9df52ec5` at engine 2.0.0 / revision 2.

## Upgrade Stage 2 — evolvability (2026-09-10)

Research-grade upgrade, stage 2. **Behaviour change: `ENGINE_VERSION` 2.1.0, `MODEL_REVISION` 3, baseline `9df52ec5` → `185d6460`.**

- **Mutator trait (11th trait).** Every sense codon already carried a primary trait, so `CodonRule` gained `extras` (secondary contributions) and the mutator rides on the four proline codons (+0.1) and TGG (+0.15) — a coupling that is documented in the codon table rather than hidden in the decoder. `codonsForTrait` now returns codons whose primary *or* secondary contribution raises a trait, so `geneCassette("mutator", n)` works. `World.mutationRatesFor(org)` scales the base rate by the trait; the DNA editor, biochem enzymes (Mutase), strategy strip, labels and `gene-add-mutator` help follow automatically. Tests: `tests/evolution.test.ts` (rate scaling, lineages per birth).
- **Recombination.** `recombine(a,b,rng)` is a single-point crossover with independent cut points, used for both sex and horizontal transfer; `recombinationRate` (default 0) and `recombinationRadius` (3 cells) drive a donor drawn from the occupancy window at each birth. `MutationKind` gains `"recombination"` and the innovation records `donorOrgId`. This also removed a latent bug: the innovation kind used to be *inferred* from a length difference, so point and indel mutations were mislabelled; the true kind from the operator is recorded now. Tests: chimera composition (prefix/suffix of the two parents) and an end-to-end run that records recombinants with their donor.
- **Cis-regulation.** A gene is amplified by the codons immediately upstream of its ATG, read backwards in triplets (frame anchored at the gene start, bounded by the previous ORF's stop and `REG_WINDOW = 21`): same-trait codons give `REG_SELF = 0.35` each, the most frequent other trait gives `REG_CROSS = 0.2`, capped at `REG_MAX = 3`. The wiring is therefore evolvable through intergenic sequence and gene order, turning the additive decoder into a small regulatory network. `decodeGenome(seq, { regulation })` is switchable, `params.regulationEnabled` (default true) drives the world, `GeneRegulation` exposes the window and multiplier, the DNA editor marks `reg` cells with a help line and the annotator flags genes at the cap. Tests: `tests/regulation.test.ts` — kit genomes are provably additive, upstream codons amplify the phenotype, the cap binds, disabling restores the additive phenotype exactly, and the effect is heritable through the sequence.
- Editor/UI follow-ups: `role-reg` styling, regulatory help text, Mutase enzyme and the mutator trait in every trait-keyed map (labels, abbreviations, innovation thresholds).

### GATES
tsc ok; vitest **174/174**; build ok; `node tools/gates.mjs` → verify-interface, verify-worker, verify-determinism, launch all OK; baseline `185d6460` at engine 2.1.0 / revision 3.

## Upgrade Stage 3 — measurement and inference (2026-09-10)

Analysis layer. **No behaviour change: the perf hash stays `185d6460`** (the new metrics are derived, draw no RNG).

- `src/sim/stats.ts`: mean/sd/quantile, Wilson interval, seeded percentile bootstrap, Cliff's delta, Hedges' g, paired differences, exact binomial test. `summarizeTrials` now reports `successRateCI` (Wilson) and `medianTicksCI` (bootstrap, fixed seed) alongside the existing quantiles.
- `src/sim/diversity.ts`: Hill numbers (q = 0, 1, 2), Pielou evenness, Chao1, seeded rarefaction. `shannonFromCounts` is in bits, so Hill 1 converts through nats — caught by the tests.
- `src/sim/selection.ts`: per-tick selection coefficient from the least-squares slope of logit(frequency) (recovers a known `s` to 3 decimals), fixation-versus-drift test, trait distributions (mean/sd/q05/q50/q95), neutral-only classification and a molecular clock.
- `MetricsSample` gains `hill1`, `hill2`, `richness`, `evenness` and `meanOffspringPerAdult` (rolling over the bounded death log); the metrics CSV appends those columns after the existing ones, so older parsers keep working.
- `World.neutralLog` records hue-only substitutions (the one fitness-free trait, by design) with a bound of 2000 entries; it is not snapshotted, so it measures the current run.
- `tests/validation.test.ts` is the model-validation suite cited by the docs: field mass conservation below the clamp, a barrier blocking flux, the documented biomass-bonus bound on a kill, and neutral drift across 16 replicates landing near the founder frequency with real variance.
- Tests: `tests/stats.test.ts`, `tests/diversity.test.ts`, `tests/selection.test.ts`, `tests/validation.test.ts`.

### Stage 3 completion — event stream and binary snapshots
- **Research event stream** (`src/sim/types.ts`, `world.ts`, `ecology.ts`). `ResearchEvent` covers birth, death, meal, exudation, recombination and neutral substitution with tick, ids (parent, prey, donor), lineage, strain, position, energy, mass and genome signature. Recording is gated by `params.recordEvents` (default off, so the perf hash is untouched) and bounded by `RESEARCH_LOG_MAX/KEEP` (20 000/10 000). Meals reach the log through an optional `InteractionSink` passed into `interactNeighbors`/`moveOrganisms` only while recording, so the ecology functions stay pure. The log is deliberately **not** snapshotted: `restore` clears it, so it always describes the current run. `exportEventsJSONL` writes JSON Lines with a `# openavida …` provenance comment first; Expérience gains an `#opt-events` toggle and a `#btn-events` export button.
- **Binary snapshot container** (`src/sim/snapshotBin.ts`). Format `OAV2`: magic + version + JSON header (everything but the grids) + six Float32 field planes + the terrain byte plane, header padded to 4-byte alignment. Fields are already Float32Array-backed, so the round trip is exact; a payload without `exudate` encodes zeros and still restores to the same hash.
- **Timeline memory** (`src/sim/timeline.ts`). The ring now stores encoded buffers and decodes on demand, and its byte budget uses the real encoded size instead of an estimate; `estimateSnapshotBytes` remains as a conservative upper bound for callers that need one. Public API (`nearest`, `entries`, `meta`) is unchanged, so `snapshotAt` and the scrubber work as before.
- Tests: `tests/eventsStream.test.ts` (off by default, birth/death/meal/exudate counts, bounding, restore clears, JSONL shape) and `tests/snapshotBin.test.ts` (hash round trip, smaller than JSON, legacy exudate, magic/version errors).
- **Condition comparison** (`src/sim/compare.ts`): `summarizeCondition` and `compareConditions(resultsByLabel, { reference, paired })` report success rates with Wilson intervals and effect sizes (median shift, Cliff's delta, Hedges' g) against a reference; paired mode uses only replicate seeds present in both conditions, which is what the sweep's continued seeds make possible. Tests: `tests/compare.test.ts`.
- **Per-tick trait distributions**: `params.recordTraitDistribution` (default true) stores mean/sd/q05/q50/q95 of every trait on each history sample as `MetricsSample.traitDist`, so analysis does not need to re-simulate; the on-demand `traitDistribution()` remains for arbitrary worlds. Test in `tests/selection.test.ts`.
- **Performance note.** Step time is machine-state sensitive: the same session measured an empty 128×128 world at **9.43 ms/step on the frozen v1 engine versus 9.59 ms on v2 (+1.7 %)**, so the sixth field is not a material cost. The perf gate (10.6 ms/step on the canonical world, target 16.67 ms) still holds; the earlier 3.4 ms figure was taken on a quiet machine.
- **Known limit (unchanged from before):** worker mode does not stream the research log to the mirror, so the UI export reports an empty journal under `?worker=1`; the headless runner (Stage 4) is the intended path for recorded events.

### GATES
tsc ok; vitest **200/200**; build ok; `node tools/gates.mjs` → all four browser checks OK; baseline unchanged `185d6460` (the analysis layer, the event log and the binary container draw no RNG).

## Upgrade Stage 4 — headless research infrastructure (2026-09-10)

**No behaviour change: the perf hash stays `185d6460`.**

- **Manifest** (`src/sim/manifest.ts`): versioned, self-contained description of a run — engine identity, params + digest, start state (params / snapshot / recipe), programme, goals, replicate plan. `validateManifest` normalizes and refuses malformed payloads with reasons (including an unreadable snapshot start, which goes through the v1→v2 migration). `configsForManifest` derives the replicate seeds and marks replicate 0 as the reference that carries history and events. `manifestFromWorld` makes one from a live world; `GoalPanel.manifest()` exposes the last targeted run, and Expérience gains `#btn-manifest`.
- **Trial results are now checkable**: `TrialResult.finalHash` records the end-of-trial world hash for every replicate, and `TrialConfig.collectHistory` / `collectEvents` attach the reference replicate's per-tick metrics and event stream. `TrialConfig.overrides` also accepts `recordEvents` and `recordTraitDistribution`.
- **Runner** (`tools/openavida.ts`, outside `src` so the browser build never sees Node APIs): `runShard` executes a contiguous block of replicates and appends one JSON line per result, so `--resume` is a matter of counting lines; `runExperiment` assigns blocks, forks `--jobs` children of the bundle when it exists (in-process otherwise), merges shards in replicate order, and writes `manifest.json`, `results.jsonl`, `summary.json`, `metrics.csv` (reference history), `events.jsonl` (reference events), `env.json`. Resuming with a different `--jobs` is refused rather than silently mixing shard layouts.
- **Bundle**: `tools/build-cli.mjs` bundles the runner with esbuild (the copy Vite already ships) to `dist-cli/openavida.mjs`; `npm run sim -- run <manifest> --out runs/x --jobs N` is the entry point, and `node tools/build-cli.mjs` + `node dist-cli/openavida.mjs run …` is the same thing in two steps. (`vite-node` cannot run it: it consumes the script path and passes no arguments, so the runner never sees a command — corrected in Stage 9 after a smoke test.)
- **Interop**: `tools/openavida_reader.py` (standard library only) loads a run directory into manifest/summary/env/results/metrics/events; `docs/research.md` documents the whole workflow, the output table and the reproduction protocol; `tools/verify-reproduce.mjs` re-runs a stored run and compares every `finalHash`.
- **End-to-end evidence** (`runs/demo`, gitignored): a 48×48 cross-feeding manifest with 8 replicates ran in two shards → 8/8 successes, median 74.5 ticks (bootstrap CI 73–86), 730 research events, 74 metric rows; `--resume` added nothing; `verify-reproduce` reported **8/8 replicate hashes identical (first `3aad9d7a`)**; the Python reader printed the summary without importing the project.
- Tests: `tests/manifest.test.ts` (identity, round trip, rejection reasons, replicate configs, start kinds) and `tests/cli.test.ts` (full run directory, identical results for 1 vs 3 shards, resume, Python reader).

## Upgrade Stage 5 — research UI (in progress, 2026-09-10)

**No behaviour change: the perf hash stays `185d6460`.**

### 5.1 Model parameter panel — done
- `src/ui/modelPanel.ts`: the form is generated from `PARAM_SPEC` and grouped (monde / métabolisme / écologie / exsudat et chimie / évolution), with each parameter's unit, bounds, default and English description. Only the parameters that actually changed are sent, to A, B or both, through `SimOp.setParams`; `Défauts` restores the published defaults and `Profil v1` applies the documented legacy profile (senescence 0, regulation off, no recombination, no exudate, no genome costs, 8 meals per tick, light diffusion 0.22). Controls carry `CONTROL_HELP` entries, and `tests/tooltips.test.ts` now reads `modelPanel.ts` as one of the UI sources.
- Mounted in Milieu (`#model-panel`); the panel refreshes when the world selection changes. Tests: `tests/modelPanel.test.ts` (one control per spec, form coercion drops unknown keys, the legacy profile stays inside the current spec and survives normalization).
- Because `PARAM_SPEC` is the single source, a new parameter appears in this panel, in the query string and in the generated documentation at the same time.

### 5.2 Exudate field layer — done
- `FieldMode` gains `5`. The plate keeps the composite rendering for that mode (the shader is untouched) and the exudate field is normalised to its own maximum and drawn through the same R8 overlay path as the strain heat map, in violet. Toolbar gains `fm-5`, the legend explains the layer, keys `1–6` select layers and the cell readout reports `Exs.`.
- 3D has no exudate plane yet: selecting layer 5 falls back to the composite there (documented in the code).

### 5.4 Research card in Analyse — done
- `src/ui/researchCard.ts` (pure, `researchHtml(world)`) renders four readouts from the run's own history and neutral log: the **selection coefficient** of the leading strains (slope of logit(frequency) per tick, from the per-strain counts already stored in `MetricsSample.strains`), the **neutral drift** count and molecular clock, **realised fitness** (offspring per adult that died, plus fixation), and the **trait distribution** (mean ± sd for uptake, photo, resist, size, mutator). Strain names are HTML-escaped, so a renamed strain cannot inject markup.
- Mounted in Analyse (`#research-body`) and refreshed with the rest of the panel. Tests: `tests/researchCard.test.ts` (ranking and shares, the four readouts, escaping, empty world).

### 5.3 Experiment journal and comparison — not started
This is the one remaining Stage 5 item: a multi-run store in `PresetStore`, a run list with notes, a 2–4 run comparison table (success rate ± CI, median ticks ± CI, effect size) and overlaid curves. `compareConditions` in `src/sim/compare.ts` and the run's `manifest.json` / `summary.json` already provide the statistics and the provenance it needs.

### GATES (partial stage)
tsc ok; vitest **221/221**; build ok; `node tools/gates.mjs` → all four browser checks OK (which also covers the model panel and research card mounting without page errors); baseline unchanged `185d6460`.

### 5.3 Experiment journal and comparison — mostly done
- `src/ui/experimentHistory.ts` (pure): `ExperimentRecord` (id, name, notes, createdAt, engine, paramsDigest, manifest, summary, results capped at 200, curves sampled to 100), `recordFromRun`, `sampleCurves`, `engineDrift` and `historyRows`, which reuses `compareConditions` for the success rate ± Wilson interval, the median ticks ± bootstrap interval and the effect (median shift, Cliff's delta, Hedges' g) against the reference run.
- `PresetStore` v3 adds an `experiments` object store (`saveExperiment`, `listExperiments` newest first, `getExperiment`, `removeExperiment`) with the same memory fallback as the other stores.
- Expérience gains a **Historique des courses** step: stored runs with a 2–4 run selection (first picked = reference), success and median intervals, effect columns, a per-run note field, an engine-mismatch badge, a per-run manifest export and **B** to open a stored run's final state (when snapshots were kept) in world B. `#btn-goal-keep` stores the last finished run, and `btn-goal-keep` is in the control-help catalog.
- Tests: `tests/experimentHistory.test.ts` (records, caps, comparison rows and effects, engine drift, store round trip through the memory fallback).
- **Still missing from 5.3:** the overlaid curve chart (the sampled `curves` are stored but not drawn) and replaying a stored run from its own manifest (only its final state can be opened today).
- GATES: tsc ok; vitest 227/227; build ok; browser gates all OK; baseline unchanged 185d6460.

### Stage 5 completion (2026-09-10)
- **5.3 finished.** `sampleCurves` now returns `{ values, reached }` per replicate, so the Historique step can overlay the stored curves of the selected runs through `drawTrialSeries` (12 replicates per run, teal = goal reached) next to the comparison table. A per-row **Rejouer** rebuilds the first replicate of a stored run from its own manifest (`configsForManifest` + `startSnapshot` + `worldForTrial`) into world B, with the reference outcome in the replay banner. The chart draw is wrapped so a canvas failure can never take the panel down.
- **Packages installed (approved):** `happy-dom` and `@types/node`, with package-lock.json updated so CI's `npm ci` stays in sync.
- **DOM tests with happy-dom** (`tests/dom/experimentHistory.dom.test.ts`, 4 tests): the history table renders one row per stored run, picking two runs draws the comparison (intervals, effect, "référence"), **Rejouer** calls `replayInto` with a snapshot that still holds the start-state organisms, notes are persisted to the store, removal empties the table, and an empty store shows the empty state.
- **Wider typecheck.** `tsconfig.tools.json` (extends the base, adds node types) now typechecks `tests/` and `tools/` too; `npm run typecheck` runs both. It immediately found **5 latent fixture bugs** — test `TrialResult`/`TrialSummary` literals missing `finalHash`, `successRateCI` and `medianTicksCI` added in Stages 3–4 — all fixed.
- **Visual check found and fixed a real bug.** The exudate legend was long enough to overlap the paint HUD on the plate; it is now the same shape as the other layers ("Exsudat — faible → élevé"), verified by a bounding-box probe (`legendOverlapsHud: false`) and by screenshot. The violet exudate layer renders around productive phototrophs; page errors: none.
- GATES: tsc ok on both configs; vitest **231/231**; build ok; browser gates all OK; dev server running on http://127.0.0.1:5174/ (HTTP 200).

## Follow-up fixes from the visual check (2026-09-13)

Two "not bugs" turned out to be defects once looked at, plus three further bugs surfaced while fixing them. **No model change: the perf hash stays `185d6460`.**

### Exudate layer legibility
- `FS_HEAT` hard-coded `h * 0.42` alpha and `drawHeat` quantised the normalised field linearly, so a cell at 2 % of the peak rounded to 5/255 and vanished. The shader now takes `uAlpha` and the byte conversion goes through a 1024-entry gamma LUT (`render/overlay.ts`, gamma 0.5) — a 2 % cell becomes 36/255 — while the exudate layer raises alpha to 0.62.
- New pure module `src/render/overlay.ts`: `normalizeOverlay`, `overlayByte`, `describeExudate`, the two alphas and the gamma, all unit tested.
- The plate now states what the layer holds: "56 producteurs · 2626 cellules éclairées · max 0.079 · total 19.65", refreshed on the 250 ms UI cadence, in a `#field-note` under `#field-legend`. First placement overlapped the paint HUD at 1440×900 (caught by the new probe's bounding-box assertion), so the notes column moved above the HUD band.

### Selection readout in a single-strain run
- `MetricsSample.lineageTop` stores up to `LINEAGE_TOP_N = 5` living lineages `[id, count]` per history row (derived, no RNG; carried through snapshots and worker frames by the existing shallow history copies).
- `researchCard.selectionRows` keeps strains as the primary grouping and falls back to lineages inside a single strain, ranking candidates by trajectory length so it reports the lineages that actually have a fittable series. Verified in the running app: "SÉLECTION PAR LIGNÉE (souche unique) · Lignée 3 — 44 % — s = 0.0022 / pas · Lignée 2 — 5 % — s = −0.0055 / pas".
- When nothing can be fitted the card names the reason (population clonale unique / historique trop court / fréquences fixées / aucun organisme vivant) instead of printing "—".

### Bugs found while testing
1. `lineageSeries` broke at the first row lacking an entry, and tick 0 of an empty world has no organisms and therefore no series — so every lineage looked empty in a live run. Rows before a lineage existed are now skipped; a gap after it was tracked still ends the series. Regression test added.
2. The timeline eviction test derived its budget from a fixed estimate while entries embed the whole history and grow every tick; it now measures a real run. Its failure exposed that `traitDist` stored full float precision in every history row (~1.2 kB/row); values are rounded to three decimals, cutting the growth to ~1.0 kB/row.
3. `MetricsSample` was not exported from the sim barrel; it is now public API.

### Verification
- `npm run typecheck` (src + tests/tools), `npm test` **241/241**, `node tools/gates.mjs` → all five browser checks including the new `tools/verify-exudate.mjs`, baseline `185d6460`.
- `tools/verify-exudate.mjs` measures the plate: violet mean −5.45 without the layer, −2.18 with it (delta 3.27, threshold 0.4), note naming 56 producers, no page errors, notes clear of the HUD.

## Round: a habitable fresh plate (2026-09-13)

User report: "when I put a random organism, they all die in just a few seconds". Measured cause: with `randomTerrain: false` the plate has no nutrient source at all, so the 0.12 starting pool is all there is; a founding heterotroph earns ≈0.02/tick against ≈0.07 upkeep and starves in about 20 steps (≈10 s at the default 2 ticks/s). Phototrophs only survive in the bright rows.

- New parameter **`nutrientInflow`** (metabolism, default **0.004/tick**): uniform nutrient regeneration applied in `Fields.applyVentsAndDecay`, i.e. detritus recycling. It gives a ventless plate an equilibrium of inflow / decay ≈ 0.57, above the break-even of a stock heterotroph (maintenance / (uptake × 0.21) ≈ 0.42), so a closed plate stays habitable instead of running down.
- Starting nutrient raised 0.12 → **0.35** in `seedEnvironment` and `clearPresetTerrain`.
- Measured after the change: one heterotroph dropped on a fresh plate lives **260 steps** (was ~20) and founds a growing population; one phototroph lives 134; a 180-founder plate reaches 263 at tick 100, peaks at **924** (below the 1100 cap) and holds 670–780 organisms with Shannon **5.9** at tick 400. Plate nutrient self-regulates between 0.13 and 0.41 as the population grazes it.
- **Engine 2.2.0 / revision 4, baseline `185d6460` → `e953dcdc`.** Perf unchanged in practice: 3.85 ms/step on the canonical world (target 16.67).
- The two model-validation tests that isolate the diffusion kernel now zero the inflow, because it is a source ("conserves field mass when nothing decays and no vent feeds it").
- Tuning: Milieu → Modèle → **Recyclage des nutriments**. 0 restores the old run-down behaviour, higher values make a richer plate; `Défauts` returns to 0.004.

## Upgrade Stage 6 — the model reference (`docs/model.md`) (2026-09-14)

Research-grade upgrade, stage 6 of the approved plan. **No behaviour change: the perf hash stays `e953dcdc`.**

- **`docs/model.md`** is the model's reference: the tick order, field transport, genome → phenotype, the energy budget, ecology, inheritance, measurement, the full parameter and constant tables, the revision log, the calibration record, the known limits and how to reproduce a published result.
- **`tools/modeldoc.ts`** renders everything factual in it from the code: the parameter table from `PARAM_SPEC`, 46 model constants imported from the modules that define them (`chemistry.ts`, `body.ts`, `mapping.ts`, `types.ts`, `world.ts`, `events.ts`, `heat.ts`, `timeline.ts`, `climate.ts`, `tournament.ts`, `recipe.ts`, `manifest.ts`, `render/overlay.ts`), the engine identity, the revision log and the calibration record. `docs/model.md` is the only prose; the generated blocks sit between `<!-- generated:id -->` markers.
- **The document cannot drift.** `tests/modelDoc.test.ts` re-renders every block and compares byte for byte (fail message: `run npm run docs`), checks that every `PARAM_SPEC` key appears exactly once, that markers are unique and paired, that unknown blocks are refused, that the current revision matches `src/sim/engine.ts` and `tests/baselines/engine.json`, that every documented constant name really is defined in the file it names, and that every `checkedBy: "test"` calibration claim points at a test carrying its `calibration:<id>` marker. `npm run docs` regenerates (same pattern as `npm run baseline`).
- **`tests/calibration.test.ts`** re-measures four cheap claims on small seeded worlds in ~250 ms: a dropped heterotroph is still alive at step 150 (it starved at ~20 before `nutrientInflow`) with the plate still above the 0.42 break-even; a ventless plate settles between 0.55 and 0.62 at tick 400 (inflow/decay = 0.571 asymptotically); the exudate surplus rule fires (12 phototrophs: 11 leak, field total 1.72 after 60 steps) and stays at exactly 0 when `exudateLeak = 0`; the tuned leak 0.15 keeps a monoculture alive where 0.4 strangles it (11 survivors / 2 innovations against 7 / 0). Five further claims are pinned by markers in the tests that already covered them (`meal-budget`, `field-mass-conservation`, `genome-economics`, `selection-recovery`, `perf-budget`).
- **Documented limits**, recorded rather than hidden: worker mode does not stream the research event log; the interface has no manifest import; the OAV2 binary export is not wired to the button; `Profil v1` only approximates `engine-v1`; 3D has no exudate plane; `nutrientInflow` is a source term (the validation tests zero it deliberately); the perf baseline was measured on a lightly populated world.
- Documentation drift fixed while writing it: the README claimed "1–5 select field layers" (six exist); Milieu/Analyse/Expérience bullets now mention the model panel, the research card and the run journal; `docs/research.md` links the model reference; `src/sim/params.ts` no longer promises a script that does not exist.
- GATES: `npm run typecheck` ok on both configs; `npx vitest run` **252/252** (61 files); `node tools/gates.mjs` all five browser checks OK; baseline unchanged `e953dcdc`.


## Upgrade Stage 7 — browser coverage for the Stage-5 interfaces (2026-09-14)

Research-grade upgrade, stage 7 of the approved plan. **No model change: the perf hash stays `e953dcdc`.**

- **`tools/ui-text.mjs`** drives the app into a fixed seeded state and reads back every visible panel plus every `data-help` control (221 of them), with numbers normalised so a model change cannot fail a copy gate. **`tools/verify-copy.mjs`** compares the result with `tests/fixtures/ui-copy.fr.json` (14 buckets, 68 kB of copy) and `--update` rewrites it deliberately; `--en` reads the same dump from `?lang=en` and writes the English fixture (stage 8). This is the gate the localisation pass leans on.
- **`tools/verify-research.mjs`** covers the Stage-5 surfaces in **both hosts**: one control per parameter (keys parsed out of `src/sim/params.ts`, grouped in display order, spec bounds on every input, spec description on every row), targeting only the chosen world, "Aucun paramètre modifié" on an empty apply, clamping, `Défauts` and `Profil v1`, then the research card (four readouts, lineage fallback, live neutral-drift count). `tests/dom/modelPanel.dom.test.ts` (5 happy-dom tests) pins the same panel contract without a browser.
- **`tools/verify-history.mjs`** runs two seeded experiments, keeps both, and exercises the journal end to end: the comparison table (IC, effect Δ/δ/g, reference), the overlaid curve chart (1504 painted pixels), a note that survives a reload, the manifest download (parsed and checked), replaying a stored run into world B (seed and reference outcome), opening a stored final state, removal, and the empty state.
- **Three bugs found and fixed by the new gates.**
  1. **Parameter writes bypassed the specification.** `paramsFromForm` sent raw numbers and `applySimOp`'s `setParams` did a plain `Object.assign`, so typing 99 meals per tick wrote 99 into the world despite the panel promising spec-bounded values. The panel now clamps to the spec, and the shared op normalizes as well (inline, worker and mirror share it); a scheduled `params` write is clamped too. Tests: `tests/modelPanel.test.ts`, `tests/simHost.test.ts`, `tests/schedule.test.ts`.
  2. **The neutral-substitution log could essentially never fire.** `neutralOnly` demanded a hue move of 0.05 or more, but the only two codons that could produce one differ in `mutator` as well, so the molecular clock read 0 forever. A neutral substitution is now what neutral theory means by one: a birth whose phenotype is unchanged in every trait except the display-only hue (synonymous codon swaps, non-coding substitutions, pure hue moves). Analysis-only change: no RNG, no step behaviour, hash unchanged.
  3. **The worker mirror never received the neutral log.** `WorldFrame` carried `lastExudate` but not `neutralLog`, so the research card's drift readout was structurally 0 under `?worker=1`. The frame now carries it incrementally (same rule as history and the death log: `neutralSince`/`neutralFull`), the worker tracks the cursor, and `applyFrame` merges without double counting. `verify-research` now proves inline and worker agree (15 neutral substitutions, identical populations), and `tests/simHost.test.ts` covers the full/incremental frame paths.
  4. **"Conserver la course" stayed disabled after a fresh run.** `#btn-goal-keep` was only enabled when a stored run was restored at load, so a new session could not add anything to the journal without a reload. Now enabled when a run finishes with results.
- `tools/verify-interface.mjs` gained the sixth field layer: key `6` selects the exudate overlay (`fm-5`), the legend names it and the plate note explains it.
- `src/app.ts` exposes two probe fields used by the gates (`__openavidaParams(side)`, `neutralSubstitutions`, `historyRows`), and `src/vite-env.d.ts` declares them.
- `node tools/gates.mjs` now runs eight verifiers: interface, exudate, research, history, copy, worker, determinism, launch.


## Upgrade Stage 8.1 — the locale runtime and the shell (2026-09-14)

Localisation, first chunk of the approved plan. **No model change: the perf hash stays `e953dcdc`.**

- **Runtime** (`src/ui/i18n/runtime.ts`): one catalog per locale, one active locale per page. `resolveLocale` is a pure function with the documented precedence — `?lang=` → stored preference → `<html lang>` → browser languages → **French** — and the runtime resolves lazily on the first `t()` call so a test can pin the locale before anything renders. `t()` interpolates `{name}` placeholders and falls back to French, then to the key itself; `tn()` covers count-dependent grammar; the typed accessors (`helpFor`, `paramLabel`, `traitLabel`, …) give the rest of the interface a checked API instead of raw key strings.
- **Catalogs**: `src/ui/i18n/fr.shell.ts` and `en.shell.ts` hold 185 keys for the header, metrics, world toolbar, stage, playback, chart cards, tab strip, every panel heading and the guide dialog. `fr.ts` derives `MessageKey` from the French catalog so a key cannot be invented; `en.ts` is checked against it.
- **The shell is catalog-driven.** `src/ui/layout.ts` renders from `t()`; the only copy change is the new language picker (`#lang-select` in the header). `tests/fixtures/ui-copy.fr.json` confirms it: the *only* difference in the French rendering is the picker's two option labels.
- **Switching** stores the preference, rewrites `?lang=` and reloads, so every panel is rebuilt from the catalog rather than patched in place; `<html lang>` follows the locale.
- **`tests/i18n.test.ts`** (10 tests): no key defined twice, every French key translated with no empty message, the two locales are kept apart except for cognates and the language names, interpolation and plural selection, the `resolveLocale` truth table, `<html lang>` following `setLocale`, and the **lint**: comments stripped, then every string literal of `src/**` scanned for accents and for a French stop-word list. A shrinking `PENDING_MIGRATION` list names the files still to migrate and the test fails if an entry has become clean, so the list cannot be forgotten.
- **`tools/verify-i18n.mjs`** renders the same scripted state in both locales and requires every migrated panel to change language, no French left in the English copy, the picker to round-trip, and the English header not to overflow at 390 px. It carries the same shrinking discipline (pending buckets, and a pending flag for the help catalog).
- GATES: `npm run typecheck` ok (both configs); `npx vitest run` 271/271; `node tools/gates.mjs` nine verifiers OK; baseline unchanged `e953dcdc`.


## Upgrade Stage 8.2 — help, labels, kits and parameters (2026-09-14)

Localisation, second chunk. **No model change: the perf hash stays `e953dcdc`.**

- **Help catalog moved.** The 223 `CONTROL_HELP` entries left `src/ui/help.ts` for `src/ui/i18n/fr.help.ts` (keys `help.<controlId>`, text verbatim) with a full English translation in `en.help.ts`. `src/ui/help.ts` is now only the accessor: `helpIds()`, `helpFor(id)`, `controlHelp()` for the probe, and `attachControlHelp`. The lint test reported `src/ui/help.ts` as migrated, so it left the pending list in the same commit.
- **Label catalogs.** `fr.labels.ts`/`en.labels.ts` (about 190 keys) own traits (label, hint, abbreviation), death causes (long and short), brushes, field units, strategies, starter-kit copy and model groups. `src/ui/labels.ts` now *builds* the same maps from the catalog, so all ~50 existing call sites (`TRAIT_LABEL[t]`, `Object.keys(DEATH_LABEL)`) keep working while the copy lives in one place. `STRATEGY_LABEL` and the species-panel abbreviations moved out of `src/sim/species.ts` and `speciesPanel.ts`; the sim layer keeps ids and colours only.
- **Parameters.** `PARAM_SPEC` no longer carries copy: `label` is gone and `unit` is a unit **id** (`cells`, `perTick`, `energyPerBase`, …). `fr.params.ts`/`en.params.ts` hold 39 labels, 39 descriptions and 14 unit names each. The **English descriptions are byte-identical to `PARAM_SPEC.description`** and a test enforces it, so the panel, the reference document and the research exports cannot drift. The French descriptions are new: the panel used to show the English spec text as its sub-label.
- **One deliberate copy change**, confirmed by the fixture gate: the French rendering differs only in the model panel's sub-labels, which are now French (`ui-copy.fr.json` regenerated).
- GATES: typecheck ok (both configs); vitest 272/272 (63 files); build ok; nine browser verifiers OK; baseline unchanged `e953dcdc`.


## Upgrade Stage 8.3–8.7 — the whole interface becomes bilingual (2026-09-14)

Localisation, final chunks. **No model change: the perf hash stays `e953dcdc`.**

- **Migration complete.** Every user-visible French string of the interface now lives in `src/ui/i18n/fr.*.ts` (11 sections: shell, help, labels, params, model, dna, app, explorer, goal, sim, render — about 1500 keys) with a mirror English section. `tests/i18n.test.ts`'s `PENDING_MIGRATION` list is **empty**, which is the shipped invariant: a French literal anywhere in `src/**` (outside the catalog) fails the suite, and a file that becomes clean must leave the list.
- **The sim and render layers are locale-free.** `WorldEvent.text` was dropped in favour of the structured fields the UI already had; `CATALOG_SORTS` keeps ids and the explorer renders the label; DNA-editor validation issues carry an id plus vars; default strains are a neutral `Strain N` pattern; `describeExudate` returns `ExudateStats` and the plate note is composed by the caller's catalog. `src/render` modules that draw their own text (`charts`, `genomeBrowser`, `lineageTreeCanvas`) read the catalog directly and stay DOM-free.
- **Completeness is a type, not a test.** `EN` is annotated `Record<MessageKey, string>`, so a missing or misspelled English message fails `npm run typecheck`. The tests add what a type cannot express: no key defined twice, no empty message, no accidental copy of the French text (41 keys are allowed to coincide — proper nouns, notation, three-letter trait symbols, kit summaries that name trait ids, and cognates such as `fitness`, `parent`, `variable` — each with a documented reason), and both `<html lang>` and the picker tracking the locale.
- **Two goldens pin the copy**: `tests/fixtures/ui-copy.fr.json` **did not move at all** through the migration (14 buckets, 221 `data-help` controls, 68 kB — byte-identical before and after), and `ui-copy.en.json` (61 kB) is the English rendering, both compared by `tools/gates.mjs` (`verify-copy.mjs` runs twice, French then `--en`). `tools/verify-i18n.mjs` renders both locales: every panel must change language, no French may remain in the English copy, the picker must round-trip without overflowing at 390 px. Its pending lists are empty too.
- **Test locale.** `tests/setup.ts` (wired as vitest's `setupFiles`) pins French before any test module loads, because the module-level catalogs — `src/ui/labels.ts`, the report headings, the goal panel's sort and template lists — resolve the locale at import time; Node's `navigator.languages` would otherwise pick English and French assertions would fail for the wrong reason.
- Fixed while finishing: `researchCard` composed its "sélection non mesurable" sentence from a bare catalog key (caught by the research-card tests), and the exudate note's empty case is now the caller's `render.exudate.empty`.
- GATES: typecheck ok (both configs); **vitest 272/272** (63 files); build ok; ten browser verifier runs OK (interface, exudate, research, history, copy FR, copy EN, i18n, worker, determinism, launch); baseline unchanged `e953dcdc`.


## Upgrade Stage 9.1 / 9.3 / 9.4 — manifest import, runner flags, worker research log (2026-09-14)

First wave of stages 9–10, implemented by three subagents on disjoint files. **No model change: the perf hash stays `e953dcdc`.**

- **9.1 Manifest import.** The Expérience panel can now load a run manifest back in: a new **Importer un manifeste** button and a hidden file input feed `GoalPanel.loadManifest(text)`, which parses, runs `validateManifest` and reports the first refusal reason. A loaded manifest shows a banner (name, replicates, goals, `paramsDigest`, engine-drift warning via the existing `engineDrift`) and takes over the next launch: `startSnapshot` / `configsForManifest` / `manifest.goals`, with the replicate count clamped to `MAX_REPLICATES` and the clamp reported. `manifest()` returns the imported object unchanged, so export → import → export is byte-identical. `tests/dom/manifestImport.dom.test.ts` (5 happy-dom tests) covers the banner, the round trip, refusals and the run path; `verify-history` now downloads a manifest, feeds it back through the file input and proves the first replicate's seed comes from it.
- **9.3 Runner flags.** `tools/openavida.ts` parses flags before validating and folds them into the payload: `--replicates/--seed/--max-ticks/--sample-every/--events/--no-events/--name` override the manifest, so the *effective* manifest is what lands in the run directory. `--progress-every N` prints `replicate k/total` through a new `RunOptions.onProgress`, forwarded to forked shards together with a per-shard line from the parent. `env.json` gains a `signature` (replicates, seed, maxTicks, sampleEvery, recordEvents) and `--resume` refuses a changed one instead of silently mixing configurations; a directory without a signature resumes exactly as before. Five new CLI tests drive `main()` in-process per flag, plus the resume refusals; `docs/research.md` documents every flag.
- **9.4 Worker research log.** `WorldFrame` now streams `eventLog` with the same incremental protocol as the neutral log (`eventLogSince`/`eventLogFull`, a tick cursor in the worker that falls back to a full resend when the log was trimmed past it, and a merge in `applyFrame` that drops mirrored rows from the first resent tick and re-applies the log bound). `#btn-events` therefore exports the same journal inline and under `?worker=1`; `verify-research` asserts `researchEvents > 0` and equal in both hosts, `tests/simHost.test.ts` covers full/incremental/trimming/duplicate cases, and the false "worker mode does not stream the research event log" limit is gone from `docs/model.md`.
- One deliberate copy change, confirmed line by line: both goldens gained exactly the new button label (`Importer un manifeste` / `Import a manifest`).
- GATES: typecheck ok (both configs); vitest **283/283** (64 files); build ok; ten browser verifier runs OK; baseline unchanged `e953dcdc`.


## Upgrade Stage 9.2 / 10a — binary world files, and the Expérience panel split (2026-09-14)

Second wave, two subagents on disjoint files. **No model change: the perf hash stays `e953dcdc`.**

- **9.2 World files.** `parseWorldBytes(bytes)` (`src/sim/serialize.ts`, now exported from the sim barrel) sniffs the container: the little-endian magic `0x4f415632` selects `decodeSnapshot`, anything else is UTF-8 JSON with a BOM tolerated. The header keeps **Exporter le monde** (JSON) and the Expérience data row gains **Exporter en .oav** (the `OAV2` container, ~4× smaller, exact round trip) beside **Importer un monde (JSON ou .oav)**; the import reads bytes, so the extension never decides. `tests/worldBytes.test.ts` covers the binary round trip (including `hashState` after `worldFromSnapshot`), JSON, BOM JSON, a truncated container and noise; `verify-interface` exports a `.oav`, checks the four magic bytes and re-imports it after bottling the world, asserting population and tick come back. `docs/research.md` gained a "World files" section (and now states the on-disk magic correctly: the bytes read `2VAO`, the word is `OAV2`).
- **10a `goalPanel.ts` split, 1898 → 690 lines** with no behaviour change: `goalContext.ts` (state + services contract), `goalWizard.ts` (goal definition), `goalRunView.ts` (progress, results, chart, CSV, report, persistence), `goalSweep.ts` (sweep + tournament) and `goalHistoryView.ts` (journal, replay, catalogue); `goalPanel.ts` keeps the template, `bind()`, presets, recipe, `run()`, `manifest()` and `loadManifest()`. The public API and every DOM id and catalog key are unchanged, and `goalPanel.ts` still re-exports `compareResults`/`parseSeed`/`RESULT_SORTS`/the ceilings/`SEED_HINT` so no import site or test moved. The split is proved by the copy goldens staying byte-identical apart from the deliberate `.oav` strings.
- Two follow-ups I made after the wave: the new parser is exported from `src/sim/index.ts` (the barrel is the public sim API), and the import copy no longer claims JSON-only (`btn.import`, `help.btn-import`, `help.btn-json`, plus a new `help.btn-oav` tooltip).
- One design correction the gate caught: the `.oav` export button started in the header and pushed the 360 px layout into overflow; it moved into the Expérience data row next to the import, which is also where a world file belongs. `verify-interface`'s five responsive widths pass again.
- GATES: typecheck ok (both configs); vitest **288/288** (65 files); build ok; ten browser verifier runs OK; baseline unchanged `e953dcdc`.


## Upgrade Stage 10b — `app.ts` split behind a shared context (2026-09-14)

Third wave, one subagent. **No model change, and the rendered interface did not move: the copy goldens stayed byte-identical without regeneration.**

- **`src/app.ts` 1674 → 897 lines.** The wiring now lives behind a documented `LabContext` (`src/ui/lab/context.ts`, 193 lines) that carries the mutable state and the closures the modules need; each module exports one factory and imports only the context, so the graph stays acyclic and `mount(root)` remains the single export `src/main.ts` uses.
  | Module | Lines | Owns |
  | --- | --- | --- |
  | `lab/worldControls.ts` | 307 | view A/B/split, 2D/3D, field layers, tools, speed, zoom, charts, focus, keys, tab strip |
  | `lab/feeds.ts` | 238 | `paintFeeds` (leaderboard, event feed, death log, inspect panel), inject/start handlers |
  | `lab/context.ts` | 193 | state + services contract, `el()` |
  | `lab/experimental.ts` | 122 | 3D, brains, LLM, multiplayer room and cursors |
  | `lab/timelineBar.ts` | 117 | snapshot range, marks, budget, preview, resume |
  | `lab/exports.ts` | 113 | share link, JSON, .oav, CSV, phylogeny, events, manifest, import |
  | `lab/schedulePanel.ts` | 91 | the programmed-change list |
- **Proof it is a move, not a rewrite.** The new `app.ts` was produced from the exact previous text by deleting the moved ranges and adapting call sites; the comment multiset lost nothing; a throwaway differential harness mounted the old and new versions in two happy-dom windows, ran 52 identical interactions (inject, snapshot/restore, bottle, view/tool/layer switches, speed/zoom/charts, terrain, schedule add/remove, steps, tabs, keys, focus, dialogs, exports, reseed) and compared `body.innerHTML` — identical at mount (140 015 chars) and after the script (161 241 chars), with the same root class, status line, `<html lang>`, error list and `window.__openavida` JSON. The harnesses were removed before the report.
- **Probes unchanged**: `window.__openavida` (including `neutralSubstitutions`, `historyRows`, `researchEvents`) plus the seven other `__openavida*` hooks, all still live; verified by a smoke run and by the browser gates.
- Three blocks stayed in `app.ts` for a good reason: `setTool`/`selectKit`/`showKit` (the pointer test asserts they are called there), `drawCharts` and the lineage-tree hit testing.
- GATES: typecheck ok (both configs); vitest **288/288** (65 files); build ok; ten browser verifier runs OK; copy FR and EN byte-identical; baseline unchanged `e953dcdc`.


## Upgrade Stage 11 (part 1) — the mature plate measured, hot paths fixed, bounds pinned (2026-09-14)

First wave of stage 11, three subagents on disjoint files. **No model change: the perf hash stays `e953dcdc`.**

### The measurement that was owed
`tools/perf.ts` is now a scenario runner (`npm run perf`: canonical, mature, chemostat, snapshot/frame; warmup + 50 measured steps each; table + JSON out). Measured on this machine (darwin/arm64, node 26.5.0), reproduced twice:
| Scenario | Population | Mean | p95 |
| --- | --- | --- | --- |
| canonical (260 founders, 48 warmup) | 74 | **3.80 ms/step** | 3.99 |
| mature (180 founders, tick 400) | 672 | **5.01 ms/step** | 5.30 |
| chemostat (dilution 0.02) | 705 | **4.97 ms/step** | 5.39 |

So the sim holds 60 fps at maturity with room to spare (5 ms of a 16.67 ms budget): the step cost is dominated by the 16 384-cell field work, not by the organisms. `tests/perf.test.ts` now asserts budgets instead of only finiteness: canonical ≤ 16.67 ms (the 60 fps target), mature ≤ 12.9 and chemostat ≤ 12.4 (2.5× the slowest recorded run), each printing its numbers. The calibration record and `docs/model.md` carry the figures and the command that produced them, and the "lightly populated world" limit is gone.

### The UI was the real hot spot
The five inspected offenders are fixed, with a before/after bench in a throwaway happy-dom harness (`npx vitest run --config /private/tmp/oabench/vitest.config.mjs`, same command both sides):
- **`paintFeeds` at 4 Hz rebuilt innerHTML for every feed unconditionally** → now keyed on a cheap signature (tick, population, deaths/events lengths, strains, selection, strain names) with `researchHtml` memoised: **1.97 ms → 0.0002 ms** when nothing changed (the bulk of the paused-frame win).
- **`refreshMetrics` ran ~15 DOM writes plus a full population sort every frame** → `setText` writes only on change, the strongest organism is cached per tick, the probe's pathway string moves to the UI cadence: **0.71 → 0.60–0.65 ms/frame** (paused frame 1.02 → 0.71–0.79 ms).
- **`drawCharts` re-mapped the whole history 4×/s** → early-return when the drawn key (tick, history length, population, lineages, extinctions, canvas boxes) is unchanged: ~0.04 ms/frame saved at the cadence.
- **`OccupancyHeat` decayed every strain's 16 384-cell map per tick and `normalized()` allocated 64 KB per frame** → lazy `decay^(tick delta)` per map (WeakMap keyed by the array, so a frame-installed map starts current) and an optional output buffer the renderer now reuses: **zero allocations in the steady heat path**, with a test proving lazy decay equals the eager loop cell by cell.
- Nothing visible moved: the copy goldens were **not regenerated** and still pass byte for byte, and the sim hash is unchanged (`tests/engine.test.ts` green).

### Memory bounds are now enforced
`tests/memory.test.ts` (6 tests, 6.4 s) pushes each growing structure past its ceiling: metrics history (trim window crossed directly, settles at exactly 3000 rows) with a **measured 818 bytes per row** with trait distributions on, death log, research event log, neutral log, and the timeline ring (byte budget respected after every one of 201 records, origin kept). `HISTORY_MAX`/`HISTORY_KEEP` are now exported constants used by both the world and the worker-mirror trim, and `docs/model.md` §8 gains a generated **memory bounds** table (new `memory` section) so the numbers and the enforcement cannot drift apart.

### Docs truth
The limit list no longer claims there is no manifest import and no binary export (Stage 9 fixed both). What remains is honest: `Profil v1` is not bit-identical to `engine-v1`, the 3D view has no exudate plane (Stage 12), and nutrient inflow is a source term by design.

- GATES: typecheck ok (both configs); vitest **298/298** (66 files); build ok; ten browser verifier runs OK; copy FR/EN byte-identical; baseline unchanged `e953dcdc`.


## Upgrade Stage 11 (part 2) + Stage 12a/12b/12d — perf gate, accessibility, persistence, docs (2026-09-14)

Second wave, four subagents on disjoint files. **No model change: the perf hash stays `e953dcdc`.**

### 11.3 A browser performance gate that measures the real plate
`tools/verify-perf.mjs` drives the app to a **mature plate** and measures it: 180 founders from the query string (`startPopulation`, the same seed as the node harness), stepped to tick 400 → **672 organisms**, then 20 × 5 steps for the engine cost, 5 s of live rAF deltas for the frame budget, and the JS heap after an idle window. Measured on this machine: **step 1.98 ms mean / 2.5 ms p95**, **frame 16.7 ms mean / 16.7 ms p95 with 0 long frames**, **heap 68 MB** — the interface holds 60 fps at maturity, and the step cost is a fifth of the frame. The gate is in `tools/gates.mjs` (11 verifiers now) with 5× headroom on the step and frame budgets and a printed note when the plate is lighter than the anchor. The subagent's own finding is why this is real: injecting the default kit 8× settles near 100 organisms, a fifth of the load the budget assumes, so the URL now pins the founders.
Scaling note recorded for honesty: the node harness reports ~5 ms/step for the same 672-organism plate while the browser reports ~2 ms; the difference is the node process running three scenarios back to back, not the browser being special.

### 12a Accessibility and motion
`prefers-reduced-motion` is honoured — the simulation clock is untouched (same ticks, speed, batching and backpressure) but the plate is redrawn on the 250 ms UI cadence and the trail is skipped; the media query is watched, so toggling it is live. Both dialogs return focus to the control that opened them (Escape and × included), the Expérience data-row controls are all keyboard-operable, and `tests/contrast.test.ts` computes WCAG ratios from the stylesheet and caught a real failure: `.trait-delta` was 4.4986:1 (AA needs 4.5) and is now 4.69:1. `verify-interface` gained a reduced-motion case and two focus assertions.

### 12b Persistence durability
`ensureStores()` is now a pure, tested function: a fresh database gains all three stores, a v1 database keeps its presets and gains the two new ones, a v2 database gains only the experiments store, and an existing store is never recreated (which would wipe data). Quota failures are caught **by name**, reported through a listener with a dedicated message, and leave nothing behind — including in the memory fallback. When IndexedDB is unavailable the journal says once that it is keeping data for this session only. Follow-up I applied: `save()` and `saveOrganism()` now return their outcome, so the preset and saved-organism paths no longer print "saved" over the top of a quota warning.

### 12d Documentation consolidation
`docs/README.md` indexes the set; `docs/formats.md` is the compatibility matrix (snapshot v2 + v1 migration, OAV2 v1 with the caveat that `decodeSnapshot` does not itself migrate, manifest v1, recipe v1, IndexedDB v3, the engine lineage table 1.0.0/r1 `c2c03a81` → 2.2.0/r4 `e953dcdc`, and the research exports), stating explicitly that the engine revision is the only shape with no backwards path. The three `grok-gauntlet*.md` build transcripts moved to `docs/archive/` (git records content-identical renames) with a note on what they are. A link check over all ten tracked markdown files reports 15 links, 0 broken.

- Goldens: regenerated deliberately for exactly two new strings (the guide's reduced-motion line and the manifest-import tooltip) — 223 controls covered now.
- GATES: typecheck ok (both configs); vitest **330/330** (68 files); build ok; **eleven** browser verifier runs OK; baseline unchanged `e953dcdc`.


## Upgrade Stage 12c/12e — release hygiene and the 3D exudate plane (2026-09-14)

Final wave, two subagents on disjoint files. **No model change: the perf hash stays `e953dcdc`.**

- **12c Release hygiene.** The status bar now carries the engine identity beside the seed ("engine 2.2.0 · rév. 4"), and I made its tooltip live: it re-renders the engine version, revision, hash algorithm and the **active world's params digest** on the UI cadence, so it follows parameter edits, reseeds and the A/B switch rather than freezing at page load. `tools/gates.mjs` measures `dist/` after the build and fails above a 4 MB budget (measured today: **2.77 MB**). CI gains `concurrency` with cancel-in-progress, uploads `scratch/` when a gate fails, and both jobs keep their structure; `npm run verify` (typecheck + tests + build + gates) is documented as the local equivalent.
- **12e The 3D exudate plane** — the last documented feature gap is closed. The 3D terrain shader gained an exudate sampler backed by a reused R8 texture, fed each frame (only in layer 5) through `normalizeOverlay` + `overlayByte`, the same normalisation and gamma LUT the 2D overlay uses; mode 5 mixes the surface toward the same violet the 2D layer uses, weighted by the normalised field, with a small height lift, and a zero-exudate cell keeps the composite colour exactly. The steady state allocates nothing. Verified pixel-wise: **3D modes 0–4 hash identical before and after**, mode 5 changes, 2D unchanged; `verify-exudate` gained a 3D case (delta 0.768 against a 0.4 bar, field note intact, no page errors) and the false limit is gone from `docs/model.md`.
- Two robustness fixes I made while verifying: the reduced-motion assertion no longer measures a fixed wall-clock window (it waits for the clock, then bounds the rate), because it flaked once under the load of a build plus eleven verifiers in sequence; and the gates now print the dist measurement on every run.
- GATES: typecheck ok (both configs); vitest **330/330** (68 files); build ok; `dist` 2.77 MB / 4.00 MB budget; **eleven** browser verifier runs OK; baseline unchanged `e953dcdc`.

