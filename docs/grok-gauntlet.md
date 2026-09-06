# OpenAvida Lab — gauntlet loop

You are an autonomous engineer working in the repository at the current directory (`openavida-lab`). Work through the TASKS below **in order**. For every task, run the LOOP until every GATE passes, then commit and move to the next task. Do not ask questions; make routine decisions yourself and record them in `workbench.md`. Do not stop until every task is either committed or marked BLOCKED with a concrete reason.

## Project facts (read before touching anything)

- Stack: Vite 6 + TypeScript 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) + Vitest. No runtime dependencies. Do not add any.
- Layout: `src/sim/` is the pure, seeded simulation (no DOM). `src/render/` is WebGL and 2D canvas drawing. `src/ui/` is DOM components. `src/app.ts` wires everything. `src/ui/layout.ts` holds the HTML skeleton and the `icon()` map. `src/ui/help.ts` holds `CONTROL_HELP`, the hover-help catalog keyed by element id.
- Existing modules you will extend:
  - `src/sim/dnaEdit.ts` (pure DNA editing model) and `src/ui/dnaEditor.ts` (visual DNA editor; the ACGT sequence is the single source of truth).
  - `src/sim/species.ts` (strains = founding genome inherited by descendants; strategies = phenotype classes; `Innovation` records; `groupStats`, `innovationSpread`) and `src/ui/speciesPanel.ts` (Espèces tab).
  - `src/sim/goals.ts` (`runTrial`, `Goal`, `GoalMetric`, `TrialConfig`, `summarizeTrials`), `src/sim/goalWorker.ts`, `src/ui/goalRunner.ts` (worker pool), `src/ui/goalPanel.ts` (presets + Expérience ciblée), `src/ui/presetStore.ts` (IndexedDB).
  - `src/sim/world.ts` (`World`: `birth`, `step`, `snapshot`/`restore`, `strains`, `innovations`, `history` of `MetricsSample`).
  - `src/render/charts.ts` (`drawGroupSeries`, `drawTrialSeries`, shared `axes`/`prepare` helpers).
- Interface language is **French**. Tone is a scientific instrument: terse, descriptive labels, no taglines, no encouragement copy. Describe mechanism and measurement.
- Every new interactive control with an id **must** get a `CONTROL_HELP` entry, and `tests/tooltips.test.ts` must list the source file that references the id in its `appSrc` array.
- Snapshots (`WorldSnapshot`, version 1) must stay backward compatible: new fields are optional and `World.restore` must tolerate their absence.
- The seeded core is a contract: `tests/perf.test.ts` prints `"lastHash":"c2c03a81"` (baseline set with the predator model; before that it was 9d4c0f2b). Any change to the order or count of `Rng` draws inside `World.step` breaks it. Never draw random numbers from the world RNG in analysis code.
- Existing element ids are relied on by `tools/verify-interface.mjs` and `tools/launch.mjs`. Do not rename or remove ids; add new ones.
- Keep the plate first: the workspace grid, letterboxing in `layout()` in `src/app.ts`, and the `wide-workspace` mode must keep working at 1440×900, 2000×700, 1100×768, 768×1024, 390×844.
- Reference docs: `README.md` (user-facing), `workbench.md` (engineering log; append one section per task with what shipped and the gate results).

## GATES (all must pass before a task is committed)

```bash
npx tsc --noEmit
npx vitest run            # all files pass; output must contain "lastHash":"c2c03a81"
npm run build             # emits dist/ with no errors
```

Then with the dev server running (`npm run dev` in the background, port 5174) and Chrome installed:

```bash
node tools/verify-interface.mjs
node tools/launch.mjs http://127.0.0.1:5174/
```

Both must exit 0. `verify-interface.mjs` prints `Interface verified: …`. If a gate fails, fix the cause; never weaken an assertion to pass, never skip a gate, never comment out a test. You may extend `verify-interface.mjs` with new assertions (Task 5 requires it).

## LOOP (per task)

1. Read the files named in the task plus their tests. Read `workbench.md` for prior decisions.
2. Write the pure logic first in `src/sim/` with a Vitest file in `tests/`. Then the UI in `src/ui/` and styles in `src/style.css`, then hover help, then README and `workbench.md`.
3. Run GATES. On failure, diagnose from the actual output, fix, rerun. Maximum 6 fix iterations per task; after that mark the task BLOCKED in `workbench.md` with the failing output and continue to the next task.
4. Take screenshots of the new UI with Playwright (viewport 1440×900, `deviceScaleFactor: 2`) into `scratch/interface/` (git-ignored) and look at them; fix anything clipped, overlapping, or off-tone.
5. Commit with a one-line imperative subject and a body listing the gate results. One commit per task.

