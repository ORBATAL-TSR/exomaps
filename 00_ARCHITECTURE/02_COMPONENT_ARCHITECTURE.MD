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
8. **Desktop System Explorer**
   - Tauri 2.10 native app with GLSL procedural planet generation.
9. **Game Client Adapter Layer**
   - Efficient state streaming/snapshot API.

## Data Flow
Raw Sources -> Staging -> Canonical Astro DB -> Inference Layer -> Versioned World Graph -> Simulation Runtime -> Client APIs -> Web/Desktop/Game UI

## Storage Strategy
- **Relational DB** for canonical entities, provenance, and configs.
- **Time-series/event tables** for simulation metrics and timeline changes.
- **Snapshot blobs** for fast client loading at key timestamps.

## Key Architectural Patterns
- **Versioned world builds** (`world_build_id`).
- **Confidence-tagged entities** (`observed`, `candidate`, `inferred`, `simulated`).
- **Reproducible deterministic generation** (seed + model version).
- **Read-optimized API projections** for map rendering.

---

## Desktop Client Component Architecture

### Core Components

```
ProceduralPlanet.tsx (2,400 LOC)
├── Planet Type Profiles (V record — 40+ types)
├── World Genome System (20 surfaces × 11 atmospheres × 9 hydrospheres)
├── deriveWorldVisuals() — physics → GLSL uniform pipeline
├── GLSL Vertex Shader — noise heightfield + displacement
├── GLSL Fragment Shader
│   ├── 6-biome palette blending
│   ├── Terrain age effects (craters, weathering, volcanic flows)
│   ├── Tectonics effects (fault scarps, folded mountains)
│   ├── Tidally locked eyeball rendering
│   ├── Ocean depth transparency (seafloor visible in shallows)
│   ├── Star-dependent vegetation colors
│   └── Temperature/mineral overlay maps
├── Atmosphere Shell (standard Fresnel scattering)
└── Thick Atmosphere Multi-Shell (Venus types: 2-3 cloud decks)
```

```
SystemFocusView.tsx (2,900 LOC)
├── Depth Navigation (system → planet → surface → colony)
├── Camera Controller (fly-to, orrery overhead, close-up)
├── Star System Orrery
│   ├── Orbital tracks + planet spheres
│   ├── Frost line / habitable zone indicators
│   ├── Asteroid/Kuiper belt rendering
│   └── layoutMoonOrbits() — collision-aware moon spacing
├── Sidebar Tree (star → planets → moons, clickable navigation)
├── Breadcrumb Bar (depth navigation history)
├── Tidal Lock Filtering (Roche-limit moon removal)
└── Colony Build Mode Controls
```

```
ColonyOverlay.tsx (683 LOC) + ColonyTerrain.ts (766 LOC)
├── 256×128 heightfield grid (JS noise, seed × 137.0)
├── A* pathfinding with road-cost awareness (70% discount)
├── Territory flood-fill + jittered-corner borders
├── Coastline detection + rendering
├── Building placement (terrain-projected)
├── GLB model import for structures
└── Catmull-Rom road spline smoothing
```

### GLSL Uniform Reference

| Uniform | Type | Source | Purpose |
|---------|------|--------|---------|
| uColor1/2/3 | vec3 | Profile + genome | Biome palette colors |
| uOceanColor | vec3 | Profile | Water/liquid tint |
| uOceanLevel | float | Profile | Sea level threshold |
| uAtmColor | vec3 | Profile | Atmosphere Rayleigh color |
| uAtmThickness | float | Profile | Atmosphere opacity/depth |
| uEmissive | float | Temperature | Lava glow (>800K) |
| uIceCaps | float | Temperature | Polar ice coverage |
| uCloudDensity | float | Profile | Cloud layer opacity |
| uNoiseScale | float | Profile | Terrain frequency |
| uSeed | float | seed × 137 | Deterministic noise |
| uCraterDensity | float | Age/atm | Impact crater frequency |
| uCrackIntensity | float | Tectonics | Surface fissure depth |
| uMountainHeight | float | Tectonics | Peak elevation scale |
| uValleyDepth | float | Tectonics | Canyon depth scale |
| uVolcanism | float | Heat/tidal | Volcanic feature density |
| uTerrainAge | float | Derived 0-1 | Ancient→weathered, young→smooth |
| uTectonics | float | Derived 0-1 | Fault scarps, folded mountains |
| uTidallyLocked | float | Orbital | Enables eyeball rendering |
| uFoliageColor | vec3 | Star type | Vegetation tint by spectral class |
| uIsGas | float | Type | Disables terrain for gas giants |
| uIsIceWorld | float | Frost line | Enables ice-world visuals |

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
