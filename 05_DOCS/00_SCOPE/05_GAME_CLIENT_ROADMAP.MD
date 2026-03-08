# 05 — Game Client Roadmap (Desktop)

## Goal

Develop a high-fidelity desktop client that reuses the same simulation backbone as the web client while offering deeper interaction, immersion, and rendering performance. The desktop client is the "full experience" — the web client is the accessible strategic view.

**Implementation:** `02_CLIENTS/02_DESKTOP/` (Tauri + TypeScript + Vite)

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Shell** | Tauri 1.x (Rust backend + WebView) | Small binary, native performance, cross-platform |
| **Frontend** | TypeScript + Vite | Fast build, HMR, tree-shaking |
| **Rendering** | Three.js / WebGPU (future) | GPU-accelerated 3D scenes |
| **State** | Shared client library (`02_CLIENTS/SHARED/`) | Same data types and API contracts as web |
| **IPC** | Tauri commands (Rust ↔ JS) | Native file I/O, local simulation cache |
| **Packaging** | Tauri bundler | .deb, .AppImage, .msi, .dmg |

---

## Shared Core with Web Client

| Shared Asset | Location | Purpose |
|-------------|----------|---------|
| API client | `02_CLIENTS/SHARED/src/` | HTTP client, endpoint definitions, auth |
| Type definitions | `02_CLIENTS/SHARED/src/` | Entity schemas, confidence tiers, enums |
| Scenario definitions | Shared config | Preset seeds, rule-sets, faction templates |
| Shader library | `02_CLIENTS/01_WEB/src/shaders/` (shared) | Spectral coloring, star rendering |

### Divergence Points (Desktop Only)

| Feature | Web | Desktop |
|---------|-----|---------|
| Local simulation cache | No (API-only) | Yes (Tauri + SQLite or file cache) |
| Offline mode | No | Yes (cached world build + local sim) |
| Background rendering | WebGL context limits | Full GPU access, multiple render targets |
| File system access | None | Save/load campaigns, export data, screenshots |
| Multi-window | Single tab | Multiple windows (map + detail + control) |
| Modding | No | Lua/WASM script loading |

---

## Feature Priority & Milestones

### Milestone D1: Foundation (Current Phase)

| Feature | Status | Description |
|---------|--------|-------------|
| Tauri shell with Vite + TypeScript | ✅ Built | Basic window, dev server |
| Shared type imports | 🔄 Partial | TypeScript types from SHARED package |
| API client integration | Planned | Consume same REST endpoints as web |
| Star map view (port from web) | Planned | Three.js scene adapted for desktop viewport |

### Milestone D2: Camera & Navigation

| Feature | Priority | Description |
|---------|----------|-------------|
| Smooth fly-through camera | P1 | Animated transitions galaxy → system → planet |
| Bookmark system | P1 | Save/restore camera positions |
| Minimap overlay | P2 | Inset showing full galaxy with viewport indicator |
| Keyboard shortcuts | P1 | WASD movement, number keys for views, Esc for back |
| Controller support | P3 | Gamepad input for camera and selection |

### Milestone D3: Strategic Overlays

| Feature | Priority | Description |
|---------|----------|-------------|
| Trade route visualization | P1 | Animated particles along routes, thickness = volume |
| Political territory | P1 | Colored region boundaries with faction icons |
| Military positioning | P2 | Patrol routes, conflict markers, force projection |
| Chokepoint analysis | P2 | Highlighted narrow passages in route network |
| Supply chain view | P2 | Production → consumption flow arrows |

### Milestone D4: Management Interfaces

| Feature | Priority | Description |
|---------|----------|-------------|
| Colony manager | P1 | Population, infrastructure, growth projections, build queue |
| Fleet manager | P1 | Ship inventory, mission assignment, route planning |
| Trade manager | P1 | Import/export orders, price monitoring, arbitrage tools |
| Faction overview | P1 | Diplomacy status, tension meters, alliance graph |
| Research tree | P2 | Tech progression visualization and investment allocation |

### Milestone D5: Ship Design

