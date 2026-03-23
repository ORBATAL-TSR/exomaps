# 01 — System Architecture

## Overview

ExoMaps is a **unified full-stack platform** that assembles real astronomical data into an interactive 3-D stellar cartography engine and slower-than-light interstellar civilization simulator. The system is designed as a **modular monolith**: a single deployable unit whose internal boundaries mirror the numbered directory hierarchy, making every component's purpose and data flow immediately legible.

```
 ┌──────────────────────────────────────────────────────────────┐
 │                        BROWSER                               │
 │  React 19 · TypeScript · React Three Fiber · GLSL Shaders   │
 │  Three.js WebGL2 renderer with custom star shaders           │
 └──────────────────────┬───────────────────────────────────────┘
                        │ HTTP / JSON
 ┌──────────────────────▼───────────────────────────────────────┐
 │                 04_SERVER  (Flask · port 5000)                │
 │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐       │
 │  │ /api/*     │ │ /          │ │ Static Build Assets │       │
 │  │ REST JSON  │ │ SPA entry  │ │ JS / CSS / shaders  │       │
 │  └──────┬─────┘ └─────┬──────┘ └────────┬───────────┘       │
 │         │             │                  │                    │
 │         ▼             ▼                  ▼                    │
 │  ┌──────────────────────────────────────────────────┐        │
 │  │ SQLAlchemy  →  PostgreSQL 17                     │        │
 │  │ Schemas: stg_data · dm_galaxy · app_simulation   │        │
 │  └──────────────────────────────────────────────────┘        │
 └──────────────────────────────────────────────────────────────┘
          ▲                                        ▲
          │  Populated by                          │  Read by
 ┌────────┴──────────────────────────────────────  │ ──────────┐
 │              02_PIPELINE  (offline batch)        │           │
 │  Phase 01 ─► Phase 02 ─► Phase 03 ─► Phase 04  │           │
 │  Ingest      Transform    Inference   Simulation│           │
 │  CSV→stg     RA/Dec→XYZ   Titius-Bode  SFTL     │           │
 └─────────────────────────────────────────────────────────────┘
```

---

## Directory Map

Every top-level folder carries a two-digit prefix that encodes its role in the data lifecycle. Sub-folders use `NN.MM_NAME` to show parent–child relationships.

