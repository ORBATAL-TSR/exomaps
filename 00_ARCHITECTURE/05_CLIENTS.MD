# 05 — Clients Architecture

## Multi-Platform Strategy

ExoMaps is designed for multiple client form factors sharing a common API surface,
visual language, and shader library. All clients live under `02_CLIENTS/` with
platform-specific code isolated and shared code extracted.

```
02_CLIENTS/
├── 01_WEB/        React / TypeScript / Three.js SPA          ← LIVE
├── 02_DESKTOP/    Tauri 2.10 + R3F + GLSL procedural worlds  ← LIVE (primary)
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

## 02_DESKTOP — Tauri 2.10 + React Three Fiber (Live)

The **primary development client** as of March 2026. A native desktop application
built on Tauri 2.10 with the full React UI running in a wry WebView. All 3D
rendering uses React Three Fiber + custom GLSL shaders in WebGL2. The wgpu/Vulkan
backend handles window management and GPU surface allocation.

### Why Tauri over Electron

| Factor | Electron | Tauri 2.10 |
|--------|----------|------------|
| Binary size | ~120 MB | ~5 MB |
| Memory | ~200 MB baseline | ~30 MB baseline |
| GPU access | Chromium WebGL only | wry WebView + wgpu/Vulkan surface |
| Backend | Node.js | Rust (performance, safety) |
| Hot reload | Yes | Yes (Vite HMR via WebView) |
| OS integration | Good | Better (native menus, tray, file dialogs) |

### Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Tauri | 2.10 |
| GPU backend | wgpu | Vulkan (GTX 1080 tested) |
| WebView | wry | System WebKitGTK (Linux) |
| Framework | React + TypeScript | 19 + 5.9 |
| 3-D | Three.js + R3F + drei | 0.183 / 9.5 / 10.7 |
| Build | Vite | 5.4.14 |
| Dev URL | localhost:1420 | — |
| API backend | Flask | 3.x on :5000 |

### Architecture

```
02_DESKTOP/
├── src-tauri/
│   ├── src/main.rs          Tauri bootstrap + window config
│   ├── Cargo.toml           Rust dependencies
│   └── target/debug/        Dev binary (exomaps-desktop)
├── src/                     WebView UI (React + R3F)
│   ├── App.tsx              Root module, React Router
│   ├── components/
│   │   ├── SystemFocusView.tsx   ★ Main system explorer (~2900 LOC)
│   │   ├── ProceduralPlanet.tsx  ★ GLSL planet renderer (~2400 LOC)
│   │   ├── ColonyOverlay.tsx     Colony buildings, roads, GLB models
│   │   ├── ColonyTerrain.ts      Heightfield, A* pathfinding, territory
│   │   ├── StarMap.tsx           Instanced star field (1,600+ stars)
│   │   └── ...
│   ├── hooks/                React hooks for state, API, camera
│   └── styles/               CSS modules
├── public/                   Static assets
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Rendering Model

All rendering happens in the wry WebView via WebGL2. No Rust-side GPU sidecar.
Three.js `ShaderMaterial` with custom GLSL handles all procedural generation.

```
Flask API (:5000)
     │  /api/system/<id>  /api/world/systems/full
     │
     ▼
React State (system data, planets, moons, belts)
     │
     ▼
SystemFocusView.tsx — Camera, orrery, depth navigation, UI
     │
     ├─── StarMap.tsx (instanced points, spectral GLSL)
     ├─── ProceduralPlanet.tsx (per-planet GLSL sphere)
     ├─── ColonyOverlay.tsx (buildings, roads on colonies)
     └─── ColonyTerrain.ts (heightfield, pathfinding)
```

### SystemFocusView — Multi-Depth Explorer

The system explorer uses a **depth-based navigation model** where the camera
and UI adapt to the current viewing level:

| Depth | View | Camera | Content |
|-------|------|--------|---------|
| `system` | Full star system | Overhead orrery | All planets as spheres on orbital tracks |
| `planet` | Planet + moon system | Close-up planet orrery | Planet at center, moons orbiting |
| `surface` | Planet surface | Fixed close sphere | Full GLSL terrain, atmosphere |
| `colony` | Colony overlay | Top-down colony view | Buildings, roads, territory zones |

Navigation via sidebar tree (star → planets → moons) or breadcrumb bar.
**Star name in sidebar now clickable** — returns to system-level view.

