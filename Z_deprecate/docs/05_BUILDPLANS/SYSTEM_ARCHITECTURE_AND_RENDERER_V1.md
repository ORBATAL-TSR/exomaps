# ExoMaps — System Architecture Methodology & Renderer Overhaul v1.0
**Date:** 2026-03-17
**Status:** Build plan. Covers system generation, real exoplanet integration, and renderer upgrade.

---

## Part I — STIP Systems & The Architecture Problem

### 1.1 What Is a STIP?

**STIP = System of Tightly-packed Inner Planets.** Coined from Kepler mission analysis (Lissauer et al. 2011). Defines systems where 3–7 planets all orbit within ~0.5 AU, with orbital periods typically 2–100 days.

Key observed properties:
- **Flat and coplanar.** Mutual inclinations < 2° typically. Like a clock face, not a 3D scatter.
- **"Peas in a pod" architecture** (Weiss et al. 2018). Adjacent planets in the same system tend to be similar in size and regularly spaced. Planet sizes within a system are *correlated*, unlike between systems.
- **Near-resonant but rarely in exact resonance.** Period ratios cluster just *outside* integer ratios (1.5:1, 2:1, etc.) due to tidal dissipation diverging them from exact resonance.
- **Sub-Neptune to super-Earth dominated.** Radius 1–4 R⊕. Very few hot Jupiters coexist with STIPs.
- **Prevalence is high.** Kepler estimates ~30–40% of F/G/K stars host detectable STIPs. For M-dwarfs it's higher — possibly >50%.

**Why this matters for ExoMaps:** Most of the 1,796 systems in the 15 pc dataset likely host STIP-style architectures that we are generating wrong (single planets or ad-hoc multiples). Extending to 100 pc means we'll process thousands of systems; the population statistics become visible.

### 1.2 The Six Architecture Archetypes

Real exoplanet systems fall into distinct architectural families. Generation should draw from these archetypes with stellar-type-dependent priors.

| Archetype | Description | Prevalence (FGK) | Prevalence (M-dwarf) |
|---|---|---|---|
| **STIP** | 3–7 sub-Neptunes/super-Earths < 0.5 AU | 30–40% | 50–60% |
| **Solar Analog** | Rocky inner + gas giant(s) at > 1 AU | 10–15% | 2–5% |
| **Hot Jupiter Dominant** | One close-in giant, few other planets | 0.5–1% | < 0.1% |
| **Eccentric Giant** | One or more eccentric cold giants; depleted inner system | 5–10% | 1–2% |
| **Compact Resonance Chain** | TRAPPIST-1 style — exact resonance lock, very flat | 3–8% | 10–20% |
| **Sparse / Single** | One detected planet; true singles or detection bias | 30–40% | 20–30% |
| **Circumbinary** | Planets orbiting a close stellar binary (P-type) | ~1% of binaries | rare |
| **Post-MS** | System around evolved/WD/NS host | grows with survey volume | — |

---

## Part II — System Generation Methodology

### 2.1 Generation Pipeline

```
Star Parameters
  ├── Stellar Type (OBAFGKM + subclass)
  ├── Metallicity [Fe/H]
  ├── Age (Gyr)
  ├── Luminosity (L☉)
  └── Binary Flag

       ▼
Architecture Draw
  └── P(archetype | stellar type, metallicity, age)

       ▼
Planet Population
  ├── n_planets ~ Poisson(λ from archetype)
  ├── Period ratios (near-resonant or random per archetype)
  └── Size sequence (peas-in-pod similarity)

       ▼
Per-Planet Classification
  └── Mass + radius + insolation + tidal + age → type (taxonomy v3.0)

       ▼
Render Profile
  └── type → WorldVisuals (profiles.ts + derive.ts)
```

### 2.2 Architecture Selection Rules

**Metallicity gates (metallicity = stellar [Fe/H]):**
```
[Fe/H] > +0.1   → strongly favor gas giant presence (Solar Analog, Hot Jupiter)
[Fe/H] 0 to +0.1 → neutral prior
[Fe/H] < -0.3   → suppress gas giants; favor STIP or Sparse
[Fe/H] < -0.8   → suppress almost all; mostly rocky/sparse
```
*Ref: Fischer & Valenti 2005 — gas giant planet–metallicity correlation is one of the strongest observational priors in exoplanet demographics.*

**Stellar type gates:**
```
F/G/K stars:  full archetype distribution as above
M-dwarfs:     Hot Jupiter probability → 0.001; STIP + Chain probability ×2
A/B stars:    suppress all except eccentric cold giants
WD/NS hosts:  Post-MS archetypes only
Binary hosts: S-type normal distribution; flag tight binaries for circumbinary
```

**Age gates:**
```
Age < 0.5 Gyr:   Higher volcanism, primordial envelope rocky types likely
Age > 8 Gyr:     Suppress volatile-rich inner planets (stripping complete)
                 Boost snowball/bare-rock probability at HZ
Age > 10 Gyr:    Consider post-MS state check for evolved stars
```

### 2.3 Peas-in-a-Pod Implementation

When generating a STIP or Resonance Chain, adjacent planet sizes must be correlated:

