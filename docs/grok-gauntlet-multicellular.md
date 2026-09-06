# OpenAvida Lab — gauntlet loop: multicellularity

You are an autonomous engineer working in the repository at the current directory (`openavida-lab`). Work through the TASKS below **in order**. For every task, run the LOOP until every GATE passes, then commit and move on. Do not ask questions; make routine decisions yourself and record them in `workbench.md`. Do not stop until every task is committed or marked BLOCKED with concrete evidence.

## Project facts (read before touching anything)

- Stack: Vite 6 + TypeScript 5.8 (strict, `noUnusedLocals`, `noUnusedParameters`) + Vitest. No runtime dependencies; do not add any.
- Layout: `src/sim/` pure seeded simulation (no DOM); `src/render/` WebGL and 2D canvas; `src/ui/` DOM components; `src/app.ts` wires everything through a `SimHost` (`host.apply(op)` for every world mutation, `host.step(...)` for time; never mutate a `World` from UI code — the worker host mirrors state through frames and would overwrite it). `src/ui/layout.ts` holds the HTML skeleton and `icon()`. `src/ui/help.ts` holds `CONTROL_HELP` keyed by element id.
- The genome → phenotype mapping is `src/sim/mapping.ts` (single source of truth: `TRAIT_NAMES`, `TRAIT_SPEC`, `BASAL`, `AA_GROUPS` → `CODON_TABLE`; all 61 sense codons are assigned). `src/sim/genome.ts` decodes ORFs; `src/sim/kits.ts` defines founder kits; `src/ui/labels.ts` holds French trait labels and hints; `src/ui/dnaEditor.ts` builds its palette from `TRAIT_NAMES`.
- Ecology: `src/sim/ecology.ts` (`metabolize`, `interactNeighbors`, `chemotaxisDir`, `moveOrganisms`, `emptyNeighbor`, `neighborIndex`, `DX/DY`), `src/sim/body.ts` (predator mass, `feed`, `preyGap`, `canBreed`, `energyCap`), `src/sim/fitness.ts`, `src/sim/world.ts` (`World`: `birth`, `step` order = fields → shade → disturbances → per-organism decay/metabolize/crowding/fitness → interactions → energy cap → movement → `reproduceAll` → `reap` → metrics; `snapshot`/`restore`; `strains`, `innovations`, bounded `deaths`, `history` of `MetricsSample`).
- Frames to the worker mirror are built in `src/sim/simHost.ts` (`frameFromWorld` / `applyFrame`): organisms are copied whole, so new per-organism fields travel automatically; anything stored elsewhere on `World` must be added to frames explicitly.
- Rendering: `src/render/webgl.ts` (`LabRenderer`: `uploadPlate` paints occupied cells into a texture, `drawOrganisms` draws points with per-vertex colour/size/selected, `organismRgb` guild colours), `src/render/view3d.ts` (columns).
- Analysis: `src/sim/species.ts` (strains, strategies, `groupStats`), `src/sim/catalog.ts` (catalogue entries/filters/sorts), `src/ui/speciesPanel.ts`, `src/ui/explorer.ts` (Organismes / Lignées / Arbre / Enregistrés), `src/sim/goals.ts` + `src/ui/goalPanel.ts` (goal runs; `GoalMetric` union; templates list `TEMPLATES`).
- Interface language is **French**, tone of a scientific instrument. Every new control id needs a `CONTROL_HELP` entry, and `tests/tooltips.test.ts` must list the file referencing it in `appSrc`.
- Snapshots (`WorldSnapshot` v1) stay backward compatible: new fields optional; `World.restore` tolerates their absence and rebuilds what it can.
- Seeded-core contract: `tests/perf.test.ts` prints `"lastHash":"c2c03a81"`. **This gauntlet deliberately changes the model** (Task 1 reassigns codons, Task 2 adds colony dynamics). The rule becomes: the hash may change only in Tasks 1 and 2; each time, record the old and new hash and the reason in `workbench.md` and update the GATES line below. Tasks 3–7 must not change it again unless their acceptance criteria say so (Task 3 and Task 4 do). Never draw from the world RNG in analysis or rendering code; every RNG draw you add to `step` must be documented in the commit body.
- Existing ids are relied on by `tools/verify-interface.mjs`, `tools/verify-worker.mjs`, `tools/launch.mjs`. Add ids; never rename or remove.

