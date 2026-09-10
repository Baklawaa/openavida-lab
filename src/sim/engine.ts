/**
 * Engine identity and provenance.
 *
 * MODEL_REVISION is bumped in the same change as anything that alters
 * World.step / decodeGenome / fitness outputs. tests/engine.test.ts pins the
 * canonical perf-world hash against tests/baselines/engine.json, so a silent
 * behaviour change fails the suite instead of invalidating saved results
 * unnoticed (the project previously recorded the hash by hand in workbench.md).
 *
 * Bit-reproducing results from before the research upgrade means checking out
 * the annotated tag `engine-v1`; tests/fixtures/snapshot-v1.json is the
 * migration fixture captured from that revision.
 */

export const ENGINE_VERSION = "2.0.0";
export const MODEL_REVISION = 2;
export const HASH_ALGO = "fnv1a-32";

export interface EngineInfo {
  version: string;
  revision: number;
  hashAlgo: string;
}

export function engineInfo(): EngineInfo {
  return { version: ENGINE_VERSION, revision: MODEL_REVISION, hashAlgo: HASH_ALGO };
}

function fnv1a(text: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable digest of a parameter set, for provenance lines, filenames and reports. */
export function paramsDigest(p: object): string {
  const keys = Object.keys(p).sort();
  const pairs = keys.map((k) => [k, (p as Record<string, unknown>)[k]]);
  return fnv1a(JSON.stringify(pairs));
}
