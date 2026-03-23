# Phase 0: Engaging Systems & First Flotilla

**Date:** March 2026  
**Priority:** Immediate — this is the game's first-play experience  
**Scope Refs:** [02_ASTROPHYSICAL_MODELING](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD), [03_SIMULATION_ENGINE](../00_SCOPE/03_SIMULATION_ENGINE.MD), [05_GAME_CLIENT_ROADMAP](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD), [00_GAME_MECHANICS_PROPOSAL](00_GAME_MECHANICS_PROPOSAL.md), [03_SHIP_DESIGN](03_SHIP_DESIGN.md)

---

## Overview

Before any strategy layer, trade route, or political simulation — two things must be **incredible**:

1. **Every solar system must feel like a real, complex place.** Not 6 balls on circles. A system with resonance gaps in its belts, tidally-locked eyeball worlds, binary trojan asteroids, ice dwarfs on inclined orbits, volcanic moons spraying sulfur, and a ringed super-Earth with shepherd moons.

2. **The first hours of gameplay must be gripping.** You're aboard *Astra Primis* — the first interstellar flotilla — departure Sol, ~2150. You've spent decades being built, crewed, and funded. You have sponsors with agendas, factions with ideologies, colonists in cryo, and 4.37 light-years of hard vacuum between you and Proxima Centauri. Surviving the crossing *is* the game's opening act.

---

# PART A: Engaging Solar Systems

## A1. Pre-Play World Customization

Before a campaign begins, the player configures the *universe rules* that will shape every system they encounter. This is not cosmetic — it changes the inference engine's priors.

### World Seed & Ruleset Panel

| Parameter | Default | Range | Effect |
|-----------|---------|-------|--------|
| **System Richness** | Solar Analog | Sparse / Moderate / Solar Analog / Rich / Extreme | Controls `avg_planets` multiplier (0.5× – 2.0×) |
| **Exotic World Frequency** | Moderate | Rare / Moderate / Common / Wild | Probability of eyeball worlds, carbon planets, ocean worlds, lava worlds |
| **Belt Complexity** | Realistic | Simple Rings / Realistic / Hyper-Detailed | Number of belt sub-regions, resonance gaps, shepherd objects |
| **Moon Abundance** | Solar-like | Barren / Solar-like / Moon-Rich / Jovian Everywhere | Moon count multiplier and size distribution |
| **Ice Dwarf Population** | Moderate | None / Sparse / Moderate / Kuiper-Dense | Scattered disc / Kuiper belt object count |
| **Habitable Zone Luck** | Neutral | Hostile / Neutral / Goldilocks / Life Finds a Way | HZ occupancy weighting |
| **System Age Spread** | Mixed | Young (1-3 Gyr) / Mixed / Old (8+ Gyr) / Realistic | Affects tectonics, volcanism, crater density |
| **Binary System Frequency** | Observed | None / Observed / Enhanced | Circumbinary + S-type planet generation |

**Implementation:** These become a `WorldRules` JSON config stored per campaign. The inference engine (`_infer_planets_for_star`) reads them as multipliers on `_INF_STELLAR_PRIORS` and band selection weights.

### System Preview

After setting rules, player sees a **gallery preview** — 6 randomly-selected systems generated with those rules, each rendered as a quick orrery snapshot. If you don't like the vibe, re-roll the seed or adjust sliders.

---

## A2. Exotic Planet Type Catalog

The current type system is: `sub-earth`, `rocky`, `super-earth`, `neptune-like`, `gas-giant`, `super-jupiter`. This needs major expansion.

### Extended Planet Type Taxonomy

| Type Code | Name | Mass (M⊕) | Radius (R⊕) | Visual Signature | Real Examples |
|-----------|------|-----------|-------------|------------------|---------------|
| `hot-jupiter` | Hot Jupiter | 100–3000 | 10–20 | Inflated, glowing nightside, jet streams | 51 Peg b, HD 209458b |
| `warm-neptune` | Warm Neptune | 10–50 | 3–6 | Blue-green, scattered clouds, mini-rings | GJ 436b |
| `mini-neptune` | Mini-Neptune | 5–15 | 2–4 | Thick H₂/He envelope over rock core | K2-18b, TOI-700d |
| `sub-neptune` | Sub-Neptune | 2–10 | 1.5–3.5 | Fluffy, hazy, hydrogen-rich | Kepler-11 planets |
| `super-earth` | Super-Earth | 1.5–10 | 1.2–2.0 | Rocky, thick atmosphere possible | LHS 1140b |
| `earth-like` | Earth Analog | 0.5–2.0 | 0.8–1.3 | Blue marble, continents, clouds, ice caps | Earth, Proxima b (maybe) |
| `eyeball-world` | Eyeball World | 0.5–5.0 | 0.8–1.8 | Tidally locked: day-side ocean, night-side ice, terminator ring | Proxima b (model), TRAPPIST-1e |
| `ocean-world` | Ocean World | 1–8 | 1.0–2.5 | Global ocean, no land, possible high-pressure ice mantle | TRAPPIST-1f model |
| `desert-world` | Desert World | 0.3–3.0 | 0.7–1.5 | Dune fields, thin atmosphere, polar frost | Mars (larger), Arrakis-type |
| `lava-world` | Lava World | 0.1–5.0 | 0.5–1.8 | Magma ocean, glowing surface, silicate atmosphere | CoRoT-7b, Kepler-10b |
| `carbon-planet` | Carbon Planet | 0.5–10 | 0.8–2.0 | Dark surface (graphite/diamond), tar lakes, carbon-rich atm | 55 Cancri e (debated) |
| `iron-planet` | Iron World | 0.5–5.0 | 0.5–1.2 | Mercury-like, dense, metallic shimmer, no mantle | Kepler-21b, stripped core |
| `ice-dwarf` | Ice Dwarf | 0.001–0.1 | 0.1–0.5 | Pluto-like: N₂ ice, methane frost, red/brown tholins | Pluto, Eris, Makemake |
| `hycean` | Hycean World | 2–10 | 1.5–3.0 | Hydrogen envelope over deep ocean, temperate surface | K2-18b (model) |
| `chthonian` | Chthonian Planet | 5–50 | 1.5–4.0 | Stripped gas giant core, exposed metallic mantle | WASP-12b (future) |
| `rogue-capture` | Rogue Capture | 0.5–500 | varies | Wide orbit, high eccentricity/inclination, non-coplanar | Sedna-like |
| `trojan-world` | Trojan/Co-orbital | 0.01–1.0 | 0.3–1.0 | Shares orbit at L4/L5 with a larger planet | Theoretical |
| `sub-earth` | Sub-Earth | 0.01–0.5 | 0.2–0.8 | Airless, cratered, regolith surface | Mercury, Ceres |
| `rocky` | Rocky | 0.3–2.0 | 0.7–1.2 | Differentiated, possible thin atmosphere | Mars, Venus |
| `neptune-like` | Ice Giant | 10–50 | 3–5 | Banded atmosphere, methane blue, faint rings | Neptune, Uranus |
| `gas-giant` | Gas Giant | 50–3000 | 8–15 | Banded clouds, Great Red Spot analog, ring system | Jupiter, Saturn |
| `super-jupiter` | Super-Jupiter | 3000–13000 | 10–15 | Near stellar mass, deuterium burning borderline | HR 8799 planets |

