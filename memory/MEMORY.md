# ExoMaps — Project Memory

## What This Is
Interstellar colonization sim. All real stars within 100 parsecs + inferred planets.
Two layers: scientific reality (real data) + simulated reality (colonies, trade, politics).

## Key Directories
- `03_OMICRON/` — Rust-native rendering engine (wgpu/Vulkan/WGSL). Currently skeleton stubs only.
- `02_CLIENTS/02B_OMICRON/` — Tauri shell for OMICRON desktop client. Skeleton (no src/ yet).
- `02_CLIENTS/02_VITA/` — TypeScript/React client with full component set (panels, planet views, etc).
- `02_CLIENTS/02_DESKTOP/` — OLD desktop client, staged for deletion.
- `00_ARCHITECTURE/` — Full architecture docs (system overview, component arch, services, etc).
- `01_SERVICES/` — Backend: gateway (Flask), pipeline, world engine, messaging.
- `03_DATA/` — Raw CSVs (SIMBAD, NASA), schemas, migrations, seeds.

## Tech Stack
- Renderer: Rust + wgpu + WGSL (Vulkan/DX12/Metal)
- Desktop shell: Tauri 2.x + egui overlays
- Backend: Python 3.13 + Flask + PostgreSQL 17
- Web client: React 19 + TypeScript + Three.js / R3F
- Data: SIMBAD + NASA Exoplanet Archive → stg_data → dm_galaxy → app_simulation

## OMICRON Engine State (as of 2026-03-10)
All files are stubs — no real implementation yet:
- `src/renderer.rs`: empty Renderer struct
- `src/geometry.rs`: empty quadsphere/belt stubs
- `src/simulation.rs`: empty WorldGen struct
- `src/ui.rs`: empty draw_overlay()
- `src/shaders/star.wgsl`: skeleton with placeholders (limb, granulation, corona all `...`)

## Product Role
Acting as product lead. See `03_OMICRON/OMICRON_ROADMAP.md` for the master plan.

## User Preferences
- Maximum cool factor + realistic VFX is the primary design mandate
- Science-first: real data takes priority, inferred always tagged
- GPU-first, multi-threaded, adaptive LOD
