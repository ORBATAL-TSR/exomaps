# ExoMaps — Game Design Specification

*Derived from user stories 01–03 and game design documents.*
*This spec defines player-facing systems, data models, rules, and UI requirements.*

---

## Table of Contents

1. [Campaign Launch & Wave Sequencing](#1-campaign-launch--wave-sequencing)
2. [Arrival Sequence](#2-arrival-sequence)
3. [Space Architecture — Nodes](#3-space-architecture--nodes)
4. [Intra-System Logistics — Routes & Vehicles](#4-intra-system-logistics--routes--vehicles)
5. [Cargo & Production Tiers](#5-cargo--production-tiers)
6. [Claim Score System](#6-claim-score-system)
7. [Bootstrap Gap & Redundancy](#7-bootstrap-gap--redundancy)
8. [Faction System](#8-faction-system)
9. [Governance & Time-Delayed Authority](#9-governance--time-delayed-authority)
10. [UI Requirements Summary](#10-ui-requirements-summary)

---

## 1. Campaign Launch & Wave Sequencing

### Overview
Before the player's first colonists arrive, they configure and dispatch a sequence of ship waves. Each wave is designed to arrive into what the previous wave prepared. This is the pre-game phase — the player is making decades-long bets on incomplete information.

### Player Actions
1. Choose **sponsor** (determines starting budget, ideology, political constraints)
2. Choose **prime contractor** (determines ship module availability and quality tier)
3. Configure **Probe Wave** (optional but strongly beneficial)
4. Configure **Seeder Wave** (robotic — defines what robots build before humans arrive)
5. Configure **Pathfinder Wave** (first humans — small, high-capability)
6. Configure **subsequent waves** (industrial, biological, population — staggered departure windows)

Each ship in each wave has:
- A **module manifest** (propulsion, cargo bays, reactors, crew quarters, specialized systems)
- A **cargo manifest** (what specific items/resources it carries)
- A **departure window** (earlier = arrives sooner but may be configured with worse intel)
- A **speed setting** (higher speed = shorter transit but higher antimatter fuel cost)

### Wave Data Model

```
Wave {
  id: string
  name: string
  type: 'probe' | 'seeder' | 'pathfinder' | 'industrial' | 'population'
  departure_year: number          // relative to campaign start
  speed_c: float                  // fraction of c (0.05–0.20)
  transit_years: float            // computed: distance / speed_c
  arrival_year: float             // computed: departure_year + transit_years
  ships: Ship[]
}

Ship {
  id: string
  name: string
  class: ShipClass
  modules: Module[]
  cargo: CargoItem[]
  crew_count: number
  mass_t: float                   // computed from modules + cargo
  antimatter_kg: float            // computed from mass × Δv budget
}

Module {
  type: ModuleType
  tier: 1 | 2 | 3                 // contractor quality
  mass_t: float
  power_kw: float
  crew_requirement: number
}
```

### Wave Sequencing Rules

- **Probe wave** must depart first; can depart years before campaign start
- **Seeder wave** must arrive before Pathfinder wave — game enforces this with a warning if violated
- **Time between Seeder arrival and Pathfinder arrival** = "preparation window" — longer = more infrastructure pre-built; minimum recommended: 3 years
- Each subsequent wave can be configured with information from previous wave reports (simulated data lag: report arrives at Earth `distance / c` years after filed)
- Player can **amend** a wave's cargo manifest up until it reaches halfway point in transit (after which the ship is beyond practical communication turnaround)

### Probe Wave Mechanics

Probes return survey data that unlocks information tiers:

| Probe Type | Intel Unlocked |
|-----------|---------------|
| Flyby probe | System overview — planet count, rough orbit radii, star type |
| Orbital probe | Planet surface maps, atmospheric pressure/composition, polar ice confirmation |
| Belt survey probe | Asteroid spectral class distribution, M-type cluster locations |
| Lander probe | Surface chemistry at landing site, subsurface ice depth, regolith composition |
| Lagrange beacon | Navigation + comms relay — reduces all subsequent communication delay by 20% |

Without probe data, Seeder and Pathfinder configurations are based on statistical priors for the star type. **Actual system conditions will deviate.** The deviation is seeded per-system and hidden until arrival.

---

## 2. Arrival Sequence

### Overview
The arrival moment is the emotional and mechanical pivot of the game. The player transitions from pre-game planning to active management. What the robots built may differ from what was planned. The first hours on-site establish the campaign's starting conditions.

### Trigger
Arrival sequence fires when the Pathfinder wave's lead ship crosses the system entry threshold (0.5 AU from outermost tracked body).

### Sequence

**Step 1 — Deceleration Burn** *(cinematic + UI)*
The burn is calculated automatically. Player watches their ship slow into orbit. The star resolves from a point to a disc. The first rendered view of the system orrery appears.

**Step 2 — Seeder Assessment**
System generates the actual state of what the Seeder robots built:

```
seeder_output = base_plan × performance_modifier × time_modifier

performance_modifier = random(0.70, 1.30)  // variance around spec
time_modifier = clamp(preparation_window_years / 5.0, 0.4, 1.2)
```

Each seeder system (fuel depot, station skeleton, mining array) is assessed independently. Results are revealed progressively as the Pathfinder ship approaches — matching the experience of seeing it through instruments.

**Step 3 — First Look Report**
UI presents a system summary:
- What was built vs. what was planned (green/amber/red per system)
- Current fuel depot level (tonnes H₂/O₂ available)
- Station operational status (% of planned modules functional)
- Any seeder anomalies (failures, unexpected improvements, deviations)

One **first failure** event always fires within the first 30 in-game days. Category determined by seeder configuration — the most stressed system fails first. This is telegraphed: anomalies flagged as "degraded but within parameters" during transit become the failure source. Player must choose a response.

**Step 4 — Planet Assessment**
Each candidate world reveals its actual properties — which may differ from probe data:

```
actual_property = probe_estimate × (1 + normal_distribution(0, uncertainty_sigma))
uncertainty_sigma = base_uncertainty / probe_coverage_score
```

Probe coverage score is 0–1 based on which probes the player deployed. An orbital probe reduces `uncertainty_sigma` to ~0.05. No probes = `uncertainty_sigma` ~0.40.

Players who skipped probes may find a planet substantially different from the statistical prior. This is intentional — scout your targets.

**Step 5 — First Decisions**
Player must make three binding decisions before the arrival sequence closes:
1. **Primary orbit** — where to anchor the main station
2. **First resource priority** — what to mine/extract first (determines initial route network)
3. **Surface strategy** — commit now (orbital-first / surface-first / evaluate-further)

These decisions are locked for 10 in-game years. The game communicates this clearly — these are *founding decisions*, not early-game moves.

---

## 3. Space Architecture — Nodes

### Overview
A node is any fixed infrastructure with docking/landing capability and storage. Nodes are the vertices of the logistics graph. They produce things, consume things, and house people.

### Node Data Model

```
Node {
  id: string
  name: string
  type: NodeType
  location: OrbitalLocation
  modules: NodeModule[]
  crew_assigned: number
  crew_capacity: number
  power_kw: float                  // generated
  power_demand_kw: float           // consumed
  storage: StorageState
  uptime: float                    // 0.0–1.0
  construction_complete: float     // 0.0–1.0 (nodes build over time)
  faction_owner: string
  maintenance_demand: MaintenanceDemand
}

OrbitalLocation {
  body_id: string                  // star, planet, moon, asteroid, lagrange point
  orbit_altitude_km: float | 'surface'
  orbit_period_days: float
}

MaintenanceDemand {
  crew_per_month: number
  spare_parts_t_per_year: float
  power_reserve_fraction: float    // fraction of generated power held in reserve
}
```

### Node Types & Properties

| Type | Produces | Consumes | Requires | Uptime Driver |
|------|---------|---------|---------|--------------|
| **Orbital Station** | Docking, storage, command | Power, crew, spare parts | Metals (build) | Crew + parts supply |
| **Fuel Depot** | Stored H₂/O₂ | Power, intake from tanker | Metals (build) | Tanker route |
| **Mining Outpost** | Raw ore | Power, crew | Metals (build) | Crew + drill parts |
| **Processing Platform** | Refined metals, polymers | Raw ore, power, crew | Metals + Rare (build) | Ore supply + crew |
| **Surface Base** | Crew capacity, agriculture | All categories | All (high cost, slow) | Full supply chain |
| **Atmospheric Platform** | He-3, cloud chemistry | Power (extreme), crew | Metals + Carbon (build) | Power + crew |
| **Fuel Production Plant** | H₂/O₂ (electrolysis) | Ice, power, crew | Metals + Volatiles | Ice supply |
| **Shipyard** | New intra-system vessels | Metals, Rare Elements, crew | Existing industry | Full chain |
| **Comms Relay** | Reduced governance delay | Power | Rare Elements (low) | Power only |

### Uptime Calculation

```
uptime = min(
    crew_satisfaction_factor,       // crew_assigned / crew_required
    power_factor,                   // power_generated / power_demand
    supply_factor,                  // min(each required input / demand)
    maintenance_factor              // decays over time; reset by spare parts delivery
)

maintenance_factor decay rate: 0.02 per month (reaches 0 in ~50 months without resupply)
```

Uptime below 0.5 triggers a **degraded node** event. Below 0.2 triggers **node failure** — the node stops producing and requires a repair mission to restart.

### Construction

Nodes are not instant. They build over time, consuming materials delivered by routes.

```
construction_progress += (materials_delivered_this_month / materials_required) × build_rate

build_rate = crew_on_construction × contractor_efficiency_modifier
```

A node at 0% construction is a "planned node" — visible on the map, not yet functional. At 100% it becomes active. The player can queue multiple nodes; construction crew allocation determines which finish first.

---

## 4. Intra-System Logistics — Routes & Vehicles

### Overview
Routes are the edges of the logistics graph. They connect nodes. Vehicles are assigned to routes and carry cargo between them. This is the Railroad Tycoon layer.

### Route Data Model

```
Route {
  id: string
  name: string
  origin_node_id: string
  destination_node_id: string
  delta_v_ms: float                // one-way cost
  transit_days: float              // one-way transit time (vehicle class dependent)
  hazard_rating: float             // 0.0–1.0; affects delay chance + damage risk
  assigned_vehicles: Vehicle[]
  cargo_manifest: CargoAssignment[]
  priority: 1 | 2 | 3 | 4 | 5    // 1 = highest; fuel allocation priority
  bidirectional: boolean           // almost always true
  status: 'active' | 'disrupted' | 'suspended'
}

CargoAssignment {
  cargo_type: CargoType
  direction: 'outbound' | 'inbound' | 'both'
  volume_t_per_run: float
  load_factor: float               // 0.0–1.0; < 0.4 triggers efficiency warning
}
```

### Vehicle Data Model

```
Vehicle {
  id: string
  name: string
  class: VehicleClass
  assigned_route_id: string | null
  cargo_capacity_t: float
  fuel_consumption_per_run: FuelConsumption
  maintenance_interval_days: float
  wear: float                      // 0.0–1.0; at 1.0 = breakdown imminent
  current_position: TransitState
}

TransitState {
  status: 'docked' | 'loading' | 'in_transit' | 'maintenance'
  origin_node_id: string
  destination_node_id: string
  departure_day: number
  arrival_day: number
  cargo_loaded: CargoItem[]
}
```

### Vehicle Classes

| Class | Atmosphere | Capacity (t) | Transit | Best For | Can Land |
|-------|-----------|------------|---------|---------|---------|
| Vacuum Lander | None (airless) | 10–500 | Hours–days | Asteroid/moon hops | Yes (airless) |
| Atmospheric Spaceplane | ≥ 0.1 bar required | 5–200 | Days | Surface ↔ orbit, atm worlds | Yes (atm) |
| Interorbit Freight Barge | None | 1,000–100,000 | Weeks–months | Bulk belt-to-station | No |
| Orbital Shuttle | None | Crew only (2–40) | Hours | Crew transfer, same orbit band | No |
| Fuel Tanker | None | 500–50,000 | Days–weeks | Propellant delivery | No |
| High-Value Courier | None | 1–20 | Days | Rare goods, urgent cargo | No |

### Route Matching Rules

Vehicle assignment to route requires:
- Vehicle class compatible with route endpoints (landers can't dock to orbital-only nodes; spaceplanes need atm world)
- Vehicle cargo capacity ≥ minimum assigned cargo volume
- Route delta_v within vehicle's operational envelope

**The game enforces these constraints** and shows why an assignment fails if the player tries an incompatible combo.

### Transit Mechanics

Each run:
1. Vehicle departs origin with cargo loaded
2. In-transit: visible on route map with progress indicator
3. Arrival: cargo transferred to destination storage
4. **Return leg**: loads return cargo (if any assigned); departs immediately or after configurable dwell time
5. Wear increases per run: `wear += wear_per_run_base × hazard_modifier × age_modifier`
6. At wear > 0.85: breakdown risk per run = `(wear - 0.85) × 0.4`
7. Breakdown: vehicle halted at last node; requires maintenance before next run

### Bidirectional Load Balancing

The UI flags unbalanced routes:

```
load_balance_score = min(outbound_load_factor, inbound_load_factor) /
                     max(outbound_load_factor, inbound_load_factor)

if load_balance_score < 0.4: show "Return leg underloaded" warning
```

An empty return leg wastes half the vehicle's operational capacity. The game rewards balanced manifests with a small efficiency bonus.

---

## 5. Cargo & Production Tiers

### Cargo Types

Each cargo type has:
- `mass_per_unit_t` — weight
- `value_per_unit` — economic value (scales with tier)
- `requires_pressurized_bay: bool` — affects vehicle compatibility
- `requires_cryo: bool` — for biologicals and certain volatiles
- `decay_rate_per_day: float` — perishables lose value over time

### Tier 1 — Bulk Commodities

| Type | Source Node | Destination | Notes |
|------|------------|------------|-------|
| Water ice | Mining Outpost (icy body) | Fuel Production Plant | Feedstock for electrolysis |
| Metallic ore | Mining Outpost (S/M asteroid) | Processing Platform | Feedstock for smelting |
| Regolith | Surface Base or Outpost | Processing Platform | Feedstock for ceramics |
| Carbonaceous ore | Mining Outpost (C asteroid) | Chemical Plant | Feedstock for polymers |

### Tier 2 — Processed Materials

| Type | Source Node | Destination | Notes |
|------|------------|------------|-------|
| Liquid H₂/O₂ | Fuel Production Plant | All fuel depots | System-critical |
| Smelted iron/nickel | Processing Platform | Fabrication / Construction | Primary structural |
| Titanium billets | Processing Platform (rare deposit) | High-spec fabrication | Premium structural |
| Polymer sheet | Chemical Plant | Habitat manufacturing | Habitat modules |
| Ceramics panels | Kiln | Surface bases, shielding | Structural + radiation |

### Tier 3 — Manufactured Goods

| Type | Source | Notes |
|------|--------|-------|
| Structural assemblies | Fabrication Station | Pre-built components for construction |
| Reactor components | Heavy Manufacturing | Required to build new reactors |
| Habitat modules (prefab) | Assembly Platform | Expands crew capacity at destination |
| Medical equipment | Medical Fab | Reduces mortality rate at receiving node |
| Sensor arrays | Electronics Fab | Required for survey ships, relay nodes |

### Tier 4 — High-Value / Rare

| Type | Why Unique | Interstellar Viable |
|------|-----------|-------------------|
| Vacuum-synthesized crystals | Perfect lattice — impossible in gravity well | Yes — optical fiber, processor substrates |
| Zero-g cast alloys | Superior properties from zero-convection cooling | Yes — structural, bearings |
| Rare isotopes | Stellar body specific (He-3, unusual transuranic) | Yes — fusion fuel, medical |
| Adapted biologicals | Species evolved for specific world chemistry | Yes — agriculture starter kits |
| Knowledge packages | Research data, engineering blueprints | Yes — tech transfer |

### Production Chain Rules

Each production node has:
- `input_types[]` — what it consumes per cycle
- `output_types[]` — what it produces per cycle
- `cycle_duration_days` — how long one production cycle takes
- `efficiency: float` — scales with crew_satisfaction and power_factor

```
output_per_cycle = base_output × efficiency × uptime
efficiency = (crew_satisfaction + power_factor) / 2
```

A node starved of inputs stops producing. Its output buffer drains. Downstream nodes that depend on that output begin to degrade. This is the cascade.

---

## 6. Claim Score System

### Overview
Claiming a system is not a military action. It is an infrastructure metric. You claim a system by building in it, running it, and keeping it running.

### Formula

```
claim_score = Σ(node_claim_value[i] × uptime[i])
            + route_density_bonus
            + population_bonus
            - Σ(rival_faction_claim_score[j] × proximity_weight[j])

node_claim_value[i] = base_value[node_type] × construction_complete[i]
route_density_bonus = min(active_route_count × 12, 400)
population_bonus = total_colony_population × 0.8
```

### Thresholds

| Score | Status |
|-------|--------|
| 0–99 | Unclaimed — presence only |
| 100–299 | Established — basic claim; contestable |
| 300–599 | Consolidated — operational colony; harder to contest |
| 600–999 | Dominant — clear controlling faction |
| 1000+ | Sovereign — system effectively yours; rivals must negotiate or fight |

### Contesting

When multiple factions are present:
- Each faction calculates their own claim score independently
- The **effective claim** of any faction = their raw score − 40% of the second-highest rival's score
- A faction that reaches "Dominant" while a rival is at "Established" is in a stable position
- Two factions both at "Established" are in a **contested system** — diplomatic or conflict pressure applies

### Degradation

Claim score does not freeze. Nodes that go offline reduce it. Routes that get disrupted reduce the density bonus. Population that defects or dies reduces the population bonus.

A colony that stops maintaining its infrastructure loses its claim — not instantly, but measurably, over months. The game shows trend arrows on the claim score readout.

---

## 7. Bootstrap Gap & Redundancy

### The Vulnerability Window

The bootstrap gap is the period between first arrival and local self-sufficiency. During this window, the colony cannot replace critical systems from local production — it depends entirely on what it brought.

```
bootstrap_gap_end = first_year_all_production_chains_locally_closed
typical_range = arrival_year + 5  to  arrival_year + 25  (depending on seeder config + planet)
```

During the bootstrap gap:
- **No replacement reactors** can be built locally (requires semiconductor fab, Wave 3)
- **No new ships** can be built locally (requires shipyard, Wave 3)
- Critical spare parts deplete and cannot be replenished from local stock

### Redundancy Mechanics

Each critical system has a `redundancy_level: int (0–3)`:

| Level | Meaning | Failure Behavior |
|-------|---------|-----------------|
| 0 | No backup | Failure = immediate crisis |
| 1 | One backup unit | Failure triggers switch to backup; repair window before second failure |
| 2 | Two backups | Failure chain requires two sequential failures to reach crisis |
| 3 | Full redundancy | Failure is a maintenance event, not a crisis |

The player configures redundancy levels during wave manifest design. Higher redundancy = more mass = higher fuel cost = later arrival or lower capacity. This is the core tension of wave design.

**Design rule:** The seeder wave should always carry `redundancy_level ≥ 2` for:
- Primary power reactors
- Electrolysis plant
- Ice mining array
- Life support systems

Carrying redundancy for everything costs 30–40% more mass. Carrying it for nothing means the first thing that breaks ends the mission.

### First Failure Event

Always fires within 30 days of Pathfinder arrival. Category:

```
failure_category = most_stressed_seeder_system_at_arrival
stress = (time_since_deployment × degradation_rate) / redundancy_level
```

**Player response options** (presented as event card):

| Option | Outcome | Cost |
|--------|---------|------|
| Repair with carried spares | Fastest resolution | Depletes spare parts manifest |
| Fabricate locally | Slower; doesn't deplete spares | Time cost; requires crew allocation |
| Divert to alternate resource | Route around the broken system | Permanent constraint until fully repaired |
| Request from another faction (if present) | Fastest if they agree | Relationship cost + economic cost |

---

## 8. Faction System

### Faction Data Model

```
Faction {
  id: string
  name: string
  origin: FactionOrigin
  leader: NPC
  population: number
  nodes: Node[]                    // nodes they own
  vehicles: Vehicle[]
  claim_score: float
  ideology: IdeologyProfile
  economy: EconomyState
  relationships: Map<faction_id, RelationshipState>
}

IdeologyProfile {
  autonomy: float                  // 0 = hierarchical, 1 = anarchic
  economic_model: float            // 0 = planned, 1 = market
  expansionism: float              // 0 = isolationist, 1 = aggressive
  cultural_openness: float         // 0 = closed, 1 = cosmopolitan
}

NPC {
  name: string
  traits: TraitProfile
  age: number
  background: string
}

TraitProfile {
  leadership: float    // morale multiplier, success probability
  greed: float         // corruption risk, trade efficiency
  expertise: float     // research speed, problem-solving
  charisma: float      // diplomatic outcomes, faction loyalty
  resilience: float    // crisis survival, adaptation
}
```

### Faction Origins

| Origin | Trigger Condition |
|--------|-----------------|
| **Splinter** | `autonomy_desire > 0.65 AND ideology_alignment < 0.35` sustained for 3+ years |
| **Rival Expedition** | Mission event; random arrival within ±30 years of player arrival |
| **Corporate Spinoff** | Contractor personnel > player crew AND contractor debt unpaid AND year > 20 |
| **Independent Operator** | Route coverage below 60% of system AND population > 2,000 |
| **Earth Resupply Wave** | Triggered by population wave arrival with different sponsor mandate |
| **Ghost Claim** | Player or rival salvages abandoned infrastructure from a prior failed mission |

### Splinter Mechanics

Three internal colony metrics per population group:

```
autonomy_desire:       increases 0.01/year baseline + events
ideology_alignment:    drifts based on governance decisions
economic_satisfaction: = f(resource_allocation_fairness, route_coverage, uptime_of_local_nodes)
```

```
splinter_risk_per_year = 0
if autonomy_desire > 0.65 AND ideology_alignment < 0.35:
    splinter_risk_per_year += (1.0 - economic_satisfaction) × 0.3

if splinter_risk cumulative > threshold:
    → splinter_event fires
```

On splinter event:
- 10–30% of population leaves (weighted toward the highest-autonomy group)
- Infrastructure they physically occupied is transferred (mines/outposts they worked)
- 1–3 vehicles transfer with them
- New faction starts at Neutral relationship
- Founding grievance type shapes their ideology (see FACTIONS.md)

### Relationship States

```
RelationshipState {
  state: RelationshipType
  trust: float              // 0.0–1.0; drifts based on interactions
  active_agreements: Agreement[]
  grievances: Grievance[]   // unresolved incidents that reduce trust
}
```

| State | Trust Range | Transitions |
|-------|------------|------------|
| Unknown | — | → Aware (on first contact) |
| Aware | any | → Neutral (on formal comms) |
| Neutral | 0.3–0.7 | → Trade Partner or Cold War based on actions |
| Trade Partner | 0.5–1.0 | → Alliance or → Neutral (if agreement lapses) |
| Non-Aggression | 0.4–0.8 | Stable middle state; can degrade to Cold War |
| Alliance | 0.7–1.0 | → Non-Aggression (if crisis strains it) |
| Cold War | 0.1–0.4 | → Proxy Conflict (escalation) or → Neutral (diplomatic resolution) |
| Proxy Conflict | 0.0–0.3 | → Open Conflict or → Cold War |
| Open Conflict | 0.0–0.2 | → Absorption or → Non-Aggression (peace deal) |
| Absorption | — | Terminal: one faction ends |

---

## 9. Governance & Time-Delayed Authority

### Overview
The player issues policy. The AI governor executes it locally. The governance delay mechanic means the player cannot micromanage — they set strategy, not tactics.

### Communication Delay

```
communication_delay_years = system_distance_ly / 1.0    // signals travel at c
round_trip_years = communication_delay_years × 2
```

For a system 12 LY away: 24 years round trip. The player issues an order. It arrives 12 years later. A response arrives 12 years after that.

This only applies to **interstellar** communication. Within a system, communication is near-instantaneous (light-seconds to light-minutes).

### AI Governor Behavior

The on-site governor has:
- **Active policy** — the last player-issued instruction set received
- **Autonomy level** — how far the governor can deviate from policy to handle situations

```
governor_autonomy_level: 1–5
1: Minimal — governor only handles life-safety crises without approval
3: Standard — governor can adapt resource allocation and route priorities
5: Full — governor can negotiate with factions, initiate construction, reroute fleet
```

When the governor faces a situation not covered by active policy:
- If `decision_reversibility = reversible` AND `autonomy_level ≥ 2`: governor acts, files report
- If `decision_reversibility = irreversible` AND `autonomy_level < 4`: governor **waits**, files urgent request, queues the decision
- If `decision_reversibility = existential` (life threat, system-loss risk): governor always acts at highest-response level regardless of autonomy

**Design principle:** The governor should preserve options, not optimize. An uncertain governor that does nothing is better than a confident governor that commits to the wrong thing.

### Policy Instruments

The player sets policy across five axes:

| Axis | Range | Effect |
|------|-------|--------|
| **Resource priority** | Survival → Growth → Export | Determines allocation order when supply is constrained |
| **Faction posture** | Cooperative → Neutral → Competitive | Governor's default stance in faction interactions |
| **Expansion rate** | Conservative → Moderate → Aggressive | How fast governor initiates new node construction |
| **Route priority matrix** | Per-route priority 1–5 | Fuel allocation order when tanker supply is constrained |
| **Population allocation** | Per-node crew targets | Governor tries to staff toward these targets |

Policy changes take effect immediately within the system. For a colony the player is governing remotely, policy changes take `communication_delay_years` to arrive.

---

## 10. UI Requirements Summary

### System Orrery (main view)
- All nodes visible as icons, scaled to type
- All active routes shown as lines; color-coded by status (green/amber/red)
- All vehicles in-transit shown as moving dots on route lines
- Click node → Node Detail panel
- Click route → Route Detail panel
- Click vehicle → Vehicle Detail panel
- Claim score overlay (toggle): heatmap of infrastructure density

### Node Detail Panel
- Name, type, faction owner
- Uptime gauge (color: green > 0.7, amber > 0.4, red ≤ 0.4)
- Construction progress (if building)
- Current production rates (inputs consumed, outputs produced per month)
- Crew: assigned / required
- Power: generated / consumed
- Storage: current / capacity per cargo type
- Connected routes (list; click to jump to route)
- Maintenance status + next failure risk estimate

### Route Detail Panel
- Origin → Destination
- Assigned vehicles (list with status)
- Cargo manifest (outbound / inbound; load factor %)
- Load balance score + warning if < 0.4
- Transit time for assigned vehicle class
- Delta-v cost (fuel per run)
- Hazard rating
- Priority setting
- Status (active / disrupted / suspended) + reason if disrupted

### Vehicle Detail Panel
- Name, class, assigned route
- Current status (docked / loading / in-transit / maintenance)
- Cargo currently loaded
- Wear level (gauge) + estimated runs until maintenance due
- Current position (if in-transit: progress bar + ETA)
- Fuel consumption per run

### Logistics Dashboard (overview panel)
- Total active routes: N
- Total vehicles in-service: N (N in maintenance, N breakdown)
- Unbalanced routes flagged (yellow)
- Routes at risk (amber/red uptime or disrupted)
- Fuel depot levels across system (critical if any depot < 20%)
- Cascade risk indicator: which failure would trigger the widest cascade

### Faction Panel
- Each known faction: name, origin type, relationship state, claim score
- Trust meter per faction
- Active agreements list
- Flagged events (grievances, escalation risk)
- Splinter risk meters for own colony population groups

### Governance Panel
- Policy axis sliders (5 axes)
- Governor autonomy level setting
- Message queue (sent orders + ETA + response ETA)
- Pending decisions queue (items the governor is holding for player approval)
- Communication delay indicator (if governing remote colony)
