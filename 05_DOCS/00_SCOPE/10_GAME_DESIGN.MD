# 10 — Game Design Document

## Overview

This document consolidates the game design elements introduced in the March 2026 scope expansion. It covers the core gameplay loop, game phases, sponsors, contractors, resource systems, ship design, conflict, terraforming, victory conditions, and narrative systems.

**Source:** ExoMaps — Interstellar Colonization Strategy Game design document (March 2026)

---

## Core Concept

ExoMaps is a science-grounded interstellar colonization strategy game in which players design, launch and manage slower-than-light expeditions to star systems within **100 parsecs** of the Sun. The game uses real astronomical datasets for stars and confirmed exoplanets, adds inferred planets where observations are missing, and layers a hard-science simulation of orbital industry, resource extraction, colony development and interstellar economics.

Key differentiators:
- **Real data**: 6,000+ confirmed exoplanets, 8,000+ candidates.
- **No FTL**: Travel times of 20–200 years; generation ships for long voyages.
- **Space-first**: Orbital infrastructure before planetary settlement.
- **AI-managed**: Players set policy; AI governors execute locally.
- **Emergent narrative**: Stories arise from simulation, not scripts.

---

## Core Gameplay Loop

The game operates at multiple scales simultaneously:

```
1. DESIGN & LAUNCH
   Choose sponsor, contractor, research priorities, ship modules.
   Assemble flotilla → launch toward target star (decades/centuries).
        ↓
2. ARRIVAL & SURVEY
   System surveys, resource recon, probe deployment.
   Select orbits for stations.
        ↓
3. SPACE-FIRST INDUSTRY
   Orbital stations, asteroid mining, fuel depots, refineries.
   Water electrolysis → fuel. Metal smelting → construction.
        ↓
4. PLANETARY DEVELOPMENT
   Once orbital industry is stable: robotic outposts → habitats → terraforming.
   Reverse of typical colony games.
        ↓
5. INTERSTELLAR EXPANSION
   Manage trade routes, diplomatic relations, macro strategies.
   AI governors run local systems; players set policy.
        ↓
6. EMERGE & EVOLVE
   New factions arrive. Diplomacy, trade, conflict.
   Player choices and emergent interactions drive the story.
```

These loops operate concurrently at different timescales.

---

## Game Phases (Detailed)

### Phase 1: Sponsor and Expedition Creation
- Define mission's ideological framing (choose sponsor)
- Select prime contractor (ship design philosophy)
- Allocate resources to research, colonists, cargo, fuel
- Optional: negotiate with sponsors and contractors for funding and tech
- **Timescale:** Pre-launch (player time)

### Phase 2: Interstellar Transit
- Fleet enters cryogenic or generational travel
- Player cannot micromanage; prepares contingencies
- Schedule wake-ups for mid-course corrections or emergencies
- Communications with home have multi-year delays
- **Timescale:** Decades to centuries (game time); compressed for player

### Phase 3: System Arrival and Scouting
- Player control resumes upon arrival
- Autonomous probes chart orbits, surface composition, gravitational hazards
- Player chooses where to anchor initial station
- **Timescale:** Months to years (game time)

### Phase 4: Orbital Infrastructure
- Space stations, factories, refineries, power plants
- Resource transport lines
- Micro-management of supply chains, labour allocation, station modules
- **Timescale:** Years to decades (game time)

### Phase 5: Colonization
- Transition from orbital to planetary outposts
- Surface habitats, resource pipelines, landings
- Long-term terraforming projects
- Colonists need life support, gravity solutions, environmental control
- **Timescale:** Decades to centuries (game time)

### Phase 6: Interstellar Phase
- Map zooms out to multiple systems
- Dispatch new expeditions, coordinate trade
- Research interstellar propulsion upgrades
- Handle diplomacy with AI or human factions
- Grand strategy emerges
- **Timescale:** Centuries (game time)

### Phase 7: End Game / Victory
- Pursue one or more victory conditions
- Custom goals also available
- **Timescale:** Variable

---

## Sponsors

Sponsors define ideology, objectives and bonuses for the expedition.

| Sponsor | Description | Strength | Weakness |
|---------|------------|----------|----------|
| **Government Program** | National space agency; scientific mandate | Large budgets, political backing | Bureaucratic; slower decision cycles |
| **Corporate Syndicate** | Mega-corporation seeking profits and influence | Efficient logistics, advanced tech | Profit pressure; potential ethical issues |
| **Scientific Coalition** | Universities and research institutes | Discovery bonuses, tech progression | Limited funding; weak military |
| **Frontier Cooperative** | Grass-roots settlement movement | Autonomy, adaptability, morale | Less technology; vulnerable to competition |
| **Religious Pilgrimage** | Faith-based group seeking new promised worlds | High cohesion, cultural unity | Ideological rigidity; diplomatic tension |
| **Breakaway Colony** | Dissident group leaving a parent civilization | Self-reliance, motivation | Political isolation; limited resources |

