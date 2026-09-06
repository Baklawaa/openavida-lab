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
- **Analyse**: organism inspection, traits, genome, metabolism, rankings, the death log, and an event log (lineage dominance/collapse, first predation, innovation sweep, strain extinction, population crash/boom) that opens the explorer and the nearest timeline snapshot.
- **Espèces**: per-group analysis. Strains (founding genome, inherited by all descendants) or strategies (phenotype class). Population per group over time, mean traits, centroid and local environment, drift from the founder, key innovations (mutations whose lineage spread, with the environment they appeared in), deaths by cause. In strain mode, Trajectoires plots each strain's centroid path on a world-aspect map (vents as markers) and mean local temperature over time; each card reports displacement of the centre from the founder. Define named strains from the editor to compare 2–3 genomes in one environment; optionally color the plate (2D and 3D) by strain.
- **Expérience**: local presets, goal-directed multi-replicate runs, restore points, independent A/B steps, reset, data import/export, and experimental features.

## Presets and goal runs

**Préréglages** save the complete active world (fields, terrain, organisms, strains, history) in the browser's IndexedDB. Load one back into the active world, or use it as the start state of a goal run.

**Expérience ciblée** runs n independent replicates from a start state (active world or preset) in Web Workers, each with its own seed, and reports the step at which a goal is first reached. Everything is adjustable: the measured quantity (population, lineages, diversity, mean fitness, share of organisms standing where a field exceeds a threshold, any trait's mean or max, a strain's count or share), the comparison and target, how many consecutive steps it must hold, the number of replicates, the step budget, the base seed, the mutation rate, the population cap and disturbances. Templates cover common questions, for example "put nutrient behind toxin and see how fast they adapt": share of organisms in toxin ≥ 0.3 reaching 50 % for 10 steps. Results show success rate, median and min–max steps, a per-replicate chart against the target, CSV export, and "Ouvrir dans B" to inspect a replicate's final state.

**Balayage** repeats that goal on a linear grid of one variable (mutation rate, population cap, reproduction energy, or a start-snapshot field scale: toxin / nutrient / temperature / light). Seeds continue from one value to the next. The table reports success k/n, median and min–max steps, and extinctions; the chart plots median ticks-to-goal vs the variable with a min–max band. Pure model in `src/sim/goals.ts`.

Runs are built for scale: up to 1000 replicates (200 per value in a sweep) on all cores but one, the start state cloned once per worker, and each replicate stopping as soon as the goal holds, the world is empty, or the goal has become impossible (a "≥" goal on a strain with no living member). The panel coalesces updates to five per second, lists the first 100 replicates (all of them go to the CSV, with an `unreachable` column), and plots an even sample of 100 curves; the summary adds P25–P75. Measured: 1000 replicates × 300 steps in 18 s on 9 workers with the interface holding 60 fps; 2000 replicates list in a single table that sorts in about 20 ms.

Every replicate appears in a sortable table (successes fastest or slowest first, failures earliest or latest first, final value, final population, launch order). Any replicate can be **replayed**: its row, its seed chip under the summary, or a seed typed into the "Rejouer dans B" field rebuilds the run's start state with that seed and the run's parameters in world B and starts playing it, reproducing the replicate step for step; clicking again restarts it. "fin" opens a replicate's final state instead (kept for the first eight). The last run (start state, parameters, every result) is saved in the browser and restored after a reload, so a seed from an exported CSV can still be replayed later; only the final-state snapshots are dropped.

## Recipes

A **recette** is a tiny replayable setup: `SimParams` plus an op list (paint, place, inject, named strain, step). Consecutive steps collapse to one `{n}`. Recording is on by default for a fresh world (`World.recording`). Export JSON, re-run into world B, or share `?recipe=` (base64url JSON). If that payload exceeds 6000 characters, the copied link falls back to parameters only. Opening a recipe URL applies it to world A at startup (`src/sim/recipe.ts`).

