/**
 * Snapshot schema migration.
 *
 * v1 → v2 (research upgrade). The payload gains engine provenance, params are
 * normalized against the current spec (unknown keys dropped, new keys take
 * their documented defaults), and phenotypes are recomputed from the genomes
 * so traits introduced after v1 (the mutator trait) and the regulatory layer
 * are applied faithfully. Optional legacy fields keep their documented
 * defaults; nothing is silently carried as an unknown key.
 *
 * tests/migrate.test.ts replays tests/fixtures/snapshot-v1.json, captured from
 * the engine-v1 tag, and asserts the migrated world is deterministic.
 */
import { engineInfo, paramsDigest } from "./engine";
import { decodeGenome } from "./genome";
import type { Phenotype } from "./mapping";
import { normalizeParams } from "./params";
import { SNAPSHOT_VERSION, type Organism, type SimParams, type WorldSnapshot } from "./types";

type Raw = Record<string, unknown>;

export function snapshotVersion(raw: unknown): number {
  if (!raw || typeof raw !== "object") return -1;
  const v = (raw as Raw).version;
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function phenotypeFor(genome: unknown, fallback: unknown): Phenotype | undefined {
  if (typeof genome === "string" && genome.length > 0) return decodeGenome(genome).phenotype;
  return fallback as Phenotype | undefined;
}

function v1ToV2(s: Raw): Raw {
  const params = normalizeParams((s.params ?? {}) as Partial<SimParams>);
  const organisms = asArray(s.organisms).map((entry) => {
    const org = entry as Raw;
    return {
      mass: 0,
      kills: 0,
      births: 0,
      strainId: 0,
      ...org,
      ph: phenotypeFor(org.genome, org.ph),
    } satisfies Raw;
  }) as unknown as Organism[];
  const strains = asArray(s.strains).map((entry) => {
    const strain = entry as Raw;
    return { ...strain, founderPhenotype: phenotypeFor(strain.genome, strain.founderPhenotype) };
  });
  return {
    ...s,
    version: 2,
    params,
    organisms,
    strains,
    nextStrainId: s.nextStrainId ?? 1,
    engine: s.engine ?? engineInfo(),
    paramsDigest: s.paramsDigest ?? paramsDigest(params),
  };
}

/** Current-version payloads pass through untouched; older ones are upgraded step by step. */
export function migrateSnapshot(raw: unknown): WorldSnapshot {
  const version = snapshotVersion(raw);
  if (version < 0) throw new Error("invalid OpenAvida snapshot: missing or non-numeric version");
  if (version > SNAPSHOT_VERSION) {
    throw new Error(`snapshot version ${version} is newer than this engine (v${SNAPSHOT_VERSION})`);
  }
  let snap = raw as Raw;
  if (version < 2) snap = v1ToV2(snap);
  return snap as unknown as WorldSnapshot;
}
