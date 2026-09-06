# OpenAvida Lab — gauntlet loop 2

You are an autonomous engineer working in the repository at the current directory (`openavida-lab`). Work through the TASKS below **in order**. For every task, run the LOOP until every GATE passes, then commit and move on. Do not ask questions; make routine decisions yourself and record them in `workbench.md`. Do not stop until every task is committed or marked BLOCKED with concrete evidence.

## Project facts (read before touching anything)

- Stack: Vite 6 + TypeScript 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) + Vitest. No runtime dependencies; do not add any. `git log --oneline -20` shows the history; the last round added the Explorateur and the drawn lineage tree.
- Layout: `src/sim/` pure seeded simulation (no DOM); `src/render/` WebGL and 2D canvas drawing; `src/ui/` DOM components; `src/app.ts` wires everything through a `SimHost` (`host.apply(op)` for every world mutation, `host.step(...)` for time; never mutate a `World` directly from UI code — the worker host mirrors state and would be overwritten). `src/ui/layout.ts` holds the HTML skeleton and the `icon()` map. `src/ui/help.ts` holds `CONTROL_HELP`, keyed by element id.
- Modules you will build on:
  - `src/sim/world.ts` (`World`: `birth`, `step`, `snapshot`/`restore`, `strains`, `innovations`, `deaths` (bounded log with `seq`), `history` of `MetricsSample`, `recording` of recipe ops).
  - `src/sim/simHost.ts` (`SimOp` union, `applySimOp`, frames) and `src/ui/workerHost.ts`; `src/sim/simWorker.ts`.
  - `src/sim/species.ts` (strains, strategies, innovations), `src/sim/lineageTree.ts` (ancestry), `src/sim/catalog.ts` (organism catalogue, filters, sorts), `src/render/lineageTreeLayout.ts` + `src/render/lineageTreeCanvas.ts` (drawn tree), `src/ui/explorer.ts` (Explorateur dialog with tabs Organismes / Lignées / Arbre / Enregistrés).
  - `src/sim/goals.ts` (`runTrial`, `Goal`, `GoalMetric`, `TrialConfig`, `worldForTrial`, sweeps), `src/sim/goalWorker.ts`, `src/ui/goalRunner.ts` (worker pool), `src/ui/goalPanel.ts` (presets, Expérience ciblée in five numbered steps, replay, catalogue), `src/ui/presetStore.ts` (IndexedDB v2: presets, last run, saved organisms).
  - `src/sim/recipe.ts` (recorded ops, `applyRecipe`, `?recipe=` URL), `src/sim/body.ts` (predator mass, feeding, hunting), `src/sim/dnaEdit.ts` + `src/ui/dnaEditor.ts` (visual DNA editor; the sequence is the single source of truth), `src/render/charts.ts`.
- Interface language is **French**, tone of a scientific instrument: terse, descriptive labels, no taglines. Describe mechanism and measurement.
- Every new interactive control with an id **must** get a `CONTROL_HELP` entry, and `tests/tooltips.test.ts` must list the source file that references the id in its `appSrc` array.
- Snapshots (`WorldSnapshot`, version 1) stay backward compatible: new fields optional, `World.restore` tolerates their absence.
- Seeded-core contract: `tests/perf.test.ts` prints `"lastHash":"c2c03a81"`. Do not change the order or count of `Rng` draws in `World.step`, and never draw from the world RNG in analysis code. A task that deliberately changes the model (only Task 6 may) must record the new hash in `workbench.md` and in this file's GATES line, with the reason.
- Existing ids are relied on by `tools/verify-interface.mjs`, `tools/verify-worker.mjs`, `tools/launch.mjs`. Add ids; never rename or remove.
- Reference docs: `README.md` (user-facing), `workbench.md` (engineering log; one section per task with what shipped and gate results).

## GATES (all must pass before a task is committed)

```bash
npx tsc --noEmit
npx vitest run            # all files pass; output must contain "lastHash":"c2c03a81"
npm run build             # emits dist/ with no errors
```

Then with the dev server running (`npm run dev` in the background, port 5174) and Chrome installed:

```bash
node tools/verify-interface.mjs
node tools/verify-interface.mjs 'http://127.0.0.1:5174/?worker=1'
node tools/verify-worker.mjs
node tools/launch.mjs http://127.0.0.1:5174/
```

All must exit 0. If a gate fails, fix the cause; never weaken an assertion, never skip a gate, never comment out a test. You may extend `verify-interface.mjs` with new assertions; keep its total runtime under 3 minutes.

