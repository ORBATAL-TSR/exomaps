# 09 — Legacy Modernization Strategy

## Overview

The ExoMaps codebase has evolved from prototype to production through rapid development. This strategy document defines how to modernize without rewrite risk — preserving working domain logic while introducing guardrails, typing, observability, and clean architecture boundaries.

**Status (March 2026):** Phase M1–M3 largely complete. M4–M6 ongoing.

---

## Guiding Principles

| Principle | Implementation |
|-----------|---------------|
| **Preserve behavior** | Never change outputs without tests verifying before/after equivalence |
| **Strangler pattern** | Migrate in vertical slices; old and new coexist until slice is proven |
| **Test before refactor** | Add tests around legacy behavior before touching core logic |
| **Consistent tooling** | Enforce linting, formatting, type checking across all modules |
| **Incremental wins** | Ship small improvements continuously; avoid big-bang migrations |

---

## Current-State Assessment

### Codebase Health (as of March 2026)

| Area | Current State | Health | Priority |
|------|--------------|--------|----------|
| **Pipeline (01_SERVICES/02_PIPELINE)** | Modular phases, 3000+ LOC | 🟢 Good | Low (recently built) |
| **Gateway (01_SERVICES/01_GATEWAY)** | 2500+ LOC Flask app, mixed concerns | 🟡 Fair | Medium (campaign stubs need wiring) |
| **Web Client (02_CLIENTS/01_WEB)** | React + TS, CRA build, basic components | 🟡 Fair | Medium (CRA → Vite migration) |
| **Desktop Client (02_CLIENTS/02_DESKTOP)** | Tauri shell, minimal features | 🟢 Good | Low (greenfield) |
| **Shared Client (02_CLIENTS/SHARED)** | TypeScript types, basic API client | 🟡 Fair | Medium (expand shared types) |
| **Database Migrations** | 5 migrations, well-structured | 🟢 Good | Low |
| **Docker/Infra** | Compose file, basic Dockerfiles | 🟡 Fair | Medium (hardening for cloud) |
| **CI/CD** | GitHub Actions (lint, test, Docker) | 🟢 Good | Low (recently built) |
| **Logging** | Structured JSON logging framework | 🟢 Good | Low (recently built) |
| **Dependencies** | Pinned with lock files | 🟢 Good | Low (recently pinned) |

### Identified Technical Debt

| ID | Debt Item | Location | Impact | Effort |
|----|-----------|----------|--------|--------|
| TD1 | Campaign API stubs (no real DB queries) | `01_GATEWAY/campaigns.py` | 10 routes non-functional | Medium |
| TD2 | Mixed concerns in `app.py` (2500+ LOC) | `01_GATEWAY/app.py` | Hard to test, hard to navigate | High |
| TD3 | World Engine service empty | `01_SERVICES/03_WORLD_ENGINE/` | No runtime simulation service | High |
| TD4 | Messaging service empty | `01_SERVICES/04_MESSAGING/` | No real-time sync | Medium |
| TD5 | CRA build for web client | `02_CLIENTS/01_WEB/` | Slow builds, limited config | Low |
| TD6 | No OpenAPI documentation | Gateway | API consumers lack machine-readable spec | Low |
| TD7 | No database connection pooling | Gateway | Performance risk under concurrency | Medium |
| TD8 | No integration tests with real DB | Pipeline + Gateway | DB queries untested against live Postgres | Medium |
| TD9 | Simulation code in pipeline, not exposed as service | `02_PIPELINE/04_SIMULATION/` | Can't run live simulations via API | High |
| TD10 | No WebSocket support for real-time events | Gateway | Polling-only for simulation updates | Medium |

---

## Modernization Phases

### Phase M1 — Baseline Safety Net ✅ COMPLETE

**Goal:** Establish safe refactoring baseline with automated checks.

| Deliverable | Status | Implementation |
|-------------|--------|---------------|
| Smoke tests for pipeline phases | ✅ | pytest suites per phase |
| Golden dataset tests for fixed astronomical sample | ✅ | Known-star reference validation |
| CI pipeline: lint + tests + Docker build | ✅ | GitHub Actions `ci.yml` |
| Migration validation in CI | ✅ | GitHub Actions `migrations.yml` |

