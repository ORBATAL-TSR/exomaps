# 01 — Services Architecture

## Service Decomposition

ExoMaps follows a **modular monolith → microservice** evolution path. Today all
backend logic lives in a single Flask process (the Gateway). The internal module
boundaries in `01_SERVICES/` are designed so each sub-folder can be extracted into
an independent deployable when scale demands it.

```
01_SERVICES/
├── 01_GATEWAY/            ← Live: single-port Flask server
├── 02_PIPELINE/           ← Live: offline batch processing
├── 03_WORLD_ENGINE/       ← Planned: dedicated sim service
└── 04_MESSAGING/          ← Planned: event bus + WebSocket relay
```

---

## 01_GATEWAY — API Gateway & SPA Host

**Role:** Single entry point for all client traffic. Serves the React SPA and
exposes the REST API. Handles authentication, persona-based RBAC, and request
routing.

**Port:** 5000 (unified — no separate dev proxy needed in production)

```
┌──────────────────────────────────────────────────────────┐
│                       01_GATEWAY                          │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐    │
│  │ /api/*   │  │ /        │  │ /static/* (React)   │    │
│  │ REST     │  │ SPA HTML │  │ JS/CSS/GLSL bundles │    │
│  └────┬─────┘  └────┬─────┘  └──────────┬──────────┘    │
│       │             │                    │                │
│  ┌────▼─────────────▼────────────────────▼──────────┐    │
│  │              Flask Application                    │    │
│  │  Routes · Persona · Session · CORS · SocketIO    │    │
│  └──────────────────┬───────────────────────────────┘    │
│                     │                                     │
│  ┌──────────────────▼───────────────────────────────┐    │
│  │          SQLAlchemy → PostgreSQL 17               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### API Surface

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | DB status, route count |
| GET | `/api/persona` | Current persona + available list |
| POST | `/api/persona` | Switch active persona |
| GET | `/api/world/systems` | Star systems ≤ 100 LY |
| GET | `/api/world/systems/xyz` | Systems + ICRS Cartesian |
| GET | `/api/world/systems/full` | Full render payload (XYZ + spectral + multiplicity) |
| GET | `/api/world/confidence` | Confidence / uncertainty data |
| GET | `/api/runs/manifest` | Pipeline ingest history |
| GET | `/api/runs/validation/:id` | Per-run validation details |
| GET | `/api/simulation/:id/snapshot` | Sim state at tick |
| POST | `/api/simulation/:id/pause` | Pause simulation |
| POST | `/api/simulation/:id/resume` | Resume simulation |
| POST | `/api/simulation/:id/step` | Advance N ticks |

### Extraction Path

When traffic justifies it, the Gateway splits into:
- **API service** — stateless REST handlers
- **SPA CDN** — static React build served from Nginx / CloudFront
- **Auth service** — JWT issuer + session store

---

## 02_PIPELINE — Data Pipeline

**Role:** Offline batch processing that populates the database from raw CSV sources.
Runs on demand (not continuously). Each phase is a Python module that can run
independently given its upstream data exists.

```
01_INGEST/        Phase 01 — CSV → stg_data.* with validation & quarantine
02_TRANSFORM/     Phase 02 — RA/Dec parallax → ICRS Cartesian (dm_galaxy.stars_xyz)
03_INFERENCE/     Phase 03 — Titius-Bode + spectral heuristics → inferred planets/belts
04_SIMULATION/    Phase 04 — SFTL civilization sim engine
SHARED/           database.py, config_manager.py, service_discovery.py, logging_setup.py
```

### Extraction Path

Each phase becomes a containerized worker triggered by:
- **SQS message** (cloud) — e.g. `pipeline.ingest.requested`
- **Celery task** (self-hosted) — scheduled or API-triggered
- **Kubernetes Job** — one-shot execution with resource limits

---

## 03_WORLD_ENGINE — Simulation Service (Planned)

**Role:** Long-running simulation state machine. Receives world builds from the
pipeline and runs deterministic tick-based expansion: population growth, colony
founding, trade route optimization, political faction dynamics.

### Interface Contract (Future)

```
POST /api/simulation            → Create a new simulation from a world build
GET  /api/simulation/:id        → Current state snapshot
POST /api/simulation/:id/tick   → Advance N ticks
WS   /ws/simulation/:id/stream  → Real-time tick events
```

### Why Separate?

The simulation is CPU-intensive and state-heavy. Decoupling it from the Gateway
means:
- Sim can run on a beefier instance
- Multiple sim instances can run concurrently (different scenarios)
- Gateway stays fast for read-heavy map rendering

---

## 04_MESSAGING — Event Bus & Real-Time (Planned)

**Role:** Decouple services and enable real-time client updates. Three messaging
patterns:

### 1. WebSocket Relay (Client ↔ Server)

```
Client ───WSS──→ 04_MESSAGING ──→ Internal event bus
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                 ▼
              03_WORLD_ENGINE   01_GATEWAY      Other clients
              (sim events)     (state cache)   (multiplayer sync)
```

**Use cases:**
- Live simulation tick updates to connected viewers
- Multiplayer map interaction (cursor positions, annotations)
- Admin broadcast (pipeline complete, new data available)

### 2. Message Queue (Service ↔ Service)

```
01_GATEWAY  ──▶  SQS / Redis Streams  ──▶  02_PIPELINE
   "run pipeline phase 01"                   (picks up job)
```

**Use cases:**
- Pipeline triggering from admin UI
- Simulation request queuing
- Rate limiting expensive operations

### 3. Event Sourcing (Future)

All state mutations logged as immutable events:
```
{ event: "colony.founded", system: "Proxima Centauri", tick: 142, population: 500 }
{ event: "trade.route.opened", from: "Sol", to: "Alpha Centauri", tick: 155 }
```

Benefits: full replay, branching timelines, undo.

---

## Multi-App Strategy

All clients consume the same API + WebSocket surface:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   01_WEB    │  │ 02_DESKTOP  │  │ 03_MOBILE   │
│  React SPA  │  │  Electron   │  │ React Native│
│  Three.js   │  │  or Tauri   │  │  GL views   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────┬───────┴────────────────┘
                │
         SHARED/ SDK
         TypeScript types
         API client (Axios)
         Auth helpers
         Asset constants
                │
       ┌────────▼────────┐
       │   01_GATEWAY    │   REST + WSS
       │   port 5000     │
       └─────────────────┘
```

The `02_CLIENTS/SHARED/` folder holds cross-platform code:
- **TypeScript interfaces** (`StarSystemFull`, `Persona`, etc.)
- **API client factory** (same `axios` wrapper, different base URLs)
- **Auth token management** (when JWT auth is added)
- **Asset manifests** (spectral color tables, shader constants)

---

## Security Model (Planned)

| Layer | Mechanism |
|-------|-----------|
| **Transport** | HTTPS everywhere (Let's Encrypt / ACM) |
| **AuthN** | JWT tokens (access + refresh) via dedicated auth service |
| **AuthZ** | Persona-based RBAC already implemented (8 roles) |
| **Session** | HttpOnly secure cookies + server-side session store |
| **Secrets** | `.env` files today → AWS Secrets Manager / Vault in prod |
| **CORS** | Whitelist of known client origins |
| **Rate Limit** | Flask-Limiter on public endpoints |
