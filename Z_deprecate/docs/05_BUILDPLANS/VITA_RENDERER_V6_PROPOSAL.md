# VITA Renderer v6 — Full Architectural Proposal
**Date:** 2026-03-17
**Status:** Proposal — pending approval before implementation
**Scope:** Complete rethink of ProceduralWorld fragment shader pipeline

---

## Executive Summary

Three problems in the current renderer expose the same root architectural flaw: **visual layers are applied independently rather than composited through a unified zone transition system.**

The result:
- Zone boundaries are hard polygon edges because only `zoneChar` is blended, not the actual rendering
- Ice caps form a dome above the atmosphere because `_gZoneElev` lifts polar terrain into the atmosphere shell's alpha zone
- Icebergs are 2D scatter-spray across a wide latitude band instead of a dramatic 3D ring at the calving front

This document specifies the corrected architecture from world-generation sequencing through every rendering module, in the order things must be solved.

---

## Part I: World Generation Pipeline

The generation pipeline must flow **composition → orbit → atmosphere → climate → zones → terrain**, not the current "terrain first, paint zones over it" approach.

### 1.1 Physical Characterization (derive.ts — extend)

Every downstream visual decision must trace to a physical input. Currently stellar spectral class and axial tilt are ignored. Wire them in:

| Input | Currently Used | Missing Effect |
|-------|----------------|----------------|
| `mass` | Yes | — |
| `temperature` | Yes | — |
| `tidalHeating` | Yes | — |
| `starSpectralClass` | Ignored | Stellar UV (affects atmosphere stripping, surface weathering tint) |
| `axialTilt` | Ignored | Polar amplification, seasonal band width, ice line latitude skew |
| `eccentricity` | Ignored | Heating pulse per orbit → volatile migration |
| `rotationPeriod` | Ignored | Coriolis strength → atmospheric band width |
| `oceanChemistry` | Ignored | Water vs. sulfuric vs. methane ocean color/albedo |

**New outputs from derive.ts:**
- `iceLine: number` — absolute sin(lat) where ice begins (drives polar zone placement, ice cap rendering)
- `hadleyWidth: number` — width of ITCZ in lat fraction (drives cloud band widths)
- `tectonicAge: number` — 0=fresh basalt, 1=ancient craton (drives terrain roughness, crater density)
- `atmChemistry: 'N2-O2' | 'CO2' | 'H2SO4' | 'CH4' | 'H2'` — drives ocean color, sky color, haze tint

### 1.2 Climate → Ice Line (new, simple)

```
iceLine_sin_lat = 1.0 - iceCaps * 0.80    // exact boundary on unit sphere
iceLineBlur     = 0.06 + atmThickness * 0.08   // boundary fuzz width
```

The ice line is a fundamental physical quantity that drives three separate systems:
- Zone placement (POLAR_ICE role assignment)
- Ice cap rendering (where the icecap shader activates)
- Iceberg system (where calving occurs = `iceLine ± iceLineBlur`)

Both zones.ts and the shader must reference the same ice line formula. Currently there is drift between the JS iceLine and the shader's hardcoded `1.0 - iceCaps * 0.12` (which is wrong — it should be `* 0.80` to span the full latitude range).

---

## Part II: Zone Boundary Blending

**The core problem.** The zone system tracks the nearest two zones per pixel (`zi1`, `zi2`, `zr1`, `zr2`) and already has a boundary blend weight (`bdBlend`). But only `zoneChar` (the character hash vector) is actually blended. Everything downstream — role-driven height biases, ocean zone identification, terrain feature density, land coloring — reads the hard `zoneRole` of zone 1 and switches abruptly at the boundary.

### 2.1 What Must Be Blended

Every rendering decision that reads `zoneRole` must instead read a **blended role float** computed at the boundary.

For each zone property, compute a zone-1 value and a zone-2 value, then lerp:

