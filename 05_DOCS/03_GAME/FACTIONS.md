# Factions

Factions in ExoMaps are not hand-placed enemies. They emerge from the simulation.
A faction is any group with coherent identity, independent decision-making, and infrastructure.

---

## How Factions Originate

### 1. Splinter Groups (from within your colony)

Your colonists track three internal metrics:

| Metric | Range | Description |
|--------|-------|-------------|
| `autonomy_desire` | 0–1 | How much they want self-governance vs. following your directives |
| `ideology_alignment` | 0–1 | How well their values match the founding ideology (sponsor) |
| `economic_satisfaction` | 0–1 | Whether they feel the logistics system serves them fairly |

**Splinter trigger:**
```
if autonomy_desire > 0.65 AND ideology_alignment < 0.35:
    splinter_risk += (1 - economic_satisfaction) * 0.3 per year
    if splinter_risk > threshold: → faction_split event
```

A splinter takes 10–30% of your population, some infrastructure they control locally,
and possibly a vehicle or two. They start neutral. They don't have to become enemies.

**What determines splinter ideology:**
- The dominant trait of the splinter's founding population
- Who their leader is (procedurally generated — see NPC traits in MECHANICS.md)
- What grievance triggered the split (economic, political, cultural, religious)

### 2. Rival Expeditions

Another civilization sent a colonial fleet to the same system. Or a nearby system.
They arrive later — sometimes decades after you — and start building.

Rival expedition origins:
- Different nation/corp from the same home system as you
- A faction that formed *in transit* on a generation ship
- An expedition from a *different* established colony (not Earth) — second-wave expansion

On arrival, rivals assess your presence:
- **Heavy presence** → negotiate for a partition or leave
- **Light presence** → move in; contest
- **No presence** → claim freely; may not even acknowledge you exist

### 3. Corporate Spinoffs

If your prime contractor has a significant operational footprint in your system
(they built half your stations), they may declare operational independence.
Particularly likely if:
- Contractor debt wasn't fully serviced
- The contractor had more personnel on-site than your own crew
- Earth-side corporate governance collapses or changes mandate

### 4. Independent Operators

Small groups — pirates, freelance traders, refugees, explorers — who don't belong to
any organized expedition but have enough ships and grit to operate independently.

They exploit gaps in your logistics network:
- Run routes you're not covering (and charge accordingly)
- Scavenge abandoned nodes
- Act as middlemen between you and a hostile faction you won't talk to directly

They are not inherently hostile. They're opportunistic. Treat them well and they become
an informal part of your economy. Squeeze them and they become raiders.

### 5. Earth Resupply Waves

Home sends another ship. Problem: it left Earth 60 years after your original fleet.
The political mandate may have completely changed. The new arrivals have:
- Different sponsor priorities
- Modern tech (decades ahead of your existing gear)
- Fresh bodies with no loyalty to your established hierarchy
- Orders from a government that no longer matches the one that funded you

These arrivals destabilize — or reinvigorate — your colony. Often both.

### 6. Ghost Infrastructure

You find evidence of an earlier, failed expedition. Abandoned stations.
Crashed landers. Partially-built habitats. Logs cut off mid-sentence.

Ghost infrastructure is not a faction — but it's the seed of one. Whoever salvages
and reactivates it gains both the physical asset and the narrative claim that comes with it.

---

## Faction Relationships

Between any two factions, a relationship state exists:

| State | Description | Mechanics |
|-------|-------------|-----------|
| **Unknown** | No contact yet | No effect; may discover via probe or arrival event |
| **Aware** | Know of each other; no formal contact | Passive tension; may compete for same nodes unknowing |
| **Neutral** | Formal acknowledgement; no agreement | Default after first contact; can drift either way |
| **Trade Partner** | Agreed cargo exchange at defined rates | Routes can transfer between faction networks at borders |
| **Non-Aggression Pact** | Mutual avoidance of contested nodes | Claims don't erode each other's score; still compete economically |
| **Alliance** | Shared infrastructure, coordinated logistics | Can use each other's fuel depots; shared uptime bonuses |
| **Cold War** | Competing hard for same resources; no open conflict | Both factions racing to build claim score in contested areas |
| **Proxy Conflict** | Using independent operators or proxies to harass each other | Deniable damage to routes; escalation risk |
| **Open Conflict** | Active interdiction, node seizure, vehicle destruction | Uptime drops, routes disrupted, maintenance crises cascade |
| **Absorption** | One faction absorbed into another | Triggered by: overwhelming imbalance, post-conflict surrender, or voluntary merger |