**Outcome:** Any refactor that breaks behavior is caught by CI within minutes.

---

### Phase M2 — Dependency & Build Hygiene ✅ COMPLETE

**Goal:** Reproducible builds and elimination of dependency drift.

| Deliverable | Status | Implementation |
|-------------|--------|---------------|
| Pinned Python dependencies with lock files | ✅ | `requirements.txt` + `requirements-lock.txt` per service |
| Pinned Node dependencies | ✅ | `package-lock.json` for web + desktop + shared |
| Deprecated package removal | ✅ | Audit and cleanup |
| Makefile for common operations | ✅ | 20+ targets: `make lint`, `make test`, `make docker-up` |
| Multi-Python version CI matrix | ✅ | Python 3.9, 3.10, 3.11 |

**Outcome:** `make install-locked && make full-test` produces identical results across machines.

---

### Phase M3 — Internal Modularization 🔄 IN PROGRESS

**Goal:** Split mixed-responsibility modules into clean, testable units.

| Task | Status | Notes |
|------|--------|-------|
| Extract campaign logic from `app.py` → `campaigns.py` | ✅ | Blueprint pattern with dedicated routes |
| Extract simulation API routes from `app.py` | 🟡 | Partially done; some routes still in main app |
| Create service-layer abstraction for DB queries | 🔲 | Gateway routes still contain direct SQL |
| Separate data-access objects (DAO) from Flask routes | 🔲 | Needed for campaign endpoint wiring |
| Move simulation runtime to World Engine service | 🔲 | Currently embedded in pipeline package |

**Target Architecture:**

```
Gateway (Flask)                   World Engine (Service)
├── routes/                       ├── simulation_core.py
│   ├── world.py                  ├── economy_politics.py
│   ├── campaigns.py  ✅          ├── event_generator.py
│   ├── simulation.py             └── fleet_router.py (new)
│   └── admin.py
├── services/                     Messaging (Service)
│   ├── campaign_svc.py (new)     ├── redis_pubsub.py (new)
│   ├── world_svc.py (new)       └── ws_handler.py (new)
│   └── simulation_svc.py (new)
└── dao/
    ├── campaign_dao.py (new)
    ├── world_dao.py (new)
    └── base.py (new)
```

**Outcome:** Each module independently testable; no DB logic in route handlers.

---

### Phase M4 — Data Contracts & Type Safety 🔲 PLANNED

**Goal:** Prevent silent data regressions with schema validation at boundaries.

| Task | Status | Notes |
|------|--------|-------|
| Add Pydantic models for API request/response schemas | 🔲 | Replace raw dict returns |
| Add schema validation at ingestion boundaries | 🔲 | Validate CSV column types before INSERT |
| Add typed DTOs for simulation state exchange | 🔲 | `SimulationSnapshot`, `SettlementState`, etc. |
| Add confidence/provenance invariant checks | 🔲 | Assert all entities have tier + source |
| Generate TypeScript types from Python schemas | 🔲 | Shared contract between backend and SHARED/ |
| Add API contract tests (request → expected response shape) | 🔲 | pytest-based, run in CI |

**Outcome:** Type mismatches caught at boundaries; frontend/backend schemas stay in sync.

---

### Phase M5 — Observability & Ops Maturity 🔄 PARTIAL

**Goal:** Production-grade observability for debugging, performance, and health monitoring.

| Task | Status | Notes |
|------|--------|-------|
| Structured logging with correlation IDs | ✅ | `logging_setup.py` with PhaseLogger |
| Per-phase execution timing | ✅ | PhaseLogger context manager |
| KPI metric emission (`log_metric()`) | ✅ | Helper function in logging module |
| Pipeline throughput metrics | ✅ | Records ingested/merged/rejected per run |
| Simulation tick latency tracking | 🔲 | Need: per-tick timing with P95/P99 reporting |
| API request latency + error rate tracking | 🔲 | Need: middleware for Flask routes |
| Health check endpoints | 🔲 | `/health`, `/ready` for Docker probes |
| Error tracking (Sentry or similar) | 🔲 | Centralized exception reporting |
| Grafana dashboards or equivalent | 🔲 | Visual metrics for ops team |

