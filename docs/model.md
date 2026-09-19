# OpenAvida Lab — model reference

What the simulation computes, why its defaults have the values they have, and
how to reproduce a published result. The parameter table, the constant table,
the memory bounds, the engine identity, the revision log, the calibration
record and the list of known limits are **generated from the code** by
`tools/modeldoc.ts`; everything else is prose. `npm test` re-renders the generated blocks and fails when the
document is stale, and `npm run docs` rewrites it.

A run is fully described by its engine identity, its parameter set and its seed
(`src/sim/engine.ts`, `src/sim/params.ts`). The analysis layer built on top of
it — statistics, selection estimates, the headless runner and the research
panel — is documented in [research.md](research.md) and in `workbench.md`.

## 1. Engine identity and provenance

<!-- generated:identity -->
- Engine version **2.3.0**, model revision **5**, state hash `fnv1a-32`.
- The canonical perf world is a 128 x 128 plate with 260 founders and seed 0xa7f31ab; the pinned hash after 48 steps lives in `tests/baselines/engine.json`.
- Results published under an earlier revision reproduce from the annotated tag `engine-v1` (pre-upgrade) or from the engine version named in the manifest. `tests/fixtures/snapshot-v1.json` is the migration fixture captured from that revision.
- `npm run baseline` regenerates the pinned hash deliberately; `npm test` fails if the behaviour hash changes without it.
<!-- /generated:identity -->

`hashState()` mixes the tick, the RNG state, the fields, the terrain, the
organisms and the lineage table with FNV-1a. Snapshots carry the engine that
wrote them and a digest of their parameters, and a payload from a newer engine
is refused rather than misread.

## 2. One tick, in order

`World.step()` is a fixed sequence; every number below is applied in that
order, and the order is part of the model.

1. **Time.** `tick` increments; the light field is advanced by
   `Fields.advance`: diffusion (nutrient, toxin, temperature, exudate, and
   light only when `lightDiffusion` > 0), then vents, decay and solar recharge
   scaled by the seasonal factor `0.56 + 0.44·sin(0.085·tick)`.
2. **Self-shading.** An organism with two or more occupied neighbours dims its
   own cell: ×0.7 (2–3 neighbours), ×0.4 (4), ×0.18 (5 or more). Isolated cells
   keep the sky.
3. **Dilution.** With `dilutionRate` > 0 the medium relaxes towards
   `inflowNutrient` and each organism is washed out with probability
   `dilutionRate` (death cause `washout`).
4. **Disturbances.** With disturbances enabled, three independent per-tick
   hazards: a toxin blob, a nutrient drought (×0.78 plate-wide) and, above 280
   organisms, a crash that kills each organism with probability 0.07.
5. **Schedule.** Every programme row whose `at` equals the tick is applied
   (`src/sim/schedule.ts`): scale a field, write a parameter, or paint at the
   plate centre.
6. **Per organism.** Age +1, body mass decays, metabolism (harvest, costs,
   exudate transfer), death classification when energy reaches 0, crowding
   penalty (0.012 per occupied neighbour), senescence hazard, fitness refresh.
7. **Predation.** One pass over the 8-neighbourhood; a predator may take at most
   `maxMealsPerTick` prey per tick, and only while it is below its division
   threshold (hunger, not hoarding).
8. **Energy ceiling.** Energy is clamped to `3.2 + 1.2 × effective size`.
9. **Movement.** Each organism attempts a move with probability `motility`;
   chemotaxis with probability 0.72, otherwise a random direction. Moving onto
   prey hunts it; walking into a predator is fatal; otherwise the fitter
   organism displaces the occupant (death cause `competition`).
