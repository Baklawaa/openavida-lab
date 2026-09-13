# Documentation

The written record of the project is split by what you are trying to do: read
the model, run an experiment, change something persisted, or check why a
decision was made. The evidence log sits at the repository root because it is
written while work happens; everything else is here.

- [model.md](model.md) — the model reference, for anyone who needs to know what
  the simulation actually computes: the tick order, field transport, genome to
  phenotype, the energy budget, ecology, the parameter and constant tables, the
  revision log and the calibration record. Its identity, parameter, constant,
  memory-bound, revision and calibration blocks are generated from the code by
  `tools/modeldoc.ts` and re-checked by `npm test`, so they cannot drift from
  the implementation; the prose explains the choices to a reader who wants to
  reason about a result rather than call the API.
- [research.md](research.md) — the headless workflow, for producing a result
  outside the browser: how a `Manifest` describes a run, the `npm run sim`
  runner and its flags, what lands in a run directory, the standard-library
  Python reader, how to reproduce a stored result, and the two world-file forms
  the interface reads and writes. Written for someone who wants a result they
  can publish rather than a world they can watch.
- [formats.md](formats.md) — the compatibility matrix for everything persisted,
  on disk or in the browser: the world snapshot, the OAV2 binary container, the
  run manifest, the `?recipe=` payload, the IndexedDB stores, the engine
  identity lineage and the research exports. Each row gives the current version,
  the reader and writer, and what an older or newer payload does. Required
  reading before changing a version constant or a reader.
- [../workbench.md](../workbench.md) — the evidence log, for reviewers and for
  anyone asking "why does this constant have this value?". One entry per upgrade
  stage or working round: what changed, the decision behind it, the measurements
  and the gate results. It is chronological, so it is an archaeology tool rather
  than an introduction; the model reference is its distilled form.
- [archive/](archive/) — the phase-1/2 build transcripts, kept for provenance
  and not maintained as documentation. See [archive/README.md](archive/README.md)
  for what they are and why they are not linked from user-facing pages.