```
exomaps/
│
├── 00_PLAN/                        # Project scope, roadmap, architecture
│   ├── 00_HIGH_LEVEL_SCOPE.MD
│   ├── 01_ARCHITECTURE.MD          ◄── this file
│   ├── 02_ARCHITECTURE.MD          (legacy — superseded)
│   ├── 03_DATA_PIPELINE.MD
│   ├── 04_ASTROPHYSICAL_MODELING.MD
│   ├── 05_SIMULATION_ENGINE.MD
│   ├── 06_VISUALIZATION_WEB.MD
│   └── …
│
├── 01_DATA/                        # Immutable source data
│   ├── EXOPLANETS_01.csv           6 713 exoplanet rows (NASA archive)
│   ├── SIMBAD_01.csv               1 582 stellar objects
│   ├── SIMBAD_02.csv
│   └── SIMBAD_03.csv
│
├── 02_PIPELINE/                    # Offline batch processing (Python)
│   ├── 02.01_INGEST/               Phase 01: CSV → staging tables
│   │   ├── process_rest_csv.py     Ingest + validate + quarantine
│   │   ├── reference_checks.py     Sanity vs known stellar distances
│   │   ├── simbad.py               SIMBAD TAP connector
│   │   ├── connector_contracts.json
│   │   └── reference_rules.json
│   ├── 02.02_TRANSFORM/            Phase 02: RA/Dec → ICRS XYZ
│   │   └── coordinate_transforms.py
│   ├── 02.03_INFERENCE/            Phase 03: System completion
│   │   └── inference_engine.py     Titius-Bode planet + belt inference
│   ├── 02.04_SIMULATION/           Phase 04: SFTL civilization sim
│   │   ├── simulation_core.py      Tick-based engine (pop, trade, politics)
│   │   └── economy_politics.py     Economic + political layers
│   ├── 02.05_SHARED/               Cross-phase utilities
│   │   ├── database.py             DB bootstrap, schema creation
│   │   ├── config_manager.py       Unified env/config resolver
│   │   ├── service_discovery.py    Auto-detect Postgres/Redis/Flask
│   │   └── logging_setup.py        Structured JSON + console logging
│   └── requirements.txt
│
├── 03_DATABASE/                    # Schema definitions
│   ├── 03.01_DDL/                  Core CREATE TABLE statements
│   │   ├── create_schemas.sql
│   │   └── create_user.sql
│   └── 03.02_MIGRATIONS/           Versioned schema evolution
│       ├── 001_phase01_foundation.sql
│       ├── 002_reference_validation.sql
│       ├── 003_phase02_coordinate_engine_fixed.sql
│       └── 004_phase03_inference.sql
│
├── 04_SERVER/                      # Unified Flask application
│   ├── app.py                      Routes + API + SPA serving
│   ├── models.py                   SQLAlchemy ORM (future)
│   ├── 04.01_ROUTES/               (future: split route blueprints)
│   ├── 04.02_TEMPLATES/            Jinja2 templates (legacy + QA)
│   ├── 04.03_STATIC/               Bootstrap CSS + legacy JS
│   ├── requirements.txt
│   └── Dockerfile
│
├── 05_CLIENT/                      # React / TypeScript / Three.js SPA
│   ├── package.json
│   ├── tsconfig.json
│   ├── public/                     HTML entry, favicon
│   └── src/
│       ├── App.tsx                  Router: / (StarMap), /admin, /sim, /qa
│       ├── components/
│       │   ├── StarMap.tsx          3-D React Three Fiber canvas
│       │   ├── StarField.tsx        GPU-instanced star rendering
│       │   └── TopNav.tsx           Navigation + persona selector
│       ├── pages/
│       │   ├── StarMapPage.tsx      Main landing — full-bleed 3-D map
│       │   ├── AdminPage.tsx        Pipeline health + run table
│       │   ├── SimulationPage.tsx   Sim control panel
│       │   └── DataQAPage.tsx       Confidence data explorer
│       ├── services/
│       │   └── api.ts              Axios client → /api/*
│       ├── types/
│       │   └── api.ts              TypeScript interfaces
│       └── shaders/
│           ├── star.vert           Per-star vertex shader
│           └── star.frag           Bloom + spectral glow fragment shader
│
├── 06_SCRIPTS/                     # Shell automation
│   ├── run_phase01_pipeline.sh
│   ├── run_phase02_pipeline.sh
│   ├── run_phase03_pipeline.sh
│   ├── health_check.sh
│   └── …
│
├── 07_INFRA/                       # Docker, CI, deployment
│   ├── docker-compose.yml
│   ├── Makefile
│   └── .env
│
├── 08_DOCS/                        # All written documentation
│   ├── 08.01_SETUP/
│   ├── 08.02_TROUBLESHOOTING/
│   └── 08.03_REPORTS/
│
├── 09_WIKI/                        # Screenshots, diagrams
│
├── .gitignore
└── README.md
```

---

## Data Model (PostgreSQL 17)

Three schemas partition concerns:

### `stg_data` — Staging & Pipeline Metadata
| Table | Purpose |
|-------|---------|
| `ingest_runs` | Pipeline execution log (UUID, status, timestamps) |
| `source_manifest` | Per-file provenance (checksum, adapter, row count) |
| `validation_summary` | Per-source quality gate results |
| `validation_quarantine` | Rejected rows + error codes |
| `connector_contracts` | Data contracts per source |
| `pipeline_gate_config` | Quality thresholds |
| `reference_validation_rules` | Known stellar distances for sanity |
| `reference_validation_results` | Rule check pass/fail |
| `phase02_transform_rules` | Coord transform parameters |
| `phase02_validation_results` | Sanity check on XYZ |
| `phase02_manifest` | Phase 02 run summary |
| `phase03_inference_results` | Inference run summary |
| `world_builds` | Cross-phase build manifest |
| `schema_migrations` | DDL version tracker |

