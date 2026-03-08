# 04 — Web Visualization Plan

## Purpose

Provide an analytical **command-map** for understanding astrophysical context and steering civilization simulation outcomes. The web client prioritizes accessibility, data clarity, and strategic decision-making over rendering fidelity.

**Implementation:** `02_CLIENTS/01_WEB/` (React + Three.js)

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | React 18 + TypeScript | Component architecture, type safety |
| 3D Rendering | Three.js + React Three Fiber | Star map, system views, spatial overlays |
| State Management | React Context (evolving to Zustand) | Simulation state, UI state, filter state |
| Styling | CSS Modules + Bootstrap grid | Responsive layout, consistent spacing |
| HTTP Client | Fetch API / Axios | REST API communication |
| Build | Create React App (migrating to Vite) | Dev server, bundling |

---

## View Architecture

### Primary Views

| View | Component | Route | Purpose |
|------|-----------|-------|---------|
| **Star Map** | `StarMapPage` → `StarMap` + `StarField` | `/map` | 3D galaxy neighborhood with interactive markers |
| **System Viewer** | `SystemViewerPage` → `OrreryScene` | `/system/:id` | Orrery-style planet view for selected system |
| **Simulation Dashboard** | `SimulationPage` | `/simulation` | Control panel, metrics, event log |
| **Data QA** | `DataQAPage` | `/admin/qa` | Pipeline health, quarantine review |
| **Admin** | `AdminPage` | `/admin` | System configuration, user management |

### Component Inventory

| Component | File | Responsibility |
|-----------|------|---------------|
| `StarField` | `components/StarField.tsx` | Three.js point cloud of star markers (spectral colors) |
| `StarLabels` | `components/StarLabels.tsx` | HTML overlay labels for notable stars |
| `StarMap` | `components/StarMap.tsx` | Container: camera, controls, layers, selection |
| `Starlanes` | `components/Starlanes.tsx` | Trade route / connection line rendering |
| `CompanionBonds` | `components/CompanionBonds.tsx` | Binary/multiple star system visual links |
| `OrreryScene` | `components/OrreryScene.tsx` | System-level planetary orbit visualization |
| `OrrerySceneFull` | `components/OrrerySceneFull.tsx` | Extended orrery with belts and moons |
| `SystemDetailPanel` | `components/SystemDetailPanel.tsx` | Sidebar with star/planet property tables |
| `SearchBar` | `components/SearchBar.tsx` | Star/system name search with autocomplete |
| `CameraController` | `components/CameraController.tsx` | Orbit controls, zoom, pan, focus transitions |
| `TopNav` | `components/TopNav.tsx` | Navigation bar with view switching |

---

## Layer System

The star map supports toggleable data layers, each independently controllable:

| Layer | Data Source | Visual Treatment | Default |
|-------|-----------|-----------------|---------|
| **Observed Systems** | Confirmed stars + planets | Solid markers, spectral-type color | ON |
| **Inferred Candidates** | Inference pipeline output | Ghost markers, dashed outlines | OFF |
| **Habitable Zones** | HZ-flagged planets | Green halo around host star | OFF |
| **Trade Routes** | Simulation economy data | Lines with thickness ∝ freight volume | OFF |
| **Political Boundaries** | Simulation faction data | Colored regions / Voronoi cells | OFF |
| **Resource Density** | Planet resource_potential | Heat coloring on system markers | OFF |
| **Exploration Front** | Campaign exploration table | Fog-of-war boundary line | ON (campaign mode) |

---

## Interaction Model

### Map Interactions

| Action | Input | Result |
|--------|-------|--------|
| **Select system** | Click marker | System detail panel opens; camera focuses |
| **Pan** | Right-drag / Middle-drag | Camera translates |
| **Rotate** | Left-drag | Camera orbits around focal point |
| **Zoom** | Scroll wheel | Camera dolly in/out |
| **Reset view** | Button / Home key | Return to default galactic overview |
| **Search** | Type in search bar | Filter + highlight matching systems |
| **Filter distance** | Drag slider | Show only systems within LY range |

### System Detail Panel

When a system is selected, the panel displays:

| Section | Content |
|---------|---------|
| **Star Properties** | Name, spectral type, luminosity, mass, distance, coordinates |
| **Confidence** | Tier badge (T1–T4), source attribution, model version |
| **Planets** | Table: name, type, mass, radius, SMA, eccentricity, HZ status |
| **Belts** | Inner/outer belt presence, composition, resource potential |
| **Simulation State** | Population, economy, faction, tech level (if simulation active) |
| **Exploration** | Scan level, explored_by, explored_at (if campaign active) |

### Simulation Control Panel

| Control | Type | Function |
|---------|------|----------|
| **Play/Pause** | Toggle button | Start or halt simulation ticks |
| **Step** | Button + input | Advance N ticks manually |
| **Speed** | Slider | Ticks per second (1–100) |
| **Metrics** | Live display | Population, GDP, faction count, event count |
| **Event Log** | Scrollable list | Recent events with tick, type, location, description |
| **Timeline** | Scrub bar | Seek to any past tick (read-only) |

---

## Data API Requirements

| Endpoint | Purpose | Response Shape |
|----------|---------|---------------|
| `GET /api/world/systems` | All systems with coordinates + metadata | `[{main_id, name, x, y, z, spectral, confidence, ...}]` |
| `GET /api/world/systems/:id` | Single system full detail | `{star, planets[], belts[], simulation_state}` |
| `GET /api/world/confidence` | Confidence matrix for all entities | `[{entity_id, tier, source, completeness, model}]` |
| `GET /api/campaigns/:id/map` | Explored systems for campaign | `[{system_main_id, scan_level, explored_at}]` |
| `GET /api/simulation/:id/snapshot` | Current simulation state | `{tick, settlements[], routes[], events[]}` |
| `WS /ws/simulation/:id` | Real-time tick stream (future) | `{tick, delta_settlements[], new_events[]}` |

### Loading Strategy

| Range | Strategy | Rationale |
|-------|----------|-----------|
| **< 500 systems** | Load all at init | Fits in memory; instant filtering |
| **500–5,000 systems** | Spatial chunking by octree | Viewport-aware loading; progressive detail |
| **> 5,000 systems** | Server-side aggregation | Heatmaps + cluster markers; drill-in for detail |

---

## UX Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Clarity over visual noise** | Muted colors for inactive layers; only active data highlighted |
| **Explicit confidence cues** | Confidence tier badges on all entities; observed = solid, inferred = ghost |
| **Fast provenance access** | Hover any entity → tooltip with source, method, confidence |
| **Minimal friction for scenario control** | Simulation controls always accessible in fixed bottom bar |
| **Responsive layout** | Desktop-first, but functional at 1024px viewport minimum |
| **Accessibility** | Keyboard navigation for all controls; ARIA labels on interactive elements |
| **Color-blind safe** | Spectral type colors chosen from colorblind-friendly palette |

---

## Performance Budget

| Metric | Target | Measurement |
|--------|--------|-------------|
| First Contentful Paint | < 2s | Lighthouse |
| Time to Interactive (map loaded) | < 4s | Custom timing |
| Frame rate (500 markers, orbit controls) | ≥ 60fps | Chrome DevTools |
| Frame rate (5000 markers, zoomed out) | ≥ 30fps | Chrome DevTools |
| Bundle size (gzipped) | < 500 KB (main) + < 300 KB (Three.js) | Webpack analyzer |
| Memory usage | < 200 MB | Chrome DevTools |

---

## Milestone Deliverables

| Milestone | Features | Status |
|-----------|----------|--------|
| **MVP (v1)** | 3D star map, system drill-down, spectral coloring, distance filter | ✅ Complete |
| **v2** | Live simulation controls, political/economic layer overlays | 🔄 In Progress |
| **v3** | Comparative analytics, scenario branch explorer, campaign fog-of-war map | Planned |
| **v4** | WebSocket real-time events, advanced timeline scrubbing, export tools | Planned |

---

## Known Limitations & Future Work

| Limitation | Workaround | Future Fix |
|-----------|-----------|-----------|
| No WebSocket support yet | Polling for simulation updates | Implement WS in gateway |
| Campaign map not integrated | Direct API calls | Fog-of-war layer in StarMap |
| No mobile responsiveness | Desktop-only recommendation | Responsive breakpoints |
| Three.js bundle size | Lazy loading | Tree-shaking + CDN split |
| No offline support | Requires API connection | Service worker + local cache |
