# 05 — Clients Architecture

## Multi-Platform Strategy

ExoMaps is designed for multiple client form factors sharing a common API surface,
visual language, and shader library. All clients live under `02_CLIENTS/` with
platform-specific code isolated and shared code extracted.

```
02_CLIENTS/
├── 01_WEB/        React / TypeScript / Three.js SPA          ← LIVE
├── 02_DESKTOP/    Tauri + wry WebView + native GPU layer      ← PLANNED
├── 03_MOBILE/     React Native with reduced GL views          ← PLANNED
└── SHARED/        Cross-platform: types, API SDK, shaders     ← PLANNED
```

---

## Shared Layer (`02_CLIENTS/SHARED/`)

The foundation of multi-client architecture. Code here is consumed by **all**
clients via workspace symlinks or npm workspace packages.

### Shared Modules

```
SHARED/
├── types/
│   ├── api.ts              StarSystemFull, Planet, Belt, etc.
│   ├── simulation.ts       Tick, Event, Faction types
│   └── persona.ts          User/persona graph types
├── api/
│   ├── client.ts           Axios/fetch factory with retry + cache
│   └── websocket.ts        Socket.IO wrapper for real-time sync
├── shaders/
│   ├── starShaders.glsl    Star field vertex + fragment (GLSL 300 es)
│   ├── planetShaders.glsl  Procgen planet palettes + ring shader
│   ├── atmosphereShaders.glsl  Atmospheric scattering (desktop-tier)
│   └── common.glsl         Shared: noise functions, teffToColor, etc.
├── constants/
│   ├── spectral.ts         Harvard spectral classification table
│   ├── colors.ts           Theme palette (dark mode tokens)
│   └── physics.ts          AU_TO_KM, PC_TO_LY, G, Stefan-Boltzmann, etc.
├── utils/
│   ├── commonNames.ts      Star name resolver (Bayer, Flamsteed, common)
│   ├── deterministic.ts    Seeded PRNG for procedural consistency
│   └── orbital.ts          Kepler solver, Hill sphere, Roche limit
└── assets/
    ├── textures/            Shared texture atlases (planets, noise LUTs)
    └── models/              Low-poly fallback meshes
```

### Shader Sharing Strategy

GLSL shaders are the most critical shared asset. Strategy:

1. **Write once in GLSL 300 es** — compatible with WebGL2, Vulkan/SPIR-V
   transpile, Metal (via SPIRV-Cross), and desktop OpenGL 3.3+
2. **Platform-specific wrapper** — each client imports the raw GLSL string
   and wraps it for its renderer (Three.js ShaderMaterial, wgpu, etc.)
3. **Preprocessor defines** — `#ifdef DESKTOP` / `#ifdef WEB` / `#ifdef MOBILE`
   to gate quality tiers at compile time
4. **Noise LUT textures** — bake 3D Perlin/Simplex into texture atlases
   rather than computing in-shader on mobile

```
// Example: shared shader import in web client
import { starVertexShader, starFragmentShader } from 'exomaps-shared/shaders/starShaders';

// Example: desktop client loads same GLSL, adds #define DESKTOP
const desktopVert = `#version 300 es\n#define DESKTOP\n` + starVertexGLSL;
```

---

## 01_WEB — React SPA (Live)

The primary client. A single-page application that renders an interactive 3-D
star field with real astronomical data from the pipeline.

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript 5.9 |
| 3-D | Three.js 0.183 + React Three Fiber 9.5 + Drei 10.7 |
| Routing | React Router 7 |
| HTTP | Axios 1.13 |
| Shaders | Custom GLSL (vertex + fragment) |
| Build | Create React App (react-scripts 5) |

### Component Tree

```
App.tsx
├── TopNav                     Persona selector + navigation
├── Routes
│   ├── /           → StarMapPage
│   │                   └── StarMap
│   │                        ├── Sol (pulsing golden marker)
│   │                        ├── StarField (GPU instanced points)
│   │                        ├── StarFootprints (XY plane connectors)
│   │                        ├── FootprintDots (plane projection dots)
│   │                        ├── GalacticGrid + GalacticPlane
│   │                        ├── DistanceShell × 4
│   │                        ├── CameraController (fly-to + top-down mode)
│   │                        ├── HUD: Census + Legend + View Toggle
│   │                        └── SelectedStarPanel
│   │                             └── SystemDetailPanel (multi-star tabs)
│   │                                  └── OrreryScene (R3F sub-canvas)
│   ├── /system/:id → SystemViewerPage (fullscreen orrery)
│   ├── /admin      → AdminPage
│   ├── /simulation → SimulationPage
│   └── /data-qa    → DataQAPage
```

### Star Rendering Pipeline (WebGL2 + Custom GLSL)

Stars are rendered as **GPU-instanced points** with custom shaders — not individual
mesh objects. This allows 1,800+ stars at 60 fps with per-star visual effects.

```
/api/world/systems/full
        │
        ▼
