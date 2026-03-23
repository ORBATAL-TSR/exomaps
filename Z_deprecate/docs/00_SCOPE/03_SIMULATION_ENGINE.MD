# 03 — Simulation Engine Plan

## Overview

The ExoMaps simulation engine models slower-than-light (SFTL) human expansion across star systems within 100 parsecs of the Sun. It is a **deterministic**, **server-side** runtime that produces identical results for the same seed and rule-set, enabling replay, what-if analysis, and multiplayer consistency.

The engine supports the **space-first colonization model** — orbital infrastructure and asteroid mining must precede planetary settlement. It also models **AI governors** for semi-autonomous local management, **speed-of-light communication delays**, and **5 resource categories** grounded in real asteroid compositions.

**Implementation:** `01_SERVICES/02_PIPELINE/04_SIMULATION/` (simulation_core.py, economy_politics.py)

---

## Architecture

### Core Loop: Hybrid Tick/Event

```
┌──────────────────────────────────────────────────┐
│                 SIMULATION TICK                    │
│                                                    │
│  1. POPULATION    Growth, carrying capacity        │
│  2. MIGRATION     Push/pull pressure, colony flow  │
│  3. EXTRACTION    Asteroid/planet mining output     │
│  4. PRODUCTION    Refining, manufacturing chains    │
│  5. TRADE         Surplus/deficit, freight routes   │
│  6. CONSTRUCTION  Station/ship/hab module assembly  │
│  7. POLITICS      Cohesion, tension, influence      │
│  8. COMMS         Message queue, light-delay sync   │
│  9. EVENTS        Discrete events from RNG queue    │
│  10. AI GOVERNOR  Local policy execution review     │
│                                                    │
│  → Snapshot checkpoint (every N ticks)              │
│  → Event log append                                │
│  → Metric emission                                 │
└──────────────────────────────────────────────────┘
```

| Component | Type | Responsibility |
|-----------|------|---------------|
| `SimulationEngine` | Class | Main runtime: tick loop, state management, lifecycle |
| `SimulationSnapshot` | Dataclass | Deterministic state checkpoint (serializable to JSON) |
| `SimulationEvent` | Dataclass | Discrete event with type, location, impact |
| `EconomyLayer` | Class | Production chains, consumption, trade, tech progression |
| `ExtractionLayer` | Class | Asteroid/planet mining, resource output by category |
| `ConstructionLayer` | Class | Module assembly, station/ship building, maintenance |
| `PoliticsLayer` | Class | Cohesion, tension, alliance, independence dynamics |
| `CommsLayer` | Class | Speed-of-light message queue, delay calculation |
| `AIGovernor` | Class | Behaviour-tree local management per system |
| `EventGenerator` | Class | Procedural event creation seeded by simulation RNG |

### Simulation States

```
IDLE → RUNNING → PAUSED → RUNNING → COMPLETED
                     ↓
                   FAILED
```

| State | Transitions | Description |
|-------|-------------|-------------|
| `IDLE` | → RUNNING | Initial state before first tick |
| `RUNNING` | → PAUSED, COMPLETED, FAILED | Actively processing ticks |
| `PAUSED` | → RUNNING | Halted, resumable |
| `COMPLETED` | (terminal) | Target tick count reached |
| `FAILED` | (terminal) | Unrecoverable error |

---

## Domain Models

### Population & Colonization

**Growth Model:**
```
P(t+1) = P(t) × (1 + r × (1 - P(t)/K))
```
Where:
- `P(t)` = population at tick t
- `r` = base growth rate (default 2% per quarter = 0.02)
- `K` = carrying capacity (default 1,000,000,000 per system)

**Colony Lifecycle (Space-First Model):**

| Stage | Population Threshold | Characteristics |
|-------|---------------------|-----------------|
| **Orbital Anchor** | < 500 | Initial station placement; survey and resource recon |
| **Orbital Industry** | 500 – 10,000 | Asteroid mining, refinery, fuel depot; space-based production |
| **Outpost** | 10,000 – 100,000 | First planetary surface presence; robotic landing, life support |
| **Settlement** | 100,000 – 1,000,000 | Self-sustaining basics, limited manufacturing, growing trade |
| **Colony** | 1M – 100M | Full production chains, political identity forming |
| **Mature World** | > 100M | Major economic power, cultural center, faction seat candidate |

