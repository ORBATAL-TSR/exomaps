# VITA Renderer v7 — Astrophysical World Architecture
**Date:** 2026-03-17
**Status:** Proposal — supersedes v6 for world-gen pipeline and type system
**Scope:** Full astrophysical cascade: stellar → orbital → planetary → atmospheric → surface → terrain → zones

---

## Premise

The current world pipeline is **inside-out**. It starts from a pre-selected visual profile (`profiles.ts`) and applies physical reasoning as overrides. This produces plausible-looking planets, but each one is a variation on a curated hand-drawn template, not a planet that exists because the universe made it that way.

v7 inverts this. Every visual output is **derived from physical inputs**. The pipeline starts at the star and propagates outward through orbital mechanics, atmospheric physics, geological history, and finally surface appearance. The type classifier becomes probabilistic, not deterministic. Zones become **geophysical provinces** driven by impact history, volcanic activity, and tectonic regime — not administrative labels.

---

## Part I: Astrophysical Input Cascade

### 1.1 Stellar Parameters → Planetary Irradiance

Every planet rendering must begin with its star. The following stellar properties are available in the gateway API and should be wired through:

| Stellar Input | Symbol | Effect on Planet |
|---|---|---|
| `spectralClass` | e.g. `M5V` | Irradiance spectrum (UV/IR balance), sky color, habitability |
| `luminosity` | L/L☉ | Equilibrium temperature at orbit |
| `radius` | R/R☉ | Angular size → stellar disk size (limb darkening intensity) |
| `metallicity` | [Fe/H] | Planet formation material (rocky vs icy vs metallic) |
| `age` | Gyr | Stellar wind history → atmosphere stripping, surface weathering |
| `activityLevel` | 0-1 | Flare frequency → atmospheric erosion rate |

### 1.2 Orbital Parameters → Climate Forcing

| Orbital Input | Symbol | Visual Effect |
|---|---|---|
| `semiMajorAxis` | AU | Equilibrium temp via Stefan-Boltzmann |
| `eccentricity` | 0-0.9 | Heating pulse per orbit → volatile migration, seasonal extremes |
| `inclination` | deg | Obliquity proxy when combined with axial tilt |
| `tidallyLocked` | bool | Substellar/antistellar zone placement |
| `spin_orbit_resonance` | e.g. 3:2 | Subsolar point migration rate |

### 1.3 Planetary Parameters → Geological Character

| Planetary Input | Symbol | Geological Consequence |
|---|---|---|
| `mass` | M⊕ | Gravity retention, volcanism onset, plate tectonics onset (~0.3M⊕) |
| `radius` | R⊕ | Bulk density → composition inferred (rocky/icy/iron) |
| `density` | g/cm³ | Core composition (iron-rich vs rocky vs volatile) |
| `tidalHeating` | 0-1 | Surface resurfacing rate, volcanism |
| `magneticField` | 0-1 | Atmosphere retention, stellar wind deflection |
| `impactHistory` | 0-1 | Crater density, large basin count, ejecta blanket coverage |
| `tectonicRegime` | enum | Stagnant lid / mobile lid / heat pipe (Io-like) |

### 1.4 Derived Physical Outputs (new fields in `derive.ts`)

These quantities must be computed from inputs above and stored on the visuals object:

```typescript
interface WorldPhysics {
  // Thermal
  equilibriumTemp:    number;   // K — Stefan-Boltzmann from L and a
  surfaceTemp:        number;   // K — after greenhouse correction
  subsolarTemp:       number;   // K — tidally locked hot side
  nightsideTemp:      number;   // K — tidally locked cold side

  // Atmospheric
  atmChemistry:       AtmChemistry;  // see Part III
  atmPressure:        number;   // bar
  scaleHeight:        number;   // km — affects limb haze altitude
  atmRetentionIndex:  number;   // 0-1 — jeans escape rate proxy

  // Glaciation
  iceLine:            number;   // sin(lat) of ice/no-ice boundary [0,1]
  iceLineBlur:        number;   // 0.03-0.15 — fuzziness of ice boundary
  snowLine:           number;   // altitude h above which snow appears [0,1]

  // Cloud / Circulation
  hadleyWidth:        number;   // sin(lat) half-width of ITCZ [0.08-0.25]
  coriolisStrength:   number;   // 0-1 — fast rot = tight bands, slow = broad cells
  stormBeltLat:       number;   // sin(lat) of mid-latitude storm track

  // Geology
  tectonicRegime:     TectonicRegime;
  mantleViscosity:    number;   // 0=hot/mobile, 1=cold/stagnant
  crustalAge:         number;   // 0=hours-old, 1=4+ Gyr ancient
  volcanicFlux:       number;   // km³/Myr — controls resurfacing rate
  impactFlux:         number;   // normalized cratering rate
  radiogenicHeat:     number;   // drives internal volcanism independent of tidal

  // Composition
  ironCoreFraction:   number;   // 0-1
  silicateFraction:   number;   // 0-1
  volatileFraction:   number;   // ice/organics/water — drives ocean and ice cap
  metalBudget:        number;   // surface metal availability (affects mineral veins)
}
```

