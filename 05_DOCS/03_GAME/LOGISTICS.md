# Intra-System Logistics

The core gameplay loop of ExoMaps is a **Railroad Tycoon-style freight network** —
but instead of trains on tracks, you're managing vehicles in orbital mechanics.

Nodes produce resources. Nodes consume resources. Vehicles move cargo between them.
You build the network. You assign the vehicles. You watch the economy emerge.

---

## The Analogy

| Railroad Tycoon | ExoMaps |
|----------------|---------|
| Rail depot / city | Orbital station / surface base / asteroid outpost |
| Train route | Established transit corridor (with delta-v cost) |
| Train | Vehicle (lander / barge / spaceplane / tanker) |
| Train type | Vehicle class — determines which routes it can serve |
| Cargo type | Resource tier (raw → processed → finished goods) |
| Revenue = distance × cargo value | Revenue = delta-v cost × cargo value × rarity |
| Expand by laying track to new cities | Expand by establishing nodes and routes to new bodies |
| Train station upgrade | Node upgrade (add refinery, expand docking, add crew quarters) |

---

## Nodes

A **node** is any fixed infrastructure with docking/landing capability and storage.

### Node Types

| Type | Location | Function | Build Cost |
|------|----------|---------|-----------|
| **Orbital Station** | Planet orbit / L-point | Hub: crew, trade, command | Metals + Silicates (high) |
| **Fuel Depot** | Any orbit | Refuel stop; propellant storage | Metals + Volatiles (medium) |
| **Mining Outpost** | Asteroid / small moon | Raw extraction | Metals (low) |
| **Processing Platform** | Near mining zone | Smelt, refine, purify on-site | Metals + Rare Elements (medium) |
| **Surface Base** | Planet / large moon | Crew habitat, ground operations | All categories (high) |
| **Atmospheric Platform** | Gas giant upper atmosphere | He-3 scoop; cloud chemistry | Metals + Carbon (very high) |
| **Lagrange Depot** | L4/L5 of major bodies | Long-term bulk storage, slow freight | Metals (low-medium) |
| **Communication Relay** | Outer system | Delays command signals; critical for governance | Rare Elements (low) |

### Node Uptime

Every node has an uptime that degrades without:
- **Crew** (delivered by shuttle/lander routes)
- **Spare parts** (delivered by freight routes)
- **Power** (solar falls off with distance; fission/fusion for outer system)

Uptime directly multiplies `claim_score`. A mining outpost at 40% uptime contributes 40% of its claim value.

---

## Vehicles

### Intra-System Vehicle Classes

#### 1. Vacuum Lander
> *"The workhorse. Hops between airless bodies."*

Operates on moons, asteroids, rocky planets with < 0.05 bar atmosphere.
Ballistic hops on short runs; low-thrust burns on longer ones. No wings.
High frequency, moderate capacity. The local delivery truck.

| Stat | Value |
|------|-------|
| Atmosphere requirement | None (airless only) |
| Cargo capacity | Low–Medium (10–500 t) |
| Delta-v per run | Low (10–300 m/s typical) |
| Turnaround | Hours to days |
| Best for | Asteroid mine → processing platform; moon surface → orbit |
| Weakness | Useless on atmospheric worlds |

#### 2. Atmospheric Spaceplane
> *"The expensive one. Does what nothing else can — gets through a sky."*

Aerodynamic lift on entry and exit. For planets with > 0.1 bar atmosphere.
Thermal stress on every entry cycle; high maintenance. But far more efficient than pure
rockets for atmospheric worlds.

| Stat | Value |
|------|-------|
| Atmosphere requirement | ≥ 0.1 bar |
| Cargo capacity | Low–Medium (5–200 t) |
| Delta-v per run | Medium (but offset by aerobraking savings) |
| Turnaround | Days (inspection after each entry) |
| Best for | Orbital station ↔ surface base on terran/ocean/arid worlds |
| Weakness | High maintenance; can't operate airless; weather risk |
| Special | Can carry colonists and perishables; pressurized cabin standard |

