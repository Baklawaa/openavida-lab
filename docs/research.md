# Running experiments headlessly

The browser is for exploring; a run that produces a result should be a
manifest, a command and a directory of files.

The model those runs execute — its equations, constants, parameters and
calibration record — is documented in [model.md](model.md).

## 1. Describe the run

Any experiment in the **Expérience** panel — start state, goals, parameters —
is a `Manifest` (`src/sim/manifest.ts`): engine identity, parameter digest,
start state (parameters, a world snapshot or a recipe), programme, goals and
the replicate plan. `validateManifest` normalizes and checks one before it is
run, and refuses a payload it cannot understand.

Write one by hand:

```json
{
  "manifestVersion": 1,
  "name": "toxin adaptation",
  "engine": { "version": "2.1.0", "revision": 3, "hashAlgo": "fnv1a-32" },
  "params": { "width": 64, "height": 64, "seed": 7, "startPopulation": 40 },
  "paramsDigest": "…",
  "start": { "kind": "params" },
  "goals": [{ "metric": { "kind": "population" }, "op": ">=", "target": 120, "sustain": 10 }],
  "run": { "replicates": 40, "seed": 100, "maxTicks": 400, "sampleEvery": 10, "recordEvents": true }
}
```

## 2. Run it

```bash
npm run sim -- run experiment.json --out runs/toxin --jobs 4
npm run sim -- run experiment.json --out runs/toxin --jobs 4 --resume   # after an interruption
```

`npm run sim` bundles `tools/openavida.ts` into `dist-cli/openavida.mjs` with
esbuild and runs it on plain Node. Without the bundle, `npx vite-node
tools/openavida.ts run …` works too. Replicates are independent, so `--jobs`
never changes a result; each shard appends one JSON line per replicate, which
is what makes `--resume` a matter of counting the lines already written.
Resume requires the original `--jobs`: shard files are per-layout, and the
runner refuses to mix layouts rather than silently merging them.

Flags are folded into the manifest before it is validated, so the effective
manifest — overrides included — is what lands in the run directory:

| Flag | Effect |
| --- | --- |
| `--replicates N` | overrides `run.replicates` |
| `--seed N` | overrides `run.seed`; replicate i uses N+i |
| `--max-ticks N` | overrides `run.maxTicks` |
| `--sample-every N` | overrides `run.sampleEvery` |
| `--events` / `--no-events` | sets `run.recordEvents` true / false |
| `--name "<text>"` | replaces the manifest `name` |
| `--out <dir>` | run directory (default: the manifest's directory/run) |
| `--jobs N` | shard processes (default 1) |
| `--resume` | keeps the replicates already written |
| `--progress-every N` | one progress line every N completed replicates (0: none) |
| `--quiet` | errors only |
| `--index i --count n` | shard mode: which block of replicates this process runs |

A resume also refuses when the run-defining fields recorded in `env.json`
(replicates, seed, max ticks, sample cadence, event recording) differ from the
current ones, so a changed plan is never merged into stored shards.

## 3. What lands in the run directory

| File | Contents |
| --- | --- |
| `manifest.json` | the manifest with the engine identity refreshed |
| `results.jsonl` | one `TrialResult` per replicate, in order, with `finalHash` |
| `summary.json` | success rate with a Wilson interval, median ticks with a bootstrap interval, extinctions, unreachable |
| `metrics.csv` | per-tick history of the reference replicate (provenance line first) |
| `events.jsonl` | research events of the reference replicate (when `run.recordEvents`) |
| `env.json` | node, platform, cores, job count, run signature, timestamp |
| `shard-*.jsonl` | the raw incremental shard output |

## 4. Read it

```bash
python3 tools/openavida_reader.py runs/toxin
```

```python
import sys
sys.path.insert(0, "tools")
from openavida_reader import load_run

run = load_run("runs/toxin")
run["summary"]["medianTicks"]
run["results"][0]["finalHash"]
[e["kind"] for e in run["events"][:10]]
run["metrics"][-1]["shannon"]
```

The reader is standard-library only, so it drops into any analysis environment
without installing the project.

## 5. Reproduce

Every result line carries `finalHash`. To check that a stored run still
reproduces under the current engine:

```bash
node tools/verify-reproduce.mjs runs/toxin
```

Results recorded under an older engine reproduce from the annotated tag
`engine-v1` (pre-upgrade) or by running the engine version named in the
manifest; `tests/baselines/engine.json` pins the canonical behaviour hash for
the current revision.