### Type Selection Logic

The inference engine selects types by orbital band + stellar properties + world rules:

```
Band + Stellar Type + Metallicity + RNG → Planet Type
                                       ↓
                      Mass/Radius sampled from type distribution
                                       ↓
                      Physical models run (composition, interior, climate, geology)
                                       ↓
                      Sub-type flags applied:
                        - Is tidally locked? → eyeball-world if in HZ
                        - Has ocean? → ocean-world if ocean_fraction > 0.9
                        - Super hot? → lava-world if T > 1500K
                        - Stripped atmosphere? → chthonian
                        - Carbon-rich star? → carbon-planet possible
```

---

## A3. Moon Classification System

Moons are currently generic `rocky` or `icy` blobs. They need personality.

### Moon Type Taxonomy

| Type | Examples | Visual | Generation Rule |
|------|----------|--------|----------------|
| **Volcanic Moon** | Io | Yellow-orange, sulfur eruptions, lava lakes | Tight orbit + gas giant tidal heating |
| **Ice Shell Moon** | Europa, Enceladus | Cracked ice surface, subsurface ocean, geysers | Mid-orbit + tidal flexing |
| **Cratered Airless** | Callisto, Moon | Grey, saturated craters, regolith | Inactive, old surface |
| **Atmosphere Moon** | Titan | Orange haze, hidden surface, hydrocarbon lakes | Large mass + cold + volatile-rich |
| **Ocean Moon** | Ganymede interior | Subsurface ocean under ice + rock | Thick ice shell, internal heat |
| **Captured Irregular** | Triton, Phoebe | Retrograde orbit, high inclination, irregular shape | Captured from Kuiper belt |
| **Shepherd Moon** | Prometheus, Pandora | Tiny, embedded in ring gaps | Near ring systems |
| **Binary Moon** | Pluto-Charon | Two bodies orbiting common barycenter | Rare: tidal capture event |

### Moon Physical Models

Each moon type feeds into the Rust simulation chain:

```
Moon Type → composition_v2.rs (EOS layers)
         → interior.rs (4-layer structure)
         → geology.rs (tectonic regime, ocean under ice)
         → climate.rs (tidal heating + stellar flux)
         → atmosphere_v2.rs (if massive enough)
         → biomes.rs (exotic biomes: hydrocarbon sea, sublimation flats)
         → terrain.rs (heightmap with type-specific features)
```

---

## A4. Belt & Resonance Architecture

The current belt system generates uniform particle distributions. Real belts have **structure**: resonance gaps, family clusters, shepherd dynamics.

### Kirkwood Gap Model (per belt)

In our solar system, Jupiter's gravity creates gaps at specific mean-motion resonance ratios. Every system with a gas giant should have analogous structure.

| Resonance | Solar Ratio | Gap Location (fraction of belt) | Width |
|-----------|-----------|--------------------------------|-------|
| 4:1 | 2.06 AU | 0.15 from inner edge | narrow |
| 3:1 | 2.50 AU | 0.35 | wide |
| 5:2 | 2.82 AU | 0.50 | moderate |
| 7:3 | 2.96 AU | 0.58 | narrow |
| 2:1 | 3.28 AU | 0.80 | wide |

**Implementation:** For each belt, find the nearest gas giant. Compute resonance positions as `a_res = a_giant × (p/q)^(2/3)`. If `a_res` falls within the belt's inner/outer range, create a gap in the particle density distribution.

### Asteroid Family Clusters

Post-collision families form clumps of similar-composition asteroids:

| Family Type | Composition | Formation | Visual |
|-------------|-------------|-----------|--------|
| **Basaltic** (Vesta family) | V-type, differentiated crust | Giant impact on large body | Bright, angular fragments |
| **Carbonaceous** (Hygiea family) | C-type, primitive | Catastrophic disruption | Dark, uniform |
| **Metallic** (Psyche shards) | M-type, iron-nickel | Core fragment exposure | Metallic glint |
| **Icy** (Hilda / Kuiper) | D/P-type, organic-rich | Outer solar system origin | Red-brown |

**Implementation:** Within each belt, generate 1–4 families. Each is a cluster of 100–500 asteroids with similar SMA (±0.05 AU), eccentricity, and inclination. Families have a named parent body (largest fragment).

### Trojan Swarms

Gas giants accumulate Trojan asteroids at L4 and L5 Lagrange points:

- **Jupiter analogs:** 2 Trojan clouds (leading L4 "Greeks", trailing L5 "Trojans")
- Each cloud: 500–5,000 bodies, centered 60° ahead/behind the giant in its orbit
- Cloud spread: ±15° in longitude, ±20° in inclination

