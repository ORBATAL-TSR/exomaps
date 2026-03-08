# 00 — Vision, Goals & Project Identity

## Project Identity

| Field | Value |
|-------|-------|
| **Name** | ExoMaps |
| **Tagline** | *Explore the neighborhood. Settle the stars.* |
| **Type** | Science-grounded interstellar colonization strategy game |
| **Genre** | Grand strategy / 4X / simulation |
| **Audience** | Strategy gamers, space enthusiasts, citizen scientists, educators |
| **License** | TBD (open-core model under consideration) |

---

## Vision

Build a **science-grounded interstellar colonization strategy game** in which players design, launch and manage slower-than-light expeditions to star systems within **100 parsecs (~326 light-years)** of the Sun. The game layers two realities together:

1. **Scientific reality** — real stars and over 6,000 confirmed exoplanets sourced from NASA Exoplanet Archive, SIMBAD, Gaia, and other catalogs, with 8,000+ candidates awaiting confirmation.
2. **System completeness reality** — inferred planets, asteroid belts, Kuiper-belt analogues, comets, and Oort-cloud bodies generated from physically motivated models where observations are incomplete.

On top of this foundation, the game runs a **hard-science simulation of orbital industry, resource extraction, colony development and interstellar economics** — where the constraints of slower-than-light physics and realistic space industry drive emergent stories of discovery, struggle, cooperation and growth.

ExoMaps follows a **space-first colonization model** — players build orbital infrastructure and exploit asteroid resources before touching down on planets — and gradually evolves into a **grand strategy game** where AI-controlled systems manage local economies while players orchestrate interstellar trade networks and diplomatic alliances.

The long-term aspiration is a game where scientific discovery, strategic simulation, and creative exploration reinforce each other: new catalog releases refine the galaxy model, which reshapes simulation dynamics, which creates new stories for players to discover.

### Vision Statement

> To deliver a science-driven, player-directed simulation of humanity's first interstellar
> expansion, where the constraints of slower-than-light physics and realistic space
> industry drive emergent stories of discovery, struggle, cooperation and growth.

ExoMaps aims to answer: **What would it take to build a spacefaring civilization using today's physics?**

---

## Product Statement

> *"A science-grounded interstellar colonization strategy game powered by real astronomical data, where players design expeditions, build orbital industry, exploit asteroid resources, colonize planets, and manage interstellar civilizations across hundreds of star systems within 100 parsecs of the Sun."*

---

## Core Objectives

| # | Objective | Measure |
|---|-----------|---------|
| O1 | Build a trustworthy data pipeline for stars and planetary systems within 100 pc | Reproducible world builds with diff reporting |
| O2 | Normalize all objects into 3D Cartesian coordinates for map and simulation use | Coordinate transform validation within ±0.1 LY |
| O3 | Preserve confidence and provenance for every generated entity | 100% of entities carry source, method, and confidence tier |
| O4 | Simulate long-timescale human expansion under realistic SFTL travel constraints | Century-scale runs with stable step latency (<500ms/tick) |
| O5 | Deliver a web client for analytics, strategic mapping, and simulation control | Interactive 3D map with drill-down, timeline, and control panels |
| O6 | Deliver a desktop game client with deeper interaction and high-fidelity rendering | Tauri-based client consuming shared simulation APIs |
| O7 | Support campaign-based play with fog-of-war exploration | Per-campaign exploration state with baked planet assets |
| O8 | Implement space-first colonization loop with orbital industry preceding planetary settlement | Players build stations, mine asteroids, and establish orbital infrastructure before landing |
| O9 | Model expedition creation with sponsors, contractors, and fleet composition | Sponsor ideology + contractor design philosophy shape strategy |
| O10 | Deliver 5 resource categories with NASA-grounded asteroid compositions | Volatiles, Metals, Rare Elements, Silicates, Carbon Compounds |
| O11 | Implement modular ship design with propulsion trade-offs and generation ships | Ship modules, propulsion types, fleet composition |
| O12 | Support multiple victory conditions and emergent narrative | Expansion, Economic, Scientific, Cultural, Utopian victories |