### `dm_galaxy` — Domain Model (Astrophysical)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `stars` | Canonical star catalog | `main_id`, `ra_deg`, `dec_deg`, `distance_ly`, `x_ly`, `y_ly`, `z_ly`, `confidence_tier` |
| `stars_xyz` | ICRS Cartesian coords | `x_pc`, `y_pc`, `z_pc`, `distance_pc`, `distance_ly`, `sanity_pass` |
| `planets` | Known exoplanets | orbital + physical params |
| `belts` | Known belts | type, radii |
| `nearby_stars` | ≤100 LY fast-query | materialized subset |
| `edge_stars` | 100–110 LY context | visual boundary |
| `inferred_planets` | AI-generated planets | spectral type, Titius-Bode spacing |
| `inferred_belts` | AI-generated belts | radii, confidence |
| `system_attributes` | Aggregate system composition | star count, planet count, belt count |

### `app_simulation` — Game State
| Table | Purpose |
|-------|---------|
| `system_state` | Per-system sim state (population, economy, polity, epoch) |

---

## Pipeline Phases

```
Phase 01: INGEST
  CSV files ──► stg_data.ingest_runs + source_manifest + validation_summary
  Reference checks against known stellar distances

Phase 02: TRANSFORM
  stg_data rows ──► dm_galaxy.stars_xyz (ICRS X/Y/Z parsecs)
  Parallax → distance, RA/Dec → Cartesian, uncertainty propagation

Phase 03: INFERENCE
  dm_galaxy.stars_xyz ──► dm_galaxy.inferred_planets + inferred_belts
  Spectral type heuristics, Titius-Bode orbital spacing, Kepler's 3rd law

Phase 04: SIMULATION
  dm_galaxy.* ──► app_simulation.system_state
  Deterministic tick loop: population → migration → trade → politics → events
```

---

## Unified Server Architecture

**Single process. Single port. No redundancy.**

Flask serves two roles from port 5000:
1. **API server** — JSON endpoints under `/api/*`
2. **SPA host** — serves the React production build at `/`

```python
# 04_SERVER/app.py (simplified)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')
```

During development, the React dev server runs on :3000 and proxies API requests to :5000. In production, `npm run build` outputs to `05_CLIENT/build/` which Flask serves directly.

---

## API Surface

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/health` | DB status, route count | Public |
| GET | `/api/persona` | Current persona + available list | Public |
| POST | `/api/persona` | Switch persona | Public |
| GET | `/api/world/systems` | Star systems ≤100 LY | All roles |
| GET | `/api/world/systems/xyz` | Systems + ICRS XYZ for 3-D | All roles |
| GET | `/api/world/systems/full` | **Full render payload** (XYZ + spectral + multiplicity + planets) | All roles |
| GET | `/api/world/confidence` | Confidence/uncertainty data | Curator+ |
| GET | `/api/runs/manifest` | Pipeline ingest history | Ops+ |
| GET | `/api/runs/validation/<id>` | Per-run validation | Ops+ |
| GET | `/api/simulation/<id>/snapshot` | Sim state at tick | Sim Owner+ |
| GET | `/api/simulation/<id>/events` | Sim event log | Sim Owner+ |
| POST | `/api/simulation/<id>/pause` | Pause sim | Sim Owner+ |
| POST | `/api/simulation/<id>/resume` | Resume sim | Sim Owner+ |
| POST | `/api/simulation/<id>/step` | Step N ticks | Sim Owner+ |

---

## Client Rendering Architecture

### Star Rendering Pipeline (WebGL2 + GLSL)

Stars are rendered using a **GPU-instanced point system** with custom shaders rather than individual mesh objects. This allows thousands of stars to render at 60 fps with per-star visual effects.

```
                     ┌──────────────────────┐
                     │  /api/world/systems/  │
                     │        full           │
                     └──────────┬────────────┘
                                │ JSON array
                     ┌──────────▼────────────┐
                     │  Build InstancedMesh  │
                     │  Float32 attributes:  │
                     │  • position (x,y,z)   │
                     │  • spectralClass      │
                     │  • luminosity         │
                     │  • multiplicity       │
                     │  • confidence         │
                     └──────────┬────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                  ▼
     ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
     │  star.vert   │ │  star.frag   │  │  orbit lines │
     │  Billboard   │ │  Spectral    │  │  for binary  │
     │  sizing by   │ │  color map   │  │  systems     │
     │  distance +  │ │  + bloom     │  │              │
     │  luminosity  │ │  + twinkle   │  │              │
     └──────────────┘ └──────────────┘  └──────────────┘