## GATES (all must pass before a task is committed)

```bash
npx tsc --noEmit
npx vitest run            # all files pass; output must contain "lastHash":"<current baseline — c2c03a81 at start>"
npm run build
```

Then with the dev server running (`npm run dev` in the background, port 5174) and Chrome installed:

```bash
node tools/verify-interface.mjs
node tools/verify-interface.mjs 'http://127.0.0.1:5174/?worker=1'
node tools/verify-worker.mjs
node tools/launch.mjs http://127.0.0.1:5174/
```

All must exit 0. Never weaken an assertion, never skip a gate, never comment out a test. Keep `verify-interface.mjs` under 3 minutes.

## LOOP (per task)

1. Read the files named in the task and their tests. Read `workbench.md`.
2. Pure logic first (`src/sim/`, `src/render/` layouts) with a Vitest file; then UI, styles, help, README, `workbench.md`.
3. Run GATES; diagnose from actual output; fix; rerun. Maximum 6 fix iterations, then BLOCKED with evidence and continue.
4. Screenshot new UI with Playwright (1440×900, `deviceScaleFactor: 2`) into `scratch/interface/` and look at it. For rendering tasks also inspect a zoomed crop of the plate.
5. Commit with an imperative subject and a body listing gate results (and the hash when it changed). One commit per task.

## Model to implement (read fully before Task 1)

**Adhesion** is a new trait `adhesion` (0–1, clamp, basal 0). Cells with `adhesion ≥ ADHESION_MIN (0.35)` are *adhesive*.

**Colony** = a set of adjacent (8-neighbour) adhesive cells sharing a `colonyId`. Colonies grow only by budding: a child born adjacent to an adhesive parent, itself adhesive, joins the parent's colony (a solitary adhesive parent and its adhesive child found a new colony). Two colonies never merge. Colony size cap `= 2 + round(adhesion_mean × 14)` (max 16). A colony dissolves (cells become solitary, `colonyId = 0`) when it has fewer than 2 living cells.

**Sessility**: cells in a colony do not move individually. A colony moves as a block with probability `mean motility × 0.5` per step toward the direction its cells' chemotaxis votes for most, and only if every target cell is free or belongs to the same colony (compute the vote with existing `chemotaxisDir`; one RNG draw per colony per step for the probability, plus the draws `chemotaxisDir` already makes).

**Energy sharing**: each step after `metabolize`, each colony pools `SHARE = 0.3 × adhesion_mean` of every cell's energy and redistributes the pool equally. Total energy is conserved exactly (test it).

**Specialisation (roles)**: each colony cell takes one of four roles each step from its local context, deterministically: `photo` if light ≥ nutrient at its cell and it has photo > uptake, `uptake` if nutrient dominates, `hunter` if it has an edible neighbour (`preyGap`), `shield` if local toxin ≥ 0.15 and resist > 0.2; solitary cells have role `none`. A specialised cell gets `× (1 + 0.5 × adhesion)` on the gain of its role and `× 0.6` on the gains of the other two energy roles (photo, uptake), and a shield cell halves toxin damage for every colony cell adjacent to it. Store the role on the organism (`role`), it is derived state (recomputed on restore).

**Colony reproduction (fission)**: when a colony is at its cap and its mean energy ≥ `reproduceThreshold`, the cell with the most energy buds a solitary founder cell at the colony's frontier (an empty cell adjacent to the colony, chosen with the existing `emptyNeighbor` search seeded from that cell), with the usual mutation. The founder starts a new colony (colonyId assigned when its first adhesive child attaches). Per-cell reproduction stays as today for cells below the cap.

