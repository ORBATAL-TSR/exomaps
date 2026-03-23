# Backend — Gateway & Pipeline

---

## Gateway (01_SERVICES/01_GATEWAY/app.py)

Flask app. Serves API + SPA static files. Single entry point for all client communication.

### API Endpoints

| Method | Endpoint | Description | Min Role |
|--------|----------|-------------|----------|
| GET | `/api/health` | DB status, route count | public |
| GET | `/api/persona` | Current persona + list | public |
| POST | `/api/persona` | Switch active persona | public |
| GET | `/api/world/systems` | Star systems ≤100 LY | general_user |
| GET | `/api/world/systems/xyz` | Systems + ICRS XYZ | general_user |
| GET | `/api/world/systems/full` | **Full render payload** (XYZ + spectral + multiplicity + planets) | general_user |
| GET | `/api/system/<id>` | Per-system detail | general_user |
| GET | `/api/world/confidence` | Uncertainty data | science_analyst |
| GET | `/api/runs/manifest` | Pipeline ingest history | ops_engineer |
| GET | `/api/runs/validation/<id>` | Per-run validation report | data_curator |
| GET | `/api/simulation/<id>/snapshot` | Sim state at tick | observer_guest |
| GET | `/api/simulation/<id>/events` | Event log | observer_guest |
| POST | `/api/simulation/<id>/pause` | Pause sim | sim_owner |
| POST | `/api/simulation/<id>/resume` | Resume sim | sim_owner |
| POST | `/api/simulation/<id>/step` | Step N ticks | sim_owner |
| GET | `/api/campaigns` | List campaigns | general_user |
| POST | `/api/campaigns` | Create campaign | sim_owner |
| POST | `/api/campaigns/<id>/sim/init` | Init campaign simulation | sim_owner |
| POST | `/api/campaigns/<id>/sim/tick` | Advance campaign simulation | sim_owner |
| GET | `/api/campaigns/<id>/sim/snapshot` | Campaign sim snapshot | observer_guest |
| GET | `/api/factions` | List factions | general_user |
| POST | `/api/factions` | Create faction | sim_owner |

### Personas (RBAC — 8 roles)

| Role | Capabilities |
|------|-------------|
| `admin` | Full control — data, simulation, ops, settings |
| `sim_owner` | Scenario config, run controls, balancing |
| `general_user` | Read-only exploration, systems, trends |
| `data_curator` | Source quality, quarantine review, provenance |
| `science_analyst` | Astrophysical assumptions, coordinate QA |
| `ops_engineer` | Job monitoring, infrastructure health |
| `narrative_designer` | Faction arcs, event framing, campaign presets |
| `observer_guest` | Minimal public-safe demo mode |

---

## Pipeline (01_SERVICES/02_PIPELINE/)

### Phase 01 — Ingest
CSV parsing → validation → quarantine
- Input: `03_DATA/01_SOURCES/EXOPLANETS_01.csv`, `SIMBAD_01/02/03.csv`
- BOM gotcha: `EXOPLANETS_01.csv` has `\ufeff` header — use `encoding='utf-8-sig'`
- Output tables: `stg_data.ingest_runs`, `source_manifest`, `validation_summary`, `validation_quarantine`

### Phase 02 — Transform
- Parallax → distance (pc). Distances in parsecs; 1 pc ≈ 3.26 LY; 100 LY ≈ 30.67 pc
- RA/Dec → ICRS Cartesian (X/Y/Z)
- Output: `dm_galaxy.stars_xyz`

### Phase 03 — Inference
- Spectral type heuristics
- Titius-Bode orbital spacing → `dm_galaxy.inferred_planets`
- Asteroid belt analog inference → `dm_galaxy.inferred_belts`
- Aggregate stats → `dm_galaxy.system_attributes`

### Phase 04 — Simulation
- Deterministic tick loop: population → migration → trade → politics → events
- Output: `app_simulation.system_state` per tick

---

## PostgreSQL 3-Schema Design

### stg_data (Staging / Pipeline Metadata)
`ingest_runs`, `source_manifest`, `validation_summary`, `validation_quarantine`,
`connector_contracts`, `pipeline_gate_config`, `reference_validation_rules`,
`reference_validation_results`, `phase02_transform_rules`, `phase02_validation_results`,
`phase02_manifest`, `phase03_inference_results`, `world_builds`, `schema_migrations`

### dm_galaxy (Astrophysical Domain Model)
| Table | Contents |
|-------|---------|
| `stars` | Canonical catalog — RA/Dec, distance, confidence tier |
| `stars_xyz` | ICRS Cartesian (X/Y/Z in parsecs), Teff, luminosity |
| `planets` | Known exoplanets — orbital + physical params |
| `belts` | Known asteroid/debris belts |
| `nearby_stars` | Materialized subset ≤100 LY |
| `edge_stars` | 100–110 LY context stars |
| `inferred_planets` | Titius-Bode-generated planets |
| `inferred_belts` | AI-generated belt analogs |
| `system_attributes` | Aggregate: star count, planet count, belt count |

### app_simulation (Game State)
`system_state` — per-system: population, economy, polity, epoch

---

## Source Data

| File | Rows | Source |
|------|------|--------|
| EXOPLANETS_01.csv | 6,713 | NASA Exoplanet Archive (confirmed + candidates) |
| SIMBAD_01/02/03.csv | ~4,750 | SIMBAD TAP query — cross-reference metadata |
| **Unique systems** | ~1,796 | Within 100 LY after dedup |

**Spectral distribution of catalog:**
G: 596 · K: 449 · M: 251 · F: 204 · A: 37 · B: 16

**Binary/multiple flags (SIMBAD):**
491/1,579 entries flagged — otypes: `**`, `SB*`, `EB*`

---

## Frontend API Layer

`02_CLIENT/VITA/src/services/api.ts` — native fetch, no Axios.

Key types exported: `IngestRun`, `HealthResponse`, `Campaign`, `Faction`,
`SimInitResponse`. Base function: `apiFetch<T>(path, options?)`.