```glsl
// After zone search, before terrain height:
float isShelf_z1   = step(6.5, zr1) * step(zr1, 7.5);
float isRidge_z1   = step(7.5, zr1) * step(zr1, 8.5);
float isTrench_z1  = step(8.5, zr1) * step(zr1, 9.5);
float isPolar_z1   = step(0.5, zr1) * step(zr1, 1.5);
float isCraton_z1  = step(4.5, zr1) * step(zr1, 5.5);
float isRift_z1    = step(5.5, zr1) * step(zr1, 6.5);
float elevBias_z1  = elevBiasForRole(zr1);

float isShelf_z2   = step(6.5, zr2) * step(zr2, 7.5);
float isRidge_z2   = step(7.5, zr2) * step(zr2, 8.5);
// ... etc.
float elevBias_z2  = elevBiasForRole(zr2);

// Blend weight: bdBlend is 0=in zone1, 1=near boundary, drives smooth transition
float bw = smoothstep(0.0, 0.55, zd2 - zd1 + bdNoise) * 0.85;

// Blended properties used throughout the shader:
float bIsShelf   = mix(isShelf_z1,  isShelf_z2,  bw);
float bIsRidge   = mix(isRidge_z1,  isRidge_z2,  bw);
float bIsTrench  = mix(isTrench_z1, isTrench_z2, bw);
float bIsPolar   = mix(isPolar_z1,  isPolar_z2,  bw);
float bElevBias  = mix(elevBias_z1, elevBias_z2, bw);
```

Key insight: `bw` is now a smooth ramp across the boundary. At `bw=0.0` the pixel is fully in zone1. At `bw=0.85` (at the exact boundary midpoint) the pixel is an equal mix of both zones. Features fade in/out continuously rather than snapping.

### 2.2 Blend Width Calibration

Current `bdBlend` uses `smoothstep(0.0, 0.38, ...)`. This is too narrow — it produces a 38% of zone-radius blend, which still appears as a visible seam because features like kelp beds, coral color, and vent glow are crisp.

Proposed: **blend width = `0.55` for color/features, `0.20` for the role-driven elevation bias** (narrower for elevation to avoid terrain discontinuities at zone boundaries being visible as terrain ridges).

### 2.3 Terrain Height Zone Blending

The `_gZoneElev` global must use `bElevBias` (blended), not the hard zone-1 bias:

```glsl
_gZoneElev = bElevBias;  // smoothly interpolated across boundaries
```

This eliminates the terrain-height step at zone boundaries that currently creates visible ridges in ocean floor bathymetry.

---

## Part III: Ice Cap Renderer Rewrite

**The problem.** POLAR_ICE zones currently receive `_gZoneElev = 0.0` (correct — no elevation). But the terrain height FBM is still generating normal 0.3–0.7 range heights under the ice. Combined with the ice zone's high latitude (near pole), the atmosphere shell wraps tightly there. From the viewer's perspective, the ice cap appears to dome above the atmosphere because:

1. The base terrain under the ice is at the same or higher elevation as adjacent terrain
2. The atmosphere sphere (r=1.04+) has its inner surface meeting the pole at a steep angle
3. The ice surface visual (bright white from icecaps.ts) fills all the way to the atmosphere sphere's inner surface

**The fix requires three coordinated changes:**

### 3.1 Flatten Terrain Under Ice Zones (terrainHeight)

For POLAR_ICE pixels, the terrain FBM amplitude should be dramatically reduced. Ice sheets are among the flattest surfaces in nature — they fill and smooth all topography beneath them.

```glsl
// Inside terrainHeight(), after computing h:
float iceSmooth = step(0.5, _gIsPolar);  // set alongside _gZoneElev
h = mix(h, 0.42 + (h - 0.42) * 0.08, iceSmooth);  // flatten to near-constant height
```

The result: POLAR_ICE terrain sits at h≈0.42 everywhere, giving depth01 a predictable value and preventing any high-terrain pixel from poking through the ice into the atmosphere.

### 3.2 Remove Atmosphere Interaction at Poles

The atmosphere shader (`atm.frag.ts`) uses rim-glow based on `dot(N, viewDir)`. At the poles when viewed from the side, the rim integrates through a very shallow angle, producing a thick bright fringe. This is correct atmospheric scattering for a world with atmosphere.

But for ice worlds, this bright polar rim is being mistaken by the user for the ice cap "dome." The fix is to NOT fix the atmosphere shader — it's correct. What needs fixing is (3.1): flatten the terrain so the ice cap's visual extent does not extend above the natural atmospheric rim height.

### 3.3 Ice Zone Boundary — Crisp Inner Edge, Blended Outer Edge

The ice/terrain boundary (inner side, toward the pole) should be crisp — this is the cliff face of the ice sheet grounded on bedrock. The boundary (outer side, toward the equator) should use the zone blending system from Part II to fade into tundra/ocean.

```glsl
// In applyIceCaps():
float innerEdge = smoothstep(0.004, 0.000, provEdge);  // crisp cliff toward pole interior
float outerFade = smoothstep(0.0, bElevBias_blend, provEdge);  // fades by zone distance
```

