# 01 — Functionality Specification

## Overview

This document defines the functional requirements for ExoMaps, organized by domain area. Each feature set includes priority level, acceptance criteria, and cross-references to the implementation phase where it is delivered.

**Priority Key:** P0 = MVP-critical | P1 = Core experience | P2 = Enhanced | P3 = Future

**Scope:** Stars within 100 parsecs (~326 LY); thousands of confirmed + inferred planets; asteroid belts, Kuiper-belt analogues, comets, Oort-cloud bodies.

---

## 1. Data Ingestion & Catalog Management

**Phase:** 01 — Data Foundation | **Status:** Implemented

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F1.1 | Import stellar catalogs for ≤100 pc neighborhood | P0 | All stars within distance threshold loaded with coordinates |
| F1.2 | Import confirmed exoplanets with full parameter sets | P0 | Period, SMA, radius/mass, eccentricity populated where available |
| F1.3 | Import candidate/unconfirmed planets with confidence scoring | P0 | Confidence tier assigned; source-level quality flags preserved |
| F1.4 | Import SIMBAD cross-reference metadata | P0 | Object types, alternative IDs, spectral classifications resolved |
| F1.5 | Source version stamping and release tracking | P0 | Each import run records source file checksum, release date, adapter version |
| F1.6 | Staging validation with quarantine | P0 | Malformed/invalid rows quarantined with reason codes; pipeline continues |
| F1.7 | Support additional catalog sources (Gaia DR4, TESS updates) | P2 | Adapter interface allows new sources without pipeline changes |

### Data Sources (Current)

| Source | File | Content |
|--------|------|---------|
| NASA Exoplanet Archive | `EXOPLANETS_01.csv`, `EXOPLANETS_01x.csv` | Confirmed + candidate planets |
| SIMBAD | `SIMBAD_01.csv`, `SIMBAD_02.csv`, `SIMBAD_03.csv` | Cross-reference metadata, object types |

---

## 2. Data Normalization & Identity Resolution

**Phase:** 01–02 | **Status:** Implemented

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F2.1 | Cross-catalog object identity resolution (cross-match + dedup) | P0 | No duplicate systems in canonical store; merge log available |
| F2.2 | Canonical schema for stars, planets, belts, orbits, system metadata | P0 | All entity types conform to versioned schema with validation |
| F2.3 | Compute and store Cartesian coordinates (X, Y, Z) in ICRS J2000.0 | P0 | RA/Dec/parallax → X/Y/Z with uncertainty propagation |
| F2.4 | Handle uncertainty fields and missing values explicitly | P0 | Null fields distinguished from zero; uncertainty bounds stored |
| F2.5 | Persist provenance per field (source + transformation + model version) | P0 | Any field value traceable to origin |
| F2.6 | Edge-case context shell (100–110 LY) for visual continuity | P1 | Systems beyond primary boundary loaded with reduced detail |

---

## 3. System Completion & Inference

**Phase:** 03 | **Status:** Framework Implemented

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F3.1 | Infer additional planets in stable orbital zones for sparse systems | P0 | Inferred planets placed with mass/radius/type distributions |
| F3.2 | Infer asteroid belt analogs (inner rocky / outer icy) | P1 | Belt presence/absence physically motivated by system architecture |
| F3.3 | Respect known planet exclusion zones (no overlap) | P0 | Stability heuristics reject overlapping orbits |
| F3.4 | Tag inferred entities with method, confidence interval, seed, model version | P0 | All inferred objects distinguishable from observed |
| F3.5 | Allow regeneration with different model assumptions | P1 | Re-inference with new seed/model produces different but valid systems |
| F3.6 | Compute simulation-facing fields (resource potential, exploration priority) | P1 | Downstream simulation can weight systems for colonization |
| F3.7 | Habitable-zone occupancy probability estimation | P2 | HZ planets flagged with likelihood score |

---

## 4. Simulation Engine

**Phase:** 04 | **Status:** Core Operational

### 4.1 Core Runtime

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.1 | Hybrid tick/event simulation loop | P0 | Economy/population per tick; major events via discrete queue |
| F4.2 | Deterministic execution per seed and rule-set | P0 | Two runs with same inputs produce identical output |
| F4.3 | Save/load simulation snapshots | P0 | JSON serialization; resume from any saved tick |
| F4.4 | Adjustable simulation speed (weeks to decades per step) | P1 | Timestep configurable; default 0.25 simulated years |

