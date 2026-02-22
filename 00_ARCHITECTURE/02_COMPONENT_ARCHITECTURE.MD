# 02 — Architecture Blueprint

## Logical Components
1. **Ingestion Service**
   - Connectors/parsers for each astronomy source.
2. **Normalization & Cross-Match Service**
   - Identity resolution + canonical schema population.
3. **Inference Service**
   - Planet/belt generation and orbital plausibility checks.
4. **World State Store**
   - Versioned astrophysical map + simulation snapshots.
5. **Simulation Engine Service**
   - Runs interstellar socio-economic-political simulation.
6. **API Gateway**
   - Serves data and control endpoints to clients.
7. **Web Visualization Client**
   - Strategic map, analysis, interaction.
8. **Game Client Adapter Layer**
   - Efficient state streaming/snapshot API.

## Data Flow
Raw Sources -> Staging -> Canonical Astro DB -> Inference Layer -> Versioned World Graph -> Simulation Runtime -> Client APIs -> Web/Game UI

## Storage Strategy
- **Relational DB** for canonical entities, provenance, and configs.
- **Time-series/event tables** for simulation metrics and timeline changes.
- **Snapshot blobs** for fast client loading at key timestamps.

## Key Architectural Patterns
- **Versioned world builds** (`world_build_id`).
- **Confidence-tagged entities** (`observed`, `candidate`, `inferred`, `simulated`).
- **Reproducible deterministic generation** (seed + model version).
- **Read-optimized API projections** for map rendering.

## API Surface (Conceptual)
- `/astro/world/latest`
- `/astro/world/{build_id}`
- `/astro/system/{system_id}`
- `/sim/run/{run_id}/tick`
- `/sim/run/{run_id}/control`
- `/sim/run/{run_id}/metrics`
- `/sim/run/{run_id}/state/snapshot`

## Runtime Separation
- **Pipeline runtime**: periodic, heavy compute, not latency-sensitive.
- **Simulation runtime**: long-running server process with deterministic stepping.
- **Visualization runtime**: low-latency read APIs and selective streaming.

## Scaling Approach
- Start single-node modular monolith.
- Evolve to service split only for bottlenecks (inference compute, simulation loop, API layer).
- Use job queue for expensive world-build steps.

## Reliability Requirements
- Build retries and resumable pipeline checkpoints.
- Idempotent ingestion and transformation jobs.
- Snapshot integrity checks.
- Reconciliation reports between source releases and world builds.
