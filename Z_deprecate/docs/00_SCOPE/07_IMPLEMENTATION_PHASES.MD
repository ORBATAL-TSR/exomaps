# 07 — Implementation Phases

## Overview

ExoMaps is delivered through a phased approach, from data foundations through simulation, visualization, and cloud deployment. Each phase has defined goals, deliverables, exit criteria, and dependencies. The modernization track (M-phases) runs in parallel with feature phases.

**Current State (March 2026):** Phases 01–07 complete. Phase 08 and game mechanics expansion next.

---

## Phase Dependency Graph

```
Phase 01 (Data Foundation)
    ├── Phase 02 (Coordinate Engine)
    │       ├── Phase 03 (Inference)
    │       │       ├── Phase 04 (Simulation)
    │       │       │       ├── Phase 05 (API Layer)
    │       │       │       │       ├── Phase 06 (Web Visualizer)
    │       │       │       │       └── Phase 6G (Game Client)
    │       │       │       ├── Phase 05C (Campaign APIs)
    │       │       │       └── Phase 09 (Game Mechanics Core)
    │       │       │               ├── Phase 10 (Sponsors & Expeditions)
    │       │       │               │       ├── Phase 11 (Terraforming & Conflict)
    │       │       │               │       │       └── Phase 12 (Victory & Narrative)
    │       │       │               │       └── Phase 12 (Victory & Narrative)
    │       │       │               └── Phase 13 (Multiplayer & Comms)
    │       │       └── Phase 03+ (100pc scope expansion)
    │       └── Phase 08 (Cloud Deploy)
    └── Phase M1–M6 (Modernization — parallel track)
```

---

## Phase Summary

| Phase | Name | Status | Key Deliverable |
|-------|------|--------|-----------------|
| **01** | Data Foundation | ✅ Complete | Canonical schema, pipeline, validation gates |
| **02** | Coordinate Engine | ✅ Complete | RA/Dec/parallax → X/Y/Z, ≤100 LY neighborhood |
| **03** | System Inference | ✅ Complete | Inferred planets/belts, world build manifests |
| **04** | Simulation Runtime | ✅ Complete | Deterministic engine, economy, politics, events |
| **05** | API Layer | ✅ Complete | World + simulation + campaign REST endpoints |
| **06** | Web Visualizer | ✅ Complete | Three.js star map, simulation dashboard |
| **07** | Legacy Modernization | ✅ Complete | CI/CD, pinned deps, structured logging, Makefile |
| **08** | Cloud Migration | 🔲 Planned | Docker hardening, staging deploy, budget controls |
| **09** | Game Mechanics Core | 🔲 Planned | Resources, production chains, ships, space-first loop |
| **10** | Sponsors & Expeditions | 🔲 Planned | Sponsor/contractor selection, fleet composition, launch |
| **11** | Terraforming & Conflict | 🔲 Planned | Terraforming projects, orbital warfare, espionage |
| **12** | Victory & Narrative | 🔲 Planned | Victory conditions, NPC characters, story events |
| **13** | Multiplayer & Comms | 🔲 Planned | Async multiplayer, light-speed comms, AI governors |
| **6G** | Game Client | 🔄 Shell Only | Tauri desktop client feature buildout |

---

## Phase 01 — Data Foundation
**Goal:** Create a reliable, reproducible canonical data layer for stars, planets, belts, provenance, and confidence.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Schema v1 (stars, planets, belts, provenance, confidence) | ✅ | `03_DATA/02_SCHEMAS/create_schemas.sql` |
| Forward + rollback migrations | ✅ | `03_DATA/03_MIGRATIONS/001_*` |
| Source adapters (NASA EA, SIMBAD) | ✅ | `01_SERVICES/02_PIPELINE/01_INGEST/` |
| Staging validation + quarantine | ✅ | Malformed rows quarantined with reason codes |
| Run manifest with checksums | ✅ | Source versions, adapter versions captured |
| QA report template | ✅ | Pass/fail summary, anomaly counts |

**Exit Criteria:** ✅ Pipeline run produces manifest + QA report with deterministic pass/fail gates.

---

## Phase 02 — 3D Coordinate Engine
**Goal:** Produce stable Cartesian coordinates and nearby-neighborhood selection with uncertainty-aware boundaries.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| ICRS J2000.0 → Cartesian transform module | ✅ | 500+ LOC, parallax → parsec → XYZ |
| Uncertainty propagation from parallax error | ✅ | Error bounds stored per coordinate |
| ≤100 LY inclusion with edge shell (100–110 LY) | ✅ | Context systems for visual continuity |
| Schema: `stars_xyz`, `nearby_stars`, `edge_stars` | ✅ | Migration 003 |
| Sanity checks (distance bounds, parallax round-trip) | ✅ | Automated validation in pipeline |

