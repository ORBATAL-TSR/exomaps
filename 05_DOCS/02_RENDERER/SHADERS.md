# Shader Reference

---

## Noise Library (`world/shaders/noise.ts` → `NOISE_GLSL`)

Included in both vertex and fragment shaders. The vertex shader has an inline copy —
keep both in sync when modifying.

| Function | Signature | Description |
|----------|-----------|-------------|
| `hash3` | `(vec3 p) → float` | 3D value hash, range 0–1 |
| `noise3D` | `(vec3 p) → float` | Trilinear-interpolated 3D value noise |
| `fbm3` | `(vec3 p) → float` | 3-octave FBM |
| `fbm5` | `(vec3 p) → float` | 5-octave FBM (higher quality) |
| `ridgedFbm` | `(vec3 p) → float` | Ridged multi-fractal (mountains) |
| `voronoiPlates` | `(vec3 p, float seed) → float` | Tectonic plate boundaries |
| `triplanarSample` | `(sampler2D, vec3 p, vec3 n, float scale) → vec4` | Axis-aligned triplanar projection |

---

## Zone System (`world/zones.ts` + WORLD_FRAG)

### Zone Roles (ZoneRole enum in `world/types.ts`)

| Value | Name | Assignment Condition | Visual |
|-------|------|---------------------|--------|
| 0 | DEFAULT | Remaining zones | Normal terrain |
| 1 | POLAR_ICE | `absLat > 0.70` | Ice cap fill |
| 2 | SUBSTELLAR | Nearest zone to `+L` direction | Scorched / boiling |
| 3 | ANTISTELLAR | Nearest zone to `−L` direction | Permanent ice shelf |
| 4 | TERMINATOR | Near `dot(pos,L) ≈ 0` | Mixed day/night |
| 5 | CRATON | Stochastic — old stable crust | Granite tones |
| 6 | RIFT | Stochastic — active fault | Dark basalt |

### Zone Generation
- 20–32 Fibonacci-distributed centers on unit sphere
- `uBiomeCount` sets active count (varies by planet type via profiles)
- `uBiomeCenters[i]` → unit vec3 per zone
- `uZoneRoles[i]` → float cast of ZoneRole

---

## Known Gotchas

1. **Domain warp amplitude** — total warp < 0.55. Higher values cause Voronoi coverage gaps (zones appear at wrong positions).

2. **`iceZoneMask` smoothstep direction** — `smoothstep(small, large, provEdge)` fills interior; inverted fills boundary ring only. Easy to get backwards.

3. **Atmosphere shell radius** — must exceed `1 + max_glacier_displacement`. Formula:
   `1.02 + atmThickness*0.10 + (iceWorld ? 0.020 : 0)`

4. **Vertex/fragment noise seed alignment** — ice edge noise uses `seed + 201.0` in BOTH `vert.ts` and `solid.frag.ts`. Must stay in sync.

5. **Per-zone UV rotation** — use `rpos` (position rotated by `bZone × φ × 2π`) for all triplanar sampling on land. Using raw `pos` gives same texture orientation on all zones.

6. **Ice world multiplier removed in v5** — use:
   `mix(iceZoneMask, max(iceBase, iceZoneMask), uIsIceWorld)`
   The old `ice * uIsIceWorld` pattern caused double-application.

7. **Ocean border suppression** — `borderOceanFade = 1 - smoothstep(0.02, 0.18, depth01)` fades zone boundaries through water. Without this, zone edges are visible through the ocean.

8. **Inline noise in vertex shader** — cannot import GLSL strings. `vert.ts` has its own copy of the noise functions. Always update both when changing noise.

---

## OrreryComponents Exports Reference

`world/OrreryComponents.tsx` — extracted from SystemFocusView. 3,400+ lines.
Used exclusively via import in `components/SystemFocusView.tsx`.

Key exports by category:

**Types**
`Props`, `ViewState`, `ScienceTab`, `ViewDepth`

**State**
`_orbit` (time accumulator), `OrbitClock` (useFrame driver)

**Constants / Maps**
`STAR_COLOR`, `PT_COLOR`, `MOON_COLOR`, `MOON_TEMP`, `MOON_ICON`,
`FLAG_ICON`, `FLAG_COLOR`, `SPEC_COLOR`, `BELT_TYPE_LABEL`, `MOON_DESC`,
`AIRLESS_TYPES`, `STAR_VIS_R`, `starVisRadius`

**Utilities**
`pickMoonProfile`, `pickPotatoColors`, `moonColorShift`, `planetShineFromType`,
`logOrbitRadius`, `logBeltRadius`, `layoutMoonOrbits`, `detectResonance`,
`moonSeed`, `hashStr`, `shortName`, `formatPeriod`, `vizPeriod`,
`surfaceG`, `starLifecycle`, `spectralColor`, `seededRng`

**Stars**
`OrreryStar`, `CompanionStar`, `CompanionLight`, `Starfield`

**Planets / Moons**
`OrreryBody`, `LODPlanet`, `RotatingSurfaceGroup`, `PotatoMoon`,
`CapturedMiniMoon`, `CapturedMiniMoonSwarm`, `OrbitingMoon`,
`RingParticles`, `MoonOrbitLine`

**Belts / Asteroids**
`KuiperDustGlow`, `BeltGapRings`, `BeltParticles`, `BeltAsteroids`,
`NamedBeltBodies`, `NamedBody`, `AsteroidCloseupGroup`, `ProceduralAsteroid`,
`RegolithDust`, `CompanionOrbit`, `BeltFamilyChart`, `IrregularFamilyRing`

**Zones**
`HabitableZone`, `TemperatureZone`, `RadiationZone`, `FrostLine`

**Habitats / Stations**
`HabitatOrbitRing`, `HabitatStation`

**UI / Navigation**
`SmoothCamera`, `DepthBreadcrumb`, `BiomeInfoPanel`, `BiomeDetailCard`, `ResourceBar`

**Shader strings**
`HAPKE_VERT`, `HAPKE_FRAG`, `STAR_VERT`, `STAR_FRAG`,
`CORONA_BILLBOARD_VERT`, `CORONA_FRAG`, `RIM_GLOW_FRAG`