## TASK 0 — Baseline commit

The working tree contains four uncommitted rounds of work (visual DNA editor, plate-first layout, Espèces tab, presets + goal runs). Run GATES on the tree as is. Then commit everything in one commit titled `Visual DNA editor, plate-first layout, species tracking, presets and goal runs`. Do not modify code in this task except to fix a failing gate.

## TASK 1 — Parameter sweeps on top of replicates

Goal: answer "at what toxin level does adaptation stop" from the Expérience tab.

- `src/sim/goals.ts`: add `SweepVariable` = `"mutationRate" | "maxPopulation" | "reproduceEnergy" | "toxinScale" | "nutrientScale" | "temperatureScale" | "lightScale"`. Field scales multiply the corresponding field of the start snapshot in `worldForTrial` (extend `TrialConfig.overrides` with optional `fieldScale: Partial<Record<FieldName, number>>`). Add `sweepConfigs(base: TrialConfig, variable, values: number[], replicates: number): TrialConfig[]` (seeds continue per value) and `summarizeSweep(values, results per value) → per value {value, summary}`.
- Tests (`tests/goals.test.ts`): field scale affects `evaluateGoalMetric` on the trial world and not the snapshot; sweep config count = values × replicates; seeds are unique; summary per value.
- UI (`src/ui/goalPanel.ts`): a "Balayage" section under the goal builder: variable select, from / to / steps (linear), replicates per value, run button. Progress reuses the existing bars. Results: a table (value, réussite k/n, médiane, min–max, extinctions) and a chart "pas jusqu'à l'objectif vs valeur" (median with min–max band; add `drawSweep` to `src/render/charts.ts`). CSV export of the table. Runs use `runReplicates` from `src/ui/goalRunner.ts` unchanged.
- Hover help for every new id. README paragraph under "Presets and goal runs".

## TASK 2 — Show the mutation itself

Goal: from a "Changements clés" entry, open the exact codon change in the DNA editor.

- `src/sim/species.ts` / `src/sim/world.ts`: `Innovation` gains `parentGenome: string` and `genome: string` (set in `birth` when the innovation is recorded; both ≤ 384 chars). Snapshot round-trips them; legacy snapshots without them still load.
- `src/sim/dnaEdit.ts`: `sequenceDiff(a: string, b: string): Array<{ a: number; b: number; kind: "sub" | "ins" | "del" }>` giving base ranges in `b` that differ from `a` (simple common-prefix / common-suffix diff is acceptable; document the limitation). Tests: point, insertion, deletion, duplication, identical sequences.
- `src/ui/dnaEditor.ts`: `load(seq, { reference, diffAgainst })`. When `diffAgainst` is given, tiles in changed ranges get class `nt-diff` (rendered with a visible outline in `src/style.css`) and the selection info line reads "n bases modifiées par rapport au parent". The phenotype delta column uses the parent as reference.
- `src/ui/speciesPanel.ts`: each innovation row gets a button `Voir la mutation` that calls a new option `openMutation(innovation)`; `src/app.ts` loads the child genome into the editor with `diffAgainst = parentGenome`, switches to the Organismes tab, and scrolls the editor into view.
- Extend `tools/verify-interface.mjs`: after a short run with mutation rate 1 (set via the goal panel is not needed; use `window.__openavida` or a placed heterotroph plus 60 steps with `#btn-step-once` is too slow — instead add a probe hook `window.__openavidaMutate(n)` in `src/app.ts` that steps the active world n times with mutation rate 1 for test use), open Espèces, click the first `Voir la mutation`, assert `#dna-strip .nt-diff` count ≥ 1.

## TASK 3 — Group trajectories over time

Goal: see a strain leave the vent as it happens.

