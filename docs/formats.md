# Persisted formats and compatibility

Every shape OpenAvida Lab writes down — a world file, a run manifest, a share
link, a browser record, an exported table — is either versioned or explicitly
additive, and exactly one rule decides what happens when this build meets a
payload it did not write: the payload is migrated, refused, or ignored. Which
of the three applies is the contract this page records, so that changing a
version constant, a reader or a field comes with the right behaviour on all
sides. Each claim below is pinned to the file and constant that implements it;
when those move, this page moves with them.

## Summary

| Shape | Version | Writer | Reader | Older payload | Newer payload |
| --- | --- | --- | --- | --- | --- |
| World snapshot (JSON) | `SNAPSHOT_VERSION = 3` (`src/sim/types.ts`) | `World.snapshot()` (`src/sim/world.ts`) | `migrateSnapshot` (`src/sim/migrate.ts`) | v1 → v2 → v3, phenotypes recomputed from the genomes | refused |
| OAV2 binary container | `SNAPSHOT_BIN_VERSION = 1`, magic `0x4f415632` (`src/sim/snapshotBin.ts`) | `encodeSnapshot` | `decodeSnapshot`, via `parseWorldBytes` (`src/sim/serialize.ts`) | accepted; missing planes are zero-filled | refused |
| Run manifest | `MANIFEST_VERSION = 1` (`src/sim/manifest.ts`) | `makeManifest`, `manifestFromWorld` | `validateManifest` | accepted, normalized, engine re-stamped | refused (error list) |
| Recipe in `?recipe=` | `RECIPE_VERSION = 1` (`src/sim/recipe.ts`) | `recipeFromWorld`, `recipeToQuery` | `parseRecipe`, `recipeFromQuery` | ignored | ignored |
| Browser stores | IndexedDB `openavida-lab` version 3 (`src/ui/presetStore.ts`) | `PresetStore` | `PresetStore` | upgrade adds stores in place; a stored snapshot of any version is migrated by `World.restore` | unknown fields ignored |
| Engine identity | `2.3.0` / revision `5` / `f0d4b39e` (`src/sim/engine.ts`) | `engineInfo()` | provenance fields, `tests/baselines/engine.json` | lineage below; no migration between revisions | not applicable |
| Research exports | no version field (CSV, JSONL) | `src/sim/serialize.ts`, `tools/openavida.ts` | `parseCSV`, `tools/openavida_reader.py` | additive changes only, comment lines skipped | additive readers must skip unknown columns/keys |

The one thing that is **not** backwards compatible is the engine revision
itself: no migration makes a result recorded under revision 1 reproduce under
revision 5. Everything else has an upgrade path, an explicit refusal or a
documented ignore.

## 1. World snapshot (JSON)

The full state of one world: parameters, RNG state, tick, the field planes,
terrain, organisms with their decoded phenotypes, lineages, extinctions,
history and the optional analysis collections (death log, strains, innovations,
events, schedule).

- **Version.** `SNAPSHOT_VERSION = 3` in `src/sim/types.ts`, stamped on every
  `WorldSnapshot` as the literal `version` field.
- **Writer.** `World.snapshot()` (`src/sim/world.ts`) writes the current
  version plus provenance (`engine`, `paramsDigest`), copies the field grids
  out of their typed arrays, and drops the per-organism `trail` (a display
  cache, not state). The UI writes it as `openavida-t<tick>.json`
  (`src/ui/lab/exports.ts`).
- **Reader.** `migrateSnapshot` (`src/sim/migrate.ts`) is the reader for JSON
  payloads: `parseJSONSnapshot` for an imported file
  (`src/sim/serialize.ts`), `worldFromSnapshot` for goal runs, timeline
  previews and worker worlds (`src/sim/world.ts`), and `validateManifest` for a
  manifest's start state (`src/sim/manifest.ts`). `parseWorldBytes`
  (`src/sim/serialize.ts`) routes a file to this reader or to the OAV2 decoder
  by sniffing the first four bytes, and tolerates a leading BOM on the text
  form.
