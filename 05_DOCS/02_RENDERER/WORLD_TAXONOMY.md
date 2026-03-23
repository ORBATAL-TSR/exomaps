# World Taxonomy

Planet types recognized by the renderer. Each type maps to a visual profile in
`world/profiles.ts` (V[] array) and a zone role distribution in `world/zones.ts`.

---

## Solid World Types

| Type Key | Class | Temp Range | Surface | Ocean | Atm |
|----------|-------|-----------|---------|-------|-----|
| `rocky` | Terrestrial | 200–400K | Silicate/basalt | No | Thin/none |
| `rocky_hot` | Terrestrial | 400–700K | Baked rock, lava patches | No | CO₂ |
| `rocky_cold` | Terrestrial | 100–200K | Frost-covered rock | No | Trace |
| `terran` | Earth-analog | 250–310K | Mixed biomes, ocean | Yes | N₂/O₂ |
| `terran_ocean` | Water world | 260–310K | Global ocean | Deep | Humid |
| `terran_arid` | Desert world | 280–360K | Dry, dune fields | Trace | CO₂/N₂ |
| `terran_cold` | Cold analog | 220–265K | Tundra, glaciers | Ice | Thin |
| `superterran` | Super-Earth | 250–350K | High-g mixed | Possible | Thick |
| `iron` | Iron world | 300–800K | Exposed iron crust | No | None |
| `lava` | Lava world | 700–2000K | Magma ocean, lava flows | Lava | SO₂/CO₂ |
| `ice` | Ice world | 50–250K | Global ice, subsurface ocean | Sub-ice | Trace |
| `ice_rocky` | Icy rock | 100–230K | Mixed ice/rock | No | Thin |
| `desert` | Hot desert | 350–600K | Sand, dust storms | No | Thin CO₂ |
| `tundra` | Frozen ground | 200–270K | Permafrost, sparse ice | No | Thin |
| `ocean_world` | Global ocean | 280–330K | No land exposed | Global | Steam/CO₂ |
| `glacial` | Glacier world | 150–240K | Thick ice sheets | Sub-ice | CO₂/N₂ |
| `carbon` | Carbon planet | 400–900K | Diamond/graphite crust | No | CO/CO₂ |
| `chthonian` | Stripped giant | 800–2500K | Bare rocky core | No | None |
| `halide` | Salt flat | 300–600K | Evaporite crust | Brine | Thin |

## Gas & Ice Giant Types

| Type Key | Class | Temp Range | Notes |
|----------|-------|-----------|-------|
| `gas_giant` | Gas giant | 80–200K (cloud tops) | Jupiter/Saturn analog |
| `hot_jupiter` | Hot Jupiter | 800–2500K | Close orbit, puffed |
| `warm_neptune` | Sub-Neptune | 300–600K | Intermediate |
| `ice_giant` | Ice giant | 50–120K | Uranus/Neptune analog |
| `sub_neptune` | Sub-Neptune | 200–500K | 2–4 R⊕ |
| `mini_neptune` | Mini-Neptune | 250–600K | 1.7–2.5 R⊕ |
| `puffy_giant` | Inflated giant | 700–2000K | Very low density |

## Moon Types

| Type Key | Surface | Notes |
|----------|---------|-------|
| `potato_moon` | Irregular, grey silicate | Captured/small — uses PotatoMoon (Hapke BRDF) |
| `icy_moon` | Smooth ice, subsurface ocean | Europa analog |
| `volcanic_moon` | Active lava flows | Io analog |
| `rocky_moon` | Cratered silicate | Luna analog |
| `dusty_moon` | Regolith-covered | Phobos/Deimos analog |

---

## Planet Profile System

`world/profiles.ts` — `V[]` array. Each entry is a `WorldVisuals` object keyed by
planetType string. `deriveWorldVisuals()` in `derive.ts` selects the base profile and
then applies physical param overrides (temperature, pressure, etc.).

`applyWorldGenome()` — applies seed-based variation on top of derived profile to ensure
no two planets of the same type look identical.

---

## Zone Role Distribution by Type

| Type | POLAR_ICE | SUBSTELLAR | ANTISTELLAR | CRATON | RIFT | Notes |
|------|-----------|-----------|------------|--------|------|-------|
| `terran` | 2–4 | 0 | 0 | 2–4 | 1–2 | Normal |
| `ice` / `glacial` | 8–12 | 0 | 2–4 | 2 | 0 | Heavy ice |
| `lava` | 0 | 4–6 | 0 | 0 | 6–8 | No ice |
| `tidal_lock` (any) | 1–2 | 1 | 1 | 2 | 1 | SUBSTELLAR + ANTISTELLAR active |
| `gas_giant` | 0 | 0 | 0 | 0 | 0 | Band-based, zones unused |

Tidal locking is inferred in `derive.ts` from orbital period < 20 days.
Tidal-locked planets activate `SUBSTELLAR` and `ANTISTELLAR` zone roles.

---

## Terrain Texture Library

Location: `02_CLIENT/VITA/public/textures/planets/` — 70+ terrain types.

Zone texture splat sets (`uZoneTex0–4`) are selected per planet type in `world/textures.ts`.
Each set contains 5 textures: base, overlay, detail, specular mask, normal-ish.

Triplanar projection scale set via `uZoneTexScale` (default 2.5–4.0 depending on type).