---

## Part II: Condition-Based World Type Probability System

### 2.1 Current Architecture Problem

The current system: human picks `planetType = 'rocky'` → profile lookup → genome override.

This means every world must fit one of ~50 named buckets before any physics is applied. The classifier in `ProceduralWorld.tsx` has no probability semantics — `planetType` is just a string key.

### 2.2 Proposed: Probabilistic Type Resolution

Replace the flat string lookup with a **condition table** that maps physical parameters to weighted probabilities across type categories.

```typescript
interface TypeCondition {
  // Physical range gates (all must pass)
  massRange?:     [number, number];   // M⊕
  tempRange?:     [number, number];   // K surface temp
  densityRange?:  [number, number];   // g/cm³
  atmRange?:      [number, number];   // bar
  tidalMin?:      number;
  metalRange?:    [number, number];   // [Fe/H]
  orbitalPeriod?: [number, number];   // days

  // Derived condition tests
  habitableZone?: boolean;
  frozenOut?:     boolean;
  tidallyLocked?: boolean;
  moonOf?:        'gas-giant' | 'rocky' | 'ice-giant';

  // Weight: base probability when conditions pass
  weight:         number;  // 1=baseline, 0.1=rare, 5=common

  // Result type
  type:           WorldTypeId;
}
```

Example: for a 0.8M⊕ planet at 1.1 AU around a G-star at 288K:

| Type | Conditions | Weight | Prob% |
|---|---|---|---|
| `earth-like` | mass 0.5-2, temp 270-320, hasAtm, habitableZone | 3.0 | 38% |
| `ocean-world` | mass 0.5-3, temp 270-340, density<4.5 | 1.8 | 23% |
| `desert-world` | mass 0.3-2, temp 290-420 | 1.2 | 15% |
| `hycean` | mass 1-4, temp 270-420, density<3.8 | 0.8 | 10% |
| `super-earth` | mass 0.6-10, temp 250-400 | 0.6 | 8% |
| others | ... | ... | 6% |

### 2.3 Condition Table Implementation

```typescript
// classifier.ts — new file
export function resolveWorldType(
  physics: WorldPhysics,
  orbitParams: OrbitalParams,
  seed: number
): WorldTypeId {
  const eligible = TYPE_CONDITIONS
    .filter(c => physicsPassesCondition(physics, orbitParams, c))
    .map(c => ({ type: c.type, w: c.weight }));

  if (eligible.length === 0) return 'rocky'; // fallback

  const total = eligible.reduce((s, e) => s + e.w, 0);
  const r = seededRandom(seed, 9999) * total;
  let acc = 0;
  for (const e of eligible) {
    acc += e.w;
    if (r < acc) return e.type;
  }
  return eligible[eligible.length - 1].type;
}
```

Key design principles:
- **Deterministic from seed**: same physics + same seed = same type always
- **Smooth at boundaries**: probability ramps at condition edges (not step functions)
- **Compositionally consistent**: high-density world cannot be an ice world; high-volatile world cannot be iron-planet
- **Star-aware**: M-dwarf habitable zone has different conditions than G-star HZ

---

## Part III: World Type Taxonomy

> **Full taxonomy: see [WORLD_TYPE_TAXONOMY.md](WORLD_TYPE_TAXONOMY.md)**
> 239 named types across 14 categories. Summary below.

### 3.1 Category Hierarchy (239 types total)