- **Older payload.** A payload with `version < 2` is treated as v1 and upgraded
  by `v1ToV2`: parameters are normalized against the current spec (unknown keys
  dropped, keys added since take their documented defaults), every organism's
  and strain founder's phenotype is recomputed from its genome through
  `decodeGenome(genome).phenotype` — so traits introduced after v1 (the mutator
  trait) and the regulatory layer are applied faithfully rather than trusted
  from the stale blob — a missing `exudate` plane is filled with zeros,
  `nextStrainId` defaults to 1, and missing `engine`/`paramsDigest` are filled
  from the current build. `tests/fixtures/snapshot-v1.json` is the fixture
  captured from the annotated tag `engine-v1`; `tests/migrate.test.ts` replays
  it and asserts the migrated world is deterministic.
- **Newer payload.** `version > SNAPSHOT_VERSION` throws
  `snapshot version N is newer than this engine (v2)`; a missing or
  non-numeric version throws `invalid OpenAvida snapshot: missing or
  non-numeric version`. The import control catches the throw and shows its
  failure status (`app.import.failed`), so a payload is never half-loaded.
- **Fields added later.** `World.restore` (`src/sim/world.ts`) defaults the
  collections that did not exist when older payloads were written — `strains`,
  `innovations`, `deaths`, `events`, their `next*` counters, `eventFlags` and
  `schedule` — and `Fields.fromArrays` zero-fills an absent `exudate` plane. So
  a version-2 snapshot from before a collection existed still restores; it just
  restores with that collection empty.
- **Caveat.** A payload is rewritten only when its schema version is older.
  v2 payloads predate the longevity trait, so their phenotypes are recomputed
  from the genomes (v2 → v3) and the world plays on — but that is a conversion,
  not a replay: phenotypes are current-model, and a world saved under engine
  2.0.0 does not reproduce the same trajectory when continued. Bit-reproducing
  an old run means running the old engine (see section 6), not restoring its
  snapshot. Before v3 existed, a v2 payload restored verbatim left
  `ph.longevity` undefined and the next reap deleted every organism, which is
  what `tests/migrate.test.ts` now pins.

## 2. OAV2 binary container

The compact form of the same snapshot, used by the `.oav` export
(`openavida-t<tick>.oav`).

- **Version and magic.** `SNAPSHOT_BIN_MAGIC = 0x4f415632` and
  `SNAPSHOT_BIN_VERSION = 1` in `src/sim/snapshotBin.ts`. The layout is quoted
  at the top of that file:

  ```text
  magic u32 | version u32 | headerLength u32 | header JSON (UTF-8, zero-padded to 4 bytes) | 6 x Float32Array(cells) | Uint8Array(cells)
  ```

  The six planes are, in order, `nutrient`, `toxin`, `temperature`, `light`,
  `exudate`, `solar`; terrain follows.
- **Writer / reader.** `encodeSnapshot` and `decodeSnapshot`
  (`src/sim/snapshotBin.ts`); `parseWorldBytes` (`src/sim/serialize.ts`)
  dispatches on the magic and falls back to JSON text. Field grids are already
  `Float32Array`-backed in the world, so the round trip is exact and the file is
  roughly four times smaller than the JSON form.
