# 08 — Open Questions & Research Backlog

## Overview

This document tracks open questions, research tasks, and design decisions that need resolution. Questions are prioritized and tracked with resolution status so answered questions remain as a decision log.

**Last reviewed:** March 2026

---

## Status Key

| Status | Meaning |
|--------|---------|
| 🔴 Open | Needs investigation or decision |
| 🟡 In Progress | Being researched or prototyped |
| 🟢 Resolved | Decision made; rationale documented |
| ⚪ Deferred | Intentionally postponed to later phase |

---

## Astronomy & Data Questions

| ID | Question | Priority | Status | Resolution / Notes |
|----|----------|----------|--------|-------------------|
| A1 | Which primary catalog(s) become canonical for nearby-star distances? | P0 | 🟢 Resolved | **Gaia DR3 parallax as primary**; Hipparcos as fallback for bright stars missing from Gaia. NASA EA for planets. SIMBAD for cross-refs and spectral types. |
| A2 | How to prioritize conflicting planetary parameters across sources? | P0 | 🟢 Resolved | **Source trust hierarchy**: NASA EA confirmed > Gaia > SIMBAD > Hipparcos. For conflicts: higher-trust source wins; conflict logged in quarantine for curator review. |
| A3 | What confidence threshold admits unconfirmed planets into strategic simulation? | P1 | 🟢 Resolved | **T2 (≥0.50) admitted with weighted contribution.** T3 (inferred) available for exploration but with reduced starting resources. T4 excluded from simulation. |
| A4 | How should we handle binary/multiple star systems for coordinate assignment? | P1 | 🟡 In Progress | Current: barycenter position used. Open: should individual components have separate coordinates for system-view rendering? |
| A5 | What is the cutoff for "nearby" when new catalogs push to higher precision? | P0 | 🟢 Resolved | **Changed to 100 parsecs (~326 LY)** per new game design scope. Significant expansion from original 100 LY. Requires pipeline and inference scaling work. |
| A6 | How to incorporate proper motion for long simulation timescales? | P3 | ⚪ Deferred | Over 1000-year sim: some systems move ~0.1 LY. Negligible for current gameplay but matters for hard-science accuracy. |
| A7 | How to handle the 100 pc scope expansion from 100 LY (data volume ~10× increase)? | P0 | 🔴 Open | Current pipeline handles ~500 systems at 100 LY. 100 pc includes thousands of systems. Need: catalog expansion, performance profiling, spatial chunking strategy. |

---

## Modeling & Inference Questions

| ID | Question | Priority | Status | Resolution / Notes |
|----|----------|----------|--------|-------------------|
| M1 | Which inference methods balance plausibility and computation cost best? | P0 | 🟢 Resolved | **Orbital lane spacing with empirical priors** (Kepler statistics by stellar type). Fast, deterministic, physically motivated. AMD stability check post-generation. |
| M2 | How to calibrate generated system richness without overfitting Solar analog assumptions? | P1 | 🟡 In Progress | Current: stellar-type-based planet count priors. Risk: M-dwarfs may be over/under-populated. Need: validation against Kepler/TESS multi-planet statistics per spectral type. |
| M3 | What minimum orbital model is sufficient for gameplay without pseudo-precision? | P0 | 🟢 Resolved | **Keplerian ellipses with fixed elements.** No secular evolution, no perturbations. Sufficient for map display and colonization planning. Full N-body reserved for special systems (e.g., TRAPPIST-1). |
| M4 | Should inferred planets have procedural names or designations? | P2 | 🔴 Open | Options: (a) "{star_name} {letter}" continuing from last confirmed, (b) numeric index only, (c) procedural names from seed. Affects UI and immersion. |
| M5 | How to handle systems where inference disagrees with later observations? | P2 | 🔴 Open | When new catalog data confirms/denies an inferred planet: (a) auto-replace, (b) flag for curator, (c) keep both with provenance. Affects reproducibility contract. |

---

## Simulation Questions