This creates the appearance of a massive glacial sheet with a sheer cliff at its calving front, fading gradually into snowy tundra on the approach from below.

---

## Part IV: Iceberg Ring System

**The problem.** Current icebergs are:
1. Distributed across `absLat > 0.38` — a huge 52° latitude swath
2. Rendered as 2D Worley cells projected onto the sphere surface
3. Activated at low density with wide cell spacing (20× scale)

**What was requested:** A ring of 3D clustered ice chunks hugging the calving boundary, visible from space as a distinct belt — like Saturn's rings in concept, like a floating pack-ice margin in reality.

### 4.1 Narrow the Activation Zone

Icebergs only exist in a thin annular band at the ice margin:

```glsl
float iceMargin = 1.0 - uIceCaps * 0.80;         // ice line (matches zones.ts)
float bergBand  = exp(-pow((absLat - iceMargin) / 0.035, 2.0));  // ±3.5% lat width
// bergBand is 1.0 AT the ice line, falls to ~0.05 at ±6% away
if(bergBand < 0.04) return;  // outside the ring — skip entirely
```

The `0.035` half-width corresponds to roughly ±350km on an Earth-sized world — geologically realistic for a pack-ice calving zone.

### 4.2 3D Multi-Lobe Worley Cluster

Each Worley cell contains multiple overlapping lobes that create a popcorn/iceberg-cluster appearance. The key is sampling at **three height offsets** to simulate 3D ice above the water:

```glsl
// Berg sampling at 3 altitude offsets above surface:
vec3 bergBase = pos * 28.0 + driftVec;  // base level (waterline)
vec3 bergMid  = pos * 28.0 * 0.96 + driftVec;  // 4% shrink = mid-height slice
vec3 bergTop  = pos * 28.0 * 0.88 + driftVec;  // 12% shrink = top

// Three separate Worley lookups:
float dBase = worleyDist(bergBase);
float dMid  = worleyDist(bergMid) + noise(bergMid * 3.0) * 0.08;
float dTop  = worleyDist(bergTop) + noise(bergTop * 4.5) * 0.12;

// Each level is slightly smaller than the one below → tapered berg shape:
float bergShapeBase = smoothstep(bergSize,       bergSize * 0.40, dBase);
float bergShapeMid  = smoothstep(bergSize * 0.75, bergSize * 0.25, dMid);
float bergShapeTop  = smoothstep(bergSize * 0.50, bergSize * 0.10, dTop);

// Composite from top down: top overrides mid overrides base
float bergShape = max(bergShapeBase, max(bergShapeMid * 0.85, bergShapeTop * 0.65));
```

### 4.3 Parallax-Simulated Height

A fake parallax offset based on view angle creates the illusion that the berg has actual height above the water:

```glsl
// Viewer-angle based parallax: tilted view reveals "side face" of berg
float viewAngle = dot(normalize(V), N);   // 1=top-down, 0=grazing
vec2 parallaxOff = V.xz * (1.0 - viewAngle) * 0.018;  // shift UV at grazing angles
// Re-sample berg noise at parallaxed position to show side face:
float bergSide = worleyDist(bergBase + vec3(parallaxOff.x, 0, parallaxOff.y));
float sideShape = smoothstep(bergSize * 0.45, bergSize * 0.10, bergSide);
```

### 4.4 Visual Layering

```glsl
// Melt slush (widest, lowest opacity — disturbed water ring)
float slush = smoothstep(bergSize * 2.0, bergSize * 1.1, dBase)
            * (1.0 - smoothstep(bergSize * 1.0, bergSize * 1.5, dBase));
color = mix(color, color * 0.88 + vec3(0.05, 0.12, 0.20), slush * 0.28 * bergBand);

// Submerged face: translucent turquoise (50-70% of berg volume is underwater)
float submergedFrac = bergH3 * 0.35 + 0.25;  // 25-60% above waterline
vec3 underwaterIce  = vec3(0.06, 0.42, 0.70) * mix(0.30, 0.65, depth01 * 1.5);
color = mix(color, underwaterIce, bergShapeBase * (1.0 - submergedFrac) * bergBand * 0.80);

// Above-waterline: bright glacial white with sun highlight + shadow side blue
vec3 aboveIce = mix(vec3(0.82, 0.90, 0.96) * 0.65 + vec3(0.02, 0.05, 0.16),
                    mix(vec3(0.82, 0.90, 0.96), vec3(0.96, 0.98, 1.00), NdotL),
                    smoothstep(-0.1, 0.3, dot(N, L)));
aboveIce += vec3(1.0, 0.97, 0.94) * pow(max(dot(bumpN, H), 0.0), 60.0) * 0.40;  // specular
color = mix(color, aboveIce, bergShape * submergedFrac * bergBand * 0.95);

// Top face parallax side-face
vec3 sideIce = mix(vec3(0.55, 0.68, 0.82), vec3(0.82, 0.88, 0.94), 0.5);  // blue shadow face
color = mix(color, sideIce, sideShape * submergedFrac * bergBand * (1.0 - viewAngle) * 0.70);
```