The progression reverses typical colony games: players build **space industry first**, then gradually move infrastructure and people to the surface.

**Migration Pressure:**
```
migration_flow(A→B) = f(overcrowding_A, instability_A, opportunity_B, distance_AB)
```
- Push factors: overcrowding (P/K > 0.8), low wealth, political instability
- Pull factors: high resource potential, low population, faction affinity

### Logistics & Ships (SFTL)

**Transit Time Model:**
```
transit_years = distance_ly / ship_velocity_fraction_c
```

| Ship Class | Velocity (c) | Capacity | Role |
|------------|-------------|----------|------|
| Colony Ship | 0.05c | 10,000 colonists | Founding new outposts |
| Industrial Vessel | 0.05c | Heavy equipment | Station/factory construction |
| Cargo Hauler | 0.08c | 50,000 tonnes | Freight, trade routes |
| Tanker Ship | 0.08c | Fuel/volatiles | Refueling depots, cyclers |
| Fast Courier | 0.10c | 100 tonnes | Messages, high-value cargo |
| Patrol Vessel | 0.10c | Military | Route security, force projection |
| Survey Probe | 0.15c | Instruments | Exploration, system scanning |

**Propulsion Types:**

| Propulsion | Thrust | Efficiency | Mass | Cost | Availability |
|-----------|--------|-----------|------|------|-------------|
| Nuclear Pulse | High | Low | Heavy | Medium | Early game |
| Fusion Drive | Medium | Medium | Medium | High | Mid game |
| Beamed Sail | Low (accel only) | Very High | Low | Very High (ground infra) | Mid game |
| Antimatter | Very High | Very High | Low | Extreme | Late game |
| Hybrid | Configurable | Configurable | Variable | High | Mid-late game |

**Modular Ship Construction:**
Ships are assembled from standardized modules:
- **Propulsion units** — engine type + fuel tank sizing
- **Habitat modules** — living quarters, hydroponics, medical, education
- **Cargo bays** — general storage, pressurized, cryogenic
- **Mining equipment** — drilling rigs, harvesters, processing arrays
- **Construction arms** — assembly cranes, welding systems
- **Reactors** — fission, fusion, solar array connections
- **Defense systems** — point defense, ECM, armor plating

**Generation Ships:**
For voyages > 1 human lifetime, ships function as closed ecosystems:
- Large habitats with agriculture, recycling, education
- Multiple generations raised during transit
- Rotating sections for artificial gravity
- Autonomous life-support maintenance

**Route Constraints:**
- No FTL: minimum transit Alpha Centauri (4.37 LY) = 44 years at 0.10c.
- Refueling at intermediate systems for multi-hop routes.
- Fleet scheduling with departure windows and arrival coordination.
- Gravitational assists around gas giants can reduce travel costs.
- Deceleration burns at destination require fuel reserves.

### Economy

**Resource Categories (5 types):**

| Category | Composition | Source | Primary Use |
|----------|-----------|--------|-------------|
| **Volatiles** | H₂O, NH₃, CH₄, CO₂ | C-type asteroids, comets, icy moons | Life support, agriculture, fuel (H₂/O₂ electrolysis) |
| **Metals** | Fe, Ni, Ti, Al | S-type asteroids, rocky planets | Structures, ships, machinery |
| **Rare Elements** | Pt, Au, rare earths | Asteroid belts, special deposits | Advanced electronics, precision instruments |
| **Silicates** | Quartz, feldspar, olivine | Rocky bodies, regolith | Habitat shielding, ceramics, glass |
| **Carbon Compounds** | Graphene, polymers, organics | C-type asteroids, cometary nuclei | Lightweight composites, high-tech manufacturing |

**Asteroid Spectral Classes (NASA-grounded):**

| Class | Composition | Resources | Abundance |
|-------|-----------|-----------|-----------|
| **C-type** (carbonaceous) | Water in hydrated minerals, organic carbon, phosphorus | Volatiles, Carbon Compounds, fertilizer | ~75% of asteroids |
| **S-type** (silicaceous) | Iron, nickel, cobalt; ~50 kg rare metals per 10m asteroid | Metals, Rare Elements | ~17% of asteroids |
| **M-type** (metallic) | Nearly pure iron-nickel | Metals (high grade) | ~8% of asteroids |

**Production Chains:**