---

## Stakeholders & User Personas

| Persona | Description | Primary Needs |
|---------|-------------|---------------|
| **Expedition Organizer** | Core player role: designs, launches, and manages interstellar expeditions | Sponsor selection, fleet design, mission planning, colony management |
| **Explorer** | Curious about real stellar neighborhoods | Browse map, inspect real vs inferred data, learn |
| **Strategist** | Wants to plan and optimize expansion | Mission planning, route optimization, trade networks |
| **Ruler** | Wants to shape galactic politics and economy | Faction control, trade management, diplomacy, victory pursuit |
| **Scientist** | Wants to investigate astrophysical models | Confidence inspection, model comparison, data provenance |
| **Educator** | Uses ExoMaps as a teaching tool | Accessible web UI, real data emphasis, scenario presets |
| **Admin/Curator** | Maintains data quality and pipeline health | QA dashboards, quarantine review, pipeline monitoring |

---

## Scope Boundaries

### In Scope
- Star catalog assembly within **≤100 parsecs (~326 LY)**, with context shell beyond.
- Exoplanet ingestion from NASA Exoplanet Archive, SIMBAD, and future catalogs.
- Derived/inferred object generation for system completion (planets, asteroid belts, Kuiper-belt analogues, comets, Oort-cloud bodies).
- **Sponsor and prime contractor selection** shaping expedition flavor and strategy.
- **Space-first colonization model**: orbital infrastructure before planetary settlement.
- **5-category resource system** (Volatiles, Metals, Rare Elements, Silicates, Carbon Compounds) grounded in real asteroid compositions.
- **Modular ship design** with propulsion types (nuclear pulse, fusion, beamed sail, antimatter).
- **Production chains**: mining → refining → manufacturing → construction.
- **Terraforming** as a multi-century investment mechanic.
- **Speed-of-light communication delays** as a gameplay mechanic.
- **AI governors** for semi-autonomous local system management.
- **NPC characters** with traits affecting mission outcomes and story events.
- **Procedural story events** (equipment failures, asteroid impacts, disease, revolution, first contact).
- **5 victory conditions** (Expansion, Economic, Scientific, Cultural/Religious, Utopian).
- **Orbital conflict mechanics** (hacking, blockade, sabotage, espionage).
- Deterministic simulation engine with economy, politics, population dynamics.
- Campaign system with fog-of-war exploration and per-campaign state.
- Procedural planet generation with baked texture assets.
- Multi-client visualization APIs (REST + WebSocket).
- Periodic pipeline reruns (init + major catalog/model updates).
- Role-based access control and persona-filtered API responses.
- **Asynchronous multiplayer** (shared universe, communication-lag interactions).
- **Audio design** (ambient sound, adaptive music).

### Out of Scope (Current Horizon)
- FTL travel mechanics.
- Non-human intelligent species modeling (alien microbes via events only).
- Full N-body orbital precision for every object in real time.
- Real-time ingestion streams from observatories.
- Mobile-native client (React Native shell exists but is deferred).
- Monetization systems or in-app purchases.
- User-generated content marketplace.
- Planetary armies / ground combat (conflict is orbital and logistical).

### Future Horizon (Post-MVP)
- Technology branching into exotic propulsion (antimatter, beamed sails).
- Life & biospheres — ecosystem modeling, species evolution, astrobiology.
- Dynamic narrative arcs — cultural movements, philosophical debates, societal upheavals.
- Visual & audio polish — high-fidelity station/ship/planet renders; adaptive music.
- Modding support — custom star data, factions, technologies, story content.
- Advanced propulsion calculators (fusion, antimatter, beamed power).
- Integration with real telescope observation schedules.

