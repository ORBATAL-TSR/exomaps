# Roadmap & Build Plans

Active priorities for the VITA client and backend. Updated 2026-03.

---

## Current State (March 2026)

### VITA — Active
- Procedural planet renderer v5 (solid + gas, zones, atmosphere, icebergs, aurora)
- SystemFocusView: depth-drill orrery (system → planet → moon → belt → asteroid)
- OrreryComponents: OrreryStar, OrreryBody, LODPlanet, PotatoMoon, RingParticles, all zone overlays
- CampaignPanel: faction management
- AdminPanel + SimPanel: dev drawer via GpuStatusBar ⚙
- LAN server: Caddy + Gunicorn + mkcert (07_LOCALRUN)
- Loading screen with shader warmup (TDR prevention)

### Backend — Active
- Flask gateway: all API endpoints live
- PostgreSQL 3-schema: stg_data / dm_galaxy / app_simulation
- Pipeline phases 01–03 operational; phase 04 simulation tick functional
- Campaign + faction endpoints live

### Parked
- OMICRON (Rust/wgpu) — see below
- WEB client (React/Three.js) — archived to Z_deprecate/01_WEB, use as reference

---

## Near-Term Priorities

### Renderer
- [ ] Ring system polish (RingSystem.tsx — shadows, Mie scattering through rings)
- [ ] Cloud layer volumetric depth (CloudLayer.tsx — currently flat billboard)
- [ ] Aurora shader (AuroraField.tsx — particle field, magnetic field lines)
- [ ] Volcano field (VolcanoField.tsx — lava glow, ash plume particles)
- [ ] Crater field (CraterField.tsx — triplanar normal-mapped craters)
- [ ] Feature shaders in `world/shaders/features/` — isolate sub-features from solid.frag.ts
- [ ] Index into `worldtypes/` per planet class — split monolithic WORLD_FRAG

### VITA Client
- [ ] LoadingScreen.tsx — progress bar wired to `onLoadStage` + `onSubProgress`
- [ ] `useActivePlanetPreload.ts` — background-preload next likely planet
- [ ] Scene persistence (`public/scenes/`) — save/restore orrery camera state
- [ ] Iceberg field (IcebergField.tsx) — promote from inline shader to standalone component

### Backend / Data
- [ ] Phase 04 simulation: tick validation + event emission
- [ ] Campaign save/load persistence (app_simulation)
- [ ] `/api/system/<id>` — moons endpoint (currently stubs)
- [ ] Planet suitability score endpoint (life potential, habitability index)
- [ ] Mineral value system per asteroid/belt

---

## Feature Backlog (Game Design Layer)

### Economy
- Planetary economy: resource extraction rates, trade routes, price dynamics
- Per-system GDP, trade surplus/deficit
- Production chain simulation in `app_simulation`

### Ships & Missions
- Mission planning UI: departure window, delta-v budget, transit time
- Ship assembly modal: module selection + mass/cost preview
- Fleet management: multiple ships per system, task assignment

### Colony
- Colony governance: local autonomy vs. central policy sliders
- Population growth model: birth rate, immigration, life support capacity
- Technology tree: research points, unlock tree

### Campaign
- Fog-of-war: `useActivePlanetPreload` + exploration state
- Faction diplomacy UI (currently data-only via api.ts)
- Narrative events system (dynamic text events triggered by sim state)

---

## OMICRON (Rust/wgpu — Parked)

Location: `Z_deprecate/03_OMICRON/`. Compiles and runs.

**Current:** ClearPass → StarFieldPass → StarPass (Sol sphere)
- StarFieldPass: instanced billboards, spectral color, twinkling, multiplicity rings
- StarPass: PBR Sol sphere, limb darkening, granulation, corona, chromosphere
- WGSL (naga 0.20); wgpu 0.20, winit 0.29

**Roadmap if reactivated:**

| Phase | Feature |
|-------|---------|
| 3 | Real star data from gateway API |
| 4 | Click picking + camera fly-to |
| 5 | OrreryPass — planets, moons, belts, HZ |
| 6 | PlanetPass — PBR Cook-Torrance + Rayleigh/Mie atmo |
| 7 | PostPass — bloom + Reinhard HDR |
| 8 | egui overlay — system info panel |
| 9 | StarLanes + CompanionBonds |
| 10 | Texture-based planets (VITA library) |

**Gotchas:**
- naga 0.20: no runtime array indexing — use `select()` chains
- `VertexState` + `FragmentState` need `compilation_options: Default::default()`
- Star uniform binding 1 needs `VERTEX | FRAGMENT` visibility
- `draw(0..6, 0..instance_count)` — no per-vertex buffer, instance step_mode only
