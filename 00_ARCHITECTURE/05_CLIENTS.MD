# 03 — Clients Architecture

## Multi-Platform Strategy

ExoMaps is designed for multiple client form factors sharing a common API surface
and visual language. All clients live under `02_CLIENTS/` with platform-specific
code isolated and shared code extracted.

```
02_CLIENTS/
├── 01_WEB/        React / TypeScript / Three.js SPA          ← LIVE
├── 02_DESKTOP/    Electron or Tauri (planned)                 ← PLANNED
├── 03_MOBILE/     React Native with GL views (planned)        ← PLANNED
└── SHARED/        Cross-platform: types, API SDK, assets      ← PLANNED
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
│   │                        ├── GalacticGrid
│   │                        ├── DistanceShell × 4
│   │                        ├── CameraRig (OrbitControls)
│   │                        ├── HUD: Census + Legend
│   │                        └── SelectedStarPanel
│   ├── /admin      → AdminPage
│   ├── /simulation → SimulationPage
│   └── /qa         → DataQAPage
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
  • Vertex: billboard sizing by distance + luminosity
  • Fragment: spectral color, bloom, twinkle, binary rings
  • Blending: additive (stars glow through each other)
```

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
| **Sol beacon** | Unique pulsing golden sphere at origin |

---

## 02_DESKTOP — Electron / Tauri (Planned)

Higher-fidelity rendering and richer interaction:
- **Full-screen immersive mode** with no browser chrome
- **Local GPU acceleration** without WebGL limitations
- **Offline mode** with cached world state
- **Multiple viewports** (map + detail panel + timeline)

Technology candidates:
- **Electron** — proven cross-platform, can reuse React/Three.js code
- **Tauri** — lightweight, Rust backend, better performance per watt

Both would consume the same API surface as the web client.

---

## 03_MOBILE — React Native (Planned)

Focused experience for monitoring and light interaction:
- **2-D projected star map** (top-down view — avoids mobile GPU limits)
- **System detail cards** with spectral data
- **Push notifications** for simulation events
- **Touch gestures** for pan/zoom/drill-down

---

## SHARED — Cross-Client SDK (Planned)

Extracted from `01_WEB/src/types/` and `01_WEB/src/services/`:

```
SHARED/
├── types/
│   └── api.ts            StarSystemFull, Persona, etc.
├── api/
│   └── client.ts         Axios-based API client factory
├── auth/
│   └── token.ts          JWT storage + refresh logic
└── constants/
    ├── spectral.ts       Harvard classification table
    └── colors.ts         Theme colors shared across platforms
```

This will be published as an internal npm package or workspace symlink so all
three clients stay type-safe against the same API contract.

---

## Multiplayer Architecture (Planned)

When 04_MESSAGING is live, clients connect via WebSocket for real-time features:

```
Browser A ──WSS──┐
                  │     ┌──────────────┐
Browser B ──WSS──┼────▶│ 04_MESSAGING  │──▶ 03_WORLD_ENGINE
                  │     │ (Socket.IO)  │
Desktop  ──WSS──┘     └──────────────┘
```

**Sync model:**
- **Simulation ticks** broadcast to all connected viewers
- **Cursor positions** relayed for collaborative map exploration
- **Annotations** (bookmarks, labeled systems) persisted and shared
- **Conflict resolution** via server-authoritative tick ordering
