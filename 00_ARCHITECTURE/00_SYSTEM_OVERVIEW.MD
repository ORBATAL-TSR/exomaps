# 00 — System Overview

## What ExoMaps Is

A living simulation platform built on real astronomical data. It assembles observed
stars and exoplanets within 100 light-years into a 3-D model, fills gaps with
physically-motivated inference, and runs a slower-than-light interstellar
civilization simulation on top.

Two realities, layered:

1. **Scientific reality** — real stars, confirmed + candidate exoplanets.
2. **Simulated reality** — inferred planets, colonies, trade routes, politics.

---

## Architecture At A Glance

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                      02_CLIENTS                             │
                    │                                                             │
                    │   ┌──────────┐   ┌──────────┐   ┌──────────┐              │
                    │   │  01_WEB  │   │02_DESKTOP│   │03_MOBILE │              │
                    │   │React/TS  │   │ Electron │   │React Nat.│              │
                    │   │Three.js  │   │ (planned)│   │(planned) │              │
                    │   │ WebGL2   │   │          │   │          │              │
                    │   └────┬─────┘   └────┬─────┘   └────┬─────┘              │
                    │        │              │              │                     │
                    │        └──────────┬───┴──────────────┘                     │
                    │               SHARED SDK                                   │
                    │           types · api client                               │
                    └───────────────┬─────────────────────────────────────────────┘
                                    │  HTTPS / WSS
                    ┌───────────────▼─────────────────────────────────────────────┐
                    │                  01_SERVICES                                │
                    │                                                             │
                    │   ┌────────────────┐     ┌────────────────┐                │
                    │   │  01_GATEWAY     │────▶│ 04_MESSAGING   │                │
                    │   │  Flask API      │     │ WebSocket relay│                │
                    │   │  SPA host       │     │ SQS bridge     │                │
                    │   │  Auth / RBAC    │     │ Event bus      │                │
                    │   └──────┬─────────┘     └───────┬────────┘                │
                    │          │                        │                         │
                    │          ▼                        ▼                         │
                    │   ┌──────────────┐     ┌────────────────┐                  │
                    │   │02_PIPELINE   │     │03_WORLD_ENGINE │                  │
                    │   │ Ingest       │     │ Simulation     │                  │
                    │   │ Transform    │     │ Economy/Poli   │                  │
                    │   │ Inference    │     │ Tick processor  │                  │
                    │   └──────┬───────┘     └───────┬────────┘                  │
                    └──────────┼─────────────────────┼───────────────────────────┘
                               │                     │
                    ┌──────────▼─────────────────────▼───────────────────────────┐
                    │                     03_DATA                                │
                    │                                                             │
                    │   ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐  │
                    │   │01_SOURCES│  │02_SCHEMAS│  │03_MIGRAT. │  │04_SEEDS │  │
                    │   │ CSV raw  │  │ DDL      │  │ Versioned │  │ Test    │  │
                    │   │ feeds    │  │ create_* │  │ ALTER/ADD │  │ fixture │  │
                    │   └──────────┘  └──────────┘  └───────────┘  └─────────┘  │
                    │                                                             │
                    │              PostgreSQL 17 (3 schemas)                      │
                    │         stg_data · dm_galaxy · app_simulation               │
                    └─────────────────────────────────────────────────────────────┘