### Collision-Aware Moon Layout

Moon orrery positions are computed by `layoutMoonOrbits()`:
1. Sort moons by real orbital radius
2. Map to logarithmic scene-space positions (k = 6/maxAU, spread = 1.4)
3. Enforce minimum separation = sum of visual radii + 0.06 gap
4. Push apart overlapping moons outward
5. `detectResonance()` helper identifies orbital resonance patterns (2:1, 3:2, etc.)

### Tidal Lock Filtering

Tidally locked planets realistically have no significant moons (Roche limit
disruption over Gyr timescales):
- Moon list filtered to only `captured-irregular` moons with radius < 0.003 R⊕
- Sidebar moon badge suppressed for tidally locked planets

---

### ProceduralPlanet — GLSL Procedural Generation

Each planet is a `<mesh>` with custom `ShaderMaterial` (vertex + fragment GLSL).
No textures — everything is procedurally generated from orbital/stellar parameters.

#### Planet Type Profiles

40+ planet type profiles defined in the `V` record, covering:

| Category | Types |
|----------|-------|
| Rocky | Mercury-like, Mars-like, Earth-like, Venus-like, super-Earth |
| Sub-Earth | Barren, thin-atm, icy |
| Volatile | Ocean world, water world |
| Gas | Mini-Neptune, sub-Neptune, Neptune-like, warm Neptune |
| Giant | Hot Jupiter, warm Jupiter, cold gas giant, super-Jupiter |
| Dwarf / Ice | Pluto-like, Kuiper analogue, Oort body |
| Exotic | Lava world, carbon planet, iron planet, hycean |
| Tidally locked | Eyeball variants (hot, warm, cold) |

#### World Genome System

A 3-slot combinatorial system that generates visual diversity:

- **20 Surface Regimes** — volcanic, cratered, tectonic, eroded, glacial, etc.
- **11 Atmosphere Characters** — clear, hazy, stormy, banded, toxic, etc.
- **9 Hydrosphere States** — dry, scattered lakes, archipelago, deep ocean, etc.

Seed-deterministic slot selection. Genome parameters blend at 70% weight with
base profile values for unique per-planet appearances.

#### `deriveWorldVisuals()` Pipeline

The central function that translates physical parameters into GLSL uniforms:

```
Input: planetType, temperature, mass, tidalHeating, tidallyLocked,
       starLuminosity, orbitalRadius, seed

  ┌──────────────────────────────────────────┐
  │  1. BASE PROFILE LOOKUP (V record)       │
  │     40+ type profiles with defaults       │
  ├──────────────────────────────────────────┤
  │  2. WORLD GENOME BLEND (70% weight)      │
  │     Surface + Atmosphere + Hydrosphere    │
  ├──────────────────────────────────────────┤
  │  3. FROST-LINE COLD TRANSFORM            │
  │     temp < 200K → colors → ice-white/blue │
  │     Up to 85% override at 60K             │
  │     iceCaps → 0.95, volcanism suppressed   │
  ├──────────────────────────────────────────┤
  │  4. TERRAIN AGE DERIVATION               │
  │     mass/tidal/volcanism/temp → age 0-1   │
  │     Ancient: craters, erosion, weathering  │
  │     Young: smooth, volcanic, few craters   │
  ├──────────────────────────────────────────┤
  │  5. TECTONICS LEVEL DERIVATION           │
  │     Mass onset > 0.3 M⊕, tidal boost     │
  │     Drives: mountains, valleys, faults     │
  ├──────────────────────────────────────────┤
  │  6. HSV COLOR SHIFTS                      │
  │     Seed-deterministic hue/sat/val offsets │
  │     ±12° hue, ±0.12 sat, ±0.12 val        │
  └──────────────────────────────────────────┘

Output: PlanetVisuals (colors, uniforms, flags)
        → fed to GLSL ShaderMaterial
```

#### GLSL Shader Architecture

**Vertex Shader:**
- Multi-octave simplex noise heightfield
- Displacement: `(max(h, oceanLevel) - 0.5) * 0.055`
- Seed-consistent: `seed * 137.0`
- Crater, mountain, valley, volcanism displacement modifiers