```
Ice mining → Electrolysis → Hydrogen & Oxygen → Fuel / Water
Regolith mining → Smelter → Iron / Nickel → Construction steel
Carbonaceous ore → Chemical plant → Polymers → Habitat modules
Silicate extraction → Kiln → Ceramics / Glass → Shielding
Rare ore → Refinery → Electronics-grade metals → High-tech components
```

Each chain requires infrastructure (mines, processors, factories) and **power**.

**Production Model:**
```
output = base_production × tech_multiplier × workforce_fraction × resource_availability
tech_multiplier = 1.0 + (tech_level × 0.15)   // TL 0 = 1.0×, TL 10 = 2.5×, TL 20 = 4.0×
```

**Power & Energy:**

| Source | Fuel | Availability | Output |
|--------|------|-------------|--------|
| Fission reactor | Uranium | Early game | Medium |
| Fusion reactor | Helium-3, Deuterium | Mid game | High |
| Solar arrays | None (proximity to star) | Always | Variable |
| Antimatter | Antimatter (manufactured) | Late game | Very High |

Energy storage (batteries, superconductors) and distribution networks are important considerations.

**Infrastructure Maintenance:**
- Structures degrade over time, requiring spare parts and maintenance cycles.
- Planning redundancy and repair schedules is crucial.
- Neglected infrastructure → cascading failure events.

**Trade Mechanics:**
- Local surplus/deficit drives export/import.
- Price = base_cost × scarcity_multiplier × distance_premium.
- Bulk carriers move commodities along interstellar routes.
- Freight capacity, transit time (decades), and cargo value influence trade profit.
- Star systems specialize based on resource abundance, creating supply–demand dynamics.
- Trade balance tracked per settlement per tick.
- Deficit systems dip into reserves; prolonged deficit → shortage event.

### Politics

**Faction Model:**

| Attribute | Range | Effect |
|-----------|-------|--------|
| `cohesion` | 0.0–1.0 | Internal unity; decays with distance and low wealth |
| `tension` | 0.0–1.0 | Bilateral hostility; rises from border disputes, trade competition |
| `influence` | 0.0–1.0 | Soft power over neighboring systems |
| `governance_type` | enum | Democracy, Autocracy, Corporate, Collective, Theocracy |

**Cohesion Dynamics:**
```
cohesion(t+1) = cohesion(t) × decay_rate + wealth_bonus + tech_bonus - distance_penalty
decay_rate = 0.98 per tick
distance_penalty = 0.01 × max_system_distance_ly / 10
```

**Independence Pressure:**
- Systems with cohesion < 0.3 and distance > 15 LY from faction capital accumulate independence pressure.
- At threshold (0.8), secession event fires → new faction spawns.

**Conflict:**
- Tension > 0.7 between neighbors → border skirmish probability per tick.
- Tension > 0.9 → open conflict event with economic/population impact.

### Strategic Events

| Event Type | Trigger | Impact |
|------------|---------|--------|
| **Scientific Discovery** | Random, weighted by tech level | Tech +1, morale boost |
| **Border Conflict** | Tension > 0.7 between neighbors | Population loss, trade disruption |
| **Migration Wave** | Overcrowding + nearby opportunity | Population redistribution |
| **Resource Shortage** | Production < consumption for 4+ ticks | Price spike, cohesion drop |
| **Tech Breakthrough** | Discovery event + high tech level | Production multiplier boost |
| **Independence Movement** | Cohesion < 0.3, distance penalty | New faction creation |
| **Treaty Formation** | Mutual low tension + trade surplus | Alliance, trade bonus |
| **Supply Collapse** | Extended shortage + low reserves | Population decline, crisis |
| **Frontier Rush** | High-value system discovered | Migration surge, speculation |
| **Equipment Failure** | Random, weighted by maintenance deficit | Production loss, repair cost |
| **Asteroid Impact** | Random, rare | Infrastructure damage, population loss |
| **Disease Outbreak** | Random, weighted by population density | Population decline, quarantine |
| **Mutiny** | Low morale + bad NPC captain trait | Ship/station control disruption |
| **First Contact** | Extremely rare, late game | Alien microbes discovery, paradigm shift |

---

## Communications Layer (NEW)

Messages travel at the speed of light. This creates fundamental gameplay tension:

| Distance | One-Way Delay | Round Trip |
|----------|--------------|-----------|
| 4 LY (Proxima Centauri) | 4 years | 8 years |
| 10 LY | 10 years | 20 years |
| 50 LY | 50 years | 100 years |
| 100 pc (~326 LY) | 326 years | 652 years |

**Mechanics:**
- Player decisions sent during transit reach the fleet after delay.
- Reports from distant colonies arrive with light-speed delays.
- Message queue with sent time, ETA, predicted response arrival.
- AI governors operate autonomously between messages.
- Emergency wake-up protocols during transit for course corrections.

---

## AI Governor System (NEW)

Each colonized system becomes a semi-autonomous simulation. An AI governor manages:
- Local logistics and supply chain optimization
- Population assignment and labor allocation
- Infrastructure maintenance and construction queues
- Defense posture and threat response
- Trade offer evaluation

**Player Control Interface:**
Players set high-level policies via delayed messages:

| Policy | Options | Effect |
|--------|---------|--------|
| Industrial focus | Mining / Manufacturing / Research | Shifts production priorities |
| Military posture | Defensive / Neutral / Aggressive | Resource allocation to defense |
| Immigration | Open / Selective / Closed | Population growth rate modifier |
| Trade | Free / Regulated / Autarky | Trade openness and tariffs |
| Cultural | Secular / Traditional / Progressive | Cohesion and ideology drift |

AI governors use **behaviour trees** to implement policies, reporting status via delayed messages.

---

## Conflict Mechanics (NEW)

Warfare in ExoMaps is primarily orbital and logistical — not planetary armies.

| Conflict Type | Mechanism | Impact |
|--------------|-----------|--------|
| **Blockade** | Fleet positions at jump/approach points | Trade disruption, resource starvation |
| **Sabotage** | Covert operation against infrastructure | Production loss, repair costs |
| **Hacking** | Electronic warfare against station systems | Temporary control loss, data theft |
| **Trade Lane Control** | Patrol vessels on routes | Freight interdiction, piracy |
| **Espionage** | Steal research, incite rebellion | Tech gain/loss, cohesion damage |

**Interstellar Councils:**
- Factions may vote on shared initiatives (large observatories, treaties).
- Embargoes affect trade routes.
- Research pacts share tech progression benefits.

---

## Terraforming System (NEW)

For planets outside the habitable zone, players can initiate multi-century modification projects:

| Project | Duration | Resource Cost | Effect |
|---------|----------|--------------|--------|
| Atmosphere modification | 100–500 years | Extreme Volatiles + Carbon | Temperature/pressure adjustment |
| Ocean seeding | 200–800 years | Extreme Volatiles | Water cycle establishment |
| Magnetic field generator | 50–200 years | Extreme Metals + Rare Elements | Radiation protection |
| Biosphere seeding | 300–1000 years | Carbon Compounds + Volatiles | Self-sustaining ecosystem |

**Terraforming Difficulty:**
```
difficulty = f(atmosphere_gap, mass_deviation_from_earth, temperature_delta, radiation)
```
Projects have milestone events with intermediate benefits (early atmosphere → partial habitability).

---

## Victory Conditions (NEW)

| Victory | Condition | Scoring |
|---------|-----------|---------|
| **Expansion** | Control largest interstellar network of self-sustaining systems | Systems × self-sufficiency rating |
| **Economic** | Achieve interstellar trade dominance and wealth | GDP + trade volume + surplus |
| **Scientific** | Complete key research projects | Fusion drives, terraforming, alien life contact |
| **Cultural/Religious** | Spread ideology across the network | Cultural influence coverage % |
| **Utopian** | Sustainable egalitarian colonies without conflict | Peace years × equality index × sustainability |

Custom goals (utopian retreat, religious pilgrimage) are also configurable per campaign.

---

## User Control & Gamification

### Scenario Presets

| Preset | Start Conditions | Gameplay Focus |
|--------|-----------------|----------------|
| **First Expedition** | Sol, single sponsor, TL 5, 1 fleet | Tutorial: learn space-first loop |
| **Early Expansion** | Sol, 10B pop, TL 5 | First colony ships, exploration |
| **Fragmented Earth** | 3 factions, TL 8, tensions high | Diplomacy, competition |
| **Corporate Frontier** | Corporate syndicate sponsor, profit-driven | Trade optimization, monopolies |
| **Scientific Coalition** | Research-focused sponsor, limited funding | Discovery, tech race |
| **Religious Pilgrimage** | Faith-based sponsor, ideological goals | Cultural victory path |
| **Golden Age** | United humanity, TL 15, peace | Expansion speed, science |
| **Collapse Recovery** | Post-catastrophe, TL 2, scattered | Survival, reconnection |

