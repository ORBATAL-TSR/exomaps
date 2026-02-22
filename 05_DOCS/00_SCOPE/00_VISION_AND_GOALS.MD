# 00 — High Level Scope

## Vision
Build a living simulation platform that starts from real astronomical observations and grows into a plausible human-diaspora future across nearby stellar systems (within 100 light years). The platform has two realities layered together:

1. **Scientific reality**: real stars and exoplanets (confirmed + unconfirmed candidates).
2. **System completeness reality**: inferred planets, belts, and orbital structure generated from physically motivated models where observations are incomplete.

On top of this, run a **slower-than-light interstellar civilization simulation** (economy, logistics, politics, fleets, colonies) with user control and game-like scenario progression.

## Product Statement
"A periodically refreshed astrophysical world-model and simulation server that powers both a web visualizer and a future high-fidelity game client for exploring and steering humanity’s expansion among nearby stars."

## Core Objectives
- Build a trustworthy data pipeline for nearby stars and planetary systems.
- Normalize all objects into 3D Cartesian coordinates for map and simulation use.
- Preserve confidence and provenance for every generated entity.
- Simulate long-timescale human expansion under realistic travel constraints.
- Provide two client layers:
  - **Web client**: analytics + strategic map.
  - **Game client**: richer controls, high-performance rendering, deeper interaction loops.

## Scope Boundaries
### In Scope
- Nearby-star catalog assembly (<= 100 LY).
- Exoplanet ingestion from multiple sources.
- Derived/inferred object generation for system completion.
- Simulation engine service + persistence.
- Multi-client visualization APIs.
- Periodic pipeline reruns (init + major catalog/model updates).

### Out of Scope (initially)
- FTL travel.
- Non-human intelligent species modeling.
- Full N-body precision for every object in real time.
- Real-time ingestion streams from observatories.

## Design Principles
- **Science-first inputs, simulation-first outputs**.
- **Confidence-aware everything** (observed vs inferred vs simulated).
- **Deterministic reproducibility** for scenario seeds and reruns.
- **Layered realism**: plausible astrophysics, playable systems.
- **Incremental complexity**: strong MVP core before advanced mechanics.

## Success Criteria
- Can generate a coherent 3D map of star systems within 100 LY.
- For a target star, can explain what is observed vs inferred.
- Can run a century-scale SFTL expansion simulation with stable performance.
- Can visualize state from web UI and game client from same server APIs.
- Can re-run pipeline and diff results after data/model updates.
