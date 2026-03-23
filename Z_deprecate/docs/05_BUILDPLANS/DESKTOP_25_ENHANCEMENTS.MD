# Desktop Client — 25 Game-Like Enhancements

**Date:** March 2026  
**Scope Reference:** [05_GAME_CLIENT_ROADMAP.MD](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD), [03_SIMULATION_ENGINE.MD](../00_SCOPE/03_SIMULATION_ENGINE.MD), [01_FUNCTIONALITY.MD](../00_SCOPE/01_FUNCTIONALITY.MD), [02_ASTROPHYSICAL_MODELING.MD](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Target:** `02_CLIENTS/02_DESKTOP/` — Tauri 2.10 + wgpu/Vulkan (GTX 1080 reference GPU)

## Current Desktop Foundation

| Layer | Files | What Exists |
|-------|-------|-------------|
| GPU Rendering | `src-tauri/src/gpu/` (11 .rs + 1 .wgsl) | wgpu Vulkan pipeline, PBR Cook-Torrance, procedural terrain, MSAA 4x, atmosphere shell, SIMD batch kernels |
| Simulation Models | `src-tauri/src/simulation/` (11 .rs) | Atmosphere, biomes, climate, composition, geology, interior, tectonics, model registry |
| Cache/State | `src-tauri/src/cache/` (3 .rs) | Generation store, world state persistence |
| IPC Commands | `src-tauri/src/main.rs` (883 LOC, 30+ commands) | GPU init, planet render, terrain gen, texture cache, benchmark |
| Frontend | `src/components/` (20 .tsx) | Orrery, planet editor, atmosphere/climate/composition/interior panels, campaign panel, GPU status |
| Hooks | `src/hooks/` (5 .ts/.tsx) | Tauri GPU, campaigns, offline cache, science, events |

---

## Enhancement Matrix

| # | Enhancement | Category | Priority | Scope Doc Ref | New / Enhances |
|---|-------------|----------|----------|---------------|----------------|
| 1 | Fly-Through Camera System | Navigation | P1 | 05-D2, F8.1 | Enhances |
| 2 | Planetary Ring Systems | Realism | P1 | 02-Belt, F8.8 | New |
| 3 | Dynamic Cloud Layers | Realism | P1 | 02-Atmosphere | New |
| 4 | Colony Builder Interface | Gameplay | P1 | 05-D4, F8.6 | Enhances |
| 5 | Fleet Command & Mission Planning | Gameplay | P1 | 05-D4, F8.4, S1 | Enhances |
| 6 | Time Controls & Simulation HUD | Gameplay | P1 | 03-User Control | New |
| 7 | LOD Terrain with Quad-Tree Subdivision | Realism | P1 | 05-LOD | Enhances |
| 8 | Volcanic & Tectonic Activity | Realism | P2 | sim/tectonics.rs, geology.rs | New |
| 9 | Aurora & Magnetic Field Visualization | Realism | P2 | sim/atmosphere.rs | New |
| 10 | Resource Scanning & Mineral Overlay | Gameplay | P1 | 09-Minerals, F3.6 | Enhances |
| 11 | Ship Designer with Module Builder | Gameplay | P2 | 05-D5, F8.5 | Enhances |
| 12 | Fog-of-War Exploration Gameplay | Gameplay | P1 | F5.2, F5.3, O7 | Enhances |
| 13 | Strategic Event Cards with Player Choices | Gameplay | P2 | 05-D6, 03-Events | Enhances |
| 14 | Technology Research Tree | Gameplay | P2 | 05-D4, 03-Economy | Enhances |
| 15 | Sound Engine & Ambient Soundscapes | Immersion | P2 | — | New |
| 16 | Photo Mode & Screenshot Tools | Immersion | P2 | 05-Divergence | New |
| 17 | Particle Effects — Belts, Comets, Stellar Wind | Realism | P2 | 02-Belt | New |
| 18 | Ocean Fluid Dynamics & Tidal Effects | Realism | P2 | sim/climate.rs | New |
| 19 | Weather Systems & Atmospheric Circulation | Realism | P2 | sim/climate.rs, atmosphere_v2.rs | New |
| 20 | Multi-Window Detachable Panels | UX | P2 | 05-Divergence | Enhances |
| 21 | Gamepad & HOTAS Controller Support | Controls | P3 | 05-D2 Input Binding | Enhances |
| 22 | Terraforming Simulation | Gameplay | P2 | 03-Future, 08-Open | New |
| 23 | Political Map & Diplomacy Interface | Gameplay | P1 | 03-Politics, F8.3 | Enhances |
| 24 | Discovery Journal & Exploration Log | Gameplay | P2 | 05-D6, F5.3 | Enhances |
| 25 | Benchmark Arena & GPU Stress Test | Technical | P3 | gpu/benchmark.rs | Enhances |

---

## Detailed Enhancement Descriptions

### 1. Fly-Through Camera System
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Milestone D2](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** `src-tauri/src/gpu/camera.rs`, `src/components/SystemFocusView.tsx`

**Current state:** Fixed orbit camera around a single system. No smooth transitions between zoom levels.

**Enhancement:**
- **Cinematic fly-through** from galaxy overview → system orrery → planet surface, with smooth cubic Bézier interpolation between waypoints
- **WASD + QE** free-camera in galaxy view (speed scales with zoom level)
- **Double-click warp** — click a star in galaxy view → camera sweeps in over 1.5s
- **Bookmark system** — save/restore named camera positions per campaign
- **Minimap inset** — 200×200px corner HUD showing full galaxy with viewport frustum indicator
- **Cinematic auto-pilot** — "tour mode" that flies between notable systems with smooth transitions

**Implementation:** Extend `camera.rs` with `CameraRig` struct holding position stack, target queue, and interpolation state. Frontend sends `camera_fly_to`, `camera_bookmark_save`, `camera_set_mode` (Orbit | Free | Cinematic) IPC commands.

**Scope Doc Update:** Milestone D2 currently lists these features as "Planned." Promote camera fly-through and WASD to **Status: In Development**.

---

### 2. Planetary Ring Systems
**Scope Ref:** [02_ASTROPHYSICAL_MODELING.MD — Belt Inference](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Existing Code:** `src-tauri/src/gpu/planet_render.rs`, `planet.wgsl`

**Current state:** Belts exist as data entities (inner rocky, outer icy, Hilda, scattered disc) but have no visual representation in the desktop renderer. Orrery shows belts as line rings only.

**Enhancement:**
- **GPU-instanced ring particles** — 10K–100K billboard particles arranged in toroidal distribution with Keplerian velocity
- **Ring shader** with Rayleigh scattering, shadow casting from parent planet, and gap structure (Cassini-like divisions procedurally generated from resonance positions)
- **Ring composition coloring** — icy rings (blue-white translucent), rocky rings (brown-orange opaque), mixed (banded)
- **Density falloff** — exponential density profile from inner to outer edge, with Gaussian vertical thickness
- **Shadow interaction** — planet casts shadow on rings; rings cast shadow on planet (requires shadow map pass)

**Implementation:** New `ring_render.rs` GPU module. WGSL shader `ring.wgsl` with instanced particle mesh (quad billboard) and per-particle orbital position computed from Keplerian elements + time uniform. ~500 LOC Rust + ~150 LOC WGSL.

**Scope Doc Update:** Add to [02 — Belt Outputs](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD): `ring_visual_type: particle_dense | particle_sparse | diffuse`, `gap_positions: [float]`, `composition_color_profile`.

---

### 3. Dynamic Cloud Layers
**Scope Ref:** [02_ASTROPHYSICAL_MODELING.MD — Atmosphere Estimation (Future)](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Existing Code:** `src-tauri/src/simulation/atmosphere.rs`, `atmosphere_v2.rs`, `src/components/AtmospherePanel.tsx`, `AtmosphereV2Panel.tsx`

**Current state:** Atmosphere is modeled as a static Rayleigh/Mie scattering shell. No dynamic cloud cover.

**Enhancement:**
- **Animated cloud layer** — second sphere mesh slightly above surface with scrolling 3D Perlin noise in WGSL
- **Cloud type differentiation:**
  - Gas giants: banded zonal flows (Jupiter-like) with vortex storm features
  - Rocky worlds: cumulus-style cellular convection patterns
  - Ice worlds: thin haze with polar vortex caps
  - Hot worlds: volcanic ash plumes + permanent storm cells
- **Day/night terminator** — cloud layer illumination follows star direction vector
- **Cloud opacity** tied to atmospheric pressure from `atmosphere_v2.rs` model output
- **Storm systems** — procedural cyclone vortices for gas giants, driven by rotation rate and atmospheric depth

**Implementation:** New WGSL shader entry `cloud_layer.wgsl` (~200 LOC). Integrate as third render pass after surface + atmosphere. Cloud parameters fed from `atmosphere_v2.rs` → IPC `get_cloud_params` command.

**Scope Doc Update:** Add F8.10 to [01_FUNCTIONALITY.MD § 8](../00_SCOPE/01_FUNCTIONALITY.MD): "Dynamic cloud layer rendering with physically-motivated patterns per planet type."

---

### 4. Colony Builder Interface
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Milestone D4](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD), [03_SIMULATION_ENGINE.MD — Colony Lifecycle](../00_SCOPE/03_SIMULATION_ENGINE.MD)  
**Existing Code:** `src/components/CampaignPanel.tsx` (basic campaign CRUD)

**Current state:** Campaign panel shows campaign metadata. No colony management, build queues, or infrastructure placement.

**Enhancement:**
- **Colony overview HUD** — Population, growth rate, carrying capacity (Outpost/Settlement/Colony/Mature World stages from Simulation Engine doc)
- **Build queue panel** — Infrastructure cards: Mining Rig, Refinery, Factory, Habitat, Research Lab, Shipyard, Spaceport, Comms Array
- **Resource allocation** — Drag sliders to split workforce between extraction, manufacturing, research, agriculture
- **Growth projections** — Real-time chart showing P(t) logistic curve to next lifecycle stage with ETA
- **Infrastructure placement** — Click zones on planet surface globe to place structures (visual markers on the terrain)
- **Colony alerts** — Toast notifications for shortage, overpopulation, tech milestone, secession risk

**Implementation:** New `ColonyManagerPanel.tsx` (~800 LOC) with build queue state machine. Backend: new simulation API endpoints `/api/campaigns/:id/colonies/:system_id/build` and `/api/campaigns/:id/colonies/:system_id/allocate`. Colony state persisted in campaign DB tables.

**Scope Doc Update:** Promote Milestone D4 Colony Manager from "P1 Planned" to "P1 In Development." Add colony infrastructure schema to [03_SIMULATION_ENGINE.MD](../00_SCOPE/03_SIMULATION_ENGINE.MD):

```
| Infrastructure | Cost | Effect | Prerequisite |
|----------------|------|--------|-------------|
| Mining Rig     | 100  | +raw_output ×1.2 | TL 1 |
| Refinery       | 250  | Enables processed goods | TL 2 |
| Habitat        | 500  | +carrying_capacity ×1.5 | TL 3 |
| ...            | ...  | ... | ... |
```

---

### 5. Fleet Command & Mission Planning
**Scope Ref:** [03_SIMULATION_ENGINE.MD — Logistics & Ships](../00_SCOPE/03_SIMULATION_ENGINE.MD), [05_GAME_CLIENT_ROADMAP.MD — D4 Fleet Manager](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** Ship classes defined in simulation doc but no frontend implementation

**Current state:** Ship classes (Colony Ship, Cargo Hauler, Fast Courier, Patrol, Survey Probe) are defined in the simulation spec but have zero UI or backend implementation.

**Enhancement:**
- **Fleet roster panel** — List all ships with class, location, mission status, ETA
- **Mission planner** — Select ship → set destination → route preview (line on galaxy map with distance/time) → confirm dispatch
- **Multi-hop routing** — Pathfinding through intermediate systems for refueling (Dijkstra on star graph weighted by distance/fuel capacity)
- **Fleet grouping** — Combine ships into task forces with formation icons on galaxy map
- **Mission types:**
  - **Survey** — Send probe, lifts fog-of-war, reveals system data (maps to F5.2 scan levels)
  - **Colonize** — Colony ship + supplies → establishes outpost on arrival
  - **Trade run** — Cargo hauler on route, auto-repeating if set
  - **Patrol** — Security route, reduces piracy/event probability in area
- **In-transit visualization** — Animated ship icons moving along route lines in galaxy view, position interpolated from departure tick + speed + distance
- **Arrival events** — Toast + event card when ships reach destination

**Implementation:** `FleetCommandPanel.tsx` (~700 LOC), `src-tauri/src/simulation/fleet.rs` for route planning. New IPC commands: `fleet_list`, `fleet_dispatch`, `fleet_route_preview`. New API endpoints: `/api/campaigns/:id/fleets`, `/api/campaigns/:id/fleets/:id/dispatch`.

**Scope Doc Update:** Resolve open question [S1](../00_SCOPE/08_OPEN_QUESTIONS.MD) ("What travel model...") — promote to 🟢 Resolved with: "SFTL fleet routing with multi-hop refueling, Dijkstra pathfinding, 5 ship classes with distinct mission profiles."

---

### 6. Time Controls & Simulation HUD
**Scope Ref:** [03_SIMULATION_ENGINE.MD — User Control & Gamification](../00_SCOPE/03_SIMULATION_ENGINE.MD)  
**Existing Code:** No simulation speed controls in desktop client

**Current state:** Simulation is server-side only. Desktop has no play/pause/speed controls or tick display.

**Enhancement:**
- **Persistent bottom HUD bar** with:
  - Play / Pause / Step buttons (maps to `/api/simulation/:id/pause|resume|step`)
  - Speed slider: 1× (0.25 yr/tick, 1 tick/sec) → 10× → 100× → MAX
  - Current date display: "Year 2247 Q3 — Tick 892"
  - Key metrics strip: Total Population, Systems Colonized, Active Routes, GDP, Faction Count
- **Rule sliders overlay** — Accessible from HUD gear icon, exposes the 6 rule sliders from Simulation Engine doc (propulsion rate, governance cohesion, resource scarcity, event frequency, growth rate, tech progression)
- **Mini event ticker** — Scrolling one-line event summaries at top of screen ("Year 2231: Scientific Discovery at Tau Ceti — Tech +1")
- **Timeline scrubber** — Drag to review any past tick (read-only snapshot playback)

**Implementation:** `SimulationHUD.tsx` (~400 LOC) fixed-position overlay. Add `useSimulation` hook wrapping REST polling (`/api/simulation/:id/snapshot` at 1Hz during play). Offline mode: local tick engine in `src-tauri/src/simulation/`.

**Scope Doc Update:** Add to [05_GAME_CLIENT_ROADMAP.MD](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) new **Milestone D2.5: Simulation HUD** between D2 (Camera) and D3 (Overlays).

---

### 7. LOD Terrain with Quad-Tree Subdivision
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — LOD Strategy](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** `src-tauri/src/gpu/terrain.rs` (927 LOC), `sphere_mesh.rs`, QuadSphere in SHARED

**Current state:** Terrain generation produces fixed-resolution heightmap. No adaptive detail based on camera distance.

**Enhancement:**
- **Quad-tree CDLOD** (Continuous Distance-dependent Level of Detail) — subdivide sphere faces dynamically based on camera distance
- **5 LOD levels:** L0 (16 faces, galaxy) → L1 (64) → L2 (256) → L3 (1024) → L4 (4096, close orbit) → L5 (16384, surface fly-over)
- **Seamless LOD transitions** — Geomorphing between detail levels to prevent popping
- **GPU-side tessellation** — Use wgpu compute shaders for terrain height evaluation at arbitrary points, avoiding CPU round-trip
- **Terrain type variation** driven by simulation models:
  - `geology.rs` → mountain ranges along tectonic plate boundaries
  - `composition.rs` → surface material coloring (silicate tan, iron red, ice white)
  - `biomes.rs` → vegetation overlays in habitable temperature zones
- **Crater generation** — Impact craters on airless bodies (sub-earths, small moons) using Voronoi noise

**Implementation:** Extend `terrain.rs` with `QuadTreeNode` and `LodManager`. New compute shader `terrain_lod.wgsl` for GPU-side height evaluation. `sphere_mesh.rs` generates adaptive index buffers.

**Scope Doc Update:** Update LOD Strategy table in [05_GAME_CLIENT_ROADMAP.MD](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) to replace "Baked texture sphere" with "CDLOD quad-tree terrain with 5 subdivision levels."

---

### 8. Volcanic & Tectonic Activity
**Scope Ref:** [02_ASTROPHYSICAL_MODELING.MD — Future: Atmosphere Estimation](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Existing Code:** `src-tauri/src/simulation/tectonics.rs`, `geology.rs`

**Current state:** Tectonics and geology Rust modules exist for simulation but have no visual representation.

**Enhancement:**
- **Tectonic plate boundaries** — Visible fault lines on planet surface (hairline cracks with emissive orange glow)
- **Volcanic hotspots** — Point-light emissive regions at plate junctions, pulsating with eruption cycle
- **Lava flows** — Shader-driven emissive rivers in heightmap valleys near volcanoes, animated flow with noise distortion
- **Eruption events** — Triggered by simulation tick events. Particle system plume (GPU instanced billboards) rising from vent, dispersing over time
- **Tidal heating indicator** — For moons in tight orbits, global subsurface glow (Io-like) driven by orbital eccentricity and parent mass
- **Seismic HUD** — Overlay mode showing tectonic stress as a heat-map when inspecting planet interior

**Implementation:** Extend `planet.wgsl` with `TECTONIC_OVERLAY` flag. New `eruption_particles.wgsl` compute + render shader. Tectonics model feeds plate boundary UV coordinates to GPU via `terrain_set_tectonics` IPC command.

**Scope Doc Update:** Add to [02 — Simulation-Facing Outputs](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD):
```
| `tectonic_activity_index` | f(mass, age, tidal_heating, rotation) | Visual: fault lines, eruptions |
| `volcanic_hotspot_count`  | f(tectonic_activity, plate_count)     | Visual: eruption frequency     |
```

---

### 9. Aurora & Magnetic Field Visualization
**Scope Ref:** [02_ASTROPHYSICAL_MODELING.MD — Atmosphere Estimation](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Existing Code:** `src-tauri/src/simulation/atmosphere.rs`, `atmosphere_v2.rs`

**Current state:** Atmosphere rendering is a static Rayleigh/Mie shell. No magnetic field or aurora effects.

**Enhancement:**
- **Magnetic field lines** — Toggle-able dipole field visualization (streamlines rendered as GPU line strips, color-coded by field strength)
- **Aurora ovals** — Animated luminescent bands at magnetic poles, driven by:
  - Stellar wind intensity (host star luminosity + distance)
  - Magnetic field strength (estimated from planet mass + rotation rate)
  - Atmospheric composition (green for N₂/O₂, red for CO₂, purple for H₂)
- **Aurora shader** — Volumetric curtain effect using layered noise in WGSL with additive blending
- **Magnetosphere boundary** — Semi-transparent bow shock surface showing where stellar wind deflects
- **Radiation belt indicator** — Toroidal glow at Van Allen belt analogs for gas giants (relevant to colonization: high radiation = hostile)

**Implementation:** New `aurora.wgsl` shader (~180 LOC). Magnetic field parameters computed in `atmosphere_v2.rs` and passed to GPU. New `AURORA_OVERLAY` render flag. New IPC command: `planet_set_aurora_params`.

**Scope Doc Update:** Add to [01_FUNCTIONALITY.MD — F8](../00_SCOPE/01_FUNCTIONALITY.MD): "F8.11 — Magnetic field and aurora visualization with physically-motivated emission spectra."

---

### 10. Resource Scanning & Mineral Overlay
**Scope Ref:** [07_IMPLEMENTATION_PHASES.MD — Phase 09 Minerals](../00_SCOPE/07_IMPLEMENTATION_PHASES.MD), [01_FUNCTIONALITY.MD — F3.6](../00_SCOPE/01_FUNCTIONALITY.MD)  
**Existing Code:** `resource_potential` field exists in DB schema, `useScience.ts` hook

**Current state:** resource_potential is computed but not exposed visually. No mineral breakdown or scanning UI.

**Enhancement:**
- **Scan levels** (ties into F5.3 multi-level scanning):
  - **Level 1** (flyby): Planet type + rough habitability → unlocks basic info panel
  - **Level 2** (orbital survey): Surface composition breakdown, belt mineral classes → unlocks resource overlay
  - **Level 3** (deep survey): Precise mineral deposit locations on surface, subsurface ice/water, rare element veins → unlocks mining placement
- **Mineral heat-map overlay** — Planet surface colored by resource density (iron=red, silicates=yellow, ice=blue, rare elements=magenta)
- **Asteroid belt scan** — Select belt → particle coloring shifts to show composition distribution
- **Resource summary panel** — Bar chart per system showing extractable minerals, energy potential, agricultural capacity
- **Scan animation** — When dispatching a survey probe, show scanning beam sweep across planet (shader effect with animated UV mask)

**Implementation:** `ResourceScanPanel.tsx` (~500 LOC). Extend `terrain.rs` with mineral deposit noise layer. New `mineral_overlay.wgsl` blending onto surface. API extension: `/api/campaigns/:id/scan/:system_id` POST (triggers scan, returns data by level).

**Scope Doc Update:** Resolve [F3.6](../00_SCOPE/01_FUNCTIONALITY.MD) status from "Deferred to Phase 09" → "Phase 09 — Designed." Expand schema:
```
mineral_deposits: [{type: iron|silicate|ice|rare_earth, concentration: float, location_lat: float, location_lon: float}]
```

---

### 11. Ship Designer with Module Builder
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Milestone D5](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** Ship classes defined in simulation doc (5 classes)

**Current state:** Ships exist as abstract statistical entities. No visual design or module system.

**Enhancement:**
- **Modular ship blueprint editor** — 2D top-down grid where players drag modules:
  - **Hull types** (Light Frame, Heavy Frame, Armored) — sets HP, mass, module slot count
  - **Propulsion** (Chemical, Fusion, Ion, Beamed Sail) — sets velocity fraction, fuel consumption
  - **Cargo** (Standard Bay, Cryogenic, Pressurized) — determines freight type + capacity
  - **Life Support** (Basic, Extended, Colony-Grade) — crew capacity + O₂/H₂O recycling rate
  - **Sensors** (Basic Scanner, Deep Survey Suite, Science Lab) — scan level capability
  - **Defense** (Point Defense, Armor Plating, ECM) — for conflict events
- **Delta-V budget calculator** — Real-time readout of max range, transit time to selected destination, fuel margin
- **Performance preview** — "Simulate mission" button runs a quick what-if: success probability, ETA, fuel remaining, risk factors
- **Ship templates** — Save/load custom designs; pre-built templates for the 5 canonical ship classes
- **3D ship preview** — Procedural ship model from module layout (simple voxel-style assembly)

**Implementation:** `ShipDesigner.tsx` (~1200 LOC) with drag-and-drop module grid. Module stat definitions in shared JSON config. Ship schema in DB: `campaign_ships` table with `modules JSONB`. New IPC: `ship_preview_render` for 3D preview.

**Scope Doc Update:** Promote Milestone D5 from all-P2 to P2/P1 mix. Add propulsion calculator formula to [03_SIMULATION_ENGINE.MD](../00_SCOPE/03_SIMULATION_ENGINE.MD):
```
delta_v = Isp × g0 × ln(m_wet / m_dry)
max_range_ly = delta_v / c × mission_duration_years
```

---

### 12. Fog-of-War Exploration Gameplay
**Scope Ref:** [01_FUNCTIONALITY.MD — F5.2, F5.3](../00_SCOPE/01_FUNCTIONALITY.MD), [00_VISION_AND_GOALS.MD — O7](../00_SCOPE/00_VISION_AND_GOALS.MD)  
**Existing Code:** `src/components/StarField.tsx` (has fog-of-war rendering), `useCampaign.tsx`, campaign DB tables exist

**Current state:** StarField renders explored vs unexplored stars differently (solid vs dimmed). But exploration is manual/admin — no gameplay loop for discovery.

**Enhancement:**
- **Sensor range mechanic** — Each colony has a sensor range (base 5 LY, upgradeable). Stars within range are "detected" (blurred marker). Probe flyby → Level 1 scan. Orbital survey → Level 2. Deep survey → Level 3.
- **Progressive reveal** — Detected systems show star type + estimated planet count only. Each scan level reveals more: L1 (planet names/types), L2 (resources, habitability), L3 (full detail + mineral deposits)
- **Exploration frontier** — Glowing boundary line on galaxy map showing edge of known space (convex hull of explored systems)
- **Discovery events** — "First survey of Tau Ceti reveals 3 habitable-zone planets!" event card with fanfare
- **Auto-scout suggestion** — AI recommends next systems to explore based on `exploration_priority` field (from inference pipeline)
- **Survey probe dispatch** — Select unexplored star → "Send Probe" → probe travels at 0.15c → arrives → scan animation → data revealed

**Implementation:** Extend `useCampaign.tsx` with exploration state machine. StarField shader: three rendering tiers (unknown=dim point, detected=blurred glow, explored=full marker). New API: `/api/campaigns/:id/explore` POST with scan_level parameter. Probe travel tracked in fleet system (#5).

**Scope Doc Update:** Promote F5.2 and F5.3 from "Schema + Stub APIs" to "Designed — Ready for Implementation."

---

### 13. Strategic Event Cards with Player Choices
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Milestone D6](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD), [03_SIMULATION_ENGINE.MD — Strategic Events](../00_SCOPE/03_SIMULATION_ENGINE.MD)  
**Existing Code:** 9 event types defined in simulation engine, `useTauriEvents.ts`

**Current state:** Events are generated by the simulation (Scientific Discovery, Border Conflict, Migration Wave, etc.) but only appear in an API event log. No player interaction.

**Enhancement:**
- **Rich event card UI** — Full-screen modal with:
  - Illustration (procedurally generated or templated per event type)
  - Narrative text with context (which system, which faction, what happened)
  - 2–4 player choice buttons with previewed consequences
- **Choice consequences:**
  - **Scientific Discovery:** "Fund research expansion (+2 tech, -500 resources)" or "Publish findings (+influence, +cohesion)" or "Classify (military tech only)"
  - **Border Conflict:** "Negotiate (-tension, -influence)" or "Reinforce (deploy patrol, +tension)" or "Cede territory (-systems, -tension)"
  - **Resource Shortage:** "Emergency rationing (-population growth)" or "Import surge (-credits, +supply)" or "Expand mining (+extraction, -ecology)"
- **Event queue** — Multiple pending events stack; player resolves them in order
- **Event history journal** — Scrollable timeline of past events with outcomes
- **Sound cues** — Distinct audio chimes per event severity (info, warning, critical)

**Implementation:** `EventCardModal.tsx` (~600 LOC) with animation transitions. Event choice API: `/api/campaigns/:id/events/:id/resolve` POST with `choice_id`. Simulation engine extended to branch on player choices. Add `player_choices` column to event schema.

**Scope Doc Update:** Resolve open question [S5](../00_SCOPE/08_OPEN_QUESTIONS.MD) ("What defines winning?") — incorporate event choices as campaign scoring mechanism: "Score derived from event resolutions, colony metrics, and optional objectives."

---

### 14. Technology Research Tree
**Scope Ref:** [03_SIMULATION_ENGINE.MD — Economy](../00_SCOPE/03_SIMULATION_ENGINE.MD), [05_GAME_CLIENT_ROADMAP.MD — D4 Research Tree](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** Tech levels 0–20 modeled in simulation engine. `tech_multiplier = 1.0 + (tech_level × 0.15)`

**Current state:** Tech level is a single scalar per faction that increases from discovery events. No player-directed research or tree structure.

**Enhancement:**
- **Research tree visualization** — Node graph with 5 branches:
  - **Propulsion** (faster ships: 0.05c → 0.08c → 0.12c → 0.15c → 0.20c)
  - **Life Support** (larger crews, longer missions, lower attrition)
  - **Mining & Industry** (extraction efficiency, new material processing, megastructures)
  - **Habitation** (carrying capacity multipliers, terraforming prerequisites)
  - **Sensors & Comms** (scan range, scan depth, FTL communication research)
- **Research points** — Generated per tick from population × tech_level × research_allocation
- **Unlock gates** — Each node requires prerequisite nodes + point threshold. Unlocking a node grants specific bonuses.
- **Faction divergence** — Different factions prioritize different branches → emergent specialization
- **Breakthrough events** — Random chance of skipping a node (weighted by investment + event luck)
- **Visual:** Interactive zoomable tree with glowing unlocked nodes, dimmed locked nodes, animated research-in-progress indicator

**Implementation:** `TechTreePanel.tsx` (~900 LOC) with SVG/Canvas node graph. Tech tree definition in `tech_tree.json` (~50 nodes across 5 branches). Backend: extend simulation engine with per-faction research allocation and node unlock logic.

**Scope Doc Update:** Expand [03_SIMULATION_ENGINE.MD — Economy](../00_SCOPE/03_SIMULATION_ENGINE.MD) "tech_multiplier" section to full tech tree specification with node definitions and unlock dependencies.

---

### 15. Sound Engine & Ambient Soundscapes
**Scope Ref:** New feature — not currently in any scope doc  
**Existing Code:** None

**Current state:** Completely silent application.

**Enhancement:**
- **Spatial audio engine** using Web Audio API (Tauri WebView supports it) or native Rust audio (rodio/cpal)
- **Ambient layers:**
  - **Galaxy view** — Deep space drone, subtle cosmic radiation hiss
  - **System view** — Stellar hum pitched to spectral type (M-dwarf = low rumble, O-star = high whine), orbital mechanics whoosh
  - **Planet surface** — Wind (velocity from atmosphere model), tectonic rumble, ocean surf (if water present), volcanic hiss
  - **Colony** — Industry sounds scaled to infrastructure level, population murmur
- **UI feedback sounds** — Click, select, dispatch, alert, event card reveal, scan complete
- **Music system** — Procedural ambient music that shifts with game state:
  - Exploration phase → wonder/curiosity themes
  - Conflict → tension/urgency
  - Prosperity → warm/triumphant
- **Volume mixer** — Separate sliders for Master, Music, Ambient, UI, Events

**Implementation:** `SoundEngine.ts` (~400 LOC) using Web Audio API with AudioContext, GainNodes per channel, and ConvolverNode for reverb. Ambient sound samples (Creative Commons licensed). Music: procedural using Tone.js or pre-composed stems.

**Scope Doc Update:** Add new section to [05_GAME_CLIENT_ROADMAP.MD](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD):
```
### Milestone D8: Audio & Immersion
| Feature | Priority | Description |
|---------|----------|-------------|
| Spatial ambient soundscapes | P2 | Context-aware audio per view layer |
| UI sound feedback | P2 | Click, alert, event, scan sounds |
| Procedural music system | P3 | Mood-reactive ambient music |
```

---

### 16. Photo Mode & Screenshot Tools
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Desktop-only Divergence](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) (file system access)  
**Existing Code:** Tauri file system commands available, `src-tauri/src/gpu/planet_viewport.rs` can render to texture

**Current state:** No screenshot capability. Viewport renders to screen only.

**Enhancement:**
- **Photo mode toggle** (F12) — Hides all UI, enables free camera with DOF + vignette post-processing
- **Depth of field** — Gaussian blur based on depth buffer distance from focus point, adjustable aperture slider
- **Resolution multiplier** — Render at 2×, 4×, or 8× viewport resolution for ultra-high-res captures
- **Post-processing filters** — Bloom intensity, color temperature, exposure, contrast, film grain
- **Composition guides** — Rule of thirds grid, golden ratio spiral (toggle)
- **Auto-save** — Screenshots saved to `~/Pictures/ExoMaps/` with metadata EXIF (system name, camera position, timestamp)
- **Timelapse recorder** — Capture frame every N simulation ticks → export as image sequence or MP4

**Implementation:** Extend `planet_viewport.rs` with `render_to_texture(width, height)` method. New `PhotoModeOverlay.tsx` (~300 LOC). Post-processing via compute shader or fragment shader pass. Tauri `fs` plugin for saving.

**Scope Doc Update:** Add F8.12 to [01_FUNCTIONALITY.MD](../00_SCOPE/01_FUNCTIONALITY.MD): "Photo mode with high-resolution capture, post-processing, and timelapse recording."

---

### 17. Particle Effects — Belts, Comets, Stellar Wind
**Scope Ref:** [02_ASTROPHYSICAL_MODELING.MD — Belt Inference](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Existing Code:** `src-tauri/src/gpu/compute.rs` (GPU compute infrastructure)

**Current state:** Belts are data entities with no particle visualization. No comet or stellar wind effects.

**Enhancement:**
- **Asteroid belt particles** — GPU compute shader maintaining 50K–500K particles per belt with Keplerian orbital motion. LOD: full particles nearby, point sprites far away, invisible at galaxy scale.
- **Comet tails** — Rare procedural comets on highly eccentric orbits. Tail shader: elongated billboard aligned to velocity vector with opacity falloff.
- **Stellar wind** — Radial particle stream from star, visible in system view. Density and velocity from stellar luminosity class.
- **Accretion disk** (for close binary systems) — Dense particle ring with thermal glow gradient (inner=hot white, outer=cool red)
- **Debris field** — Post-conflict or post-collision event generates temporary particle cloud around affected system
- **Meteor showers** — On planet surface view, occasional streaks across sky (viewport-space effect)

**Implementation:** New `particles.wgsl` compute + render shader (~300 LOC). `ParticleSystem` struct in new `particles.rs` Rust module. Position update in compute pass, render as instanced quads. IPC: `particles_set_config`, `particles_toggle`.

**Scope Doc Update:** Add to [05_GAME_CLIENT_ROADMAP.MD — Rendering Architecture](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) scene graph: new `ParticleEffects` node under System Layer.

---

### 18. Ocean Fluid Dynamics & Tidal Effects
**Scope Ref:** [03_SIMULATION_ENGINE.MD — Future: Terraforming](../00_SCOPE/03_SIMULATION_ENGINE.MD)  
**Existing Code:** `src-tauri/src/simulation/climate.rs`, surface shader in `planet.wgsl`

**Current state:** Oceans are flat blue regions on the heightmap with static specular. No wave dynamics or tidal modeling.

**Enhancement:**
- **Animated ocean surface** — Gerstner wave shader for realistic wave motion, with wave height driven by:
  - Wind speed (from climate model)
  - Moon tidal force (gravitational influence from largest moon × distance)
  - Fetch distance (ocean basin size from heightmap analysis)
- **Tidal bulge visualization** — Slight mesh deformation toward parent star / largest moon, visible at exaggerated scale (toggle)
- **Subsurface scattering** — Translucent water appearance with depth-dependent color (shallow=turquoise, deep=navy)
- **Frozen ocean state** — Below freezing equilibrium temp: ocean surface becomes ice with cracks and pressure ridges (normal map swap)
- **Ocean current visualization** — Toggle overlay showing Coriolis-driven circulation patterns as flow arrows
- **Shoreline foam** — Procedural foam strip along coast heightmap contour

**Implementation:** Extend `planet.wgsl` ocean section with Gerstner wave functions (~100 LOC WGSL). Tidal parameters from `climate.rs` → `planet_set_ocean_params` IPC. Ice/liquid state determined by equilibrium temperature.

**Scope Doc Update:** Add to [02 — Simulation-Facing Outputs](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD):
```
| `ocean_coverage_fraction` | f(mass, temperature, volatiles) | Visual: ocean extent, economy: agriculture |
| `tidal_force_index`       | f(moon_mass, orbital_distance)  | Visual: wave height, geology: tidal heating |
```

---

### 19. Weather Systems & Atmospheric Circulation
**Scope Ref:** [02_ASTROPHYSICAL_MODELING.MD — Atmosphere Estimation](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD)  
**Existing Code:** `src-tauri/src/simulation/climate.rs`, `atmosphere_v2.rs`

**Current state:** Climate model exists in Rust simulation code. No weather visualization on planet surface.

**Enhancement:**
- **Global circulation cells** — Hadley/Ferrel/Polar cell patterns visible as cloud band movement directions
- **Cyclone generation** — Procedural low-pressure systems that form over warm ocean areas, track poleward, and dissipate
- **Precipitation overlay** — Color-coded regions showing rain/snow probability (maps to biome fertility)
- **Temperature gradient** — Heat-map overlay from equator (warm) to poles (cold), modified by altitude and ocean currents
- **Seasonal variation** — If planet has axial tilt: weather patterns shift over orbital period (accelerated in time-lapse)
- **Dust storms** — On thin-atmosphere rocky worlds (Mars-like): periodic global dust storms that obscure terrain
- **Lightning** — During cyclone events on gas giants: brief flash illumination in cloud layer

**Implementation:** `WeatherOverlay.tsx` (~400 LOC) controlling overlay toggle and parameters. Weather state computed in `climate.rs` per simulation tick. GPU visualization: temperature and precipitation as blended color overlays on terrain, cyclones as animated vortex sprites.

**Scope Doc Update:** Add to [02 — Future Advanced Modeling](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD):
```
| **Weather simulation**      | Per-tick climate state with circulation, precipitation, storms | Climate model + equilibrium temp |
| **Seasonal variation**      | Axial tilt → insolation variation → weather pattern shifts     | Orbital elements + rotation axis  |
```

---

### 20. Multi-Window Detachable Panels
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Divergence Points](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) ("Multiple windows: map + detail + control")  
**Existing Code:** Single window with `DesktopLayout.tsx` sidebar + main panel

**Current state:** All panels crammed into single window layout. Planet editor competes for space with orrery and system list.

**Enhancement:**
- **Detachable panels** — Any panel (Planet Editor, Colony Manager, Fleet Command, Tech Tree, Event Log) can be popped out to a separate native window via Tauri `WebviewWindow::new()`
- **Multi-monitor support** — Place galaxy map on primary monitor, planet surface on secondary, colony manager on third
- **Layout presets:**
  - **Explorer** — Galaxy map (main) + System detail (side)
  - **Governor** — Colony manager (main) + Fleet roster (side) + Simulation HUD (bottom)
  - **Scientist** — Planet surface (main) + Composition/Interior/Atmosphere panels (tabbed side)
  - **Commander** — Galaxy map with fleet overlay (main) + Ship designer (side)
- **Drag-and-dock** — Panels can be dragged to screen edges to snap/dock
- **Persistent layout** — Layout saved per campaign in local cache (`generation_store.rs`)

**Implementation:** Tauri 2 multi-window API. Each detachable panel becomes a separate route. Window manager state in `useWindowLayout` hook. Layout serialized to JSON in local cache. ~500 LOC hook + ~200 LOC layout config.

**Scope Doc Update:** Promote Multi-window from "Planned" to "Designed" in [05_GAME_CLIENT_ROADMAP.MD divergence table](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD).

---

### 21. Gamepad & HOTAS Controller Support
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — Input Binding Spec](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** Input binding table exists in scope doc with keyboard + mouse + gamepad columns

**Current state:** Only keyboard and mouse inputs implemented. Gamepad columns defined but not wired.

**Enhancement:**
- **Gamepad API integration** — Navigator.getGamepads() polling in WebView, or native gilrs crate in Rust for direct HID access
- **Analog stick navigation** — Left stick: pan/fly camera. Right stick: rotate/orbit. Triggers: zoom in/out.
- **D-pad menu navigation** — Navigate panels, select systems, cycle through planet list
- **Button mapping:** A=Select, B=Back, X=Toggle overlay, Y=Open quick actions, Start=Pause/Resume sim, Select=Map toggle, Bumpers=Cycle layer
- **HOTAS support** — Throttle maps to camera fly-through speed, hat switch for camera pan, trigger for warp-to-target
- **Vibration feedback** — Rumble on: system arrival, event alert, volcanic eruption, conflict notification
- **Rebindable controls** — Settings panel with visual controller diagram, click-to-rebind any action

**Implementation:** Native Rust layer using `gilrs` crate for gamepad/joystick detection and input. Events forwarded to frontend via Tauri events (`tauri::Event::emit`). `InputManager.ts` (~300 LOC) mapping raw inputs to game actions. Settings stored in local config.

**Scope Doc Update:** Promote Input Binding Spec "Gamepad" column from draft to **Status: Designed.** Add HOTAS column.

---

### 22. Terraforming Simulation
**Scope Ref:** [03_SIMULATION_ENGINE.MD — Future: Terraforming](../00_SCOPE/03_SIMULATION_ENGINE.MD), [00_VISION_AND_GOALS.MD — Future Horizon](../00_SCOPE/00_VISION_AND_GOALS.MD)  
**Existing Code:** `terraforming_difficulty` field in inference pipeline, `composition.rs`, `atmosphere_v2.rs`, `climate.rs`

**Current state:** `terraforming_difficulty` is computed per planet. Listed as "Future Horizon" in scope. No gameplay implementation.

**Enhancement:**
- **Terraforming project system** — Multi-century planetary modification campaigns:
  - **Phase 1: Atmosphere seeding** (50–200 years) — Deploy atmospheric processors, import greenhouse gases
  - **Phase 2: Temperature regulation** (100–500 years) — Orbital mirrors, albedo modification
  - **Phase 3: Hydrosphere creation** (200–1000 years) — Comet bombardment, ice cap melting
  - **Phase 4: Biosphere bootstrap** (500–2000 years) — Lichen, algae, engineered organisms
- **Progress visualization** — Planet surface visually transforms over time: barren → atmospheric haze → pooling water → green patches → habitable
- **Resource cost** — Terraforming consumes massive resources, creating economic sink and trade demand
- **Milestone events** — "First liquid water on Proxima b!" event cards at each phase transition
- **Failure modes** — Runaway greenhouse, atmospheric collapse, ecosystem crash if prerequisites not met
- **Before/after split view** — Drag slider to compare current vs projected final state

**Implementation:** `TerraformingPanel.tsx` (~700 LOC). Backend: `terraforming.rs` module in simulation with per-tick progress accumulation. Planet visual state interpolates between current composition → target composition based on terraforming progress (0.0–1.0 uniform).

**Scope Doc Update:** Move Terraforming from "Future Horizon (Post-MVP)" in [00_VISION_AND_GOALS.MD](../00_SCOPE/00_VISION_AND_GOALS.MD) to Phase 09 feature list in [07_IMPLEMENTATION_PHASES.MD](../00_SCOPE/07_IMPLEMENTATION_PHASES.MD).

---

### 23. Political Map & Diplomacy Interface
**Scope Ref:** [03_SIMULATION_ENGINE.MD — Politics](../00_SCOPE/03_SIMULATION_ENGINE.MD), [05_GAME_CLIENT_ROADMAP.MD — D3 Strategic Overlays](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** Cohesion/tension/influence/governance model in simulation engine. No frontend visualization.

**Current state:** Political model runs server-side. Desktop has no political map or diplomacy controls.

**Enhancement:**
- **Political territory overlay** — Voronoi tessellation on galaxy map colored by faction, with:
  - Solid core regions (high cohesion)
  - Hatched border regions (contested, tension > 0.5)
  - Dotted periphery (low cohesion, secession risk)
- **Faction info panel** — Per-faction card showing: governance type, cohesion meter, tech level, population, territory count, allies/rivals
- **Diplomacy matrix** — Grid view of all faction pairs with tension color (green=ally, yellow=neutral, red=hostile)
- **Diplomatic actions** (for Faction Leader mode):
  - Propose trade agreement (+trade volume, -tension)
  - Form alliance (mutual defense, shared scan data)
  - Issue ultimatum (+tension, may gain territory)
  - Embargo (block trade routes to target faction)
- **Independence tracker** — Highlighted systems at risk of secession with countdown/probability meter
- **Faction comparison** — Side-by-side stats of two factions for strategic planning

**Implementation:** `PoliticalMapOverlay.tsx` (~500 LOC) for galaxy map layer. `DiplomacyPanel.tsx` (~600 LOC) for faction management. Backend: extend simulation API with `/api/campaigns/:id/diplomacy/:faction_id/action` POST.

**Scope Doc Update:** Resolve [S6](../00_SCOPE/08_OPEN_QUESTIONS.MD) ("Should AI factions have same mechanics?") → "Yes, symmetric mechanics with configurable AI strategy profiles (aggressive, diplomatic, economic, expansionist)."

---

### 24. Discovery Journal & Exploration Log
**Scope Ref:** [05_GAME_CLIENT_ROADMAP.MD — D6 Discovery Journal](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD)  
**Existing Code:** `useTauriEvents.ts`, campaign exploration table in DB

**Current state:** Listed as P3 in Game Client Roadmap. No implementation.

**Enhancement:**
- **Codex-style journal** — Organized by category: Stars, Planets, Belts, Factions, Events, Technology
- **Auto-populated entries** — Each discovered system gets a journal page with:
  - Discovery date and scan level
  - Star properties with confidence tier badges
  - Planet gallery (thumbnail renders from GPU)
  - Player notes (editable free-text field, saved per campaign)
  - Resource summary and colonization assessment
- **Bookmarks** — Star any entry for quick access
- **Statistics dashboard:**
  - Systems explored: 47/1,438 (3.3%)
  - Habitable planets found: 12
  - Total survey distance traveled: 847 LY
  - Rarest discovery: "Super-Jupiter in habitable zone of M-dwarf"
- **Achievement badges** — "First Contact," "Galactic Cartographer (100 systems)," "Needle in a Haystack (rare element deposit)," "Edge of Known Space (survey beyond 50 LY)"
- **Export** — Save journal as PDF or markdown for sharing

**Implementation:** `DiscoveryJournal.tsx` (~800 LOC) with tabbed Codex layout. Journal data derived from campaign exploration table + system data. Player notes stored in local campaign cache. Achievement definitions in `achievements.json`. Export via Tauri `dialog::save_file` + markdown generation.

**Scope Doc Update:** Promote Discovery Journal from P3 to **P2** in [05_GAME_CLIENT_ROADMAP.MD — D6](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD). Add achievement system specification.

---

### 25. Benchmark Arena & GPU Stress Test
**Scope Ref:** [08_OPEN_QUESTIONS.MD — E3](../00_SCOPE/08_OPEN_QUESTIONS.MD) ("What profiling regime is needed?")  
**Existing Code:** `src-tauri/src/gpu/benchmark.rs`, `src/components/GpuStatusBar.tsx`

**Current state:** `benchmark.rs` exists with basic GPU profiling. `GpuStatusBar.tsx` shows adapter info. No interactive benchmark.

**Enhancement:**
- **Benchmark scene** — Standardized test environment:
  - **Scene 1: Star field** — Render 10,000 star particles, measure draw call overhead + instancing throughput
  - **Scene 2: Planet close-up** — Single planet at max LOD (L5, 16K faces), full PBR + atmosphere + clouds + aurora, measure fragment throughput
  - **Scene 3: System stress** — 12 planets + 4 belts (500K particles) + ring system + ships, measure total scene complexity
  - **Scene 4: Compute** — Terrain generation for 8 planets simultaneously, measure compute shader throughput
- **Live metrics overlay** — FPS, frame time (ms), GPU memory used, draw calls, triangle count, compute dispatch count
- **Benchmark score** — Composite score (weighted blend of all scenes), saved to leaderboard file
- **Quality presets** — Low / Medium / High / Ultra / Custom, adjusting: MSAA (Off/2x/4x/8x), shadow resolution, particle count, LOD bias, atmosphere samples
- **Auto-detect** — On first launch, run quick benchmark → auto-select quality preset for target 60fps

**Implementation:** Extend `benchmark.rs` with structured scene runners (~300 LOC). `BenchmarkArena.tsx` (~400 LOC) with scene selector and live graph (fps over time using canvas sparkline). Quality presets in `gpu_config.json`. Auto-detect logic in `main.rs` on first launch.

**Scope Doc Update:** Resolve [E3](../00_SCOPE/08_OPEN_QUESTIONS.MD) → "GPU profiling via built-in benchmark arena with 4 standardized scenes. Quality auto-detection on first launch. Live metrics overlay available at all times via F3."

---

## Implementation Priority Roadmap

### Wave 1 — Core Game Loop (P1, ~4 weeks)
| # | Enhancement | Est. LOC | Depends On |
|---|-------------|----------|------------|
| 1 | Fly-Through Camera | ~600 | — |
| 6 | Time Controls & Sim HUD | ~500 | — |
| 12 | Fog-of-War Exploration | ~700 | — |
| 10 | Resource Scanning | ~600 | #12 |
| 5 | Fleet Command | ~800 | #12 |
| 23 | Political Map & Diplomacy | ~1100 | — |

### Wave 2 — Planet Realism (P1–P2, ~3 weeks)
| # | Enhancement | Est. LOC | Depends On |
|---|-------------|----------|------------|
| 2 | Ring Systems | ~700 | — |
| 3 | Dynamic Clouds | ~400 | — |
| 7 | LOD Terrain | ~800 | — |
| 17 | Belt/Comet Particles | ~500 | #2 |
| 18 | Ocean Dynamics | ~300 | #7 |

### Wave 3 — Depth & Strategy (P2, ~4 weeks)
| # | Enhancement | Est. LOC | Depends On |
|---|-------------|----------|------------|
| 4 | Colony Builder | ~900 | #6 |
| 11 | Ship Designer | ~1300 | #5 |
| 13 | Event Cards | ~700 | #6 |
| 14 | Tech Tree | ~1000 | #4 |
| 22 | Terraforming | ~800 | #4, #7, #3 |

### Wave 4 — Immersion & Polish (P2–P3, ~3 weeks)
| # | Enhancement | Est. LOC | Depends On |
|---|-------------|----------|------------|
| 8 | Volcanic/Tectonic | ~500 | #7 |
| 9 | Aurora & Magnetic | ~400 | #3 |
| 15 | Sound Engine | ~500 | — |
| 16 | Photo Mode | ~400 | — |
| 19 | Weather Systems | ~500 | #3 |
| 24 | Discovery Journal | ~900 | #12 |

### Wave 5 — Platform (P3, ~2 weeks)
| # | Enhancement | Est. LOC | Depends On |
|---|-------------|----------|------------|
| 20 | Multi-Window | ~700 | — |
| 21 | Gamepad/HOTAS | ~400 | — |
| 25 | Benchmark Arena | ~700 | — |

**Total estimated new code: ~16,000 LOC (~10K TypeScript + ~4K Rust + ~2K WGSL)**

---

## Scope Doc Changes Summary

| Document | Proposed Changes |
|----------|-----------------|
| [00_VISION_AND_GOALS.MD](../00_SCOPE/00_VISION_AND_GOALS.MD) | Move terraforming from "Future Horizon" to active roadmap |
| [01_FUNCTIONALITY.MD](../00_SCOPE/01_FUNCTIONALITY.MD) | Add F8.10–F8.12 (clouds, aurora, photo mode); resolve F3.6 status |
| [02_ASTROPHYSICAL_MODELING.MD](../00_SCOPE/02_ASTROPHYSICAL_MODELING.MD) | Add ring visual type, tectonic/volcanic fields, ocean/tidal fields, weather simulation to outputs |
| [03_SIMULATION_ENGINE.MD](../00_SCOPE/03_SIMULATION_ENGINE.MD) | Add colony infrastructure table, delta-V formulas, tech tree spec, terraforming phases |
| [05_GAME_CLIENT_ROADMAP.MD](../00_SCOPE/05_GAME_CLIENT_ROADMAP.MD) | Promote D2–D6 status; add D8 (Audio); add HOTAS; update LOD strategy; update scene graph |
| [07_IMPLEMENTATION_PHASES.MD](../00_SCOPE/07_IMPLEMENTATION_PHASES.MD) | Add terraforming to Phase 09; update Phase 6G deliverables |
| [08_OPEN_QUESTIONS.MD](../00_SCOPE/08_OPEN_QUESTIONS.MD) | Resolve S1 (fleet routing), S5 (winning), S6 (AI factions), E3 (GPU profiling) |