| Feature | Priority | Description |
|---------|----------|-------------|
| Modular ship builder | P2 | Drag-and-drop module placement (hull, engines, cargo, etc.) |
| Propulsion calculator | P2 | Delta-V budget, transit time estimates for selected routes |
| Life support designer | P2 | Crew capacity, O₂/H₂O/food cycling, radiation shielding |
| Ship templates | P2 | Save/load custom designs; share between campaigns |
| Performance preview | P2 | Simulated mission outcome before commitment |

### Milestone D6: Narrative & Events

| Feature | Priority | Description |
|---------|----------|-------------|
| Event cards | P2 | Rich presentation of strategic events with choices |
| Human diaspora timeline | P2 | Scrollable narrative history of expansion |
| Mission-like objectives | P2 | Optional goals: "Establish colony in Tau Ceti", etc. |
| Faction narratives | P3 | Auto-generated story summaries from simulation state |
| Discovery journal | P3 | Log of explored systems with player notes |

### Milestone D7: Modding & Extensibility

| Feature | Priority | Description |
|---------|----------|-------------|
| Scenario editor | P3 | Custom starting conditions, rule-sets, faction placement |
| Mod loader | P3 | Load custom scripts (Lua/WASM) for events, rules, UI |
| Custom asset support | P3 | User-provided textures, ship models, icons |
| Workshop integration | P3 | TBD: steam workshop or custom sharing platform |

---

## Rendering Architecture

### Scene Graph

```
Root Scene
├── Galaxy Layer (always rendered)
│   ├── StarField (instanced points, LOD by distance)
│   ├── StarLabels (HTML overlay, culled by viewport)
│   ├── Starlanes (line segments, width = importance)
│   └── PoliticalRegions (mesh overlay, semi-transparent)
├── System Layer (rendered when zoomed into system)
│   ├── Star (billboard sprite with spectral glow)
│   ├── Planets (spheres with baked textures)
│   ├── Orbits (ellipse wireframes)
│   ├── Belts (particle ring)
│   └── Ships (icon markers with trajectory lines)
└── UI Layer (always on top)
    ├── HUD panels
    ├── Selection highlight
    └── Tooltip overlays
```

### LOD Strategy

| Distance | Rendering | Object Count |
|----------|-----------|-------------|
| > 50 LY from camera | Point sprites only | All systems |
| 10–50 LY | Sprites + labels for named stars | Hundreds |
| 1–10 LY | System icons with planet count badge | Dozens |
| < 1 LY (system view) | Full orrery with planets + belts | Single system |
| Planet surface | Baked texture sphere + atmosphere shader | Single planet |

### Performance Targets

| Metric | Target |
|--------|--------|
| Galaxy view (10,000 stars) | ≥ 60fps |
| System view (30 objects) | ≥ 60fps |
| Camera transition (galaxy → system) | < 1.5s smooth |
| Memory ceiling | < 1 GB |
| Initial load (cached) | < 3s |
| Binary size (packaged) | < 100 MB |

---

## Development Strategy

| Principle | Implementation |
|-----------|---------------|
| **Web as correctness oracle** | Desktop must produce identical data displays for same API input |
| **Incremental feature addition** | Only add features when simulation model supports meaningful outcomes |
| **Shared types enforce consistency** | `SHARED/` package imported by both clients; schema drift caught at build |
| **Desktop for depth, web for breadth** | Desktop gets richer controls; web gets broader accessibility |
| **Campaign portability** | Campaign save format works across client versions |

---

## Input Binding Spec (Draft)

| Action | Keyboard | Mouse | Gamepad |
|--------|----------|-------|---------|
| Pan | WASD | Right-drag | Left stick |
| Rotate | Q/E | Left-drag | Right stick |
| Zoom | +/- | Scroll | Triggers |
| Select | Enter | Click | A button |
| Back | Esc | — | B button |
| Pause sim | Space | — | Start |
| Quick save | Ctrl+S | — | — |
| Map toggle | M | — | Select |
| Layer cycle | L | — | Bumpers |