### Sponsor Effects (Design TBD — see Open Question P6)
- Starting budget multiplier
- Research focus bonuses/penalties
- Diplomatic stance modifiers
- Population morale baseline
- Event probability weights

---

## Prime Contractors

Aerospace contractors manufacture the expedition fleet. Their design philosophies influence ship modules, costs and reliability.

| Contractor | Design Philosophy | Strengths | Weaknesses |
|-----------|------------------|-----------|------------|
| **NuSpace** | Commercial, sleek designs | Efficient logistics, low mass | More fragile, lower durability |
| **Tronicon** | Heavy industrial engineering | Durable, modular, repairable | Expensive, heavy |
| **Kosmik** | Retro space-race designs | Reliable, simple, proven tech | Mass inefficient, limited innovation |
| **Globulo** | Inflatable habitats, large volumes | Fast colony growth, large crew capacity | Limited heavy industry capability |

### Contractor Effects (Design TBD — see Open Question P8)
- Module cost multipliers
- Hull durability ratings
- Maintenance frequency modifiers
- Module compatibility constraints
- Special module availability

---

## Resource System

### 5 Resource Categories

| Category | Key Materials | Primary Sources | Primary Uses |
|----------|-------------|----------------|-------------|
| **Volatiles** | H₂O, NH₃, CH₄, CO₂ | C-type asteroids, comets, icy moons | Life support, agriculture, fuel (H₂/O₂ electrolysis) |
| **Metals** | Fe, Ni, Ti, Al | S-type asteroids, M-type asteroids, rocky planets | Structures, ships, machinery |
| **Rare Elements** | Pt, Au, rare earths | Asteroid belts, special geological deposits | Advanced electronics, precision instruments |
| **Silicates** | Quartz, feldspar, olivine | Rocky bodies, regolith, inner belt | Habitat shielding, ceramics, glass |
| **Carbon Compounds** | Graphene, polymers, organics | C-type asteroids, cometary nuclei | Lightweight composites, high-tech manufacturing |

### Asteroid Composition (NASA-Grounded)

| Spectral Class | Composition | Key Resources | Population |
|---------------|-----------|---------------|-----------|
| **C-type** | Water bound in hydrated minerals, organic carbon, phosphorus | Volatiles, Carbon Compounds | ~75% of asteroids |
| **S-type** | Iron, nickel, cobalt; ~50 kg rare metals per 10m body | Metals, Rare Elements | ~17% of asteroids |
| **M-type** | Nearly pure iron-nickel alloy | Metals (high grade) | ~8% of asteroids |

*A small 10-meter S-type asteroid can contain ~650,000 kg of metal with ~50 kg of rare metals like platinum and gold.*

### Production Chains

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ ICE MINING  │───→│ ELECTROLYSIS │───→│ HYDROGEN + O₂   │───→│ FUEL / WATER │
└─────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘

┌──────────────┐    ┌─────────┐    ┌──────────────┐    ┌────────────────────┐
│ REGOLITH     │───→│ SMELTER │───→│ IRON / NICKEL│───→│ CONSTRUCTION STEEL │
│ MINING       │    └─────────┘    └──────────────┘    └────────────────────┘
└──────────────┘

┌──────────────┐    ┌───────────────┐    ┌──────────┐    ┌─────────────────┐
│ CARBONACEOUS │───→│ CHEMICAL PLANT│───→│ POLYMERS │───→│ HABITAT MODULES │
│ ORE          │    └───────────────┘    └──────────┘    └─────────────────┘
└──────────────┘

┌──────────────┐    ┌──────┐    ┌─────────────────┐    ┌──────────┐
│ SILICATE     │───→│ KILN │───→│ CERAMICS / GLASS│───→│ SHIELDING│
│ EXTRACTION   │    └──────┘    └─────────────────┘    └──────────┘
└──────────────┘