**Exit Criteria:** ✅ Coordinate transform suite passes; neighborhood reproducible across reruns.

---

## Phase 03 — System Completion Inference
**Goal:** Fill observational gaps with physically plausible inferred planets and belts.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Planet inference from stellar type + architecture priors | ✅ | 400+ LOC engine |
| Orbital spacing and stability heuristics | ✅ | Hill sphere, spacing, eccentricity caps |
| Belt inference (inner rocky / outer icy) | ✅ | Conditional on system architecture |
| Inference metadata (method, seed, model_version, confidence) | ✅ | All inferred entities tagged |
| World build manifest with reproducibility tracking | ✅ | Deterministic seed-based generation |
| Simulation-facing fields (resource_potential, exploration_priority) | 🔲 | Deferred to Phase 09 integration |

**Exit Criteria:** ✅ Framework complete. Remaining: simulation-facing enrichment fields.

---

## Phase 04 — Simulation Runtime Core
**Goal:** Stand up a deterministic server-side simulation engine for SFTL expansion dynamics.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Hybrid tick/event loop (5-phase) | ✅ | Pop → Migrate → Trade → Politics → Events |
| Population growth with carrying capacity | ✅ | 2% growth, 1B cap per system |
| Economy: production, consumption, trade, tech levels 0–10 | ✅ | `economy_politics.py` |
| Politics: cohesion, tension, independence | ✅ | Decay, distance penalty, secession |
| Procedural events (5+ types) | ✅ | Discovery, conflict, migration, shortage, breakthrough |
| Deterministic snapshot save/load (JSON) | ✅ | Seed-based `numpy.RandomState` |
| SFTL fleet routing and travel delays | 🔲 | Defined but not yet implemented |

**Exit Criteria:** ✅ 100-tick runs verified deterministic. Outstanding: fleet routing.

**Verified Results (Test Run):**
- 50 ticks executed, 26.4M total population across settlements
- 6 strategic events generated (deterministic, reproducible)
- Economy: Tech levels 0–10 active, trade surplus/deficit tracking
- Politics: Cohesion decay, independence movements operational

---

## Phase 05 — API Layer
**Goal:** Expose stable, versioned APIs for world inspection, simulation control, and campaign management.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| World inspection: `/api/world/systems`, `/api/world/confidence` | ✅ | Persona-filtered responses |
| Run history: `/api/runs/manifest`, `/api/runs/validation/:id` | ✅ | Full lineage tracking |
| Role-based access + HTTP 403 | ✅ | Decorator-based enforcement |
| Simulation control: snapshot, events, pause, resume, step | ✅ | 5 endpoints, role-protected |
| Campaign CRUD: `/api/campaigns/*` | ✅ Stubs | Schema + routes exist; DB queries TODO |
| Fog-of-war map: `/api/campaigns/:id/map` | ✅ Stub | Returns stub data |
| OpenAPI/Swagger documentation | 🔲 | Planned |
| WebSocket real-time events | 🔲 | Planned |

**Exit Criteria:** ✅ Core APIs operational. Outstanding: wire campaign stubs to DB, OpenAPI docs, WebSocket.

---

## Phase 06 — Web Visualizer MVP
**Goal:** Deliver a strategic command-map for inspecting systems and steering simulation.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| 3D StarField (Three.js, ~500 markers, spectral colors) | ✅ | 60fps with orbit controls |
| System drill-down panel | ✅ | Star + planet properties |
| Layer toggles (observed, inferred, HZ, trade, resources) | ✅ | Independent toggle controls |
| Distance filtering slider | ✅ | Real-time filter |
| Simulation control dashboard | ✅ | Metrics, speed, pause/resume, event log |
| Responsive layout (Bootstrap grid) | ✅ | Desktop-optimized |

**Exit Criteria:** ✅ All MVP features delivered and tested.

---

## Phase 07 — Legacy Modernization
**Goal:** Modernize the codebase safely without full rewrite risk.

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Pinned dependencies (Python + Node) | ✅ | Lock files for reproducibility |
| CI/CD: lint, test, migration validation, Docker build | ✅ | GitHub Actions on every push |
| Structured logging with PhaseLogger | ✅ | JSON + plain-text formatters, rotating files |
| Makefile with 20+ shortcuts | ✅ | `make full-test` runs complete CI locally |
| Multi-Python version testing (3.9, 3.10, 3.11) | ✅ | In CI matrix |

**Exit Criteria:** ✅ Build reproducibility achieved. Full CI pipeline operational.

---