### Scattered Disc & Detached Objects

Beyond the Kuiper belt:
- **Scattered disc objects:** High eccentricity (e > 0.3), perihelion near Kuiper belt inner edge, aphelion > 100 AU
- **Detached objects:** Perihelion > 40 AU (like Sedna), possible hidden planet signature
- **Ice dwarfs:** 3–10 Pluto-class objects per system (mass 0.001–0.05 M⊕), plus 1–3 larger Eris-class bodies

---

## A5. Ring Systems (Planetary)

Not just belts between planets — individual planets should have ring systems like Saturn.

### Ring Generation Rules

| Condition | Ring Probability | Ring Mass | Ring Extent |
|-----------|-----------------|-----------|-------------|
| Gas giant, SMA > 1 AU | 80% | 10⁻⁸ – 10⁻⁴ planet mass | 1.2–3.0 Roche limit |
| Gas giant, SMA < 0.5 AU | 10% (too hot, sublimated) | minimal | narrow |
| Ice giant | 60% | thin | 1.5–2.5 Roche limit |
| Super-Earth with large moon | 5% | debris ring | narrow |
| Rocky planet | 2% | tenuous | inside Roche limit |

### Ring Sub-Structure

Each ring system is divided into:
- **Major rings** (A, B, C equivalents) — density bands with gaps between
- **Cassini-like divisions** — gaps at shepherd moon resonances
- **Ringlets** — fine structure within major rings (eccentricity + precession)
- **Shepherd moons** — 1–4 tiny moons embedded in or bounding ring gaps
- **Composition zones** — inner rings (rocky), outer rings (icy), tholin-colored sections

### Visual Implementation

```
Ring System → particle density function(r) with gap profile
           → WGSL instanced billboard shader
           → shadow casting: planet → ring, ring → planet
           → Rayleigh forward-scattering glow at ring edges
           → color gradient: inner (warm grey) → outer (blue-white ice)
```

---

## A6. Orbital Dynamics & Special Configurations

### Mean-Motion Resonances

Some planet pairs should be in resonance chains (TRAPPIST-1 has 7 planets in near-resonance):

| Chain Type | Example | Effect |
|------------|---------|--------|
| 2:1 resonance pair | Io-Europa | Tidal heating enhancement |
| 3:2 chain | TRAPPIST-1 | Orbital stability, compact packing |
| Laplace resonance | Io-Europa-Ganymede | Triple lock, extreme tidal effects |

**Implementation:** After generating planet SMAs, check for near-resonance pairs. With configurable probability, *snap* pairs into exact resonance. Flag these for gameplay as "resonance-locked" with enhanced tidal heating on inner body.

### Tidal Locking

- Planets within ~0.3 AU of M-dwarfs → tidally locked → eyeball world if in HZ
- Close-in moons → synchronous rotation → one face always toward parent
- Apply to rendering: permanent day-side/night-side thermal gradient

### Kozai-Lidov Oscillations (for binaries)

In binary star systems, planets on inclined orbits experience periodic eccentricity/inclination swaps. Flag these systems as "dynamically active" — potential for orbit evolution events during gameplay.

---

## A7. System Data Enrichment (API Output)

Each system returned by the API should carry rich structural metadata:

```json
{
  "system_id": "Proxima Centauri",
  "architecture_class": "compact-HZ",
  "resonance_chains": [{"planets": ["b", "c"], "ratio": "3:2"}],
  "tidally_locked_planets": ["b"],
  "belts": [
    {
      "belt_type": "rocky-asteroid",
      "inner_au": 0.8, "outer_au": 1.4,
      "resonance_gaps": [
        {"resonance": "3:1", "position_au": 1.05, "width_au": 0.03, "shaping_planet": "d"}
      ],
      "families": [
        {"name": "Proxima-F1", "parent_diameter_km": 280, "type": "S", "member_count": 340, "center_au": 1.12}
      ],
      "trojans": []
    }
  ],
  "planets": [
    {
      "name": "Proxima Centauri b",
      "planet_type": "eyeball-world",
      "sub_type_flags": ["tidally_locked", "terminator_habitable", "subsurface_ocean"],
      "ring_system": null,
      "moons": [
        {"name": "Proxima b I", "moon_type": "cratered-airless", "mass_earth": 0.002}
      ]
    }
  ],
  "ice_dwarfs": [
    {"name": "Proxima KBO-1", "mass_earth": 0.008, "sma_au": 25.3, "eccentricity": 0.18, "type": "ice-dwarf"}
  ],
  "system_age_gyr": 4.85,
  "metallicity_fe_h": 0.21
}
```

---

# PART B: First Flotilla — Departure from Sol, 2150

## B1. Campaign Start: The Exodus Setup

### Narrative Context

> **Year 2147.** Earth's first fusion-powered interstellar vessel — *Astra Primis* — is under construction at Earth-Luna L2. Three more colony ships are being built by rival consortia. The destination: Proxima Centauri, confirmed to host two habitable-zone worlds. Departure date: 2150. Travel time at 0.05c: 87 years. Arrival: 2237.
>
> You are the **Mission Director** — responsible for the flotilla's composition, departure configuration, and the survival of 10,000 souls across 87 years of interstellar void.

### Pre-Departure Configuration Screen

The player builds their expedition before departure:

#### 1. Choose Your Destination

Select from reachable targets within campaign parameters:

| Target | Distance (LY) | Travel Time @0.05c | @0.08c | @0.10c | Known Planets | HZ Worlds |
|--------|---------------|--------------------:|-------:|-------:|:------------:|:---------:|
| Proxima Centauri | 4.24 | 85 yr | 53 yr | 42 yr | 3 | 1–2 |
| Alpha Centauri A/B | 4.37 | 87 yr | 55 yr | 44 yr | 2 | 1 |
| Barnard's Star | 5.96 | 119 yr | 75 yr | 60 yr | 1 | 0–1 |
| Wolf 359 | 7.86 | 157 yr | 98 yr | 79 yr | 2 (inferred) | 0 |
| Lalande 21185 | 8.31 | 166 yr | 104 yr | 83 yr | 2 | 1 |
| Sirius A/B | 8.60 | 172 yr | 108 yr | 86 yr | 0 (hostile) | 0 |
| Ross 154 | 9.68 | 194 yr | 121 yr | 97 yr | 3 (inferred) | 1 |
| Epsilon Eridani | 10.48 | 210 yr | 131 yr | 105 yr | 2 | 1 |
| Tau Ceti | 11.89 | 238 yr | 149 yr | 119 yr | 5 | 2 |

HZ world data comes from the inference engine — shaped by the player's world customization rules. You're choosing a destination **before** full surveys: you see telescope data, not ground truth. The system you arrive at may surprise you.

#### 2. Build Your Flotilla

Ships are not pre-built — you assemble from available hulls, funded by sponsors:

| Hull Class | Crew Capacity | Cargo (tonnes) | Fuel Mass (tonnes) | Δv (km/s) | Build Cost |
|------------|:------------:|:--------------:|:-----------------:|:---------:|:----------:|
| **Colony Ark** | 5,000 (cryo) + 200 (awake crew) | 50,000 | 800,000 | 15,000 | ████████ |
| **Cargo Hauler** | 20 | 200,000 | 400,000 | 15,000 | █████ |
| **Fast Courier** | 10 | 500 | 50,000 | 20,000 | ███ |
| **Fuel Tanker** | 5 | 0 (fuel only) | 1,200,000 | 12,000 | ██████ |
| **Science Vessel** | 50 | 10,000 (instruments) | 200,000 | 18,000 | ████ |

