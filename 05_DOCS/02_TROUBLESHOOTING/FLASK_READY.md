# ExoMaps System - Startup Guide

## ✅ System Status Summary

**All components are now OPERATIONAL:**
- ✅ Flask web server running and responding
- ✅ PostgreSQL database connected (local, peer-authenticated)
- ✅ Database schemas and tables created
- ✅ API endpoints functional with role-based access control
- ✅ Web UI accessible with 20+ routes

**Current Configuration:**
- Flask running on: `127.0.0.1:5000` (also accessible on `<YOUR_LAN_IP>:5000`)
- PostgreSQL user: `tsr` (peer-authenticated via Unix socket)
- Database: `exomaps` (all schemas and tables created)
- Debug mode: OFF (for stability)
- Reloader: OFF (to prevent request blocking)

---

## Quick Start (Local PostgreSQL Mode)

### Prerequisites
```bash
# Ensure PostgreSQL 17.8 is running and user 'tsr' exists
psql --version  # Should show PostgreSQL 17.8
psql -U tsr -d exomaps -c "SELECT 1"  # Verify connection works
```

### Start Flask Server
```bash
cd /home/tsr/Projects/exomaps

# With explicit environment variables
POSTGRES_USER=tsr POSTGRES_PASSWORD="" POSTGRES_HOST=localhost POSTGRES_DB=exomaps \
  python3 src/app/app.py

# Or simply (defaults are configured):
python3 src/app/app.py
```

**Expected Output:**
```
 * Serving Flask app 'app'
 * Debug mode: off
 * Running on http://127.0.0.1:5000
Press CTRL+C to quit
```

### Access the Application
- **Home Page:** http://127.0.0.1:5000
- **API Root:** http://127.0.0.1:5000/api/persona
- **Star Map Viewer:** http://127.0.0.1:5000/viewer
- **Simulation Control:** http://127.0.0.1:5000/simulation

### Test API Endpoints
```bash
# Get current persona (no auth required)
curl http://127.0.0.1:5000/api/persona | python3 -m json.tool

# Get world systems (returns empty initially - no data loaded)
curl http://127.0.0.1:5000/api/world/systems | python3 -m json.tool

# Switch to admin role and access restricted endpoints
curl -c /tmp/cookies.txt 'http://127.0.0.1:5000/demo/persona?role=admin&next=/'
curl -b /tmp/cookies.txt http://127.0.0.1:5000/api/runs/manifest | python3 -m json.tool
```

---

## Key Changes Made

### 1. **Flask Debug/Reloader Issue Fixed**
- **Problem:** Flask debugger with reloader was blocking HTTP responses
- **Solution:** Disabled debug mode and reloader by default (configurable via `FLASK_DEBUG` env var)
- **File Changed:** `src/app/app.py` (lines 75-80, 990-993)

### 2. **Database Connection Schema Fixed**
- **Problem:** Migration 003 had generated column conflicts and missing foreign keys
- **Solution:** Created `dbs/ddl/migrations/003_phase02_coordinate_engine_fixed.sql`
  - Removed invalid generated column reference (`is_nearby` depending on `distance_ly`)
  - Fixed table creation order
  - Added missing columns and constraints
- **Tables Created:**
  - `dm_galaxy.stars_xyz` (Cartesian coordinate transformations)
  - `dm_galaxy.nearby_stars` (proximity cache)
  - `dm_galaxy.edge_stars` (context stars 100-110 LY)
  - All supporting validation and metadata tables

### 3. **Database Initialization Complete**
- ✅ Schema: `stg_data` (staging/ingestion)
- ✅ Schema: `dm_galaxy` (dimensional model/analytics)
- ✅ Schema: `app_simulation` (simulation runtime state)
- ✅ All tables: created and indexed

---

## API Endpoints Available

### Public Endpoints (No Auth)
- `GET /` - Home page with dashboard
- `GET /api/persona` - Current persona and available personas
- `GET /viewer` - 3D star map visualizer
- `GET /gui` - GUI interface
- `GET /starfield` - Starfield visualization
- `GET /simulation` - Simulation control dashboard

### Role-Protected Endpoints

**Admin/Ops/Data Curator Only:**
- `GET /api/runs/manifest` - List all ingestion runs

**Admin/Sim Owner/Observer:**
- `GET /api/simulation/<run_id>/snapshot` - Simulation state
- `GET /api/simulation/<run_id>/events` - Event log
- `POST /api/simulation/<run_id>/pause` - Pause simulation
- `POST /api/simulation/<run_id>/resume` - Resume simulation
- `POST /api/simulation/<run_id>/step` - Single step