#### 3. Interorbit Freight Barge
> *"Slow. Enormous. Indispensable."*

The backbone of bulk cargo movement. Doesn't land — transfers at nodes.
Ion or solar sail drive. Runs on weeks-to-months transit timelines.
Assign one and forget it — it runs its route on autopilot indefinitely.

| Stat | Value |
|------|-------|
| Atmosphere requirement | None (orbital only) |
| Cargo capacity | Very High (1,000–100,000 t) |
| Delta-v per run | Very Low (efficient ion drive) |
| Turnaround | Weeks to months |
| Best for | Belt mine → smelting station; outer ice depot → inner refineries |
| Weakness | Slow; can't respond to urgent demand; boarding requires docking |
| Special | Can carry multiple cargo types in segregated bays |

#### 4. Orbital Shuttle
> *"Nobody thinks about it until it stops running."*

Crew transfer only. Moves people between stations in the same orbital zone.
Small, fast, no heavy cargo. If this stops, technicians don't reach their posts.

| Stat | Value |
|------|-------|
| Cargo capacity | Crew only (2–40 people) |
| Delta-v per run | Very Low |
| Turnaround | Hours |
| Best for | Station ↔ station transfers within same orbit band |
| Weakness | Zero cargo; not a freight solution |

#### 5. Fuel Tanker
> *"Your entire fleet stops if this one doesn't run."*

Specialized barge for propellant. The most strategically critical vehicle in the network.
Everything else — landers, spaceplanes, barges — depends on fuel delivery.
A tanker route that gets interdicted or breaks down cascades failures across the system.

| Stat | Value |
|------|-------|
| Cargo | Propellant only (H₂/O₂, LH₂, xenon) |
| Capacity | Medium–Very High |
| Turnaround | Days to weeks |
| Best for | Ice processing depot → fuel depots throughout system |
| Vulnerability | #1 target for hostile interdiction |

#### 6. High-Value Courier
> *"Rare goods don't travel on barges."*

Fast, small, high delta-v. For rare materials, finished goods, VIP passengers, urgent parts.
Expensive to run — fuel per tonne is brutal. Only justified by cargo value.

| Stat | Value |
|------|-------|
| Cargo capacity | Very Low (1–20 t) |
| Delta-v per run | High |
| Turnaround | Days |
| Best for | Novel materials, rare isotopes, critical spare parts, colonist specialists |
| Cost | Highest fuel burn per tonne in the fleet |

---

## Routes

A **route** is a defined transit corridor between two nodes, with:
- An assigned vehicle type (or mixed fleet)
- A cargo manifest (what it carries each direction)
- A schedule (frequency of runs)
- A delta-v cost (determines fuel budget per run)
- A hazard rating (asteroid density, radiation zone, contested territory)

### Route Planning Constraints

| Constraint | Impact |
|-----------|--------|
| Delta-v budget | Higher Δv = more fuel = more cost per run; forces tanker routes to match |
| Transit time | Determines how often a run completes; affects supply lag |
| Vehicle compatibility | Barges can't land; spaceplanes need atmosphere; landers need surface |
| Cargo compatibility | Pressurized goods need pressurized bays; volatiles need special containment |
| Hazard rating | Adds delay chance + damage risk; increases maintenance cost |

### Bidirectional Cargo

Every route runs both directions. Good route design has balanced loads:
- **Outbound:** equipment, crew, spare parts
- **Return:** ore, processed materials, fuel

An unbalanced route (full one way, empty the other) is inefficient — like a train going back empty.
The UI should flag underloaded return legs.

---

## Cargo Tiers

Goods evolve as your colony matures. Early routes carry bulk. Late routes carry value.

### Tier 1 — Bulk Commodities (early game)
Raw extraction, minimal processing. High mass, low value per kg.
Fills barges. Justifies the initial infrastructure investment.