```typescript
// Pseudocode: STIP size sequence
const r0 = drawFromPowerLaw(1.0, 3.5);  // seed radius for first planet
const sigmaIntra = 0.3;  // intra-system scatter (Weiss 2018: σ ≈ 0.3 in log-radius)

const radii = [r0];
for (let i = 1; i < nPlanets; i++) {
  // Each planet similar to previous but with log-normal scatter
  const r = r0 * Math.exp(gaussian(0, sigmaIntra));
  radii.push(Math.max(0.8, Math.min(4.0, r)));
}
```

**Period ratio distribution for STIPs:**
- Draw period ratios from N(1.65, 0.3) with hard floor 1.2 (Hill sphere stability)
- Near-resonant clustering: 5% chance each pair lands within 2% of 3:2, 4:3, or 2:1
- Resonance Chains: all pairs drawn from discrete resonant ratios (4:3, 3:2, 2:1, 3:1)

**Spacing regularity:** STIP systems have remarkably equal *logarithmic* spacing. Draw period of planet n as `P_{n} = P_{n-1} × ratio_n` where ratios are nearly equal within a system.

### 2.4 Habitable Zone Population

For every system, compute Kopparapu (2013) HZ bounds from stellar luminosity and temperature. Then flag each planet:
- `in_hz`: inside conservative HZ
- `hz_inner_edge`: within 10% of inner edge (runaway greenhouse risk)
- `hz_outer_edge`: within 10% of outer edge (CO₂ condensation / snowball risk)
- `extended_hz`: inside optimistic HZ but outside conservative

The most common HZ rocky planet outcome is probably **snowball** (ice-albedo feedback) not Earth-like. Default prior: 60% snowball, 15% desert, 10% ocean-covered, 8% Venus-type, 7% Earth-analog.

### 2.5 Tidal Effects

Tidal locking timescale (simplified):
```
t_lock ∝ a^6 × Q / (M_star × R_planet^3)
```
**Rule of thumb for classifier:**
- Period < 10 days around M-dwarf → tidally locked (I1/I2)
- Period < 20 days around K-dwarf → likely locked
- Period < 5 days around G-dwarf → likely locked
- Period < 10 days, eccentricity > 0.1 → resonance spin-orbit (I4)

Resonance chain members get `resonanceHeat` boost proportional to chain multiplier:
- 3-member chain: ×1.3
- 5-member chain: ×1.6 (inner members heated by chain pumping)
- 7-member chain (TRAPPIST-1): ×2.1 for innermost

---

## Part III — Real Known Exoplanet Integration

### 3.1 Data Tagging Philosophy

Real systems receive a **`real_system`** flag in the database. UI displays a badge:
- `⊕ CONFIRMED` — host star + confirmed planets from peer-reviewed catalog
- `⊕ CANDIDATE` — confirmed star, planet candidates not yet peer-reviewed
- `⊛ REAL STAR` — star is real but no confirmed planets; generated planets are synthetic

Real planet entries get:
- `discovery_method`: transit, rv, direct_imaging, timing, astrometry
- `discovery_telescope`: Kepler, K2, TESS, HARPS, ESPRESSO, Hubble, JWST, etc.
- `discovery_year`: integer
- `catalog_id`: e.g. "Kepler-442b", "TRAPPIST-1e", "Proxima Centauri b"
- `confidence`: confirmed / validated / candidate

### 3.2 Known Systems Catalog — Within 15 pc (Current Dataset)

These exist in the actual ExoMaps star data. All confirmed planets should be ingested from NASA Exoplanet Archive.

| System | Distance | Type | Planets | Notes |
|---|---|---|---|---|
| **Proxima Centauri** | 1.30 pc | M5.5Ve | b (confirmed), d (candidate) | b in HZ, tidally locked candidate |
| **Alpha Centauri A/B** | 1.34 pc | G2V + K1V binary | no confirmed | Proxima is gravitationally bound |
| **Barnard's Star** | 1.83 pc | M4Ve | b (disputed) | Super-earth candidate, not confirmed |
| **Lalande 21185** | 2.55 pc | M2V | b, c (confirmed) | Two super-Earths |
| **Epsilon Eridani** | 3.22 pc | K2V | b (confirmed) | Cold Jupiter, debris disk, active star |
| **GJ 1061** | 3.67 pc | M5.5V | b, c, d (confirmed) | 3 rocky planets, c/d near HZ |
| **Tau Ceti** | 3.65 pc | G8V | e, f (confirmed) | Two super-Earths in/near HZ, metal-poor |
| **GJ 876** | 4.69 pc | M4V | b, c, d, e (confirmed) | Laplace resonance chain, gas giant |
| **55 Cancri** | 12.3 pc | G8V + M-dwarf | b, c, d, e, f (confirmed) | Diverse 5-planet system; e is USP lava world |
| **Upsilon Andromedae** | 13.5 pc | F8V + M-dwarf | b, c, d (confirmed) | 3 gas giants, highly eccentric |
| **61 Virginis** | 8.54 pc | G5V | b, c, d (confirmed) | STIP — 3 super-Earths within 0.5 AU |
| **82 Eridani** | 6.03 pc | G5V | b, c, d (confirmed) | STIP — 3 super-Earths |
| **HD 40307** | 12.8 pc | K2.5V | b, c, d, e, f, g (confirmed) | 6-planet STIP; g possibly in HZ |
| **HD 219134** | 6.55 pc | K3V | b, c, d, f, g, h (confirmed) | **Best STIP example in 15 pc.** 6 confirmed planets. b and c transit — directly observed. |
| **GJ 667C** | 6.84 pc | M1.5V | b (confirmed), c–f (candidates) | M-dwarf STIP, multiple HZ candidates |