---

## Splinter Faction Dynamics

When a splinter forms, it gets:
- A procedurally-generated leader (dominant trait shapes their behaviour)
- The infrastructure they physically controlled at time of split
- A founding grievance that determines their initial policy

**Splinter trajectories:**

| Grievance | Likely Development |
|-----------|------------------|
| Economic (unfair resource allocation) | Become independent traders; possibly piracy |
| Political (disagreed with your governance) | Form rival administration; competitive but not violent |
| Religious/ideological | High cohesion internally; hostile to secular factions; seek isolation |
| Labor (working conditions in mines/stations) | Unionize; demand route and node access agreements |
| Military (disagreed with conflict decision) | Either pacifist enclave or more militant than you were |

**Re-integration:**
You can re-integrate a splinter faction through:
- Economic incentive (guarantee their resource access)
- Diplomatic resolution (leader trait must be compatible: high Charisma check)
- Time + shared crisis (an asteroid impact or rival threat reunites former enemies)
- Force (seize their infrastructure; triggers loyalty collapse + possible second splinter)

---

## Faction Economy

Each faction runs its own internal logistics network, independently.
Factions have:
- Their own nodes (they can build, if they have the capacity)
- Their own vehicle fleet
- Their own resource budget
- Their own claim score in contested zones

**Inter-faction trade** happens at border nodes: stations or depots where both factions
dock. Trade agreement terms specify: cargo type, price, volume, exclusivity, duration.

If a faction's internal economy fails (they run out of fuel, lose too many nodes),
they become desperate — triggering conflict, merger requests, or collapse.

---

## Faction Leaders (NPC Traits)

Faction behaviour is shaped by the dominant trait of their current leader.
Leaders die, retire, or are replaced — and factions shift when they do.

| Leader Trait Profile | Faction Behaviour |
|---------------------|-----------------|
| High Leadership + High Charisma | Expansionist; skilled diplomats; builds alliances aggressively |
| High Greed + High Expertise | Efficient economy; transactional diplomacy; will trade anything |
| High Resilience + Low Charisma | Isolationist; hard to negotiate with; extremely hard to destroy |
| High Greed + Low Resilience | Aggressive early; collapses quickly when supply disrupted |
| High Charisma + Low Expertise | Popular; poor at logistics; crisis-prone but good at asking for help |
| High Resilience + High Leadership | Slow, methodical, territorial — the most dangerous long-game opponent |

---

## Faction Events (Sample Triggers)

| Event | Trigger Condition | Outcome |
|-------|-----------------|---------|
| **Splinter Declaration** | autonomy_desire > 0.65, ideology_drift > threshold | New faction formed; infrastructure divides |
| **Rival Arrival** | New expedition enters system | Contact event; relation initialised as Unknown → Aware |
| **Trade Proposal** | Faction has surplus you have deficit (and vice versa) | Opens negotiation; can accept/counter/reject |
| **Route Interdiction** | Cold war escalates; one faction intercepts the other's barge | Open conflict risk; diplomatic incident |
| **Leadership Death** | Leader NPC dies (age, accident, assassination) | Faction trait profile shifts; relation states may change |
| **Merger Offer** | One faction much weaker; under pressure from third party | Can accept and absorb; or exploit their weakness |
| **Defection Wave** | Your economic_satisfaction drops below 0.30 for 10+ years | 5–15% of your population defects to a nearby faction |
| **Ghost Claim** | Salvage of abandoned expedition infrastructure | Salvaging faction gains node + provenance claim |
| **Supply Collapse** | Faction runs out of fuel; routes go silent | They become desperate; likely to demand/steal/beg |
