# OpenAvida Lab

A browser artificial-evolution laboratory: an explicit, editable genome decodes to a readable phenotype; organisms compete on a spatial plate with nutrient, toxin, temperature, and light fields; lineages, fitness, and Shannon diversity are instrumented live.

## Run

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5174

## Interface

The French interface keeps playback, field layers, world selection, and the 2D/3D view beside the simulation. The toolbox has four spaces:

- **Organismes**: starter kits, placement, population injection, and the visual DNA editor.
- **Milieu**: brushes, radius, terrain sources, and random disturbances.
- **Analyse**: organism inspection, traits, genome, metabolism, rankings, and the death log.
- **Espèces**: per-group analysis. Strains (founding genome, inherited by all descendants) or strategies (phenotype class). Population per group over time, mean traits, centroid and local environment, drift from the founder, key innovations (mutations whose lineage spread, with the environment they appeared in), deaths by cause. In strain mode, Trajectoires plots each strain's centroid path on a world-aspect map (vents as markers) and mean local temperature over time; each card reports displacement of the centre from the founder. Define named strains from the editor to compare 2–3 genomes in one environment; optionally color the plate (2D and 3D) by strain.
- **Expérience**: local presets, goal-directed multi-replicate runs, restore points, independent A/B steps, reset, data import/export, and experimental features.

## Presets and goal runs

**Préréglages** save the complete active world (fields, terrain, organisms, strains, history) in the browser's IndexedDB. Load one back into the active world, or use it as the start state of a goal run.

**Expérience ciblée** runs n independent replicates from a start state (active world or preset) in Web Workers, each with its own seed, and reports the step at which a goal is first reached. Everything is adjustable: the measured quantity (population, lineages, diversity, mean fitness, share of organisms standing where a field exceeds a threshold, any trait's mean or max, a strain's count or share), the comparison and target, how many consecutive steps it must hold, the number of replicates, the step budget, the base seed, the mutation rate, the population cap and disturbances. Templates cover common questions, for example "put nutrient behind toxin and see how fast they adapt": share of organisms in toxin ≥ 0.3 reaching 50 % for 10 steps. Results show success rate, median and min–max steps, a per-replicate chart against the target, CSV export, and "Ouvrir dans B" to inspect a replicate's final state.

**Balayage** repeats that goal on a linear grid of one variable (mutation rate, population cap, reproduction energy, or a start-snapshot field scale: toxin / nutrient / temperature / light). Seeds continue from one value to the next. The table reports success k/n, median and min–max steps, and extinctions; the chart plots median ticks-to-goal vs the variable with a min–max band. Pure model in `src/sim/goals.ts`.

## Recipes

A **recette** is a tiny replayable setup: `SimParams` plus an op list (paint, place, inject, named strain, step). Consecutive steps collapse to one `{n}`. Recording is on by default for a fresh world (`World.recording`). Export JSON, re-run into world B, or share `?recipe=` (base64url JSON). If that payload exceeds 6000 characters, the copied link falls back to parameters only. Opening a recipe URL applies it to world A at startup (`src/sim/recipe.ts`).

The 2D plate is letterboxed to the world aspect; charts collapse (Réduire) or move beside the plate on wide, short windows. The plate starts empty. Choose a kit and click the world, or add 24 organisms. Space toggles playback; I/O/P select inspect/place/paint; 1–5 select field layers; S saves a restore point. The expand button gives the world more space. In split view, indicators and edits follow the last clicked world. Switching to 3D shows that world individually.

Charts use actual tick positions and a shared fitness scale, including negative values. Organisms remain visible as round markers at small cell sizes, with a ring around the selected organism. “Partager” copies the setup; JSON export preserves the current world.

## DNA editor

The editor in Organismes keeps the ACGT sequence as the single source of truth; everything else is decoded from it live (`src/sim/dnaEdit.ts` is the pure model, `src/ui/dnaEditor.ts` the DOM).

- **Gene cards**: one per ORF read from the sequence. Strength is the codon count; the slider and +/− insert or remove codons of the gene’s dominant trait inside that ORF, so manual base edits elsewhere survive. Reorder or delete genes; append a cassette per trait.
- **Base strip**: every base as a tile, grouped by codon, with colored rails per gene, gene numbers on the start codon and amino-acid letters above coding codons. Click selects a base, double-click a codon, drag or Shift+click a range. Type A/C/G/T to replace, Backspace to delete, ⌘D to duplicate, ⌘Z / ⌘⇧Z to undo and redo, ⌘A to select all.
- **Codon palette**: per trait, each codon with its amino acid and delta; inserts after the selection. Start and stop codons are in the first group.
- **Validation**: unclosed ORFs (ignored by the decoder) are drawn dashed and flagged; short or full genomes are flagged.
- **Phenotype**: decoded live, with a delta column and a reference tick against the last loaded genome (kit, copied organism, founder). Revenir restores that reference.
- **Raw sequence and mutations** stay available in the collapsed advanced section and are synchronized both ways.

Inspecting an organism loads its genome into the editor; placing an organism or clicking one with the Place tool does not overwrite your edits. Analyse offers “Modifier cet ADN” for the selected organism.

To verify the interface with the local server running and Chrome installed:

```bash
node tools/verify-interface.mjs
```

This checks placement, DNA editing, painting, 2D/3D, A/B, snapshots, Espèces (define / inject / rename), presets, a 2-replicate goal run, keyboard navigation, and five viewport sizes. Pass the app URL as the first argument (default `http://127.0.0.1:5174/`). Screenshots are written to `scratch/interface/`.

ES modules will not load from `file://`. Use `npm run dev` or `npm run preview`.

## Simulation in a worker

`?worker=1` runs the visible simulation in a Web Worker. The app talks to a `SimHost` (`src/sim/simHost.ts`): the inline host steps the worlds on the main thread (default); the worker host (`src/ui/workerHost.ts`) keeps a mirror on the main thread that every panel reads, applies each mutation to the mirror immediately, forwards it to `src/sim/simWorker.ts`, and overwrites the mirror with the frames the worker streams back (field buffers are transferred). All mutations share one implementation, `applySimOp`, so inline, worker and mirror agree by construction. To check that:

```bash
node tools/verify-worker.mjs
node tools/verify-interface.mjs 'http://127.0.0.1:5174/?worker=1'
```

The first runs the same setup and 48 steps in both hosts and requires identical world hashes.

## Production / Vercel

```bash
npm run build
```

`dist/` is the static artifact. `vercel.json` points Vercel at that output.

## Phase 1

- Genome: ACGT sequence, ATG…stop ORFs, documented codon → trait table
- Mutations: point, indel, duplication
- Fields: nutrient / toxin / temperature / light with diffusion
- Ecology: competition, predation, mutualism, extinction
- Sandbox: paint, inject, bottleneck, snapshots, deterministic seeds, A/B worlds, shareable URL, JSON/CSV export
- WebGL plate + genome browser + fitness / Shannon / phylogeny panels

## Phase 2 (all flags default off)

A bare URL is still the phase-1 2D lab. Enable in the sandbox or via query:

| Flag | Query | What it does |
| --- | --- | --- |
| 3D view | `?view3d=1` | Continuum camera of the **same** world (height = nutrient+light) |
| Multiplayer | `?mp=1` | BroadcastChannel room; host authority; spectator / experimenter |
| Brains | `?brains=1` | Baseline perception→action traces (does not change brains-off runs) |
| LLM brains | `?llm=1` | Optional cost-capped adapter; falls back to baseline |

Inspect always shows named molecules, enzymes, and pathway fluxes derived from the genome and fields (not decorative). See `workbench.md`.
