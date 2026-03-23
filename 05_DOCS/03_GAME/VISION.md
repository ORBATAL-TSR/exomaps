# Vision & Design Philosophy

---

## Project Identity

**ExoMaps** — Real-data 3D star map + interstellar civilization simulator.

> "You don't conquer a star system. You earn it — node by node, route by route."

- **Genre:** Space logistics / grand strategy / 4X hybrid
- **Setting:** Real stars within ~100 LY of Sol — 1,796 systems from actual archives
- **Tone:** Hard sci-fi. No FTL. No magic energy. Infrastructure is power.
- **Audience:** Players who like building systems, emergent stories, and real science

---

## The Arrival Moment

The opening of every campaign is the same: you dropped your colony fleet into a new system
some decades ago. Now they're here. The star is different. The planets are real objects with
physics and chemistry and history. Nobody sent a welcome party.

The player's first job isn't combat. It isn't diplomacy. It's *logistics*:
find what's in this system, figure out what you can extract, and build the infrastructure
to sustain the people who came with you.

Everything else follows from that.

---

## Core Design Pillars

| Pillar | What it means |
|--------|--------------|
| **Arrival is the drama** | Getting there takes decades. The moment of arrival is the emotional peak. You built up to this. |
| **Infrastructure = power** | You claim a system by building in it, not by planting a flag. Routes, nodes, production capacity. |
| **Logistics is the game** | Intra-system freight management is the core loop — closer to Railroad Tycoon than to RTS combat. |
| **Factions emerge organically** | You don't pick enemies. Splinter groups, rival expeditions, and independent operators appear naturally from the simulation. |
| **Space-first** | Orbital infrastructure before surface. Asteroid mining before terraforming. |
| **Late game = rare goods trade** | Raw materials don't cross light-years. Novel materials, rare isotopes, finished goods that can't be made locally do. |
| **Real data** | 6,000+ confirmed exoplanets. What you find in a system is grounded in actual astrophysics. |

---

## Gameplay Phases

```
PHASE 1 — DESIGN & DEPARTURE
  Pick sponsor, contractor, ship configuration.
  Launch your colonial flotilla. Transit time 20–200 years.
  Decisions made now ripple forward: crew mix, cargo, ideological mandate.

PHASE 2 — ARRIVAL & SURVEY
  Deceleration burn. First look at the system.
  Deploy survey probes. Assess planets, belts, moons.
  Find water. Find metals. Find your first viable orbit.

PHASE 3 — ESTABLISH ARCHITECTURE
  First orbital station. First fuel depot. First surface foothold.
  Build nodes. Connect them with routes. Assign vehicles.
  Get the supply chain running before people die.

PHASE 4 — CLAIM & GROW
  Expand the network. More nodes, more routes, higher throughput.
  Claim score builds as infrastructure density increases.
  First asteroid mines. First barge runs. First processed goods.

PHASE 5 — FACTIONS EMERGE
  Your colony grows complex enough to develop internal politics.
  Splinter risk rises. Rival expeditions may arrive.
  Diplomacy, cold war, or open conflict — often all three at once.

PHASE 6 — INTERSTELLAR ECONOMY
  Your system produces something worth shipping across light-years.
  Novel materials. Rare isotopes. Finished goods for young colonies nearby.
  Trade routes established. Decades-long delivery windows. Strategic patience.

PHASE 7 — LEGACY
  Victory conditions (see below) or just watch civilisation evolve.
  The simulation runs without you. AI governors execute your policy.
  Stories emerge. Not from scripts — from math.
```

---

## Claiming a System

Claiming is not a military action. It's an infrastructure metric.

```
claim_score = Σ(node_value × operational_uptime) + route_density + population
```

- Reach the claim threshold → system is "established"
- Other factions in the same system erode your score by building their own
- You don't suddenly lose a system — it degrades as their presence outweighs yours
- Contesting a claim means competing on routes, nodes, and population — not just combat

---

## The Space Architecture Layer

Every node in your system is a piece of infrastructure with:
- A type (station, outpost, depot, refinery, habitat, platform)
- A location (orbit, surface, asteroid anchor, L-point)
- Inputs and outputs (what it consumes, what it produces)
- A maintenance demand (crew, power, spare parts)
- A vulnerability (radiation, impacts, sabotage, neglect)

Nodes connect via routes. Routes have vehicle assignments. This is the Railroad Tycoon layer.
See `LOGISTICS.md`.

---

## Sponsors (6 types)

| Sponsor | Ideology | Strength | Weakness |
|---------|----------|---------|---------|
| Government Program | National space agency | Large budget, political backing | Bureaucratic; decisions require approval |
| Corporate Syndicate | Profit-driven mega-corp | Efficient logistics, advanced tech | Quarterly pressure; colonies are assets, not communities |
| Scientific Coalition | Universities + research institutes | Discovery bonuses, strong tech tree | Limited starting funds; slow to industrialise |
| Frontier Cooperative | Grass-roots settlement movement | Autonomy, high morale, adaptable | Weaker tech; prone to internal faction splits |
| Religious Pilgrimage | Faith-based expansion | Extreme cohesion, cultural identity | Rigid ideology; diplomatic friction with secular factions |
| Breakaway Colony | Dissident group fleeing something | Self-reliant, motivated, scrappy | Political isolation; no resupply from home |

---

## Prime Contractors (4 types)

| Contractor | Philosophy | Strengths | Weaknesses |
|-----------|-----------|-----------|-----------|
| NuSpace | Sleek, mass-efficient commercial | Low mass per module, fast assembly | Fragile; poor repairability; needs supply chain |
| Tronicon | Heavy industrial | Durable, modular, field-repairable | Heavy; expensive; slow to deploy |
| Kosmik | Retro space-race designs | Proven, reliable, simple maintenance | Mass inefficient; dated tech ceiling |
| Globulo | Inflatable habitat systems | Large volume fast, good for crew | Limited hard industry; vulnerable to micrometeors |

---

## Travel & Communications

| Destination | Distance | At 0.05c | At 0.10c |
|------------|----------|---------|---------|
| Proxima Centauri | 4.24 LY | ~85 yr | ~42 yr |
| Barnard's Star | 5.96 LY | ~119 yr | ~60 yr |
| Tau Ceti | 11.9 LY | ~238 yr | ~119 yr |
| 40 Eridani | 16.3 LY | ~326 yr | ~163 yr |
| 100 LY edge | ~100 LY | ~2,000 yr | ~1,000 yr |

Communications travel at c. A policy message sent to a fleet 8 LY away takes 8 years to arrive
and another 8 years for a response to return. AI governors act on last received instructions
in the gap. The player must learn to govern with time-delayed authority.

---

## Victory Conditions

| Type | Primary Condition | Scoring |
|------|-----------------|---------|
| **Infrastructure** | Largest operational network by node-count × uptime | Weighted by system distance from Sol |
| **Economic** | Interstellar trade volume + finished goods exports | GDP × route count × distance premium |
| **Scientific** | Complete: fusion drives, terraforming, xenobiology, novel materials synthesis | Research unlock tree |
| **Cultural** | Spread ideology or language to X% of settled systems | Coverage × depth index |
| **Utopian** | Sustain peace + equality + ecological balance across your network | Years × quality-of-life × sustainability |
