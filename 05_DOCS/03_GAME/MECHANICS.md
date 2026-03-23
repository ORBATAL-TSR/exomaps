# Game Mechanics

---

## Resource System (5 Categories)

| Category | Key Materials | Primary Sources | Primary Uses |
|----------|-------------|----------------|-------------|
| Volatiles | H₂O, NH₃, CH₄, CO₂ | C-type asteroids, comets, icy moons | Life support, fuel (H₂/O₂ electrolysis) |
| Metals | Fe, Ni, Ti, Al | S-type + M-type asteroids, rocky planets | Structures, ships, machinery |
| Rare Elements | Pt, Au, rare earths | Asteroid belts, geological deposits | Advanced electronics, instruments |
| Silicates | Quartz, feldspar, olivine | Rocky bodies, regolith | Habitat shielding, ceramics, glass |
| Carbon Compounds | Graphene, polymers, organics | C-type asteroids, cometary nuclei | Lightweight composites, manufacturing |

### Asteroid Composition (NASA-grounded)

| Spectral Class | Composition | Key Resources | ~Population |
|---------------|-----------|--------------|------------|
| C-type | Hydrated minerals, organic carbon, phosphorus | Volatiles, Carbon | 75% |
| S-type | Iron/nickel/cobalt; ~50 kg rare metals per 10m body | Metals, Rare Elements | 17% |
| M-type | Near-pure iron-nickel alloy | Metals (high grade) | 8% |

### Production Chains

```
ICE MINING         → ELECTROLYSIS   → H₂ + O₂     → FUEL / WATER
REGOLITH MINING    → SMELTER        → Fe / Ni      → CONSTRUCTION STEEL
CARBONACEOUS ORE   → CHEMICAL PLANT → POLYMERS     → HABITAT MODULES
SILICATE EXTRACT.  → KILN           → CERAMICS/GLASS → SHIELDING
RARE ORE           → REFINERY       → ELEC. METALS → HIGH-TECH COMPONENTS
```

---

## Power Sources

| Source | Fuel | Era | Output |
|--------|------|-----|--------|
| Fission | Uranium | Early | Medium |
| Solar | Sunlight | Always | Variable (distance-dependent) |
| Fusion | He-3, Deuterium | Mid | High |
| Antimatter | Manufactured | Late | Very High |

---

## Ship Design

### Module Types

| Module | Function | Primary Cost |
|--------|----------|-------------|
| Propulsion unit | Engine + fuel management | Metals, Rare Elements |
| Fuel tank | Propellant storage | Metals, Volatiles |
| Habitat module | Living quarters, life support | Metals, Silicates, Carbon |
| Cargo bay | General / pressurized / cryogenic | Metals |
| Hydroponics | Food production (generation ships) | Carbon, Volatiles |
| Mining rig | Asteroid drilling + collection | Metals, Rare Elements |
| Construction arm | Assembly, welding, repair | Metals |
| Reactor | Fission / fusion power | Metals, Rare Elements |
| Lab module | Research capability | Rare Elements, Silicates |
| Defense system | Point defense, ECM, armor | Metals, Rare Elements |

### Propulsion Types

| Type | Thrust | Isp | Mass | Era |
|------|--------|-----|------|-----|
| Nuclear Pulse | High | Low | Heavy | Early |
| Fusion Drive | Medium | Medium | Medium | Mid |
| Beamed Sail | Low (accel phase) | Very High | Very Low | Mid |
| Antimatter | Very High | Very High | Low | Late |
| Hybrid | Configurable | Configurable | Variable | Mid-Late |

### Fleet Classes

| Class | Velocity | Capacity | Role |
|-------|---------|---------|------|
| Colony Ship | 0.05c | 10,000 colonists | Founding outposts |
| Industrial Vessel | 0.05c | Heavy equipment | Construction |
| Cargo Hauler | 0.08c | 50,000 tonnes | Freight |
| Tanker | 0.08c | Fuel/volatiles | Refueling |
| Fast Courier | 0.10c | 100 tonnes | Messages, high-value cargo |
| Patrol Vessel | 0.10c | Military crew | Security, interdiction |
| Survey Probe | 0.15c | Instruments | Advance scouting |

---

## Colony & Infrastructure

### Development Track
```
Orbital Station → Robotic Outpost → Pressurized Habitat → Terraform → Biosphere
```

Habitats in VITA: rendered as `HabitatStation` + `HabitatOrbitRing` (ring + rotating cylinder).

### Terraforming Projects

| Project | Duration | Resources | Effect |
|---------|---------|---------|--------|
| Atmosphere modification | 100–500 yr | Extreme Volatiles + Carbon | Pressure/composition |
| Ocean seeding | 200–800 yr | Extreme Volatiles | Water cycle |
| Magnetic field generator | 50–200 yr | Extreme Metals + Rare Elements | Radiation shield |
| Biosphere seeding | 300–1000 yr | Carbon + Volatiles | Self-sustaining ecology |

Difficulty: `f(atmosphere_gap, mass_deviation, temperature_delta, radiation_level)`

---

## Conflict & Diplomacy

### Conflict Types

| Type | Mechanism | Impact | Counter |
|------|-----------|--------|---------|
| Blockade | Fleet at approach vectors | Trade disruption, starvation | Escort fleet, alt routes |
| Sabotage | Covert ops vs. infrastructure | Production loss, repair cost | Security, redundancy |
| Hacking | Electronic warfare vs. stations | Temp control loss, data theft | ECM, encryption |
| Trade Lane Control | Patrol vessels on routes | Freight interdiction | Convoy escorts |
| Espionage | Intel ops | Tech gain/loss, cohesion damage | Counter-intelligence |

---

## NPC Characters

### Trait System

| Trait | Range | Effect |
|-------|-------|--------|
| Leadership | 0–1 | Crew morale, mission success probability |
| Greed | 0–1 | Corruption risk, trade efficiency |
| Expertise | 0–1 | Research speed, problem-solving |
| Charisma | 0–1 | Diplomatic outcomes, faction loyalty |
| Resilience | 0–1 | Crisis survival, adaptation |

### Procedural Events (sample)
Equipment failure · Asteroid impact · Disease outbreak · Revolutionary movement ·
Scientific breakthrough · Mutiny · First contact (microbial) · Supply chain disruption ·
Cultural renaissance · Diplomatic incident · Magnetic storm · Rogue faction split
