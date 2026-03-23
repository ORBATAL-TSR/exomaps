# Structures, Surface Transit & Orbital Routes

*Expansion of DESIGN_SPEC and UI_UX_STRATEGY covering: the bottom build menu,
world-type-specific structures, surface roads and rovers, space station placement,
and the Hohmann vs Brachistochrone route system.*

---

## Table of Contents

1. [Bottom Build Menu — Design](#1-bottom-build-menu--design)
2. [Structure Categories & World Type Filtering](#2-structure-categories--world-type-filtering)
3. [Structure Catalogue](#3-structure-catalogue)
4. [Surface Transit — Roads, Rovers, Hubs](#4-surface-transit--roads-rovers--hubs)
5. [Space Station Placement & Orbit Types](#5-space-station-placement--orbit-types)
6. [Orbital Route Mechanics](#6-orbital-route-mechanics)
7. [Route Designer — UI](#7-route-designer--ui)
8. [Mandate Points — Territory & Influence](#8-mandate-points--territory--influence)
9. [Implementation Notes](#9-implementation-notes)

---

## 1. Bottom Build Menu — Design

### The Concept

A persistent bottom bar, visible whenever the player has a world, orbit, or surface
selected. Divided into two top-level domains: **Colony** and **Navy**. Each expands
into context-sensitive sub-menus. This is the primary way the player places infrastructure.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        (orrery — always behind)                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   [EXTRACT]  [PROCESS]  [STORE]  [LIVE]  [POWER]  [TRANSIT]  ║  [ORBITAL] │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │  [Storage Yard]  [Transit Hub]  [Cargo Pad]  [Ice Silo]  [Ore Bin]  │ │  ← sub-menu
│   └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  [🌍 Surface: TC-e, Sector 4]    Cost: 240t metals · 80t silicates  [✓ BUILD]│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Menu Structure

```
COLONY DOMAIN
├── [EXTRACT]   Mining rigs, drill heads, extraction arrays, scoop platforms
├── [PROCESS]   Smelters, chemical plants, kilns, refineries, electrolysis
├── [STORE]     Storage yards, silos, cryo vaults, pressurized warehouses
├── [LIVE]      Habitat domes, crew quarters, medical, agriculture, civic
├── [POWER]     Reactors, solar arrays, wind turbines, OTEC, thermal taps
└── [TRANSIT]   Roads, launch pads, transit hubs, rover bays, mass drivers

NAVY DOMAIN
├── [ORBITAL]   Stations, depots, platforms, shipyards — by orbit type
├── [FLEET]     Commission new ships, refit existing, assign to routes
└── [ROUTES]    Open the route designer
```

### Context Sensitivity

The sub-menu contents change based on **what is selected** and **what world type it is**.
An ice moon shows different EXTRACT options than a basalt asteroid.
A gas giant shows different LIVE options than a terran surface.

Unavailable structures are shown greyed with a tooltip explaining why:
- `"Requires atmosphere ≥ 0.3 bar"` — landing pad on airless world
- `"Requires Processing Platform (Tier 2)"` — tech prerequisite
- `"Insufficient mandate — claim this territory first"` — territorial constraint

### Placement Flow

```
1. Player clicks BUILD CATEGORY in bottom bar  →  sub-menu expands
2. Player hovers a structure icon              →  tooltip: description, inputs, outputs, cost
3. Player clicks structure icon               →  placement cursor appears on selected surface/orbit
4. Player moves cursor to valid placement spot →  green footprint preview
5. Player clicks to confirm                   →  cost preview shown bottom-right
6. Player clicks [✓ BUILD]                    →  node created at construction: 0%
```

Placement spots are pre-validated. Red footprint = invalid location (wrong world type,
too close to another node, terrain impassable). Green = valid.

---

## 2. Structure Categories & World Type Filtering

### World Type Tags

Each world body carries one or more type tags. Tags determine which structures are available.

| Tag | Examples | Unlocked Structures |
|-----|---------|-------------------|
| `VACUUM` | Airless moon, asteroid, bare rock | Mag-lev, mass driver, surface dome, vacuum lander pad |
| `ATMOSPHERIC` | Terran, desert, tundra, ocean (with atm) | Spaceplane pad, wind turbine, open-air greenhouse |
| `CRYO` | Ice world, frozen moon, cryogenic body | Ice tunneling, cryo vault, subsurface hab, thermal tap |
| `OCEAN` | Water world, ocean world | Sea platform, submarine hab, OTEC, algae farm |
| `GAS` | Gas giant, mini-Neptune | Atmospheric scoop, cloud city, He-3 collector |
| `VOLCANIC` | Lava world, high-volcanism | Geothermal tap, heat exchanger, lava tube hab |
| `TIDAL` | Tidally locked worlds | Terminator settlement, permanent-shade solar, substellar radiator |
| `DUST` | Dusty/sandy bodies | Sealed everything; no open structures; dust filtration mandatory |

Multiple tags can apply. A world that is `CRYO + OCEAN` (subsurface ocean under ice sheet)
unlocks both ice tunneling AND submarine habitats. An `ATMOSPHERIC + TIDAL` world unlocks
terminator settlements with persistent wind energy.

### Implied Unlocks

Some structures are universal regardless of world type:

- **Storage Yard** — always available everywhere
- **Transit Hub** — always available (adapts to local conditions)
- **Comms Array** — always available
- **Power Relay** — always available
- **Basic Habitat Module** — always available (pressurized)

---

## 3. Structure Catalogue

*Cost = one-time build materials. Output = monthly production. Upkeep = monthly consumption.*

### EXTRACT Structures

| Structure | World Tags | Build Cost | Output | Upkeep |
|-----------|-----------|-----------|--------|--------|
| Regolith Drill | VACUUM, CRYO, DUST | 80t metals | 400t regolith/mo | Power, crew ×2 |
| Ice Mining Head | CRYO, OCEAN (frozen) | 100t metals, 20t rare | 600t water ice/mo | Power, crew ×3 |
| Ore Drill | VACUUM, VOLCANIC | 120t metals, 30t rare | 500t ore/mo (type varies) | Power, crew ×3 |
| Deep Shaft | Any solid | 200t metals, 60t rare | ×2 extraction rate on one drill | Power ×2, crew ×4 |
| Atmospheric Scoop | GAS | 180t metals, 40t rare | 8kg He-3/day, 60t compounds/mo | Power ×3, crew ×4 |
| Ocean Extractor | OCEAN | 160t metals, 30t silicates | 800t water/mo, trace minerals | Power ×2, crew ×2 |
| Algae Harvester | OCEAN, ATMOSPHERIC | 60t metals, 40t carbon | 30t food/mo, 10t O₂/mo | Water, Power, crew ×2 |
| Surface Scoop Array | DUST | 90t metals | 200t regolith/mo, 20t carbon | Power, crew ×1 |

### PROCESS Structures

| Structure | World Tags | Build Cost | Converts | Output |
|-----------|-----------|-----------|---------|--------|
| Electrolysis Plant | Any (needs water) | 140t metals, 40t rare | 600t ice → H₂/O₂ | 80t H₂ + 160t O₂/mo |
| Ore Smelter | Any | 200t metals, 60t silicates | 500t ore → metals | 180t metal/mo |
| Chemical Plant | Any | 180t metals, 40t rare | Carbon compounds → polymers | 60t polymers/mo |
| Ceramics Kiln | Any | 100t metals, 60t silicates | Regolith → ceramics | 80t ceramics/mo |
| Rare Refinery | Any | 240t metals, 80t rare | Rare ore → electronics grade | 20t rare/mo |
| Cryo Separator | CRYO | 160t metals, 40t rare | Ice mixture → pure ice + trace compounds | +40% ice yield |
| Lava Tap | VOLCANIC | 200t metals, 80t rare | Heat → power; lava → basalt panels | 200kW + 40t panels/mo |
| Vacuum Forge | VACUUM (orbital/surface) | 300t metals, 80t rare | Metals → vacuum-cast alloys (Tier 4) | 5t premium alloy/mo |

### STORE Structures

Storage structures don't produce — they enable scale. A node's logistics bottleneck
is often storage: a mine that fills up stops mining.

| Structure | World Tags | Build Cost | Capacity Added | Notes |
|-----------|-----------|-----------|---------------|-------|
| **Storage Yard** | Any | 60t metals, 40t silicates | +2,000t bulk | Outdoor/open; no pressurization |
| **Pressurized Warehouse** | Any | 100t metals, 40t silicates | +1,000t pressurized | For gases, biologicals, electronics |
| **Cryo Vault** | Any (insulated) | 140t metals, 20t rare | +500t cryo storage | For frozen embryos, biologicals, He-3 |
| **Ore Bin Complex** | Any solid | 80t metals | +5,000t bulk ore | No power needed; passive |
| **Fuel Tank Farm** | Any | 120t metals, 20t rare | +8,000t liquid H₂/O₂ | Requires insulation on hot worlds |
| **Ice Silo** | CRYO, VACUUM | 80t metals | +4,000t ice | Naturally cold worlds; free upkeep |

**Storage yards are the connective tissue of every colony.** The first thing any new node
needs — before the second drill, before the second smelter — is more storage.
An extraction node with no storage overflow stops working. Build storage first.

### LIVE Structures

| Structure | World Tags | Build Cost | Capacity/Effect | Notes |
|-----------|-----------|-----------|----------------|-------|
| Habitat Dome | Any | 160t metals, 80t silicates, 40t carbon | +80 crew capacity | Standard pressurized habitat |
| Subsurface Hab | CRYO, VACUUM, DUST | 200t metals, 80t silicates | +120 crew, +radiation shield | Better protection; slower to build |
| Sea Platform Hab | OCEAN | 140t metals, 60t carbon | +60 crew, floating | Only on ocean worlds |
| Medical Bay | Any | 80t metals, 40t rare | +morale ×1.15, −death rate | Requires rare elements |
| Greenhouse | ATMOSPHERIC, OCEAN | 60t metals, 40t carbon | +40t food/mo, +morale | Sunlight-dependent; low power |
| Grow Lab (sealed) | VACUUM, CRYO | 100t metals, 40t carbon | +25t food/mo | Artificial lighting; uses more power |
| Civic Centre | Any | 80t metals, 60t silicates | +morale ×1.12, −splinter risk | Requires 200+ population |
| School/Archive | Any | 60t metals, 40t rare | +RP/mo, +ideology alignment | Reduces autonomy drift |
| Lava Tube Hab | VOLCANIC | 120t metals | +150 crew, free radiation shield | Natural shelter; geological risk |

### POWER Structures

| Structure | World Tags | Build Cost | Output | Notes |
|-----------|-----------|-----------|--------|-------|
| Fission Reactor | Any | 200t metals, 80t rare | 200 MW | Reliable baseline; uranium cost |
| Fusion Reactor | Any | 400t metals, 120t rare | 800 MW | Requires Propulsion T3 research |
| Solar Array | ATMOSPHERIC, VACUUM | 80t metals, 60t silicates | 20–60 MW | Scales with stellar distance² |
| Wind Turbine Array | ATMOSPHERIC | 60t metals, 20t silicates | 15–40 MW | Scales with wind speed |
| OTEC Plant | OCEAN | 120t metals, 40t carbon | 30 MW | Ocean thermal gradient; very reliable |
| Geothermal Tap | VOLCANIC | 160t metals, 40t rare | 80 MW | Free after build; geological risk |
| Power Relay | Any | 40t metals | Extends grid 500km | Enables remote node connection |
| RTG Array | Any | 60t metals, 40t rare | 2 MW | Emergency/remote power; 30yr life |

### TRANSIT Structures (Surface)

See §4 for full surface transit design.

| Structure | World Tags | Build Cost | Effect |
|-----------|-----------|-----------|--------|
| Rover Bay | Any solid | 60t metals | Houses 4 rovers; charging/maintenance |
| Unpaved Road (per km) | Any solid | 10t regolith processing | Rover speed ×1.5 on route |
| Paved Road (per km) | Any solid | 20t metals, 10t ceramics | Rover speed ×2.5; all-weather |
| Mag-Lev Segment (per km) | VACUUM, CRYO | 40t metals, 20t rare | Rover speed ×8; vacuum-optimal |
| Transit Hub | Any | 80t metals, 40t silicates | Route transfer node; depot |
| Mass Driver (launch) | VACUUM | 400t metals, 80t rare | Launches cargo to orbit for ~5% rocket cost |
| Spaceplane Pad | ATMOSPHERIC | 120t metals, 60t silicates | Enables atmospheric spaceplane landing |
| Vacuum Lander Pad | VACUUM | 60t metals | Enables vacuum lander landing |
| Orbital Elevator Anchor | ATMOSPHERIC (high mass) | 800t metals, 200t rare | Unlocks orbital elevator (late game) |

---

## 4. Surface Transit — Roads, Rovers, Hubs

### Why Surface Transit Matters

Orbital hops between surface nodes on the same body are expensive and slow.
A vacuum lander burning propellant to travel 80km when you could build a 80km
mag-lev for a one-time cost is economically irrational after year 5.

Surface transit is the **intra-body logistics layer**. Orbital vehicles handle
off-world. Rovers handle on-world. The two connect at Transit Hubs.

### The Three-Layer Surface Network

```
LAYER 1 — NODES (production + habitation)
  Mining Outpost ── 80km ── Processing Platform ── 40km ── Surface Base

LAYER 2 — ROADS (connecting nodes)
  Unpaved tracks initially → paved roads → mag-lev as colony matures

LAYER 3 — TRANSIT HUBS (transfer + staging)
  Where surface routes meet orbital routes — rovers deliver to hubs,
  landers and spaceplanes depart from hubs
```

### Rover Types

| Type | World Tags | Capacity | Speed (on road) | Best For |
|------|-----------|---------|----------------|---------|
| **Crawler** | Any solid | 80t | 15 km/h unpaved, 40 km/h paved | Bulk ore short-haul |
| **Pressurized Hauler** | Any solid | 30t, pressurized | 30 km/h paved | Crew, biologicals, fragile cargo |
| **Ice Rover** | CRYO | 100t | 25 km/h ice road | Ice world bulk transport |
| **Mag-Lev Sled** | VACUUM, CRYO | 200t | 120 km/h on mag-lev | High-volume inter-node in vacuum |
| **Submarine** | OCEAN | 500t | 40 km/h underwater | Ocean world bulk transit |
| **Skimmer** | ATMOSPHERIC (dense) | 20t | 200 km/h | Fast crew/goods in thick atm |

Rovers are **assigned to surface routes** exactly like orbital vehicles are assigned to orbital routes. Same interface, same cargo manifest, same load-balance mechanic. The system is already designed — the vehicle type just changes.

### Road Building

Roads are built segment by segment. Each segment is a fixed km length (configurable: 10, 20, 50km). Cost scales with segment length and road tier.

The route editor works the same way for surface routes: draw a line between two nodes,
the game calculates segment count, shows total build cost and time, and estimates
transit time per rover type once complete.

**Road tiers and when to upgrade:**

```
Unpaved track → useful immediately; cheap; slow; weather-affected (on atm worlds)
Paved road    → upgrade once route volume justifies it; faster; all-weather
Mag-lev       → expensive to build; cheap to operate; ideal for VACUUM/CRYO worlds
               where no weather degrades it and rovers can go very fast safely
```

### Transit Hubs

The physical transfer point between surface vehicles and orbital vehicles.
Think of it as a rail depot meets a launch facility.

A hub has:
- **Rover bays** — parking, charging, maintenance for surface fleet
- **Cargo staging area** — intermediate storage between surface and orbital loading
- **Vehicle dock** — pad or docking interface for landers/spaceplanes
- **Crew transfer lounge** — pressurized transfer between vehicles

Hubs are required whenever you want surface and orbital logistics to connect.
A mining outpost with no hub can only be served by direct lander delivery/pickup.
A mining outpost with a hub can also be served by rovers from a distant surface base
via a road network — usually much cheaper for bulk ore movement.

**Hub upgrade tiers:** Hub T1 handles 200t/day. Hub T2: 1,000t/day. Hub T3: 5,000t/day.
Bottleneck is usually the hub — upgrade it before adding more vehicles.

---

## 5. Space Station Placement & Orbit Types

### Orbit Types Available for Station Placement

When the player selects [ORBITAL] in the Navy build menu, they choose an orbit type
above the selected body. Each has distinct operational trade-offs.

```
BODY: TC-e (1.7 Earth masses, no magnetic field)

Available orbits:
  ● LOW ORBIT        200–500 km       Short period: 92 min    High Δv access to surface
  ● MID ORBIT        2,000–5,000 km   Period: 4–8 hrs         Balanced
  ● HIGH ORBIT       15,000–40,000 km Period: 1–3 days        Stable; low Δv maintenance
  ● SYNCHRONOUS      (if viable)      Period: = planet day     Stationary over one point
  ● L1 POINT         (star-side)      Very stable             Relay, sun shield, telescope
  ● L2 POINT         (anti-star)      Very stable             Relay, deep space comms
  ● L4 POINT         (leading)        Very stable; 60° ahead  Staging, storage, fuel cache
  ● L5 POINT         (trailing)       Very stable; 60° behind Staging, storage, fuel cache
```

### Orbit Trade-off Matrix

| Orbit | Δv to Surface | Station-Keeping Cost | Period | Best For |
|-------|-------------|---------------------|--------|---------|
| Low | Low | High (drag + perturbation) | Short | Frequent surface access, construction support |
| Mid | Medium | Medium | Medium | General purpose hub |
| High | High | Low | Long | Long-term storage, relay, resupply |
| Sync | High | Low (if stable) | Fixed | Communications, observation, permanent presence |
| L1/L2 | Very High | Near zero | — | Relay, science, interstellar gateway |
| L4/L5 | Very High | Zero | — | **Best long-term depots; naturally stable; free upkeep** |

**L4/L5 points are the natural home for fuel caches and staging depots.**
No station-keeping fuel required. Goods can sit there indefinitely. Ships en-route
to or from the system can rendezvous cheaply. These become the hub-of-hubs.

### Station Types Placeable in Orbit

| Station Type | Build Cost | Function | Best Orbit |
|-------------|-----------|---------|-----------|
| **Transit Station** | 300t metals, 80t silicates | Docking, fuel, crew transfer, cargo staging | Low–Mid |
| **Industrial Platform** | 500t metals, 120t rare | Manufacturing, fabrication, assembly | Mid–High |
| **Fuel Depot (orbital)** | 200t metals, 40t rare | Propellant storage + dispensing | L4/L5, High |
| **Science Station** | 240t metals, 80t rare | +RP/mo; observation; atmosphere study | L1, L2 |
| **Shipyard** | 800t metals, 200t rare | Build + refit intra-system vessels | Mid–High |
| **Military Outpost** | 400t metals, 80t rare | System defense, interdiction, patrol | Low–Mid |
| **Comms Relay** | 80t metals, 40t rare | Reduces interstellar comms delay; nav beacon | L1, L2 |
| **Orbital Elevator Terminal** | 1200t metals, 300t rare | Top of orbital elevator (late game) | Sync |

### Multiple Stations at Same Orbit

Multiple stations can occupy the same orbital altitude but at different longitudes.
A ring of 3 fuel depots at L4/L5/High orbit creates redundancy — if one goes offline,
ships can divert to the others. The route editor handles multi-depot routes automatically
(vehicles go to nearest depot with capacity).

---

## 6. Orbital Route Mechanics

### Two Transfer Modes — The Core Choice

Every route between two bodies in the same system uses one of two transfer modes.
This choice is the central trade-off of the logistics game.

---

### Mode A: Hohmann Transfer

**What it is:** An elliptical orbit that touches both the origin and destination orbits
at its endpoints. Minimum energy path. The cheapest way to travel between orbits.

**The catch:** You can only launch during an alignment window — when the two bodies
are positioned correctly so that you arrive at the destination when it's there to meet you.

```
Window frequency = synodic_period(origin_body, destination_body)

synodic_period = 1 / |1/T_inner - 1/T_outer|    (in years)

Example: Inner asteroid belt (2.0 AU, T=2.83yr) → Outer station (3.5 AU, T=6.55yr)
  synodic_period = 1 / |1/2.83 - 1/6.55| = 1 / |0.353 - 0.153| = 5.0 years
```

A 5-year synodic period means a window every 5 years. For a freight barge on a Hohmann
route, this means the player plans departures years in advance and operates multiple
barges on staggered schedules so at least one is always en-route.

**Transfer time (one-way):**
```
transfer_time = π × √( ((r1 + r2)/2)³ / (GM) )    (half the ellipse period)
```

For a 1 AU → 3 AU transfer in a G2V star: approximately 1.3 years transit.

**Fuel cost:** Minimum possible for that Δv. Barges are efficient. Windows are required.

**UI representation:** Dashed curved line on orrery. Window dates shown as a small
calendar icon on the route. Green when window is open; grey when closed.

---

### Mode B: Brachistochrone Transfer

**What it is:** Continuous thrust from departure to arrival. Accelerate for the first
half. Flip and decelerate for the second half. The straight-line (ish) route.
No waiting for windows. Just burn.

```
transit_time = 2 × √(distance / acceleration)

fuel_mass = initial_mass × (1 - e^(-Δv/Isp))    (Tsiolkovsky)
```

With antimatter drives (Isp ~50,000s) at 0.01g acceleration:
- 1 AU → 3 AU transit ≈ 6 weeks (vs. 16 months Hohmann)
- Fuel cost: 4–8× higher than Hohmann for same payload

**When to use:**
- Emergency cargo (life support supply to failing node)
- High-value rare goods (Tier 4 — the margin justifies the fuel)
- Personnel transfer (humans don't want to spend 16 months in transit)
- Military response (getting patrol ships where they're needed fast)

**UI representation:** Straight line on orrery (vs. curved Hohmann arc).
Color: bold white/gold to distinguish from Hohmann. Fuel cost shown prominently in red if high.

---

### The Player Decision

The route editor presents both options whenever a new route is created:

```
┌────────────────────────────────────────────────────────────────────┐
│  ROUTE: Marta-7 → Kovač-Main                                       │
│  ──────────────────────────────────────────────────────────────── │
│  ◎ HOHMANN TRANSFER                   ○ BRACHISTOCHRONE            │
│  ────────────────────────────────     ───────────────────────────  │
│  Transit time:   14 months            Transit time:   6 weeks      │
│  Fuel per run:   820 t H₂             Fuel per run:   4,100 t H₂  │
│  Next window:    Month 4 (11 mo)      Available:      Always       │
│  Window freq:    Every 28 months      Fuel premium:   ×5.0        │
│                                                                    │
│  Recommended: HOHMANN for bulk ore (time insensitive, cost matters)│
│  Use BRACHIO for: emergency supply, rare goods, crew transfer      │
└────────────────────────────────────────────────────────────────────┘
```

The game makes a recommendation but lets the player override. A player who sends
bulk ore on Brachistochrone will see their fuel depot drain visibly fast and understand
why the recommendation existed.

### Alignment Windows — The Calendar

The route editor has a **Window Calendar** panel — a 24-month forward view showing
all upcoming Hohmann windows for all your defined routes.

```
  MONTH  1  2  3  4  5  6  7  8  9  10  11  12  13  14  15  16...
  ──────────────────────────────────────────────────────────────────
  Marta→Kovač                  [████]                    [████]
  Belt→L4 Depot      [██]                [████]               [██]
  Inner→Outer        [██████████]                   [████████████]
  Kovač→TC-e orbit                   [████]                    [██]
```

Green bars = open windows. Grey gaps = windows closed. Clicking a window shows the
exact departure date that gives optimal trajectory. The player can queue vehicle
departures against these windows.

**Strategic implication:** A player with many Hohmann routes must plan departure
schedules months or years ahead. Missing a window can mean a 2–5 year wait for the
next one. This creates genuine planning puzzles — especially when two routes you
need have conflicting windows.

### Mixed-Mode Routes (Practical Optimisation)

Some routes are so short that Hohmann vs Brachistochrone barely differ in fuel cost.
The game flags these as **"alignment-insensitive"** — small bodies close together
can effectively be served at any time. These are the routes that work like railroads —
just run them constantly without thinking about windows.

Routes between planets in different orbital zones are the ones that require planning.

---

## 7. Route Designer — UI

Expands the existing route editor (UI_UX_STRATEGY §6) with orbital mechanics awareness.

### Transfer Mode Toggle

Added to the Route Edit panel:

```
Transfer Mode:  [● HOHMANN]  [○ BRACHISTOCHRONE]  [○ MIXED (auto)]
```

**MIXED (auto):** The governor selects mode based on cargo type and urgency.
Tier 1/2 bulk → always Hohmann. Tier 4 / life support / personnel → Brachistochrone
if window wait > 30 days. This is the default for players who don't want to think about it.

### Window Scheduling

When Hohmann is selected, the Route Edit panel shows:

```
Next window opens:  Month 4  (11 months away)
Window duration:    3 months
Queued departures:
  ► IFB MERIDIAN SLOW — departs Month 4, Day 8  [edit]  [remove]
  ► IFB NORTH WIND   — departs Month 5, Day 22  [edit]  [remove]
  [+ Queue departure]
```

Players queue departures during windows. If a vehicle is not ready in time
(maintenance overdue, not yet back from previous run), the game alerts and offers
the next viable departure opportunity.

### Route Visualisation on Orrery

In route-editing mode:
- **Hohmann routes** — dashed arc following the transfer ellipse geometry
- **Brachistochrone routes** — bold straight line
- **Surface routes** — solid line following terrain contour on body surface
- **Window open** — route line glows green
- **Window closed** — route line dims to grey
- **Vehicle in transit** — animated dot moving along line

The orrery shows real orbital positions of all bodies updating in real time as the
game simulates. Watching a barge arc across the system on a Hohmann transfer toward
a body that's moved significantly during transit is genuinely satisfying.

---

## 8. Mandate Points — Territory & Influence

### The Problem They Solve

Not every territory is empty. Claiming a new asteroid belt sector, establishing
presence in an orbit band already contested, or formally declaring sovereignty over
a system all require political capital — not just materials. This is **Mandate Points (MP)**.

MP represents your faction's accumulated legitimacy, political credibility, and
willingness to commit. It's a soft power resource.

### Earning Mandate Points

| Action | MP Earned |
|--------|----------|
| Each year of positive financial health | +2 MP/year |
| Trade agreement honored at full term | +3 MP on completion |
| Research tier completed | +2 MP |
| Crisis resolved without faction conflict | +4 MP |
| Population milestone (each 1,000 new colonists) | +1 MP |
| First structure of a new node type built | +2 MP |
| Cultural output (civic center active, 100+ pop) | +1 MP/year |
| Another faction endorses you diplomatically | +5 MP (one-time) |

### Spending Mandate Points

| Action | MP Cost | Notes |
|--------|---------|-------|
| Claim an unclaimed body | 5 MP | Only needed for contested systems |
| Claim contested territory | 15–30 MP | Higher if rival already present |
| Formal colony declaration (system sovereignty) | 40 MP | Signals intent to entire system |
| Initiate a faction merger offer | 20 MP | You're absorbing them diplomatically |
| Override governor on irreversible decision | 10 MP | Forcing through a decision without consensus |
| Establish interstellar trade route (formally) | 25 MP | Creates permanent route designation |
| Break a trade agreement without penalty | 15 MP | Use political capital to absorb the relationship hit |
| Call emergency assembly (multi-faction) | 8 MP | Pause all conflict for 6 months to negotiate |

### The Flow of Mandate

MP does not build up indefinitely. A colony that sits on unspent mandate will find
that rivals begin to erode contested claims passively — the "use it or lose it" principle.

```
mp_decay_per_year = max(0, (mp_current - mp_reserve_floor) × 0.05)
mp_reserve_floor  = 20   // base buffer below which no decay occurs
```

A player with 80 MP loses 3 MP/year passively. This discourages banking.
The game nudges: spend MP on expansion when you have it, or watch rivals fill the gap.

### MP and Energy — Two Separate Levers

MP = **political legitimacy** (relationship-based, earned over time, spent on claims and diplomacy)

**Energy Credits (EC)** = **operational velocity** (production-based, earned by efficiency, spent on acceleration)

EC earns whenever your colony runs above financial_health > 1.5. It's the surplus of
a working economy converted into the ability to go faster:

| Action | EC Cost |
|--------|---------|
| Rush construction (−50% time, same materials) | 20 EC |
| Emergency vehicle commissioning | 15 EC |
| Priority route activation (bypass window wait) | 25 EC |
| Boost research track for one month (×3 RP) | 30 EC |
| Rapid terraforming phase (+10% rate for 12 months) | 50 EC/month |

EC cannot be stored above 100. A productive colony is constantly generating the
capacity to do things faster — the player who ignores EC is wasting it.

---

## 9. Implementation Notes

### What's Already Built in VITA

The following patterns from SystemFocusView + OrreryComponents map directly:

| New Feature | Existing Pattern |
|------------|-----------------|
| Bottom build menu | `GpuStatusBar` bottom bar pattern; tab-strip interaction |
| Structure placement cursor | `Html` overlay component; raycasted position on body mesh |
| Road segments on surface | `MoonOrbitLine` → surface-projected LineSegments |
| Rover dots on surface routes | `OrbitingMoon` pattern → surface-anchored traversal |
| Transit hubs as nodes | `HabitatStation` + `HabitatOrbitRing` patterns |
| Station placement at L-points | `OrreryBody` with `orbit_radius = L_point_distance`; L-points are computed positions |
| Hohmann arc rendering | `THREE.EllipseCurve` → `THREE.Line2`; geometry from Δr1, Δr2 |
| Brachistochrone straight line | `THREE.LineDashedMaterial` between two orbital positions |
| Window calendar | `BiomeInfoPanel` panel pattern; scrollable table in `Html` |

### New Systems Required

| System | Complexity | Approach |
|--------|-----------|---------|
| World type tagging | Low | Add `tags: WorldTypeTag[]` to body/node data model |
| Build menu filter | Low | Filter `NodeType[]` by `compatible_tags` intersection |
| Surface route pathfinding | Medium | A* on a surface mesh; pre-bake for each body |
| Orbital mechanics calc | Medium | Pre-compute synodic periods and Hohmann Δv offline; store as lookup table |
| Window calendar | Medium | Time-series of window open/close events per route pair; re-compute on demand |
| Mandate/EC points | Low | Two additional float values in faction state; earn/spend hooks on existing events |
| Rover vehicles | Low | VehicleClass enum + `surface: true` flag; reuse route/vehicle system |

### The 20% Rule

All of this builds on the logistics graph that's already designed. The surface transit
system is literally the same route+vehicle model with `surface: true`. The orbital mechanics
are a transfer_mode flag that swaps two math functions. The build menu is a filtered view
of the existing NodeType catalogue. The structure catalogue is an extension of the
existing node data model.

**80% of the new content is data. 20% is new code.** The architecture already supports it.