**55 Cancri e** deserves special mention: it is an **ultra-short-period (USP) lava world** orbiting in 0.74 days, surface temperature ~2400K. It should render as `usp-hot-rock` with thermal emission, not a generic rocky planet.

### 3.3 Known Systems Catalog — 15–50 pc (Extended Range)

| System | Distance | Type | Planets | Architecture |
|---|---|---|---|---|
| **TRAPPIST-1** | 12.1 pc | M8V | 7 confirmed | Compact resonance chain; b–h; e, f, g near HZ |
| **LHS 1140** | 14.99 pc | M4.5V | b, c (confirmed) | b is super-Earth in HZ, best current HZ rocky |
| **GJ 357** | 9.44 pc | M2.5V | b, c, d (confirmed) | STIP; d near HZ |
| **L 98-59** | 10.6 pc | M3V | b, c, d, e (confirmed) | STIP; smallest known transiting rocky (b = 0.4 M⊕) |
| **TOI-270** | 22.5 pc | M3V | b, c, d (confirmed) | STIP across radius gap; b=rocky, c=d=sub-Neptune |
| **K2-18** | 37 pc | M2.5V | b, c (confirmed) | b is hycean/sub-Neptune candidate with CH₄+CO₂ (JWST) |
| **HD 10180** | 39 pc | G1V | 7+ (confirmed/candidate) | Solar-type STIP + cold giant; most planets of any known system |
| **Kepler-442** | 342 pc | K | b (confirmed) | Rocky HZ world, too far for current dataset |

**TRAPPIST-1** is the canonical compact resonance chain. All 7 planets are in/near a Laplace resonance. The system is maximally coplanar. Planets b–d are likely desiccated/Venus-type; e, f, g are HZ candidates. System should render as `chain-inner` → `chain-temperate` × 3 → `chain-cold` × 2.

### 3.4 Notable 50–100 pc Real Systems

| System | Distance | Notes |
|---|---|---|
| **TOI-700** | 31.1 pc | d confirmed in HZ around M-dwarf; e also detected |
| **GJ 3470** | 31.4 pc | b is actively photoevaporating sub-Neptune; radius-gap straddler |
| **55 Cnc** | 12.3 pc | Already in 15 pc list |
| **HD 3167** | 45.8 pc | b = USP rock, c = sub-Neptune; straddles radius gap |
| **HD 63433** | 22.4 pc | b, c = short-period sub-Neptunes; d = outer |
| **K2-3** | 45.9 pc | b, c, d confirmed; d near HZ |
| **Kepler-62** | 368 pc | Too far for 100 pc scope |
| **Kepler-452** | 430 pc | Too far |

### 3.5 UI Integration Spec

**System view header:**
```
⊕ CONFIRMED SYSTEM — HD 219134
6 planets · discovered 2015 (HARPS/Spitzer) · K3V host
[Planet list with catalog IDs]
```

**Planet detail badge:**
```
⊕ HD 219134 b
confirmed 2015 · transit + RV
M = 4.74 M⊕ · R = 1.602 R⊕ · P = 3.093 days
Catalog: NASA Exoplanet Archive
```

**Synthetic planet indicator:**
```
⟡ Generated — based on stellar parameters
[no catalog entry]
```

**Real vs synthetic visual distinction in system map:**
- Real confirmed planets: solid dot with `⊕` badge
- Validated (statistical): lighter dot
- Candidate: dashed outline
- Generated: hollow dot, `⟡` indicator

---

## Part IV — Renderer Overhaul

### 4.1 WorldVisuals v2 Interface

The current `WorldVisuals` interface (types.ts) needs new fields. These are additive — no breaking changes.

