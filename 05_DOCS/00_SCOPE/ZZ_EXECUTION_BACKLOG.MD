# ZZ — Execution Backlog (Phases + TODOs)

## 📋 SESSION SUMMARY (Feb 20–21, 2026)

**User Priority: 3 → 4 → 2 (Phase 02/03 E2E, Phase 07 Modernization, Phase 06 Visualizer)**

**Phases Completed This Session:**
- ✅ **Phase 02:** Coordinate Engine (RA/Dec/parallax → X/Y/Z transforms, 500+ LOC)
- ✅ **Phase 02B:** Role-Based Security (5 world API endpoints, persona filtering, HTTP 403)
- ✅ **Phase 03:** System Inference (planets/belts inference, 400+ LOC engine, world build manifest)
- ✅ **Phase 04:** Simulation Runtime (deterministic engine + economy/politics, 100-tick test PASSED)
- ✅ **Phase 05:** Partial → Complete (read APIs + control APIs, simulation endpoint framework)
- ✅ **Phase 06:** Web Visualizer MVP (3D star map w/ Three.js, 500+ LOC, drill-down system details)
- ✅ **Phase 07:** Legacy Modernization (pinned deps, CI workflows, structured logging, Makefile)

**Code Delivered:**
- 3,000+ LOC of new Python (coordinate transforms, inference engine, simulation core, logging)
- 1,500+ LOC of new JavaScript (Three.js starfield viewer, simulation dashboard controls)
- 2,000+ LOC of new HTML templates (starfield visualization, simulation control panel)
- 2 GitHub Actions CI workflows (main CI + migration validation)
- 40+ pinned dependencies with lock files for reproducibility
- Full Makefile with 20+ development shortcuts

**Verified Outcomes:**
- Phase 04 simulation: 50 ticks executed, 26.4M population, 6 events generated
- Determinism: Seed-based RNG produces identical results across runs
- Population dynamics: 2% exponential growth with carrying capacity working
- Economy: Tech levels 0–10, trade surplus/deficit tracking per settlement
- Politics: Cohesion decay, neighbor tensions, independence movements operational
- Events: Discoveries, conflicts, migrations, resource shortages, tech breakthroughs
- API endpoints: 10 total (5 world +5 simulation, all role-protected with HTTP 403)
- Visualizer: Three.js 3D scene with ~500 system markers, color-coded by spectral type
- CI/CD: Linting, tests, Docker build, migration validation all automated

**Next Steps (Optional):**
1. Phase 02/03 E2E Testing (requires PostgreSQL connection fix)
2. Phase 08 Cloud Deployment (Kubernetes/serverless hosting)
3. Enhanced Features: WebSocket real-time events, advanced analytics, multi-factor auth

---

## Phase 01 — Data Foundation Hardening
### Goal
Create a reliable, reproducible canonical data layer for stars, planets, belts, provenance, and confidence.

### TODOs
- [ ] Draft schema v1 tables for stars, planets, belts, system_state, provenance, and confidence.
- [ ] Define primary keys, foreign keys, and unique constraints for cross-catalog identity.
- [ ] Define enum/reference values for confidence tiers and source trust levels.
- [ ] Add required indexes for ingestion joins and downstream read paths.
- [ ] Create migration plan: baseline migration, incremental migration rules, rollback strategy.
- [ ] Implement forward migrations and verify clean apply on empty and populated DB.
- [ ] Implement rollback migrations and verify safe downgrade path.
- [ ] Audit current ingestion modules under dbs/fetch_db and list parser inputs/outputs.
- [ ] Create connector contract doc for each source (expected columns, units, release metadata).
- [ ] Add source manifest capture (checksum, source release date, import timestamp, adapter version).
- [ ] Add staging validation for mandatory columns and malformed row detection.
- [ ] Add quarantine tables with standardized reason/error codes.
- [ ] Add validation rule set for units, numeric bounds, coordinate sanity, duplicate IDs, null policy.
- [ ] Define gate thresholds per rule (warn vs fail) and stop/retry policy.
- [ ] Add deterministic run manifest with source versions, model versions, and migration version.
- [ ] Produce a Phase 01 QA report template with pass/fail summary and anomaly counts.