| Cat | Name | Count | Key additions vs v6 |
|---|---|---|---|
| A | Rocky / Airless | 27 | iron subtypes, carbon subtypes (graphite/carbide/tar/fullerene), impact-age categories |
| B | Desert / Arid | 12 | hot-desert, cold-desert, gypsum, chalk-desert, karst-desert |
| C | Volcanic / Eruptive | 13 | io-analog, caldera-world, flood-basalt, cryovolcanic, silicic, hotspot-chain |
| D | Hot / Greenhouse | 15 | ultra-hot-rocky, fluorine-ocean, chlorine-ocean, phosphoric, iron-vapor, silicate-vapor |
| E | Temperate / Habitable | 37 | SuperEarths own group (12), jungle/savanna/forest/peat/bioluminescent, 14 ocean subtypes |
| F | Cold / Ice | 27 | snowball, periglacial, blizzard, anti-greenhouse, cryo-ocean subtypes, 9 exotic ices, 6 KBO types |
| G | Tidal Lock / Eyeball | 17 | 8 eyeball subtypes, 5 axial-tilt variants, 4 resonance types |
| H | Sub-Neptunian | 17 | sub-neptune (9 subtypes), mini-neptune (8 subtypes) — new full category |
| I | Gas Giants | 20 | ultra-hot-jupiter, puffy, dark-giant, rainbow-giant, brown-striped, phosphine-giant |
| J | Ice Giants | 12 | diamond-neptune, slushworld, dark/methane/water ice giant subtypes |
| K | Brown Dwarfs | 9 | Y/T/L/M-boundary, hot-BD, binary-BD, free-floating-planet, rogue-planet |
| L | Radiation Types | 7 | rad-blasted, aurora-world, stellar-wind-scoured, magnetar-companion, flare-star-survivor |
| M | Exotic / Transitional | 10 | roche-limit, ablating, comet-like, circumplanetary-debris, post-impact |
| N | Moons | 26 | tidal-lock/retrograde/inclined subtypes, cryovolcanic, mixed-ice, thick-ice-shell |

### 3.2 Tag System (expanded)

```typescript
type WorldTag =
  // Composition
  | 'atm' | 'metal' | 'volc' | 'ice' | 'carbon' | 'silicate' | 'iron'
  | 'carbon-rich'    // C/O > 0.8 — affects genome pool
  | 'nitrogen-ice'   // N₂ dominant surface
  | 'organic-haze'   // complex hydrocarbon photochemistry
  | 'diamond-layer'  // high-pressure carbon precipitation
  | 'tholin'         // irradiated organic residue

  // Geology
  | 'cratered' | 'tectonics' | 'stagnant-lid' | 'resurfaced' | 'ancient'
  | 'mobile-lid'     // Earth-style plate tectonics
  | 'heat-pipe'      // Io-style extreme volcanism
  | 'impact-basin'   // large impact basins present
  | 'rift-system'    // active extensional rifting
  | 'fold-belt'      // collisional orogen mountain chain
  | 'flood-basalt'   // LIP eruption coverage

  // Climate
  | 'habitable' | 'frozen' | 'hot' | 'tidally-locked'
  | 'high-eccentricity' | 'high-obliquity'
  | 'retrograde-spin'   // retrograde rotation
  | 'resonance-32'      // 3:2 spin-orbit resonance
  | 'eyeball'           // substellar/antistellar dichotomy
  | 'runaway-greenhouse'
  | 'snowball'          // fully glaciated

  // Atmosphere chemistry
  | 'N2-O2' | 'CO2-atm' | 'CH4-atm' | 'H2SO4-atm' | 'NH3-atm'
  | 'H2-He'           // primordial/reducing envelope
  | 'steam-atm'       // water vapor dominant
  | 'HCl-atm'         // hydrogen chloride
  | 'ablating'        // mass-loss to space

  // Orbital / structural
  | 'moon' | 'ring-system' | 'binary' | 'trojan'
  | 'captured'        // gravitationally captured body
  | 'rogue'           // no host star
  | 'sub-stellar'     // below hydrogen-burning (brown dwarf family)
  | 'radiation-belt'  // intense particle radiation environment

  // Biology
  | 'biosphere' | 'pre-biotic' | 'bioluminescent'
;
```

### 3.3 Condition Gate Quick Reference

| Physical Condition | Common Types | Rare |
|---|---|---|
| 0.5–2M⊕, 270–320K, atm>0.1 bar, HZ | earth-like, ocean-world | jungle-world, savanna-world |
| 0.5–2M⊕, 320–420K, atm>0.1 bar | desert-world, hot-desert | acid-ocean, steam-world |
| 0.5–2M⊕, 170–270K, atm>0.05 bar | tundra-world, glacier-world | snowball |
| 0.5–2M⊕, <150K, no atm | nitrogen-ice-world, co2-frost-world | cryo-ocean |
| 0.1–0.5M⊕, any T, no atm | rocky, sub-earth | iron-planet, basalt-planet |
| 0.3–0.7M⊕, [Fe/H]>0.3 | iron-planet, magnetite-world | carbon-planet, carbide-world |
| C/O>1.0 any mass | carbon-planet, graphite-world | carbide-world, tar-world |
| 2–10M⊕, 270–400K, density<4 | super-earth, hycean, ocean-superearth | warm-hycean |
| 2–10M⊕, >400K, thick atm | hot-venus, steam-world | acid-ocean |
| 4–8M⊕, density<3 | sub-neptune, gas-dwarf | water-sub-neptune |
| 8–20M⊕, density<3 | mini-neptune, super-neptune | diamond-neptune |
| tidal>0.6, mass<0.05M⊕ | moon-volcanic, moon-magma-ocean | io-analog |
| T<60K, mass<0.05M⊕ | ice-dwarf, nitrogen-ice-world | detached-kbo |
| tidallyLocked, T 270–350K | eyeball-world, ocean-eyeball | cloud-eyeball |
| tidallyLocked, T 350–900K | volcanic-eyeball, desert-eyeball | super-rotating-eyeball |
| mass>13Mⱼ | brown-dwarf subtype by temp | binary-brown-dwarf |
| no parent star | rogue-planet, free-floating-planet | y-dwarf |
| axialTilt>45° | high-obliquity-world, seasonal-extreme | pole-star-world |
| flare star, inner HZ | rad-blasted, flare-star-survivor | stellar-wind-scoured |

