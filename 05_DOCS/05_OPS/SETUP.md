# Setup & Development

---

## Quick Start

```bash
# 1. Clone and install root deps
cd /home/tsr/Projects/exomaps
npm install

# 2. Install VITA client deps
cd 02_CLIENT/VITA && npm install && cd ../..

# 3. Start (builds VITA + Flask + vite preview on :1420)
bash LAUNCH.sh

# Skip rebuild if dist/ exists
bash LAUNCH.sh --skip-build
```

Health check: `http://localhost:5000/api/health`
Client: `http://localhost:1420`

---

## Database Setup

### Option A: Local PostgreSQL
```bash
sudo -u postgres createuser --superuser postgres 2>/dev/null || true
sudo -u postgres createdb exomaps
# Set env vars (see below) then run migrations
python3 01_SERVICES/01_GATEWAY/app.py
```

### Option B: Docker (Recommended)
```bash
cd 04_INFRA
docker-compose up -d db redis
# DB available on port 5433 (mapped to avoid conflict with local PG)
```

---

## Environment Variables

Create `.env` in project root OR `04_INFRA/.env` — LAUNCH.sh tries both.

```bash
# PostgreSQL (local)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_DB=exomaps

# PostgreSQL (Docker)
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_USER=postgres
POSTGRES_PASSWORD=yourpassword
POSTGRES_DB=exomaps

# Flask
FLASK_PORT=5000
FLASK_ENV=development

# Optional
LAN_IP=192.168.1.77    # used by rundaily.sh status output
```

---

## Pipeline Execution

```bash
# Run individual phases
bash scripts/run_phase.sh 1   # Phase 01: Ingest CSVs
bash scripts/run_phase.sh 2   # Phase 02: Transform (XYZ)
bash scripts/run_phase.sh 3   # Phase 03: Inference (fill systems)
bash scripts/run_phase.sh 4   # Phase 04: Simulation tick

# Health check
bash scripts/health_check.sh
bash scripts/health_check.sh --fix-env   # auto-detect services
```

---

## VITA Build

```bash
cd 02_CLIENT/VITA

# Type check only
npx tsc --noEmit

# Production build → dist/
npm run build

# Dev server (HMR on :1420, proxies /api to :5000)
npm run dev

# Preview production build (same as LAUNCH.sh local mode)
npx vite preview
```

Vite config: `02_CLIENT/VITA/vite.config.ts`
- `server.proxy` and `preview.proxy` both route `/api` → `http://localhost:5000`
- `manualChunks`: `vendor-react`, `vendor-three`, `vendor-r3f`

---

## Migrations

Location: `03_DATA/03_MIGRATIONS/`
Current migration: `007_stellar_enrichment`

Run:
```bash
# Applied automatically on Flask startup if FLASK_ENV=development
# Or manually:
python3 01_SERVICES/01_GATEWAY/app.py --migrate
```

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module '../world/OrreryComponents'` | Import path wrong | OrreryComponents is in `src/world/`, not `src/components/` |
| `Cannot find module './ProceduralPlanet'` from world/ | ProceduralPlanet is in `components/` | Use `../components/ProceduralPlanet` |
| Port 5000 in use on launch | Old Flask process | `pkill -f "python3.*app\.py"` |
| `@exomaps/shared` import error | SHARED moved to Z_deprecate | Use `src/lib/shared/` copies instead |
| White screen on LAN Windows Chrome | HTTP/1.1 connection limit (6 per origin) with 210+ texture files | Use `--lan` mode (Caddy HTTP/2) |
| TDR crash on first planet click | HLSL shader compile >2s on Windows | Shader warmup pass during loading screen |
| `Unit exomaps-lan.service not found` | rundaily.sh used relative `$0` path | Fixed — uses absolute `$SCRIPT_PATH` |