**Timeline.** The playback bar records a snapshot every 25 steps (150 Mo budget, oldest after the origin dropped first). The scrubber previews a recorded tick on the plate, charts, Espèces and Explorateur without writing the live world; « Reprendre ici » restores that snapshot and forgets later recordings.

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

## Explorer: every organism, every lineage

**Explorateur** (Analyse → Ouvrir l’explorateur, or click a lineage in the tree chart) is a full-size dialog over the active world.

- **Organismes**: every organism, living and dead (the death log keeps the last 3000–4000 deaths with age, kills, offspring), grouped by strain, strategy or lineage. Filters: state, strain, strategy, lineage, cause of death, age range, kills ≥, offspring ≥, fitness ≥, any trait ≥ value, genome substring, free text. Sort presets: died fastest/slowest, longest-lived, best/worst fitness, most kills, most offspring, most body mass, newest/oldest, highest value of each trait. "Records du monde" lists the extreme organism of each preset. A row opens the organism's record: stats, phenotype, genome, and its **evolutionary branch**: the chain of lineages from the founder with the phenotype-changing mutation that opened each one, the three biggest changes highlighted, and the environment each mutant was born in. Actions: show in the world, highlight its lineage on the plate (rings), load its DNA into the editor, save it.
- **Lignées**: the lineage table (born, extinct, living, peak, living descendants), each with its origin chain, sub-lineages and members. The tree chart in the workspace is clickable and shows lineage details on hover.
- **Arbre**: the same ancestry, drawn. Time runs left to right; every lineage is a bar from its birth to its extinction (or to the current step), and a daughter lineage hangs off its mother at the exact step it was born, so a branch point is a birth. The trunk from the founder to the focus lineage is drawn bright, amber dots mark the mutations that changed the phenotype (the biggest change is written next to the birth), node size follows the lineage's peak count and colour follows its strain, and extinct lineages are faded. Drag to pan, wheel to zoom, hover for a lineage summary, click to open it in the side pane, double-click to re-centre the tree on it; "Ajuster" refits the whole tree. Controls: show the sibling lineages along the trunk, keep all / only recently extinct / no extinct lineages, and a descendant budget (150 / 400 / 1500 lineages drawn, the least populated branches dropped past it). Opened from any organism or lineage record with **Voir dans l’arbre**.
- **Enregistrés**: organisms saved in the browser with their branch and, optionally, the entire world they lived in (map, fields, seed). Reload the DNA, export as JSON, or open the saved world in B to watch it again.
- **Per replicate**: in Expérience, every result row has a catalogue button that rebuilds the replicate deterministically to its last step and opens the explorer on it; the same is available for a typed seed.

Per-organism counters `kills` and `births` are simulation state (saved in snapshots).

## Predators: feeding, growth, hunting

Predation is a real trophic link (`src/sim/body.ts`, `src/sim/ecology.ts`):

- **Feeding.** A kill transfers the prey's stored energy (`× (0.35 + 0.4 × aggression)`) plus its body (`0.45 × effective size`), so a meal is worth roughly 25–30 steps of maintenance.
- **Growth.** Each organism carries a body condition `mass` (0–1), not a gene. Every kill adds about 0.3; it decays by 0.004 per step. Effective size = genome size × (1 + 0.6 × mass): it raises the energy cap, slightly raises maintenance (× (1 + 0.2 × mass)), strengthens hunting (aggression + 0.15 × mass), and drives the rendered size in 2D and 3D. The inspect panel shows Corpulence and effective size.
- **Hunting.** Predators (aggression ≥ `predationThreshold`) sense edible prey within 6 cells and steer toward it; moving onto prey eats it, and prey walking into a predator is eaten. Eligibility uses genome aggression only (a gap of ≥ 0.1), so a well-fed predator does not eat identical kin; mass only improves the odds of an uncertain attack.
- **Breeding.** A predator reproduces only once its mass reaches 0.25, so booms follow real feeding.

Predator–prey dynamics remain boom-and-bust on a uniform plate: predators deplete local prey, then starve. The tuning constants live in `src/sim/body.ts`.

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
