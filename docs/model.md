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
   `maxMealsPerTick` prey per tick.
8. **Energy ceiling.** Energy is clamped to `3.2 + 1.2 × effective size`.
9. **Movement.** Each organism attempts a move with probability `motility`;
   chemotaxis with probability 0.72, otherwise a random direction. Moving onto
   prey hunts it; walking into a predator is fatal; otherwise the fitter
   organism displaces the occupant (death cause `competition`).
10. **Reproduction.** One pass over the pre-movement population (see
    [§5](#5-energy-budget-and-reproduction)).
11. **Reaping.** Organisms with no energy, or past `maxAge`, become death
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
  `temperature ← clamp(temperature·(1 − temperatureDecay), 0, 1.5)`,
  `exudate ← clamp(exudate·(1 − exudateDecay), 0, 4)`,
  `light ← clamp(light·(1 − lightDecay) + solar·0.08·shade·season, 0, 2)`.
- **Terrain** is a byte per cell: empty, barrier, nutrient vent (+0.08/tick),
  toxin vent (+0.07/tick), thermal vent (+0.05/tick), shade (×0.35 on the
  solar recharge of that cell).
- **Initial plate.** `randomTerrain: false` seeds a gradient: solar and light
  `0.35 + 0.55·(1 − y/(h−1))`, temperature 0.5, nutrient 0.35, toxin 0. With
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
| Predation | neighbour effect `Σ gap · 0.35` | through meals |

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
  `0.35 + 0.4·aggression` plus `MEAL_BODY_BONUS × effective size` of body, and
  the predator's own condition rises by `MASS_PER_KILL + 0.1·aggression`.
- **Meal budget.** A predator takes at most `maxMealsPerTick` prey per tick
  across both the interaction and the movement phase; at its budget it is
  blocked by prey rather than fed. This is what makes trophic transfer a rate
  limit instead of a density effect.
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
quantiles for every trait. `World.neutralLog` records neutral substitutions for
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
39 parameters. `PARAM_SPEC` in `src/sim/params.ts` is the single source: the interface form, the URL query keys (`QUERY_KEYS`), `normalizeParams` bounds and this table are all generated from it.

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
| `nutrientDecay` | metabolism | number | 0.007 | 0-1 | 0.001 | perTick | Fractional loss of the nutrient field per tick. |
| `toxinDecay` | metabolism | number | 0.006 | 0-1 | 0.001 | perTick | Fractional loss of the toxin field per tick. |
| `temperatureDecay` | metabolism | number | 0.002 (1/500) | 0-1 | 0.001 | perTick | Relaxation of the temperature field towards 0 per tick. |
| `lightDecay` | metabolism | number | 0.03 | 0-1 | 0.001 | perTick | Fractional loss of the light field per tick before solar recharge. |
| `reproduceEnergy` | metabolism | number | 1.55 | 0.05-100 | 0.05 | energy | Base energy a cell must hold to divide; scaled by the fecundity trait. |
| `maxAge` | metabolism | number | 260 | 1-100000 | 1 | steps | Hard age ceiling. With senescenceRate > 0 most deaths happen well before it. |
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
| `senescenceRate` | metabolism | number | 0.02 (1/50) | 0-1 | 0.005 | risk | Scale of the age-dependent mortality hazard (1 - exp(-rate (age/maxAge)^2)). 0 = hard maxAge cutoff only. |
| `exudateLeak` | chemistry | number | 0.15 | 0-1 | 0.01 | fraction | Share of the photosynthetic surplus a phototroph leaks into the exudate field. |
| `exudateDecay` | chemistry | number | 0.03 | 0-1 | 0.001 | perTick | Fractional loss of the exudate field per tick. |
| `exudateDiffusion` | chemistry | number | 0.5 (1/2) | 0-1 | 0.01 | perTick | Diffusion of the exudate field; how far a leak travels from its producer. |
| `genomeUpkeep` | evolution | number | 0.00002 (1/50000) | 0-0.01 | 0.00001 | energyPerBasePerTick | Maintenance cost per genome base per tick, so longer genomes are not free. |
| `replicationCost` | evolution | number | 0.001 (1/1000) | 0-0.05 | 0.0001 | energyPerBase | Energy charged per genome base at division, on top of the daughter's share. |
| `toxinPulseRate` | world | number | 0.015625 (1/64) | 0-1 | 0.0005 | perTick | Per-tick hazard of a random toxin pulse when disturbances are enabled (default 1/64). |
| `droughtRate` | world | number | 0.011363636363636364 (1/88) | 0-1 | 0.0005 | perTick | Per-tick hazard of a nutrient drought when disturbances are enabled (default 1/88). |
| `crashRate` | world | number | 0.008333333333333333 (1/120) | 0-1 | 0.0005 | perTick | Per-tick hazard of a population crash when disturbances are enabled (default 1/120). |
| `recordTraitDistribution` | world | flag | true | 0-1 | 1 | - | Store mean, sd and quantiles of every trait on each history sample (analysis without re-simulation). |
| `recordEvents` | world | flag | false | 0-1 | 1 | - | Record every birth, death, meal, exudation, recombination and neutral substitution for research export (bounded ring). |
| `dilutionRate` | world | number | 0 | 0-1 | 0.001 | perTick | Chemostat washout: fraction of organisms removed per tick and nutrient relaxed towards inflowNutrient. 0 = closed batch world. |
| `inflowNutrient` | world | number | 0.12 | 0-4 | 0.01 | concentration | Nutrient concentration the inflow restores when dilutionRate > 0. |
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
| Metabolism | `NUTRIENT_UPTAKE_CAP` | `0.16` | `src/sim/chemistry.ts` | Per-tick nutrient consumption capacity per unit of uptake. |
| Metabolism | `LONGEVITY_UPKEEP` | `0.012` | `src/sim/fitness.ts` | Energy per tick charged for each unit of longevity above the basal 1, so a longer life is paid for. |
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
| Body | `MEAL_BODY_BONUS` | `0.45` | `src/sim/body.ts` | Extra energy from the prey's body, per unit of effective size. |
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
| Formats | `SNAPSHOT_VERSION` | `2` | `src/sim/types.ts` | Snapshot schema; v1 payloads are migrated by src/sim/migrate.ts. |
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

### 2.3.0 — revision 5 — perf hash `0a4f5d18` (2026-09-13)

**Heritable lifespan: the longevity trait.**

- A twelfth trait, longevity, multiplies the age ceiling: lifespan = max(1, round(maxAge x longevity)), squashed into [0.5, 2]. The senescence hazard and the reap cutoff both use the organism's own ceiling.
- It rides as a secondary contribution on the threonine codons ACT/ACC/ACA/ACG (+0.06 each) and the cysteines TGT/TGC (+0.08), so every genome that predates it keeps its phenotype and its lifespan.
- The extra life is paid for: maintenanceCost adds LONGEVITY_UPKEEP (0.012) per unit of longevity above 1, so selection trades lifespan against the energy budget instead of pinning the trait at its cap.
- Telomerase joins the enzyme readout for the trait, and the research card tracks longevity alongside the other eleven.

Evidence: workbench.md, "Round: a gene for age".
<!-- /generated:revisions -->

Stages 3 to 5 of the research upgrade (statistics, the headless runner, the
research panel) added measurement and tooling without touching the model: the
perf hash stayed `185d6460` throughout.

## 12. Calibration record

<!-- generated:calibration -->
Why each default has the value it has. Entries backed by a test carry a `calibration:<id>` marker in that file, so the record cannot point at a check that no longer exists.

### plate-habitability

A ventless plate stays habitable: a dropped organism founds a population instead of starving in seconds.

- **Method.** World(48x48, published defaults, randomTerrain false) with one heterotroph kit genome placed at the centre; step until it dies, then read the plate's mean nutrient.
- **Measured.** One heterotroph lives exactly 260 steps on a 48x48 plate (about 20 before the change); on a mature 128x128 plate the nutrient self-regulates between 0.13 and 0.41 as the population grazes it.
- **Tolerance.** The founder is still alive at step 150; mean nutrient at step 100 at least 0.42.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** workbench.md, "Round: a habitable fresh plate".

### nutrient-equilibrium

Nutrient inflow sets a floor under a ventless plate: the equilibrium is inflow / nutrientDecay.

- **Method.** 32x32 world with nutrientInflow 0.004, nutrientDecay 0.007, no organisms and no vents; step 400 and read the mean nutrient.
- **Measured.** 0.558 by tick 400, asymptotically 0.571 (0.004 / 0.007); the break-even of a stock heterotroph is maintenance / (uptake x UPTAKE_GAIN) = 0.07 / 0.147, about 0.42.
- **Tolerance.** Between 0.55 and 0.62 at tick 400, and the equilibrium stays above the 0.42 break-even.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/fields.ts, src/sim/world.ts seedEnvironment.

### exudate-surplus-rule

Cross-feeding is overflow metabolism: only a phototroph whose gross gain exceeds its maintenance leaks, and exudateLeak 0 disables the trophic link exactly.

- **Method.** 32x32 plate, 12 phototrophs injected; step 60 and read lastExudate and the exudate field total; repeat with exudateLeak 0.
- **Measured.** Twelve phototrophs on a 32x32 plate: 11 leak in the peak tick and the field total reaches 1.72 by step 60. With exudateLeak 0 the field total stays at exactly 0 for the whole run.
- **Tolerance.** At least one producer event with the default; field total identically 0 at leak 0.
- **Checked by.** re-measured by `tests/calibration.test.ts` on every run.
- **Source.** src/sim/chemistry.ts, src/sim/ecology.ts metabolize.

### exudate-leak-tuned

exudateLeak 0.15 is the tuned default: a larger leak strangles a phototroph monoculture.

- **Method.** 24 injected phototrophs, mutationRate 1, 90 steps: survivors / innovations / lineages with living descendants, on the v1 engine, at leak 0.4 and at leak 0.15.
- **Measured.** Survivors / innovations: 11 / 2 at leak 0.15 against 7 / 0 at leak 0.4. The historical bisect (a different scenario) read 21 / 12 / 9 on the v1 engine, 10 / 2 / 0 at leak 0.4 and 17 / 6 / 5 at leak 0.15, and a receptor outlived an identical blind neighbour 30 steps to 25.
- **Tolerance.** Leak 0.15 leaves strictly more survivors and innovations at 90 steps than leak 0.4 on the same seed.
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

Population size is bounded by the plate rather than by the parameter.

- **Method.** 180 founders on the 128x128 default plate, step to 400 and read the population and Shannon index.
- **Measured.** Reaches 263 at tick 100, peaks at 924 (below the 1100 cap) and holds 670-780 organisms with Shannon 5.9 at tick 400.
- **Tolerance.** Recorded measurement; the population must stay below maxPopulation.
- **Checked by.** recorded measurement (not re-measured by the suite).
- **Source.** workbench.md, "Round: a habitable fresh plate".

### perf-budget

A step fits the 60 fps budget on the canonical world, and the mature plate fits its own measured budget.

- **Method.** npx vite-node tools/perf.ts: three 128x128 scenarios on seed 0xa7f31ab with 50 measured steps each — canonical (260 founders, 48 warmup ticks), mature (180 founders, stepped to tick 400) and chemostat (dilutionRate 0.02, inflowNutrient 0.12, 400 warmup ticks).
- **Measured.** 3.80 ms/step at 74 organisms on the canonical world (p95 3.99); 5.01 ms/step at 672 organisms on the mature plate (p95 5.30); 4.97 ms/step at 705 organisms in the chemostat (p95 5.39).
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
<!-- /generated:calibration -->

## 13. Known limits

<!-- generated:limits -->
- **Profil v1 only approximates engine-v1.** The legacy profile restores senescence 0, regulation off, no recombination, no exudate, no genome costs, 8 meals per tick and light diffusion 0.22. The meal budget and the decoder differ, so results are close but not hash-identical: use the tag engine-v1 for bit-reproducing pre-upgrade results. (`src/ui/modelPanel.ts LEGACY_V1_PROFILE`)
- **Nutrient inflow is a source term.** nutrientInflow injects nutrient from outside the modelled system, so total field mass is only conserved when it is zero. The validation tests zero it deliberately, and the parameter is bounded at 0.2 per tick. (`src/sim/fields.ts applyVentsAndDecay, tests/validation.test.ts`)
- **The perf budget is scenario-specific.** The canonical 128 x 128 world (260 founders, seed 0xa7f31ab) is the pinned-hash world: its budget is the 16.67 ms/step 60 fps target. The mature plate (180 founders stepped to tick 400, 670-780 organisms) and the chemostat carry their own 2.5x-headroom budgets in tests/perf.test.ts, measured by npx vite-node tools/perf.ts. No single scenario describes the 1100-organism cap. (`tests/perf.test.ts, tools/perf.ts`)
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