```

---

## Directory Map

```
exomaps/
├── 00_ARCHITECTURE/          System + per-component architecture docs
├── 01_SERVICES/              Backend microservices
│   ├── 01_GATEWAY/           API gateway + SPA host (Flask)
│   ├── 02_PIPELINE/          Data pipeline (ingest → transform → inference)
│   │   ├── 01_INGEST/        CSV → staging tables
│   │   ├── 02_TRANSFORM/     RA/Dec → Cartesian XYZ
│   │   ├── 03_INFERENCE/     Titius-Bode system completion
│   │   ├── 04_SIMULATION/    SFTL civilization engine
│   │   └── SHARED/           Cross-service: DB, config, logging
│   ├── 03_WORLD_ENGINE/      (planned) Dedicated simulation service
│   └── 04_MESSAGING/         (planned) WebSocket relay, SQS, event bus
├── 02_CLIENTS/               Frontend applications
│   ├── 01_WEB/               React / TypeScript / Three.js SPA
│   ├── 02_DESKTOP/           (planned) Electron or Tauri
│   ├── 03_MOBILE/            (planned) React Native
│   └── SHARED/               Cross-client types, API SDK, assets
├── 03_DATA/                  All data concerns
│   ├── 01_SOURCES/           Raw CSV files (SIMBAD, NASA Exoplanet Archive)
│   ├── 02_SCHEMAS/           DDL: CREATE TABLE / CREATE SCHEMA
│   ├── 03_MIGRATIONS/        Versioned migration scripts
│   └── 04_SEEDS/             Test fixtures and seed data
├── 04_INFRA/                 Infrastructure & DevOps
│   ├── 01_DOCKER/            docker-compose, Dockerfiles
│   ├── 02_CI_CD/             GitHub Actions (planned)
│   ├── 03_SCRIPTS/           Shell automation (pipeline runners, health)
│   └── 04_TERRAFORM/         (planned) Cloud IaC
├── 05_DOCS/                  Written documentation
│   ├── 01_SETUP/             Getting started guides
│   ├── 02_TROUBLESHOOTING/   Known issues, fixes
│   ├── 03_REPORTS/           Pipeline & analysis reports
│   └── 04_WIKI/              Screenshots, diagrams
├── .gitignore
└── README.md
```

---

## Design Principles

| # | Principle | Implication |
|---|-----------|-------------|
| 1 | **Science-first inputs** | Real observations take priority; inferred data always tagged |
| 2 | **Confidence everywhere** | Every entity carries observed / inferred / simulated provenance |
| 3 | **Service boundaries** | Each `01_SERVICES/*` folder is a self-contained deployable unit |
| 4 | **Shared-nothing comms** | Services communicate via REST or message queues — no shared memory |
| 5 | **Client-agnostic API** | Same API surface serves web, desktop, and mobile clients |
| 6 | **Deterministic replay** | Pipeline runs + sim seeds are logged for exact reproduction |
| 7 | **Numbered legibility** | Folder prefixes encode lifecycle order and architectural role |

---

## Data Flow

```
   CSV sources (SIMBAD, NASA)
          │
    ┌─────▼─────┐
    │  INGEST    │  Parse, validate, quarantine → stg_data.*
    └─────┬─────┘
          │
    ┌─────▼──────┐
    │ TRANSFORM   │  Parallax → distance, RA/Dec → XYZ → dm_galaxy.stars_xyz
    └─────┬──────┘
          │
    ┌─────▼──────┐
    │ INFERENCE   │  Titius-Bode → inferred_planets, belts → dm_galaxy.*
    └─────┬──────┘
          │
    ┌─────▼──────────┐
    │ SIMULATION      │  Population, economy, politics → app_simulation.*
    └─────┬──────────┘
          │
    ┌─────▼──────┐
    │  GATEWAY   │  /api/* JSON responses → any client
    └────────────┘
```

---

## Technology Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Backend language | Python | 3.13 | All services |
| Web framework | Flask | 3.x | Gateway + SPA host |
| ORM | SQLAlchemy | 2.x | Direct engine + raw SQL |
| Database | PostgreSQL | 17 | 3 schemas, local peer auth |
| Frontend language | TypeScript | 5.9 | All clients |
| UI framework | React | 19 | Web SPA |
| 3-D engine | Three.js | 0.183 | WebGL2 + custom GLSL |
| React-Three | @react-three/fiber | 9.5 | Declarative 3-D |
| HTTP client | Axios | 1.13 | API calls |
| Routing | React Router | 7.x | Client-side SPA routing |
| Realtime (planned) | Socket.IO / SQS | — | WebSocket + message queue |
| Containerization | Docker Compose | — | Dev + eventual prod |
| IaC (planned) | Terraform | — | AWS / cloud deployment |
