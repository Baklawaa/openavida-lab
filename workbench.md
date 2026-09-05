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

## Round: less bloom, lasting dynamics, hover help (2026-09-06)

- Hover catalog `src/ui/help.ts` (`CONTROL_HELP`) attached as `title` + visible `#hover-tip`. Launch: pause and inject titles match the catalog; tip visible.
- Bloom: default `maxPopulation` 1800, crowding + scarcer photo, seasons, toxin pulses / drought / crashes after a delay. Dynamics test: 220 default `World.step`s stay **below cap**, Shannon **> 0.5** after tick 80, new lineage or extinction, late fitness not a constant.
- Visuals: organisms draw at ~58% cover so nutrient/toxin/light stay readable; full-plate zoom default (no chase).
- Step ~3.3 ms on 128×128 (`{SCRATCH}/perf.json`).

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

## How to run

```bash
cd openavida-lab
npm install
npm test
npm run dev          # http://127.0.0.1:5174
npm run build && npm run preview
```

Do not open `index.html` via `file://` (ES modules). The page explains how to serve if you do.