**All Roles:**
- `GET /api/world/systems` - Star systems within 100 LY
- `GET /api/world/confidence` - Confidence metrics

---

## Configuration

### Environment Variables (Optional)
```bash
# These have sensible defaults but can be overridden:
POSTGRES_USER=tsr                    # Default: postgres
POSTGRES_PASSWORD=""                 # Default: empty (peer auth)
POSTGRES_HOST=localhost              # Default: localhost
POSTGRES_PORT=5432                   # Default: 5432
POSTGRES_DB=exomaps                  # Default: exomaps

# Flask Configuration:
FLASK_DEBUG=false                    # Default: false (disable debug/reloader)
FLASK_SECRET_KEY=...                 # Default: exomaps-dev-secret
PORT=5000                            # Default: 5000
```

### Database Connection Modes

#### Local (Peer Authentication)
- **Use:** Development on the same machine
- **Command:** `psql -U tsr -d exomaps`
- **Socket:**  `/var/run/postgresql`
- **No password needed** (peer authentication)

#### Docker (Password Authentication)
- **Use:** If running PostgreSQL in Docker
- **Port:** 5433 (not 5432, to avoid conflicts)
- **Password:** Set in docker-compose.yml

---

## Troubleshooting

### Flask still blocking on requests?
```bash
# Check if another Flask process is using port 5000
lsof -i :5000
ss -tlnp | grep 5000

# Kill lingering processes
killall -9 python3  # Or specific PIDs from above

# Restart Flask without debug/reloader
python3 src/app/app.py
```

### Database connection errors?
```bash
# Test direct PostgreSQL connection
psql -U tsr -d exomaps -c "SELECT 1"

# Check if schemas exist
psql -U tsr -d exomaps -c "\dn"

# Check if stars_xyz table exists
psql -U tsr -d exomaps -c "\dt dm_galaxy.stars_xyz"
```

### API returns empty data?
- This is normal - no data has been loaded yet
- Database is properly connected but empty
- Use data loading scripts in `dbs/fetch_db/` to populate

---

## Next Steps

### 1. Verify Flask Stabilization
```bash
# Monitor Flask for 30 seconds
timeout 30 python3 src/app/app.py

# Test responsiveness
curl -s http://127.0.0.1:5000/ | head -20
curl -s http://127.0.0.1:5000/api/persona | python3 -m json.tool
```

### 2. Load Sample Data (Optional)
```bash
# When ready to populate database:
cd dbs/fetch_db
python3 process_rest_csv.py  # Load exoplanet data
python3 simbad.py            # Load SIMBAD star data
```

### 3. Run Tests
```bash
# Unit tests for simulation engine
python3 -m pytest dbs/tests/ -v

# Integration tests for database layer
python3 -m pytest dbs/test_integration.py -v
```

### 4. Build Frontend Assets (Optional)
```bash
cd src/app
npm install
npm run build  # Compile webpack assets
```

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        ExoMaps System                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Frontend (Static)          Backend (Flask)     Database    │
│  ├─ HTML Templates          ├─ 20 Routes        ├─ stg_data  │
│  ├─ Bootstrap CSS           ├─ API Endpoints    ├─ dm_galaxy │
│  ├─ Three.js 3D viewer      ├─ Session Mgmt     └─ app_sim   │
│  └─ jQuery AJAX             └─ DB Connection                │
│                                                             │
│  PostgreSQL 17.8 (Local) or PostgreSQL 14-alpine (Docker)  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Personas (9 roles with menu-driven UI):
- Admin: Full system control
- Sim Owner: Simulation configuration
- Data Curator: Data validation & provenance
- Science Analyst: Coordinate QA
- Ops Engineer: Infrastructure monitoring
- General User: Read-only exploration
- Narrative Designer: Campaign creation
- Observer Guest: Public-safe mode
```

---

## File Locations

- **Application:** `/home/tsr/Projects/exomaps/src/app/`
- **Database:** `/home/tsr/Projects/exomaps/dbs/`
- **Migrations:** `/home/tsr/Projects/exomaps/dbs/ddl/migrations/`
- **Configuration:** `src/app/app.py` (lines 75-80, 990-993 - debug settings)
- **Schema:** `dbs/ddl/create_schemas.sql` (base) + `migrations/00X_*.sql` (incremental)

---

## Support

For issues or questions:
1. Check Flask log output for error messages
2. Verify PostgreSQL is running: `pg_isready -U tsr -d exomaps`
3. Review database schema: `psql -U tsr -d exomaps -c "\dt"` and `"\dn"`
4. Check API responses: `curl http://127.0.0.1:5000/api/persona`

**Status:** 🟢 **READY FOR DEVELOPMENT**