### 4.5 Density Ring Profile

The ring should look denser at some longitudes (calving events are clustered):

```glsl
float calvingCluster = fbm3(vec3(iceMargin * 5.0, pos.x * 3.0, uSeed + 72.0));
float ringDensity = bergBand * smoothstep(0.35, 0.65, calvingCluster);
// Apply to activation gate: denser bergs where calvingCluster is high
if(step(1.0 - uIcebergDensity * 0.70 * ringDensity, bH1) < 0.5) return;
```

---

## Part V: Zone-Driven Terrain Deformation

The current terrain is too subtle. The zone elevation biases (+0.10 to −0.26) are fighting a ±0.20 FBM amplitude, meaning they often don't dominate. Two fixes:

### 5.1 Zone Character → Terrain Amplitude

Each zone type should have its own FBM amplitude, not just height offset:

```glsl
// Zone-specific terrain FBM amplitude (multiplied into h computation):
float terrainAmp = 1.0;
if(zoneRole ≈ CRATON)  terrainAmp = 0.35;  // ancient, smooth — nearly flat
if(zoneRole ≈ RIFT)    terrainAmp = 0.85;  // rough, active — high local relief
if(zoneRole ≈ HOTSPOT) terrainAmp = 0.55;  // moderate — volcanic cone shape
if(zoneRole ≈ SHELF)   terrainAmp = 0.20;  // flat carbonate platform
if(zoneRole ≈ RIDGE)   terrainAmp = 0.30;  // smooth ridge spine
if(zoneRole ≈ TRENCH)  terrainAmp = 0.15;  // nearly flat hadal floor
```

This requires passing `terrainAmp` into `terrainHeight()` via a second global (like `_gZoneElev`), or restructuring `terrainHeight()` to take parameters.

### 5.2 Mountain Drama

Current `ridgedFbm` amplitude multiplier is `0.30`. For habitable rocky worlds with high tectonics, this needs to be `0.55–0.80` — mountains should be dramatically visible from orbit, not barely-perceptible bumps.

The `uMountainHeight` uniform drives displacement, but it's passed as `vis.mountainHeight * 0.22` in ProceduralWorld.tsx. This scale factor is too conservative. Proposed: `vis.mountainHeight * 0.45` for rocky worlds with tectonics > 0.5.

### 5.3 Volcanic Mare (Flat Lava Plains)

Hotspot zones and young volcanic worlds should show broad flat dark basaltic plains — the classic mare of the Moon, or Io's sulfur flats. These are distinguished by:
- Very low FBM amplitude (flat)
- Dark basalt color
- Prominent lava cooling crack network (existing Feature 29 is too subtle — needs `* 2.0`)
- Occasional kipuka (light islands of older terrain poking through)

---

## Part VI: Atmosphere and Clouds

### 6.1 Cloud Fixes (Already Implemented in v5.5)

- `circMask(lat)` drives ITCZ / subtropical dry / storm track / polar stratus
- Domain-warped FBM breaks oval blobs
- Two altitude levels: cumulus + cirrus
- Rendered in planet shader (no sphere mesh = no oval artifact)

### 6.2 Atmosphere Shell — Spectral Class Tint

The atmosphere color (`uAtmColor`) is currently derived from world profile defaults. It should also respond to stellar UV:

| Star Class | Sky Tint Modifier |
|------------|-------------------|
| O/B (hot) | Intense UV → deep blue-violet scatter |
| F/G (solar) | Normal blue-white scatter |
| K (orange) | Warmer sky, salmon-orange horizon |
| M (red dwarf) | Red-heavy sky, weak blue component, reddish sunsets |

This is a uniform-level change: multiply `uAtmColor` by a stellar tint factor computed in derive.ts.