### 4.2 Population & Colonization

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.5 | Exponential population growth with carrying capacity | P0 | Growth rate ~2%, cap at 1B per system |
| F4.6 | Colony lifecycle: outpost → settlement → mature world | P1 | Stage transitions based on population + time thresholds |
| F4.7 | Migration pressure from overcrowded/unstable worlds | P1 | Population flows between systems based on push/pull factors |

### 4.3 Economy & Trade

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.8 | Resource extraction by planet/belt class (5 resource categories) | P0 | Volatiles, Metals, Rare Elements, Silicates, Carbon Compounds |
| F4.9 | Production chains: Mining → Refining → Manufacturing → Construction | P0 | Multi-stage production with bottleneck effects |
| F4.10 | Dynamic pricing with supply/demand per commodity | P1 | Prices fluctuate based on local surplus/deficit |
| F4.11 | Trade routes with freight constraints and SFTL delays (decades) | P1 | Trade volume limited by ship capacity and transit time |
| F4.12 | Tech-level scaling (0–20) affecting production efficiency | P0 | Higher tech = more output per unit resource |
| F4.13 | Infrastructure maintenance and degradation | P1 | Structures require spare parts and maintenance cycles |
| F4.14 | Power & energy system (nuclear, solar, antimatter late-game) | P1 | Reactor fuel mining; energy storage and distribution |
| F4.15 | Asteroid spectral class-based resource composition (C-type, S-type) | P0 | NASA-grounded: C-type = water/organics; S-type = metals |

### 4.4 Politics & Factions

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.16 | Faction/polity system with governance tendencies | P1 | Factions have distinct behavior profiles |
| F4.17 | Internal cohesion influenced by wealth, tech, and distance | P1 | Distant colonies drift toward independence |
| F4.18 | Neighbor tensions and alliance/conflict dynamics | P1 | Tension scalar drives event probability |
| F4.19 | Independence movements for low-cohesion periphery | P1 | Secession events fire when thresholds crossed |
| F4.20 | AI governors for semi-autonomous local system management | P1 | Players set policy; AI implements with delayed reporting |

### 4.5 Strategic Events

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.21 | Procedural event generation seeded by simulation RNG | P0 | Events reproducible for same seed |
| F4.22 | Event types: discovery, conflict, migration, shortage, breakthrough, equipment failure, disease, mutiny | P0 | At least 8 distinct event categories |
| F4.23 | Events modify simulation state (tech, population, cohesion) | P0 | Events have measurable impact on next tick |
| F4.24 | NPC characters with traits (leadership, greed, expertise) | P2 | Characters affect mission success probability |

### 4.6 Sponsors & Expedition Creation (NEW)

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.25 | Sponsor selection (6 types) with ideology, bonuses, weaknesses | P0 | Government, Corporate, Scientific, Frontier, Religious, Breakaway |
| F4.26 | Prime contractor selection (4 types) with ship design philosophy | P0 | NuSpace, Tronicon, Kosmik, Globulo — each affects modules/costs/reliability |
| F4.27 | Fleet composition planning (colony ships, industrial vessels, tankers, escorts) | P0 | Fleet mix influences initial capacity for colonists/construction/extraction |
| F4.28 | Expedition launch with resource allocation (research, colonists, cargo, fuel) | P0 | Budget allocation mini-game before departure |

### 4.7 Ships & Fleet Design (NEW)

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.29 | Modular ship builder (propulsion, fuel tanks, habitats, cargo, mining, construction) | P1 | Drag-and-drop module placement affecting simulation stats |
| F4.30 | Propulsion types: nuclear pulse, fusion, beamed sail, antimatter, hybrid | P1 | Each with thrust/efficiency/mass/cost trade-offs |
| F4.31 | Generation ships for voyages > 1 human lifetime | P2 | Closed ecosystems, agriculture, recycling, education systems |
| F4.32 | Automated miners & drones for asteroid operations | P1 | Autonomous vehicles mine and build without crew |
| F4.33 | Fleet classes: colony ship (0.05c), cargo hauler (0.08c), fast courier (0.10c), patrol (0.10c), survey probe (0.15c) | P0 | Ship class table with velocity, capacity, role |