| ID | Question | Priority | Status | Resolution / Notes |
|----|----------|----------|--------|-------------------|
| S1 | What travel model best captures SFTL hardship while remaining playable? | P0 | 🟡 In Progress | Current: `transit_years = distance / velocity_fraction_c`. Ship classes defined (0.05c–0.15c). Outstanding: refueling stops, multi-hop routing, fleet scheduling. |
| S2 | How complex should economy chains be for emergent behavior before they become opaque? | P0 | 🟢 Resolved | **3-tier production chain**: Raw → Processed → Manufactured. Plus agriculture and energy. Deep enough for trade dynamics; shallow enough to be readable. |
| S3 | Which political abstractions produce readable and meaningful maps? | P1 | 🟢 Resolved | **Cohesion + tension model.** Single scalar per faction (cohesion) plus bilateral tension. Independence movements from distance + low cohesion. Produces clean political map with faction boundaries. |
| S4 | How should time controls work for multiplayer scenarios? | P2 | 🔴 Open | Options: (a) slowest player sets pace, (b) vote-to-advance, (c) real-time with tick queue. Single-player resolved (pause/resume/step). |
| S5 | What defines "winning" a campaign? | P0 | 🟢 Resolved | **5 victory conditions defined**: Expansion (largest network), Economic (trade dominance), Scientific (key research), Cultural/Religious (ideology spread), Utopian (peace + equality). Custom goals also configurable. |
| S6 | Should AI factions have the same simulation mechanics as player factions? | P1 | 🟡 In Progress | New scope specifies AI governors using behaviour trees. Factions operate under sponsor ideologies. Symmetric mechanics preferred for emergence, with AI-specific personality traits for variety. |
| S7 | How should the space-first colonization loop be structured? | P0 | 🟢 Resolved | **Orbital Anchor → Orbital Industry → Outpost → Settlement → Colony → Mature World.** Players build stations and mine asteroids before touching down on planets. |
| S8 | How complex should the 5-category resource system be? | P0 | 🔴 Open | Categories defined (Volatiles, Metals, Rare Elements, Silicates, Carbon Compounds). Open: how many sub-resources per category? Balancing realism vs. cognitive load. |
| S9 | How should terraforming project milestones work? | P1 | 🔴 Open | Projects span centuries. Need: milestone event design, intermediate benefits, resource sink scaling. |
| S10 | How should NPC characters interact with gameplay? | P2 | 🔴 Open | New scope defines characters with traits (leadership, greed, expertise). Open: how much narrative agency? Story events only, or player-interactive dialogues? |
| S11 | How should generation ships handle multi-generational population dynamics? | P2 | 🔴 Open | Closed ecosystems with agriculture and education. Open: simulate individual generations or abstract to population/culture drift? |

---

## Product & Design Questions

| ID | Question | Priority | Status | Resolution / Notes |
|----|----------|----------|--------|-------------------|
| P1 | What is the core player fantasy: planner, ruler, explorer, or systems analyst? | P0 | � Resolved | **Expedition Organizer**: player designs, launches, and manages expeditions. Chooses sponsor and contractor. Sets macro policy; AI governors handle local execution. Multiple role modes still supported for flexibility. |
| P2 | How much direct control vs high-level policy steering should the player have? | P0 | 🟢 Resolved | **Macro-first with tactical moments**: players set system-level policies via delayed messages. Direct control for expedition creation, fleet composition, and crisis response. AI governors execute routine management. |
| P3 | Which metrics define a successful campaign outcome? | P1 | 🟢 Resolved | **5 victory conditions with scoring**: Expansion (systems × self-sufficiency), Economic (GDP + trade), Scientific (research milestones), Cultural (ideology coverage %), Utopian (peace × equality × sustainability). |
| P4 | Should the web and desktop clients share a play session? | P2 | 🔴 Open | Use case: plan on web, execute on desktop. Requires: campaign state sync, conflict resolution. |
| P5 | What tutorial/onboarding is needed? | P1 | 🟡 In Progress | New scope specifies layered complexity: early tutorials teach basic resource management and construction, advanced mechanics unlock later. Tooltips, data overlays, simulation pausing. Time compression for long travel. |
| P6 | How should sponsor negotiation mini-game work? | P1 | 🔴 Open | New scope mentions negotiating with sponsors for funding and technology. Open: how deep should this be? Quick allocation vs. full negotiation simulation. |
| P7 | What audio design approach for space ambience? | P2 | 🔴 Open | New scope: quiet isolation of space, muted engine rumbles, broadcast static, station ambiance. Music evolves from hopeful → ethereal/tense. Need: audio engine integration, adaptive music system. |
| P8 | How should prime contractors differentially affect gameplay? | P1 | 🔴 Open | 4 contractors (NuSpace, Tronicon, Kosmik, Globulo) have design philosophies but need specific numeric bonuses/penalties defined for modules, costs, and reliability. |

---

## Engineering Questions

