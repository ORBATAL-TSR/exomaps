# ExoMaps — Nearby Stellar System Simulator

> Interactive 3-D star map and economy simulator for all stellar systems within 15 parsecs.

![Star Map](https://raw.githubusercontent.com/iontom/exomaps/master/wiki/STARMAP.png)

---

## Project Goals

1. **Stellar Cartography** — Render every known system within 15 pc in a WebGL star map.  Browse planetary systems, binary configurations, and confidence data.  Use Titius-Bode predictions to fill gaps between confirmed exoplanets.
2. **Trans-Stellar Economy** — Model slower-than-light infrastructure, polities, and trade networks.  A hard-sci-fi space-opera generator backed by real astronomical data.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | React 19 · TypeScript · React Three Fiber · Three.js |
| **Backend**  | Python · Flask · flask-cors |
| **Database** | PostgreSQL 17 (schemas: `stg_data`, `dm_galaxy`, `app_simulation`) |
| **Infra**    | Docker Compose (optional), local dev supported |

---

## Repository Layout

```
exomaps/
├── frontend/          # React / TypeScript SPA (star map, admin, sim)
│   ├── src/
│   │   ├── components/   # StarMap, TopNav
│   │   ├── pages/        # StarMapPage, AdminPage, SimulationPage, DataQAPage
│   │   ├── services/     # Axios API client
│   │   └── types/        # TypeScript interfaces
│   └── package.json
├── src/               # Flask backend
│   └── app/
│       ├── app.py        # Routes & API endpoints
│       ├── models.py     # SQLAlchemy models
│       └── py/           # Controllers
├── dbs/               # Database layer
│   ├── ddl/              # Schema DDL & migrations
│   └── fetch_db/         # ETL connectors (JPL, SIMBAD)
├── data/              # Source CSV files
├── config/            # Environment files (.env.auto, .env.local)
├── scripts/           # Utility & pipeline scripts
├── docs/              # All documentation
│   ├── setup/            # Installation & config guides
│   ├── troubleshooting/  # Debug notes
│   └── reports/          # Phase reports & manifests
├── 00_plan/           # Project planning docs
├── wiki/              # Wiki assets
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## Quick Start (Local Development)

### Prerequisites
- Python 3.10+, Node 20+, PostgreSQL 17

### 1) Database

```bash
# Ensure PostgreSQL is running; create the database if needed
createdb exomaps

# Apply schemas
psql -d exomaps -f dbs/ddl/create_schemas.sql
```

### 2) Flask API (port 5000)

```bash
export POSTGRES_USER=$USER POSTGRES_HOST=localhost POSTGRES_DB=exomaps

pip install -r src/requirements.txt
pip install flask-cors          # required for React dev proxy

python3 src/app/app.py
```

### 3) React Frontend (port 3000)

```bash
cd frontend
npm install
npm start                       # proxies /api/* → localhost:5000
```

Open **http://localhost:3000** — the 3-D star map loads as the landing page.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/persona` | Current persona & role |
| POST | `/api/persona` | Switch persona |
| GET | `/api/world/systems` | Star systems (paginated) |
| GET | `/api/world/systems/xyz` | Systems with 3-D coordinates |
| GET | `/api/world/confidence` | Confidence & uncertainty data |
| GET | `/api/runs/manifest` | Pipeline ingest runs |
| GET | `/api/runs/validation/<id>` | Validation results for a run |
| GET | `/api/simulation/<id>/snapshot` | Simulation state snapshot |
| GET | `/api/simulation/<id>/events` | Simulation event log |
| POST | `/api/simulation/<id>/pause` | Pause simulation |
| POST | `/api/simulation/<id>/resume` | Resume simulation |
| POST | `/api/simulation/<id>/step` | Advance simulation N ticks |
| GET | `/api/health` | DB status & route count |

---

## Docker (optional)

```bash
docker-compose up --build
```

---

## License

MIT