---

## Part IV: Geophysical Zone System Redesign

### 4.1 Current Zone Role Set

Current roles: `DEFAULT(0), POLAR_ICE(1), SUBSTELLAR(2), ANTISTELLAR(3), TERMINATOR(4), CRATON(5), RIFT(6), SHELF(7), RIDGE(8), TRENCH(9), HOTSPOT(10)`

These are too few and not astrophysically motivated. A continental craton is not the same magnitude as a mid-ocean ridge.

### 4.2 Expanded Zone Role Set

```typescript
export const ZONE_ROLE = {
  // Thermal / orbital (driven by star geometry)
  DEFAULT:         0,
  POLAR_ICE:       1,
  SUBSTELLAR:      2,
  ANTISTELLAR:     3,
  TERMINATOR:      4,

  // Tectonic provinces (driven by plate regime)
  CRATON:          5,   // ancient stable basement, flat, weathered
  RIFT:            6,   // active extensional basin, fault scarps
  SHIELD:         11,   // exposed ancient crystalline basement (craton variant, less flat)
  FOLD_BELT:      12,   // collisional orogen — linear mountain chain
  PASSIVE_MARGIN: 13,   // continent-ocean transition, wide shallow shelf

  // Volcanic (driven by hotspot/subduction)
  HOTSPOT:        10,   // point-source volcanic, shield volcano profile
  ARC:            14,   // subduction arc — andesite stratovolcano chain
  FLOOD_BASALT:   15,   // LIP outpouring — flat dark plain, no edifice
  CALDERA:        16,   // collapsed volcanic system — depression with rim

  // Oceanic (driven by seafloor spreading + depth)
  SHELF:           7,   // shallow carbonate/clastic platform
  RIDGE:           8,   // spreading center, fresh basalt
  TRENCH:          9,   // subduction trench, hadal
  ABYSSAL:        17,   // mid-ocean abyssal plain
  SEAMOUNT:       18,   // submarine isolated volcano

  // Impact (driven by impactHistory parameter)
  IMPACT_BASIN:   19,   // large impact basin > 200km — broad shallow depression
  IMPACT_HIGHLANDS: 20, // heavily cratered ancient terrain
  EJECTA_BLANKET: 21,   // thick ejecta deposit around major basin

  // Exotic (world-type specific)
  CRYOVOLCANIC:   22,   // cryo-eruption zone (Europa, Enceladus style)
  SALT_FLAT:      23,   // evaporite basin
  GLACIAL:        24,   // ice sheet province with bedrock topology
  POLAR_VORTEX:   25,   // high-lat atmospheric cell — cloud-permanent zone
} as const;
```

### 4.3 Zone Placement — Science-Driven Algorithm

`computeZoneRoles()` currently places zones by simple hashing with `oceanLevel`/`volcanism` gates. Replace with a **geophysical placement system**:

```typescript
interface ZonePlacementParams {
  worldType:       WorldTypeId;
  physics:         WorldPhysics;
  tidallyLocked:   boolean;
  axialTilt:       number;     // degrees — affects polar zone extent
  impactHistory:   number;     // 0-1 — drives IMPACT_BASIN, IMPACT_HIGHLANDS counts
  tectonicRegime:  TectonicRegime;
  oceanLevel:      number;
  volcanism:       number;
  mantleAge:       number;     // 0=young, 1=ancient — drives CRATON vs RIFT balance
  seed:            number;
}

type TectonicRegime =
  | 'stagnant-lid'    // Venus/Mars — one plate, heat pipe volcanism
  | 'mobile-lid'      // Earth-like — multiple plates, subduction
  | 'heat-pipe'       // Io-like — extreme volcanic flux, no coherent plates
  | 'plutonic'        // Titan-like — solid ice/rock, no internal activity
  | 'episodic'        // resurfacing events but not continuous
;
```

Zone count allocation by regime:

| Regime | CRATON | RIFT | FOLD_BELT | ARC | FLOOD_BASALT | IMPACT_BASIN |
|---|---|---|---|---|---|---|
| stagnant-lid | 25% | 5% | 0% | 0% | 35% | 20% |
| mobile-lid | 20% | 12% | 15% | 10% | 5% | 8% |
| heat-pipe | 5% | 20% | 0% | 0% | 50% | 5% |
| plutonic | 30% | 2% | 0% | 0% | 0% | 40% |
| episodic | 15% | 8% | 5% | 3% | 40% | 15% |

### 4.4 Zone Spatial Layout

Each regime has a characteristic spatial pattern for zone centers:
- **stagnant-lid**: large contiguous cratons, point-source hotspot clusters near equator
- **mobile-lid**: sublinear fold belts at convergent margins, rifts at divergent margins, arc chains near trenches
- **heat-pipe**: flood basalt covers 60%+ of surface, hotspots cluster at flux zones
- **plutonic**: ancient cratered highland dominant, impact basins at random
- **episodic**: patchwork of flood basalt over old cratered terrain

---

## Part V: Morphic Terrain System

### 5.1 Zone-Specific Terrain Generators

Each zone role gets its own terrain function signature in the shader. Currently all zones use the same FBM machinery with a height bias. Instead, give each zone a distinct **morphological signature**:

```glsl
// Zone terrain morphology table
// Each entry: [fbmAmp, fbmFreq, ridgeWeight, sharpness, style]
// style: 0=smooth plain, 1=rolling hills, 2=sharp ridge, 3=dome, 4=flat+cliff, 5=random pits

CRATON:          amp=0.08, freq=1.2, ridge=0.1, sharp=0.2, style=1  // gently rolling ancient plain
RIFT:            amp=0.35, freq=2.5, ridge=0.6, sharp=0.8, style=4  // stepped fault scarps, flat valley floor
SHIELD:          amp=0.12, freq=1.0, ridge=0.2, sharp=0.3, style=1  // sloped erosion surfaces
FOLD_BELT:       amp=0.55, freq=3.5, ridge=0.9, sharp=0.9, style=2  // tight ridges and valleys
PASSIVE_MARGIN:  amp=0.10, freq=1.8, ridge=0.1, sharp=0.2, style=0  // smooth coastal plain
HOTSPOT:         amp=0.45, freq=2.0, ridge=0.0, sharp=0.4, style=3  // shield volcano dome
ARC:             amp=0.60, freq=4.0, ridge=0.8, sharp=0.85, style=2 // stratovolcano peaks
FLOOD_BASALT:    amp=0.03, freq=0.8, ridge=0.0, sharp=0.1, style=0  // near-perfectly flat
CALDERA:         amp=0.55, freq=1.5, ridge=0.0, sharp=0.7, style=4  // depression + rim
SHELF:           amp=0.04, freq=2.0, ridge=0.0, sharp=0.15, style=0 // flat carbonate platform
RIDGE:           amp=0.25, freq=2.5, ridge=0.7, sharp=0.6, style=2  // ridge spine
TRENCH:          amp=0.08, freq=1.5, ridge=0.2, sharp=0.5, style=4  // flat floor + steep walls
ABYSSAL:         amp=0.06, freq=1.2, ridge=0.1, sharp=0.1, style=0  // featureless flat
SEAMOUNT:        amp=0.50, freq=1.8, ridge=0.0, sharp=0.5, style=3  // isolated dome
IMPACT_BASIN:    amp=0.40, freq=0.8, ridge=0.4, sharp=0.6, style=4  // circular depression + rim
IMPACT_HIGHLANDS: amp=0.20, freq=3.5, ridge=0.3, sharp=0.5, style=5 // pitted old terrain
EJECTA_BLANKET:  amp=0.28, freq=2.8, ridge=0.5, sharp=0.7, style=5  // radial ray terrain
CRYOVOLCANIC:    amp=0.30, freq=2.2, ridge=0.3, sharp=0.5, style=3  // cryodome eruption mounds
SALT_FLAT:       amp=0.01, freq=0.5, ridge=0.0, sharp=0.05, style=0 // perfectly flat
GLACIAL:         amp=0.15, freq=1.5, ridge=0.2, sharp=0.3, style=1  // smooth ice-filled terrain
```

### 5.2 Global Terrain Events (WorldPhysics → Terrain)

Beyond zone-local morphology, certain physical events create **planet-wide terrain signatures** that override zones locally:

**Large Impact Basins (impactHistory > 0.4)**
- 1-3 basins > 1000km across (like Hellas, Mare Imbrium)
- Generated from seed: latitude/longitude of basin center, radius, depth
- Terrain inside basin: IMPACT_BASIN morphology regardless of zone role
- Antipodal chaotic terrain from seismic focusing