| ID | Question | Priority | Status | Resolution / Notes |
|----|----------|----------|--------|-------------------|
| E1 | Best partition between precomputed snapshots and live updates? | P0 | 🟢 Resolved | **Snapshots for persistence + live ticks for interaction.** Snapshot every 10 ticks or on pause. Clients consume latest snapshot + incremental events. |
| E2 | How to maintain deterministic replay across engine versions? | P0 | 🟡 In Progress | Current: seed-based `numpy.RandomState`. Risk: numpy version changes alter RNG sequence. Mitigation: pin numpy version in lock file; add regression test with golden output. |
| E3 | What profiling regime is needed before game-client-scale rendering? | P1 | 🔴 Open | Need: GPU profiling framework for Three.js/WebGPU. Metrics: draw calls, memory, frame time breakdown. Tools: Chrome DevTools, RenderDoc, PIX. |
| E4 | How should the World Engine service be architected? | P0 | 🔴 Open | `01_SERVICES/03_WORLD_ENGINE/` is empty. Options: (a) Flask microservice wrapping simulation_core.py, (b) Rust service for performance, (c) Python + Redis for job queue. |
| E5 | What messaging pattern for real-time sync? | P1 | 🔴 Open | `01_SERVICES/04_MESSAGING/` is empty. Options: (a) Redis pub/sub, (b) WebSocket via Flask-SocketIO (already imported), (c) Server-Sent Events. |
| E6 | Database connection pooling strategy for concurrent clients? | P1 | 🔴 Open | Current: per-request connections. Need: SQLAlchemy connection pool with configurable size for API + pipeline coexistence. |

---

## Resolved Decisions Log

| ID | Decision | Date | Rationale |
|----|----------|------|-----------|
| A1 | Gaia DR3 as primary distance source | Feb 2026 | Best parallax precision for nearby stars; Hipparcos supplement for gaps |
| A2 | Source trust hierarchy for conflicts | Feb 2026 | Objective resolution without manual intervention per record |
| A5 | Scope expanded to 100 parsecs (~326 LY) | Mar 2026 | New game design scope; thousands of systems for grand strategy depth |
| M1 | Orbital lane spacing for inference | Feb 2026 | Deterministic, fast, physically grounded, easily tunable |
| M3 | Keplerian fixed-element orbits | Feb 2026 | Gameplay doesn't need perturbation; visual fidelity sufficient |
| S2 | 3-tier production chain (expanded to 5-category) | Mar 2026 | Originally 3-tier; now 5 resource categories with NASA asteroid data |
| S3 | Cohesion + tension political model | Feb 2026 | Maps cleanly to visual boundaries; independence arcs readable |
| S5 | 5 victory conditions | Mar 2026 | Expansion, Economic, Scientific, Cultural, Utopian |
| S7 | Space-first colonization loop | Mar 2026 | Orbital industry before planetary settlement; reverses typical colony games |
| P1 | Expedition Organizer as core player role | Mar 2026 | Player designs and launches expeditions; AI governors handle local execution |
| P2 | Macro-first control with tactical moments | Mar 2026 | Policy via delayed messages; direct control for fleet/crisis |
| P3 | 5 victory conditions with scoring | Mar 2026 | Clear win conditions with quantifiable progress |
| E1 | Snapshot + incremental model | Feb 2026 | Balances storage efficiency with real-time responsiveness |

---

## Research Tasks (Prioritized)

| # | Task | Priority | Status | Related Question |
|---|------|----------|--------|-----------------|
| R1 | Validate coordinate transforms against external tool (e.g., astropy) | P0 | 🟢 Done | A1 |
| R2 | Benchmark inference on 50 well-studied nearby systems | P1 | 🟡 In Progress | M2 |
| R3 | Prototype SFTL multi-hop routing with refuel constraints | P1 | 🔴 Open | S1 |
| R4 | Design World Engine service API contract | P0 | 🔴 Open | E4 |
| R5 | Evaluate Redis pub/sub vs WebSocket for real-time events | P1 | 🔴 Open | E5 |
| R6 | Profile Three.js rendering at 5,000+ star markers | P1 | 🔴 Open | E3 |
| R7 | Design victory condition scoring algorithms | P1 | 🔴 Open | S5 |
| R8 | Build golden-output regression test for simulation determinism | P1 | 🔴 Open | E2 |
| R9 | Assess pipeline performance impact of 100 pc scope (vs 100 LY) | P0 | 🔴 Open | A7 |
| R10 | Design 5-category resource balance model | P0 | 🔴 Open | S8 |
| R11 | Prototype sponsor/contractor bonus system with numeric values | P1 | 🔴 Open | P8 |
| R12 | Evaluate audio engine options for Tauri desktop client | P2 | 🔴 Open | P7 |
| R13 | Design AI governor behaviour tree architecture | P1 | 🔴 Open | S6 |
| R14 | Design terraforming project milestone system | P1 | 🔴 Open | S9 |
| R15 | Prototype NPC character trait system | P2 | 🔴 Open | S10 |