### 4.8 Terraforming (NEW)

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.34 | Atmosphere modification for non-habitable planets | P2 | Multi-century project consuming vast resources |
| F4.35 | Ocean seeding and magnetic field generators | P2 | Project milestones with intermediate benefits |
| F4.36 | Terraforming difficulty score per planet | P1 | f(atmosphere gap, mass deviation, temperature delta) |
| F4.37 | Orbital → surface pipeline (space industry → planetary settlement) | P0 | Players must establish orbital industry before landing |

### 4.9 Conflict & Espionage (NEW)

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.38 | Orbital conflict mechanics (blockade, sabotage, hacking) | P2 | Control of trade lanes and orbital assets |
| F4.39 | Espionage operations (steal research, incite rebellion) | P2 | Covert actions with success/failure probabilities |
| F4.40 | Interstellar councils for shared initiatives | P3 | Voting on large observatories, treaties, embargoes |

### 4.10 Communications (NEW)

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.41 | Speed-of-light message delays | P1 | Message to 4 LY fleet takes 4 game-years |
| F4.42 | Message queue UI with predicted response arrival | P1 | Player sees sent time, ETA, response ETA |
| F4.43 | Transit communications (player decisions reach fleet after delay) | P1 | Adds tension; player plans contingencies |

### 4.11 Victory Conditions (NEW)

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F4.44 | Expansion Victory — control largest interstellar network | P1 | Self-sustaining systems count toward threshold |
| F4.45 | Economic Victory — achieve interstellar trade dominance | P1 | Wealth + trade volume meets target |
| F4.46 | Scientific Victory — complete key research projects | P1 | Fusion drives, terraforming, alien life discovery |
| F4.47 | Cultural/Religious Victory — spread ideology across network | P2 | Cultural influence metrics |
| F4.48 | Utopian Victory — sustainable egalitarian colonies without conflict | P2 | Peace + equality + sustainability thresholds |
| F4.49 | Custom goals (utopian retreat, religious pilgrimage, etc.) | P3 | Player-defined objectives with scoring |

---

## 5. Campaign & Exploration (Fog-of-War)

**Phase:** 05 | **Status:** Schema + Stub APIs

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F5.1 | Campaign CRUD (create, list, update, archive) | P0 | Full lifecycle management via API |
| F5.2 | Per-campaign exploration tracking (system discovery) | P0 | Fog-of-war lifts per system per campaign |
| F5.3 | Multi-level scanning (basic → detailed → deep survey) | P1 | Scan level 1–3 reveals progressively more data |
| F5.4 | Baked planet textures for explored planets | P1 | Albedo, heightmap, normal, PBR, thumbnail URLs stored |
| F5.5 | Campaign faction/territory tracking | P2 | Factions own systems; territory boundaries computed |
| F5.6 | Campaign fleet tracking (position, mission, cargo) | P2 | Ship state persisted per campaign |
| F5.7 | Scenario presets (Early Expansion, Corporate Frontier, etc.) | P2 | Pre-configured seed + rules for quick start |

---

## 6. API Layer

**Phase:** 05 | **Status:** Partially Implemented

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F6.1 | World inspection endpoints (systems, confidence, provenance) | P0 | `/api/world/systems`, `/api/world/confidence` |
| F6.2 | Role-based access control with persona filtering | P0 | HTTP 403 on unauthorized; response filtered by role |
| F6.3 | Simulation control endpoints (pause, resume, step, snapshot) | P0 | Full lifecycle control via REST |
| F6.4 | Campaign CRUD + exploration endpoints | P0 | `/api/campaigns/*` routes |
| F6.5 | Fog-of-war map endpoint (explored systems per campaign) | P1 | Returns only explored systems for given campaign |
| F6.6 | OpenAPI/Swagger documentation | P1 | Auto-generated spec from route definitions |
| F6.7 | API versioning (v1/v2 routing) | P2 | Breaking changes isolated to new version prefix |
| F6.8 | WebSocket real-time event streaming | P2 | Live simulation events pushed to connected clients |

---

## 7. Visualization — Web Client