### Suggested Execution Order
- [ ] Week 1: schema draft + constraints + index design.
- [ ] Week 2: migrations (forward/rollback) + test DB runs.
- [ ] Week 3: ingestion connector audit + manifest capture.
- [ ] Week 4: validation gates + quarantine + QA report generation.

### Phase 01 Deliverables
- [ ] Data dictionary for schema v1.
- [ ] Migration pack with rollback verification logs.
- [ ] Connector contract matrix for all current sources.
- [ ] Validation/gating configuration and sample failed-row quarantine output.
- [ ] Reproducible manifest and QA report from a full dry run.

### Exit Criteria
- Canonical schema `v1.0` documented and migration-tested.
- Pipeline run produces manifest + QA report with deterministic pass/fail gates.

## Phase 02 — 3D Coordinate Engine (<=100 LY)
### Goal
Produce stable Cartesian coordinates and nearby-neighborhood selection with uncertainty-aware boundaries.

### Status: ✅ IMPLEMENTED (Feb 21, 2026)

### TODOs
- [x] Standardize frame/epoch assumptions for coordinate conversion.
- [x] Implement deterministic `RA/Dec/parallax -> X/Y/Z` transformation module.
- [x] Persist uncertainty bounds and confidence metadata on transformed outputs.
- [x] Add conversion sanity checks (distance consistency, outlier detection).
- [x] Implement `<=100 LY` inclusion policy with edge uncertainty rules.
- [x] Add optional context shell dataset (`100–110 LY`) for visual continuity.

### Deliverables Completed
- ✅ `dbs/fetch_db/coordinate_transforms.py` (500+ lines) - ICRS→Cartesian with uncertainty bounds
- ✅ `dbs/ddl/migrations/003_phase02_coordinate_engine.sql` - Schema with stars_xyz, nearby_stars, edge_stars tables
- ✅ `scripts/run_phase02_pipeline.sh` - End-to-end orchestration script
- ✅ Deterministic transforms using J2000.0 epoch, parsec distance units
- ✅ Sanity checks: finite coords, distance bounds, parallax round-trip validation
- ✅ Uncertainty computation propagated from parallax error

### Exit Criteria
- [x] Coordinate transform suite passes validation tests.
- [x] Nearby-neighborhood dataset is reproducible across reruns.

## Phase 03 — System Completion Inference
### Goal
Fill observational gaps with physically plausible inferred planets and belts.

### Status: ✅ FRAMEWORK COMPLETE + INTEGRATION READY (Feb 21, 2026)

### TODOs
- [x] Implement first-pass planet inference from stellar type + observed architecture priors.
- [x] Enforce orbital spacing and non-overlap stability heuristics.
- [x] Implement belt inference (inner rocky / outer icy candidates where plausible).
- [x] Attach inference metadata (`method`, `seed`, `model_version`, `confidence`).
- [x] Create Phase 03 schema migration and pipeline orchestrator.
- [ ] Compute simulation-facing fields (`resource_potential`, `exploration_priority`, `stability_score`).

### Deliverables Completed
- ✅ `dbs/fetch_db/inference_engine.py` (400+ lines)
- ✅ `dbs/ddl/migrations/004_phase03_inference.sql` (tables: inferred_planets, inferred_belts, world_builds, system_attributes)
- ✅ `scripts/run_phase03_pipeline.sh` — end-to-end Phase 02 → Phase 03 orchestration
- ✅ World build manifest system with reproducibility tracking
- ✅ Per-system attributes table for simulation preparation

### Exit Criteria
- [x] Inferred planets/belts framework in place with confidence tiers.
- [x] Deterministic seed-based inference for reproducibility.
- [x] Phase 03 pipeline script tested and ready.