```typescript
export interface WorldVisuals {
  // ── EXISTING ─────────────────────────────────────────────
  color1: [number, number, number];
  color2: [number, number, number];
  color3: [number, number, number];
  oceanColor: [number, number, number];
  oceanLevel: number;
  atmColor: [number, number, number];
  atmThickness: number;
  emissive: number;
  iceCaps: number;
  clouds: number;
  noiseScale: number;
  craterDensity?: number;
  crackIntensity?: number;
  mountainHeight?: number;
  valleyDepth?: number;
  volcanism?: number;
  isIce?: boolean;
  terrainAge?: number;
  tectonicsLevel?: number;
  hasRings?: boolean;

  // ── NEW v2 ────────────────────────────────────────────────
  // Stellar context
  starColor?: [number, number, number];       // Spectral RGB for daylight tint
  starColor2?: [number, number, number];      // Second star (circumbinary)
  sunDir2?: [number, number, number];         // Second sun direction
  sunBrightness?: number;                     // Primary star relative brightness (default 1.0)
  sunBrightness2?: number;                    // Secondary star brightness (circumbinary)

  // Atmosphere physics
  rayleighColor?: [number, number, number];   // Rayleigh scatter tint (star-spectrum-adjusted)
  mieColor?: [number, number, number];        // Mie scatter tint (haze/dust)
  atmPressure?: number;                       // Surface pressure in bar (drives haze thickness calc)
  hazeHeight?: number;                        // 0-1: high altitude haze layer (Venus/Titan)
  hazeColor?: [number, number, number];       // Haze tint (sulfuric=yellow, organic=orange)
  auroraStrength?: number;                    // 0-1: aurora intensity (magnetically active worlds)
  auroraColor?: [number, number, number];     // Aurora tint

  // Surface physics
  thermalGlow?: number;                       // 0-1: dayside thermal emission (USP rocks, lava worlds)
  metallic?: number;                          // 0-1: metallic BRDF fraction (iron worlds, A2 types)
  albedo?: number;                            // Bond albedo override
  frostLine?: number;                         // lat threshold for frost deposits (0-1, default from iceCaps)

  // Gas giant specifics
  cloudRegime?: number;                       // 0=NH₃, 1=NH₄SH, 2=H₂O-cloud, 3=silicate
  nightCloudFraction?: number;               // 0-1: night-side cloud asymmetry (hot Jupiters)
  stormLatitude?: number;                    // Great Storm latitude (radians)
  beltCount?: number;                        // Number of distinct cloud bands (integer)

  // Tidal / orbital
  resonanceHeat?: number;                    // 0-1: resonance chain tidal heating glow
  tidalBulge?: number;                       // 0-1: visible equatorial bulge distortion

  // Post-MS
  postMsAmbient?: [number, number, number];  // Ambient color from evolved host (red giant glow, WD UV)
  pulseGlow?: [number, number, number];      // Pulsar wind irradiation color
}
```

### 4.2 New GLSL Uniforms (solid.frag.ts)

```glsl
// v2 additions — add after existing uniforms
uniform vec3  uStarColor;          // spectral tint of primary star
uniform vec3  uStarColor2;         // second star (circumbinary; vec3(0) = absent)
uniform vec3  uSunDir2;            // second sun direction
uniform float uSunBrightness;      // primary star brightness multiplier
uniform float uSunBrightness2;     // secondary star brightness

uniform vec3  uRayleighColor;      // Rayleigh tint (stellar-spectrum adjusted)
uniform vec3  uMieColor;           // Mie haze tint
uniform float uHazeHeight;         // high haze layer strength
uniform vec3  uHazeColor;          // high haze tint
uniform float uAuroraStrength;     // aurora belt intensity
uniform vec3  uAuroraColor;        // aurora tint

uniform float uThermalGlow;        // USP/lava dayside thermal emission
uniform float uMetallic;           // metallic BRDF fraction
uniform float uResonanceHeat;      // tidal heating glow from resonance chain

uniform float uCloudRegime;        // gas giant cloud type (0=NH₃..3=silicate)
uniform float uNightCloudFraction; // hot Jupiter night-side cloud asymmetry
```

### 4.3 Per-Cluster Shader Upgrades

---

#### 4.3.1 Cluster C5 — USP Rocks

**Current behavior:** Falls through to generic rocky renderer. Shows normal terrain, atmosphere haze, no thermal character.

**Required:**
- No atmosphere haze (`uAtmThickness` = 0, skip Rayleigh/Mie)
- Dayside thermal emission gradient: `thermalGlow` drives a subtle incandescent color bleed at the terminator and into the dayside. Not full lava — more like metal heated to 1200K, dark orange-red glow.
- Bare micro-facet surface: high roughness, no specular ocean. Use metallic BRDF for iron-rich USP types.
- Extreme sharpness of terminator (no atmosphere softening).
- Night side: near-black. No thermal emission.
- `usp-hot-rock` types: add actual visible glowing crack network on day-facing slopes (reuse volcanism crack code but driven by `thermalGlow`).

```glsl
// In solid.frag.ts — after surface color, before lighting
if(uThermalGlow > 0.01) {
  float dayFacing = max(dot(N, L), 0.0);
  float thermMask = pow(dayFacing, 3.5);  // concentrated on direct-facing surface
  vec3 thermCol = mix(vec3(0.12, 0.04, 0.01), vec3(0.65, 0.28, 0.04), thermMask);
  color = mix(color, thermCol, uThermalGlow * thermMask * 0.75);
  // Crack network on thermal stress surfaces
  if(uThermalGlow > 0.35 && uCrackIntensity < 0.1) {
    float thermCrack = ...;  // reuse crack logic
    color = mix(color, vec3(0.9, 0.4, 0.05), thermCrack * uThermalGlow * 0.5);
  }
}
```

---

#### 4.3.2 Cluster G3 — Radius Gap / Bare Cores

**Current behavior:** No profiles exist for these types.

**Required:**
- `photoevap-stripped` / `core-powered-stripped`: Rocky/metallic surface, no ocean, minimal or no atmosphere. High density visual cues — compressed, smooth, old. Use A2 iron-rich profiles as base.
- `radius-gap-straddler`: Tenuous atmosphere — very thin blue-white haze ring, comet-like tail effect on day-night boundary. Partial surface visibility through patchy cloud.
- No craters (photoevaporated worlds are often geologically recent from the strip event).
- Key visual: **no atmosphere limb glow** — the hard-edge silhouette marks these immediately as bare cores.