┌──────────────┐    ┌──────────┐    ┌───────────────────┐    ┌──────────────┐
│ RARE ORE     │───→│ REFINERY │───→│ ELECTRONICS-GRADE │───→│ HIGH-TECH    │
│              │    └──────────┘    │ METALS            │    │ COMPONENTS   │
└──────────────┘                   └───────────────────┘    └──────────────┘
```

Each chain requires infrastructure (mines, processors, factories) and **power**.

### Power Sources

| Source | Fuel | Game Era | Output | Notes |
|--------|------|----------|--------|-------|
| Fission | Uranium | Early | Medium | Proven, fuel must be mined |
| Fusion | He-3, Deuterium | Mid | High | Requires tech unlock |
| Solar | Sunlight | Always | Variable | Proximity to star matters |
| Antimatter | Manufactured | Late | Very High | Requires factory chain; very expensive |

### Infrastructure Maintenance
- All structures degrade over time
- Require spare parts (consuming Metals + Carbon Compounds)
- Maintenance cycles must be scheduled
- Neglect → cascading failure events
- Redundancy planning is strategic choice

---

## Ship Design

### Ship Modules
Ships are assembled from standardized modules:

| Module Type | Function | Primary Resource Cost |
|------------|----------|---------------------|
| Propulsion unit | Engine + fuel management | Metals, Rare Elements |
| Fuel tank | Propellant storage | Metals, Volatiles |
| Habitat module | Living quarters, life support | Metals, Silicates, Carbon Compounds |
| Cargo bay | General/pressurized/cryogenic storage | Metals |
| Hydroponics | Food production (generation ships) | Carbon Compounds, Volatiles |
| Mining rig | Asteroid drilling + collection | Metals, Rare Elements |
| Construction arm | Assembly, welding, repair | Metals |
| Reactor | Fission/fusion power | Metals, Rare Elements |
| Lab module | Research capability | Rare Elements, Silicates |
| Defense system | Point defense, ECM, armor | Metals, Rare Elements |

### Propulsion Types

| Type | Thrust | Efficiency (Isp) | Mass | Cost | Game Era |
|------|--------|------------------|------|------|----------|
| Nuclear Pulse | High | Low | Heavy | Medium | Early |
| Fusion Drive | Medium | Medium | Medium | High | Mid |
| Beamed Sail | Low (accel) | Very High | Very Low | Very High (ground infra) | Mid |
| Antimatter | Very High | Very High | Low | Extreme | Late |
| Hybrid | Configurable | Configurable | Variable | High | Mid-Late |

### Fleet Composition

| Ship Class | Velocity | Capacity | Role |
|-----------|----------|----------|------|
| Colony Ship | 0.05c | 10,000 colonists | Founding outposts |
| Industrial Vessel | 0.05c | Heavy equipment | Construction |
| Cargo Hauler | 0.08c | 50,000 tonnes | Freight |
| Tanker | 0.08c | Fuel/volatiles | Refueling |
| Fast Courier | 0.10c | 100 tonnes | Messages, high-value |
| Patrol Vessel | 0.10c | Military | Security |
| Survey Probe | 0.15c | Instruments | Exploration |

### Generation Ships
Voyages longer than a human lifetime require generation ships:
- Closed ecosystem with agriculture, recycling, education
- Rotating sections for artificial gravity
- Multiple generations raised during transit
- Autonomous life-support maintenance
- Cultural drift may occur over long voyages

---

## Travel & Communications

### Travel Times

At typical velocities (0.05–0.10c):

| Destination | Distance | At 0.05c | At 0.10c |
|------------|----------|----------|----------|
| Proxima Centauri | 4.24 LY | ~85 years | ~42 years |
| Tau Ceti | 11.9 LY | ~238 years | ~119 years |
| 40 Eridani | 16.3 LY | ~326 years | ~163 years |
| Edge of 100 pc | ~326 LY | ~6,520 years | ~3,260 years |

At low relativistic speeds (< 20% c), time dilation is modest.

### Mission Planning Factors
- Launch windows and orbital mechanics
- Fuel caches at intermediate systems (cyclers)
- Rendezvous with comets for resource resupply
- Gravitational assists around gas giants
- Deceleration fuel reserves at destination

### Speed-of-Light Communications
- Messages travel at c. A message to a fleet 4 LY away takes 4 years.
- Player decisions during transit reach the fleet after delay.
- Reports from distant colonies arrive with delays.
- UI includes: message queue, sent timestamp, ETA, predicted response time.
- Creates strategic tension: must plan ahead, trust AI governors.

---

## Conflict Mechanics

Warfare is primarily **orbital and logistical** — not planetary armies.

| Type | Mechanism | Impact | Counter |
|------|-----------|--------|---------|
| **Blockade** | Fleet at approach/jump points | Trade disruption, starvation | Escort fleet, alternate routes |
| **Sabotage** | Covert ops vs infrastructure | Production loss, repair cost | Security investment, redundancy |
| **Hacking** | Electronic warfare vs station systems | Temp control loss, data theft | ECM, encrypted systems |
| **Trade Lane Control** | Patrol vessels on routes | Freight interdiction, piracy | Convoy escorts, route diversity |
| **Espionage** | Steal research, incite rebellion | Tech gain/loss, cohesion damage | Counter-intelligence |

### Interstellar Councils
- Factions vote on shared initiatives (large observatories, joint expeditions)
- Treaty formation: trade agreements, research pacts, non-aggression
- Embargoes affect specific trade routes
- Council decisions propagate at speed of light

---

## Terraforming

Multi-century planetary modification for non-habitable worlds.

### Difficulty Score
```
difficulty = f(atmosphere_gap, mass_deviation_from_earth, temperature_delta, radiation_level)
```

### Projects

| Project | Duration | Resources | Effect |
|---------|----------|-----------|--------|
| Atmosphere modification | 100–500 years | Extreme Volatiles + Carbon | Pressure/composition change |
| Ocean seeding | 200–800 years | Extreme Volatiles | Water cycle |
| Magnetic field generator | 50–200 years | Extreme Metals + Rare Elements | Radiation shield |
| Biosphere seeding | 300–1000 years | Carbon Compounds + Volatiles | Self-sustaining ecology |

Projects have **milestone events** with intermediate benefits:
- Early atmosphere → partial outdoor activity
- Ocean seeding 25% → local water sources
- Magnetic field → radiation reduction
- Full terraforming → open-air habitation

---

## Victory Conditions

| Victory | Condition | Scoring |
|---------|-----------|---------|
| **Expansion** | Largest interstellar network of self-sustaining systems | Systems × self-sufficiency rating |
| **Economic** | Interstellar trade dominance and wealth | GDP + trade volume + surplus |
| **Scientific** | Complete key research projects | Fusion drives + terraforming + alien life |
| **Cultural/Religious** | Spread ideology across the network | Cultural influence coverage % |
| **Utopian** | Sustainable egalitarian colonies without conflict | Peace years × equality × sustainability |

Custom goals also supported: utopian retreat, religious pilgrimage, etc.

---

## NPC Characters & Narrative

### Character System
Important characters emerge: ship captains, scientists, faction leaders.

| Trait | Range | Effect |
|-------|-------|--------|
| Leadership | 0–1 | Crew morale, mission success probability |
| Greed | 0–1 | Corruption risk, trade efficiency |
| Expertise | 0–1 | Research speed, problem-solving |
| Charisma | 0–1 | Diplomatic outcomes, faction loyalty |
| Resilience | 0–1 | Crisis survival, adaptation |

Characters provide story events: mutinies, breakthroughs, scandals, heroic sacrifices.

### Procedural Events

| Event | Trigger | Impact |
|-------|---------|--------|
| Equipment failure | Maintenance deficit, age | Production loss, repair needed |
| Asteroid impact | Random, rare | Infrastructure damage |
| Disease outbreak | Population density, hygiene | Population decline, quarantine |
| Revolutionary movement | Low cohesion, inequality | Political instability, faction split |
| Scientific breakthrough | High tech + expert NPC | Tech leap, morale boost |
| Mutiny | Bad captain + low morale | Ship/station control loss |
| First contact (microbes) | Extremely rare, late game | Paradigm shift, research bonus |
| Supply chain disruption | Extended shortage | Cascading production failures |
| Cultural renaissance | High morale + diverse population | Cultural victory progress |
| Diplomatic incident | High tension + espionage | Alliance breakdown |

---

## UI & Player Experience

### Visual Design (Multi-Scale)

| View | Content | Interaction |
|------|---------|-------------|
| **Star Map** | 3D map of 100 pc neighborhood; real coordinates; zoom in/out | Select targets, plan routes |
| **System View** | Orbits, planets, moons, belts, stations; observed vs inferred distinguished | Select objects, view resources |
| **Station/Colony View** | Management screen: labour, production queues, life support | Allocate, build, maintain |
| **Interstellar Dashboard** | Trade routes, research, diplomacy, fleet departures, message log | Strategy, policy, overview |

### Audio Design
- **Space ambience**: quiet isolation, muted engine rumbles, broadcast static
- **Station sounds**: industrial hum of machinery, life support cycling
- **Music**: evolves from hopeful exploration → ethereal transit → tense crisis
- **Adaptive**: responds to player situations and game phase

### Accessibility
- Layered complexity: basics first, advanced mechanics unlock later
- Tooltips and data overlays
- Simulation pausing at any time
- Time compression for long travel periods
- Keyboard navigation for all controls

---

## Multiplayer (Asynchronous)

- Players share the same universe
- Interactions via trade, messages, or conflict
- Communication lag (speed of light) means actions propagate gradually
- Players have time to respond
- Deterministic resolution for simultaneous actions
- Persistence required for save/resume across sessions
