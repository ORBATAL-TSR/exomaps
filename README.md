# ExoMaps

### Real stars. Real data. Real simulation.

**An interactive 3-D star map of every known stellar system within 15 parsecs — built on actual astronomical catalogs, rendered in the browser, and designed to grow into a full interstellar civilization simulator.**

![Star Map](https://raw.githubusercontent.com/iontom/exomaps/master/wiki/STARMAP.png)

---

## What is ExoMaps?

ExoMaps puts you inside a scientifically-grounded model of the solar neighborhood. Every star you see is real, positioned from NASA/JPL Exoplanet Archive and SIMBAD cross-matched data, with spectral classification determining color, luminosity, and rendering.

**It's not a game — it's a living, queryable map of the neighborhood.**

Currently tracking **1,796 stellar systems** across 23 API endpoints, with a four-phase data pipeline that ingests, transforms, infers, and simulates.

### What can you do today?

- **Explore** — Fly through a 3-D WebGL star map rendered with custom GLSL shaders. Stars glow with physically-based spectral colors (O → M class).
- **Browse** — Click any system to see its catalog data, planetary companions, binary configuration, and confidence tiers.
- **Query** — Hit the REST API for paginated star systems, coordinate data, validation reports, and simulation snapshots.
- **Simulate** — Run the economy/politics simulation engine across the local stellar neighborhood (early alpha).

### Where is it going?

- **Titius-Bode inference** — Predict missing planets using orbital spacing laws calibrated by stellar metallicity.
- **Trans-Stellar Economy** — Model slower-than-light trade, infrastructure, polities, and interstellar vehicles. A hard-sci-fi space opera generator backed by real data.
- **Multiplayer** — WebSocket relay + event bus for shared simulation state.
- **Multi-platform** — Desktop (Electron/Tauri) and mobile (React Native) clients sharing a common SDK.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **3-D Client** | React 19 · TypeScript 5.9 · React Three Fiber · Three.js · Custom GLSL Shaders |
| **API Gateway** | Python 3 · Flask · SQLAlchemy |
| **Database** | PostgreSQL 17 — three schemas: `stg_data` · `dm_galaxy` · `app_simulation` |
| **Data Pipeline** | Four-phase ETL: Ingest → Transform → Inference → Simulation |
| **Infrastructure** | Docker Compose (optional) · Makefile · LAUNCH.sh one-command deploy |

---

## Quick Start

```bash
# 1. Clone & configure
git clone https://github.com/iontom/exomaps.git
cd exomaps
cp .env.example .env          # edit .env — set POSTGRES_PASSWORD

# 2. Launch everything (prunes old processes, builds client, starts server)
bash LAUNCH.sh

# Or skip the React rebuild if you already have a build:
bash LAUNCH.sh --skip-build
```

Open **http://localhost:5000** — the star map loads immediately.

### Prerequisites

- Python 3.10+
- Node 20+ & npm
- PostgreSQL 17 (local or Docker)

### Manual Setup (if you prefer step-by-step)

```bash
# Database
createdb exomaps
psql -d exomaps -f 03_DATA/02_SCHEMAS/create_schemas.sql

# Backend
pip install -r 01_SERVICES/01_GATEWAY/requirements.txt

# Frontend
cd 02_CLIENTS/01_WEB && npm install --legacy-peer-deps && npm run build && cd ../..

# Run
POSTGRES_USER=$USER POSTGRES_DB=exomaps python3 01_SERVICES/01_GATEWAY/app.py
```

---

## Project Structure

```
exomaps/
├── 00_ARCHITECTURE/       System & component architecture docs (00–10)
├── 01_SERVICES/
│   ├── 01_GATEWAY/        Flask API + SPA host (port 5000)
│   ├── 02_PIPELINE/       Four-phase data pipeline
│   │   ├── 01_INGEST/     NASA/JPL + SIMBAD connectors
│   │   ├── 02_TRANSFORM/  Coordinate transforms, cross-matching
│   │   ├── 03_INFERENCE/  Titius-Bode, spectral inference
│   │   ├── 04_SIMULATION/ Economy, politics, population models
│   │   └── SHARED/        Database, config, service discovery
│   ├── 03_WORLD_ENGINE/   (planned) Dedicated simulation service
│   └── 04_MESSAGING/      (planned) WebSocket relay + event bus
├── 02_CLIENTS/
│   ├── 01_WEB/            React / TypeScript / Three.js SPA
│   ├── 02_DESKTOP/        (planned) Electron or Tauri
│   ├── 03_MOBILE/         (planned) React Native
│   └── SHARED/            (planned) Cross-client SDK & types
├── 03_DATA/
│   ├── 01_SOURCES/        NASA Exoplanet Archive + SIMBAD CSVs
│   ├── 02_SCHEMAS/        PostgreSQL DDL
│   ├── 03_MIGRATIONS/     Versioned SQL migrations
│   └── 04_SEEDS/          (planned) Test fixtures
├── 04_INFRA/
│   ├── 01_DOCKER/         docker-compose.yml
│   ├── 03_SCRIPTS/        Pipeline runners, health checks, setup
│   └── Makefile
├── 05_DOCS/
│   ├── 00_SCOPE/          Vision, requirements, roadmaps
│   ├── 01_SETUP/          Installation guides
│   └── 02_TROUBLESHOOTING/
├── .env.example           Credential template (no secrets committed)
├── LAUNCH.sh              One-command deploy
└── README.md
```

---

## API Highlights

| Method | Path | What it returns |
|--------|------|-----------------|
| `GET` | `/api/health` | DB status, route count |
| `GET` | `/api/world/systems/full` | All 1,796 systems with XYZ coordinates |
| `GET` | `/api/world/systems/xyz` | Lightweight coordinate-only payload |
| `GET` | `/api/world/confidence` | Confidence & uncertainty metadata |
| `GET` | `/api/persona` | Current user persona |
| `GET` | `/api/simulation/{id}/snapshot` | Simulation state at a point in time |
| `POST` | `/api/simulation/{id}/step` | Advance the simulation N ticks |

Full endpoint list: 23 routes — hit `/api/health` to see the count live.

---

## Security

- **Zero credentials in source** — all secrets loaded from `.env` (gitignored).
- **`.env.example`** committed as a template with empty password fields.
- **Flask secret key** auto-generated at startup via `secrets.token_hex(32)`.
- **No private IPs, SSH keys, or API tokens** anywhere in the repository.

---

## Contributing

This project is in active development. Check [00_ARCHITECTURE/](00_ARCHITECTURE/) for system design and [05_DOCS/00_SCOPE/](05_DOCS/00_SCOPE/) for the product roadmap.

---

## License

MIT