```

### Spectral Type → Color Mapping (Harvard Classification)

| Class | Temp (K) | Color | CSS Hex | Examples |
|-------|----------|-------|---------|----------|
| **O** | 30 000+ | Blue-violet | `#9bb0ff` | — |
| **B** | 10 000–30 000 | Blue-white | `#aabfff` | Rigel |
| **A** | 7 500–10 000 | White | `#cad7ff` | Sirius |
| **F** | 6 000–7 500 | Yellow-white | `#f8f7ff` | Procyon |
| **G** | 5 200–6 000 | Yellow | `#fff4ea` | **Sol** |
| **K** | 3 700–5 200 | Orange | `#ffd2a1` | Epsilon Eridani |
| **M** | 2 400–3 700 | Red-orange | `#ffcc6f` | Proxima Centauri |
| **L/T** | < 2 400 | Deep red/brown | `#ff6633` | Brown dwarfs |

### Binary / Multiple System Visualization

Systems with multiple stellar components are shown with:
- **Binary**: Two point sprites orbiting a shared barycenter (fast elliptical animation)
- **Trinary+**: Central primary + satellite indicators with count badge
- **Orbital traces**: Thin glowing ellipses showing companion orbits
- The SIMBAD `otypes` field flags (`**` = double/multiple, `SB*` = spectroscopic binary) — 491/1579 systems in our data are multi-star

### Shader Effects

1. **Spectral glow**: Radial gradient colored by Harvard class, gaussian falloff
2. **Coronas**: Bright core fading to spectral-colored halo
3. **Twinkle**: Per-star noise-driven brightness oscillation (seeded by star ID)
4. **Distance fog**: Stars beyond 80 LY fade toward deep blue
5. **Confidence dimming**: Inferred stars rendered at reduced opacity with dashed halos
6. **Sol beacon**: Unique pulsing golden marker at origin with lens flare

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Language (backend)** | Python | 3.13 |
| **Language (frontend)** | TypeScript | 5.9 |
| **Web framework** | Flask | 3.x |
| **ORM** | SQLAlchemy | 2.x |
| **Database** | PostgreSQL | 17 |
| **UI framework** | React | 19 |
| **3-D engine** | Three.js | 0.183 |
| **React-Three bridge** | @react-three/fiber | 9.5 |
| **3-D helpers** | @react-three/drei | 10.7 |
| **HTTP client** | Axios | 1.13 |
| **Routing** | React Router | 7.x |
| **Containerization** | Docker Compose | — |

---

## Design Principles

1. **Science-first, simulation-second** — Real observations take priority; inferred data is always tagged.
2. **Confidence-aware rendering** — Visual brightness, opacity, and halo style reflect data confidence tier.
3. **Deterministic reproducibility** — Pipeline runs and simulation seeds are logged for exact replay.
4. **Single-port deployment** — Flask serves both API and SPA; no proxy confusion.
5. **Numbered legibility** — Folder prefixes encode data lifecycle order.
6. **GPU-first rendering** — Star field uses instanced geometry + GLSL shaders, not per-star meshes.

---

## Data Volumes (Current)

| Source | Rows | Stars (≤100 LY) |
|--------|------|------------------|
| EXOPLANETS_01.csv | 6 713 | ~300 (after dedup + distance filter) |
| SIMBAD_01/02/03.csv | 4 750 | ~1 500 (≤50 pc) |
| **Combined (deduped)** | — | **~1 500 unique stellar systems** |
| Binary/multiple indicators | — | **491 systems (31%)** |
| Spectral types available | — | G: 596, K: 449, M: 251, F: 204, A: 37, B: 16 |
