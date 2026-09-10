#!/usr/bin/env python3
"""Read an OpenAvida run directory using only the standard library.

    python3 tools/openavida_reader.py <runDir>

`load_run` returns a dict with the manifest, summary, env, per-replicate
results, per-tick metrics and the research event stream. Comment lines (the
provenance header of the CSV and JSONL files) are skipped.
"""
import csv
import json
import os
import sys


def _json_lines(path):
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                yield json.loads(line)


def load_run(path):
    run = {"dir": path}
    for name, key in (("manifest.json", "manifest"), ("summary.json", "summary"), ("env.json", "env")):
        full = os.path.join(path, name)
        if os.path.exists(full):
            with open(full) as fh:
                run[key] = json.load(fh)
    results = os.path.join(path, "results.jsonl")
    run["results"] = list(_json_lines(results)) if os.path.exists(results) else []
    events = os.path.join(path, "events.jsonl")
    run["events"] = list(_json_lines(events)) if os.path.exists(events) else []
    metrics = os.path.join(path, "metrics.csv")
    if os.path.exists(metrics):
        with open(metrics) as fh:
            rows = [line for line in fh if not line.startswith("#")]
        run["metrics"] = list(csv.DictReader(rows))
    else:
        run["metrics"] = []
    return run


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    run = load_run(argv[0])
    manifest = run.get("manifest", {})
    summary = run.get("summary", {})
    engine = manifest.get("engine") or {}
    print("run        ", run["dir"])
    print("name       ", manifest.get("name", "?"))
    print("engine     ", engine.get("version", "?"), "revision", engine.get("revision", "?"))
    print("goals      ", len(manifest.get("goals", [])))
    print("replicates ", len(run["results"]), "successes", summary.get("successes"))
    print("median     ", summary.get("medianTicks"), "ticks")
    print("metrics    ", len(run["metrics"]), "rows")
    print("events     ", len(run["events"]), "rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