---

#### 4.3.3 Cluster I5/I6 — Circumbinary & Resonance Chain

**Circumbinary dual-sun lighting:**

```glsl
// Replace single NdotL with dual-sun composite
float NdotL1 = max(dot(bumpN, L), 0.0) * uSunBrightness;
float NdotL2 = 0.0;
if(length(uStarColor2) > 0.01) {
  vec3 L2 = normalize(uSunDir2);
  NdotL2 = max(dot(bumpN, L2), 0.0) * uSunBrightness2;
}
float NdotL = min(NdotL1 + NdotL2, 1.0);

// Dual-shadow terminator: both stars cast a penumbra
// Two stars → possible eclipse states:
//   • Both visible  → full illumination, dual specular highlight
//   • One occluded  → one shadow, one lit, dramatic angular lighting
//   • Binary eclipse visible in sky  → brief but visually stunning
```

**Resonance chain tidal heat glow:**
```glsl
// In emissive section — below lava glow, above clouds
if(uResonanceHeat > 0.01) {
  // Subtle warm glow on dayside, slightly visible on night side (internal heat)
  float heatNight = uResonanceHeat * 0.08;  // night-side warm glow
  float heatDay = uResonanceHeat * 0.04 * NdotL;
  vec3 heatCol = vec3(0.22, 0.10, 0.04);  // deep thermal orange
  finalColor += heatCol * (heatNight + heatDay);
}
```

---

#### 4.3.4 Cluster K2 — Gas Giant Cloud Regimes

The `uCloudRegime` uniform drives cloud color and pattern in `gas.frag.ts`:

```glsl
// Cloud deck color by regime:
//   0.0 = NH₃ ice:     creamy white-yellow  (Jupiter tops)
//   1.0 = NH₄SH:       brown-orange-red      (Jupiter belts)
//   2.0 = H₂O cloud:   blue-white to cream   (warm Jupiters, ~600K)
//   3.0 = silicate:     dark red-brown        (hot Jupiters, > 1500K)
vec3 cloudColor;
if(uCloudRegime < 0.5) {
  cloudColor = mix(vec3(0.94, 0.91, 0.80), vec3(0.72, 0.68, 0.55), bandV);  // NH₃
} else if(uCloudRegime < 1.5) {
  cloudColor = mix(vec3(0.62, 0.38, 0.20), vec3(0.88, 0.62, 0.38), bandV);  // NH₄SH
} else if(uCloudRegime < 2.5) {
  cloudColor = mix(vec3(0.72, 0.82, 0.94), vec3(0.94, 0.96, 0.98), bandV);  // H₂O
} else {
  cloudColor = mix(vec3(0.24, 0.12, 0.06), vec3(0.52, 0.28, 0.14), bandV);  // silicate
}
```

**Night-side cloud asymmetry** (`uNightCloudFraction`):
```glsl
// Hot Jupiters: clouds pushed to night side by dayside evaporation
float dayCosine = dot(pos, L);
float cloudMask = mix(
  smoothstep(0.0, 0.3, -dayCosine),   // night-side cloud
  1.0,                                  // uniform clouds
  1.0 - uNightCloudFraction
);
```

**Cloudless hot Jupiter** (`uNightCloudFraction = 0`, cloud density = 0):
- Deep atmosphere color bleeds through — use a darkened version of band color
- Add Na/K spectral feature as subtle yellow-orange tint at extreme temperatures

---

#### 4.3.5 Cluster E4 — Magnetic Field Effects

`magnetically-shielded`: Add aurora rendering. Already partially in the codebase (`uAuroraStrength`). Ensure mid-latitude aurora ovals are visible, not just poles.

`magnetically-stripped`: Add **ion tail** — a very faint blue-white comet-like shimmer on the anti-stellar side (atmosphere being blown away). Subtle, only visible at specific angles.

---

#### 4.3.6 Cluster P — Post-MS Worlds

**Red giant companion** (`rgb-hz-world`):
- `postMsAmbient` = warm deep orange/red ambient light
- No blue sky — atmosphere lit by K/M giant spectrum
- Surface has abundant surface water forming rapidly (violent thaw textures)
- Day sky color: deep amber-orange, not blue Rayleigh

**White dwarf companion** (`wd-rocky-survivor`):
- `postMsAmbient` = pure white/blue-white (cool WD) or bright UV-blue (hot WD)
- Tiny sun disc in sky (WD is Earth-sized star)
- Surface appearance: ancient, heavily cratered, space-weathered dark

**Pulsar planet** (`psr-rocky`):
- `pulseGlow` = cyan/blue hard radiation color
- Surface bombarded with high-energy particles → blue-white radiation scar on pole-facing side
- Night side: subtle blue Cherenkov-like glow
- No atmosphere. Stark bare surface.

---

### 4.4 Foundational Renderer Improvements

These are improvements to the base shader physics — not type-specific, but they raise the floor for all worlds.

#### 4.4.1 Stellar Spectrum → Daylight Tint

