# ZZ — Execution Backlog

## Overview

Living backlog tracking all implementation work across phases. Updated after each development session. Completed items remain as an audit trail; active items drive current priorities.

**Last updated:** March 2026

---

## Session History

### Session: Feb 20–21, 2026

**Priority:** Phase 02/03 E2E → Phase 04 Simulation → Phase 07 Modernization → Phase 06 Visualizer

**Delivered:**
| Phase | Deliverable | LOC |
|-------|-------------|-----|
| Phase 02 | Coordinate Engine (RA/Dec/parallax → X/Y/Z) | ~500 Python |
| Phase 02B | Role-Based Security (5 world API endpoints, HTTP 403) | ~200 Python |
| Phase 03 | System Inference (planets/belts, world build manifest) | ~400 Python |
| Phase 04 | Simulation Runtime (deterministic engine + economy/politics) | ~800 Python |
| Phase 05 | Read APIs + Simulation Control APIs | ~300 Python |
| Phase 06 | Web Visualizer MVP (Three.js star map, sim dashboard) | ~1500 JS + ~2000 HTML |
| Phase 07 | Legacy Modernization (CI, deps, logging, Makefile) | ~400 Python + CI YAML |

**Totals:** ~3,000 Python | ~1,500 JavaScript | ~2,000 HTML/Templates | 2 CI workflows | 40+ pinned deps

**Verified Outcomes:**
- Simulation: 50 ticks, 26.4M population, 6 events, deterministic ✅
- Economy: Tech levels 0–10, trade surplus/deficit tracking ✅
- Politics: Cohesion decay, independence movements operational ✅
- API: 10 endpoints (5 world + 5 simulation), all role-protected ✅
- Visualizer: Three.js 3D scene, ~500 markers, spectral colors, 60fps ✅
- CI/CD: Lint, tests, Docker build, migration validation automated ✅

---

## Active Backlog (March 2026)

### Priority 1 — Wire Campaign Endpoints

| Task | Phase | Status | Notes |
|------|-------|--------|-------|
| Create `campaign_dao.py` with real DB queries | M3/05 | 🔲 | INSERT/SELECT/UPDATE against `app_simulation.campaign` |
| Wire `create_campaign()` to DB | 05 | 🔲 | Replace stub with real INSERT |
| Wire `list_campaigns()` to DB | 05 | 🔲 | SELECT with status filter |
| Wire `get_campaign()` with summary stats | 05 | 🔲 | JOIN exploration counts |
| Wire `update_campaign()` to DB | 05 | 🔲 | PATCH name, settings, status |
| Wire `delete_campaign()` (soft delete) | 05 | 🔲 | SET status = 'archived' |
| Wire fog-of-war map endpoint | 05 | 🔲 | SELECT explored systems for campaign |
| Wire exploration CRUD (explore, scan, planets) | 05 | 🔲 | INSERT exploration + explored_planet rows |
| Wire fleet endpoints (stub → DB) | 05 | 🔲 | Schema exists; needs DAO |
| Add integration tests with real PostgreSQL | M3 | 🔲 | Docker Compose test service |

### Priority 2 — Stand Up World Engine Service

| Task | Phase | Status | Notes |
|------|-------|--------|-------|
| Create `01_SERVICES/03_WORLD_ENGINE/` structure | 04/08 | 🔲 | `__init__.py`, `app.py`, `requirements.txt`, `Dockerfile` |
| Move `simulation_core.py` + `economy_politics.py` as importable lib | 04 | 🔲 | Keep in pipeline for batch; expose for live use |
| Create simulation job runner (start/stop/step per campaign) | 04 | 🔲 | Campaign-aware simulation instances |
| Add health check endpoint | M5 | 🔲 | `/health`, `/ready` |
| Add to Docker Compose | 08 | 🔲 | Service definition with DB dependency |

### Priority 3 — Implement Messaging Layer