**Starter flotilla (default):**
- 1× Colony Ark (*Astra Primis*) — your flagship
- 1× Cargo Hauler (*Hope's Burden*) — supplies + mining equipment
- 1× Fast Courier (*Pathfinder*) — scouting + communications relay

**Additional ships** cost political capital (see sponsors).

#### 3. Choose Your Sponsors

Sponsors fund ship construction and provide specialist personnel. Each has an agenda that shapes the colony's early politics.

| Sponsor | Contribution | Agenda | Bonus | Drawback |
|---------|-------------|--------|-------|----------|
| **UNSA** (United Nations Space Agency) | 2 ship slots, international crew | Peaceful expansion, science first | +Science: scan levels faster | Slow to militarize |
| **Sino-Pacific Consortium** | 3 ship slots, industrial crew | Resource extraction, economic growth | +Mining efficiency ×1.5 | Political tension with other factions |
| **EuroSpace** | 1 ship slot, elite engineering | Technical excellence, sustainability | +Tech level start at TL 2 | Small crew allotment |
| **CorpVenture** | 4 ship slots, corporate-backed | Profit, monopoly on trade | +Credits ×2 starting capital | Corporate governance friction |
| **Free Mars Collective** | 1 ship slot, frontier settlers | Independence, self-sufficiency | +Colony growth rate ×1.3 | Anti-authority, hard to govern |
| **New Horizons Foundation** | 0 ship slots, 500 colonists | Cultural preservation, education | +Morale resilience | No hardware contribution |

**You choose 2–4 sponsors.** Each brings crew, equipment, and expectations. Their agendas become your faction's starting politics.

#### 4. Colonist Manifest & Crew Composition

The player allocates colonist slots across specializations:

| Specialization | Effect | Recommended % |
|----------------|--------|:------------:|
| **Engineers** | Build speed, repair rate, infrastructure | 20% |
| **Scientists** | Scan quality, tech research speed, biosignature detection | 15% |
| **Miners** | Extraction rate, geological survey speed | 15% |
| **Medics** | Crew health, cryo survival rate, epidemic response | 10% |
| **Pilots** | Ship handling, shuttle operations, landing precision | 10% |
| **Agriculturalists** | Food production, biosphere management, terraforming | 10% |
| **Military** | Security, conflict resolution, EVA operations | 5% |
| **Administrators** | Colony governance, morale management, diplomatic skill | 5% |
| **Generalists** | Flexible, slower at specialties but can fill any role | 10% |

**Total colonists:** Sum of all ship cryo + awake capacities.

---

## B2. The Crossing — Interstellar Transit Gameplay

The transit is not a loading screen. It's a survival management phase spanning decades.

### Transit Timeline (87 years @0.05c to Proxima)

```
YEAR   0 ──── 5 ──── 15 ──── 30 ──── 50 ──── 70 ──── 85 ──── 87
       │      │       │       │       │       │       │       │
       │      │       │       │       │       │       │       ARRIVAL
       │      │       │       │       │       │       │
       │      │       │       │       │       │    DECELERATION
       │      │       │       │       │       │     (braking burn)
       │      │       │       │       │       │
       │      │       │       │       │    Deep space
       │      │       │       │       │    (monotony, morale decay)
       │      │       │       │       │
       │      │       │       │    Mid-flight
       │      │       │       │    (systems aging, repairs needed)
       │      │       │       │
       │      │       │    Cruise established
       │      │       │    (routine, skill training)
       │      │       │
       │      │    Solar system exit
       │      │    (last resupply impossible)
       │      │
       │    Acceleration complete
       │    (coast phase begins)
       │
    DEPARTURE from Sol
```

### Transit Events (Procedural from Seed)

Each transit decade generates 2–5 events drawn from a weighted pool:

#### Critical Events (mission-threatening)

| Event | Probability | Impact | Player Choice |
|-------|:-----------:|--------|---------------|
| **Micrometeorite Strike** | 15% per decade | Hull breach, cargo loss, cryo chamber damage | Repair (uses materials) or Seal & abandon section |
| **Reactor Malfunction** | 10% per decade | Power brownout, life support strain | Emergency repair (risk: crew injury) or Reduce power (slower speed, cold habitats) |
| **Cryo Cascade Failure** | 8% per decade | 50–500 colonists at risk of death | Wake them (uses food/air reserves) or Emergency refreeze (10% mortality) |
| **Navigation Error** | 5% per voyage | Course deviation, fuel waste | Mid-course correction (uses fuel reserves) or Accept longer transit |
| **Mutiny Attempt** | 3% per decade (rises with low morale) | Crew split, potential damage | Negotiate (morale cost) or Suppress (crew loss) or Concede demands |
| **Solar Flare / Cosmic Ray Burst** | 7% per decade | Radiation exposure, electronics damage | Shelter in place (productivity halt) or Shield (uses materials) |

#### Resource Events

| Event | Effect | Mitigation |
|-------|--------|-----------|
| **Food Production Failure** | Hydroponics bay damaged, 6-month food shortage | Rationing (morale drop) or Emergency stores (depletes reserves) |
| **Water Recycler Breakdown** | 30-day water reserve countdown | Repair with spare parts or Melt backup ice reserves |
| **Fuel Leak** | 2–5% fuel loss, deceleration budget reduced | Patch (EVA, crew risk) or Accept reduced Δv margin |
| **Life Support Degradation** | O₂ generation declining 1% per year | Replace components (uses spares) or Wake fewer colonists |

#### Opportunity Events

| Event | Effect | Choice |
|-------|--------|--------|
| **Deep Space Discovery** | Telescope detects unexpected object at destination | Redirect closer look (fuel cost) or Log and continue |
| **Crew Innovation** | Engineers develop efficiency improvement | Implement (risk: untested) or Shelve for arrival |
| **Birth Aboard** | Children born to awake crew | Allow growth (morale boost, resource cost) or Discourage |
| **Interstellar Medium Sample** | Science opportunity: analyze pristine ISM | Divert science vessel (fuel) or Deploy collector (no cost, slower data) |

### Transit Resource Management

Resources deplete over time and must be actively managed:

| Resource | Starting Pool | Consumption Rate | Failure At |
|----------|:------------:|:----------------:|:----------:|
| **Fuel (He-3)** | 100% | Accel phase: 40%, Coast: 5%, Decel: 40%, Reserve: 15% | If reserve < 5%: cannot brake fully |
| **Food Stores** | 100% | 0.5% per year (awake crew + hydroponics) | At 0%: starvation, mass casualties |
| **Spare Parts** | 100% | 1% per year (baseline wear) + event costs | At 0%: cannot repair failures |
| **Medical Supplies** | 100% | 0.3% per year + event costs | At 0%: treatable injuries become fatal |
| **Morale** | 75% | -0.5% per year (monotony) + event modifiers | Below 20%: mutiny risk accelerates |
| **Hull Integrity** | 100% | -0.1% per year + impact events | Below 30%: cascade failure risk |

### Transit Speed Setting

The player can adjust speed vs. safety trade-offs:

| Speed Profile | Velocity | Transit (Proxima) | Fuel Used | Risk |
|---------------|:--------:|:-----------------:|:---------:|:----:|
| **Conservative** | 0.04c | 106 years | 70% | Low — more Δv reserve |
| **Standard** | 0.05c | 85 years | 85% | Moderate — nominal design |
| **Aggressive** | 0.06c | 71 years | 95% | High — almost no fuel reserve |
| **Reckless** | 0.08c | 53 years | 99.5% | Extreme — any fuel leak = death |

Higher speed = shorter transit (less resource drain, fewer events) but less fuel margin for emergencies and deceleration.

---

## B3. Arrival — System Entry

### The Reveal

As deceleration begins, the destination system resolves from a point of light into reality. This is the **key cinematic moment** — the player sees their target system for the first time with full detail.

**Sequence:**
1. **Long-range scan** (Year -5): Star spectral type confirmed, planet count detected, no detail
2. **Medium-range scan** (Year -2): Planet orbits resolved, sizes estimated, belt structure visible
3. **Arrival scan** (Year 0): Full system revealed — every planet, moon, belt, ring system rendered. The world rules the player set at campaign start have generated this system. First real look at their new home.

### Arrival System State

At arrival, the system is hostile and unknown:

```
SCAN LEVEL: 0 (long-range telescope only)

What you know:          What you don't know:
─────────────           ──────────────────────
Star type               Detailed planet compositions
Planet count            Moon existence & types
Rough orbit radii       Belt resonance structure
HZ boundaries           Surface conditions
                        Mineral deposits
                        Water presence
                        Atmospheric composition
                        Habitability truth
```

Your first actions: deploy the science vessel for detailed surveys, pick an orbit to station the fleet, and begin scanning for a colony site.

### Arrival Decisions

| Decision | Options | Consequence |
|----------|---------|-------------|
| **Park orbit** | Outer system (safe, far from targets) / Inner system (risky, close to HZ planets) / Lagrange point | Determines scan speed, shuttle fuel cost |
| **First survey target** | Most promising HZ planet / Largest belt (resources) / Gas giant moons (water ice) | Sets exploration priority |
| **Wake schedule** | Wake all colonists immediately / Phase over 5 years / Keep in cryo until site confirmed | Morale vs. resource burn |
| **Beacon home** | Send signal to Sol / Maintain radio silence | Sol knows you survived (future flotillas may follow) or Save power |

---

## B4. Data Model & Implementation

### Campaign Init Schema

```sql
-- New tables for flotilla campaigns

CREATE TABLE campaign_flotilla (
    campaign_id     UUID REFERENCES campaigns(id),
    departure_year  INTEGER DEFAULT 2150,
    destination_id  TEXT NOT NULL,  -- system main_id
    arrival_year    INTEGER,
    speed_profile   TEXT DEFAULT 'standard',  -- conservative/standard/aggressive/reckless
    transit_status  TEXT DEFAULT 'configuring',  -- configuring/in_transit/arriving/arrived
    fuel_remaining  REAL DEFAULT 1.0,
    food_remaining  REAL DEFAULT 1.0,
    parts_remaining REAL DEFAULT 1.0,
    medical_remaining REAL DEFAULT 1.0,
    morale          REAL DEFAULT 0.75,
    hull_integrity  REAL DEFAULT 1.0,
    total_colonists INTEGER DEFAULT 10000,
    colonists_lost  INTEGER DEFAULT 0,
    current_year    INTEGER DEFAULT 2150,
    PRIMARY KEY (campaign_id)
);

CREATE TABLE campaign_ships (
    id              UUID PRIMARY KEY,
    campaign_id     UUID REFERENCES campaign_flotilla(campaign_id),
    ship_name       TEXT NOT NULL,
    hull_class      TEXT NOT NULL,  -- colony_ark/cargo_hauler/fast_courier/fuel_tanker/science_vessel
    crew_capacity   INTEGER,
    cargo_capacity  INTEGER,
    fuel_capacity   REAL,
    delta_v_km_s    REAL,
    status          TEXT DEFAULT 'operational',  -- operational/damaged/destroyed/detached
    sponsor_id      TEXT
);

CREATE TABLE campaign_sponsors (
    campaign_id     UUID REFERENCES campaign_flotilla(campaign_id),
    sponsor_id      TEXT NOT NULL,
    sponsor_name    TEXT NOT NULL,
    ship_slots      INTEGER,
    agenda          TEXT,
    bonus_type      TEXT,
    bonus_value     REAL,
    satisfaction    REAL DEFAULT 0.7,  -- 0-1, drops if agenda not met
    PRIMARY KEY (campaign_id, sponsor_id)
);

CREATE TABLE campaign_transit_events (
    id              SERIAL PRIMARY KEY,
    campaign_id     UUID REFERENCES campaign_flotilla(campaign_id),
    event_year      INTEGER NOT NULL,
    event_type      TEXT NOT NULL,
    severity        TEXT NOT NULL,  -- info/warning/critical
    title           TEXT NOT NULL,
    description     TEXT,
    choices         JSONB,       -- [{id, label, effects}]
    chosen          TEXT,        -- player's choice id
    resolved        BOOLEAN DEFAULT FALSE,
    effects_applied JSONB        -- actual outcomes after resolution
);

CREATE TABLE campaign_world_rules (
    campaign_id         UUID PRIMARY KEY REFERENCES campaigns(id),
    system_richness     TEXT DEFAULT 'solar_analog',
    exotic_frequency    TEXT DEFAULT 'moderate',
    belt_complexity     TEXT DEFAULT 'realistic',
    moon_abundance      TEXT DEFAULT 'solar_like',
    ice_dwarf_population TEXT DEFAULT 'moderate',
    hz_luck             TEXT DEFAULT 'neutral',
    age_spread          TEXT DEFAULT 'mixed',
    binary_frequency    TEXT DEFAULT 'observed',
    world_seed          BIGINT
);

CREATE TABLE campaign_colonist_manifest (
    campaign_id     UUID REFERENCES campaign_flotilla(campaign_id),
    specialization  TEXT NOT NULL,
    count           INTEGER NOT NULL,
    PRIMARY KEY (campaign_id, specialization)
);
```

### World Rules → Inference Engine Integration

The `WorldRules` config modifies `_infer_planets_for_star`:

```python
def _apply_world_rules(prior, rules):
    """Modify stellar priors based on campaign world rules."""
    richness_mult = {
        'sparse': 0.5, 'moderate': 0.75, 'solar_analog': 1.0,
        'rich': 1.5, 'extreme': 2.0
    }
    prior['avg_planets'] *= richness_mult.get(rules.get('system_richness', 'solar_analog'), 1.0)
    
    # Exotic frequency affects type selection weights
    exotic_mult = {
        'rare': 0.2, 'moderate': 1.0, 'common': 2.0, 'wild': 5.0
    }
    prior['exotic_weight'] = exotic_mult.get(rules.get('exotic_frequency', 'moderate'), 1.0)
    
    # Moon abundance
    moon_mult = {
        'barren': 0.2, 'solar_like': 1.0, 'moon_rich': 2.0, 'jovian_everywhere': 3.0
    }
    prior['moon_multiplier'] = moon_mult.get(rules.get('moon_abundance', 'solar_like'), 1.0)
    
    return prior
```

### Transit Event Engine

```python
class TransitEventEngine:
    """Generates and resolves transit events per decade."""
    
    EVENT_POOL = {
        'critical': [
            {'type': 'micrometeorite', 'base_prob': 0.15, 'title': 'Micrometeorite Impact'},
            {'type': 'reactor_fault', 'base_prob': 0.10, 'title': 'Reactor Malfunction'},
            {'type': 'cryo_cascade', 'base_prob': 0.08, 'title': 'Cryo Chamber Cascade'},
            {'type': 'nav_error', 'base_prob': 0.05, 'title': 'Navigation Drift Detected'},
            {'type': 'mutiny', 'base_prob': 0.03, 'title': 'Crew Unrest'},
            {'type': 'radiation_burst', 'base_prob': 0.07, 'title': 'Cosmic Ray Burst'},
        ],
        'resource': [
            {'type': 'food_failure', 'base_prob': 0.08, 'title': 'Hydroponics Failure'},
            {'type': 'water_breakdown', 'base_prob': 0.06, 'title': 'Water Recycler Breakdown'},
            {'type': 'fuel_leak', 'base_prob': 0.04, 'title': 'Fuel Leak Detected'},
            {'type': 'lifesupport_deg', 'base_prob': 0.10, 'title': 'Life Support Degradation'},
        ],
        'opportunity': [
            {'type': 'discovery', 'base_prob': 0.12, 'title': 'Deep Space Object Detected'},
            {'type': 'innovation', 'base_prob': 0.10, 'title': 'Crew Innovation'},
            {'type': 'birth', 'base_prob': 0.15, 'title': 'New Life Aboard'},
            {'type': 'ism_sample', 'base_prob': 0.08, 'title': 'Interstellar Medium Sample'},
        ]
    }
    
    def generate_decade(self, campaign, decade_num, rng):
        """Generate 2-5 events for a transit decade."""
        events = []
        morale_modifier = 1.0 + (0.75 - campaign.morale)  # low morale = more bad events
        
        for category, pool in self.EVENT_POOL.items():
            for event_def in pool:
                prob = event_def['base_prob']
                if category == 'critical':
                    prob *= morale_modifier
                if rng.random() < prob:
                    events.append(self._create_event(event_def, campaign, decade_num, rng))
        
        # Ensure 2-5 events per decade
        if len(events) < 2:
            forced = rng.sample(self.EVENT_POOL['opportunity'], 2 - len(events))
            for f in forced:
                events.append(self._create_event(f, campaign, decade_num, rng))
        
        return events[:5]
```

---

## B5. Desktop Client UI Components

### Pre-Departure Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  EXODUS CONFIGURATION — Humanity's First Interstellar Mission   │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│   DESTINATION        │   3D STAR MAP                            │
│   ─────────────      │   (nearby stars with reachability arcs)  │
│   ● Proxima [85yr]   │                                          │
│   ○ α Cen   [87yr]   │              ★ Sol                       │
│   ○ Barnard [119yr]  │            / | \                         │
│   ○ Wolf    [157yr]  │          /   |   \                       │
│   ○ Lalande [166yr]  │        ★     ★     ★                     │
│                      │                                          │
├──────────────────────┤                                          │
│                      │   [System Preview Panel]                 │
│   WORLD RULES        │   Planet count: 7 (2 in HZ)             │
│   ─────────────      │   Belts: 3 (rocky, Kuiper, scattered)   │
│   Richness: ████░    │   Moons: 23 total                       │
│   Exotic:   ██░░░    │   Ice dwarfs: 5                         │
│   Belts:    ███░░    │   [Mini orrery preview]                  │
│   Moons:    ███░░    │                                          │
│                      │                                          │
├──────────────────────┼──────────────────────────────────────────┤
│                      │                                          │
│   FLOTILLA           │   SPONSORS & CREW                        │
│   ─────────────      │   ─────────────                          │
│   Astra Primis [ARK] │   ☐ UNSA (2 slots)                      │
│   Hope's Burden [CRG]│   ☑ EuroSpace (1 slot)                  │
│   Pathfinder [COU]   │   ☑ CorpVenture (4 slots)               │
│   + Add Ship         │   ☐ Free Mars (1 slot)                   │
│                      │                                          │
│   Speed: Standard ▼  │   Crew Mix: [allocation bars]            │
│   Transit: 85 years  │   Engineers ████████░░ 20%               │
│   Fuel margin: 15%   │   Scientists ██████░░░ 15%              │
│                      │   Miners ██████░░░░ 15%                  │
│                      │                                          │
├──────────────────────┴──────────────────────────────────────────┤
│                    [ LAUNCH EXPEDITION ]                         │
└─────────────────────────────────────────────────────────────────┘
```

### Transit Screen Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERSTELLAR TRANSIT — Year 2178 (28 years en route)          │
│  ═══════════════════●═══════════════════════════════◎           │
│  Sol              ↑                            Proxima          │
│                 YOU ARE HERE                                     │
│              0.33 LY traveled | 3.91 LY remaining               │
├─────────────────────────────────────┬───────────────────────────┤
│                                     │                           │
│   EVENT CARD                        │   RESOURCES               │
│   ┌─────────────────────────────┐   │   ─────────               │
│   │  ⚠ MICROMETEORITE IMPACT   │   │   Fuel     ████████░░ 78% │
│   │                             │   │   Food     █████████░ 88% │
│   │  A cluster of particles     │   │   Parts    ███████░░░ 71% │
│   │  has punctured Cargo Bay 3  │   │   Medical  █████████░ 92% │
│   │  on Hope's Burden.          │   │   Morale   ██████░░░░ 62% │
│   │  12 tonnes of supplies      │   │   Hull     █████████░ 94% │
│   │  are venting to space.      │   │                           │
│   │                             │   ├───────────────────────────┤
│   │  [Repair: -5% parts,       │   │   FLOTILLA STATUS         │
│   │   EVA risk]                 │   │   ─────────               │
│   │  [Seal & abandon section:   │   │   Astra Primis  ● OK     │
│   │   lose 12t cargo]          │   │   Hope's Burden ▲ DAMAGE  │
│   │  [Salvage what we can:      │   │   Pathfinder    ● OK     │
│   │   -3% parts, save 8t]      │   │                           │
│   └─────────────────────────────┘   │   Colonists: 9,847       │
│                                     │   Awake Crew: 195         │
│   EVENT LOG                         │   Lost: 153               │
│   [2172] Innovation: +efficiency    │                           │
│   [2165] Radiation burst: -3% hull  │   Speed: 0.05c            │
│   [2158] Birth aboard: +12 souls    │   ETA: 2237 (+59 years)   │
│                                     │                           │
├─────────────────────────────────────┴───────────────────────────┤
│  [◀ Prev Decade]  [▶ Advance Decade]   [⏩ Skip to Arrival]    │
└─────────────────────────────────────────────────────────────────┘
```

### Arrival Reveal Screen

```
┌─────────────────────────────────────────────────────────────────┐
│  ARRIVAL — Proxima Centauri System — Year 2237                  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │              [FULL 3D SYSTEM ORRERY]                       │  │
│  │                                                           │  │
│  │     ★ Proxima Centauri (M5.5V)                            │  │
│  │        ╌╌● b (eyeball-world, HZ)                          │  │
│  │           ╌╌● c (super-earth)                              │  │
│  │              ╌╌● d (neptune-like)                          │  │
│  │                 ╌╌╌╌[asteroid belt]╌╌╌╌                    │  │
│  │                     ╌╌● e (gas-giant) ◐ rings              │  │
│  │                        ╌╌● e-I (icy moon)                  │  │
│  │                        ╌╌● e-II (volcanic moon)            │  │
│  │                           ╌╌╌╌[kuiper belt]╌╌╌╌           │  │
│  │                                 ○ KBO-1 (ice dwarf)        │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ PARK ORBIT   │  │ FIRST SURVEY │  │ WAKE SCHEDULE│          │
│  │ ○ Outer      │  │ ○ Planet b   │  │ ○ Immediate  │          │
│  │ ● L4 point   │  │ ● Planet b   │  │ ○ Phased     │          │
│  │ ○ Inner      │  │ ○ Belt       │  │ ● Keep cryo  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  MISSION REPORT: 9,847 colonists survived. 153 lost en route.  │
│  Fuel remaining: 14%. Parts: 42%. Morale: 58%.                  │
│  Ship status: 2/3 operational, Hope's Burden damaged.           │
│                                                                 │
│                    [ BEGIN COLONIZATION ]                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 0A: System Richness (Backend, ~2 weeks)

| Task | LOC Est | Files |
|------|:-------:|-------|
| Expand planet type catalog (22 types) | ~300 | `app.py` inference engine |
| Moon type system (8 types) with tidal heating logic | ~200 | `app.py` moon generator |
| Belt resonance gap generation | ~250 | `app.py` belt generator |
| Asteroid family clusters | ~150 | `app.py` belt generator |
| Trojan swarm generation | ~100 | `app.py` new function |
| Ring system generation per planet | ~200 | `app.py` new function |
| Ice dwarf population in scattered disc | ~100 | `app.py` belt generator |
| Tidal locking detection | ~50 | `app.py` planet generator |
| Resonance chain detection & snapping | ~100 | `app.py` planet generator |
| WorldRules config support in inference | ~150 | `app.py` + new migration |
| API output enrichment (architecture_class, sub_type_flags) | ~100 | `app.py` API routes |

### Phase 0B: Flotilla Campaign (Backend, ~2 weeks)

| Task | LOC Est | Files |
|------|:-------:|-------|
| Database migration: flotilla tables | ~120 | `03_MIGRATIONS/007_flotilla.sql` |
| Campaign creation with world rules + flotilla config | ~300 | `app.py` or `campaigns.py` |
| Transit event engine | ~400 | `app.py` or new `transit.py` |
| Transit resource decay simulation | ~200 | `transit.py` |
| Transit event choices → effects resolution | ~250 | `transit.py` |
| Arrival sequence API (scan levels 0→1→2→3) | ~200 | `app.py` endpoints |
| Sponsor system with agenda tracking | ~150 | `campaigns.py` |

### Phase 0C: Desktop UI (Frontend, ~3 weeks)

| Task | LOC Est | Files |
|------|:-------:|-------|
| Pre-departure configuration screen | ~1200 | `ExodusSetup.tsx` |
| World rules slider panel | ~400 | `WorldRulesPanel.tsx` |
| System preview gallery (6 systems) | ~300 | `SystemPreview.tsx` |
| Flotilla builder (ship selection) | ~500 | `FlotillaBuilder.tsx` |
| Sponsor selector with agenda cards | ~400 | `SponsorSelector.tsx` |
| Crew manifest allocation | ~300 | `CrewManifest.tsx` |
| Transit screen with event cards | ~800 | `TransitScreen.tsx` |
| Transit resource gauges | ~200 | `ResourceGauges.tsx` |
| Event card modal with choices | ~400 | `EventCard.tsx` |
| Transit timeline / progress bar | ~200 | `TransitTimeline.tsx` |
| Arrival reveal cinematic | ~500 | `ArrivalReveal.tsx` |
| Arrival decision panel | ~300 | `ArrivalDecisions.tsx` |

### Phase 0D: Visual Enhancements (GPU/Shaders, ~2 weeks)

| Task | LOC Est | Files |
|------|:-------:|-------|
| Ring system renderer (WGSL instanced particles) | ~500 | `ring.wgsl` + `ring_render.rs` |
| Eyeball world shader (day/night/terminator) | ~200 | `planet.wgsl` extension |
| Lava world emissive shader | ~100 | `planet.wgsl` extension |
| Ice dwarf surface (N₂ frost + tholin coloring) | ~100 | Biome extension |
| Belt particle visualization with gap structure | ~400 | `belt_particles.wgsl` + Rust |
| Trojan swarm rendering (L4/L5 clouds) | ~200 | Particle system extension |
| Ocean world (global ocean, no land) shader | ~100 | `planet.wgsl` extension |

---

## Total Estimated Effort

| Phase | Duration | LOC |
|-------|:--------:|:---:|
| 0A: System Richness | 2 weeks | ~1,700 |
| 0B: Flotilla Campaign | 2 weeks | ~1,620 |
| 0C: Desktop UI | 3 weeks | ~5,500 |
| 0D: Visual Enhancements | 2 weeks | ~1,600 |
| **Total** | **~9 weeks** | **~10,400** |

---

## Scope Doc Updates Required

| Document | Change |
|----------|--------|
| [02_ASTROPHYSICAL_MODELING](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD) | Add 22-type planet taxonomy, moon type system, belt resonance/family model, ring system spec |
| [03_SIMULATION_ENGINE](../00_SCOPE/03_SIMULATION_ENGINE.MD) | Add transit event engine, resource decay model, sponsor/faction seeding, arrival sequence |
| [05_GAME_CLIENT_ROADMAP](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) | Add Milestone D0: Exodus Setup (pre-departure + transit + arrival) before all other milestones |
| [07_IMPLEMENTATION_PHASES](../00_SCOPE/07_IMPLEMENTATION_PHASES.MD) | Insert Phase 0 before Phase 08/09: "First Flotilla & System Richness" |
| [01_FUNCTIONALITY](../00_SCOPE/01_FUNCTIONALITY.MD) | Add F0.x feature block for pre-play config, transit gameplay, arrival sequence |
| [08_OPEN_QUESTIONS](../00_SCOPE/08_OPEN_QUESTIONS.MD) | Resolve S5 (winning = surviving transit + successful colony founding); resolve P1 (core fantasy = Explorer + Survivor) |
