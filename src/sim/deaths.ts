import type { Phenotype } from "./mapping";
import type { DeathCause, DeathRecord, EnvSample, Organism } from "./types";

export type { DeathCause, DeathRecord };

export const CAUSE_LABEL: Record<DeathCause, string> = {
  starvation: "starved (not enough food or light)",
  toxin: "killed by toxin",
  crowding: "died from crowding",
  "old-age": "died of old age",
  predation: "eaten by a predator",
  competition: "pushed out by a fitter neighbor",
  crash: "random die-off event",
  wipe: "wiped by the brush",
  bottleneck: "removed in a bottleneck",
  washout: "washed out of the chemostat",
};

export const CAUSE_SHORT: Record<DeathCause, string> = {
  starvation: "starved",
  toxin: "toxin",
  crowding: "crowding",
  "old-age": "old age",
  predation: "eaten",
  competition: "outcompeted",
  crash: "crash",
  wipe: "wiped",
  bottleneck: "bottleneck",
  washout: "washout",
};

export const CAUSE_COLOR: Record<DeathCause, string> = {
  starvation: "#f0d35a",
  toxin: "#c87bff",
  crowding: "#8aa0b5",
  "old-age": "#6ea8ff",
  predation: "#ff4d6d",
  competition: "#ff7a45",
  crash: "#ff6b8a",
  wipe: "#7d92a3",
  bottleneck: "#b08cff",
  washout: "#57c7ff",
};

export function dnaSnippet(seq: string, n = 28): string {
  if (seq.length <= n) return seq;
  return `${seq.slice(0, n)}…${seq.length}`;
}

export function tallyDeaths(deaths: readonly DeathRecord[]): Partial<Record<DeathCause, number>> {
  const out: Partial<Record<DeathCause, number>> = {};
  for (const d of deaths) out[d.cause] = (out[d.cause] ?? 0) + 1;
  return out;
}

export function classifyEnergyDeath(ph: Phenotype, env: EnvSample): DeathCause {
  const tox = env.toxin * (1 - ph.resist) * 0.3;
  const harvest = ph.uptake * env.nutrient * 0.21 + ph.photo * env.light * 0.14;
  if (env.toxin > 0.12 && tox >= harvest) return "toxin";
  return "starvation";
}

export function deathFromOrganism(o: Organism, tick: number, cause: DeathCause): DeathRecord {
  return {
    tick,
    orgId: o.id,
    lineageId: o.lineageId,
    genome: o.genome,
    fitness: o.fitness,
    cause,
    x: o.x,
    y: o.y,
    strainId: o.strainId,
    age: o.age,
    kills: o.kills,
    births: o.births,
    parentId: o.parentId,
    mass: o.mass,
  };
}

export function strongestLiving(organisms: Organism[], n = 8): Organism[] {
  return organisms
    .filter((o) => o.energy > 0)
    .slice()
    .sort((a, b) => b.fitness - a.fitness || b.energy - a.energy)
    .slice(0, n);
}