### 6.3 Limb Haze Altitude

The atmosphere shell radius should scale with world mass AND atmospheric pressure:

```typescript
const atmRadius = 1.04 + vis.atmThickness * 0.14 + (mass > 2.0 ? 0.02 : 0.0);
```

Super-Earths with thick atmospheres should have a notably deeper haze layer.

---

## Part VII: Implementation Order

Priority order for development (descending impact / ascending risk):

### PHASE 1 — Zone Boundary Blending (Highest Impact, Moderate Work)
**Files:** `solid.frag.ts`
**Change:** Track `zr1` and `zr2` zone roles through the full blend system. Compute blended role floats (`bIsShelf`, `bIsRidge`, `bIsPolar`, `bElevBias`). Replace all hard `if(zoneRole == X)` with `if(bIsX > 0.5)` or use continuous `bIsX` as a multiplier on feature strength.
**Expected result:** Zone transitions look like natural landscape gradients, not polygon edges.

### PHASE 2 — Ice Cap Flattening
**Files:** `solid.frag.ts` (`terrainHeight`), `icecaps.ts`
**Change:** Add `_gIsPolar` global alongside `_gZoneElev`. Inside `terrainHeight`, when `_gIsPolar > 0.5`, blend h toward `0.42` with a 0.92 factor. Remove POLAR_ICE from `_gZoneElev` table (bias stays 0.0).
**Expected result:** Ice cap sits at correct surface elevation, no dome effect, atmosphere shader behaves correctly at poles.

### PHASE 3 — Iceberg Ring
**Files:** `icecaps.ts` (or new `icebergs.ts` rewrite)
**Change:** Replace current Worley scatter with narrow-band ring system. Implement 3-altitude parallax. Add calving cluster density modulation.
**Expected result:** Visible ice ring at calving front, 3D appearance from all angles.

### PHASE 4 — Mountain Drama
**Files:** `solid.frag.ts`, `ProceduralWorld.tsx`
**Change:** Increase uMountainHeight scale factor 0.22→0.45. Add zone-specific terrain amplitude control. Increase volcanic crater rim contrast.
**Expected result:** Mountains visible from orbit on rocky worlds.

### PHASE 5 — Derive.ts Science Wiring
**Files:** `derive.ts`, `zones.ts`
**Change:** Wire axial tilt → ice line latitude skew. Wire stellar class → atmosphere tint. Compute `iceLine` as authoritative field.
**Expected result:** Worlds look distinctly different based on their star and orbit, not just temperature.

---

## Part VIII: Known Anti-Patterns (Do Not Repeat)

| Anti-Pattern | Why Bad | Fix |
|---|---|---|
| Separate sphere mesh for clouds | Sphere geometry creates oval blobs | Render in planet fragment shader |
| `zoneRole` hard check without blending | Creates polygon edges | Use blended role floats |
| `_gZoneElev` for POLAR_ICE | Lifts ice into atmosphere shell | Set to 0.0, flatten terrain inside `terrainHeight` |
| Wide iceberg lat band (absLat > 0.38) | Spray across hemisphere, no drama | Narrow ring at exact ice line |
| `terrainHeight` returns same amplitude for all zones | Mountains too subtle | Zone-specific amplitude multiplier |
| `waterCol * 1.6 + orange` for boiling ocean | Creates artifact streaks | Subtle fbm3 warmth + faint steam |
| Feature 41 sine-wave ocean swell | Visible geometric stripes from orbit | Removed |
| `zoneSplat(rpos)` for ocean seabed | Zone-rotation seams through water | Zone-independent depth+noise floor color |

---

## Part IX: File Change Summary

| File | Change Type | Priority |
|---|---|---|
| `solid.frag.ts` | Zone boundary blending refactor | P1 |
| `solid.frag.ts` | Ice cap terrain flattening global | P2 |
| `icecaps.ts` / `icebergs.ts` | Iceberg ring rewrite | P3 |
| `solid.frag.ts` | Mountain amplitude increase | P4 |
| `ProceduralWorld.tsx` | mountainHeight scale 0.22→0.45 | P4 |
| `derive.ts` | Axial tilt, stellar class wiring | P5 |
| `zones.ts` | Authoritative iceLine computation | P5 |
| `atm.frag.ts` | Stellar class tint multiplier | P5 |

---

*This plan supersedes the v5 architecture described in VITA_RENDERER_ARCHITECTURE.md. Implementation should proceed phase by phase with screenshot validation between each phase.*