**Phase:** 06 | **Status:** MVP Complete

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F7.1 | 3D star map with Three.js (spectral type color coding) | P0 | ~500 markers rendered at 60fps with orbit controls |
| F7.2 | System drill-down panel (star properties, planets, habitability) | P0 | Click system → detail sidebar |
| F7.3 | Layer toggles (observed, inferred, trade, habitable zones) | P0 | Each layer independently toggleable |
| F7.4 | Distance filtering slider | P0 | Smooth filtering by LY range |
| F7.5 | Simulation control dashboard (metrics, speed, pause/resume) | P0 | Population, economy, politics KPIs displayed live |
| F7.6 | Timeline/event log with tick-by-tick history | P1 | Scrollable event feed with filtering |
| F7.7 | Political boundary overlays and influence gradients | P2 | Voronoi or gradient-based territory display |
| F7.8 | Trade lane visualization with freight intensity | P2 | Animated routes with thickness = volume |
| F7.9 | Comparative analytics (two-system side-by-side) | P3 | Select two systems for parameter comparison |
| F7.10 | Scenario branch explorer (what-if timeline forks) | P3 | Visual diff of simulation branches from divergence point |

---

## 8. Visualization — Desktop Game Client

**Phase:** 06+ | **Status:** Shell Only (Tauri)

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F8.1 | Advanced camera navigation with smooth large-scale traversal | P1 | Fly-through from galaxy to system to planet |
| F8.2 | GPU-optimized stellar scene rendering (LOD, culling) | P1 | 10,000+ objects renderable without frame drops |
| F8.3 | Tactical overlays (routes, chokepoints, contested zones) | P1 | Strategic information layered on 3D view |
| F8.4 | Fleet and colony management interfaces | P1 | Direct interaction with simulation entities |
| F8.5 | Ship designer with propulsion/life-support modules | P2 | Modular ship configuration affecting simulation stats |
| F8.6 | Colony manager with infrastructure and growth planning | P2 | Build queues, resource allocation, population projections |
| F8.7 | Event-driven narrative framing (human diaspora arcs) | P2 | Story events presented with context and choices |
| F8.8 | Procedural planet surface visualization | P3 | Baked textures rendered on 3D globes |
| F8.9 | Modding tools and custom scenario scripting | P3 | Lua/WASM scripting for custom rules and events |

---

## 9. Pipeline Operations

**Phase:** 01, 07 | **Status:** Implemented

### Features

| ID | Feature | Priority | Acceptance Criteria |
|----|---------|----------|-------------------|
| F9.1 | Manual pipeline run on initialization | P0 | Single command runs full ingest → transform → infer chain |
| F9.2 | Phase-by-phase orchestration scripts | P0 | Each phase runnable independently |
| F9.3 | Deterministic run manifest (source versions, model versions) | P0 | Manifest captured per run; diff-able |
| F9.4 | Diff reporting (what changed between world builds) | P1 | Added/changed/removed entities reported |
| F9.5 | Rollback/archival of prior world states | P1 | Previous world_build_id restorable |
| F9.6 | Scheduled periodic runs | P2 | Cron or CI trigger on catalog release |
| F9.7 | CI validation (lint, tests, migration checks, Docker build) | P0 | GitHub Actions pipeline on every push |

---

## Cross-Reference: Feature → Phase Matrix

| Domain | Phase 01 | Phase 02 | Phase 03 | Phase 04 | Phase 05 | Phase 06 | Phase 07 | Phase 08 | Phase 09 |
|--------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| Ingestion | F1.* | | | | | | | | |
| Coordinates | | F2.* | | | | | | | |
| Inference | | | F3.* | | | | | | |
| Simulation | | | | F4.1–4.7 | | | | | |
| Sponsors/Expeditions | | | | | | | | | F4.25–4.28 |
| Resources/Economy | | | | F4.8–4.15 | | | | | F4.8–4.15 |
| Ships/Fleets | | | | | | | | | F4.29–4.33 |
| Terraforming | | | | | | | | | F4.34–4.37 |
| Conflict/Espionage | | | | | | | | | F4.38–4.40 |
| Communications | | | | | | | | | F4.41–4.43 |
| Victory Conditions | | | | | | | | | F4.44–4.49 |
| Campaigns | | | | | F5.* | | | | |
| API | | | | | F6.* | | | | |
| Web Viz | | | | | | F7.* | | | |
| Desktop | | | | | | F8.* | | | |
| Pipeline Ops | F9.1–3 | | | | | | F9.7 | F9.6 | |