**Colony identity**: `World.nextColonyId`; colonies are not stored as objects: derive membership from `colonyId` each step (a `Map<colonyId, Organism[]>` built once per step). Snapshots carry `colonyId` per organism and `nextColonyId`.

**Kit**: a new founder kit "Colonial" (`founderColonial()`): adhesion ×4, photo ×3, uptake ×2, size ×1.

## TASK 0 — Baseline

Run GATES on the tree as is and commit nothing unless a gate is red (fix it first).

## TASK 1 — The adhesion trait

- `src/sim/mapping.ts`: add `"adhesion"` to `TRAIT_NAMES`, `TRAIT_SPEC` (0–1, clamp, description), `BASAL` (0), `TRAIT_COLOR` (`#f5a3ff`). Reassign the codons of the display-only trait `hue` to `adhesion`: F (TTT, TTC) → adhesion +0.12, W (TGG) → adhesion +0.2. Keep `hue` in the phenotype but derive it in `phenotypeFromRaw` from the genome-independent formula `hue = 0.55` when raw contributions are zero and otherwise from a deterministic hash of the raw trait vector (display only; document). `mappingLegend()` and `codonsForTrait("adhesion")` must reflect the change. Update `tests/core.test.ts` expectations if they enumerate the codon table.
- `src/ui/labels.ts`: `TRAIT_LABEL.adhesion = "Adhésion"`, hint "Fait tenir les cellules filles au parent ; à partir de 0,35 les cellules forment une colonie."; `src/ui/help.ts` gets `gene-add-adhesion`; `src/sim/species.ts` `INNOVATION_THRESHOLD.adhesion = 0.06`; `TRAIT_ABBR` in `speciesPanel.ts` (`Adh`); the DNA editor palette and phenotype table pick the new trait up automatically — verify in the browser.
- Record the new perf hash in `workbench.md` and in this file's GATES line (this task changes `randomGenome` phenotypes).
- Tests: decoding a TTT/TGG cassette yields adhesion > 0.35; the kit genomes' other traits are unchanged.

## TASK 2 — Colonies: budding, cap, dissolution, energy sharing

- `src/sim/types.ts`: `Organism.colonyId: number` (0 solitary), `Organism.role: "none" | "photo" | "uptake" | "hunter" | "shield"`; `WorldSnapshot.nextColonyId?`.
- `src/sim/colony.ts` (pure): `isAdhesive(o)`, `colonyCap(members)`, `groupColonies(organisms): Map<number, Organism[]>`, `attachChild(parent, child, world)` (rule above), `dissolveSmall(groups)`, `shareEnergy(groups)` (exact conservation: distribute the pool with integer-safe arithmetic and give the rounding remainder to the first cell), `colonyStats(groups)` (count, mean size, max size, cells in colonies).
- `src/sim/world.ts`: `birth` attaches adhesive children (`attachChild`); `step` after the metabolize loop: `groupColonies` → `dissolveSmall` → `shareEnergy`; `snapshot`/`restore` carry `colonyId` and `nextColonyId` (default 0 / rebuild by re-grouping adjacent adhesive cells when the field is missing); `MetricsSample.colonies?: { count, meanSize, maxSize, cells }` recorded in `recordMetrics`.
- Frames: organisms carry the new fields already; add `nextColonyId` to `WorldFrame` and `applyFrame`.
- Hash: record old/new in `workbench.md` and GATES (colony cells no longer move individually — see Task 3 — so keep movement unchanged in this task and only record the hash once here if it changes; if it does not change because no test genome is adhesive, say so).
- Tests (`tests/colony.test.ts`): a Colonial founder budding into a colony of ≥ 3 within 60 steps on a lit plate; cap respected; a colony reduced to one cell dissolves; energy sharing conserves the sum to 1e-9; snapshot round trip keeps `colonyId`.

## TASK 3 — Sessility and block movement

- `src/sim/ecology.ts` `moveOrganisms`: skip cells with `colonyId > 0`; after the per-cell loop, move colonies as blocks per the model (helper `moveColonies(groups, …)` in `colony.ts`). Exactly the RNG draws stated in the model; document them.
- Tests: a colony moves as a unit and never overlaps another organism; a blocked colony stays put; the perf hash is recorded again in `workbench.md` if it changed.

