# UI/UX Strategy

*How the player manages surface colonies, asteroid outposts, orbital stations,
atmospheric platforms, and a system-wide logistics network without losing their mind.*

---

## Table of Contents

1. [Core Design Philosophy](#1-core-design-philosophy)
2. [Spatial Navigation Model](#2-spatial-navigation-model)
3. [Screen Anatomy — Persistent Elements](#3-screen-anatomy--persistent-elements)
4. [Overlay System — Data Layers on the Orrery](#4-overlay-system--data-layers-on-the-orrery)
5. [Node Interior Views by Type](#5-node-interior-views-by-type)
6. [Route Editor](#6-route-editor)
7. [Alert & Notification System](#7-alert--notification-system)
8. [Economic Dashboard](#8-economic-dashboard)
9. [Faction Interface](#9-faction-interface)
10. [Governance & Policy Panel](#10-governance--policy-panel)
11. [Research Panel](#11-research-panel)
12. [Visual Language & Color System](#12-visual-language--color-system)
13. [VITA Implementation Notes](#13-vita-implementation-notes)

---

## 1. Core Design Philosophy

### The Orrery Is Always Home

The player should never feel lost. The 3D orrery — the star system, orbits, nodes — is
the master spatial context. Every panel, every view, every drill-down exists in relation
to it. You can always get back to it in one keystroke.

**Principle: panels slide over the orrery, they do not replace it.**
The orrery dims but remains visible behind any open panel. Spatial context is always maintained.

### Alert-Driven, Not Dashboard-Driven

The player should spend most of their time responding to things that need attention —
not hunting through dashboards looking for problems. The game surfaces problems.
The player resolves them. When everything is running well, the player should have almost
nothing to do except set strategic direction.

**Design implication:** The game is boring when your network is healthy. That's correct.
Logistics systems are supposed to be boring. Drama is the exception, not the state.

### Information Density Scales With Zoom

Far out: you see health at a glance (color, icons, alert dots).
Medium: you see flows — what's moving, what's building, what's stalled.
Close in: you see specifics — exact cargo manifests, crew assignments, production rates.

Never show close-in data at far-out zoom levels. Never hide critical alerts behind zoom levels.

### The Player Sets Direction. The Governor Executes.

The UI is a **policy interface**, not a micromanagement console. The player sets targets,
priorities, and agreements. The governor fills in the details. UI design reflects this:
sliders and priority queues, not per-unit orders.

---

## 2. Spatial Navigation Model

### Zoom Levels (continuous, not discrete)

```
LEVEL 0 — SYSTEM MAP          (pull out to see all bodies + orbits)
LEVEL 1 — ORBITAL ZONE        (zoom to a region: inner system, belt, outer system)
LEVEL 2 — BODY FOCUS          (zoom to a single planet, moon, or asteroid)
LEVEL 3 — NODE FOCUS          (zoom to a specific facility on/around that body)
LEVEL 4 — NODE INTERIOR        (click into a node: schematic/map view of the facility)
```

Levels 0–3 are all in the 3D orrery. Level 4 is a 2D schematic that slides in as a panel.
The orrery dims to 30% opacity when Level 4 is open so spatial context is still visible.

### Navigation Controls

| Action | Input |
|--------|-------|
| Zoom in/out | Scroll wheel |
| Pan orbit | Right-drag or middle-drag |
| Click body | Jumps to Level 2 (Body Focus) |
| Click node icon | Opens Node Detail Panel (Level 3 info + Level 4 entry point) |
| Press `Esc` / `[` | Back one level |
| Press `Space` | Return to System Map (Level 0) |
| Press `Tab` | Cycle through nodes with active alerts |

### Breadcrumb Bar

Always visible at top-left. Shows current location in the hierarchy:

```
[☀ Tau Ceti]  ›  [♁ TC-e]  ›  [🏗 Station Kovač]  ›  [Module: Refinery Ring B]
```

Each crumb is clickable. Clicking jumps you back to that level.

### Node Icons on the Orrery

Each node renders as a persistent icon at its orbital position:

| Node Type | Icon | Color State |
|-----------|------|------------|
| Orbital Station | ⬡ hexagon | Health color |
| Surface Base | ⬛ square | Health color |
| Mining Outpost | ◆ diamond | Health color |
| Processing Platform | ⬟ pentagon | Health color |
| Fuel Depot | ◉ bullseye | Health color + fill level |
| Atmospheric Platform | ◈ cross-circle | Health color |
| Shipyard | ⚙ gear | Health color |
| Comms Relay | △ triangle | Health color |
| Under Construction | Same icon, dashed outline, % progress label |
| Faction-owned | Same icon, faction color border |

**Health color:** green (uptime > 0.7) · amber (uptime 0.4–0.7) · red (uptime < 0.4) · grey (offline)

Alert dots appear on icons when that node has an active alert. Red dot = critical. Amber dot = warning.

---

## 3. Screen Anatomy — Persistent Elements

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [☀ Tau Ceti › TC-e › Kovač]        [LOGISTICS] [ECON] [CLAIM] [FAC] [POP]  │  ← TOP BAR
│─────────────────────────────────────────────────────────────────────────────│
│                                                                             │
│                                                                             │
│                      3D ORRERY (ALWAYS PRESENT)                             │
│                                                                             │
│                                                                             │
│                                                                             │
│─────────────────────────────────────────────────────────────────────────────│
│ [⚡ ALERTS: 2 critical, 3 warnings]  [Year 84, Month 3]  [⏸ ▶ ▶▶ ▶▶▶]    │  ← BOTTOM BAR
└─────────────────────────────────────────────────────────────────────────────┘
```

### Top Bar (always visible)
- **Left:** breadcrumb navigation
- **Center:** overlay mode buttons (see §4) — only one active at a time; default is none
- **Right:** quick-access icons (Dashboard, Factions, Research, Governance, Settings)

### Bottom Bar (always visible)
- **Left:** Alert summary — click to open alert feed
- **Center:** Current in-game date
- **Right:** Time controls — pause, normal, fast, very fast

### Right Panel (slides in on node select, or from top-right icons)
Width: 420px. The orrery remains visible at 70% opacity to the left.
Panel has a tab strip at top. Tabs vary by context (node type, or global view).
Dismiss with `Esc` or `✕`.

### Left Panel (optional — route editor, see §6)
Width: 320px. Only open when in route-editing mode.

---

## 4. Overlay System — Data Layers on the Orrery

Overlays add data visualization on top of the live orrery. One active at a time.
Toggle with keyboard shortcuts or top-bar buttons. Press same key again to dismiss.

### [L] Logistics Overlay

Shows the route network:
- Routes as lines between nodes
  - Thickness scales with cargo volume (t/month)
  - Color: green (healthy, balanced) · amber (underloaded return) · red (disrupted/suspended)
- Vehicles shown as moving dots on route lines with small cargo-type icon
- Route hover: tooltip shows cargo manifest, transit time, profit/run
- Fuel depot fill levels shown as radial fill on depot icons (critical < 20% = red pulse)

**Use case:** Check that your network is moving correctly. Spot routes that are disrupted.
Find fuel depots running low before they cascade.

### [E] Economic Overlay

- Each node shows its monthly margin as a +/- value
- Node color mapped to margin (green surplus · amber near-break-even · red deficit)
- Cargo price alerts shown as small $ indicators on nodes with significant price deviations
- System `financial_health` ratio in bottom-left corner
- Price delta arrows on nodes experiencing a price shock (↑ = rising demand, ↓ = surplus)

**Use case:** Identify which nodes are profitable, which are strategic losses, where price
opportunities exist. Check overall financial health.

### [C] Claim Overlay

- Heatmap on all bodies: your faction's claim presence (blue intensity)
- Rival faction presence shown in their faction colors
- Contested zones pulsing between colors
- Claim score number floating above each contested body
- Trend arrows: is your claim rising or falling?

**Use case:** See where you're losing ground before the claim score triggers a crisis.
Identify where a rival is quietly building.

### [P] Population Overlay

- Node size scales with population count
- Color maps to morale (green > 0.7 · amber 0.4–0.7 · red < 0.4)
- Splinter risk shown as fragmentation icon on nodes with high risk
- Emigration flows shown as dashed arrows between nodes

**Use case:** Spot morale problems early. See where population is flowing. Identify
splinter risk before it fires.

### [B] Build Overlay

- All nodes under construction shown with progress rings
- Resource flows to construction sites shown as arrows (are they getting supply?)
- Stalled construction (no material delivery in 30+ days) shown in red
- ETA labels on all active construction projects

**Use case:** Monitor construction progress. Find stalled projects and fix their supply.

---

## 5. Node Interior Views by Type

Accessed by clicking "Open Interior" in any Node Detail panel, or double-clicking a node.
These are 2D schematic views. The orrery dims to 30% behind them.

---

### Orbital Station — Cross-Section View

```
┌────────────────────────────────────────────────────────────────────┐
│  [KOVAČ-MAIN]  ●●●● Crew: 847/900  ⚡ Power: 94%  ↑ Uptime: 96%  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│    [DOCK A]──[DOCK B]──[DOCK C]──[DOCK D]   ← 4 berths shown     │
│        │                              │                           │
│    [HUB RING] ════════════════════ [HUB RING]                     │
│        │          [COMMAND]            │                           │
│    [HABITAT 1]    [MEDICAL]       [HABITAT 2]                     │
│        │          [RESEARCH]           │                           │
│    [INDUSTRIAL]  [LIFE SUP.]     [FABRICATION]                    │
│                                                                    │
│  Click module → detail popover (crew, status, upgrade available)  │
└────────────────────────────────────────────────────────────────────┘
```

**Tabs:** Overview · Docking · Modules · Crew · Storage · Contracts

- **Docking tab:** shows each berth — which vehicle is docked, what it loaded/unloaded, dwell time, departure time
- **Modules tab:** list of all modules with uptime, upgrade tier, crew required
- **Storage tab:** inventory per cargo type — bars showing current / capacity, demand curve price indicator
- **Contracts tab:** all active trade agreements at this node (can sign/modify here)

---

### Surface Base — Top-Down District Map

```
┌────────────────────────────────────────────────────────────────────┐
│  [SURFACE BASE ALPHA — TC-e]   Pop: 2,340   Morale: 74%           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ████ INDUSTRIAL  ████ AGRICULTURE  ██░░ HOUSING (82% full)      │
│   ████ PROCESSING  ░░░░ PARK/CIVIC   ████ MEDICAL                 │
│   ░░░░ PLANNED: NEW HOUSING DISTRICT (construction: 34%)          │
│                                                                    │
│   Surface connections:  [Airlock A] [Airlock B] [Tunnel to Mine]  │
│   Orbital connections:  [Spaceplane pad 1] [Spaceplane pad 2]     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Districts are clickable. Each shows:
- What it produces/consumes
- Current capacity utilization
- Upgrade path (and cost)
- Assigned population + morale for that district

**Tabs:** Map · Population · Agriculture · Production · Housing · Governance

- **Population tab:** age pyramid, birth/death rates, morale breakdown, skills distribution
- **Agriculture tab:** crop yields, soil quality, water consumption, food surplus/deficit
- **Governance tab:** local autonomy level, political composition, recent decisions by governor, splinter risk meter

**Surface bases are the most complex node type.** They have the most tabs and the most decisions.
The district map makes the complexity manageable — you can see at a glance which district
is the problem.

---

### Mining Outpost — Side-Section View

```
┌────────────────────────────────────────────────────────────────────┐
│  [MARTA-7 — Belt, S-type, 2.3 AU]   Crew: 28   Uptime: 88%       │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│       SURFACE ─────────────────────────────────────               │
│          ↓      [DRILL SHAFT A]  [DRILL SHAFT B]                  │
│       LEVEL 1   ████████████░░░  ████████████████   ore seams     │
│       LEVEL 2   ████████████████  ████████░░░░░░░   (% mined)    │
│       LEVEL 3   ░░░░░░░░░░░░░░░░  [new shaft: 67% drilled]       │
│                                                                    │
│   SURFACE FACILITIES:  [Habitat dome]  [Processing shed]  [Pad]   │
│                                                                    │
│   EXTRACTION RATE:  840 t/month iron-nickel  [▲ upgrade drill]    │
│   STORAGE:  [██████░░] 6,200 / 8,000 t  → BARGE DEPARTS: 12d    │
└────────────────────────────────────────────────────────────────────┘
```

**Tabs:** Extraction · Storage · Vehicles · Crew · Survey

- **Survey tab:** shows the asteroid's estimated remaining resource deposit. What's been mined vs. what's left. Projected years of operation at current extraction rate.
- **Vehicles tab:** which vacuum landers are assigned, dwell schedule, last dispatch

Mining outposts are **simple to manage** — they either run or they don't. The UI reflects this: most management is just keeping supply flowing in and vehicles running. The complexity is in the network, not the node itself.

---

### Fuel Depot — Instrument Panel View

The simplest node view. Purpose: you need to see the numbers at a glance.

```
┌────────────────────────────────────────────────────────────────────┐
│  [DEPOT OUTER-3 — L4, 3.1 AU]     Uptime: 100%   Crew: 4         │
├──────────────────┬─────────────────────────────────────────────────┤
│  LIQUID H₂       │  ████████████████░░░░  78,400 / 100,000 t      │
│  LIQUID O₂       │  ██████████████████░░  54,200 /  60,000 t      │
│  XENON (ion)     │  ████░░░░░░░░░░░░░░░░   4,100 /  20,000 t  ⚠  │
├──────────────────┴─────────────────────────────────────────────────┤
│  INBOUND: TANKER ALDGATE — 8 days out — 12,000 t xenon             │
│  OUTBOUND: Served 4 vehicles this month — 3,200 t H₂ dispensed    │
└────────────────────────────────────────────────────────────────────┘
```

The xenon amber warning flags immediately. The inbound tanker reassures. No tabs needed — this node is simple. Keep it full. That's the whole job.

---

### Atmospheric Platform — Instrument + Status

```
┌────────────────────────────────────────────────────────────────────┐
│  [SKIMMER-1 — TC-g, cloud layer, 0.8 bar alt.]   Uptime: 71% ⚠   │
├────────────────────────────────────────────────────────────────────┤
│  ALTITUDE:     42.3 km (target: 40–45 km)    ↕ AUTO-ADJUST: ON    │
│  WIND:         320 km/h W  [station-keeping fuel: 12 days]  ⚠     │
│  TEMPERATURE:  -18°C  /  ambient pressure: 0.82 bar               │
│                                                                    │
│  HE-3 SCOOP:   ON  │ Yield: 2.3 kg/day  │ Tank: 84% (12.6 kg)    │
│  CLOUD CHEM:   ON  │ Yield: 40 t/day carbonaceous compounds        │
│                                                                    │
│  ⚠ STATION-KEEPING FUEL LOW — resupply route frequency insufficient│
└────────────────────────────────────────────────────────────────────┘
```

Atmospheric platforms are high-maintenance and location-sensitive. The warning system
is prominent because if they drift out of altitude band, yield collapses. Crew can
do nothing about a wind shear — the automation handles it, but needs fuel to do so.
The alert here is actionable: increase tanker route frequency.

---

## 6. Route Editor

Accessed from [L] Logistics Overlay or from within any Node Detail panel.
Opens as a left panel (320px) with the orrery in route-editing mode.

### Route Editing Mode

When active, the orrery changes:
- All nodes show a **connection ring** around them — click to start/end a route
- Existing routes are shown as thick colored lines
- Hovering a route highlights both endpoints
- Right-click a route → context menu (edit, suspend, delete)

### Route Creation Flow

```
STEP 1: Click origin node  →  origin highlighted, orrery waits for destination
STEP 2: Click destination  →  route line drawn as dashed preview
STEP 3: Route Editor panel shows:
    ├── Vehicle assignment (compatible classes only shown)
    ├── Outbound cargo manifest (drag cargo types from node's output list)
    ├── Inbound cargo manifest (drag from destination's output list)
    ├── Schedule (how many vehicles, departure frequency)
    ├── Priority (1–5 slider)
    └── [CREATE ROUTE] button
STEP 4: Confirmation shows route economics preview:
    ├── Estimated profit/run (or "strategic — estimated loss: X Cr/run")
    ├── Transit time
    ├── Load balance score
    └── Vehicle compatibility confirmation
```

### Route Edit Panel (existing routes)

```
┌──────────────────────────────────────────────────────┐
│  MARTA-7 → KOVAČ-MAIN                               │
│  ─────────────────────────────────────────────────── │
│  Vehicle: IFB MERIDIAN SLOW (x1)    [+ Add Vehicle]  │
│  Transit: 60 days   Δv: 1,240 m/s                   │
│  ─────────────────────────────────────────────────── │
│  OUTBOUND CARGO                     Load: 87%  ✓    │
│  ► Iron-nickel alloy     24,000 t                   │
│  ► Titanium billets      11,000 t                   │
│  ► Silicates              6,000 t                   │
│  ─────────────────────────────────────────────────── │
│  INBOUND CARGO                      Load: 22%  ⚠    │
│  ► Polymer sheet          2,000 t                   │
│  ► [+ Add cargo type]                               │
│  ─────────────────────────────────────────────────── │
│  Profit/run: +8,400 Cr     Priority: 2              │
│                                                     │
│  [SUSPEND]  [DELETE]              [SAVE CHANGES]    │
└──────────────────────────────────────────────────────┘
```

The 22% inbound load is flagged amber. The player can click `+ Add cargo type` to see
what Kovač-Main produces that Marta-7 needs. The game suggests based on current
Marta-7 demand — a "you could carry X on the return leg" hint.

---

## 7. Alert & Notification System

### Alert Categories

| Category | Color | Auto-Pause | Icon |
|----------|-------|-----------|------|
| Critical — life threat | Red | Yes (configurable) | ☠ |
| Critical — infrastructure | Red | Optional | ⚡ |
| Warning — economic | Amber | No | ₡ |
| Warning — route | Amber | No | ⇄ |
| Warning — faction | Amber | No | ⚑ |
| Info — construction | Blue | No | 🏗 |
| Info — arrival | Blue | No | ✈ |
| Info — research | Blue | No | 🔬 |
| Opportunity | Green | No | ↑ |

### Alert Feed (bottom-left)

Persistent summary: `⚡ 2 critical · ⚠ 5 warnings · ℹ 3 info`

Click to open full feed as a bottom drawer. Alerts sorted by severity then recency.

Each alert is a card:

```
┌────────────────────────────────────────────────────────────────┐
│ ☠ CRITICAL — [Year 84, M3, D11]                                │
│ DEPOT OUTER-3: Xenon stock below 15%.                          │
│ Ion drives across outer fleet will begin grounding in ~18 days │
│ ──────────────────────────────────────────────────────────────  │
│  [VIEW NODE]  [OPEN ROUTE EDITOR]  [DISMISS FOR 30 DAYS]       │
└────────────────────────────────────────────────────────────────┘
```

Action buttons on each card allow one-click response — the most common action for that alert type is pre-wired. The player doesn't have to hunt for what to do.

### Alert Suppression

Players can suppress categories of alerts for N days. This prevents alert fatigue on long-running non-critical situations. Suppressed alerts do not disappear — they move to a "suppressed" bucket accessible from the feed. Re-emerge automatically when condition worsens.

### The Tab Key

Pressing `Tab` cycles through all nodes with active alerts, jumping the camera to each one. Essential for checking the full state of the network quickly without hunting.

---

## 8. Economic Dashboard

Accessed via top-right icon or `[E]` key (when not using Economic Overlay).
Opens as the right panel with 5 tabs.

### Tab: System Health

```
Financial Health:  ████████░░  1.6  (surplus)
Monthly surplus:   +18,400 Cr
Reserve buffer:    142 months at current burn

Node summary:
  ● 12 productive nodes    Avg margin: +2,100 Cr/mo
  ● 8 strategic nodes      Avg loss:   -1,300 Cr/mo
  ● 3 building             (no contribution yet)

⚠ 2 nodes in deficit exceeding strategic classification:
  → SURFACE BASE ALPHA: -800 Cr/mo (not strategic — check inputs)
  → DEPOT INNER-1: -200 Cr/mo (fuel route frequency insufficient)
```

### Tab: Cargo Flows

Sankey-style diagram showing monthly cargo volume by type:
- Left: production sources (node types)
- Center: transport (routes)
- Right: consumption destinations

Visually shows where bottlenecks are. If one pipe is narrow while downstream nodes are hungry, it's obvious.

### Tab: Price Map

Grid: nodes (rows) × cargo types (columns). Each cell shows:
- Current price at that node for that cargo type
- Color: green (near operating price) · amber (above) · red (critical premium)

Clicking a cell shows the demand curve for that node/cargo combo and the current inventory level plotted on it.

### Tab: Trade Ledger

Monthly summary of all inter-faction trade:
- What you sold, to whom, at what price
- What you bought, from whom
- Outstanding invoices / receivables
- Agreement renewal dates (within 90 days → amber flag)

### Tab: Projections

Simple 12-month forward projection:
- Population growth → crew demand curve
- Fuel consumption vs. production trajectory
- Infrastructure ROI timelines on active construction projects
- When current financial health crosses critical thresholds (if trend continues)

These are projections, not predictions. The game notes: "assumes current conditions continue."

---

## 9. Faction Interface

Accessed via top-right Factions icon or `[F]` key.

### Faction List (left side of panel)

Each known faction shown as a row:

```
[◆] Marta Collective        ⚑ Cold War     Trust: 34%   Claim: 280
[◆] Pietrowicz Coop         ● Trade Partner Trust: 68%   Claim: 110
[◆] Outer Tendency          ● Aware         Trust: 51%   Claim: 180
[◆] Earth Resupply Wave 2   ● Neutral        Trust: 45%   Claim: —
```

Color squares = faction color. Click to open detail.

### Faction Detail

```
┌──────────────────────────────────────────────────────────────────┐
│  MARTA COLLECTIVE                                                 │
│  Origin: Labor splinter (Year 74)  │  Leader: Yusuf Hersi       │
│  Population: 1,840  │  Nodes: 8    │  Relationship: Cold War    │
│  ─────────────────────────────────────────────────────────────── │
│  TRUST: ███░░░░░░░ 34%    Trend: ↓ (-3%/year)                  │
│                                                                   │
│  GRIEVANCES (2 active):                                          │
│  ► Year 80: Authority rerouted barge ALDGATE without notice      │
│  ► Year 82: Surface Base Alpha refused Marta workers housing     │
│                                                                   │
│  DEPENDENCY:                                                      │
│  ► They depend on us for: polymer sheet (HIGH), O₂ (CRITICAL)   │
│  ► We depend on them for: smelted metals (HIGH)                  │
│                                                                   │
│  ACTIVE AGREEMENTS (1):                                          │
│  ► 800 t/mo iron alloy ← 120 t/mo polymer  [Renews: 14 months]  │
│  ─────────────────────────────────────────────────────────────── │
│  [SEND MESSAGE]  [PROPOSE AGREEMENT]  [OFFER CONCESSION]        │
│  [DECLARE EMBARGO]  [REQUEST MEETING]                            │
└──────────────────────────────────────────────────────────────────┘
```

The dependency display is critical — it lets the player immediately understand the leverage situation. O₂ dependency with Cold War relationship is a ticking clock.

### Diplomacy Action Panel

When the player initiates an action (e.g. Propose Agreement), a structured negotiation form appears:

```
PROPOSE TO: Marta Collective

YOU OFFER:           THEY PROVIDE:
[O₂: 80 t/month]    [Iron alloy: 1,000 t/month]
[+ Add offer item]   [+ Add request item]

Duration: [24 months ▾]   Exclusivity: [No ▾]
Penalty clause: [5,000 Cr ▾]

Credit balance: Your offer ≈ 4,200 Cr/mo  │  Their offer ≈ 6,800 Cr/mo
⚠ Imbalanced: they receive more value. Consider adding to your offer.

[SEND PROPOSAL]   [CANCEL]
```

The credit balance indicator prevents players from accidentally signing terrible deals.
The game does not prevent bad deals — it informs. Players can send the imbalanced proposal if they want to (it may be a deliberate concession to improve relations).

---

## 10. Governance & Policy Panel

Accessed via `[G]` key. The policy interface.

```
┌──────────────────────────────────────────────────────────────────┐
│  GOVERNANCE — TAU CETI SYSTEM                                     │
│  Governor AI: ACTIVE  │  Autonomy Level: 3 (Standard)  [change]  │
│  ─────────────────────────────────────────────────────────────── │
│  POLICY AXES:                                                     │
│                                                                   │
│  Resource Priority    [SURVIVAL ●───────────── EXPORT]           │
│  Faction Posture      [COOPERATIVE ─────●────── COMPETITIVE]     │
│  Expansion Rate       [CONSERVATIVE ─●────────── AGGRESSIVE]     │
│  Labor Allocation     [MANAGED ─────────●──── MARKET]            │
│  ─────────────────────────────────────────────────────────────── │
│  PENDING DECISIONS (governor waiting for player approval):        │
│  ► Outer Tendency requested emergency O₂ supply [APPROVE/DENY]   │
│  ► Construct 2nd fuel depot at L5 [APPROVE/DEFER/CANCEL]         │
│  ─────────────────────────────────────────────────────────────── │
│  OUTBOUND MESSAGE QUEUE:                                          │
│  ► Policy update → Earth  │  Sent Y84M2  │  Arrives: Y96M8       │
│  ─────────────────────────────────────────────────────────────── │
│  INBOUND MESSAGES:                                                │
│  ► From Earth (sent Y71M6, arrived Y83M8): new mandate details   │
└──────────────────────────────────────────────────────────────────┘
```

Pending decisions are the governor asking permission. The player approves or denies
and the governor executes. This is the core of the policy interface — you're not
placing buildings, you're approving or adjusting what the AI wants to do.

The message queue is the interstellar communication layer. Letters from Earth arrive
years after they were sent. The player reads them in context of what has happened since.

---

## 11. Research Panel

Accessed via `[R]` key. Shows the tech tree.

Visual: horizontal tracks (one per research area) with tier nodes arranged left to right.
Unlocked tiers are bright. Current research is pulsing. Locked tiers are dark with
RP cost shown.

```
ISRU Efficiency       [Tier 1 ✓]──[Tier 2 ✓]──[Tier 3 ●···]──[Tier 4]──[Tier 5]
Advanced Smelting     [Tier 1 ✓]──[Tier 2 ●··]──[Tier 3]──[Tier 4]
Life Support          [Tier 1 ✓]──[Tier 2 ✓]──[Tier 3]──[Tier 4]
Propulsion            [Tier 1 ✓]──[Tier 2]──[Tier 3]──[Tier 4]
Atmospheric Eng.      [Tier 1 ●]──[Tier 2]──[Tier 3]
Semiconductor Fab     [Tier 1]──[Tier 2]──[Tier 3]
Bioengineering        [Tier 1 ✓]──[Tier 2 ●·]──[Tier 3]──[Tier 4]
Vacuum Synthesis      (locked — requires: Semiconductor Fab T2 + zero-g platform)
Antimatter Prod.      (locked — requires: Propulsion T4 + Advanced Smelting T3)
```

RP allocation bar at bottom: drag sliders to divide monthly RP across active tracks.
Locked track prerequisites shown on hover.

Clicking an unlocked tier shows:
- What it unlocks (production bonus, new node type, new vehicle class, etc.)
- RP required and projected months at current allocation
- Whether a knowledge package could accelerate it and from where

---

## 12. Visual Language & Color System

### Health / Status Colors (consistent throughout)

| State | Color | Hex | Usage |
|-------|-------|-----|-------|
| Healthy / Active | Green | `#4dff91` | Uptime > 0.7, positive margin, good morale |
| Warning | Amber | `#ffb347` | Uptime 0.4–0.7, near-break-even, rising risk |
| Critical | Red | `#ff4d4d` | Uptime < 0.4, life threat, cascade risk |
| Offline | Grey | `#4a5568` | Node failed or suspended |
| Building | Blue | `#4d9fff` | Under construction, in-transit |
| Opportunity | Teal | `#4dffe0` | Price opportunity, beneficial event |

### Faction Colors

Each faction gets a unique color from a palette that avoids red/amber/green
(those are reserved for health states). Suggested palette:
- Cyan `#00bcd4` · Purple `#9c27b0` · Orange `#ff6d00` · Pink `#e91e63`
- Lime `#cddc39` · Indigo `#3f51b5` · Brown `#795548` · Teal `#009688`

### Typography

- **Node names:** Mono, all-caps, small tracking. `KOVAČ-MAIN`
- **Numbers:** Tabular mono — columns align
- **Labels:** Light sans-serif, muted. Don't compete with data.
- **Alerts:** Full weight, clear color. They need to be read immediately.

### Iconography Principles

- Icons are structural (shape = type), never decorative
- Color on icons = health state only — never for aesthetics
- Alert dots always in top-right corner of any icon
- Construction progress shown as clockwise arc around icon
- Faction ownership shown as colored border ring around icon

---

## 13. VITA Implementation Notes

The existing VITA `SystemFocusView.tsx` + `OrreryComponents.tsx` already provides:
- ✅ 3D orrery with depth-drill (system → planet → moon → belt)
- ✅ `SmoothCamera` — smooth fly-to on target change
- ✅ `DepthBreadcrumb` — navigation crumb trail
- ✅ `OrreryBody`, `OrreryStar`, orbital rendering
- ✅ `HabitableZone`, `BeltParticles`, zone overlays
- ✅ `BiomeInfoPanel` — side panel pattern already exists

**What needs to be added:**

### Overlay System
- Add `overlayMode: 'none' | 'logistics' | 'economic' | 'claim' | 'population' | 'build'` to global state
- Each overlay renders as a `<group>` added to the Canvas scene — additive to existing orrery
- Route lines: `THREE.Line2` with variable width (linewidth prop on LineMaterial)
- Vehicle dots: instanced mesh, position interpolated along route spline each frame
- Node health colors: pass as uniform to existing node sphere materials

### Node Icon System
- Replace existing planet click targets with typed `NodeIcon` component
- `NodeIcon` renders the appropriate icon glyph (via `Html` from drei) + health color + alert dot
- Click → fires `onNodeSelect(node_id)` → opens right panel

### Right Panel Architecture
- Existing panel pattern from `SystemFocusView` already slides in from right
- Need a `NodeDetailPanel` that accepts `node_type` and renders the appropriate interior view
- Interior views (cross-section, district map, etc.) are 2D SVG or Canvas, rendered inside a `<div>` panel — not in the 3D scene
- Each interior view is a separate component: `StationInterior`, `SurfaceBaseMap`, `MiningOutpostView`, `FuelDepotGauge`, `AtmosphericPlatformView`

### Alert System
- Bottom bar already exists as `GpuStatusBar` — extend to include alert summary
- Alert feed as a `<div>` drawer anchored to bottom, slides up with CSS transition
- `useAlerts()` hook manages alert state, auto-pause logic, suppression

### Economic Overlay Data
- All economic state lives in a Zustand store (or React context) updated each game tick
- Overlay components subscribe to relevant slices
- No new Three.js objects needed for economic overlay — just color/label updates on existing node objects
