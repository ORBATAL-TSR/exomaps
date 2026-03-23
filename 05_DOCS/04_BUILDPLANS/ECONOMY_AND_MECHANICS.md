# Economy & Game Mechanics

*Companion to DESIGN_SPEC.md. Covers the economic model, value theory, production math,
trade mechanics, technology progression, time model, and player agency.*

---

## Table of Contents

1. [What Value IS in This Game](#1-what-value-is-in-this-game)
2. [Currency Model](#2-currency-model)
3. [Supply, Demand & Pricing](#3-supply-demand--pricing)
4. [Node Economics](#4-node-economics)
5. [Route Economics & ROI](#5-route-economics--roi)
6. [Labor & Population Economics](#6-labor--population-economics)
7. [Intra-System Trade](#7-intra-system-trade)
8. [Interstellar Trade Economics](#8-interstellar-trade-economics)
9. [Faction Economics](#9-faction-economics)
10. [Technology Progression](#10-technology-progression)
11. [Time Model & Game Mechanics](#11-time-model--game-mechanics)
12. [Crisis Mechanics](#12-crisis-mechanics)
13. [Economic Victory Conditions](#13-economic-victory-conditions)

---

## 1. What Value IS in This Game

This is not a gold-coin economy. There is no universal currency. Value in ExoMaps is:

**Flow rate × scarcity × location.**

- A tonne of ice in a well-stocked depot is nearly worthless.
- The same tonne of ice at an outpost that has been without water for 40 days is worth more than almost anything.
- A kilo of vacuum-synthesized optical crystal can't be made anywhere with a gravity well, so it commands a premium anywhere it arrives.

Value is not stored. It is created by moving the right material to the right place at the right time. This is the railroad tycoon insight: you don't win by hoarding ore. You win by building the network that moves it more efficiently than anyone else.

**Three economic goods:**
1. **Bulk commodities** — low value/kg, high volume, always in demand, always producible locally given the right infrastructure. Movement is the game.
2. **Processed goods** — moderate value/kg, requires investment in production nodes. Margin comes from the infrastructure gap between producer and consumer.
3. **Premium goods** — high value/kg, production requires either rare conditions (vacuum, specific mineral deposits, specific chemistry) or accumulated industrial complexity. These goods justify long-haul routes.

---

## 2. Currency Model

### Internal Accounting — Credits

Each faction uses an internal unit of account: **credits (Cr)**. Credits represent:
- Estimated labor cost to produce a unit of output
- Denominated in: 1 Cr ≈ 1 person-hour of skilled labor at baseline productivity

Credits are used for:
- Internal resource allocation tracking (does this node owe that node?)
- Evaluating whether a production chain is profitable
- Setting trade offer prices with other factions

Credits are **not** a physical commodity. They do not travel on barges. They are accounting.

### Inter-Faction Exchange — Goods-for-Goods

Between factions, trade is settled in physical goods or services, not credits. A trade agreement might read:

> *Marta Collective delivers 800 t/month of smelted iron to Kovač-Main in exchange for 120 t/month of polymer sheet and 40 t/month of prefab habitat modules.*

Both sides denominate their offer in credits to verify the exchange is balanced, then they execute it in physical cargo. If credits don't balance, one side pays a shortfall premium in some scarce good the other faction actually needs.

**There is no interstellar currency.** A star system 40 LY away has no way to enforce or redeem a credit note. Interstellar trade is settled exclusively in high-value physical goods that the destination cannot produce locally.

---

## 3. Supply, Demand & Pricing

### Demand Curve Per Node

Every node has a `demand_schedule` — how much of each cargo type it wants per month and what it's willing to "pay" (in credit-equivalent value) at each supply level:

```
demand_schedule[cargo_type] = {
    critical_floor_t:   float,   // below this = life threat or production halt
    operating_target_t: float,   // comfortable operating level
    surplus_ceiling_t:  float,   // above this = storage full, stops accepting
    critical_price:     float,   // price/t when below critical_floor
    operating_price:    float,   // price/t at normal operating level
    surplus_price:      float,   // price/t above operating_target (discount)
}
```

Price is not set globally. It is set per node per cargo type based on that node's current inventory level relative to its own demand schedule.

```
price_per_t(node, cargo) =
    if inventory < critical_floor:     critical_price
    elif inventory < operating_target: lerp(critical_price, operating_price, t)
    elif inventory < surplus_ceiling:  lerp(operating_price, surplus_price, t)
    else:                              0  // node won't accept more
```

### Market Discovery

Nodes don't broadcast their prices system-wide automatically. The player's logistics network discovers prices through **active routes and trade visits**. A node your ships haven't visited in 180 days may have a stale price in your dashboard.

This creates an information advantage: players who run frequent routes have accurate price data; players with sparse networks are flying partially blind.

### Price Shocks

Events that cause sudden demand spikes create price shocks:

| Event | Affected Cargo | Price Effect |
|-------|---------------|-------------|
| Node population spike (new arrivals) | Food, water, O₂ | +60–120% for 3–12 months |
| Reactor failure | Fuel, spare parts | +200–400% at affected node |
| Mining outpost offline | Downstream ore types | +40–80% at processing nodes |
| New construction project | Metals, silicates | +30–60% for project duration |
| Route disruption (faction conflict) | All cargo on disrupted route | +80–150% at isolated node |

Price shocks are visible on the logistics dashboard as red flags. They represent trading opportunities — and, if unaddressed, cascade risks.

---

## 4. Node Economics

### Margin Per Node

Each node has a monthly economic summary:

```
node_margin = revenue - operating_cost

revenue      = Σ(output_delivered_t × selling_price_per_t)
operating_cost = crew_cost + power_cost + maintenance_cost + input_cargo_cost

crew_cost        = crew_count × labor_rate_per_person_month
power_cost       = power_consumed_kw × power_rate
maintenance_cost = base_maintenance × (1 / redundancy_level) × age_modifier
input_cargo_cost = Σ(input_cargo_t × purchase_price_per_t)
```

A node with a negative margin is a **strategic node** — it operates at a loss because it enables other nodes to function (fuel depots, relay stations, life support outposts). These are not errors. They are infrastructure.

A node with a positive margin is a **productive node** — it generates economic surplus that funds expansion.

The ratio of strategic to productive nodes determines your colony's financial health:
```
financial_health = Σ(productive_node_margins) / Σ(|strategic_node_losses|)
financial_health > 2.0 → surplus economy (can fund expansion)
financial_health 1.0–2.0 → balanced (stable, limited expansion)
financial_health < 1.0 → deficit economy (draws down reserves; unsustainable)
```

### Node Return on Investment

Build decisions should be evaluated on ROI:

```
node_roi_years = build_cost_Cr / monthly_margin_Cr × 12

build_cost_Cr = Σ(all_material_inputs × credit_value) + construction_crew_months × labor_rate
```

Guidelines:
- Mining outpost → processing platform route: typical ROI 2–5 years
- Orbital station (hub): 8–15 years (strategic value exceeds direct margin)
- Atmospheric platform (He-3): 15–30 years (high build cost, high eventual output)
- Shipyard: 20–40 years (enables Wave-independent ship construction — strategic, not margin)

---

## 5. Route Economics & ROI

### Profit Per Run

```
run_profit = (cargo_delivered_t × destination_price)
           - (cargo_purchased_t × origin_price)
           - fuel_cost_per_run
           - vehicle_wear_cost_per_run
           - crew_cost_per_run

fuel_cost_per_run    = delta_v × vehicle_mass × fuel_price_per_kg
vehicle_wear_cost    = (wear_per_run / wear_to_breakdown) × vehicle_replacement_cost
crew_cost_per_run    = crew_count × daily_rate × transit_days × 2
```

### Margin vs. Volume Trade-off

| Route Type | Margin/t | Volume | Total Profit |
|-----------|---------|--------|-------------|
| Bulk ore barge | Low (2–5 Cr/t) | Very High (50,000 t/run) | High absolute |
| Processed metals courier | Medium (15–40 Cr/t) | Medium (200 t/run) | Medium absolute |
| Premium goods courier | High (200–2000 Cr/t) | Very Low (5–20 t/run) | High absolute |
| Fuel tanker | Negative margin | — | Strategic only |

Fuel tanker routes never make money directly — fuel is priced at production cost to keep network running. They exist to enable everything else. Their value is captured by the nodes they keep alive.

### The Empty Return Problem

A route carrying full loads one way and empty the other runs at ~50% efficiency. The game penalizes this:

```
route_efficiency = (outbound_load_factor + inbound_load_factor) / 2
route_fuel_cost  = base_fuel_cost / route_efficiency   // empty vehicles still burn fuel
```

A perfectly balanced bidirectional route (both directions full) pays 50% less fuel per tonne delivered than a one-way route. Finding the return cargo is part of the route design puzzle.

---

## 6. Labor & Population Economics

### Population as the Core Constraint

In the early game, the binding constraint is almost never resources — it's **people**. You don't have enough crew to staff every node at full capacity. Choices about where to allocate crew are among the most consequential the player makes.

```
system_total_crew = Σ(node_crew_assigned[i])
                  ≤ total_colony_population × workforce_participation_rate

workforce_participation_rate = 0.65 base
  + medical_quality_modifier       // better medicine → more working years
  - average_morale_penalty         // low morale → more sick days, early retirement
```

### Labor Allocation

The player sets **crew targets** per node. The governor tries to staff toward those targets. When total crew demand exceeds supply, the governor uses a priority queue:

```
labor_priority_order:
  1. Life support nodes (survival)
  2. Fuel production nodes (everything stops without fuel)
  3. Nodes with highest margin
  4. Nodes under construction
  5. Strategic nodes (relays, depots)
```

The player can override this priority. If you force crew onto a vanity construction project at the expense of a fuel depot, the game will let you do that, and then the fuel depot will fail.

### Labor Cost

```
labor_rate_per_person_month = base_rate × morale_modifier × skill_modifier × local_cost_of_living

morale_modifier      = lerp(0.7, 1.3, morale)   // low morale → demand more or work less
skill_modifier       = lerp(0.8, 1.6, expertise) // high-skill crew cost more, produce more
cost_of_living       = f(local_supply_of_food_water_O2, comfort_index)
```

### Population Growth

```
population_growth_rate = birth_rate - death_rate + immigration_rate - emigration_rate

birth_rate      = base_0.018 × health_index × stability_index
death_rate      = base_0.012 × (1 / health_index) × accident_rate
immigration     = f(colony_attractiveness, available_housing, Wave arrivals)
emigration      = f(autonomy_desire, economic_satisfaction, faction_pull)
```

Population growth is slow by design. You cannot expand faster than your housing, food, and air supply support.

### Morale

Morale is a colony-wide metric (0.0–1.0) that multiplies workforce output:

```
morale = weighted_average(
    economic_satisfaction   × 0.30,
    safety_index            × 0.25,
    social_richness         × 0.20,
    ideological_alignment   × 0.15,
    communication_with_home × 0.10
)
```

`social_richness` — whether the colony has cultural spaces, entertainment, education, variety of social roles. A colony that is nothing but miners and engineers in a pressure can will have low social richness regardless of pay. This is what makes the COMMONS ship (Story 01) economically important, not just humanistically.

Low morale → high emigration risk → splinter preconditions → faction fragmentation.

---

## 7. Intra-System Trade

### Trade Agreement Structure

Between two nodes (or two factions), a trade agreement defines:

```
TradeAgreement {
  parties: [faction_id, faction_id]
  cargo_type: CargoType
  volume_t_per_month: float
  price_per_t: float           // in Cr; fixed for agreement duration
  duration_months: int         // after which it must be renewed or renegotiated
  delivery_node_id: string     // where physical cargo is transferred
  penalty_clause: float        // Cr penalty if either party fails to deliver
}
```

Agreements can be:
- **Exclusive** — seller agrees not to sell this cargo type to another party above a defined volume cap
- **Indexed** — price adjusts monthly to the node's current demand-curve price (no fixed price, just committed volume)
- **Emergency override** — seller may divert cargo in declared emergency; no penalty

### Spot Trading

Outside formal agreements, nodes can trade on a spot basis whenever a vehicle is docked:

- Player (or governor) reviews what the docked node is offering / requesting
- Agrees to load specific cargo at the node's current spot price
- This is opportunistic trading — it doesn't replace agreements but can exploit price shocks

### The Intermediary Role

Independent operators (see FACTIONS.md) frequently act as intermediaries: they buy at production nodes where your routes don't reach, carry to nodes where demand is high, and pocket the spread. This is not inherently hostile — they are providing a logistics service you're not providing.

The player can:
- **Compete** — extend your own routes to cut them out
- **Formalize** — offer them a carrying contract (they become a de facto logistics partner)
- **Ignore** — let them operate; they reduce your margins but also reduce your route management burden

---

## 8. Interstellar Trade Economics

### The Fundamental Rule

**Raw materials never cross light-years.** The delta-v budget and transit time make it economically impossible. Every inhabited star system has its own asteroids.

What crosses light-years must satisfy:

```
interstellar_viable = (value_per_kg > interstellar_freight_cost_per_kg)
                    AND (destination_cannot_produce_locally)

interstellar_freight_cost_per_kg ≈ 8,000–40,000 Cr/kg
  (varies with distance, ship class, antimatter price at origin)
```

At these costs, bulk ore (~1 Cr/kg) is never viable. Vacuum crystals (~50,000 Cr/kg) are.

### Interstellar Cargo Tiers

| Tier | Value/kg (Cr) | Examples | Viable Distance |
|------|-------------|---------|----------------|
| Never | < 100 | Raw ore, ice, regolith | Local only |
| Marginal | 100–1,000 | Processed metals, polymers | < 3 LY, and only in scarcity |
| Viable | 1,000–10,000 | Precision components, medical equipment, specific alloys | < 20 LY |
| Premium | 10,000–100,000 | Vacuum crystals, rare isotopes, biotech | < 80 LY |
| Strategic | > 100,000 | Knowledge packages, unique biologicals, antimatter seed fuel | Any distance |

### Knowledge Packages

The highest-value interstellar good is **information**:
- A research breakthrough achieved at 12 LY can be transmitted at the speed of light
- But *verified, licensed, implementation-ready* knowledge — the actual engineered package — may require a physical data carrier or a skilled team
- A knowledge package might represent 50 years of accumulated research that saves the receiving colony 40 years of development time
- Value: `(years_saved × colony_GDP_per_year × 0.10)` — typically 500,000–5,000,000 Cr per package

This is why establishing comms relay networks (Story 01: HERALD-6) has long-term economic value. A colony with a high-quality relay link to nearby systems can sell research faster, buy knowledge faster, and govern remotely with less delay.

### Interstellar Route Profitability

```
interstellar_run_profit =
    (cargo_value_at_destination - cargo_cost_at_origin)
    - antimatter_cost (scales with mass × distance²)
    - crew_cost (transit_years × crew_count × annual_rate)
    - ship_depreciation (fraction of ship_replacement_cost per run)

break_even_cargo_value = antimatter_cost + crew_cost + depreciation + origin_cost
```

An interstellar route typically requires 3–5 years of profitable runs before the ship's construction cost is recovered. The player is making a multi-decade economic commitment when they commission an interstellar freighter.

---

## 9. Faction Economics

### Economic Leverage

Economic relationships are diplomatic instruments. The most powerful lever is not military — it's **dependency**.

```
faction_dependency(A_on_B) = Σ(cargo_types where A cannot self-supply)
                              weighted by (criticality × volume)
```

If Faction A gets 80% of its fuel from Faction B's electrolysis plants because A colonized a dry asteroid zone, then B has enormous leverage over A. B can:
- Raise prices (extract economic surplus from A)
- Threaten supply (coerce political concessions from A)
- Cut supply (cripple A economically — but risks open conflict and retaliation)

The game calculates and displays dependency scores for all faction pairs. Players should understand their own dependencies and others'.

### Trade as a Diplomatic Instrument

| Action | Effect on Relationship | Economic Effect |
|--------|----------------------|----------------|
| Offer below-market price | `trust += 0.05/month` | Short-term margin loss |
| Offer exclusive agreement | `trust += 0.08` one-time | Locks competitor out of supply |
| Honor agreement during own shortage | `trust += 0.12` one-time | Costly self-sacrifice; builds deep trust |
| Break agreement | `trust -= 0.20` + grievance | Saves short-term; costly long-term |
| Embargo | `trust -= 0.30` + Cold War risk | Weaponizes dependency |
| Cancel embargo | `trust += 0.05` | Relationship recovery is slow |

### Economic Sanctions & Embargo

A faction can declare a **trade embargo** against another:
- All trade agreements with that faction suspended immediately
- Spot trading blocked
- Shared route access revoked (if any cross-faction routes exist)
- Both factions' logistics networks must reroute or absorb shortfalls

Embargos hurt both sides. The side with lower dependency on the other survives better. They are best used when:
1. Your dependency on the target is very low
2. Their dependency on you is very high
3. You have an alternative supplier lined up

Using an embargo otherwise is economic self-harm for political theater.

---

## 10. Technology Progression

### Research Model

Technology unlocks in tiers. Research happens at **lab nodes** and accumulates **research points (RP)** per month:

```
rp_per_month = Σ(lab_node_output × crew_expertise_modifier × uptime)
```

Research is directed — the player allocates RP across active research tracks. Multiple tracks can run simultaneously; each gets a fraction of total RP.

### Research Tracks

| Track | Unlocks | Prerequisite |
|-------|---------|-------------|
| **ISRU Efficiency** | Better extraction yields, lower water contamination handling | Mining Outpost (L1) |
| **Advanced Smelting** | Higher-purity metals, titanium alloy production | Processing Platform (L1) |
| **Life Support** | Lower crew-per-habitat requirement, higher morale bonus | Surface Base (L1) |
| **Propulsion** | Improved vehicle delta-v envelope; lower fuel burn | Any shipyard |
| **Atmospheric Engineering** | Terraforming step unlock; atmospheric platform efficiency | Lab node (L2) |
| **Semiconductor Fab** | Electronics production; unlocks advanced sensors and computers | Processing Platform (L2) |
| **Bioengineering** | Adapted crop yields; colonist health improvement; terraforming organisms | ROOTS-class node |
| **Vacuum Synthesis** | Produces Tier-4 premium goods (crystals, zero-g alloys) | Lab node (L3) + zero-g platform |
| **Antimatter Production** | Local antimatter production; removes dependency on supply from origin | Advanced reactor (L3) |

### Technology Tiers Per Track

Each track has 3–5 tiers. Higher tiers require:
- Previous tier complete
- Required node type at minimum level
- RP threshold (grows exponentially per tier)
- Sometimes: a knowledge package from another system (accelerates by 30–60%)

```
rp_required[tier] = base_rp × (2.5 ^ tier)   // roughly doubles each tier
```

### Technology Transfer

When a knowledge package arrives from another system:
- The receiving faction's RP requirement for the specified research track is reduced by `package_quality × 0.5`
- Maximum reduction: 60% of original RP requirement
- The selling faction receives the agreed payment (typically high-value goods or a return knowledge package)

This creates an economic incentive for establishing interstellar communication infrastructure early.

---

## 11. Time Model & Game Mechanics

### Time Scale

The game runs in **simulated months** at a configurable speed:

| Speed Setting | Real time per simulated month |
|--------------|------------------------------|
| Paused | — |
| Slow | 20 seconds |
| Normal | 8 seconds |
| Fast | 2 seconds |
| Very Fast | 0.5 seconds |

Player can pause at any time. Events that require attention auto-pause.

### The Monthly Tick

Each simulated month, in order:

```
1. PRODUCTION TICK
   Each node runs one production cycle (if inputs available + uptime > 0)
   Output added to node storage

2. CONSUMPTION TICK
   Crew life support consumed (food, water, O₂)
   Power consumed
   Maintenance degradation applied

3. LOGISTICS TICK
   Vehicles in-transit advance toward destination
   Vehicles at destination: unload, reload, depart (per schedule)
   Vehicle wear incremented

4. ECONOMICS TICK
   Node margins calculated
   Trade agreements executed (cargo physically moves if vehicles available)
   Credit balances updated
   Price curves updated based on current inventory vs. demand schedule

5. POPULATION TICK
   Birth/death rates applied
   Morale updated
   Autonomy desire / ideology drift applied
   Splinter risk recalculated

6. FACTION TICK
   Relationship trust values drift (toward neutral if no interactions)
   Active agreements checked for breach
   Faction AI evaluates strategic options

7. RESEARCH TICK
   RP accumulated
   Active research tracks advanced
   Tier completions checked → unlock events

8. EVENTS TICK
   Random events evaluated (probability × current conditions)
   Triggered events queued for player notification
```

### Player Actions Per Month

The player is not turn-limited. They can:
- Pause and issue any number of orders
- Orders execute asynchronously on the next relevant tick
- Orders queue if they depend on a future state (e.g., "assign vehicle X to route Y once vehicle X completes current run")

**What the player directly controls:**
- Node build queue and construction crew allocation
- Route definitions and cargo manifests
- Vehicle assignments
- Trade agreement negotiations (accept/counter/reject)
- Research track allocation
- Policy axes (see DESIGN_SPEC §9)
- Diplomatic actions (messages, proposals, responses)

**What the governor controls automatically:**
- Day-to-day logistics optimization within defined routes
- Crew allocation toward player-set targets
- Emergency rerouting within governor autonomy level
- Responding to small events below player notification threshold

### Decision Weight

Not all decisions are equal. The game categorizes decisions:

| Weight | Description | Reversible | Examples |
|--------|-------------|-----------|---------|
| **Tactical** | Small, frequent, low-stakes | Yes, immediately | Adjust cargo manifest, change vehicle schedule |
| **Operational** | Moderate impact, medium frequency | Yes, with delay | Build a new node, change route priority |
| **Strategic** | High impact, infrequent | Mostly | Found new station, sign exclusive agreement, initiate terraforming |
| **Founding** | Permanent or near-permanent | No | Arrival decisions, commit to terraforming a world, split from/absorb a faction |

Founding decisions always present a confirmation dialog that clearly states: **this cannot be undone.**

---

## 12. Crisis Mechanics

### Crisis Categories

| Category | Trigger | Cascade Risk | Player Window |
|----------|---------|-------------|--------------|
| **Supply Emergency** | Critical cargo below critical_floor at inhabited node | High (life support → crew mortality) | Days |
| **Infrastructure Failure** | Node uptime collapses to zero | Medium (downstream nodes starved) | Weeks |
| **Fuel Shortage** | System-wide fuel depot < 10% capacity | Very High (all routes ground) | Weeks |
| **Faction Conflict** | Route interdiction or node seizure | Medium (economic disruption) | Months |
| **Population Crisis** | Morale < 0.25 sustained 6+ months | High (splinter risk, emigration) | Months |
| **Cascade Failure** | 3+ nodes offline simultaneously | Existential | Days to weeks |

### Crisis Response Options

Every crisis event card presents 2–4 response options with explicitly stated consequences. Options vary by:
- Speed of resolution
- Resource cost
- Relationship effects (if faction-related)
- Residual risk after resolution

The player can also choose not to respond — the game will continue simulating the cascade. Some players will learn from watching a colony slowly fail. The game does not protect you from your own inaction.

### Cascade Failure Detection

The logistics dashboard has a **cascade risk indicator** that runs continuously:

```
cascade_risk_score = Σ(
    node_criticality[i] × (1 - uptime[i]) × downstream_dependency_count[i]
)

if cascade_risk_score > threshold: → amber warning
if cascade_risk_score > 2× threshold: → red warning + auto-pause option
```

This is the equivalent of a railroad dispatcher watching for which train being late will hold up the most other trains. The player should check this regularly and address amber flags before they go red.

---

## 13. Economic Victory Conditions

### Primary: Trade Network Dominance

Win condition: Your faction controls or benefits from ≥ 60% of all trade volume in 3+ star systems for 20+ consecutive years.

```
trade_dominance_score = Σ(
    routes_primarily_served_by_your_faction × route_volume_t_per_year
) / total_system_trade_volume

sustained_dominance_years = consecutive_years above 0.60 threshold
```

### Secondary: Economic Self-Sufficiency

Win condition: All nodes in your network maintain `financial_health > 1.5` and `bootstrap_gap_closed = true` in your home system for 50+ consecutive years.

This measures a colony that can perpetuate itself — it is not dependent on imports from Earth and is not running a structural deficit.

### Milestone Unlocks (non-victory, but meaningful)

These don't end the game but are significant achievements that change what's possible:

| Milestone | Condition | Effect |
|-----------|-----------|--------|
| **First Surplus** | `monthly_surplus > 0` for 12 consecutive months | Enables expansion investment |
| **Closed Loop** | All life support inputs produced locally | Removes biological import dependency |
| **Fuel Independent** | Antimatter production online locally | Removes interstellar fuel dependency |
| **Industrial Sovereign** | Semiconductor fab + shipyard + all Tier 3 production active | Can build any ship locally |
| **Interstellar Exporter** | First Tier-4 cargo delivered to another star system | Opens interstellar economy layer |
| **Cultural Anchor** | Knowledge package sold to 3+ other systems | Establishes cultural/scientific influence |

### Economic Failure State

The game does not end on economic failure, but a colony in persistent deficit will:
- Lose population to emigration
- Lose claim score as nodes go offline
- Attract rival factions to contested territory
- Eventually trigger a governor autonomy override where the AI tries to stabilize at the expense of expansion

Economic failure is recoverable. It requires accepting constraints, prioritizing survival nodes, and patiently rebuilding. Players who do this well often end up with leaner, more resilient systems than players who never faced pressure.

**Economic death spiral (non-recoverable):**
```
financial_health < 0.5 for 10+ years
AND population declining
AND claim_score < 100
AND no allied faction providing support
```

At this point the colony transitions to "Failing" status. The player can continue playing in salvage mode — trying to negotiate absorption by a rival, sell remaining assets, or stage a managed withdrawal. There is no forced game-over. But there is no path back to sovereignty without external intervention.