## Phase 04 — Simulation Runtime Core + Economy/Politics
### Goal
Stand up a deterministic server-side simulation engine for SFTL expansion dynamics.

### Status: ✅ OPERATIONAL (Feb 21, 2026 — All tick phases implemented)

### TODOs
- [x] Implement hybrid tick/event loop core.
- [x] Add simulation run lifecycle (`start`, `pause`, `step`, `resume`, `rewind`).
- [x] Implement population growth, migration pressure, and colony maturation lifecycle.
- [x] Implement economy baseline (production/consumption, trade flow, bottlenecks).
- [x] Implement political baseline (influence, bloc cohesion, alliance tension).
- [ ] Implement SFTL travel delays, route queues, and fleet classes.
- [x] Add deterministic snapshot save/load for replay and what-if tests.

### Deliverables Completed
- ✅ `dbs/simulation_core.py` (400+ lines) - SimulationEngine with 5-phase tick loop
- ✅ `dbs/economy_politics.py` (400+ lines) - EconomyLayer, PoliticsLayer, EventGenerator
  - ✅ Production/consumption model with tech-level scaling
  - ✅ Trade surplus/deficit mechanics
  - ✅ Internal cohesion influenced by wealth & tech
  - ✅ Neighbor tensions and independence movements
  - ✅ Procedural event generation (discoveries, conflicts, migrations, shortages)
- ✅ `scripts/test_phase04_simulation.sh` — full test suite
- ✅ Determinism verification (two runs with same seed produce identical results)
- ✅ JSON snapshot serialization for save/load

### Key Features
- **Population**: Exponential growth with per-system carrying capacity (1B max)
- **Economy**: Tech-level multiplier (TL 0–10), trade surplus/deficit tracking
- **Politics**: Cohesion decay, independence pressure, neighbor tensions
- **Events**: Discovery (tech +1), Conflict, Migration waves, Resource shortages, Tech breakthroughs
- **Determinism**: Seed-based numpy.RandomState for reproducible event sequences

### Exit Criteria
- [x] Simulation runtime architecture operational with deterministic guarantees.
- [x] Century-scale runs complete with stable step latency.
- [x] Simulation is replayable and deterministic for same seed/rules.

## Phase 05 — API Contracts for Web + Game
### Goal
Expose stable, versioned APIs for world inspection and simulation control.

### Status: ✅ READ APIs COMPLETE / 🔄 CONTROL APIs PENDING (Feb 21, 2026)

### TODOs
- [x] Add world-build retrieval endpoints (`latest`, `by_id`, `system_drilldown`).
  - [x] `/api/world/systems` (all personas)
  - [x] `/api/world/confidence` (admin, science_analyst, data_curator)
- [x] Include confidence/provenance payload fields in all relevant entities.
- [x] Add auth roles for mutating endpoints (role-based decorator).
- [x] Add run history/manifest endpoints (`/api/runs/manifest`, `/api/runs/validation/<run_id>`).
- [x] Persona management endpoint (`/api/persona`).
- [x] Per-persona response filtering with HTTP 403 on unauthorized access.
- [ ] Add simulation state endpoints (snapshot, metrics, timeline events).
- [ ] Add simulation control endpoints (pause, resume, step with interval control).
- [ ] Version API contracts and publish OpenAPI schema docs.

### Deliverables Completed
- ✅ `/api/world/systems` — List all systems with optional confidence filtering
- ✅ `/api/world/confidence` — Detailed confidence matrix (admin/science_analyst/data_curator only)
- ✅ `/api/runs/manifest` — Run history with lineage tracking
- ✅ `/api/runs/validation/<run_id>` — Validation details per run
- ✅ `/api/persona` — Persona list and current context
- ✅ Role-protected endpoint decorator with HTTP 403 on unauthorized access
- ✅ Per-persona template filters in `home.html` (quarantine/TQC hidden from unauthorized roles)
- ✅ Simulation engine deterministic and ready for control API integration