## LOOP (per task)

1. Read the files named in the task plus their tests. Read `workbench.md` for prior decisions.
2. Pure logic first in `src/sim/` or `src/render/` with a Vitest file in `tests/`. Then UI in `src/ui/`, styles in `src/style.css`, hover help, then README and `workbench.md`.
3. Run GATES. On failure, diagnose from the actual output, fix, rerun. Maximum 6 fix iterations per task; then mark the task BLOCKED in `workbench.md` with the failing output and continue.
4. Screenshot new UI with Playwright (1440×900, `deviceScaleFactor: 2`) into `scratch/interface/` (git-ignored) and look at it; fix anything clipped, overlapping, or off-tone.
5. Commit with a one-line imperative subject and a body listing the gate results. One commit per task.

## TASK 1 — Timeline scrubber

Goal: rewind the active world to any recorded moment; plate, charts, Espèces and Explorateur all follow.

- `src/sim/timeline.ts` (pure): `Timeline` keeps snapshots every `every` steps (default 25) in a ring bounded by a byte budget (estimate a snapshot's size from its organism count and field length; default budget 150 MB, oldest dropped first, always keep the first snapshot). API: `record(world)`, `nearest(tick)`, `range()`, `clear()`, `entries()` (tick, population, bytes). Tests: spacing, budget eviction keeps the first, nearest picks the closest tick.
- Host: recording must happen where the world steps. Add a `SimOp` `{ kind: "timeline"; which; every }` and have the inline host and the worker record on each step; frames carry `timelineEntries` (tick, population) so the mirror knows what exists; add `SimHost.snapshotAt(which, tick): Promise<WorldSnapshot | null>` (inline immediate; worker request/reply). Rewinding is `host.apply({ kind: "restore", which, snapshot })` from the app.
- UI: a scrubber row under the playback bar (`#timeline-row`): a range input over recorded ticks, tick marks at recorded points, the current tick label, buttons ⏮ (first), ◀ (previous recorded), ▶ (next recorded), and "Reprendre ici" which restores that snapshot into the active world and clears everything after it. Scrubbing pauses the clock. While scrubbing, the plate shows the selected snapshot (render from a temporary World built from it, without replacing the live world until "Reprendre ici"). Show "pas N (enregistré toutes les 25)" and a budget note.
- verify-interface: run 60 steps, scrub back to the first recorded tick, assert the probe tick equals it after "Reprendre ici", then step and assert the tick increases from there.

## TASK 2 — Event log with causes

- `src/sim/events.ts` (pure): `detectEvents(prev: MetricsSample & extra, world)` producing `WorldEvent` records: `lineage-dominant` (a lineage crosses 20 % of the population, once per lineage), `lineage-collapse` (a lineage that ever exceeded 20 % goes extinct), `first-predation`, `innovation-sweep` (an innovation's living descendants exceed 30 % of its strain, once), `strain-extinct`, `population-crash` (−40 % within 20 steps), `population-boom` (+100 % within 20 steps). Events carry tick, ids and a French one-line text. Store on `World.events` (bounded 500, in snapshots, mirrored in frames).
- UI: an "Événements" block in Analyse with the last 40 events (newest first, coloured by kind); each row links into the explorer (organism / lineage / strain) and, when a tick is known and Task 1 shipped, scrubs to it.
- Tests: synthetic worlds that trigger each event exactly once.

## TASK 3 — Spatial trails and heat maps

- `src/sim/heat.ts`: per strain, an occupancy heat map over the last K steps (default 200) as a `Float32Array` per strain, updated each step with exponential decay (no RNG). Kept out of snapshots (recomputed on load) and sent in frames only for the selected strain.
- Renderer: `LabRenderer.heatStrain` draws the selected strain's heat map as a translucent overlay (own texture) under organisms; a toggle in the Espèces tab per strain card ("Carte de présence"). Also "Trace" for the selected organism: last 120 positions (ring buffer on the organism, not in snapshots) drawn as a fading polyline in 2D.
- Tests: decay and normalisation; overlay uniform toggled without changing organism rendering when off (hash of a `readPixels` region in `launch.mjs` is optional).

## TASK 4 — Multi-goal experiments

- `src/sim/goals.ts`: `runTrial` accepts `goals: Goal[]` (keep the single-goal signature working); `TrialResult.reachedTicks: (number | null)[]`; the trial stops when all goals are reached, the world is empty, or every remaining goal is unreachable. `summarizeTrials` reports per goal.
- UI: in step 2 of Expérience ciblée, "+ Ajouter un objectif" builds a list (max 4) with the same builder; results table gains one "Pas" column per goal; the chart plots the first goal; CSV gains a column per goal.
- Tests: two goals reached at different ticks; early stop when the second becomes unreachable.

## TASK 5 — Strain tournaments

- `src/sim/tournament.ts` (pure): `tournamentConfigs(start: WorldSnapshot, contestants: {name, genome}[], perPair, seedBase)` builds replicate configs where each pair (i, j) is injected in equal numbers into the start world (use a snapshot op list, not RNG outside the trial), and `summarizeTournament(results)` returns a win matrix (winner = larger share after `maxTicks`, draw if within 10 %).
- UI: an "Tournoi" block in Expérience: pick 2–4 saved organisms or strains, replicates per pair, budget; matrix rendered as a table with colour intensity; CSV export.
- Tests: symmetric matrix shape, self-pairs skipped, draw rule.

## TASK 6 — Environment scripts (scheduled changes)

- `src/sim/schedule.ts`: `ScheduledOp = { at: number; op: RecipeOp | { type: "scale"; field; k } | { type: "params"; params } }`; `World.schedule: ScheduledOp[]` applied inside `step()` when `tick === at` **after** `applyDisturbances` and before organisms act. Only a world with a non-empty schedule changes behaviour, so the perf hash stays `c2c03a81`; assert this in a test.
- Recipes: schedules are part of `Recipe` (`schedule` array) and of snapshots.
- UI: in Milieu, a "Programme" block: rows (pas, action, paramètres) with add/remove, applied to the active world through a `SimOp` `{ kind: "schedule", which, schedule }`; a marker line on the fitness chart at each scheduled tick.
- Goal runs: trial configs accept `schedule` so an experiment can test adaptation to change.
- Tests: op applied exactly at its tick; scale multiplies the field; recipe round trip.

## TASK 7 — Fitness landscape probe

- `src/sim/landscape.ts` (pure): for a genome and an `EnvSample`, enumerate every single-codon substitution inside coding regions (61 sense codons per position, deduplicated by resulting phenotype), evaluate `fitness(phenotype, env, zeroNeighbors)`, return the top and bottom N with position, codon, trait deltas.
- UI: in the DNA editor, a "Paysage" details section: env sampled from the selected organism's cell (or the plate centre), a bar list of the 10 best and 10 worst substitutions; clicking one applies it in the strip (history-aware, uses `replaceRange`).
- Tests: a known genome where a specific substitution raises photosynthesis; results sorted; no substitution outside ORFs.

## TASK 8 — Genome alignment between any two organisms

- `src/sim/dnaEdit.ts`: `alignSequences(a, b)` (banded Needleman–Wunsch, gap −1, mismatch −1, match +1, band 48) returning aligned strings with `-` gaps and a diff summary; tests on insertions, deletions, substitutions, identical.
- Explorateur: on an organism record, "Comparer à…" opens a picker (organism id, saved organism, or the selected organism) and shows the two aligned sequences as two DNA strips with matched columns, differences highlighted; "Charger la comparaison" loads the second into the editor with `diffAgainst` the first.

## TASK 9 — Experiment report export

- `src/ui/report.ts`: builds one self-contained HTML string (inline CSS, embedded PNGs from canvases via `toDataURL`): setup (params, recipe ops, schedule), goal(s), replicate summary and table, the trial chart, the lineage tree of the focus if the explorer is open, saved organisms referenced by the run. French headings. "Rapport HTML" button in Expérience step 4 downloads it.
- Test: the pure builder given fixture data produces valid HTML containing every section heading and the CSV row count.

## TASK 10 — Determinism self-check

- Expérience step 3: "Vérifier le déterminisme" runs replicate #1 twice in workers and compares `hashState()` of the end worlds; result shown inline (✓ identical / ✗ with both hashes). Uses `runReplicates` with `keepSnapshot` and hashes the snapshots through `worldFromSnapshot(...).hashState()`.
- Also add `tools/verify-determinism.mjs` running the same check headlessly; add it to the GATES list of this file once it passes.

## Definition of done

All ten tasks committed (or BLOCKED with evidence), GATES green on the final tree, `README.md` and `workbench.md` updated per task, no new dependencies, French scientific copy throughout, perf hash unchanged except as documented in Task 6.