Every rocky world currently assumes a G2V sun. The `uStarColor` uniform should modify:
1. **Diffuse lighting color**: `color * NdotL` → `color * NdotL * mix(vec3(1.0), uStarColor, 0.35)`
2. **Rayleigh scatter tint**: M-dwarf worlds should have redder sky, not blue sky. F-star worlds have bluer, brighter sky.
3. **Specular highlight color**: star color tints specular peaks

```glsl
// Stellar tint on diffuse
vec3 starlitColor = color * NdotL * mix(vec3(1.0), uStarColor, 0.30);

// Rayleigh adjusted for stellar spectrum
// M-dwarf: uRayleighColor = (0.82, 0.55, 0.38) → red/orange sky
// G-dwarf: uRayleighColor = (0.40, 0.65, 1.00) → blue sky (current hardcoded)
// F-dwarf: uRayleighColor = (0.30, 0.55, 1.00) → blue-white sky
vec3 scatter = uRayleighColor * pow(rim, 3.0) * uAtmThickness * scatterStrength;
```

**Spectral class → rayleighColor lookup** (in derive.ts):
```typescript
const rayleighBySpectralClass: Record<string, [number,number,number]> = {
  'O': [0.18, 0.42, 1.00],   // blue-violet
  'B': [0.22, 0.48, 1.00],   // deep blue
  'A': [0.28, 0.55, 1.00],   // bright blue
  'F': [0.32, 0.58, 1.00],   // blue-white
  'G': [0.40, 0.65, 1.00],   // standard blue sky
  'K': [0.60, 0.62, 0.95],   // slightly warm blue
  'M': [0.82, 0.55, 0.38],   // red/orange tint sky
};
```

#### 4.4.2 Multiple Scattering Approximation

Current atmosphere uses single-scatter Rayleigh + Mie. Add a simple multiple scattering term:

```glsl
// Multi-scatter approximation: adds sky dome fill light from the back arc
// Very cheap — just ambient uplift in the blue scatter direction
float multiScatter = uAtmThickness * 0.12;
finalColor += uRayleighColor * multiScatter * (1.0 - NdotL * 0.5);
```

This gives the characteristic softness of planets with thick atmospheres (Earth, Venus) vs. the stark shadows of thin-atmosphere worlds (Mars).

#### 4.4.3 Terminator Atmospheric Glow

The golden-hour effect: near the terminator, sunlight passes through max atmosphere path length, producing a warm orange band. Critical for visual identification of atmosphere-bearing worlds.

```glsl
// Terminator golden-hour band
float terminatorAngle = dot(N, L);
float terminatorBand  = exp(-pow(terminatorAngle / 0.18, 2.0));  // Gaussian at 0°
vec3  terminatorGlow  = mix(vec3(0.95, 0.55, 0.20), uStarColor, 0.4);
finalColor += terminatorGlow * terminatorBand * uAtmThickness * 0.35
            * smoothstep(-0.2, 0.2, terminatorAngle);
```

#### 4.4.4 Ocean Specular Realism

Current ocean specular is a blinn-phong with fixed shininess. Replace with:

```glsl
// Wave normal perturbation for specular
// Two-octave wave normal map instead of single fbm
float waveN1 = noise3D(cloudWarp(pos, 0.08) * 18.0 + uTime * 0.3);
float waveN2 = noise3D(cloudWarp(pos, 0.05) * 38.0 + uTime * 0.5 + 47.3);
vec3 waveNorm = normalize(N + vec3(waveN1 - 0.5, 0.0, waveN2 - 0.5) * 0.04);

// Fresnel-weighted specular (Schlick)
float cosTheta = max(dot(waveNorm, H), 0.0);
float F0 = 0.02;  // water Fresnel at normal incidence
float fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
float oceanSpec = pow(cosTheta, 380.0) * fresnel * NdotL * 2.8;
finalColor += vec3(1.0) * mix(oceanSpec, oceanSpec * uStarColor, 0.6);
```

#### 4.4.5 Micro-facet BRDF for Metal-Rich Surfaces

Iron planets, A2 types, bare cores — use a roughness-aware specular rather than blinn-phong:

```glsl
// Cook-Torrance microfacet for uMetallic > 0.01
if(uMetallic > 0.01) {
  float roughness = mix(0.8, 0.2, uMetallic);  // more metallic = smoother
  // GGX NDF
  float alpha = roughness * roughness;
  float denom = NdotH * NdotH * (alpha * alpha - 1.0) + 1.0;
  float D = alpha * alpha / (3.14159 * denom * denom);
  // Schlick Fresnel with metallic tint
  vec3 F0metal = mix(vec3(0.04), color, uMetallic);
  vec3 F = F0metal + (1.0 - F0metal) * pow(1.0 - NdotV, 5.0);
  vec3 metalSpec = D * F * NdotL * 0.25;
  finalColor += metalSpec * uMetallic;
}
```

#### 4.4.6 Better Ice Sheet Optics

Ice is currently rendered as diffuse white. Real ice has:
- Subsurface scattering (SSS) — blue light penetrates, red absorbed
- Specular reflection — ice is quite reflective at glancing angles
- Phase function — forward-scattering through thin ice sheets

The `applyIceCaps()` function already does SSS partially. Reinforce:
```glsl
// Already in icecaps.ts — strengthen
float iceSS = pow(1.0 - max(dot(N, V), 0.0), 2.5);  // was 3.0
iceCol += vec3(0.06, 0.18, 0.42) * iceSS * 0.28 * max(dot(N, L), 0.0);  // was 0.20
```

