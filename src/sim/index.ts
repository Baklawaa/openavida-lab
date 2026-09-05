export { Rng, mixSeed } from "./rng";
export {
  ALPHABET,
  BASES,
  BASAL,
  CODON_INDEX,
  CODON_TABLE,
  MAX_GENOME,
  MIN_GENOME,
  START_CODON,
  STOP_CODONS,
  TRAIT_COLOR,
  TRAIT_NAMES,
  TRAIT_SPEC,
  mappingLegend,
  phenotypeFromRaw,
  squashTrait,
  type Phenotype,
  type TraitName,
} from "./mapping";
export {
  assembleGenome,
  decodeGenome,
  duplicateMutate,
  founderHeterotroph,
  founderMutualist,
  founderPhototroph,
  founderPredator,
  founderResistant,
  geneCassette,
  indelMutate,
  mutate,
  pointMutate,
  randomGenome,
  toGenomeTrack,
  type DecodedGenome,
  type GenomeTrack,
} from "./genome";
export { fitness, metabolicDelta, reproduceThreshold } from "./fitness";
export { FIELD_NAMES, Fields, type FieldName } from "./fields";
export {
  DualWorld,
  applyBottleneck,
  buildShareURL,
  exportJSON,
  exportMetricsCSV,
  exportPhylogenyCSV,
  injectStrain,
  paintTerrain,
  paramsFromQuery,
  paramsToQuery,
  parseCSV,
  parseJSONSnapshot,
  parseShareURL,
  restoreSnapshot,
  takeSnapshot,
  worldFromSnapshot,
} from "./sandbox";
export {
  genotypeShannon,
  lineageShannon,
  parentChildEdges,
  sampleMetrics,
  shannonFromCounts,
} from "./metrics";
export { DEFAULT_PARAMS, World } from "./world";
export { TERRAIN, normalizeParams, type BrushKind, type SimParams, type WorldSnapshot } from "./types";

// PHASE 2 HOOK: 3D continuum / Lenia PDE stepper — swap Fields for a volume.
// PHASE 2 HOOK: mass multiplayer — World is a pure state machine; wrap DualWorld in a room.
// PHASE 2 HOOK: LLM creature brains — attach a policy field on Organism; keep it off the hot path.
