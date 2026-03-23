# Renderer Pipeline — VITA

All planet rendering is GPU-only. No pre-baked textures. Everything is procedural GLSL.

---

## File Map

```
02_CLIENT/VITA/src/
├── components/
│   ├── ProceduralPlanet.tsx     Entry point: accepts planetType + seed + physics params
│   ├── SystemFocusView.tsx      Depth-drill orrery shell (system/planet/moon/belt)
│   └── PlanetSurfaceV2.tsx      Alternate PBR surface path (Cook-Torrance)
└── world/
    ├── ProceduralWorld.tsx      Core renderer: wires uniforms, material lifecycle
    ├── derive.ts                deriveWorldVisuals() — planetType + physics → WorldVisuals
    ├── profiles.ts              V[] — hand-tuned profiles per type (40+ types)
    ├── types.ts                 WorldVisuals, ZoneRole enum, shared types
    ├── zones.ts                 Fibonacci Voronoi zone generation + role assignment
    ├── textures.ts              Zone texture set selection
    ├── classifier.ts            Auto-classify planet from physical params
    ├── moonProfile.ts           Moon-specific profile overrides
    ├── systemManifest.ts        System scene manifest builder
    ├── OrreryComponents.tsx     All SystemFocusView sub-components (3,400+ lines)
    ├── AuroraField.tsx          Aurora particle field
    ├── CloudLayer.tsx           Cloud deck component
    ├── CraterField.tsx          Surface crater overlay
    ├── IcebergField.tsx         Polar iceberg instances
    ├── RingSystem.tsx           Planetary ring system
    ├── VolcanoField.tsx         Volcanic field particles
    └── shaders/
        ├── noise.ts             NOISE_GLSL library (hash3, fbm, ridgedFbm, voronoi)
        ├── solid.frag.ts        WORLD_FRAG — full solid-world shader (~1,500 lines)
        ├── vert.ts              Vertex shader: displacement + glacier geometry
        ├── atm.ts               ATM_VERT + ATM_FRAG: atmosphere shell (8-sample raymarch)
        └── features/            (new — per-feature shader snippets)
```

---

## Rendering Sequence

```
1. ProceduralPlanet receives:  planetType, seed, temperature, pressure, etc.
2. deriveWorldVisuals()     →  WorldVisuals struct (colors, ocean level, ice extent, atm)
3. applyWorldGenome()       →  seed-based color variation per-planet
4. computeZoneRoles()       →  20–32 Fibonacci Voronoi centers → role assignment
5. ProceduralWorld renders:
   a. Sphere geometry (96×64 segments — ~12k vertices)
   b. Vertex shader: terrain height displacement + glacier geometry
   c. Fragment shader (WORLD_FRAG): full procedural surface
   d. Atmosphere sphere (64×48, separate draw call, transparent blend)
```

---

## Uniform Reference

### Core World
| Uniform | Type | Description |
|---------|------|-------------|
| `uTime` | float | Seconds elapsed — drives all animation |
| `uSeed` | float | `seed × 137.0` — noise domain offset |
| `uSunDir` | vec3 | Normalized sun direction (world space) |
| `uIsGas` | float | 1.0 = gas giant render path |
| `uIsIceWorld` | float | 1.0 = ice-dominated world |

### Terrain
| Uniform | Type | Description |
|---------|------|-------------|
| `uNoiseScale` | float | Base terrain FBM frequency |
| `uOceanLevel` | float | 0 = no ocean, 1 = fully submerged |
| `uMountainHeight` | float | Ridged FBM contribution |
| `uValleyDepth` | float | Valley carve strength |
| `uCraterDensity` | float | Voronoi crater field density |
| `uVolcanism` | float | Volcanic peak contribution |
| `uTectonics` | float | Tectonic plate boundary height |
| `uTerrainAge` | float | 0 = young/sharp, 1 = old/eroded |

### Ice / Zones
| Uniform | Type | Description |
|---------|------|-------------|
| `uIceCaps` | float | Ice cap extent 0–1 |
| `uIcebergDensity` | float | Worley iceberg spawn density |
| `uBiomeCenters[32]` | vec3[] | Zone center positions (unit sphere) |
| `uZoneRoles[32]` | float[] | Semantic role per zone (0–6) |
| `uBiomeCount` | float | Active zone count |
| `uSelectedZone` | float | Highlighted zone index (−1 = none) |
| `uShowBorders` | float | 1.0 = draw province borders |

### Atmosphere / Clouds
| Uniform | Type | Description |
|---------|------|-------------|
| `uAtmColor` | vec3 | Rayleigh + Mie tint |
| `uAtmThickness` | float | 0 = airless, 1 = thick Venus-like |
| `uCloudDensity` | float | Cloud coverage 0–1 |

### Textures
| Uniform | Type | Description |
|---------|------|-------------|
| `uZoneTex0–4` | sampler2D | Zone texture splat set (5 textures) |
| `uZoneTexScale` | float | Triplanar projection frequency |
| `uTexLow/Mid/High` | sampler2D | Legacy triplet (unused in v5 shader) |

---

## Performance Notes

- **Vertex shader:** 12k runs/frame (96×64 sphere)
- **Fragment shader:** ~600k pixels at 4× zoom
- **Iceberg Worley loop** (3×3×3 = 27 iterations): gated to `absLat > 0.45 && depth01 < 0.80` — skips ~60% of fragments
- **Atmosphere:** separate draw call, transparent blending, 64×48 sphere
- `uTime` advances every frame — all animated features respond (waves, clouds, aurora, icebergs)

---

## Domain Warp (Two-Octave)

Applied in fragment shader before zone lookup. Keep total amplitude < 0.55 or Voronoi gaps appear.

```glsl
ow  = FBM(pos*2.4) * 2 - 1    // continent scale warp
ow2 = FBM(pos*6.2) * 2 - 1    // fjord/bay detail warp
wpos = normalize(pos + ow*0.48 + ow2*0.12)
```

---

## Atmosphere Shell

8-sample ray march with Rayleigh + Mie scattering, sunset color injection.
Scale heights: `hR = 0.35`, `hM = 0.12`

Shell radius formula:
```
atm_radius = 1.02 + atmThickness*0.10 + (iceWorld ? 0.020 : 0)
```
Must be larger than `1 + max_glacier_displacement`.

---

## Shader Warmup (TDR Prevention)

Windows/ANGLE compiles HLSL on first use → D3D11 TDR crash if >2s.
Mitigation: a hidden `<ProceduralPlanet>` renders at `scale={[0.001,0.001,0.001]}` during
loading screen, pre-compiling `WORLD_FRAG`. Gate UI on `shaderWarmed = true`.

In `SystemFocusView.tsx`:
```tsx
const warmupPlanetProps = useMemo(() => { ... }, [systemData]);
{warmupPlanetProps && !shaderWarmed && (
  <group key="warmup" scale={[0.001, 0.001, 0.001]}>
    <ProceduralPlanet ... onReady={() => setShaderWarmed(true)} />
  </group>
)}
```