---

### 4.5 derive.ts & profiles.ts Additions

#### New Profile Types Required

The following taxonomy v3.0 types have no profiles yet. Priority order:

**Priority 1 — Required for STIP system rendering:**
| Type | Base Profile | Key Overrides |
|---|---|---|
| `usp-rock` | `rocky` | thermalGlow=0.3, atmThickness=0, metallic=0.2, noiseScale=5.0 |
| `usp-hot-rock` | `lava-world` | thermalGlow=0.75, emissive=0.5, volcanism=0.0 (no actual lava, just heat) |
| `usp-airless-remnant` | `iron-planet` | thermalGlow=0.15, atmThickness=0, craterDensity=0.7 |
| `photoevap-stripped` | `iron-planet` | metallic=0.4, atmThickness=0, terrainAge=0.8 |
| `chain-inner` | `eyeball-world` | resonanceHeat=0.4, volcanism=0.6 |
| `chain-temperate` | `earth-like` | resonanceHeat=0.2 |
| `chain-cold` | `ice-world` | resonanceHeat=0.1, iceCaps=0.8 |

**Priority 2 — Gas giant cloud regimes:**
| Type | Base Profile | Key Overrides |
|---|---|---|
| `water-cloud-giant` | `gas-giant` | cloudRegime=2, color1=[0.72,0.82,0.94] (blue-white) |
| `nh4sh-cloud-giant` | `gas-giant` | cloudRegime=1, color1=[0.55,0.32,0.18] (brown-orange) |
| `cloudless-hot-jupiter` | `hot-jupiter` | cloudRegime=3, clouds=0.05, color1=[0.18,0.10,0.08] |
| `night-cloud-giant` | `hot-jupiter` | nightCloudFraction=0.85, cloudRegime=2 |

**Priority 3 — Post-MS worlds:**
| Type | Base Profile | Key Overrides |
|---|---|---|
| `rgb-hz-world` | `ocean-world` | postMsAmbient=[0.9,0.4,0.1], atmColor=[0.8,0.5,0.2] |
| `wd-rocky-survivor` | `rocky` | postMsAmbient=[0.9,0.9,1.0], craterDensity=0.8, terrainAge=1.0 |
| `psr-rocky` | `rocky` | pulseGlow=[0.3,0.6,1.0], atmThickness=0, craterDensity=0.9 |

#### New derive.ts Rules

```typescript
// USP thermal glow — set from orbital period and temperature
if (params.orbitalPeriodDays !== undefined && params.orbitalPeriodDays < 1.0) {
  v.thermalGlow = Math.min(1.0, 0.15 + (1.0 - params.orbitalPeriodDays) * 0.6);
  v.atmThickness = 0;  // no atmosphere survives USP
  v.clouds = 0;
  v.metallic = Math.max(v.metallic ?? 0, 0.25);
}

// Resonance chain heating
if (params.resonancePosition !== undefined) {
  // position: 1 = innermost, n = outermost
  const chainHeat = Math.max(0, 0.5 - (params.resonancePosition - 1) * 0.12);
  v.resonanceHeat = chainHeat;
  v.volcanism = Math.max(v.volcanism ?? 0, chainHeat * 0.5);
}

// Stellar spectrum → rayleigh / sky color
if (params.starSpectralClass) {
  const sc = params.starSpectralClass[0].toUpperCase();
  v.rayleighColor = rayleighBySpectralClass[sc] ?? [0.40, 0.65, 1.00];
  v.starColor = starColorBySpectralClass[sc] ?? [1.0, 1.0, 1.0];
}

// Circumbinary — second sun
if (params.sunBrightness2 !== undefined && params.sunBrightness2 > 0) {
  v.sunBrightness2 = params.sunBrightness2;
  v.starColor2 = params.starColor2 ?? [1.0, 0.9, 0.8];
}

// Magnetic field context
if (params.hasMagneticField === true && v.auroraStrength === undefined) {
  v.auroraStrength = 0.3;
  v.auroraColor = [0.2, 0.8, 0.4];  // default green
}
if (params.hasMagneticField === false && v.atmThickness > 0.1 && params.starType === 'M') {
  // M-dwarf + no field → atmosphere stripping over time
  v.atmThickness *= 0.3;
  v.clouds *= 0.2;
}
```

---

### 4.6 Implementation Order

| Phase | Scope | Files |
|---|---|---|
| **1** | WorldVisuals v2 interface + new uniforms wired in ProceduralWorld.tsx | types.ts, ProceduralWorld.tsx, solid.frag.ts |
| **2** | Stellar spectrum → rayleigh tint + terminator glow | derive.ts, solid.frag.ts |
| **3** | USP rock thermal glow + bare-core profiles | profiles.ts, derive.ts, solid.frag.ts |
| **4** | Gas giant cloud regime system | profiles.ts, gas.frag.ts |
| **5** | Circumbinary dual-sun lighting | solid.frag.ts, ProceduralWorld.tsx |
| **6** | Resonance chain tidal glow + `chain-*` profiles | profiles.ts, derive.ts, solid.frag.ts |
| **7** | Ocean specular + multi-scatter approximation | solid.frag.ts |
| **8** | Metallic BRDF for A2/iron types | solid.frag.ts, profiles.ts |
| **9** | Aurora rendering expansion | solid.frag.ts |
| **10** | Post-MS world profiles + postMsAmbient lighting | profiles.ts, derive.ts, solid.frag.ts |
| **11** | Database: real system flags, catalog_id, discovery fields | migrations/ |
| **12** | UI: real system badge, confirmed/candidate indicators | SystemFocusView.tsx or equivalent |
| **13** | STIP architecture generator (SystemGenerator.ts) | new file in world/ |
| **14** | Peas-in-pod size correlation in zone/biome generation | zones.ts |

