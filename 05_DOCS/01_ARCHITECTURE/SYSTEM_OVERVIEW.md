# System Overview

ExoMaps — real-data 3D star map layered with an interstellar civilization simulator.
1,796 stellar systems within ~100 LY. Hard sci-fi. "It's not a game — it's a living map."

---

## Directory Structure

```
exomaps/
├── 01_SERVICES/
│   ├── 01_GATEWAY/          Flask API + SPA host (app.py)
│   └── 02_PIPELINE/
│       ├── 01_INGEST/       CSV → staging DB
│       ├── 02_TRANSFORM/    Parallax → XYZ, RA/Dec → Cartesian
│       ├── 03_INFERENCE/    Titius-Bode system completion
│       ├── 04_SIMULATION/   SFTL civilization tick engine
│       └── SHARED/          Config, DB, logging, service discovery
├── 02_CLIENT/
│   └── VITA/                PRIMARY CLIENT — Tauri + React Three Fiber
├── 03_DATA/
│   ├── 01_SOURCES/          Raw CSVs (EXOPLANETS_01.csv, SIMBAD_01/02/03.csv)
│   ├── 02_SCHEMAS/          DDL definitions
│   ├── 03_MIGRATIONS/       Versioned: 001–007 (007 = stellar_enrichment, current)
│   └── 04_SEEDS/            Test fixtures
├── 04_INFRA/                Docker Compose, CI/CD
├── 05_DOCS/                 ← you are here
├── 06_TOOLS/                Texture gen, economy sim scripts
├── 07_LOCALRUN/             LAN server — Caddy + Gunicorn + mkcert (gitignored)
└── Z_deprecate/
    ├── 01_WEB/              React 19 + Three.js browser client (reference only)
    ├── 03_OMICRON/          Rust/wgpu renderer (parked)
    ├── 03_MOBILE/           Scaffold only (parked)
    ├── SHARED/              Cross-client SDK (internalized into VITA)
    └── docs/                Pre-consolidation documentation archive
```

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Python 3.13, Flask 3.x | app.py in 01_GATEWAY/ |
| ORM | SQLAlchemy 2.x | |
| Database | PostgreSQL 17 | 3-schema design (stg_data / dm_galaxy / app_simulation) |
| Frontend | TypeScript 5.9, React 19 | |
| 3D engine | Three.js 0.183 + @react-three/fiber 9.5 | |
| Desktop runtime | Tauri 2.10 | wgpu → Vulkan/DX12/Metal |
| Build | Vite 5.x + esbuild | manualChunks splits vendor-react/three/r3f |
| LAN proxy | Caddy (HTTPS/HTTP2) + Gunicorn (gthread) | 07_LOCALRUN/ |

---

## Data Flow

```
CSV Sources
  → Phase 01 (Ingest)      → stg_data.ingest_runs / validation_quarantine
  → Phase 02 (Transform)   → dm_galaxy.stars_xyz (Cartesian XYZ)
  → Phase 03 (Inference)   → dm_galaxy.inferred_planets / inferred_belts
  → Phase 04 (Simulation)  → app_simulation.system_state per tick

Gateway (Flask)
  → /api/world/systems/full  → VITA SystemFocusView (full render payload)
  → /api/system/<id>         → per-system detail (planets, belts, moons)
  → /api/simulation/*        → tick controls, snapshots, events
```

---

## Active Client: VITA

Entry point: `02_CLIENT/VITA/src/`

```
App.tsx              → DesktopLayout or mobile fallback
DesktopLayout.tsx    → GpuStatusBar + route to SystemFocusView / PlanetGenCard
SystemFocusView.tsx  → depth-drill orrery (system → planet → moon → belt)
OrreryComponents.tsx → all sub-components extracted from SFV (3,400+ lines)
world/ProceduralWorld.tsx → GPU planet renderer (wires all GLSL uniforms)
world/shaders/       → GLSL strings (noise.ts, solid.frag.ts, vert.ts, atm.ts)
```

---

## Launch Commands

```bash
# Local dev (build + Flask + vite preview on :1420)
bash LAUNCH.sh

# Skip rebuild
bash LAUNCH.sh --skip-build

# LAN mode (Caddy + Gunicorn — requires 07_LOCALRUN/setup.sh done once)
bash LAUNCH.sh --lan

# Install as system service (auto-start on boot)
bash 07_LOCALRUN/rundaily.sh
```

API health: `http://localhost:5000/api/health`
Client: `http://localhost:1420` (local) or `https://<LAN_IP>` (LAN mode)