Build Float32 attribute buffers
  • position (x, y, z)       3 floats per star
  • luminosity                1 float
  • teff (temperature)        1 float
  • multiplicity              1 float
  • confidence                1 float
        │
        ▼
THREE.Points + ShaderMaterial
  • Vertex: billboard sizing by distance + luminosity + focus dimming
  • Fragment: spectral color, bloom, twinkle, binary rings, focus fade
  • Blending: additive (stars glow through each other)
  • Uniforms: uFocusCenter, uFocusRadius (neighborhood dimming)
```

### Camera System

| Mode | Behavior |
|------|----------|
| **Perspective** | Default oblique 3D view, starts focused on Sol ~15 ly neighborhood |
| **Top-down (XY)** | Overhead galactic plane view, orbital rotation locked to near-zero polar angle |
| **Fly-to** | Cubic ease-out lerp to selected star with offset approach vector |

### Spectral Color Mapping

The fragment shader converts effective temperature (Teff in Kelvin) to approximate
sRGB color using a blackbody curve approximation:

| Class | Teff (K) | Visual | Hex |
|-------|----------|--------|-----|
| O | 30,000+ | Blue-violet | `#9bb0ff` |
| B | 10,000–30,000 | Blue-white | `#aabfff` |
| A | 7,500–10,000 | White | `#cad7ff` |
| F | 6,000–7,500 | Yellow-white | `#f8f7ff` |
| G | 5,200–6,000 | Yellow (Sol) | `#fff4ea` |
| K | 3,700–5,200 | Orange | `#ffd2a1` |
| M | 2,400–3,700 | Red-orange | `#ffcc6f` |
| L/T | < 2,400 | Deep red | `#ff6633` |

### Shader Effects

| Effect | Implementation |
|--------|---------------|
| **Spectral glow** | Gaussian radial gradient colored by Teff |
| **Corona** | Bright white core fading to spectral-colored halo |
| **Twinkle** | Per-star sin/cos oscillation seeded by position |
| **Binary ring** | Blue ring at 37% radius for multiplicity ≥ 2 |
| **Trinary ring** | Green ring at 55% radius for multiplicity ≥ 3 |
| **Distance fog** | Stars > 60 pc fade toward deep blue |
| **Confidence dim** | Inferred stars reduced size + dashed edge halo |
| **Focus dimming** | Stars outside ~15 ly neighborhood fade in size + alpha |
| **Sol beacon** | Unique pulsing golden sphere at origin |

### Galactic Plane Features

| Feature | Description |
|---------|-------------|
| **XY Plane** | Semi-transparent `#0e2244` plane at y=0 (opacity 0.12) |
| **Star footprints** | Thin vertical line from each star to its XY projection |
| **Footprint dots** | Tiny cyan point at each star's (x, 0, z) position |
| **Grid overlay** | Subtle Cartesian + polar grid, auto-fades with camera height |

---

## 02_DESKTOP — Tauri + Native GPU (Planned)

### Why Tauri over Electron

| Factor | Electron | Tauri |
|--------|----------|-------|
| Binary size | ~120 MB | ~5 MB |
| Memory | ~200 MB baseline | ~30 MB baseline |
| GPU access | Via Chromium WebGL only | wry WebView + native GPU sidecar |
| Backend | Node.js | Rust (performance, safety) |
| Hot reload | Yes | Yes (WebView) |
| OS integration | Good | Better (native menus, tray, file dialogs) |

### Architecture