---

## Part V — Database Migration: Real System Fields

A new migration (008_real_systems.sql) should add:

```sql
-- Stars: real star flags
ALTER TABLE dm_galaxy.stars ADD COLUMN IF NOT EXISTS
  is_real_confirmed BOOLEAN DEFAULT FALSE;

-- Planets: real planet catalog fields
ALTER TABLE dm_galaxy.inferred_planets ADD COLUMN IF NOT EXISTS
  is_real_confirmed     BOOLEAN DEFAULT FALSE,
  catalog_id            TEXT,           -- 'TRAPPIST-1e', 'Kepler-442b', etc.
  discovery_method      TEXT,           -- 'transit', 'rv', 'direct_imaging', etc.
  discovery_telescope   TEXT,           -- 'Kepler', 'TESS', 'HARPS', 'JWST', etc.
  discovery_year        SMALLINT,
  confidence_level      TEXT            -- 'confirmed', 'validated', 'candidate'
    CHECK (confidence_level IN ('confirmed', 'validated', 'candidate'));

-- Systems: architecture classification
ALTER TABLE dm_galaxy.stars ADD COLUMN IF NOT EXISTS
  system_architecture   TEXT            -- 'stip', 'solar_analog', 'hot_jupiter_dominant',
                                        -- 'eccentric_giant', 'resonance_chain', 'sparse',
                                        -- 'circumbinary', 'post_ms'
    CHECK (system_architecture IN (
      'stip', 'solar_analog', 'hot_jupiter_dominant', 'eccentric_giant',
      'resonance_chain', 'sparse', 'circumbinary', 'post_ms'
    )),
  resonance_chain_length SMALLINT,     -- number of planets in resonance chain (if applicable)
  is_stip               BOOLEAN DEFAULT FALSE,
  is_circumbinary       BOOLEAN DEFAULT FALSE,
  binary_companion_id   INTEGER REFERENCES dm_galaxy.stars(id);

-- Index for real-system queries
CREATE INDEX IF NOT EXISTS idx_planets_real
  ON dm_galaxy.inferred_planets(is_real_confirmed, catalog_id)
  WHERE is_real_confirmed = TRUE;
```

---

## Appendix A — Star Color Lookup Table

For `uStarColor` / `rayleighColor` in derive.ts:

| Spectral Class | T_eff (K) | Star Color (RGB, ~normalized) | Sky Color on Rocky HZ World |
|---|---|---|---|
| O5 | 41,000 | (0.60, 0.70, 1.00) | Deep blue-violet |
| B2 | 22,000 | (0.70, 0.80, 1.00) | Blue |
| A0 | 9,700  | (0.85, 0.90, 1.00) | Bright blue-white |
| F5 | 6,700  | (0.98, 0.96, 0.92) | White-blue |
| G2 | 5,780  | (1.00, 0.95, 0.82) | Standard yellow-white (Earth) |
| K5 | 4,400  | (1.00, 0.78, 0.52) | Yellow-orange |
| M2 | 3,500  | (1.00, 0.58, 0.28) | Deep orange-red |
| M8 | 2,700  | (1.00, 0.38, 0.12) | Vivid red (TRAPPIST-1) |

Under an M-dwarf, a world with blue-Rayleigh atmosphere actually has a **pinkish-purple sky**, not blue — the Rayleigh scattering shifts the red-dominant starlight poorly. This is visually dramatic and currently wrong in all our planet renders.

---

## Appendix B — STIP Reference Systems for Visual Calibration

Use these real systems to validate rendered output looks appropriate:

| System | Render Test |
|---|---|
| **HD 219134 b** (USP, 3 days) | Should look like `usp-rock`. Bare, baked, dark. No atmosphere shimmer. |
| **55 Cancri e** (USP, 0.74 days) | Should look like `usp-hot-rock`. Thermal glow, glowing cracks. |
| **TRAPPIST-1 e** (mid-HZ) | Should look like `chain-temperate`. M-dwarf red sky, tidally locked, red ambient. |
| **TRAPPIST-1 b** (innermost) | Should look like `chain-inner`. Baked, high volcanism, resonance heating. |
| **TOI-270 b** (rocky, < gap) | Should look like `photoevap-stripped`. Bare dense core, no haze. |
| **TOI-270 c/d** (above gap) | Should look like `sub-neptune`. Blue-white H₂O cloud or haze envelope. |
| **K2-18 b** | Should look like `hycean` or `water-sub-neptune`. CH₄+CO₂ detected by JWST. Green-tinted. |