10. **Reproduction.** One pass over the pre-movement population (see
    [§5](#5-energy-budget-and-reproduction)).
11. **Reaping.** Organisms with no energy, or past their own lifespan
    ceiling (`round(maxAge × longevity)`), become death
    records with a cause; extinct lineages are stamped and their peak count
    kept.
12. **Bookkeeping.** Trails, occupancy heat (200-step decay), the metrics
    sample, and the derived world events (lineage dominance and collapse, first
    predation, innovation sweep, strain extinction, population crash and boom).

## 3. Fields and transport

Five fields live on the plate — nutrient, toxin, temperature, light, exudate —
plus a static `solar` map that feeds the light field. All are `Float32Array`
planes of one value per cell.

- **Diffusion** is a 4-neighbour Jacobi step, `x + rate·(avg − x)`. Barrier
  cells keep 0.92 of their own value and are excluded from their neighbours'
  average, so material does not flow through walls.
- **Rates.** `diffusionRate` drives nutrient, toxin and temperature;
  `exudateDiffusion` drives exudate; `lightDiffusion` drives light, so light can
  stay where the sun and the shade put it.
- **Vents and decay**, applied every tick:
  `nutrient ← clamp(nutrient·(1 − nutrientDecay) + nutrientInflow, 0, 4)`,
  `toxin ← clamp(toxin·(1 − toxinDecay), 0, 4)`,
  `temperature ← clamp(ambient + (temperature − ambient)·(1 − temperatureDecay), 0, 1.5)`
  — a relaxation towards `AMBIENT_TEMPERATURE` (0.5), not a decay to zero: a
  one-way decay made the thermal term a countdown, and the whole plate starved
  on a cost that grew without bound,
  `exudate ← clamp(exudate·(1 − exudateDecay), 0, 4)`,
  `light ← clamp(light·(1 − lightDecay) + solar·0.08·shade·season, 0, 2)`.
- **Terrain** is a byte per cell: empty, barrier, nutrient vent (+0.08/tick),
  toxin vent (+0.07/tick), thermal vent (+0.05/tick), shade (×0.35 on the
  solar recharge of that cell).
- **Initial plate.** `randomTerrain: false` seeds a gradient: solar and light
  `0.35 + 0.55·(1 − y/(h−1))`, temperature `AMBIENT_TEMPERATURE`, nutrient at
  its own equilibrium (`nutrientInflow / nutrientDecay`, 1.0 by default) so a
  dropped organism grazes a full cell instead of waiting for the plate to fill,
  toxin 0. With
  `randomTerrain: true` the world also places 6–10 nutrient vents, 3–5 toxin
  vents, 2–4 thermal vents, 4–9 walls and 2–4 shade patches.

## 4. Genome to phenotype

A genome is an ACGT string of `MIN_GENOME`–`MAX_GENOME` bases
(`src/sim/genome.ts`, `src/sim/mapping.ts`).

- **ORFs** start at every `ATG` and run to the first `TAA`/`TAG`/`TGA` in the
  same frame; the start codon is not translated and an unclosed ORF is ignored
  (the scan stops at it). ORFs are found in every frame, so overlapping reads
  are possible.
- **Codon table.** Each sense codon carries one primary trait and a delta; some
  codons carry secondary contributions (`extras`). Every proline codon and TGG
  also raise `mutator`, and the four threonine codons (ACT/ACC/ACA/ACG) plus
  the two cysteines (TGT/TGC) also raise `longevity`: two traits beyond the ten
  the table was built around, both carried by secondary contributions so the
  primary trait of every codon is unchanged.
- **Expression.** A gene's contribution is the sum of its codons' deltas,
  multiplied by the cis-regulation factor described below. The phenotype is
  `squash(BASAL + Σ contributions)` per trait, where `squash` is a clamp, a
  `tanh` into [0, 1], or a rounding to the 0–7 receptor channel.
- **Cis-regulation.** The `REG_WINDOW` codons immediately upstream of a gene's
  ATG, read backwards in triplets and bounded by the previous ORF's stop,
  amplify that gene: `1 + REG_SELF·(same-trait codons) + REG_CROSS·(codons of
  the most frequent other trait)`, capped at `REG_MAX`. Gene order and
  intergenic sequence are therefore heritable, selectable wiring;
  `regulationEnabled: false` restores the purely additive decoder exactly.
- **Base traits** (`BASAL`) are what a genome with no ORFs expresses: uptake
  0.18, photo 0.02, resist 0.05, tpref 0.5, motility 0.16, aggression 0.02,
  signal 0, hue 0.55, fecundity 0.55, size 0.9, mutator 1, longevity 1.
- `hue` is display-only: it never enters fitness, which is what makes the
  neutral substitution log a real neutral marker.

## 5. Energy budget and reproduction

Two ledgers are computed from the same phenotype and environment. `fitness` is
the comparable score used by competition, ranking and the charts; `metabolicDelta`
is the energy the world actually integrates. Both are in `src/sim/fitness.ts`,
with the coefficients in `src/sim/chemistry.ts`.

| Term | Comparable fitness | Energy ledger |
| --- | --- | --- |
| Nutrient harvest | `uptake · nutrient` | `uptake · nutrient · UPTAKE_GAIN` |
| Photosynthesis | `photo · light` | `photo · light · PHOTO_GAIN` |
| Exudate uptake | `uptake · exudate · EXUDATE_FITNESS` | `uptake · exudate · EXUDATE_YIELD` |
| Toxin damage | `toxin · (1 − resist) · 1.15` | `toxin · (1 − resist) · 0.3` |
| Thermal mismatch | `|temperature − tpref| · 0.85` | `|temperature − tpref| · 0.12` |
| Maintenance | `0.04 + 0.05 · size · bodyScale + genomeUpkeep` | `0.04 + 0.028 · size · bodyScale + genomeUpkeep` |
| Longevity upkeep | `LONGEVITY_UPKEEP · max(0, longevity − 1)` | same term |
| Aggression upkeep | `AGGRESSION_UPKEEP · aggression` | same term |
| Predation | neighbour effect `Σ gap · 0.35` | through meals |

**Harvest law.** The nutrient term is mass-action: an organism on a cell holding
`n` earns `uptake · n · UPTAKE_GAIN` and removes
`min(n, uptake · NUTRIENT_UPTAKE_CAP)` from the field, so the cap rations how
fast a cell can be stripped, not what the food is worth. The break-even
concentration is therefore `(maintenance + thermal) / (uptake · UPTAKE_GAIN)`,
about 0.63 for a stock heterotroph, and income is linear in the uptake trait.
Reconstructing the harvest from the cap instead made income quadratic in uptake
— a knife-edge at `uptake ≈ 0.67` where every genome below it starved in every
environment — and let one constant set the plate's whole energy budget.

**Aggression is priced.** Free aggression has no counterweight: the trait sweeps
to fixation, every organism becomes a predator and the plate eats itself
extinct. `AGGRESSION_UPKEEP` is charged per unit of aggression in both ledgers,
which is what keeps a predator guild alive *and* bounded.

**Lifespan.** `longevity` scales the age ceiling: the organism dies at
`max(1, round(maxAge × longevity))` ticks, squashed into [0.5, 2], and both the
senescence hazard and the reap cutoff read that personal ceiling. A carrier is
therefore old later than its neighbours, not immortal. The upkeep row above is
the price — 0.012 energy per tick for every point above the basal 1, which at
the 2.0 cap is about a sixth of a stock heterotroph's maintenance — so selection
trades life against the energy budget instead of walking the trait to its limit.

Nutrient is the only field that is consumed: a cell takes
`min(field, uptake · NUTRIENT_UPTAKE_CAP)` and pays for exactly what it takes.
`genomeUpkeep` is charged per base per tick, so sequence length has a running
cost, not only a replication cost.

**Reproduction.** An organism divides when its energy reaches
`max(0.4, reproduceEnergy / (0.65 + 0.5·fecundity))`, subject to a logistic
density gate `1/(1 + (N/K)⁴)` with `K = maxPopulation`, a hard
`maxPopulation` ceiling, and — for predators (`aggression ≥ predationThreshold`)
— a body condition of at least 0.25, so booms follow real feeding. A parent with
four or more occupied neighbours does not divide. Division charges
`replicationCost × genome bases` first; the daughter receives 42 % of the
parent's remaining energy and the parent keeps half. The daughter is placed in a
random free neighbour cell, or the birth is skipped.

**Death.** Nine causes are recorded: `starvation` (energy exhausted),
`toxin` (classified when toxin damage exceeds the harvest that tick), `crowding`,
`old-age` (the senescence hazard or the organism's own lifespan ceiling), `predation`,
`competition` (displaced by a fitter mover), `crash`, `wipe` (brush) and
`washout` (chemostat). The senescence hazard is
`1 − exp(−senescenceRate·(age/lifespan)²)` per tick, so most deaths happen well
before the ceiling; `senescenceRate: 0` restores the hard cutoff alone.

## 6. Ecology

- **Predation.** An organism is a predator when `aggression ≥
  predationThreshold`. A kill also needs an aggression gap of at least
  `kinThreshold` (0 allows cannibalism of identical phenotypes). The attack is
  certain at a gap of 0.5, otherwise it succeeds with probability equal to the
  gap. A meal transfers the prey's stored energy scaled by
  `TROPHIC_SHARE_BASE + TROPHIC_SHARE_AGGRESSION·aggression`
  (0.30 + 0.30·aggression) plus `MEAL_BODY_BONUS × effective size` of body
  (0.10), and the predator's own condition rises by
  `MASS_PER_KILL + 0.1·aggression`. The transfer used to be 0.35 + 0.40 with a
  0.45 body bonus, which made every kill worth fifteen to forty ticks of a
  predator's maintenance whatever the prey held: aggression was free money,
  ratcheted to fixation and the plate ate itself (see §13).
- **Meal budget.** A predator takes at most `maxMealsPerTick` prey per tick
  across both the interaction and the movement phase; at its budget it is
  blocked by prey rather than fed. This is what makes trophic transfer a rate
  limit instead of a density effect.
- **Hunting follows need.** A predator only attacks while its energy is below
  its own division threshold, so a fed predator is blocked by prey instead of
  hoarding meals. With `params.aggressionUpkeep` and the trophic share above,
  that is what stops the trophic web from becoming an aggression runaway: the
  trait is charged every tick, a kill is worth a share of what the prey stored
  rather than a fixed jackpot, and a predator that has eaten waits.
- **Body condition.** `mass` (0–1) is somatic, not genetic: effective size is
  `size·(1 + 0.6·mass)`, which raises the energy ceiling, raises maintenance by
  `1 + 0.2·mass`, strengthens hunting by `+0.15·mass` and drives the drawn size.
  It decays by 0.004 per tick, so a full body fades in about 250 ticks.
- **Cross-feeding (exudate).** A phototroph whose gross photosynthesis exceeds
  its maintenance leaks `exudateLeak` of that surplus into the exudate field —
  never more than the cell's remaining headroom below `EXUDATE_MAX`, so a field
  clamp can never destroy energy. Any organism with a receptor
  (`signal ≥ 1`) takes up what its cell holds, up to
  `0.5·uptake·(signal/7)` per tick, and gains `EXUDATE_YIELD` of it; the rest
  dissipates. The producer pays exactly what the field gains, and a
  signal-positive, low-photo mutant is a genuine free-rider.
- **Competition.** Movement onto an occupied cell is resolved by comparable
  fitness: the fitter organism kills the occupant and takes the cell; ties keep
  the occupant.
- **Chemotaxis.** Direction is chosen by
  `uptake·nutrient + photo·light − toxin·(1 − resist) − 0.5·|temperature − tpref|`,
  with a pull towards the nearest sensed prey and a penalty for occupied cells.

## 7. Inheritance

- **Mutation.** A birth mutates with probability `mutationRate` (default 0.12)
  multiplied by the parent's `mutator` trait (0.25–4, from secondary codon
  contributions). The operator is drawn with weights `pointWeight`,
  `indelWeight`, `duplicationWeight`: a single-base substitution, an insertion
  or deletion of 1–3 bases, or a tandem duplication of a 3–24 base fragment.
  Indels respect `MIN_GENOME`/`MAX_GENOME` and fall back to a point mutation.
- **Recombination.** With probability `recombinationRate` (default 0), a birth
  draws a donor from the living organisms within `recombinationRadius` cells and
  performs a single-point crossover with independent cut points on both parents.
  Sex and horizontal transfer share this operator; the innovation records the
  donor. A child shorter than `MIN_GENOME` falls back to a parent copy.
- **Innovations.** Every birth that produces a genome different from its
  parent's records an innovation with the true mutation kind from the operator
  (never inferred from a length difference), the parent, the donor (for
  recombination) and the phenotype delta. Innovations whose lineage has no
  living descendant are pruned (bounded at 400 by default).

## 8. Measurement

`recordMetrics` runs once per tick and is derived — it draws no RNG, which is
why the analysis layer never changes the behaviour hash. One sample carries
population, mean and max fitness, Shannon diversity of phenotypes and genotypes,
lineage count, extinctions, fixation, per-strain and per-strategy counts, up to
`LINEAGE_TOP_N` living lineages, Hill numbers, evenness, mean offspring per
adult that died, and — when `recordTraitDistribution` is on — mean, sd and
quantiles for every trait — exported as the long-format `traits.csv` /
`openavida-traits-t<tick>.csv`, one row per sample and trait, because the wide
`metrics.csv` carries no trait column at all. `World.neutralLog` records neutral substitutions for
the molecular clock — a birth whose phenotype is unchanged in every trait except
the display-only hue, which covers synonymous codon swaps, substitutions outside
ORFs and pure hue moves — and `World.eventLog` (off by default) records every
birth,
death, meal, exudation, recombination and neutral substitution as bounded
research events.

### Memory bounds

<!-- generated:memory -->
What caps each structure that grows with the run, read from the constants themselves. A raised cap shows up here instead of leaving a hand-written list stale.

| Structure | Holds | Bound | Enforced in |
| --- | --- | --- | --- |
| `World.history` | one `MetricsSample` per tick (population, diversity, trait distribution, lineage top list) | 4000 samples, trimmed to 3000 | `src/sim/world.ts` `recordMetrics`; the worker mirror re-applies the same bound in `src/sim/simHost.ts` |
| `World.deaths` | death records with cause, age, genome and parent, for the death log and the explorer | 4000 records, trimmed to 3000 | `src/sim/world.ts` `reap` |
| `World.eventLog` | research events (birth, death, meal, exudation, recombination, neutral) when `recordEvents` is on | 20000 events, trimmed to 10000 | `src/sim/world.ts` `pushEvent` |
| `World.neutralLog` | hue-only substitutions kept for the molecular clock | 2000 substitutions | `src/sim/world.ts` `birth` |
| `Timeline` ring | encoded OAV2 snapshots taken every 25 ticks | 150 MB; the oldest entry after the origin is evicted first | `src/sim/timeline.ts` `Timeline.evict` |
| `ExperimentRecord.results` | stored `TrialResult` replicates per journal record (the summary keeps the full statistics) | 200 replicates | `src/ui/experimentHistory.ts` `recordFromRun` |
| `ExperimentRecord.curves` | evenly sampled replicate curves per journal record, for the overlay chart | 100 curves | `src/ui/experimentHistory.ts` `sampleCurves` |
<!-- /generated:memory -->

## 9. Parameters

<!-- generated:params -->
43 parameters. `PARAM_SPEC` in `src/sim/params.ts` is the single source: the interface form, the URL query keys (`QUERY_KEYS`), `normalizeParams` bounds and this table are all generated from it.

| Key | Group | Type | Default | Bounds | Step | Unit | Meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `width` | world | number | 128 | 8-256 | 1 | cells | Plate width in cells. |
| `height` | world | number | 128 | 8-256 | 1 | cells | Plate height in cells. |
| `seed` | world | number | 0xa7f31ab (176107947) | 1-4294967295 | 1 | - | Master seed of the mulberry32 stream. All simulation randomness derives from it. |
| `startPopulation` | world | number | 0 | 0-100000 | 1 | organisms | Founders placed at construction (kits first, then random genomes). Capped by maxPopulation. |
| `maxPopulation` | world | number | 1100 | 16-1000000 | 1 | organisms | Hard ceiling on living organisms; a soft density-dependent fecundity gate applies below it. |
| `randomTerrain` | world | flag | false | 0-1 | 1 | - | Seed vents, walls and shade at construction. |
| `disturbances` | world | flag | false | 0-1 | 1 | - | Enable stochastic toxin pulses, droughts and crashes during the run. |
| `diffusionRate` | metabolism | number | 0.22 | 0-1 | 0.01 | perTick | Jacobi diffusion coefficient for nutrient, toxin and temperature (0 = no mixing). |
| `nutrientInflow` | metabolism | number | 0.004 (1/250) | 0-0.2 | 0.001 | perTick | Uniform nutrient regeneration per tick (detritus recycling). Sets the equilibrium of a ventless plate: inflow / nutrientDecay. |
| `nutrientDecay` | metabolism | number | 0.004 (1/250) | 0-1 | 0.001 | perTick | Fractional loss of the nutrient field per tick. |
| `nutrientUptakeCap` | metabolism | number | 0.16 | 0.01-2 | 0.01 | concentration | Nutrient a cell can be stripped of per tick, per unit of uptake. It rations the graze — a smaller cap makes a cell last longer — while the energy gained is uptake x nutrient x UPTAKE_GAIN either way. |
| `toxinDecay` | metabolism | number | 0.006 | 0-1 | 0.001 | perTick | Fractional loss of the toxin field per tick. |
| `temperatureDecay` | metabolism | number | 0.002 (1/500) | 0-1 | 0.001 | perTick | Relaxation of the temperature field towards the ambient (0.5) per tick. |
| `ambientTemperature` | metabolism | number | 0.5 (1/2) | 0-1.5 | 0.01 | relative | Temperature the field relaxes towards, and where the initial plate starts. A ventless plate without it would decay to zero, and the thermal cost is \|temperature - tpref\| x 0.12 per tick. |
| `lightDecay` | metabolism | number | 0.03 | 0-1 | 0.001 | perTick | Fractional loss of the light field per tick before solar recharge. |
| `reproduceEnergy` | metabolism | number | 1.55 | 0.05-100 | 0.05 | energy | Base energy a cell must hold to divide; scaled by the fecundity trait. |
| `maxAge` | metabolism | number | 260 | 1-100000 | 1 | steps | Base age ceiling; each organism's own is round(maxAge x longevity). With senescenceRate > 0 most deaths happen well before it. |
| `predationThreshold` | metabolism | number | 0.26 | 0-1 | 0.01 | aggression | Minimum aggression for an organism to be a predator at all. |
| `maxMealsPerTick` | metabolism | number | 1 | 1-8 | 1 | prey | Maximum prey a predator can eat in one tick across all phases; density-independent attack limit. |
| `kinThreshold` | ecology | number | 0.1 (1/10) | 0-1 | 0.01 | aggression | Minimum aggression gap required for a kill. 0 allows cannibalism of identical phenotypes. |
| `mutationRate` | evolution | number | 0.12 | 0-1 | 0.01 | perBirth | Probability that a birth draws a mutation; scaled per organism by the mutator trait. |
| `pointWeight` | evolution | number | 0.7 | 0-10 | 0.05 | relative | Relative weight of single-base substitutions among mutations. |
| `indelWeight` | evolution | number | 0.2 (1/5) | 0-10 | 0.05 | relative | Relative weight of insertions and deletions (1 to 3 bases) among mutations. |
| `duplicationWeight` | evolution | number | 0.1 (1/10) | 0-10 | 0.05 | relative | Relative weight of tandem duplications among mutations. |
| `recombinationRate` | evolution | number | 0 | 0-1 | 0.01 | perBirth | Probability that a birth takes a single-point crossover with a nearby neighbour (sex and horizontal transfer share this operator). |
| `recombinationRadius` | evolution | number | 3 | 0-32 | 1 | cells | Chebyshev radius within which a recombination partner is drawn. |
| `regulationEnabled` | evolution | flag | true | 0-1 | 1 | - | Amplify a gene by the codons upstream of its ATG (cis-regulatory layer). Off restores the purely additive decoder. |
| `lightDiffusion` | metabolism | number | 0 | 0-1 | 0.01 | perTick | Diffusion of the light field. 0 keeps light where the solar recharge and shade put it. |
| `senescenceRate` | metabolism | number | 0.02 (1/50) | 0-1 | 0.005 | risk | Scale of the age-dependent mortality hazard (1 - exp(-rate (age/lifespan)^2), lifespan being the organism's own ceiling). 0 = hard cutoff only. |
| `exudateLeak` | chemistry | number | 0.15 | 0-1 | 0.01 | fraction | Share of the photosynthetic surplus a phototroph leaks into the exudate field. |
| `exudateDecay` | chemistry | number | 0.03 | 0-1 | 0.001 | perTick | Fractional loss of the exudate field per tick. |
| `exudateDiffusion` | chemistry | number | 0.5 (1/2) | 0-1 | 0.01 | perTick | Diffusion of the exudate field; how far a leak travels from its producer. |
| `genomeUpkeep` | evolution | number | 0.00002 (1/50000) | 0-0.01 | 0.00001 | energyPerBasePerTick | Maintenance cost per genome base per tick, so longer genomes are not free. |
| `replicationCost` | evolution | number | 0.001 (1/1000) | 0-0.05 | 0.0001 | energyPerBase | Energy charged per genome base at division, on top of the daughter's share. |
| `longevityUpkeep` | evolution | number | 0.012 | 0-0.5 | 0.001 | energy | Energy per tick charged for each unit of longevity above the basal 1, so a longer life is paid for. 0 makes lifespan free and the trait walks to its cap. |
| `aggressionUpkeep` | evolution | number | 0.3 | 0-2 | 0.01 | energy | Energy per tick charged per unit of aggression: the hunting apparatus. 0 makes aggression free, and a free trait sweeps to fixation and eats the plate extinct. |
| `toxinPulseRate` | world | number | 0.015625 (1/64) | 0-1 | 0.0005 | perTick | Per-tick hazard of a random toxin pulse when disturbances are enabled (default 1/64). |
| `droughtRate` | world | number | 0.011363636363636364 (1/88) | 0-1 | 0.0005 | perTick | Per-tick hazard of a nutrient drought when disturbances are enabled (default 1/88). |
| `crashRate` | world | number | 0.008333333333333333 (1/120) | 0-1 | 0.0005 | perTick | Per-tick hazard of a population crash when disturbances are enabled (default 1/120). |
| `recordTraitDistribution` | world | flag | true | 0-1 | 1 | - | Store mean, sd and quantiles of every trait on each history sample (analysis without re-simulation). |
| `recordEvents` | world | flag | false | 0-1 | 1 | - | Record every birth, death, meal, exudation, recombination and neutral substitution for research export (bounded ring). |
| `dilutionRate` | world | number | 0 | 0-1 | 0.001 | perTick | Chemostat washout: fraction of organisms removed per tick and nutrient relaxed towards inflowNutrient. 0 = closed batch world. |
| `inflowNutrient` | world | number | 1 | 0-4 | 0.01 | concentration | Nutrient concentration the inflow restores when dilutionRate > 0. 1 is the ventless batch equilibrium, so a chemostat starts habitable. |
<!-- /generated:params -->

Every parameter is normalized before use: unknown keys are dropped, values are
clamped into the bounds above, `seed` is coerced to a non-zero unsigned 32-bit
integer, and `startPopulation` is capped by `maxPopulation`. The same table
drives the Milieu → Modèle form, the `QUERY_KEYS` the share links use, and the
parameters a manifest carries.

## 10. Model constants

<!-- generated:constants -->
Values the model hard-codes rather than exposing as parameters. Each row is read from the module that defines it, so changing a constant without regenerating this document fails the test suite.

| Area | Constant | Value | Defined in | Meaning |
| --- | --- | --- | --- | --- |
| Metabolism | `UPTAKE_GAIN` | `0.21` | `src/sim/chemistry.ts` | Energy gained per unit of nutrient × uptake. |
| Metabolism | `PHOTO_GAIN` | `0.14` | `src/sim/chemistry.ts` | Energy gained per unit of light × photo. |
| Exudate | `EXUDATE_YIELD` | `0.8` | `src/sim/chemistry.ts` | Energy a consumer gains per unit of exudate taken up; the rest dissipates. |
| Exudate | `EXUDATE_UPTAKE_PER_UPTAKE` | `0.5` | `src/sim/chemistry.ts` | Per-tick uptake capacity per unit of uptake, scaled by signal / 7. |
| Exudate | `EXUDATE_FITNESS` | `1` | `src/sim/chemistry.ts` | Weight of exudate in the comparable fitness score. |
| Exudate | `EXUDATE_MAX` | `4` | `src/sim/chemistry.ts` | Cell ceiling shared by the field clamp and the leak headroom. |
| Body | `MASS_PER_KILL` | `0.22` | `src/sim/body.ts` | Body condition gained per kill. |
| Body | `MASS_KILL_AGGRESSION` | `0.1` | `src/sim/body.ts` | Extra condition per kill, scaled by aggression. |
| Body | `MASS_DECAY` | `0.004` | `src/sim/body.ts` | Condition lost per tick when not feeding (full mass fades in ~250 ticks). |
| Body | `MASS_SIZE_GAIN` | `0.6` | `src/sim/body.ts` | Effective size = ph.size × (1 + gain × mass). |
| Body | `MASS_HUNT_BONUS` | `0.15` | `src/sim/body.ts` | Hunting power = aggression + bonus × mass. |
| Body | `MASS_MAINTENANCE` | `0.2` | `src/sim/body.ts` | Maintenance multiplier 1 + value × mass (weaker than the size gain, so growing pays). |
| Body | `MASS_TO_BREED` | `0.25` | `src/sim/body.ts` | Predators reproduce only once this fed: breeding follows real feeding. |
| Body | `MEAL_BODY_BONUS` | `0.1` | `src/sim/body.ts` | Extra energy from the prey's body, per unit of effective size. Small: at 0.45 a kill always paid and aggression ran away. |
| Body | `TROPHIC_SHARE_BASE / TROPHIC_SHARE_AGGRESSION` | `0.3 / 0.3` | `src/sim/body.ts` | Share of the prey's stored energy a kill transfers, at aggression 0 and per unit of aggression. This is the trophic efficiency that keeps predation a strategy instead of a runaway. |
| Body | `PREY_ATTRACTION` | `0.3` | `src/sim/body.ts` | Chemotaxis pull toward the nearest edible prey. |
| Body | `PREY_SENSE_RADIUS` | `6` | `src/sim/body.ts` | How far a predator senses prey, in cells. |
| Body | `KIN_THRESHOLD` | `0.1` | `src/sim/body.ts` | Fallback minimum aggression gap for a kill; params.kinThreshold overrides it. |
| Genome | `ALPHABET` | `ACGT` | `src/sim/mapping.ts` | The four bases; every sequence is over this alphabet. |
| Genome | `CODON_LEN` | `3` | `src/sim/mapping.ts` | Bases per codon. |
| Genome | `START_CODON` | `ATG` | `src/sim/mapping.ts` | Opens an ORF. |
| Genome | `STOP_CODONS` | `TAA, TAG, TGA` | `src/sim/mapping.ts` | Close an ORF. |
| Genome | `MIN_GENOME` | `9` | `src/sim/mapping.ts` | Shortest accepted sequence. |
| Genome | `MAX_GENOME` | `384` | `src/sim/mapping.ts` | Longest accepted sequence. |
| Regulation | `REG_WINDOW` | `21` | `src/sim/mapping.ts` | Upstream codons read backwards from the ATG, in triplets. |
| Regulation | `REG_SELF` | `0.35` | `src/sim/mapping.ts` | Amplification per upstream codon of the same trait. |
| Regulation | `REG_CROSS` | `0.2` | `src/sim/mapping.ts` | Amplification per upstream codon of the most frequent other trait. |
| Regulation | `REG_MAX` | `3` | `src/sim/mapping.ts` | Cap on the regulatory multiplier. |
| Logs and bounds | `LINEAGE_TOP_N` | `5` | `src/sim/types.ts` | Living lineages stored per history row, for the lineage-level selection readout. |
| Logs and bounds | `HISTORY_MAX / KEEP` | `4000 / 3000` | `src/sim/world.ts` | Metrics samples are trimmed to KEEP once they pass MAX, so the history stays bounded on long runs. |
| Logs and bounds | `DEATH_LOG_MAX / KEEP` | `4000 / 3000` | `src/sim/types.ts` | Death records are trimmed to KEEP once they pass MAX. |
| Logs and bounds | `RESEARCH_LOG_MAX / KEEP` | `20000 / 10000` | `src/sim/types.ts` | Per-organism research events, same trimming rule. |
| Logs and bounds | `NEUTRAL_LOG_MAX` | `2000` | `src/sim/world.ts` | Hue-only substitutions kept for the molecular clock. |
| Logs and bounds | `EVENT_LOG_MAX / WINDOW` | `500 / 20` | `src/sim/events.ts` | Derived world events kept, and the lookback window in ticks. |
| Logs and bounds | `HEAT_STEPS / TRAIL_LENGTH` | `200 / 120` | `src/sim/heat.ts` | Occupancy-heat decay constant and the organism trail length. |
| Logs and bounds | `DEFAULT_TIMELINE_EVERY` | `25` | `src/sim/timeline.ts` | Ticks between recorded snapshots. |
| Logs and bounds | `DEFAULT_TIMELINE_BUDGET` | `150 MB` | `src/sim/timeline.ts` | Snapshot ring budget; the oldest entry after the origin is evicted first. |
| Hazards | `TOXIN_PULSE_EVERY / DROUGHT_EVERY / CRASH_EVERY` | `64 / 88 / 120` | `src/sim/climate.ts` | Legacy periods behind the parameterised per-tick hazards; a crash needs more than 280 organisms. |
| Formats | `SNAPSHOT_VERSION` | `3` | `src/sim/types.ts` | Snapshot schema; v1 payloads are migrated by src/sim/migrate.ts. |
| Formats | `MANIFEST_VERSION` | `1` | `src/sim/manifest.ts` | Run-manifest schema used by the headless runner. |
| Formats | `RECIPE_VERSION` | `1` | `src/sim/recipe.ts` | Recipe schema for shareable ?recipe= links. |
| Formats | `RECIPE_QUERY_MAX` | `6000` | `src/sim/recipe.ts` | Above this many characters the share link falls back to parameters only. |
| Formats | `HASH_ALGO` | `fnv1a-32` | `src/sim/engine.ts` | State hash used for provenance and the perf baseline. |
| Tournament | `TOURNAMENT_DRAW / INJECT` | `0.1 / 12` | `src/sim/tournament.ts` | Share gap that counts as a draw, and cells injected per contestant. |
| Rendering | `OVERLAY_GAMMA` | `0.5` | `src/render/overlay.ts` | Contrast applied before the overlay field becomes a byte. |
| Rendering | `DEFAULT_OVERLAY_ALPHA` | `0.42` | `src/render/overlay.ts` | Alpha of the strain heat map. |
| Rendering | `EXUDATE_OVERLAY_ALPHA` | `0.62` | `src/render/overlay.ts` | Alpha of the exudate layer, raised so a thin field is readable. |
<!-- /generated:constants -->

## 11. Revision log

<!-- generated:revisions -->
The current revision is asserted against `src/sim/engine.ts` and `tests/baselines/engine.json` on every test run; the earlier rows are the recorded history of the model.

### 1.0.0 — revision 1 — perf hash `c2c03a81` (2026-09-10)

**Pre-upgrade engine, frozen as the annotated tag engine-v1.**

- Phase 1–2 model: point, indel and duplication mutations; four diffusing fields (nutrient, toxin, temperature, light); 8-neighbour predation; the original mutualism rule.
- Engine identity, the parameter spec, snapshot v2 and the migration path were introduced on top of this revision without changing its behaviour, so the perf hash stayed c2c03a81 through Stage 0.

Evidence: workbench.md, "Upgrade Stage 0 — engine identity, parameter spec, migration, gates".

### 2.0.0 — revision 2 — perf hash `9df52ec5` (2026-09-10)

**Model correctness: bounded predation, overflow cross-feeding, genome economics.**

- A predator is limited to params.maxMealsPerTick prey per tick (default 1) across both the interaction and the movement phase; the meal ledger is shared.
- Mutualism was replaced by overflow cross-feeding: a phototroph whose gross photosynthesis exceeds its maintenance leaks params.exudateLeak of the surplus into the exudate field, and a receptor (signal >= 1) takes it up at EXUDATE_YIELD. The producer pays exactly what the field gains, capped by the cell's headroom.
- Sequence length costs energy: params.genomeUpkeep per base per tick and params.replicationCost per base at division.
- Senescence: an age-dependent hazard 1 - exp(-rate (age/maxAge)^2) on top of the hard maxAge ceiling.
- Disturbances became per-tick hazards (params.toxinPulseRate / droughtRate / crashRate) instead of fixed periods.
- Light stopped being a solute: params.lightDiffusion is separate from params.diffusionRate.
- Kin recognition is a parameter (params.kinThreshold), and density-dependent fecundity p = 1/(1 + (N/K)^4) replaced an undocumented RNG skip.
- Chemostat mode: params.dilutionRate with params.inflowNutrient refreshes the medium and washes organisms out, adding the washout death cause.

Evidence: workbench.md, "Upgrade Stage 1 — model correctness".

### 2.1.0 — revision 3 — perf hash `185d6460` (2026-09-10)

**Evolvability: a mutator trait, recombination and cis-regulation.**

- An eleventh trait, mutator, rides as a secondary contribution on the proline codons and TGG; World.mutationRatesFor scales the base rate per organism.
- recombine(a, b, rng) is a single-point crossover with independent cut points, used for sex and horizontal transfer through params.recombinationRate and params.recombinationRadius. The innovation records the donor.
- Cis-regulation: codons immediately upstream of an ATG amplify the gene (REG_SELF for the same trait, REG_CROSS for the most frequent other trait, capped at REG_MAX), making gene order and intergenic sequence evolvable. params.regulationEnabled switches it off.

Evidence: workbench.md, "Upgrade Stage 2 — evolvability".

### 2.2.0 — revision 4 — perf hash `e953dcdc` (2026-09-13)

**A habitable fresh plate: nutrient recycling.**

- New parameter nutrientInflow (default 0.004 per tick): uniform nutrient regeneration inside Fields.applyVentsAndDecay, i.e. detritus recycling.
- Starting nutrient raised from 0.12 to 0.35 in seedEnvironment and clearPresetTerrain.
- The two model-validation tests that isolate the diffusion kernel now zero the inflow, because it is a source.

Evidence: workbench.md, "Round: a habitable fresh plate".

### 2.3.0 — revision 5 — perf hash `b6734bfc` (2026-09-14)

**Heritable lifespan, a standing climate, and a food web with prices.**

- A twelfth trait, longevity, multiplies the age ceiling: lifespan = max(1, round(maxAge x longevity)), squashed into [0.5, 2]. The senescence hazard and the reap cutoff both use the organism's own ceiling. It rides on the threonine codons ACT/ACC/ACA/ACG (+0.06) and the cysteines TGT/TGC (+0.08), so a genome that predates it keeps its phenotype, and params.longevityUpkeep (0.012 per unit above 1) charges for the extra life in both ledgers.
- The climate has a floor: the temperature field relaxes towards params.ambientTemperature (0.5) instead of decaying to 0. A one-way decay was a countdown — every organism's |temperature - tpref| cost grew without bound, so the plate froze into mass starvation by tick ~500 whatever it ate.
- Harvest is the documented mass-action law again: energy is uptake x nutrient x UPTAKE_GAIN, and params.nutrientUptakeCap only limits how fast a cell can be stripped. Reconstructing the harvest from the cap instead made income quadratic in uptake (a knife-edge at uptake ~ 0.67) and let one constant set the whole plate's energy budget.
- Aggression is priced: params.aggressionUpkeep (0.30 per unit) is charged in both ledgers. Free aggression swept to fixation, every organism became a predator and the plate ate itself extinct at tick ~1250; the priced plate holds ~1090 organisms for 3000 ticks with all five death causes present.
- Hunting follows need: a predator only attacks while it is below its own division threshold, so a fed predator is blocked by prey instead of hoarding meals.
- Trophic efficiency is real: a meal transfers TROPHIC_SHARE_BASE + TROPHIC_SHARE_AGGRESSION x aggression (0.30 + 0.30) of the prey's stored energy plus a small MEAL_BODY_BONUS (0.10, was 0.45) of its body. The old pair made every kill a 15-to-40-tick jackpot whatever the prey held, so aggression remained free money and the plate still decayed to 69 organisms by tick 6000; at the new share the default plate holds 1088-1098 to tick 5500 and predation stays a third of deaths.
- The two specialist kits can feed themselves: Resistant is resist x5 / uptake x5 / motility x3 (uptake x3 left its income ceiling below its own maintenance, so a dropped Resistant starved in fifteen ticks) and the Mutualist gains motility x3. randomGenome() now derives its trait list from TRAIT_NAMES, so no trait can be missing from the random founders.
- Snapshot schema v3 with a v2 -> v3 migration: a version-2 payload predates longevity, and restoring its stored phenotype verbatim left ph.longevity undefined, lifespan() NaN and the next reap() empty. World.restore and parseWorldBytes now migrate every reader, so file import, presets, in-session snapshots and the worker op all pass through one choke point.
- nutrientDecay defaults to 0.004 (equilibrium 1.0) and seedEnvironment starts the plate at that equilibrium; inflowNutrient defaults to 1 so a chemostat starts habitable.

Evidence: workbench.md, "Round: a gene for age" and "Round: death with reasons".
<!-- /generated:revisions -->

Stages 3 to 5 of the research upgrade (statistics, the headless runner, the
research panel) added measurement and tooling without touching the model: the
perf hash stayed `185d6460` throughout.

## 12. Calibration record

<!-- generated:calibration -->
Why each default has the value it has. Entries backed by a test carry a `calibration:<id>` marker in that file, so the record cannot point at a check that no longer exists.

### plate-habitability

A ventless plate stays habitable and a dropped organism founds a population instead of starving in seconds.

- **Method.** World(48x48, published defaults, randomTerrain false) with one heterotroph kit genome placed at the centre; step 260 ticks and record the first birth, the population and the plate's mean nutrient.
- **Measured.** First birth at tick 22, six organisms at tick 150 (the founder still among them) and twenty-five at tick 260; mean nutrient 0.994 at tick 100. Before the climate and harvest repairs the same founder never divided at all: it peaked at 1.008 energy against a 1.542 threshold and died childless at tick 260.
- **Tolerance.** The founder is alive at step 150, the population has grown past it, and mean nutrient at step 100 is at least 0.42.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/world.ts seedEnvironment, params.ambientTemperature.

### nutrient-equilibrium

Nutrient inflow sets a floor under a ventless plate: the equilibrium is inflow / nutrientDecay.

- **Method.** 32x32 world with the published defaults (nutrientInflow 0.004, nutrientDecay 0.004), no organisms and no vents; step 400 and read the mean nutrient.
- **Measured.** 1.000 by tick 400 (0.004 / 0.004), and the plate starts there because seedEnvironment fills the equilibrium. The break-even of a stock heterotroph is (maintenance + thermal) / (uptake x UPTAKE_GAIN) = (0.0676 + 0.0277) / 0.1512, about 0.63.
- **Tolerance.** Within 0.05 of inflow / nutrientDecay at tick 400, and the equilibrium stays above the 0.63 break-even.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/fields.ts, src/sim/world.ts seedEnvironment.

### exudate-surplus-rule

Cross-feeding is overflow metabolism: only a phototroph whose gross gain exceeds its maintenance leaks, and exudateLeak 0 disables the trophic link exactly.

- **Method.** 32x32 plate, 12 phototrophs injected; step 60 and read lastExudate and the exudate field total; repeat with exudateLeak 0.
- **Measured.** Twelve phototrophs on a 32x32 plate: 21 leak in the peak tick and the field total reaches 1.99 by step 60. With exudateLeak 0 the field total stays at exactly 0 for the whole run.
- **Tolerance.** At least one producer event with the default; field total identically 0 at leak 0.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/chemistry.ts, src/sim/ecology.ts metabolize.

### exudate-leak-tuned

The leak is a transfer, not a tax: a larger exudateLeak no longer strangles a phototroph monoculture.

- **Method.** 24 injected phototrophs, mutationRate 1, 90 steps: survivors and innovations at leak 0.15 and at leak 0.4, plus the 0-leak rule above.
- **Measured.** 26 survivors / 12 innovations at leak 0.15 against 33 / 14 at leak 0.4. The historical bisect read the other way (11 / 2 against 7 / 0) while the plate was cooling to zero and the nutrient yield was capped below subsistence; with both repaired the surplus is recovered by receptors instead of lost.
- **Tolerance.** Both monocultures survive 90 steps and the higher leak is not worse by more than a quarter.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** workbench.md, "Upgrade Stage 1 — model correctness", calibration evidence.

### meal-budget

Trophic transfer is bounded by attack rate, not by local density.

- **Method.** One predator ringed by eight edible prey, one tick, with maxMealsPerTick 1 and then 3.
- **Measured.** Eight kills before the fix; one with the default budget and three with the budget raised.
- **Tolerance.** Exactly maxMealsPerTick kills.
- **Checked by.** re-measured by `tests/predation.test.ts` on every run.
- **Source.** workbench.md, "Upgrade Stage 1", the two measured artifacts.

### field-mass-conservation

Below the field clamp the diffusion kernel conserves mass, and a barrier blocks the flux.

- **Method.** Nutrient isolated on an open plate with decay, inflow and vents zeroed; diffuse 200 steps and compare the totals.
- **Measured.** Total mass unchanged to float precision; no nutrient crosses a barrier column.
- **Tolerance.** Relative drift below 1e-4.
- **Checked by.** re-measured by `tests/validation.test.ts` on every run.
- **Source.** tests/validation.test.ts.

### genome-economics

Sequence length is not free: upkeep and replication are charged per base.

- **Method.** Two organisms with the same phenotype but different genome lengths; compare energy after N ticks and the cost charged at birth.
- **Measured.** Energy differs by genomeUpkeep x bases x ticks; a birth pays replicationCost x bases before the daughter's share.
- **Tolerance.** Longer genome strictly poorer at equal phenotype.
- **Checked by.** re-measured by `tests/evolution.test.ts` on every run.
- **Source.** src/sim/world.ts reproduceAll, src/sim/fitness.ts maintenanceCost.

### selection-recovery

The reported selection coefficient is an estimator, not a decoration: it recovers a known s.

- **Method.** Synthetic frequency trajectories with a known per-tick s; least-squares slope of logit(frequency).
- **Measured.** Recovers s to three decimals across the tested trajectories; the test names the scenario and the expected value.
- **Tolerance.** |estimate - s| below 0.002.
- **Checked by.** re-measured by `tests/selection.test.ts` on every run.
- **Source.** src/sim/selection.ts, workbench.md Stage 3.

### plate-capacity

Population size is bounded by the plate as much as by the parameter.

- **Method.** 180 founders on the 128x128 default plate, step to 400 and read the population, then keep stepping to 3000 and read the death causes and mean aggression.
- **Measured.** 508 at tick 100, 677 at tick 400, peak 1087 against the 1100 cap; at tick 3000 the plate holds 1093 organisms with mean aggression 0.028 and deaths by competition 1744, old-age 1652, starvation 307, predation 162, crowding 75.
- **Tolerance.** Recorded measurement; the population must stay below maxPopulation.
- **Checked by.** recorded measurement (not re-measured by the suite).
- **Source.** workbench.md, "Round: a habitable fresh plate".

### perf-budget

A step fits the 60 fps budget on the canonical world, and the mature plate fits its own measured budget.

- **Method.** npx vite-node tools/perf.ts: three 128x128 scenarios on seed 0xa7f31ab with 50 measured steps each — canonical (260 founders, 48 warmup ticks), mature (180 founders, stepped to tick 400) and chemostat (dilutionRate 0.02, inflowNutrient 1, 400 warmup ticks).
- **Measured.** 4.4 ms/step at 160 organisms on the canonical world, 5.3 on the mature plate (1033 organisms) and 5.7 in the chemostat (1089) on an idle machine; 8.5 / 10.4 / 11.1 ms/step on the same scenarios for 152 / 677 / 1087 organisms while another process held most of a core (a WebKit WebContent at 58 %). A clean checkout of the previous commit measures the identical field cost, so the difference is the machine, not the model — and all three stay inside their budgets either way.
- **Tolerance.** Canonical below 16.67 ms/step (the 60 fps target); mature below 12.9 ms/step and chemostat below 12.4 ms/step (2.5x the slowest recorded run).
- **Checked by.** re-measured by `tests/perf.test.ts` on every run.
- **Source.** tools/perf.ts, tests/perf.test.ts.

### longevity-trade-off

Lifespan is heritable, and the extra life is charged as upkeep, so the trait faces a trade-off instead of pinning itself at the cap.

- **Method.** Decode two genomes that differ in exactly two ACT codons (threonine, +0.06 longevity each); compare the phenotype, lifespan and maintenanceCost, then hold a carrier on a fed plate with senescenceRate 0 and maxAge 40.
- **Measured.** 1.0000 to 1.1200 longevity: an age ceiling of 40 becomes 45 and 260 becomes 291, while maintenance rises from 0.065200 to 0.066640 energy per tick (LONGEVITY_UPKEEP x 0.12). The carrier is still alive at step 41 on a plate whose parameter ceiling is 40.
- **Tolerance.** The measured deltas must follow the codon extras exactly; the carrier outlives maxAge with the hazard disabled.
- **Checked by.** re-measured by `tests/longevity.test.ts` on every run.
- **Source.** src/sim/mapping.ts CODON_EXTRAS, src/sim/body.ts lifespan, src/sim/fitness.ts maintenanceCost.

### founder-viability

Every non-carnivorous starter kit founds a population from a single founder on a bare default plate.

- **Method.** One founder of the phototroph, heterotroph, resistant and mutualist kits on a fresh 48x48 plate (seed 0xa7f31ab, no injected food); step 600 ticks and record the first birth and the largest population.
- **Measured.** First birth at tick 34 / 38 / 63 / 50 with a largest population of 115 / 68 / 11 / 62. Before the repairs all four were dead ends: the heterotroph never divided, the phototroph divided once at tick 251, and the Resistant and Mutualist kits starved in fifteen ticks.
- **Tolerance.** Every listed kit divides within 200 ticks and passes a population of 5; the predator kit is excluded because it needs prey.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/kits.ts, src/sim/genome.ts founder*.

### aggression-priced

Aggression is not free: a population seeded with hunters loses them, because the hunting apparatus is charged every tick.

- **Method.** 32x32 plate, no injection: 40 phototrophs and 20 predators placed by hand (mean aggression 0.193), stepped 300 ticks on three seeds; read the mean aggression of the survivors.
- **Measured.** Mean aggression falls to 0.020 / 0.020 / 0.023 on seeds 1 / 7 / 21, i.e. back to the phototroph baseline: the hunters cannot pay AGGRESSION_UPKEEP without prey. Free aggression instead swept the mature plate to mean 0.91 and extinction.
- **Tolerance.** Every seed stays populated and drops below 0.05 mean aggression.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/fitness.ts aggressionUpkeep, params.aggressionUpkeep, src/sim/ecology.ts hungry.

### plate-persistence

A mature plate with predators present persists for thousands of ticks.

- **Method.** 180 founders on the 128x128 default plate (seed 0xa7f31ab); step to 6000 ticks and read the trajectory, then the death causes of the last 3000 deaths.
- **Measured.** 1088-1098 organisms from tick 500 to tick 5500, then 810 at tick 6000; over that final stretch the causes are starvation 1529, predation 1387, competition 577, crowding 315, old-age 80 — every cause present, predation about a third of deaths. Before the trophic repair the same plate ran to mean aggression 1.3 and 69 organisms by tick 6000, and with free aggression it went extinct at tick 2190.
- **Tolerance.** Recorded measurement of a long run; the tested claim below pins the mechanism on a cheaper scenario.
- **Checked by.** recorded measurement (not re-measured by the suite).
- **Source.** workbench.md, "Round: death with reasons".

### plate-longrun

A plate keeps a self-regulating community for thousands of ticks: deaths have causes, aggression stays bounded and predators stay alive.

- **Method.** 64x64 plate, 180 founders (seed 0xa7f31ab), 2500 ticks; read the population, its minimum after tick 300, mean aggression and the death causes.
- **Measured.** 582 organisms at tick 2500, minimum 69 after tick 300, mean aggression 0.066, predation 1213 of 3102 deaths. With the pre-stabiliser transfer (0.35 + 0.40 x aggression plus a 0.45 body bonus) the same scenario is extinct at tick 1843.
- **Tolerance.** Still populated at tick 2500 with more than 100 organisms, mean aggression below 0.5, and more than 100 predation deaths.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/body.ts feed, TROPHIC_SHARE_BASE, MEAL_BODY_BONUS.
<!-- /generated:calibration -->

## 13. Known limits

<!-- generated:limits -->
- **Profil v1 only approximates engine-v1.** The legacy profile restores senescence 0, regulation off, no recombination, no exudate, no genome costs, 8 meals per tick and light diffusion 0.22. The meal budget and the decoder differ, so results are close but not hash-identical: use the tag engine-v1 for bit-reproducing pre-upgrade results. (`src/ui/modelPanel.ts LEGACY_V1_PROFILE`)
- **Nutrient inflow is a source term.** nutrientInflow injects nutrient from outside the modelled system, so total field mass is only conserved when it is zero. The validation tests zero it deliberately, and the parameter is bounded at 0.2 per tick. (`src/sim/fields.ts applyVentsAndDecay, tests/validation.test.ts`)
- **The perf budget is scenario-specific.** The canonical 128 x 128 world (260 founders, seed 0xa7f31ab) is the pinned-hash world: its budget is the 16.67 ms/step 60 fps target. The mature plate (180 founders stepped to tick 400, 677 organisms) and the chemostat carry their own 2.5x-headroom budgets in tests/perf.test.ts, measured by npx vite-node tools/perf.ts. Those two are calibrated on a laptop and a shared CI runner is ~2.5x slower per step, so the workflow sets OPENAVIDA_PERF_BUDGET_SCALE=3 rather than loosening the local gate; the effective budget and scale are printed with every result. No single scenario describes the 1100-organism cap. (`tests/perf.test.ts, tools/perf.ts`)
- **A mature plate reaches its population cap.** With the climate and harvest repaired the plate is productive enough to fill maxPopulation (1100) from tick ~1000, so at maturity the cap is a binding constraint rather than a safety net: 677 organisms at tick 400 and 1093 at tick 3000 on the default plate. It is also doing stabilising work — allowed to grow past it (maxPopulation 3000) the same world booms to 2400 and crashes to a few hundred — so raising the cap is not a free way to make the plate richer. (`tools/modeldoc.ts CALIBRATION plate-capacity, src/sim/world.ts reproduceAll`)
- **Small, sparse plates are extinction-prone.** The trophic economy self-regulates on the default 128 x 128 plate, but a small world with few founders has little spatial buffer: 64 x 64 with 90 founders goes extinct around tick 2300, while the same plate with 180 founders or a 96 x 96 plate with 90 persists for 3000+ ticks. Start small plates denser, or expect a single stochastic extinction. (`tools/modeldoc.ts CALIBRATION plate-longrun, src/sim/world.ts seedPopulation`)
- **Snapshot v2 payloads are converted, not replayed.** A version-2 payload predates the longevity trait, so it is upgraded by recomputing every phenotype from its genome (v2 -> v3). The world plays on, but it is not bit-identical to the run that wrote it, because the phenotype gained a trait. Every reader migrates: World.restore, parseWorldBytes, the manifest start state and the worker restore op. (`src/sim/migrate.ts, src/sim/world.ts restore`)
<!-- /generated:limits -->

## 14. Reproducing a published result

1. **Same engine.** Compare the manifest's `engine.revision` with the current
   one. A different revision needs the tag that carries it (`engine-v1` for the
   pre-upgrade model) or the version recorded in the manifest.
2. **Same parameters.** `paramsDigest` in the manifest and in every export
   proves the parameter set; `normalizeParams` makes an old payload loadable
   under the current spec.
3. **Same seed.** Replicates are independent: the seed plus the start state
   determine a replicate exactly, so `--jobs` and sharding never change a
   result.
4. **Check the hash.** Every `TrialResult` carries `finalHash`;
   `node tools/verify-reproduce.mjs runs/<dir>` re-runs a stored run and compares
   them, and `tests/baselines/engine.json` pins the canonical perf world.

```bash
npm run sim -- run experiment.json --out runs/toxin --jobs 4   # headless
node tools/verify-reproduce.mjs runs/toxin                     # same hashes?
npm run baseline                                              # re-pin deliberately
```