| Good | Source | Destination |
|------|--------|------------|
| Water ice | C-type asteroids, icy moons | Refineries, life support |
| Metallic ore | S/M-type asteroids | Smelting platforms |
| Regolith | Any surface | Ceramics kilns, shielding |
| Raw silicates | Rocky bodies | Glass fabrication |
| Carbonaceous ore | C-type asteroids | Chemical plants |

### Tier 2 — Processed Materials (mid game)
After refinery nodes are established. Lower mass per value than raw goods.
Barges still viable, but couriers start making sense for premium runs.

| Good | Source | Destination |
|------|--------|------------|
| Smelted iron/nickel | Smelting platform | Fabrication stations |
| Electrolytic H₂/O₂ | Ice refinery | Fuel depots, life support |
| Polymer sheets | Chemical plant | Habitat manufacturing |
| Ceramics panels | Kiln | Shielding, surface bases |
| Electronics substrate | High-grade refinery | Assembly nodes |

### Tier 3 — Manufactured Goods (late game)
Products that require significant industrial capacity to create.
Low mass, very high value. Couriers dominate. Barges still for bulk.

| Good | Source | Destination |
|------|--------|------------|
| Structural assemblies | Fabrication station | Construction projects |
| Reactor components | Heavy manufacturing | New stations and ships |
| Medical equipment | Medical fab | All inhabited nodes |
| Sensor arrays | Electronics fab | Survey ships, relay nodes |
| Habitat modules (prefab) | Large assembly platform | Expanding colonies |

### Tier 4 — High-Value / Novel (late game, interstellar justified)
Goods unique to specific conditions. Cannot be sourced locally at destination.
The *only* goods worth shipping across light-years.

| Good | Why it's unique | Examples |
|------|---------------|---------|
| **Vacuum-synthesized crystals** | Perfect lattice structure impossible in gravity well | Optical fibers, processor substrates |
| **Zero-g cast alloys** | Superior mechanical properties from zero-convection cooling | Structural members, bearings |
| **Rare isotopes** | Specific to particular stellar body compositions | He-3 from gas giants; unusual transuranic traces |
| **Adapted biologicals** | Microbes, crops, fungi evolved for specific world chemistry | Agricultural starter kits for new colonies |
| **Cultural goods** | Art, music, literature, genetic diversity | Quality of life; cohesion; diplomacy |
| **Knowledge packages** | Tech licenses, research data, engineering blueprints | Skip research steps; tech transfer agreements |

---

## The Interstellar Trade Layer

Raw materials do **not** cross light-years. The delta-v and transit time make it economically
insane to ship iron ore between star systems — every destination has its own asteroids.

What *does* travel between systems:
- Things that genuinely can't be made locally (rare isotopes, unique biologicals)
- Things cheaper to buy than to develop from scratch (tech packages, finished precision goods)
- Things that have emotional or cultural value (colonists will pay for connection to origin)

**Design rule:** An interstellar cargo manifest should feel like a list of what a newly-founded
colony desperately wishes it could make but can't yet, plus the things that remind people of home.

### Interstellar Route Economics

```
profit = (cargo_value × quantity) - (transit_fuel_cost + crew_time_cost + ship_depreciation)

transit_fuel_cost scales with distance²  (decel costs as much as accel)
cargo_value must therefore scale with uniqueness, not mass
```

A profitable interstellar route in the early game might carry:
- 50 tonnes of precision optical components (vacuum-crystal fab, ~40 LY origin)
- Agricultural seeds genetically adapted to a 0.7g world
- 12 specialist colonists with skills the destination lacks

And nothing else. The ship is mostly empty — because nothing else justifies the trip.

---

## Logistics Failure Modes

The system is designed so that failures cascade realistically:

```
Ice miner goes offline
  → Electrolysis plant runs dry → H₂/O₂ production drops
    → Fuel depot runs low
      → Tanker can't complete runs → fleet grounds
        → Mining outpost loses resupply → goes offline
          → Claim score drops → contested territory window opens
```

Every route has a priority level. High-priority routes get fuel allocation first
when supply is constrained. The player sets priorities. The AI governor honors them.
