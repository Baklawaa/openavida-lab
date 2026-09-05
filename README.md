# OpenAvida Lab

A browser artificial-evolution laboratory: an explicit, editable genome decodes to a readable phenotype; organisms compete on a spatial plate with nutrient, toxin, temperature, and light fields; lineages, fitness, and Shannon diversity are instrumented live.

## Run

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5174

ES modules will not load from `file://`. Use `npm run dev` or `npm run preview`.

## Production / Vercel

```bash
npm run build
```

`dist/` is the static artifact. `vercel.json` points Vercel at that output.

## What is in phase 1

- Genome: ACGT sequence, ATG…stop ORFs, documented codon → trait table
- Mutations: point, indel, duplication
- Fields: nutrient / toxin / temperature / light with diffusion
- Ecology: competition, predation, mutualism, extinction
- Sandbox: paint, inject, bottleneck, snapshots, deterministic seeds, A/B worlds, shareable URL, JSON/CSV export
- WebGL plate + genome browser + fitness / Shannon / phylogeny panels

## Phase 2 (hooks only)

3D continuum, real molecular biochemistry, mass multiplayer, LLM creature brains.
