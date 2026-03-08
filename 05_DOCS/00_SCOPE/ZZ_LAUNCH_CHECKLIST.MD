# ZZ — Launch Checklist

## Overview

Step-by-step checklist for launching ExoMaps from a fresh environment. Covers database setup, pipeline execution, service startup, and verification.

---

## Prerequisites

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| PostgreSQL | 14+ | `psql --version` |
| Python | 3.9–3.11 | `python3 --version` |
| Node.js | 18+ | `node --version` |
| Docker + Compose | 20+ / 2.x | `docker --version && docker compose version` |
| Make | any | `make --version` |

---

## 1. Environment Variables

### Database (Pipeline)

```bash
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=<your_postgres_password>
export POSTGRES_DB=exomaps
export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT=5432
export APPUSER=appuser
export APPPASS=<your_app_password>
```

### Database (Web App / Gateway)

```bash
export DBUSER=appuser
export DBPASS=<your_app_password>
export DBNAME=exomaps
export DBHOST=127.0.0.1
export DBPORT=5432
export PORT=5000
```

### Optional

```bash
export FLASK_ENV=development
export FLASK_DEBUG=1
export SECRET_KEY=<random_secret_key>
export REDIS_URL=redis://127.0.0.1:6379/0   # if using Redis
```

---

## 2. Database Setup

### Option A: Docker (Recommended)

```bash
cd 04_INFRA/01_DOCKER
docker compose up -d postgres
```

### Option B: Local PostgreSQL

```bash
# Create database and user
psql -U postgres -f 03_DATA/02_SCHEMAS/create_user.sql
psql -U postgres -f 03_DATA/02_SCHEMAS/create_schemas.sql
```

### Apply Migrations

```bash
# Apply all migrations in order
for f in 03_DATA/03_MIGRATIONS/001_*.sql \
         03_DATA/03_MIGRATIONS/002_*.sql \
         03_DATA/03_MIGRATIONS/003_phase02_coordinate_engine_fixed.sql \
         03_DATA/03_MIGRATIONS/004_*.sql \
         03_DATA/03_MIGRATIONS/005_*.sql; do
    echo "Applying: $f"
    psql -U postgres -d exomaps -f "$f"
done
```

### Verify

```bash
psql -U appuser -d exomaps -c "\dt dm_galaxy.*"
psql -U appuser -d exomaps -c "\dt app_simulation.*"
```

**Expected:** Tables in `dm_galaxy`, `stg_pipeline`, `app_simulation` schemas.

---

## 3. Install Dependencies

### Python (Pipeline + Gateway)

```bash
cd 01_SERVICES/02_PIPELINE && pip install -r requirements.txt
cd 01_SERVICES/01_GATEWAY && pip install -r requirements.txt
```

### Node (Web Client)

```bash
cd 02_CLIENTS/01_WEB && npm install
cd 02_CLIENTS/SHARED && npm install
```

### Or via Makefile

```bash
make install          # Install from requirements.txt
# or
make install-locked   # Install from lock files (exact versions)
```

---

## 4. Run Data Pipeline

### Phase 01: Ingest + Validate

```bash
bash 04_INFRA/03_SCRIPTS/run_phase01_pipeline.sh
```

**Expected output:** `run_id=<uuid>` at the end. Check QA report at pipeline logs.

### Phase 02: Coordinate Transforms

```bash
bash 04_INFRA/03_SCRIPTS/run_phase02_pipeline.sh
```

**Expected:** Stars with X/Y/Z coordinates in `dm_galaxy.stars_xyz`.

### Phase 03: Inference

```bash
bash 04_INFRA/03_SCRIPTS/run_phase03_pipeline.sh
```

**Expected:** Inferred planets and belts in `dm_galaxy.inferred_planets`, `dm_galaxy.inferred_belts`.

### Full Pipeline (All Phases)

```bash
bash 04_INFRA/03_SCRIPTS/run_phase.sh all
# or
make run-phase01 && make run-phase02 && make run-phase03
```

---

## 5. Start Services

### Gateway (Flask API)

```bash
cd 01_SERVICES/01_GATEWAY
python app.py
```

**Default:** `http://127.0.0.1:5000/`

### Web Client (React Dev Server)

```bash
cd 02_CLIENTS/01_WEB
npm start
```

**Default:** `http://127.0.0.1:3000/`

### Docker Compose (All Services)

```bash
cd 04_INFRA/01_DOCKER
docker compose up -d
```

### Or via Makefile

```bash
make docker-up     # Start all services
make docker-down   # Stop all services
```