- `src/sim/world.ts` `recordMetrics`: add `MetricsSample.strainTracks?: Record<string, [cx: number, cy: number, spread: number, temperature: number, nutrient: number]>` computed per strain per tick (rounded to 2 decimals to keep snapshots small). No RNG use.
- `src/sim/species.ts`: `strainTrack(history, strainId, every)` returning sampled points; tests on a hand-built history.
- `src/ui/speciesPanel.ts`: in strains mode, a "Trajectoires" card with (a) a small canvas map in world proportions drawing each strain's centroid path (fading from old to new, dot at the current position, terrain vents drawn as markers), and (b) a line chart of mean local temperature per strain (reuse `drawGroupSeries` with a new accessor or add `drawTrackSeries`). Legend shares the strain colors.
- Card facts: add "Déplacement du centre depuis le fondateur : n cellules".

## TASK 4 — Scenario recipes

Goal: tiny, shareable, replayable setups instead of only binary snapshots.

- `src/sim/recipe.ts`: `Recipe = { version: 1; params: SimParams; ops: RecipeOp[] }` with `RecipeOp` = paint `{x,y,radius,brush,amount?}`, place `{x,y,genome}`, inject `{genome,count,x?,y?}`, strain `{name,genome}`, step `{n}`. `World` gets `recording: RecipeOp[] | null`; `paint`, `birth` for founders, `injectStrain`, `defineStrain` (manual) and `step` append ops when recording is on (consecutive steps collapse into one `{n}`). `applyRecipe(recipe): World` builds a fresh world and replays. `recipeToQuery` / `recipeFromQuery` encode as base64url JSON in `?recipe=`; if the encoded string exceeds 6000 characters, `buildShareURL` must fall back to the params-only URL and the UI must say so.
- Tests: record → replay reproduces `hashState()` for the same seed; query round trip; long recipe falls back.
- UI: in Expérience, a "Recette" block: toggle "Enregistrer les actions" (on by default for a fresh world), op count, buttons "Copier le lien de la recette", "Exporter .json", "Importer .json", "Rejouer dans B". `parseShareURL` path in `src/app.ts` applies a recipe from the URL at startup.
- README section "Recipes".

## TASK 5 — Interface coverage for species, presets and goal runs

Extend `tools/verify-interface.mjs` (keep it one linear script) with:

- Espèces: define a strain from the editor (`#strain-name`, `#btn-strain-define`), assert a `.group-card` with that name and state "non placée", inject it (`[data-act="inject"]`), assert its count > 0, toggle `#opt-color-strain input`, switch to `#species-strategies` and back, rename via `.group-name` input.
- Presets: save (`#preset-name`, `#btn-preset-save`), assert `.preset-row`, load into the active world, remove; assert the list is empty afterwards.
- Goal run: choose the `toxin` template in `#goal-example`, set `#goal-reps` to 2 and `#goal-max` to 60, click `#btn-goal-run`, wait for two `.goal-result` rows, assert `#goal-summary` contains "Réussite", click the first "Ouvrir dans B" and assert `window.__openavida.world === "B"`, then wait for the CSV `download` event from `#btn-goal-csv`.
- Keep the total runtime under 90 seconds on a laptop.

## TASK 6 — Strain colors in 3D

`src/render/view3d.ts`: add `colorByStrain` and read `world.strains.get(org.strainId)?.color` when set; `src/app.ts` sets it together with the 2D renderer. `tools/launch.mjs` with `?view3d=1` must still exit 0.

## TASK 7 — Visible simulation in a worker (stretch)

Only after Tasks 0–6 are committed. Behind a URL flag `?worker=1` (add to `src/sim/flags.ts`):

- `src/sim/simWorker.ts` owns the `DualWorld`. Main thread sends ops (`step`, `speed`, `pause`, `paint`, `place`, `inject`, `snapshot`, `restore`, `defineStrain`, `replaceGenome`, `hash`) and receives frames: field bytes, organism positions/colors as transferable typed arrays, plus the latest `MetricsSample` and a throttled JSON of what the panels need (`strains`, `innovations` tail, `deaths` tail, selected organism).
- `src/app.ts` must not branch everywhere: introduce a `SimHost` interface with two implementations (inline, worker) and route the existing calls through it.
- Gate additions: with `?worker=1`, `tools/launch.mjs` exits 0 and `hashState` requested through the worker after 48 default steps equals the inline hash for the same seed; `tools/verify-interface.mjs` passes with and without the flag (pass the URL as its first argument).
- If the budget runs out, leave the inline path as default, keep the worker path compiling, and document exactly what remains.

## Definition of done

All seven tasks committed (or BLOCKED with evidence), GATES green on the final tree, `README.md` and `workbench.md` updated per task, no new dependencies, French scientific copy throughout, perf hash unchanged.