```
02_DESKTOP/
├── src-tauri/
│   ├── main.rs              Tauri bootstrap + IPC commands
│   ├── gpu/
│   │   ├── renderer.rs      wgpu/Vulkan renderer for planet generation
│   │   ├── compute.rs       GPU compute shaders for atmosphere sim
│   │   └── shared_memory.rs SharedArrayBuffer bridge to WebView
│   ├── simulation/
│   │   ├── atmosphere.rs    Radiative transfer, GCM approximation
│   │   ├── composition.rs   Bulk silicate / iron / volatile fractions
│   │   └── geology.rs       Tectonic regime, volcanism, cryovolcanism
│   └── cache/
│       └── world_state.rs   Offline world-state cache (SQLite)
├── src/                     WebView UI (reuses 01_WEB React components)
│   ├── App.tsx
│   ├── hooks/useTauriGPU.ts IPC bridge to native GPU renderer
│   └── components/          Desktop-specific UI (multi-viewport, etc.)
└── shared-textures/         High-res texture atlases (>web size budget)
```

### Hybrid Rendering Model

The desktop client uses a **dual-renderer** approach:

1. **WebView (wry)** — Renders the React UI, star map, and 2D panels using
   the same web codebase. Chromium's WebGL2 handles the star field.

2. **Native GPU sidecar (wgpu)** — Dedicated compute + render pipeline for:
   - High-fidelity procedural planet generation (see below)
   - Atmosphere simulation (radiative transfer)
   - Volumetric effects (nebulae, protoplanetary discs)
   - Terrain heightfield generation at km-scale resolution

Communication between WebView and GPU sidecar via Tauri IPC (command
invocations returning serialized buffers or shared textures).

### Procedural Planet Generation (Desktop-tier)

Not random — **procedural and physically simulated**. Each planet is deterministically
generated from its orbital + stellar parameters using scientific models.

#### Generation Pipeline

```
Star Parameters (Teff, L, age, metallicity)
  +  Planet Parameters (mass, sma, eccentricity)
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  1. BULK COMPOSITION                     │
  │     Iron/silicate/volatile fractions     │
  │     from mass + formation distance        │
  │     (Zeng et al. 2019 mass-radius)       │
  ├─────────────────────────────────────────┤
  │  2. ATMOSPHERE MODEL                     │
  │     • Equilibrium temperature from L, a  │
  │     • Bond albedo from composition       │
  │     • Greenhouse effect (CO2, H2O, CH4) │
  │     • Scale height, surface pressure     │
  │     • Rayleigh scattering color          │
  ├─────────────────────────────────────────┤
  │  3. SURFACE / TERRAIN                    │
  │     • Tectonic regime from mass + age    │
  │     • Multi-octave noise heightfield     │
  │     • Crater density from age + atm      │
  │     • Ocean coverage if T_surf ∈ [273,373]│
  ├─────────────────────────────────────────┤
  │  4. GPU TEXTURE SYNTHESIS               │
  │     • Compute shader: noise → heightmap  │
  │     • Compute shader: heightmap → albedo │
  │     • Compute shader: atmosphere LUT     │
  │     • Render: planet sphere + atm shell  │
  └─────────────────────────────────────────┘
```

#### TRAPPIST-1 Test Case

TRAPPIST-1 is the ideal validation target — 7 known planets, well-characterized:

| Planet | Mass (M⊕) | Radius (R⊕) | Flux (S⊕) | Expected Surface |
|--------|-----------|-------------|-----------|-----------------|
| b | 1.37 | 1.12 | 4.25 | Magma ocean / tidally locked |
| c | 1.38 | 1.10 | 2.27 | Venus-like thick atm |
| d | 0.39 | 0.79 | 1.14 | Thin atm, possible water |
| e | 0.69 | 0.92 | 0.66 | **Best HZ candidate**, ocean? |
| f | 1.04 | 1.05 | 0.38 | Cold, possible subsurface ocean |
| g | 1.32 | 1.13 | 0.26 | Ice giant surface |
| h | 0.33 | 0.78 | 0.13 | Frozen, minimal atm |

The desktop generator should produce visuals that match these expectations
without hardcoding — the physics pipeline alone should yield magma-world → temperate
→ ice-world gradient across the system.

### "Game" Mode — Single-System Focus

The desktop client supports a **focused game mode** where a single star system
is the active gameplay arena while the full 100-parsec map remains navigable:

```
┌─────────────────────────────────────────────────┐
│                  SERVER (Flask)                   │
│  Full 100-parsec world: 1,631 systems            │
│  Simulation engine: faction ticks, economy        │
│  API: /api/world/*, /api/system/*, /simulation/* │
└──────────────┬──────────────────────────┬────────┘
               │                          │
    ┌──────────▼──────────┐    ┌──────────▼──────────┐
    │    WEB CLIENT        │    │   DESKTOP CLIENT     │
    │  Full map overview   │    │  Full map + focused  │
    │  Panel-level detail  │    │  system at GPU-tier  │
    │  Lightweight orrery  │    │  Procedural planets  │
    │                      │    │  Atmosphere sim      │
    │                      │    │  "Game" plays here   │
    └──────────────────────┘    └──────────────────────┘
```

---

## Cosmosium Heritage — Ideas Borrowed (Not Implementation)

ExoMaps is inspired by the Cosmosium project (rSimulate/Cosmosium), but uses
entirely original implementation. Key conceptual borrowings:

### From Cosmosium

| Concept | Cosmosium Approach | ExoMaps Adaptation |
|---------|-------------------|-------------------|
| **Asteroid rendering** | LOD spheres with lambert shaders, per-asteroid orbit elements, 600K+ streamed from Asterank DB | Procedural particle belts with instanced points, deterministic from star params, no external DB required |
| **Camera controls** | OrbitControls with target tracking, dual near/far cameras for depth precision, bokeh depth-of-field | CameraController with fly-to animation, focus dimming via shader, top-down mode toggle |
| **Skybox** | Sphere geometry with ESO milky way texture + custom shader | Three.js Stars (drei) particles at multiple depths for parallax, no texture dependency |
| **Vision / fog-of-war** | Not implemented in Cosmosium, but planned as faction-based visibility | Focus-radius dimming in star shader (smooth falloff), future: per-faction visibility masks |
| **Factions / ownership** | Player color applied to asteroid mesh emissive uniform, per-object ownership tracking | PLANNED: Faction system via personas + simulation engine, color-coded territory overlays on star map |
| **Object hierarchy** | Scene graph: Sun → planet meshes → moon meshes, parent attachment/detachment | React component tree: StarField → SelectedStarPanel → SystemDetailPanel → OrreryScene |
| **Orbit rendering** | Orbit3D class with Keplerian elements, ellipse geometry, JED-based animation | Elliptical orbit rings from eccentricity, angle-based animation in useFrame |
| **Trajectory visualization** | Lambert solver (PyKEP), green trajectory lines with endpoint markers | PLANNED: Transfer orbit visualization for desktop "game" mode |

### New in ExoMaps (Not in Cosmosium)

- GPU-instanced star field with GLSL spectral color mapping (1,600+ stars)
- Procgen planet shaders (6 planet types, ring systems)
- Multi-star system group API with hierarchy inference
- Protoplanetary disc inference engine
- Data pipeline from real SIMBAD + NASA Exoplanet Archive
- Top-down galactic plane view with star footprints
- Focus-neighborhood dimming

---

## 03_MOBILE — React Native (Planned)

A slimmed-down, **menu-driven** experience optimized for phone form factor.
Visuals are secondary to data accessibility and quick lookups.

### Design Philosophy

- **No full 3D star map** — too expensive on mobile GPUs, too fiddly on touch
- **2D projected map** — top-down scatter plot of the XY plane, touch to pan/zoom
- **Card-based drill-down** — tap star → system card → planet list → planet detail
- **Search-first UX** — prominent search bar, autocomplete, recent history
- **Offline support** — cached star catalog + planet data for subway/flight use

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.76+ |
| Navigation | React Navigation 7 |
| 2D Map | react-native-svg or Skia for scatter plot |
| State | Zustand (shared with web) |
| HTTP | Shared API client from SHARED/ |
| Offline | AsyncStorage + SQLite (expo-sqlite) |

### Screen Flow