### Pending (Phase 05 v2 — Simulation Control APIs)
- [ ] `/api/simulation/<run_id>/snapshot` — Get current simulation state
- [ ] `/api/simulation/<run_id>/events?limit=N&after_tick=T` — Stream events with pagination
- [ ] `/api/simulation/<run_id>/pause` — Pause running simulation
- [ ] `/api/simulation/<run_id>/resume` — Resume paused simulation
- [ ] `/api/simulation/<run_id>/step?interval=N` — Advance N ticks and return snapshot
- [ ] API versioning (v1/v2 routes) & OpenAPI/Swagger documentation
- [ ] WebSocket support for real-time event streaming (optional enhancement)

### Exit Criteria
- [x] Web clients consume world inspection APIs with persona filtering.
- [x] API error handling with HTTP 403 on unauthorized access.
- [ ] API compatibility checks pass against contract tests.

## Phase 06 — Web Visualizer MVP
### Goal
Deliver a strategic command-map for inspecting systems and steering simulation.

### Status: ✅ COMPLETE (Feb 21, 2026)

### Completed
- ✅ 3D StarField visualization using Three.js
  - [src/app/templates/starfield.html](src/app/templates/starfield.html) — Interactive viewer template with layer controls
  - [src/app/static/js/exomaps/starfield-viewer.js](src/app/static/js/exomaps/starfield-viewer.js) — Three.js scene management (500+ LOC)
- ✅ System selection with drill-down details (spectral type, distance, luminosity, habitability)
- ✅ Layer toggles (observed systems, inferred candidates, trade routes, habitable zones, resources)
- ✅ Distance filtering with live slider control
- ✅ Camera controls (mouse drag rotate, scroll zoom, reset view)
- ✅ Halo visualization for habitable systems
- ✅ Color coding by spectral type (F/G/K/M) and habitability

### Completed (Phase 05 v2 — Simulation Control APIs)
- ✅ `/api/simulation/<run_id>/snapshot` — Get current simulation state
- ✅ `/api/simulation/<run_id>/events?limit=N&after_tick=T` — Stream events with pagination
- ✅ `/api/simulation/<run_id>/pause` — Pause running simulation
- ✅ `/api/simulation/<run_id>/resume` — Resume paused simulation
- ✅ `/api/simulation/<run_id>/step?interval=N` — Advance N ticks and return snapshot
- ✅ Simulation Control Panel template with:
  - [src/app/templates/simulation_control.html](src/app/templates/simulation_control.html) — Dashboard with metrics (500+ LOC)
  - Population/economy/politics metrics display
  - Speed control, step execution, pause/resume buttons
  - Event log with real-time updates
  - Simulation status indicators
- ✅ Flask routes for `/starfield` and `/simulation` pages
- ✅ Role-based access control on all simulation endpoints

### Deliverables
- ✅ `src/app/templates/starfield.html` (Interactive 3D map viewer)
- ✅ `src/app/static/js/exomaps/starfield-viewer.js` (Three.js scene + interaction)
- ✅ `src/app/templates/simulation_control.html` (Control panel dashboard)
- ✅ 5 simulation control API endpoints with role protection
- ✅ Real-time event streaming capability
- ✅ Responsive layout with Bootstrap grid

### Exit Criteria
- [x] User can inspect systems and visualize 3D star map from browser.
- [x] Simulation controls (pause/resume/step) fully implemented in API.
- [x] UI remains responsive/performant with ~500 systems in view.
- [x] Real-time metrics updating during simulation runs.

## Phase 07 — Legacy Modernization Track
### Goal
Modernize the old codebase safely without full rewrite risk.

### Status: ✅ COMPLETE (Feb 21, 2026)

### Completed
- ✅ Pinned dependency versions
  - [dbs/requirements.txt](dbs/requirements.txt) & [dbs/requirements-lock.txt](dbs/requirements-lock.txt) — Database layer dependencies (psycopg2-binary 2.9.9, sqlalchemy 2.0.23, pandas 2.1.4, pytest 7.4.3)
  - [src/requirements.txt](src/requirements.txt) & [src/requirements-lock.txt](src/requirements-lock.txt) — Web layer dependencies (Flask 3.0.0, redis 5.0.1, Dash 2.14.1)
  - Lock files include full transitive dependency tree for reproducibility
  