- **Older payload.** The container version is deliberately not bumped when the
  JSON snapshot schema grows: the header carries the snapshot's own `version`,
  and the decoder reads the six planes positionally. The encoder writes a zero
  plane for any field the snapshot it is given does not carry
  (`arrays[name] ?? new Array(cells).fill(0)`), which is how a payload without
  the exudate plane still round-trips; `tests/snapshotBin.test.ts` ("fills
  exudate for legacy payloads that lack it") deletes the plane, re-encodes and
  asserts zeros and an unchanged world hash. A container with version 0 or 1 is
  therefore accepted.
- **Newer payload.** A container version above 1 throws
  `binary snapshot version N is newer than this engine (1)`; a wrong magic
  throws `not an OpenAvida binary snapshot`; a truncated header or plane
  throws from `JSON.parse`/`DataView`. `parseWorldBytes` lets all of them
  propagate rather than silently re-reading the bytes as text, and the import
  control reports the failure.
- **Caveat.** The container carries a schema version and `parseWorldBytes`
  migrates whatever it decodes, so an .oav from an older engine is converted
  like a JSON file. `decodeSnapshot` itself is a pure reader and does not
  migrate; `World.restore` migrates too, which is the choke point every caller
  shares.

## 3. Run manifest

One self-contained description of an experiment: engine identity, parameters
and their digest, the start state (parameters, a snapshot or a recipe), the
programme, the goals and the replicate plan.

- **Version.** `MANIFEST_VERSION = 1` in `src/sim/manifest.ts`, written as
  `manifestVersion`.
- **Writer / reader.** `makeManifest` and `manifestFromWorld` write it; the
  Expérience panel exports `openavida-manifest.json`
  (`src/ui/lab/exports.ts`) and the headless runner consumes a manifest,
  re-stamps it with the engine that ran it and writes `manifest.json` into the
  run directory (`tools/openavida.ts`). `validateManifest`
  (`src/sim/manifest.ts`) is the reader for files; it returns
  `{ manifest: null, errors }` rather than throwing.
- **Older payload.** A manifest is a plan, not a record: on load its parameters
  are normalized with `normalizeParams`, and `engine` and `paramsDigest` are
  overwritten with `engineInfo()` and `paramsDigest(params)` from the current
  build. A manifest written by an older engine is therefore accepted and
  re-stamped; the run directory's copy names the engine that will actually run
  it. A `start.kind === "snapshot"` start state is passed through
  `migrateSnapshot`, so a v1 start state is upgraded like any other snapshot.
- **Newer payload.** `manifestVersion !== 1` fails validation with
  `manifestVersion must be 1 (got ...)`; missing `name`, no valid goal,
  out-of-range `run.replicates` (1–100000) or `run.maxTicks` (1–1000000), a
  malformed `start.recipe` or a malformed `schedule` entry each add an error.
  Any error means the manifest is not returned, so a future payload is refused
  whole and never partially executed.

## 4. Recipe in `?recipe=`

A tiny replayable setup shared through the URL: `SimParams` plus a short op
list (paint, place, inject, named strain, step), encoded as base64url JSON in
the `recipe` query parameter. The UI applies it to world A at startup.

- **Version and cap.** `RECIPE_VERSION = 1` and `RECIPE_QUERY_MAX = 6000` in
  `src/sim/recipe.ts`. `buildRecipeShareURL` falls back to a parameters-only
  link when the payload exceeds the cap and reports `truncated: true`.
- **Writer / reader.** `recipeFromWorld`, `recipeToQuery` and `applyRecipe`
  write and replay; `parseRecipe` and `recipeFromQuery` read.
- **Older / newer payload.** There is no version 0 and no planned version 2:
  `parseRecipe` returns `null` unless `version === 1`, `params` is an object
  and `ops` is an array, and `recipeFromQuery` additionally swallows any
  base64 or JSON error into `null`. A payload from any other version is
  therefore **ignored**, not refused — a bad or stale share link must never stop
  the app from starting. Inside an accepted v1 payload the reader is forgiving
  in two more ways: parameters are normalized against the current spec, and
  individual ops or schedule entries that fail `isRecipeOp`/`isScheduledOp`
  are dropped rather than failing the recipe. Treat that as a reader
  convenience, not a licence to change the meaning of an existing op type.

## 5. Browser stores (presets, organisms, experiments)

`PresetStore` (`src/ui/presetStore.ts`) keeps local state in IndexedDB, with
an in-memory fallback for private windows where IndexedDB is unavailable.

- **Version.** Database `openavida-lab`, `DB_VERSION = 3`, object stores
  `presets`, `organisms` and `experiments`, all keyed by `id`.
- **Upgrade.** `onupgradeneeded` creates only the stores the database does not
  already contain and never deletes or rewrites one, so a browser that first
  saw the database at version 1 keeps its presets when version 2 adds
  `organisms` and version 3 adds `experiments`. Records are not touched at
  upgrade time.
- **Record shapes.** `PresetRecord` is metadata plus a whole `WorldSnapshot`
  stored as a structured clone (no JSON round trip); `SavedOrganism`
  optionally carries a snapshot and always carries the ancestry chain;
  `LastRunRecord` carries the start snapshot and every trial result;
  `ExperimentRecord` is what the run journal lists. The envelopes have no
  version field of their own — the versioned payload inside is the snapshot,
  governed by `SNAPSHOT_VERSION` and `migrateSnapshot` — and reads are casts,
  not validation, so unknown extra fields on a record are ignored by an older
  build.
- **Older / newer payload.** A preset is written from the live world's
  `snapshot()`, so the snapshot inside is current-version by construction, and
  a preset written by an older engine is migrated on load because every restore
  goes through `World.restore`; `World.restore` is also defensive about an
  absent exudate plane and optional collections, so a foreign or hand-edited
  snapshot is safe there as well as in the file import path (where
  `parseJSONSnapshot` migrates) rather than injected into a store. A record
  written by a newer build with an unknown field is read structurally and the
  unknown field ignored. Without IndexedDB the same API serves the session
  from memory, so nothing survives a reload but nothing crashes either.

## 6. Engine identity and the revision lineage

The identity in `src/sim/engine.ts` — `ENGINE_VERSION`, `MODEL_REVISION`,
`HASH_ALGO = "fnv1a-32"` — is stamped into every snapshot and manifest, and
pinned by the canonical perf world (128 x 128, 260 founders, seed
`0xa7f31ab`, 48 steps) whose hash lives in `tests/baselines/engine.json`.

| Engine | Revision | Perf hash | Evidence |
| --- | --- | --- | --- |
| 1.0.0 | 1 | `c2c03a81` | annotated tag `engine-v1`; fixture `tests/fixtures/snapshot-v1.json` |
| 2.0.0 | 2 | `9df52ec5` | model correctness stage (`docs/model.md` §11) |
| 2.1.0 | 3 | `185d6460` | evolvability stage |
| 2.2.0 | 4 | `e953dcdc` | nutrient recycling round |
| 2.3.0 | 5 | `f0d4b39e` | current; longevity, the climate floor, the mass-action harvest, priced aggression; `tests/engine.test.ts` fails on a silent behaviour change |

`engine` and `paramsDigest` inside a snapshot are provenance, not
compatibility keys: `migrateSnapshot` never reads them, and the migration
decision is made on the snapshot schema version alone. That is deliberate — a
payload is data, and data can be upgraded — but it means the revision is where
compatibility stops. A `finalHash` in a run directory, a pinned perf hash, or
a replay of an old recipe reproduces only under the engine revision that
produced it. To bit-reproduce a revision-1 result, check out the annotated tag
`engine-v1`; for the intermediate revisions, run the engine version named in
the manifest. There is no migration from one revision to another.

## 7. Research exports

The tables and streams an analysis consumes. None of them carries a version
field; their contract is additive and comment-aware.

- **Metrics CSV.** `exportMetricsCSV` (`src/sim/serialize.ts`) writes the
  header and the rows; when it is given provenance, the first line is a
  comment and readers skip it:

  ```text
  # openavida engine=<version> revision=<revision> algo=<hashAlgo> params=<digest> seed=<seed> tick=<tick>
  tick,population,meanFitness,maxFitness,shannon,shannonGenotype,lineageCount,extinctTotal,fixationFraction,fixationLineageId,hill1,hill2,richness,evenness,meanOffspringPerAdult
  ```

  The runner writes it as `metrics.csv` for the reference replicate
  (`tools/openavida.ts`); the UI writes `openavida-metrics-t<tick>.csv`
  (`src/ui/lab/exports.ts`).
- **Phylogeny CSV.** `exportPhylogenyCSV` writes the header
  `id,parentId,bornTick,extinctTick,count,peakCount,hue,signature`, with the
  same provenance comment first, always (the UI's
  `openavida-phylo-t<tick>.csv`).
- **Events JSONL.** `exportEventsJSONL` writes the provenance comment first
  when provenance is passed, then one `ResearchEvent` JSON object per line
  (`src/sim/types.ts`); the log is bounded (`RESEARCH_LOG_MAX = 20000`, keep
  `RESEARCH_LOG_KEEP = 10000`). The runner writes `events.jsonl` when the
  manifest sets `run.recordEvents`; the UI writes
  `openavida-events-t<tick>.jsonl`.
- **Reading rules.** `parseCSV` (`src/sim/serialize.ts`) drops blank lines and
  lines starting with `#`, and `tools/openavida_reader.py` does the same for
  the CSV and both JSONL streams. That is the whole version story: a new column
  at the end of a CSV, a new field on an event, or a new event `kind` is
  backwards compatible because readers go by header name and JSON key; renaming
  or removing an existing name, or changing a column's meaning, is not, and
  would need a new file or a version field. `results.jsonl` is the same deal
  for `TrialResult` records.

## Changing a persisted shape

1. Bump the shape's version constant in the file named above.
2. Teach the reader: migrate (snapshot), validate and reject (manifest), or
   ignore (recipe) — pick the behaviour from the summary table and keep it.
3. Add or extend a fixture and a test under `tests/` so the old payload is
   exercised, not just described.
4. Update this page in the same change.