### Player Role Modes

| Role | Control Level | Perspective |
|------|--------------|-------------|
| **Expedition Organizer** | Design expedition, set macro policy, AI manages local | Core game experience |
| **Central Planner** | Full control over all factions | God-mode strategy |
| **Faction Leader** | Direct control of one faction | Competitive campaign |
| **Neutral Observer** | Intervention tools only | Sandbox experimentation |
| **Explorer** | Ship/mission control only | Discovery-focused gameplay |

### Rule Sliders

| Slider | Range | Default | Effect |
|--------|-------|---------|--------|
| Propulsion improvement rate | 0.0–2.0× | 1.0× | How fast ship speeds increase |
| Governance cohesion | 0.5–2.0× | 1.0× | Faction stability multiplier |
| Resource scarcity | 0.5–2.0× | 1.0× | Extraction difficulty multiplier |
| Event frequency | 0.5–3.0× | 1.0× | How often strategic events fire |
| Growth rate | 0.5–2.0× | 1.0× | Population growth speed |
| Tech progression | 0.5–2.0× | 1.0× | Research speed multiplier |

---

## Determinism & Replayability

| Guarantee | Implementation |
|-----------|---------------|
| Seed-based RNG | `numpy.RandomState(seed)` — single source of randomness |
| Deterministic tick order | Fixed phase sequence: Pop → Migrate → Extract → Produce → Trade → Build → Politics → Comms → Events → AI Gov |
| Reproducible events | Event generation uses RNG draws in fixed order |
| Snapshot save/load | JSON serialization at any tick; resume produces identical continuation |
| Cross-platform consistency | Pure Python math (no platform-dependent floating point) |

---

## Scalability

To handle thousands of systems within 100 pc, the engine **sleeps inactive systems** until an incoming event or player interaction requires updates. Only active systems consume CPU, allowing the simulation to run at accelerated time scales. This is critical for late-game performance when hundreds of systems are colonized.

---

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Tick latency (500 systems) | < 500ms | ~200ms (100 systems, measured) |
| Century run (400 ticks) | < 5 minutes | ~2 minutes (50 ticks measured) |
| Memory per simulation | < 500 MB | ~50 MB (100 systems) |
| Active interstellar routes | Thousands | Hundreds (current) |
| Snapshot size (JSON) | < 10 MB | ~1 MB (current) |
| Sleep-wake overhead | < 10ms per system | Not measured |

---

## API Integration

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/simulation/<run_id>/snapshot` | GET | Current simulation state |
| `/api/simulation/<run_id>/events` | GET | Event stream with pagination |
| `/api/simulation/<run_id>/pause` | POST | Pause running simulation |
| `/api/simulation/<run_id>/resume` | POST | Resume paused simulation |
| `/api/simulation/<run_id>/step` | POST | Advance N ticks |

---

## Future Enhancements

| Enhancement | Description | Complexity | Status |
|-------------|-------------|-----------|--------|
| **SFTL fleet routing** | Full route planning with refuel stops and fleet coordination | High | Promoted to Phase 09 |
| **Multi-campaign support** | Multiple simultaneous simulations sharing a world build | Medium | Planned |
| **WebSocket tick streaming** | Real-time tick results pushed to connected clients | Medium | Planned |
| **Advanced diplomacy** | Treaties, trade agreements, embargoes as first-class entities | High | Promoted to Phase 09 |
| **Cultural drift** | Language/culture divergence over distance and time | Low | Planned |
| **Terraforming projects** | Multi-century planetary modification with milestone events | High | Promoted to Phase 09 |
| **AI faction behavior** | Non-player factions with configurable strategy profiles | Medium | Promoted to Phase 09 |
| **Asynchronous multiplayer** | Shared universe with communication-lag interactions | High | Promoted to In-Scope |
| **NPC character system** | Named characters with traits affecting mission outcomes | Medium | Promoted to Phase 09 |
| **Modular ship builder** | Drag-and-drop module placement affecting stats | High | Promoted to Phase 09 |
| **Sponsor/contractor system** | Expedition creation with ideology and design bonuses | Medium | Promoted to Phase 09 |