## Phase 08 — Cloud Migration & Cost Optimization
**Goal:** Move to cloud hosting with low fixed cost and predictable monthly spend.

| Deliverable | Status | Target |
|-------------|--------|--------|
| Hardened Docker images with health/readiness probes | 🔲 | Multi-stage builds, non-root, health endpoints |
| Staging stack: API + DB + object storage + worker | 🔲 | Single-node or K3s cluster |
| Full pipeline run in cloud with reference output comparison | 🔲 | Bit-identical to local run |
| Artifact lifecycle policies (retention, archival, deletion) | 🔲 | Per retention table in 06_DATA_GOVERNANCE |
| Budget alerts (50%/80%/100% thresholds) | 🔲 | Cloud provider billing integration |
| Right-sized baseline + ephemeral compute for heavy jobs | 🔲 | Burst workers for pipeline runs |
| Rollback runbook (image + world_build_id switch-back) | 🔲 | Documented procedure + tested |

**Dependencies:** Phase 07 (complete), Docker Compose (exists)
**Exit Criteria:** Production deployment stable; monthly cost within budget envelope.

**Risk:** Cloud provider lock-in. **Mitigation:** Docker-first; avoid provider-specific services where possible.

---

## Phase 09 — Game Mechanics Core (EXPANDED)
**Goal:** Implement the foundational game mechanics: 5-category resource system, production chains, modular ships, and the space-first colonization loop.

| Deliverable | Status | Target |
|-------------|--------|--------|
| 5-category resource system (Volatiles, Metals, Rare Elements, Silicates, Carbon Compounds) | 🔲 | Economy layer extension |
| Asteroid spectral class composition (C-type, S-type, M-type) | 🔲 | NASA-grounded resource generation |
| Production chains (mining → refining → manufacturing → construction) | 🔲 | Multi-stage with bottleneck effects |
| Power & energy system (fission, fusion, solar, antimatter) | 🔲 | Reactor models, fuel mining |
| Infrastructure maintenance and degradation | 🔲 | Spare parts, repair cycles |
| Space-first colony lifecycle (orbital anchor → orbital industry → outpost → settlement → colony → mature world) | 🔲 | New colony stage model |
| Dynamic market pricing per commodity | 🔲 | Supply/demand curves |
| Ship class definitions + modular construction schema | 🔲 | Colony ship, cargo, courier, patrol, probe, industrial |
| Propulsion type system (nuclear pulse, fusion, beamed sail, antimatter) | 🔲 | Trade-offs: thrust, efficiency, mass, cost |
| SFTL fleet routing with multi-hop and refueling | 🔲 | Deferred from Phase 04 |
| Mission planning schema + API (survey, colonize, trade, science) | 🔲 | Campaign + fleet integration |
| Automated miners & drones | 🔲 | Autonomous asteroid operations |

**Dependencies:** Phase 04 (simulation core), Phase 05 (campaign APIs wired up)
**Exit Criteria:** Space-first loop playable: orbital station → asteroid mining → refinery → planetary settlement.

---

## Phase 10 — Sponsors & Expeditions (NEW)
**Goal:** Implement the sponsor/contractor expedition creation system.

| Deliverable | Status | Target |
|-------------|--------|--------|
| Sponsor definitions (6 types with ideology, bonuses, weaknesses) | 🔲 | Government, Corporate, Scientific, Frontier, Religious, Breakaway |
| Prime contractor definitions (4 types with ship design philosophy) | 🔲 | NuSpace, Tronicon, Kosmik, Globulo |
| Expedition creation flow (sponsor + contractor + resource allocation) | 🔲 | Pre-launch mini-game |
| Fleet composition planner (colony ships, industrial vessels, escorts) | 🔲 | Fleet mix affects initial capabilities |
| Interstellar transit phase (cryogenic/generational, contingencies) | 🔲 | Mid-flight events, wake-up scheduling |
| Sponsor funding negotiation | 🔲 | Budget allocation mechanics |
| Research priority selection pre-launch | 🔲 | Technology investment choices |

**Dependencies:** Phase 09 (ship classes, resource system)
**Exit Criteria:** Player can create a full expedition, choose sponsor/contractor, compose fleet, and launch.

---

## Phase 11 — Terraforming & Conflict (NEW)
**Goal:** Implement multi-century terraforming projects and orbital conflict mechanics.

| Deliverable | Status | Target |
|-------------|--------|--------|
| Terraforming difficulty scoring per planet | 🔲 | f(atmosphere, mass, temperature, radiation) |
| Atmosphere modification projects | 🔲 | Multi-century, resource-intensive |
| Ocean seeding and magnetic field projects | 🔲 | Milestone-based progression |
| Orbital conflict: blockade, sabotage, hacking | 🔲 | Trade lane disruption, infrastructure damage |
| Espionage: steal research, incite rebellion | 🔲 | Covert ops with success/failure probabilities |
| Interstellar councils and treaty voting | 🔲 | Shared initiatives, embargoes |
| Technology tree (propulsion, life-support, automation, weapons) | 🔲 | Research unlocks + investment allocation |