**Fragment Shader — Terrain:**
- 6-biome palette blending based on elevation + latitude + slope
- Star-dependent vegetation overlay (M-star burgundy → G-star green → A-star golden)
- Vegetation suppression per biome (desert/ice/lava zones)

**Fragment Shader — Age & Tectonics (NEW):**
- `uTerrainAge` uniform: space-weathered darkening (ancient), micro-crater peppering,
  fresh volcanic flows (young), eroded mountain peaks
- `uTectonics` uniform: linear fault scarps, folded mountain textures at elevation,
  mountain/valley height modulation

**Fragment Shader — Tidally Locked Eyeball (conditional):**
- Substellar point: scorched/glassed surface at extreme heat
- Antistellar point: deep ice, nitrogen frost patches, cryovolcanic venting
- Terminator band: habitable-zone green/liquid (widened for realism)
- Ice mask coverage: starts at facing = 0.15, full at -0.65

**Fragment Shader — Ocean Depth Transparency (NEW):**
- Shallow water: semi-transparent, shows seafloor terrain beneath
- Deep water: opaque water color
- Blend: `waterOpacity = smoothstep(0.0, 0.35, depth)`
- Seafloor darkened by 0.75 factor for submarine look

**Fragment Shader — Other Effects:**
- Temperature-mapped mineral overlays (iron, silicate, water ice, KREEP, carbon)
- Cloud layer noise (density-driven)
- Ice cap polar regions
- Emissive glow for hot planets (T > 800K)

#### Atmosphere Rendering

**Standard atmosphere:** Single semi-transparent shell at radius 1.015 + thickness × 0.04.
Uses dedicated ATM_VERT / ATM_FRAG shaders with sun-directed Fresnel scattering.

**Thick atmosphere (NEW — Venus types, atmThickness > 0.60):**
Multi-shell volumetric cloud decks:

| Shell | Radius | Role | Side |
|-------|--------|------|------|
| Inner haze | 1.008 + depth×0.015 | Dense, dark-tinted base layer | DoubleSide |
| Middle deck | 1.020 + depth×0.035 | Main visible cloud layer, brightest | FrontSide |
| Outer haze | 1.040 + depth×0.05 | High-altitude diffuse veil (if > 0.75) | FrontSide |

Each shell is a `ShaderMaterial` mesh with independent color tint and opacity
derived from `atmThickness`. Creates a convincing Venus/Titan layered-atmosphere look.

#### Star-Dependent Vegetation Colors

The `foliageColor` useMemo computes vegetation tint from host star's spectral class:

| Star Type | Vegetation Color | Rationale |
|-----------|-----------------|-----------|
| M (red dwarf) | Near-black burgundy | Absorbs all available red/NIR photons |
| K (orange) | Warm olive-brown | Broader absorption than M, less green |
| G (Sun-like) | Earth green | Chlorophyll a/b optimized for G-star peak |
| F (yellow-white) | Chartreuse | Shifted toward blue-sensitive pigments |
| A (white) | Golden-olive | UV-stressed, carotenoid-heavy protection |

Vegetation is suppressed for: gas giants, ocean-level < 0.1, atmosphere < 0.15,
temperature outside 180–400 K range.

---

### Colony System

The surface/colony depth levels support an in-development colony builder:

**ColonyOverlay.tsx** (~683 LOC):
- Building placement on terrain surface
- GLB model import for structures
- Road network rendering (Catmull-Rom spline smoothing)
- Territory zones of control with jittered-corner borders

**ColonyTerrain.ts** (~766 LOC):
- 256×128 heightfield grid (JS port of the GLSL noise, seed × 137.0)
- A* pathfinding with 70% road cost discount
- Territory flood-fill from building positions
- Coastline detection + rendering
- Road-aware pathfinding (existing roads reduce traversal cost)

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
| 2 | Desktop (02_DESKTOP) | **LIVE** | Tauri 2.10, GLSL procedural planets, colony builder, multi-depth explorer |
| 3 | Shared SDK | PLANNED | Extract types, API, shaders to SHARED/ |
| 4 | Mobile (03_MOBILE) | PLANNED | RN scaffold, 2D map, card-based drill-down |
| 5 | Desktop GPU sidecar | PLANNED | wgpu compute shaders, atmosphere sim, TRAPPIST-1 validation |
| 6 | Game mode | IN PROGRESS | Single-system focus, colony builder, faction system |