```
┌──────────────────────┐
│  ★ Home               │  Featured system, search bar, history
│  ┌────────────────┐   │
│  │  🔍 Search...   │   │
│  └────────────────┘   │
│  ┌─────┐ ┌─────┐     │
│  │ Sol  │ │Alpha│     │  Recent / favorites
│  │      │ │Cent.│     │
│  └─────┘ └─────┘     │
│  ┌────────────────┐   │
│  │ 2D Sky Map ◎   │   │  Top-down scatter (simplified)
│  │  · · ·☉· · ·   │   │
│  │  ·  · · ·  ·   │   │
│  └────────────────┘   │
└──────────────────────┘
         │ tap star
         ▼
┌──────────────────────┐
│  ☉ Proxima Centauri   │  System card
│  M5.5V · 4.24 ly     │
│  ─────────────────    │
│  🌍 Planets (2)       │
│  ├ Proxima b  rocky... │
│  └ Proxima c  super...│
│  ─────────────────    │
│  ★ System Stars (3)   │
│  ├ α Cen A  (G2V)    │
│  ├ α Cen B  (K1V)    │
│  └ Proxima  (M5.5V)  │
│  ─────────────────    │
│  ⛶ SIMBAD · ↗ Share  │
└──────────────────────┘
         │ tap planet
         ▼
┌──────────────────────┐
│  🌍 Proxima Centauri b │  Planet detail
│  Rocky · 1.07 M⊕     │
│  ─────────────────    │
│  SMA: 0.049 AU        │
│  Period: 11.2 days    │
│  Temperature: ~234 K  │
│  ─────────────────    │
│  Moons: 2 inferred    │
│  ├ Moon-1 (0.005 M⊕) │
│  └ Moon-2 (0.002 M⊕) │
└──────────────────────┘
```

### Data Budget

Mobile optimization targets:
- Initial bundle: < 5 MB (no 3D libraries)
- Offline star catalog: ~2 MB (compressed JSON)
- Planet detail cache: ~500 KB per 100 systems
- Image assets: SVG icons + procedural color swatches (no textures)

---

## Cross-Client Communication

### API Surface (Shared)

All clients consume the same REST + WebSocket API. No client-specific endpoints.

```
GET  /api/world/systems/full     All 1,631 systems
GET  /api/system/<main_id>       Single-star planetary system
GET  /api/system-group/<name>    Multi-star group (all stars + planets)
GET  /api/systems/planets/summary Planet population stats
GET  /health                      Service health
POST /simulation/:id/start        Start simulation tick
WS   /ws/world                    Real-time world state updates (planned)
```

### State Synchronization (Planned with 04_MESSAGING)

```
Web Client  ──WSS──┐
                    │     ┌──────────────┐
Desktop     ──WSS──┼────▶│ 04_MESSAGING  │──▶ 03_WORLD_ENGINE
                    │     │ (Socket.IO)  │
Mobile      ──WSS──┘     └──────────────┘
```

**Sync model:**
- **Simulation ticks** broadcast to all connected viewers
- **Cursor positions** relayed for collaborative map exploration
- **Annotations** (bookmarks, labeled systems) persisted and shared
- **Conflict resolution** via server-authoritative tick ordering
- **Faction state** — territory claims, resource flows, fleet positions

---

## Faction System (Planned)

Borrowing the Cosmosium concept of object ownership, ExoMaps will implement a
**faction/civilization** layer:

### Data Model

```typescript
interface Faction {
  id: string;
  name: string;
  color: string;           // hex for map overlay
  home_system: string;     // main_id of origin star
  controlled_systems: string[];
  tech_level: number;      // 1-10 scale
  expansion_rate: number;  // systems per century
  vision_radius_ly: number; // fog-of-war radius
}
```

### Vision Model

Each faction has a `vision_radius_ly` that determines what they can observe:
- **Full vision**: Systems within radius — full spectral + planet data
- **Partial vision**: Systems at 1-2x radius — star exists but no planet detail
- **No vision**: Beyond 2x radius — stars not visible (fog of war)

The star shader already supports focus-radius dimming. Faction vision would
extend this by replacing `uFocusCenter/uFocusRadius` with per-faction
visibility buffers uploaded as a texture or SSBO.

---

## Platform Priority & Timeline

| Phase | Client | Status | Key Milestone |
|-------|--------|--------|--------------|
| 1 | Web (01_WEB) | **LIVE** | Full 3D star map, planetary system viewer, fullscreen mode |
| 2 | Shared SDK | PLANNED | Extract types, API, shaders to SHARED/ |
| 3 | Desktop (02_DESKTOP) | PLANNED | Tauri scaffold, WebView reuse, GPU planet gen prototype |
| 4 | Mobile (03_MOBILE) | PLANNED | RN scaffold, 2D map, card-based drill-down |
| 5 | Desktop GPU | PLANNED | wgpu compute shaders, atmosphere sim, TRAPPIST-1 validation |
| 6 | Game mode | PLANNED | Single-system focus, faction system, real-time multiplayer |
