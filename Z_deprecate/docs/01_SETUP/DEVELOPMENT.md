# ExoMaps Development Guide — Phase 06 & 07 Complete

## Quick Start

### Setup
```bash
# Install dependencies (pinned versions)
make install-locked

# Verify linting/types  
make lint
make type-check

# Run tests
make test
```

### Development Workflow

```bash
# Format code automatically
make format

# Run Phase 04 simulation test (validates engine)
make test-phase04

# Run full CI locally before pushing
make full-test
```

## New Components (This Session)

### Phase 06 — Web Visualizer

**Access via browser:**
```
http://localhost:5000/starfield
```

**Features:**
- 3D interactive star map with ~500 systems
- Color-coded by spectral type (F/G/K/M) and habitability (green halo)
- Distance filtering slider (0–100 LY)
- Layer toggles: observed, inferred, routes, habitable zones, resources
- Click system to view details (spectral type, distance, luminosity, habitability)
- Mouse controls: drag to rotate, scroll to zoom, buttons to reset view

**Technical Stack:**
- Three.js 3D rendering
- Bootstrap 4 responsive layout
- Flask backend (`/api/world/systems` endpoint)
- JSON system data with Cartesian coordinates (X/Y/Z parsecs)

### Phase 05 v2 — Simulation Control APIs

**Access via browser:**
```
http://localhost:5000/simulation
```

**Endpoints (all role-protected):**
- `GET /api/simulation/<run_id>/snapshot` — Current state (tick, population, metrics)
- `GET /api/simulation/<run_id>/events?limit=20&after_tick=0` — Event log with pagination
- `POST /api/simulation/<run_id>/pause` — Pause execution
- `POST /api/simulation/<run_id>/resume` — Resume execution  
- `POST /api/simulation/<run_id>/step?interval=10` — Execute N ticks

**Control Panel Features:**
- Real-time population/economy/politics metrics
- Speed control (0.1x – 10x)
- Step-by-step execution
- Event log (last 20 events)
- Status indicators (running/paused/idle)

### Phase 07 — Modernization

**Dependency Management:**
- Pinned versions in `dbs/requirements-lock.txt` and `src/requirements-lock.txt`
- Reproducible installs: `pip install -r *-lock.txt`
- Python 3.9, 3.10, 3.11 compatibility tested in CI

**CI/CD Workflows (GitHub Actions):**
1. **CI Pipeline (`.github/workflows/ci.yml`)**
   - Linting: flake8 with max line length 120 chars
   - Formatting: black + isort checks
   - Type checking: mypy with ignore-missing-imports
   - Unit tests: pytest with coverage
   - Docker build validation
   - SQL migration syntax check

2. **Migration Pipeline (`.github/workflows/migrations.yml`)**
   - PostgreSQL 14 test container
   - Apply migrations and verify schema
   - Validate upgrade/downgrade paths

**Structured Logging (`dbs/logging_setup.py`):**
```python
from dbs.logging_setup import get_logger, PhaseLogger

# Simple logging
logger = get_logger(__name__)
logger.info("Starting process", extra={"run_id": "run_123"})

# Phase execution with timing
with PhaseLogger(phase=2, description="Coordinate Transforms", run_id="run_123") as phase:
    phase.log_metric("systems_processed", 1000)
```

**Console Output (plain text):**
```
2026-02-21 23:45:00 INFO     phase_1: Phase 1 - Data Ingestion started [run_001]
2026-02-21 23:45:05 INFO     phase_1: Metric: rows_processed=1000 [run_001]
2026-02-21 23:45:10 INFO     phase_1: Phase 1 completed in 10.2s [run_001]
```

**File Output (`logs/phase_N.log`):** JSON format for structured analysis
```json
{
  "timestamp": "2026-02-21T23:45:00",
  "level": "INFO",
  "logger": "phase_1",
  "message": "Phase 1 completed in 10.2s",
  "module": "fetch_db",
  "function": "run_ingestion_pipeline",
  "line": 42,
  "phase": 1,
  "run_id": "run_001",
  "status": "completed",
  "elapsed_seconds": 10.2
}
```

## Making Changes

### Adding a New Dependency
1. Update `dbs/requirements.txt` or `src/requirements.txt` (with versions)
2. Run: `pip install -r dbs/requirements.txt`
3. Test with: `make lint && make test`
4. Update lock files: `pip freeze > dbs/requirements-lock.txt`

### Running Phases
```bash
# Phase 01: Data ingestion (requires DB)
make run-phase01

# Phase 02: Coordinate transforms (requires Phase 01 output)
make run-phase02

# Phase 03: System inference (requires Phase 02 output)
make run-phase03

# Phase 04: Simulation (standalone, no DB needed)
make run-phase04
```

### Adding New API Endpoints
1. Add route in `src/app/app.py`:
   ```python
   @app.route('/api/example', methods=['GET'])
   @require_role('admin')
   def api_example():
       return jsonify({'status': 'ok'})
   ```

2. Test with: `curl http://localhost:5000/api/example`

3. Update `@require_role` with appropriate personas

### Persons (Role-Based Access Control)

**Available Personas:**
- `admin` — Full control (all endpoints)
- `sim_owner` — Simulation control + scenario config
- `science_analyst` — Read-only advanced queries
- `data_curator` — Data quality + validation
- `ops_engineer` — Operational monitoring
- `observer_guest` — Public read-only (limited)
- `general_user` — Basic read-only access

## Troubleshooting

### Database Connection Issues
```bash
# Verify PostgreSQL container is running
docker-compose up -d db

# Check logs
docker-compose logs db | tail -20

# Try connecting
docker-compose exec db psql -U postgres -d exomaps -c "SELECT version();"
```

### Linting Failures
```bash
# Auto-fix formatting
make format

# Show remaining issues
make lint

# Type errors
make type-check || true  # Continues on errors
```

### Test Failures
```bash
# Run with verbose output
python -m pytest dbs/ -vv

# With coverage
python -m pytest dbs/ --cov=dbs --cov-report=html
```

## Performance Tips

- **Starfield Viewer:** ~500 systems is the practical limit for smooth 60fps; use distance
 filter to reduce rendered objects
- **Simulation:** 1000 ticks completes in ~5 seconds on standard hardware (2% exponential growth)
- **API Response:** Queries cached by PersonaSQL; set persona switch to clear cache

## Next Phase Ideas

**Phase 08 — Cloud Deployment**
- Containerize services (Docker Compose → Kubernetes)
- Deploy to cloud (AWS/GCP/Azure)
- Add monitoring (CloudWatch/Datadog)
- Cost optimization & auto-scaling

**Phase 09 — Advanced Features**
- WebSocket real-time event streaming
- Advanced analytics dashboard (Plotly/Dash)
- Multi-user simulation collaboration
- Player economy balancing & A/B testing

---

**Questions?** Check `00_plan/ZZ_EXECUTION_BACKLOG.MD` for full phase documentation.
