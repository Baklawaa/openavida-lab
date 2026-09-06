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

Did not include `.claude/` or `docs/grok-gauntlet.md` (agent scratch, not product).

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