```glsl
// In terrainHeight(): apply impact basin depressions
for each largeBrain in uImpactBasins[4]:  // max 4 large basins
  float basinDist = angularDist(pos, basinCenter);
  if(basinDist < basinRadius):
    float basinDepth = smoothstep(basinRadius, 0.0, basinDist) * 0.35;
    h -= basinDepth;  // deepens by up to 0.35
    // Rim: raised ring at basin edge
    float rimFactor = smoothstep(basinRadius*0.85, basinRadius, basinDist)
                    * (1.0 - smoothstep(basinRadius, basinRadius*1.15, basinDist));
    h += rimFactor * 0.12;
```

**Hemispheric Crustal Dichotomy (crustDichotomy > 0.5)**
Mars-analog: one hemisphere old cratered highlands, other hemisphere young volcanic lowlands.
- `uHemisphereLow`: Y-axis direction of lowland hemisphere (random from seed)
- Smooth transition over 20-30° band

**Global Rift System (tectonicRegime == 'mobile-lid')**
Linear rift valleys tracing plate boundaries. Implemented as procedural great-circle arcs:
- 2-4 major rift lines, width ±3°, depth bias −0.15
- Overrides local zone elevation along rift corridors

**Polar Glacial Compression Ridges (isIce && iceCaps > 0.6)**
Ice sheet pressure creates radial compression ridges near ice line:
```glsl
float iceRidge = sin(atan2(pos.x, pos.z) * 12.0 + uSeed * 7.3) * 0.5 + 0.5;
float iceRidgeStr = exp(-pow((absLat - iceLine) / 0.04, 2.0));
h += iceRidge * 0.06 * iceRidgeStr;
```

---

## Part VI: Atmosphere Chemistry Redesign

### 6.1 AtmChemistry Enum

```typescript
type AtmChemistry =
  | 'vacuum'       // no atmosphere
  | 'N2-O2'        // Earth — blue Rayleigh, neutral haze
  | 'CO2'          // Mars/Venus — red-pink or dense orange
  | 'SO2-H2SO4'    // Venus extreme — yellow-orange sulfuric
  | 'CH4'          // Titan — orange hydrocarbon haze
  | 'N2-CH4'       // Titan-analog cool nitrogen + methane
  | 'H2-He'        // Gas giant top, reducing primordial
  | 'NH3'          // Cold giant — ammonia cirrus
  | 'H2O-vapor'    // Steam world — white dense haze
  | 'H2S-SO2'      // Volcanic — yellow-brown sulfurous
  | 'HCl'          // Acid world — greenish haze
  | 'CO'           // Carbon world — grey reducing
  | 'O3-UV'        // Ozone-rich — unusual deep UV absorption
;
```

### 6.2 Chemistry → Sky Color Mapping

```typescript
const ATM_COLORS: Record<AtmChemistry, [number, number, number]> = {
  'vacuum':      [0.00, 0.00, 0.00],
  'N2-O2':       [0.28, 0.50, 0.95],   // blue sky
  'CO2':         [0.68, 0.42, 0.28],   // salmon-pink (thin CO2) or orange (thick)
  'SO2-H2SO4':   [0.88, 0.72, 0.22],   // sulfuric yellow
  'CH4':         [0.62, 0.38, 0.12],   // Titan orange
  'N2-CH4':      [0.52, 0.30, 0.10],   // cool orange-brown
  'H2-He':       [0.38, 0.44, 0.58],   // pale blue-grey
  'NH3':         [0.58, 0.60, 0.72],   // pale ammonia-grey
  'H2O-vapor':   [0.78, 0.82, 0.88],   // near-white steam
  'H2S-SO2':     [0.62, 0.56, 0.14],   // yellow-brown sulfurous
  'HCl':         [0.42, 0.58, 0.22],   // acid green
  'CO':          [0.28, 0.26, 0.24],   // reducing grey
  'O3-UV':       [0.12, 0.22, 0.62],   // deep blue-violet
};
```

### 6.3 Stellar Spectral Class → Rayleigh Scattering Tint

The atmosphere color is multiplied by a stellar-class correction:

```typescript
const STELLAR_SCATTER_TINT: Record<string, [number, number, number]> = {
  'O': [0.88, 0.90, 1.00],  // extreme UV → deep violet-blue
  'B': [0.90, 0.92, 1.00],  // very blue-white sky
  'A': [0.95, 0.96, 1.00],  // slightly enhanced blue
  'F': [0.98, 0.99, 1.00],  // near-solar, slightly warm
  'G': [1.00, 1.00, 1.00],  // reference (Sol)
  'K': [1.08, 0.96, 0.88],  // warmer sky, orange-shifted at horizon
  'M': [1.18, 0.88, 0.72],  // red-heavy, very warm sunsets
};
```

This is applied in `derive.ts` as: `vis.atmColor = hadamard(ATM_COLORS[chemistry], STELLAR_SCATTER_TINT[starClass])`

---

## Part VII: WorldVisuals Interface v2