**Dependencies:** Phase 09 (production chains), Phase 10 (factions)
**Exit Criteria:** Terraforming project initiatable; at least one conflict mechanic functional.

---

## Phase 12 — Victory & Narrative (NEW)
**Goal:** Implement victory conditions, NPC characters, and procedural narrative.

| Deliverable | Status | Target |
|-------------|--------|--------|
| 5 victory conditions (Expansion, Economic, Scientific, Cultural, Utopian) | 🔲 | Scoring and threshold system |
| NPC character system (traits: leadership, greed, expertise) | 🔲 | Characters affect mission success |
| Procedural story events (equipment failure, disease, mutiny, first contact) | 🔲 | Event generator extension (10+ types) |
| Event cards with player choices | 🔲 | Rich presentation in desktop client |
| Campaign scoring and achievement system | 🔲 | Track progress toward victory |
| Human diaspora timeline narrative | 🔲 | Auto-generated expansion history |

**Dependencies:** Phase 10 (sponsors/factions), Phase 11 (conflict for narrative triggers)
**Exit Criteria:** At least one victory condition achievable; NPC events fire during play.

---

## Phase 13 — Multiplayer & Communications (NEW)
**Goal:** Implement asynchronous multiplayer and speed-of-light communication mechanics.

| Deliverable | Status | Target |
|-------------|--------|--------|
| Speed-of-light message delay system | 🔲 | Messages arrive after years of game time |
| Message queue UI (sent time, ETA, response ETA) | 🔲 | Player sees delay visualized |
| AI governor behavior-tree system | 🔲 | Autonomous local management between messages |
| Asynchronous multiplayer: shared universe | 🔲 | Multiple players interact via trade, messages, conflict |
| Communication-lag-based action propagation | 🔲 | Deterministic resolution |
| Generation ship communication protocols | 🔲 | Transit-phase wake-up and direction changes |

**Dependencies:** Phase 09 (core loop), Phase 04 (messaging service)
**Exit Criteria:** Two players can interact in shared universe with realistic communication delays.

---

## Phase 6G — Game Client Feature Track
**Goal:** Build out the Tauri desktop client from shell to feature-rich experience.

| Deliverable | Status | Target |
|-------------|--------|--------|
| API client integration (shared types from SHARED/) | 🔲 | Consume same endpoints as web |
| Star map (port from web Three.js) | 🔲 | Desktop viewport adaptation |
| Campaign management (create, load, save locally) | 🔲 | Tauri file system commands |
| Colony + fleet management panels | 🔲 | Desktop-specific deep controls |
| Ship designer UI | 🔲 | Modular drag-and-drop builder |
| Offline mode with local simulation | 🔲 | SQLite cache + local sim engine |

**Dependencies:** Phase 05 (stable APIs), Phase 09 (game mechanics to display)
**Exit Criteria:** Desktop client plays a full campaign with feature parity to web + extras.

---

## Exit Criteria Template (All Phases)

Each phase must define before completion:
- [ ] **Functional acceptance tests** — key scenarios verified
- [ ] **Data quality thresholds** — validation pass rates above minimum
- [ ] **Performance benchmarks** — tick latency, render FPS within targets
- [ ] **Known risk list** — documented with mitigation status
- [ ] **Cost envelope** — cloud resource usage within budget (Phase 08+)
- [ ] **Rollback readiness** — can revert to previous phase state

---

## Timeline Estimate (Rough)

| Phase | Estimated Duration | Dependencies |
|-------|-------------------|-------------|
| Phase 08 (Cloud) | 2–3 weeks | Phase 07 ✅ |
| Phase 09 (Game Mechanics Core) | 6–8 weeks | Phase 04/05 ✅ |
| Phase 10 (Sponsors & Expeditions) | 3–4 weeks | Phase 09 |
| Phase 11 (Terraforming & Conflict) | 4–6 weeks | Phase 09, 10 |
| Phase 12 (Victory & Narrative) | 3–4 weeks | Phase 10, 11 |
| Phase 13 (Multiplayer & Comms) | 4–6 weeks | Phase 09 |
| Phase 6G (Desktop Client) | 8–12 weeks (ongoing) | Phase 05/09/10 |

*Timeline assumes single-developer pace. Parallelization with contributors would compress significantly.*
*Phase 09 is the critical path — all game-specific phases depend on it.*
