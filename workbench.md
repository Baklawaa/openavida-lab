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

**Life Engine / Emergent Garden.** They win on *multicellular body plans* (mouth/producer/killer cells as morphology). We are not cloning that ISA (non-goal). We win on Avida-class genome→phenotype (named genes, codon table, numeric fitness, phylogeny CSV) which Life Engine does not expose as a sequence.

**Particle Life / Lenia.** They win on continuous motion / PDE smoothness and trail persistence. Our plate is a discrete 128×128 occupancy grid. Fields are Lenia-adjacent (diffusing RGBA glow). Organisms are guild-colored points (photo gold, predator rose, uptake teal).

**Biggest remaining visual gap:** no motion trails / continuum body — discrete cells in a bloom look more like Life Engine than Particle Life. Closable later with a persistence FBO (not required to gate).

**Biggest remaining scientific gap vs full Avida:** no Logic-9 NAND/EQU virtual CPU (explicitly out of scope). Mapping is scalar traits, not tasks.

## How to run

```bash
cd openavida-lab
npm install
npm test
npm run dev          # http://127.0.0.1:5174
npm run build && npm run preview
```

Do not open `index.html` via `file://` (ES modules). The page explains how to serve if you do.