## TASK 4 — Specialisation

- `colony.ts`: `assignRoles(groups, world)` and the gain multipliers applied inside `metabolize` (pass the role) and `interactNeighbors` (shield halves toxin for adjacent colony cells — implement in `metabolize` by looking up adjacent shields from a per-step `Set` of shield cell indices). Solitary cells are unaffected: assert that a world with no adhesive organism keeps the Task-3 hash.
- Tests: role assignment on a hand-built colony straddling a light/nutrient boundary; the photo cell earns more than a solitary twin on the same cell; shield reduces a neighbour's toxin loss.

## TASK 5 — Fission

- `colony.ts`: `fission(group, world)` per the model, called from `reproduceAll` before per-cell reproduction; uses `emptyNeighbor` from the richest cell's position; children inherit strain, lineage rules as today (mutant → new lineage, so innovations and the tree keep working).
- Tests: a capped, well-fed colony emits a founder at its frontier; the founder is solitary; a second colony appears within 80 steps.

## TASK 6 — Rendering tissues

- `src/render/webgl.ts`: (a) `uploadPlate` writes, for colony cells, a colony tint (stable colour from `colonyId`, hashed to a hue at 55 % saturation) blended 50/50 with the guild colour, so tissue reads as one patch; (b) draw a 1-px outline around each colony (compute, per colony cell, which of its 4 neighbours are outside the colony and write them to an "edge" channel of the plate texture; the field shader draws edges in a lighter tint); (c) `drawOrganisms`: colony cells are drawn as slightly larger, squarer points (a `uShape` uniform or a per-vertex flag), role-tinted: photo → gold rim, uptake → teal rim, hunter → rose rim, shield → violet rim. Solitary rendering unchanged.
- `src/render/view3d.ts`: colony cells share one column height (colony mean) and get the colony tint.
- Espèces "Colorer par souche" and the lineage highlight ring keep working.
- Screenshot a Colonial-kit run at 200 steps, zoomed crop of one colony; fix anything that does not read as a tissue at a glance.

## TASK 7 — Instrumentation and experiments

- Kit: add `founderColonial` to `src/sim/genome.ts`, `DNA_KITS` (`id: "colonial"`, focus `adhesion`), `KIT_COPY` in `src/ui/layout.ts` (label "Colonial", short "adhesion ×4 · photo ×3 · uptake ×2", icon "mutual" or a new `cells` icon), `CONTROL_HELP["kit-colonial"]`; `tests/dna-ui.test.ts` and `kitMatchesFocus` must cover it.
- Metrics strip: `m-col` "Colonies" (count · taille max) next to the four existing metrics; a fourth chart is not needed — put colony count on the diversity chart as a second series.
- Inspect: role and colony id in the selection info; Espèces cards: cells in colonies (%) and largest colony; Explorateur: catalogue entries carry `colonyId` and `role`, filters "En colonie" and "Rôle", sort "Plus grande colonie", grouping "Colonie".
- Goals: `GoalMetric` gains `{ kind: "colonies" }` (count), `{ kind: "colony-max" }`, `{ kind: "colony-share" }`; template "Émergence de la multicellularité : 30 % des cellules en colonie pendant 20 pas"; sweep variable `lightScale` already exists for the classic light-gradient question.
- `tools/verify-interface.mjs`: place the Colonial kit, run 120 steps via the probe, assert `m-col` shows ≥ 1 colony, open the Explorateur with filter "En colonie" and assert rows exist, and take a plate screenshot.
- README section "Multicellularity" describing the model exactly as implemented (thresholds, sharing, roles, fission, movement) and `workbench.md` with the final hash.

## Definition of done

Tasks 0–7 committed (or BLOCKED with evidence), GATES green on the final tree with the recorded hash, README and `workbench.md` updated, French scientific copy, no new dependencies, every RNG draw added to `step` documented.