| Task | Phase | Status | Notes |
|------|-------|--------|-------|
| Create `01_SERVICES/04_MESSAGING/` structure | 07 | 🔲 | Redis pub/sub or WebSocket |
| Implement simulation tick broadcast | 07 | 🔲 | Publish tick results to subscribers |
| Implement exploration event notifications | 07 | 🔲 | Notify clients when fog-of-war updates |
| WebSocket handler in gateway (Flask-SocketIO) | 07 | 🔲 | Already imported but not used |
| Client-side WebSocket consumer (web) | 06 | 🔲 | Replace polling with push |

### Priority 4 — Game Mechanics Foundation

| Task | Phase | Status | Notes |
|------|-------|--------|-------|
| Migration 006: mineral deposits + resource tables | 09 | 🔲 | Planet-level resource schema |
| Implement procedural mineral generation | 09 | 🔲 | Seed-based, tied to planet type + mass |
| Dynamic market pricing engine | 09 | 🔲 | Supply/demand curves per commodity |
| Mission planning schema + API | 09 | 🔲 | Survey, colonize, trade mission types |
| SFTL fleet routing with multi-hop | 04 | 🔲 | Deferred from Phase 04 |
| Ship class definitions + schema | 09 | 🔲 | Colony ship, cargo, courier, patrol, probe |

### Priority 5 — Quality & Polish

| Task | Phase | Status | Notes |
|------|-------|--------|-------|
| OpenAPI/Swagger spec generation | 05 | 🔲 | Flask-RESTX or apispec |
| Database connection pooling | M3 | 🔲 | SQLAlchemy pool config |
| Health/readiness endpoints for all services | M5 | 🔲 | Docker probe targets |
| API request latency middleware | M5 | 🔲 | Log + metric per request |
| CRA → Vite migration for web client | M6 | 🔲 | Build speed improvement |
| Add state management (Zustand) | M6 | 🔲 | Replace prop drilling |
| Simulation determinism golden-output test | M1 | 🔲 | Regression guard |

---

## Phase Completion Summary

| Phase | Status | Completion Date | Key Metric |
|-------|--------|----------------|-----------|
| Phase 01 | ✅ Complete | Feb 2026 | Schema v1 + ingestion pipeline |
| Phase 02 | ✅ Complete | Feb 21, 2026 | 500+ LOC coordinate transforms |
| Phase 03 | ✅ Complete | Feb 21, 2026 | 400+ LOC inference engine |
| Phase 04 | ✅ Complete | Feb 21, 2026 | 800+ LOC simulation (5 tick phases) |
| Phase 05 | ✅ Core Complete | Feb 21, 2026 | 10 API endpoints, role-protected |
| Phase 06 | ✅ MVP Complete | Feb 21, 2026 | 3D star map + sim dashboard |
| Phase 07 | ✅ Complete | Feb 21, 2026 | CI + deps + logging + Makefile |
| Phase 08 | 🔲 Planned | — | Cloud deployment |
| Phase 09 | 🔲 Planned | — | Game mechanics expansion |
| Phase 6G | 🔲 Planned | — | Desktop client features |

---

## Global Definition of Done

| Criterion | Status |
|-----------|--------|
| Reproducible periodic pipeline with versioned world builds | ✅ |
| Deterministic simulation server with saved snapshots | ✅ |
| Web visualizer supports map + timeline + control loops | ✅ |
| Campaign system with fog-of-war exploration | 🔄 Schema + stubs (needs DB wiring) |
| Cloud deployment within target cost and operational guardrails | 🔲 |
| Desktop game client with campaign playability | 🔲 |
| Game mechanics (minerals, missions, ships, colonies) | 🔲 |

---

## Suggested 90-Day Focus (March–May 2026)

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1–2 | Wire campaign endpoints to database | Fully functional campaign CRUD + exploration tracking |
| 3–4 | World Engine service standup | Live simulation per campaign via API |
| 5–6 | Game mechanics: mineral system + dynamic market | Resource schema + pricing engine |
| 7–8 | Messaging layer + WebSocket | Real-time simulation events to web client |
| 9–10 | SFTL fleet routing + mission planning | Ships move between systems with purpose |
| 11–12 | Cloud staging deployment | Docker hardened, budget alerts, rollback tested |