---

## Design Principles

| Principle | Implication |
|-----------|-------------|
| **Science-first inputs, simulation-first outputs** | Real data anchors everything; gameplay emerges from plausible physics |
| **Space-first colonization** | Orbital infrastructure and asteroid mining before planetary settlement |
| **Confidence-aware everything** | Every entity tagged observed / inferred / simulated with method + seed |
| **Deterministic reproducibility** | Same seed + rules = same galaxy, every time |
| **Layered realism** | Plausible astrophysics underneath, playable abstraction on top |
| **Incremental complexity** | Tutorials teach basics; advanced mechanics (trade, diplomacy) unlock later |
| **Separation of concerns** | Pipeline, simulation, API, and clients are independently deployable |
| **Shared truth, multiple views** | One canonical backend state, rendered differently per client |
| **Player-directed, AI-managed** | Players set high-level policy; AI governors execute locally |
| **Emergent narrative** | Stories arise from simulation dynamics, not scripted campaigns |

---

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | Simulation tick <500ms for 500+ systems; web map interactive at 60fps with ~500 markers |
| **Scalability** | Support thousands of populated systems in late-game; thousands of interstellar routes; 100 pc stellar neighborhood |
| **Reliability** | Pipeline produces identical output for identical inputs; simulation deterministic per seed |
| **Availability** | Self-hosted first; cloud deployment target 99.5% uptime for API layer |
| **Security** | Role-based API access; no public write endpoints without authentication |
| **Observability** | Structured logging, pipeline run metrics, simulation tick telemetry |
| **Portability** | Docker-first deployment; runs on Linux, macOS, Windows (WSL) |
| **Multiplayer** | Asynchronous interactions via shared universe; communication-lag propagation |
| **Accessibility** | Layered complexity; tooltips, data overlays, simulation pausing; time compression for long travel |

---

## Success Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| S1 | Generate a coherent 3D map of star systems within 100 pc | Visual inspection + coordinate validation tests |
| S2 | For any star, explain what is observed vs inferred | Confidence tier present on all entities; UI toggle works |
| S3 | Run a century-scale SFTL expansion simulation with stable performance | 400-tick (100-year) run completes without degradation |
| S4 | Visualize state from web UI and desktop client from same APIs | Both clients render identical simulation state |
| S5 | Re-run pipeline and diff results after data/model updates | Diff report shows added/changed/removed entities |
| S6 | Campaign fog-of-war tracks exploration per player session | Exploration table populates; unexplored systems hidden |
| S7 | Pipeline and simulation are fully reproducible | Same inputs + seed = byte-identical outputs |
| S8 | Player can create an expedition with sponsor, contractor, and fleet | Full expedition creation flow functional |
| S9 | Space-first loop playable: orbital station → asteroid mining → refinery → colony | Complete production chain from orbit to surface |
| S10 | At least one victory condition achievable in a campaign | End-to-end campaign with scoring |

---

## Key Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Catalog data quality issues (conflicts, gaps) | Inaccurate galaxy model | Multi-source cross-matching, quarantine, human review |
| Simulation complexity outpaces performance | Unplayable late-game | Profiling-driven optimization, LOD for distant systems, sleep inactive systems |
| Scope creep from game mechanics ambition | Delayed MVP | Phase-gated delivery with exit criteria |
| Desktop client diverges from web in data model | Inconsistent experience | Shared API contracts, shared type definitions |
| Single-developer bottleneck | Slow iteration | Modular architecture, clear documentation, automation |
| 100 pc scope (vs. 100 LY) dramatically increases system count | Performance / data volume | Sleep-based scalability (inactive systems consume no CPU); spatial chunking |
| Resource system complexity becomes opaque | Player frustration | Layered tutorialization; production chain visualization |
| Asynchronous multiplayer conflict resolution | Desync or unfair advantages | Communication-lag-based propagation; deterministic resolution |