**Outcome:** Can diagnose any issue from logs + metrics without SSH-ing into containers.

---

### Phase M6 — Front-end Incremental Modernization 🔲 PLANNED

**Goal:** Improve web client architecture without full rewrite.

| Task | Status | Notes |
|------|--------|-------|
| CRA → Vite migration | 🔲 | Faster builds, better HMR, smaller bundles |
| Add state management (Zustand or Jotai) | 🔲 | Replace prop drilling for simulation state |
| Component library conventions | 🔲 | Consistent patterns for panels, overlays, controls |
| Three.js scene optimization (instanced rendering) | 🔲 | Handle 5,000+ markers without frame drops |
| Lazy loading for heavy components (Orrery, shaders) | 🔲 | Reduce initial bundle size |
| Accessibility audit (ARIA, keyboard nav, contrast) | 🔲 | WCAG 2.1 AA compliance target |
| Storybook for component isolation | 🔲 | Visual testing and documentation |

**Outcome:** Modern dev experience; faster iteration; accessible to broader audience.

---

## Refactoring Safety Techniques

| Technique | When to Use | Example |
|-----------|-------------|---------|
| **Branch-by-abstraction** | Replacing internal module | New DAO layer behind interface; old SQL removed after verification |
| **Feature flags** | Rolling out modernized module | `USE_NEW_CAMPAIGN_SVC=true` to switch implementations |
| **Side-by-side comparison** | Transform or inference changes | Run old and new; diff outputs; assert equivalence |
| **Rollback-ready deploy** | Any production change | Docker image tag pinning; previous image always available |
| **Golden output tests** | Determinism-critical paths | Saved snapshot from known seed; regression test asserts match |

---

## Technology Direction

| Area | Current | Target | Rationale |
|------|---------|--------|-----------|
| **Python backend** | Flask 3.0, raw SQLAlchemy | Flask + Pydantic + DAO layer | Type safety, testability |
| **Database** | PostgreSQL 14+ | PostgreSQL (same) + connection pooling | Stable choice; pool for concurrency |
| **Migrations** | Raw SQL files | Raw SQL (same) + CI validation | Already working well |
| **Web frontend** | CRA + React 18 | Vite + React 18 + Zustand | Build speed, state management |
| **Desktop frontend** | Tauri + TypeScript | Tauri + TypeScript (same) | Already modern |
| **CI/CD** | GitHub Actions | GitHub Actions + staging deploy | Add deployment to pipeline |
| **Containers** | Docker Compose (dev) | Multi-stage Docker + optional K3s | Cloud-ready without over-engineering |
| **Monitoring** | Structured logs | Logs + Prometheus metrics + alerts | Full observability stack |

---

## Process Improvements

| Improvement | Description |
|-------------|-------------|
| **Architecture Decision Records (ADRs)** | Document significant technical decisions with context and trade-offs |
| **PR review template** | Require: what changed, why, risk level, test plan, rollback plan |
| **Refactor test requirement** | Any PR touching data transforms must include before/after test |
| **Dependency update schedule** | Monthly review of dependency versions; quarterly major bumps |
| **Code ownership map** | Document which modules are "stable" vs "under active refactor" |

---

## Modernization Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|---------------|
| Build reproducibility | ~90% | > 99% | Same commit → same Docker image hash |
| CI pass rate | ~85% | > 95% | GitHub Actions dashboard |
| Test coverage (Python) | ~30% | > 60% | pytest-cov in CI |
| Test coverage (TypeScript) | ~10% | > 40% | Jest coverage in CI |
| Mean time to diagnose issue | Hours | < 30 minutes | Incident log review |
| Lead time for pipeline module change | Days | < 4 hours | PR open → merged |
| Regression incidents per release | Unknown | < 1 per release | Incident tracking |

---

## Cross-References

| Topic | Document |
|-------|----------|
| Phase-level modernization tracking | `07_IMPLEMENTATION_PHASES.MD` (Phase 07, M-phases) |
| CI/CD details | `.github/workflows/ci.yml`, `migrations.yml` |
| Logging implementation | Infrastructure in `logging_setup.py` |
| Docker configuration | `04_INFRA/01_DOCKER/docker-compose.yml` |
| Makefile targets | `04_INFRA/Makefile` |
