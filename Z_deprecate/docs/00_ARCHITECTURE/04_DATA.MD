# 02 — Data Architecture

## Overview

All data concerns live under `03_DATA/`. This consolidates what were previously
three separate folders (raw files, schema DDL, and migrations) into a single
coherent layer.

```
03_DATA/
├── 01_SOURCES/       Raw CSV files — immutable inputs
├── 02_SCHEMAS/       DDL: CREATE SCHEMA, CREATE TABLE, CREATE USER
├── 03_MIGRATIONS/    Versioned ALTER/ADD scripts (001, 002, …)
└── 04_SEEDS/         Test fixtures and development seed data
```

---

## Database: PostgreSQL 17

**Connection:** Local Unix socket, peer authentication, user `tsr`, database `exomaps`.

Three schemas partition concerns:

```
                     ┌──────────────────────────┐
                     │       exomaps (DB)        │
                     │                           │
                     │  ┌────────────────────┐   │
                     │  │     stg_data       │   │  Pipeline metadata
                     │  │  14 tables         │   │  Ingest runs, manifests,
                     │  │                    │   │  validation, quarantine
                     │  └────────────────────┘   │
                     │                           │
                     │  ┌────────────────────┐   │
                     │  │    dm_galaxy       │   │  Domain model
                     │  │  9 tables          │   │  Stars, planets, belts,
                     │  │                    │   │  XYZ coords, inferred objs
                     │  └────────────────────┘   │
                     │                           │
                     │  ┌────────────────────┐   │
                     │  │  app_simulation    │   │  Game state
                     │  │  1 table           │   │  System state per tick
                     │  └────────────────────┘   │
                     └──────────────────────────┘
```

### stg_data — Staging & Pipeline Metadata

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
| `phase02_transform_rules` | Coordinate transform parameters |
| `phase02_validation_results` | Sanity check on XYZ output |
| `phase02_manifest` | Phase 02 run summary |
| `phase03_inference_results` | Inference run outcomes |
| `world_builds` | Cross-phase build manifest |
| `schema_migrations` | DDL version tracker |

### dm_galaxy — Domain Model (Astrophysical)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `stars` | main_id, ra_deg, dec_deg, distance_ly, spectral_type, confidence_tier | Canonical star catalog |
| `stars_xyz` | x_pc, y_pc, z_pc, distance_ly, spectral_type, teff, luminosity | ICRS Cartesian for 3-D rendering |
| `planets` | star_id, orbital params, physical params | Known exoplanets |
| `belts` | star_id, type, inner/outer radius | Known asteroid/debris belts |
| `nearby_stars` | (materialized subset ≤ 100 LY) | Fast query for map |
| `edge_stars` | (100–110 LY) | Visual boundary context |
| `inferred_planets` | star_id, spectral basis, Titius-Bode spacing | AI-generated planets |
| `inferred_belts` | star_id, radii, confidence | AI-generated belts |
| `system_attributes` | star_count, planet_count, belt_count | Aggregate composition |

### app_simulation — Game State

| Table | Purpose |
|-------|---------|
| `system_state` | Per-system sim state (population, economy, polity, epoch) |

---

## Source Data

| File | Rows | Contents | Encoding |
|------|------|----------|----------|
| `EXOPLANETS_01.csv` | 6,713 | NASA Exoplanet Archive (98 columns) | UTF-8 with BOM (`utf-8-sig`) |
| `EXOPLANETS_01x.csv` | — | Extended/alternate exoplanet set | — |
| `SIMBAD_01.csv` | ~1,582 | Stellar objects (TAP query) | UTF-8 |
| `SIMBAD_02.csv` | ~1,600 | Additional stellar objects | UTF-8 |
| `SIMBAD_03.csv` | ~1,600 | Additional stellar objects | UTF-8 |

**Combined deduplicated output:** ~1,796 unique stellar systems within 100 LY.

### Key Data Characteristics

- **Distances in parsecs** — 1 pc ≈ 3.26 LY; 100 LY ≈ 30.67 pc
- **491 / 1,579 SIMBAD entries** flagged as binary/multiple (otypes: `**`, `SB*`, `EB*`)
- **Spectral type distribution:** G: 596, K: 449, M: 251, F: 204, A: 37, B: 16
- **BOM character** `\ufeff` in EXOPLANETS header — requires `encoding='utf-8-sig'`

---

## Migration Strategy

Migrations are numbered sequentially and tracked in `stg_data.schema_migrations`:

```
001_phase01_foundation.sql          Base tables: ingest_runs, source_manifest, etc.
002_reference_validation.sql        Reference check rules + results tables
003_phase02_coordinate_engine.sql   stars_xyz, transform rules, phase02 manifest
004_phase03_inference.sql           Inferred planets/belts, system_attributes
```

**Convention:** Each migration is idempotent (`IF NOT EXISTS`) and tagged with a
version + description in the migrations table.

---

## Data Access Patterns

| Consumer | Schema | Access | Frequency |
|----------|--------|--------|-----------|
| Pipeline ingest | stg_data | Write | On demand (batch) |
| Pipeline transform | stg_data → dm_galaxy | Read/Write | On demand |
| Pipeline inference | dm_galaxy | Read/Write | On demand |
| Simulation engine | dm_galaxy → app_simulation | Read/Write | Tick loop |
| Gateway API | dm_galaxy, stg_data | Read-only | Per request |
| Gateway CSV fallback | 01_SOURCES/*.csv | Read-only | When DB empty |

---

## Future: Event Sourcing & Streaming

When SQS / Redis Streams are added:

```
Pipeline completion → SNS topic "data.refreshed"
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    Gateway cache   WebSocket     Desktop app
    invalidation    broadcast      auto-refresh
```

All simulation mutations will be stored as append-only events, enabling:
- Full timeline replay
- Scenario branching (fork at tick N)
- Multi-player divergent timelines