---

## 6. Verification Checklist

### Pipeline

| Check | Command / URL | Expected |
|-------|---------------|----------|
| Pipeline ran successfully | Check logs for `run_id` | UUID printed |
| Stars loaded | `psql -c "SELECT count(*) FROM dm_galaxy.star_systems"` | > 0 |
| Coordinates computed | `psql -c "SELECT count(*) FROM dm_galaxy.stars_xyz"` | > 0 |
| Inferences generated | `psql -c "SELECT count(*) FROM dm_galaxy.inferred_planets"` | > 0 |

### Gateway API

| Check | URL | Expected |
|-------|-----|----------|
| App alive | `http://127.0.0.1:5000/` | Home page renders |
| Systems API | `http://127.0.0.1:5000/api/world/systems` | JSON array of systems |
| Campaigns API | `http://127.0.0.1:5000/api/campaigns` | JSON (stub or real data) |
| QA page | `http://127.0.0.1:5000/phase01/qa` | Validation summary |
| QA JSON | `http://127.0.0.1:5000/phase01/qa.json` | JSON validation data |

### Web Client

| Check | URL | Expected |
|-------|-----|----------|
| App loads | `http://127.0.0.1:3000/` | React app renders |
| Star map | Navigate to map view | 3D scene with star markers |
| System detail | Click a star marker | Detail panel opens |
| Simulation | Navigate to simulation | Control dashboard |

### Health (When Implemented)

| Check | URL | Expected |
|-------|-----|----------|
| Gateway health | `http://127.0.0.1:5000/health` | `{"status": "ok"}` |
| World Engine health | `http://127.0.0.1:5001/health` | `{"status": "ok"}` |
| DB connectivity | Health endpoint DB check | `"database": "connected"` |

---

## 7. QA Flow (Interactive)

1. Open `http://127.0.0.1:5000/phase01/qa`
2. Leave Run ID empty to inspect latest run
3. Paste a specific run ID to compare runs
4. Check:
   - Validation summary by source
   - Source manifest status per file
   - Quarantine error distribution
   - Reference validation results (known-star distance checks)

---

## 8. Reference Validation Rules

Located in: `dbs/fetch_db/reference_rules.json` (legacy) / validation config

| Star | Expected Distance | Tolerance |
|------|-------------------|-----------|
| Alpha Centauri | 4.37 LY | ± 0.05 LY |
| Barnard's Star | 5.96 LY | ± 0.05 LY |
| Sirius | 8.60 LY | ± 0.10 LY |
| Procyon | 11.46 LY | ± 0.15 LY |
| Tau Ceti | 11.89 LY | ± 0.15 LY |
| Epsilon Eridani | 10.50 LY | ± 0.15 LY |

Extend these rules as more reference stars are validated.

---

## 9. Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `psql: connection refused` | PostgreSQL not running | `docker compose up -d postgres` or `sudo systemctl start postgresql` |
| `FATAL: role "appuser" does not exist` | User not created | Run `create_user.sql` |
| `relation "dm_galaxy.star_systems" does not exist` | Migrations not applied | Run migration scripts in order |
| Pipeline fails with `ImportError` | Missing dependencies | `pip install -r requirements.txt` |
| Web client blank page | API not running | Start gateway first; check CORS |
| Star map empty | No data in DB | Run pipeline phases 01–03 |
| `Port 5000 already in use` | Another process on port | `lsof -i :5000` and kill, or change `PORT` env var |
| Docker build fails | Stale cache | `docker compose build --no-cache` |

---

## 10. Development Shortcuts (Makefile)

| Command | Purpose |
|---------|---------|
| `make install` | Install all Python + Node dependencies |
| `make install-locked` | Install from lock files (exact versions) |
| `make lint` | Run flake8 linting |
| `make format` | Run black + isort formatting |
| `make type-check` | Run mypy type checking |
| `make test` | Run pytest suite |
| `make test-phase04` | Run simulation-specific tests |
| `make full-test` | Complete CI pipeline locally (lint + format + type + test + Docker) |
| `make docker-build` | Build Docker images |
| `make docker-up` | Start all services |
| `make docker-down` | Stop all services |
| `make clean` | Remove `__pycache__`, `.pytest_cache`, `.mypy_cache` |
| `make run-phase01` | Run Phase 01 pipeline |
| `make run-phase02` | Run Phase 02 pipeline |
| `make run-phase03` | Run Phase 03 pipeline |
| `make run-phase04` | Run Phase 04 simulation test |