Expanding the interface to support all new world types and physical outputs:

```typescript
export interface WorldVisuals {
  // === EXISTING (unchanged) ===
  color1: [number, number, number];
  color2: [number, number, number];
  color3: [number, number, number];
  oceanColor: [number, number, number];
  oceanLevel: number;
  atmColor: [number, number, number];
  atmThickness: number;
  emissive: number;
  iceCaps: number;
  clouds: number;
  noiseScale: number;
  craterDensity?: number;
  crackIntensity?: number;
  mountainHeight?: number;
  valleyDepth?: number;
  volcanism?: number;
  isIce?: boolean;
  terrainAge?: number;
  tectonicsLevel?: number;
  hasRings?: boolean;

  // === NEW: Physical parameters for zone/terrain driving ===
  tectonicRegime?: TectonicRegime;
  atmChemistry?: AtmChemistry;
  impactHistory?: number;       // 0-1 — sets IMPACT_BASIN and HIGHLANDS zone count
  crustalDichotomy?: number;    // 0-1 — drives hemispheric terrain height split
  foliageDensity?: number;      // 0-1 — jungle=1, desert=0
  oceanChemistry?: OceanChemistry; // water/methane/SO4/brine — drives ocean color system
  bioluminescence?: number;     // 0-1 — night side glow on ocean
  magneticField?: number;       // 0-1 — affects aurora rendering
  axisTilt?: number;            // degrees — needed for hadley cell placement

  // === NEW: Derived physics (written by derive.ts, read by shader) ===
  iceLine?: number;             // sin(lat) of ice boundary [0,1]
  iceLineBlur?: number;         // width of ice/no-ice transition
  hadleyWidth?: number;         // sin(lat) width of ITCZ
  snowLine?: number;            // altitude h above which snow appears

  // === NEW: Impact event positions ===
  // Uniform-packed: [centerX, centerY, centerZ, radius] for up to 4 large basins
  impactBasins?: [number, number, number, number][];
}
```

---

## Part VIII: Renderer Pipeline Integration

### 8.1 Shader Uniform Additions

New uniforms needed in `solid.frag.ts`:

```glsl
uniform float uTectonicRegime;    // 0=stagnant, 1=mobile, 2=heat-pipe, 3=plutonic, 4=episodic
uniform float uImpactHistory;     // 0-1 (zone count for IMPACT_BASIN already in uZoneRoles)
uniform float uCrustalDichotomy;  // 0-1 — hemispheric height split
uniform float uIceLine;           // sin(lat) of ice boundary
uniform float uIceLineBlur;       // width of ice transition
uniform float uHadleyWidth;       // sin(lat) ITCZ half-width (feeds circMask)
uniform float uFoliageDensity;    // 0-1 — foliage coverage
uniform float uBioluminescence;   // 0-1 — ocean night glow
uniform vec4  uImpactBasins[4];   // xyz=center, w=radius for large impact basins
```

### 8.2 Updated circMask (clouds.ts)

The atmospheric circulation mask must use `uHadleyWidth` and `uStormBeltLat` instead of hardcoded latitudes:

```glsl
float circMask(float lat) {
  float itcz   = exp(-pow(lat / uHadleyWidth, 2.0));  // driven by rotation rate
  float subDry = 1.0 - exp(-pow((abs(lat) - uHadleyWidth*2.6) / 0.13, 2.0));
  float mid    = exp(-pow((abs(lat) - uStormLat) / 0.16, 2.0)) * 0.65;
  float polar  = exp(-pow((abs(lat) - 0.90) / 0.14, 2.0)) * 0.30;
  return clamp((itcz * 0.80 + mid + polar + 0.12) * subDry, 0.0, 1.0);
}
```

### 8.3 Impact Basin Terrain Integration

Inside `terrainHeight()`, apply up to 4 large impact basins:

```glsl
// Impact basin deformation — world-scale, not zone-local
for(int bi = 0; bi < 4; bi++) {
  vec3 bc = normalize(uImpactBasins[bi].xyz);
  float br = uImpactBasins[bi].w;
  if(br < 0.001) break;
  float bd = 1.0 - dot(pos, bc);  // angular distance
  // Floor: depressed by up to 0.32
  float basinFloor = smoothstep(br, 0.0, bd) * 0.32;
  // Rim: uplifted ring at basin edge
  float rimD   = abs(bd - br * 0.92);
  float basinRim = exp(-pow(rimD / (br * 0.10), 2.0)) * 0.10;
  h = h - basinFloor + basinRim;
}
```

---

## Part IX: Implementation Phases

### PHASE 1 (DONE) — Zone Boundary Blending
`solid.frag.ts` — blended role floats, `roleBlend` weight, no hard cutoffs.