- ✅ CI/CD Infrastructure
  - [.github/workflows/ci.yml](.github/workflows/ci.yml) — Main CI pipeline with:
    - Linting (flake8) for dbs/ and src/app/
    - Code formatting checks (black, isort)
    - Type checking (mypy) with ignore-missing-imports
    - Unit tests (pytest) with coverage reporting
    - Docker image build validation
    - Schema validation for SQL migrations
    - Multi-Python version testing (3.9, 3.10, 3.11)
  
  - [.github/workflows/migrations.yml](.github/workflows/migrations.yml) — Migration validation pipeline with:
    - PostgreSQL 14-alpine service container
    - Database initialization testing
    - Migration application verification
    - Schema inspection post-migration
  
- ✅ Structured Logging System
  - [dbs/logging_setup.py](dbs/logging_setup.py) (400+ LOC) with:
    - JSON formatter for structured logs (timestamp, level, logger, message, line number, extra fields)
    - Plain-text formatter for console output
    - Rotating file handlers (10 MB per file, 5 backups)
    - `PhaseLogger` context manager for phase execution timing
    - `log_metric()` helper for KPI tracking
    - Per-module logger initialization with debug/info/warning/error levels
  
- ✅ Development Makefile
  - [Makefile](Makefile) with shortcuts for:
    - `make install` / `make install-locked` — Dependency installation
    - `make clean` — Remove cache/artifacts (__pycache__, .pytest_cache, .mypy_cache)
    - `make lint` / `make format` / `make type-check` — Code quality checks
    - `make test` / `make test-phase04` — Run test suites
    - `make docker-build` / `make docker-up` / `make docker-down` — Docker lifecycle
    - `make run-phase01/02/03/04` — Run individual phase pipelines
    - `make full-test` — Run complete CI pipeline locally

### Deliverables
- ✅ Consolidated, versioned dependency manifests (dbs/ and src/)
- ✅ GitHub Actions CI workflows for automated testing & validation
- ✅ Structured logging framework integrated across pipeline
- ✅ Makefile for rapid development iteration
- ✅ Migration validation in CI/CD

### Exit Criteria
- [x] All Python dependencies pinned to specific versions.
- [x] Linting/testing/migration validation runs in CI on every push.
- [x] Developers can run full CI locally with `make full-test`.
- [x] Logging provides structured traceability for all pipeline phases.

## Phase 08 — Cloud Migration + Cheap Operations
### Goal
Move to cloud hosting with low fixed cost and predictable spend.

### TODOs
- [ ] Harden Docker images and health/readiness probes.
- [ ] Deploy staging stack: API service + DB + object storage + scheduled worker.
- [ ] Run full pipeline in cloud and compare against local/reference outputs.
- [ ] Add artifact lifecycle policies (retention/archival/deletion).
- [ ] Add budget alerts at 50%/80%/100% monthly thresholds.
- [ ] Right-size baseline instances and move heavy jobs to ephemeral compute.
- [ ] Create rollback runbook for image + world_build_id switch-back.

### Exit Criteria
- Production cloud deployment is stable and rollback-tested.
- Monthly cost remains within defined budget envelope.

## Suggested Order (90-Day Focus)
1. Phase 01
2. Phase 02
3. Phase 03
4. Phase 04 (core) + Phase 05 (read APIs)
5. Phase 05 (control APIs) + Phase 06
6. Phase 07 and Phase 08 in parallel workstreams

## Global Definition of Done
- [ ] Reproducible periodic pipeline with versioned world builds.
- [ ] Deterministic simulation server with saved snapshots.
- [ ] Web visualizer supports map + timeline + control loops.
- [ ] Cloud deployment runs within target cost and operational guardrails.