### PHASE 2 — Ice Cap + Snowball Terrain Flattening
`solid.frag.ts` — `_gIsPolar` global, flatten h in `terrainHeight`, fix ice dome.

### PHASE 3 — Iceberg Ring Rewrite
`icecaps.ts` — narrow band, 3-altitude Worley parallax. Uses `uIceLine` uniform.

### PHASE 4 — WorldVisuals Interface v2
`types.ts` — add new fields. Update `ProceduralWorld.tsx` to pass new uniforms.

### PHASE 5 — Expanded derive.ts
Add `computeWorldPhysics()`. Wire axial tilt, stellar class, tectonic regime, impact history to visual outputs. Populate new WorldVisuals fields.

### PHASE 6 — Condition-Based Classifier
New `classifier.ts`. TYPE_CONDITIONS table. `resolveWorldType()` function. Replace string-literal type selection.

### PHASE 7 — Expanded Zone Roles
`zones.ts` — ZONE_ROLE additions (11-25). Update `computeZoneRoles()` to use WorldPhysics and TectonicRegime for zone count allocation.

### PHASE 8 — Morphic Terrain System
`solid.frag.ts` — add `_gTerrainAmp` and `_gTerrainStyle` globals. Zone-specific FBM parameterization per zone role. Impact basin depressions in `terrainHeight()`.

### PHASE 9 — New World Type Profiles
`profiles.ts` — add 15 new types. `derive.ts` — add AtmChemistry and OceanChemistry to genome system.

### PHASE 10 — Atmosphere Chemistry Uniforms
`atm.frag.ts` — pass `uAtmChemistry`, apply spectral class tint. `solid.frag.ts` — ocean chemistry affects ocean color directly (not just via `uOceanColor`).

### PHASE 11 — Large Impact Basins
`solid.frag.ts` (`terrainHeight`) — `uImpactBasins[4]` deformation. `ProceduralWorld.tsx` — generate basin positions from `impactHistory` + seed.

---

## Part X: Anti-Patterns (Extended)

| Anti-Pattern | Why Bad | Fix |
|---|---|---|
| Hard-coded zone role `if/else` | Polygon edges at boundaries | Blended role floats (DONE) |
| Pre-selected type string | No physical grounding | Condition-based probability |
| Hardcoded circulation latitudes | Wrong for all non-Earth rotations | `uHadleyWidth`, `uStormBeltLat` |
| `terrainHeight` same FBM for all zones | No morphic distinction | Zone-specific amp/style table |
| Fixed impact basin count | Ignores impactHistory | Seed-derived basin count from impactHistory |
| Cloud oval blobs | Sphere mesh artifact | Planet shader + domain warp (DONE) |
| Single ocean color uniform | No chemistry variation | AtmChemistry → ocean color derivation |
| `zoneChar` controls all color | No physics connection | Zone role drives color, char drives variety |
| Wide iceberg lat band | No drama, no 3D | Narrow ring at iceLine (Phase 3) |
| Profiles hand-tuned in isolation | Physically implausible | derive.ts cascade from stellar inputs |
| `foliageColor` per star only | No density control | `foliageDensity` 0-1, zone-local application |

---

## Part XI: File Change Summary

| File | Change | Phase |
|---|---|---|
| `solid.frag.ts` | Role blending | DONE |
| `solid.frag.ts` | `_gIsPolar` + terrain flatten | 2 |
| `solid.frag.ts` | `uImpactBasins` basin deformation | 11 |
| `solid.frag.ts` | `_gTerrainAmp`/`_gTerrainStyle` | 8 |
| `solid.frag.ts` | New uniforms (12 total) | 4-11 |
| `features/clouds.ts` | `uHadleyWidth` + `uStormBeltLat` driven | 10 |
| `features/icecaps.ts` | Iceberg ring rewrite | 3 |
| `types.ts` | WorldVisuals v2 interface | 4 |
| `derive.ts` | `computeWorldPhysics()` | 5 |
| `derive.ts` | AtmChemistry, TectonicRegime derivation | 5 |
| `derive.ts` | Genome expanded for new types | 9 |
| `profiles.ts` | 15+ new world type profiles | 9 |
| `zones.ts` | ZONE_ROLE extended (11-25) | 7 |
| `zones.ts` | `computeZoneRoles` — WorldPhysics input | 7 |
| `classifier.ts` | New file — TYPE_CONDITIONS table | 6 |
| `ProceduralWorld.tsx` | Pass new uniforms | 4 |
| `ProceduralWorld.tsx` | Use `resolveWorldType` | 6 |
| `atm.frag.ts` | Spectral class + AtmChemistry tint | 10 |

---

*Phase 1 (zone boundary blending) is complete as of 2026-03-17.*
*This document supersedes VITA_RENDERER_V6_PROPOSAL.md.*
