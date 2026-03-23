/**
 * solid.frag.ts — World fragment shader (solid + gas giant paths).
 *
 * v5 — Zone-role-driven architecture.
 *
 * Key architecture:
 *   - uZoneRoles[32]: semantic role per zone (0=default, 1=polar, 2=substellar,
 *     3=antistellar, 4=terminator)
 *   - Polar ice rendered via POLAR_ICE zones (not just latitude formula)
 *   - Ocean: real seabed visible through water depth, wave transparency
 *   - Eyeball: hot boiling ocean at substellar, ice shelf at antistellar,
 *     complex mixed terrain at terminator
 *   - Region selection: highlights whole Voronoi cell (not circular indicator)
 *   - Rocky worlds: zone role + zoneChar drive strong per-region variation
 */

import { NOISE_GLSL } from './noise';
import { ICEBERGS_GLSL, ICECAPS_GLSL } from './features/icecaps';
import { CLOUDS_GLSL } from './features/clouds';
import { CRYOPLUMES_GLSL } from './features/cryoplumes';
import { ICEFLOES_GLSL } from './features/icefloes';

// precision MUST come before all function definitions — place it before NOISE_GLSL
export const WORLD_FRAG = 'precision highp float;\n' + NOISE_GLSL + /* glsl */`

// =============================================================
// ProceduralWorld FRAG v5 — Zone-role-driven
// =============================================================

uniform float uTime;
uniform vec3  uColor1, uColor2, uColor3;
uniform vec3  uOceanColor;
uniform float uOceanLevel;
uniform vec3  uAtmColor;
uniform float uAtmThickness;
uniform float uEmissive;
uniform float uIceCaps;
uniform float uCloudDensity;
uniform float uNoiseScale;
uniform vec3  uSunDir;
uniform float uIsGas;
uniform float uSeed;
uniform float uCraterDensity;
uniform float uCrackIntensity;
uniform float uMountainHeight;
uniform float uValleyDepth;
uniform float uVolcanism;
uniform float uIsIceWorld;
uniform float uTerrainAge;
uniform float uTectonics;
uniform vec3  uFoliageColor;
uniform float uTidallyLocked;
uniform float uSpinOrbit32;
uniform float uShowTempMap;
uniform float uSubstellarTemp, uAntistellarTemp, uEquatorTemp, uPolarTemp;
uniform float uHeatRedist;
uniform float uStormLat, uStormLon, uStormSize, uStormIntensity;
uniform float uShowMineralMap;
uniform float uIronPct, uSilicatePct, uWaterIcePct, uKreepIndex, uCarbonPct;
uniform vec3  uPlanetShineColor;
uniform sampler2D uTexLow, uTexMid, uTexHigh;
uniform float uTexInfluence, uTriplanarScale;
uniform sampler2D uZoneTex0, uZoneTex1, uZoneTex2, uZoneTex3, uZoneTex4;
uniform float uZoneTexScale;
uniform vec3  uPickPos;
uniform float uPickStrength;
uniform vec3  uBiomeCenters[64];
uniform float uZoneRoles[64];   // per-zone semantic role
uniform float uBiomeCount;
uniform float uSelectedZone;
uniform float uAxialTilt;
uniform float uHasRings;     // 0/1 — planet has a ring system casting equatorial shadow
uniform float uRingInner;    // ring inner radius in planet radii
uniform float uRingOuter;    // ring outer radius in planet radii
uniform float uShowBorders;      // 0/1 — whether to draw province border lines
uniform float uIcebergDensity;  // iceberg spawn density near polar ocean margin

// ── v2 UNIFORMS — stellar environment & surface physics ────
uniform vec3  uStarColor;          // primary star spectral tint (white = G2V Sun)
uniform vec3  uStarColor2;         // second star tint (circumbinary)
uniform vec3  uSunDir2;            // second sun direction (circumbinary)
uniform float uSunBrightness;      // primary sun brightness scale
uniform float uSunBrightness2;     // second sun brightness (0 = no second sun)
uniform vec3  uRayleighColor;      // stellar-spectrum Rayleigh sky tint
uniform vec3  uHazeColor;          // stratospheric haze color
uniform float uHazeHeight;         // haze altitude (0-1)
uniform float uThermalGlow;        // USP/hot-rock dayside incandescence
uniform float uMetallic;           // explicit metallic BRDF weight
uniform float uCloudRegime;        // gas cloud deck: 0=NH₃ 1=NH₄SH 2=H₂O 3=silicate
uniform float uNightCloudFraction; // hot-Jupiter night-side cloud fraction
uniform float uResonanceHeat;      // resonance-chain tidal heat glow
uniform float uSubsurfaceOcean;    // subsurface ocean world (Europa-type): 0=none, 1=full
uniform mat4  modelMatrix;         // world transform (needed for ring shadow plane)
uniform float uAuroraStrength;     // aurora intensity scale
uniform vec3  uAuroraColor;        // aurora spectral color
uniform vec3  uPostMsAmbient;      // post-MS ambient (red giant / WD / pulsar tint)
uniform float uIsMoon;             // 1.0 = moon surface path (regolith, ray system, sharp terminator)
uniform float uWorldMode;          // 0=rocky/airless, 1=habitable, 2=volcanic, 3=icy/snowball, 4=moon, 5=gas

// Zone role constants (match ZONE_ROLE in zones.ts)
#define ROLE_DEFAULT     0.0
#define ROLE_POLAR_ICE   1.0
#define ROLE_SUBSTELLAR  2.0
#define ROLE_ANTISTELLAR 3.0
#define ROLE_TERMINATOR  4.0
#define ROLE_CRATON      5.0
#define ROLE_RIFT        6.0
#define ROLE_SHELF       7.0   // continental shelf — shallow ocean, carbonate
#define ROLE_RIDGE       8.0   // mid-ocean ridge — submarine chain, vents
#define ROLE_TRENCH      9.0   // subduction trench — hadal zone, near-black
#define ROLE_HOTSPOT    10.0   // volcanic hotspot — isolated uplift

// Global zone elevation bias — set in main() BEFORE calling terrainHeight().
// Shifts the terrain height up/down based on zone role, so ocean depth is
// zone-driven. Bias cancels out in gradient (hX-h), so normals are unaffected.
float _gZoneElev = 0.0;

// Global polar flag — set in main() alongside _gZoneElev.
float _gIsPolar   = 0.0;

// Global zone boundary distance — set to provEdge so terrainHeight can
// build pressure ridges at the ice sheet calving front.
float _gProvEdge  = 999.0;

// Per-zone terrain seeding — each zone gets a unique FBM offset so terrain
// shape (not just color) transitions at zone boundaries, eliminating quilt seams.
// Set in main() alongside _gIsPolar/_gProvEdge.
float _gZoneSeed1 = 0.0;
float _gZoneSeed2 = 0.0;
float _gZoneBlend        = 0.0;  // 0 = zone1 interior, >0 = blending toward zone2
float _gCraterInfluence  = 0.0;  // 0-1: how close this fragment is to crater rim/bowl

varying vec3  vObjPos;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vFresnel;

// =============================================================
// WAVE ROTATION
// =============================================================
vec3 cloudWarp(vec3 p, float speed) {
  float lat   = asin(clamp(p.y, -1.0, 1.0));
  float angle = speed * cos(lat) * uTime;
  float c = cos(angle), s = sin(angle);
  return vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
}

// =============================================================
// TERRAIN HEIGHT
// =============================================================
float terrainHeight(vec3 pos) {
  float sc = uNoiseScale;
  vec3 q = vec3(fbm3(pos*sc + uSeed),
                fbm3(pos*sc + uSeed + vec3(5.2,1.3,3.7)),
                fbm3(pos*sc + uSeed + vec3(9.1,4.8,7.2)));
  vec3 r = vec3(fbm3(pos*sc + q*3.5 + uSeed + vec3(1.7,8.2,2.1)),
                fbm3(pos*sc + q*3.5 + uSeed + vec3(6.3,3.1,5.8)),
                0.0);
  float h = fbm5(pos*sc + r*2.0 + uSeed);

  // Per-zone terrain differentiation: each zone has a unique FBM field.
  // Blended at zone borders via _gZoneBlend so the height transition is
  // organic and follows the same noisy boundary as the color blend.
  // Centered around 0 (no net height bias) so ocean level is unaffected.
  {
    float zv1 = (fbm3(pos * sc * 0.70 + uSeed + _gZoneSeed1 + 900.0) - 0.5) * 0.12;
    float zv2 = (fbm3(pos * sc * 0.70 + uSeed + _gZoneSeed2 + 900.0) - 0.5) * 0.12;
    h += mix(zv1, zv2, _gZoneBlend);
  }

  if(uTectonics > 0.02) {
    vec3 vp = voronoiPlates(pos, sc * 0.7 + uSeed * 0.01);
    float plateH = fract(vp.z * 7.13) * 0.4 - 0.15;
    float edgeNoise = noise3D(pos * 8.0 + uSeed * 2.7) * 0.5 + 0.5;
    float edgeWidth = mix(0.04, 0.14, edgeNoise);
    float edgeBreak = smoothstep(0.25, 0.45, noise3D(pos * 3.2 + uSeed * 5.1));
    float edgeMask  = (1.0 - smoothstep(0.0, edgeWidth, vp.y)) * edgeBreak;
    h += plateH * uTectonics * 0.25;
    h += edgeMask * uTectonics * 0.12;
    if(fract(vp.z * 13.7) > 0.6) h -= edgeMask * uTectonics * 0.08;
  }

  if(uMountainHeight > 0.01)
    h += ridgedFbm(pos*sc*2.0 + uSeed + 200.0) * uMountainHeight * 0.30;
  if(uValleyDepth > 0.01)
    h -= smoothstep(0.45,0.55,fbm3(pos*sc*1.5+uSeed+300.0)) * uValleyDepth * 0.15;

  // ── River network carving ─────────────────────────────────────
  // Domain-warped abs(FBM) creates meandering channel topology.
  // Same seed+700 used in the surface color pass for exact alignment.
  // Only active on worlds with a water cycle; skips polar zones.
  // FIX 4/9/13: gate on surface water presence and habitable world mode
  if(uAtmThickness > 0.08 && _gIsPolar < 0.1 && uOceanLevel > 0.15 && uWorldMode == 1.0) {
    vec3 rp = pos * sc * 1.0 + uSeed + 700.0;
    // Domain warp: meander the channel paths
    vec3 rw = rp + vec3(fbm3(rp + 12.3) - 0.5,
                        0.0,
                        fbm3(rp + 87.6) - 0.5) * 0.55;
    float rivN = abs(fbm3(rw) * 2.0 - 1.0);
    // Channel trough (narrow 0-0.06) + shallow bank ramp (0.06-0.14)
    float rivCarve = smoothstep(0.06, 0.0, rivN) * 0.055
                   + smoothstep(0.14, 0.06, rivN) * 0.018;
    h -= rivCarve * clamp(uAtmThickness * 6.0, 0.0, 1.0);
  }

  if(uCraterDensity > 0.01) {
    vec3 cp = pos*sc*2.5+uSeed+333.0; vec3 ci=floor(cp),cf=fract(cp);
    float F1=99.0, F2=99.0; vec3 cCenter=vec3(0.5);
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
      vec3 g=vec3(float(x),float(y),float(z));
      vec3 o=fract(sin(vec3(dot(ci+g,vec3(127.1,311.7,74.7)),
                            dot(ci+g,vec3(269.5,183.3,246.1)),
                            dot(ci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
      float d=length(g+o-cf);
      if(d<F1){F2=F1; F1=d; cCenter=o;} else if(d<F2){F2=d;}
    }
    // Variable crater size per cell (hash-driven)
    float cSizeH = fract(sin(dot(ci,vec3(71.3,23.9,157.7)))*43758.5);
    float cSize  = mix(0.14, 0.28, cSizeH); // crater radius in cell space
    // Bowl: smooth depression — deeper for older, well-developed craters
    float bowl = (1.0 - smoothstep(0.0, cSize, F1)) * uCraterDensity;
    h -= bowl * 0.52;
    // Raised rim ring — sharp ejecta berm
    float rimInner = cSize * 0.86, rimOuter = cSize * 1.22;
    float rim = smoothstep(rimInner, cSize, F1) * (1.0 - smoothstep(cSize, rimOuter, F1));
    h += rim * uCraterDensity * 0.22;
    // Ejecta blanket: low-angle radial stripes beyond the rim
    float ejectaR = cSize * 1.22, ejectaFar = cSize * 1.80;
    float ejecta  = (1.0 - smoothstep(ejectaR, ejectaFar, F1))
                  * (0.5 + 0.5 * sin(atan(pos.z - ci.z, pos.x - ci.x) * 8.0 + ci.x * 47.3));
    h += ejecta * uCraterDensity * 0.06;
    // Central peak for larger craters (rebound uplift, cSizeH>0.55)
    float centralPeak = (1.0 - smoothstep(0.0, cSize * 0.18, F1))
                       * step(0.55, cSizeH) * uCraterDensity;
    h += centralPeak * 0.22;
    // Track crater proximity for bump amplification in main()
    _gCraterInfluence = (1.0 - smoothstep(0.0, cSize * 1.25, F1))
                       * clamp(uCraterDensity * 4.0, 0.0, 1.0);
    // Outer ejecta blanket — gradual slope outside rim
    float ejectaBlanket = smoothstep(rimOuter, rimOuter * 1.60, F1)
                        * (1.0 - smoothstep(rimOuter * 1.60, rimOuter * 2.80, F1));
    h += ejectaBlanket * uCraterDensity * 0.035;
  }

  if(uVolcanism > 0.01)
    h += smoothstep(0.62,0.82,fbm3(pos*sc*0.8+uSeed+500.0))*uVolcanism*0.18;

  if(uCrackIntensity > 0.01) {
    vec3 crW = pos*sc*3.5+uSeed+400.0;
    crW += vec3(noise3D(pos*sc*1.8+uSeed+410.0),noise3D(pos*sc*1.8+uSeed+420.0),
                noise3D(pos*sc*1.8+uSeed+430.0))*0.35;
    float cr = abs(noise3D(crW)*2.0-1.0);
    float crW2 = 0.06+noise3D(pos*sc*2.0+uSeed+440.0)*0.05;
    float crBreak = smoothstep(0.2,0.5,noise3D(pos*sc*1.2+uSeed+450.0));
    h -= (1.0-smoothstep(0.0,crW2,cr))*uCrackIntensity*0.06*crBreak;
  }

  h = mix(h, h*0.7+0.15, (1.0-uTerrainAge)*0.3);

  // ── Glacial height profile ────────────────────────────────
  // Ice zones get their own 3D terrain instead of a flat sheet.
  // Normals are computed from finite-difference of terrainHeight(), so all
  // of this structure gets real bump/shading automatically.
  if(_gIsPolar > 0.001) {
    float iceBase = 0.60;   // ice sheet sits above sea level
    // Broad dome rolls — amplitude high enough that eps=0.005 finite diff picks it up
    float iceRoll = fbm3(pos * uNoiseScale * 0.55 + uSeed + 800.0) * 0.30
                  + fbm3(pos * uNoiseScale * 1.4  + uSeed + 811.0) * 0.14
                  + fbm3(pos * uNoiseScale * 3.2  + uSeed + 822.0) * 0.06;
    // Sastrugi: high-frequency wind-scoured ridges
    float iceFine = noise3D(pos * uNoiseScale * 7.0 + uSeed + 820.0) * 0.040
                  + noise3D(pos * uNoiseScale * 14.0 + uSeed + 840.0) * 0.016;
    // Crevasse troughs
    float crevRaw  = abs(noise3D(pos * uNoiseScale * 5.0 + uSeed + 830.0) * 2.0 - 1.0);
    float crevSlot = (1.0 - smoothstep(0.0, 0.10, crevRaw)) * 0.08;
    // Pressure ridge at the calving front (zone boundary)
    float ridge    = smoothstep(0.08, 0.0, _gProvEdge) * 0.12;
    float glacialH = iceBase + iceRoll + iceFine - crevSlot + ridge;
    h = mix(h, glacialH, _gIsPolar);
  }

  // Zone elevation bias (set by main() before each call) — shifts terrain into
  // the correct depth regime for this zone type. Cancels in gradient offsets.
  return h + _gZoneElev;
}

// =============================================================
// GAS GIANT
// =============================================================
vec3 gasGiantColor(vec3 pos) {
  float lat = pos.y, seed = uSeed;
  float bf = 4.5 + sin(seed*7.13)*1.5;

  // Latitude-differential wind: equator faster, poles slower
  float windSpeed = cos(asin(clamp(lat,-1.0,1.0))) * uTime * 0.12;
  vec3 wpos = vec3(pos.x*cos(windSpeed)-pos.z*sin(windSpeed), pos.y,
                   pos.x*sin(windSpeed)+pos.z*cos(windSpeed));
  float tEvol = uTime * 0.04;

  // Multi-scale turbulence
  float turb  = fbm5(wpos*5.0 + vec3(0.0, tEvol*0.5, seed+100.0));
  float turbF = fbm3(wpos*12.0 + vec3(0.0, tEvol*0.8, seed+200.0));
  float shear = noise3D(vec3(lat*3.5, uTime*0.05, seed)) * 0.18;
  float lon   = atan(wpos.z, wpos.x);

  // ── BELT / ZONE ALTERNATION ───────────────────────────────
  // rawBand oscillates +/-1. |rawBand| near 1 → belt (dark, turbulent).
  // |rawBand| near 0 → zone (bright, smooth, cream/white).
  float rawBand  = sin(lat * bf  + turbF * 0.50 + shear);
  float rawBand2 = sin(lat * bf * 1.62 + turb   * 0.28);  // harmonic overtone

  // Belt mask: 1 inside belts, 0 inside zones
  float beltMask = smoothstep(0.12, 0.75, abs(rawBand));
  beltMask = mix(beltMask, smoothstep(0.20, 0.82, abs(rawBand2)), 0.22);
  float zoneMask = 1.0 - beltMask;

  // Festoons: scalloped turbulence at belt-zone boundaries (wind jets)
  float onEdge  = exp(-pow((abs(rawBand) - 0.12) * 7.0, 2.0));  // peaks at belt edge
  float festoon = sin(lon*9.0  + lat*16.0 + turb*5.5  - uTime*0.25) * 0.5 + 0.5;
  float festF   = sin(lon*14.0 - lat*10.0 + turbF*4.0 + uTime*0.35) * 0.3 + 0.5;

  // ── COLOR MAPPING ─────────────────────────────────────────
  // bz: slow latitudinal hue drift so N hemisphere ≠ S hemisphere
  float bz = sin(lat * bf * 0.5) * 0.5 + 0.5;

  // Zones: lighter, cream/white — lifted luminance
  vec3 zoneCol = mix(uColor2 * 1.42, uColor1 * 0.95, bz);
  zoneCol = mix(zoneCol, vec3(0.96, 0.93, 0.86), zoneMask * 0.28);  // cream highlight

  // Belts: darker, richer browns/tans
  vec3 beltCol = mix(uColor1 * 0.48, uColor3 * 0.82, bz * 0.60 + 0.18);
  beltCol = mix(beltCol, uColor3, smoothstep(0.42, 0.68, turb) * 0.35);  // turb tints

  // Blend zones vs belts — high contrast
  vec3 col = mix(zoneCol, beltCol, beltMask * 0.92);

  // Festoon streaks: belt-colored plumes poking into zone territory at edges
  col = mix(col, beltCol * 0.82, onEdge * festoon * 0.42);
  col = mix(col, col * 1.18 + vec3(0.04, 0.03, 0.0), onEdge * festF * 0.18);

  // Micro-chevron V-jets at belt edges (angled wind features)
  float chevZ = smoothstep(0.0, 0.18, abs(rawBand)) * (1.0 - smoothstep(0.18, 0.42, abs(rawBand)));
  float chev  = sin(lon*8.0  + lat*18.0 + turb*6.0  + uTime*0.22) * 0.5 + 0.5;
  float chevF = sin(lon*13.0 - lat*12.0 + turbF*4.5 + uTime*0.30) * 0.3 + 0.5;
  col = mix(col, col * mix(0.78, 1.22, chev), chevZ * (chev*0.6 + chevF*0.4) * 0.20);
  // ── Great Storm (persistent anticyclone — GRS analog) ─────────────
  // Elliptical vortex with warm core + bright edge ring + spiral arm system.
  float sLat = 0.35 + sin(seed*3.14)*0.2;
  float sLon = seed*1.618 + uTime*0.07;          // slow orbital drift
  vec3  sc   = vec3(cos(sLon)*cos(sLat), sin(sLat), sin(sLon)*cos(sLat));
  float sDist = length(pos - sc);

  // Elliptical footprint (latitude-stretched to 1.6:1 aspect ratio)
  float sDistE = length(vec2((pos.x-sc.x)*1.6 + (pos.z-sc.z)*1.6, (pos.y-sc.y)*2.5));
  float sm = 1.0 - smoothstep(0.0, 0.24, sDistE);

  if(sm > 0.001) {
    float ang = atan(pos.z - sc.z, pos.x - sc.x);
    // Spiral arms: 4 primary + 2 secondary, tighten toward center
    float spiral = sin(ang*4.0 + sDist*28.0 - uTime*0.80)*0.5+0.5;
    float spiralF = sin(ang*7.0 - sDist*18.0 + uTime*0.55)*0.3+0.5;
    float stormSwirl = spiral*0.65 + spiralF*0.35;
    // Edge ring: bright contrasting boundary zone
    float edgeRing = smoothstep(0.0, 0.06, sDistE) * (1.0 - smoothstep(0.06, 0.24, sDistE));
    vec3 stormCol = mix(uColor3 * 1.18, vec3(1.0, 0.88, 0.72), stormSwirl * 0.45);
    col = mix(col, stormCol, sm * 0.82);
    col = mix(col, col * 1.35 + uColor3 * 0.15, edgeRing * 0.55);
  }

  // Secondary oval storm (opposite hemisphere, different longitude)
  float s2Lat = -0.20 + sin(seed*5.67)*0.15;
  float s2Lon = seed*2.71 + uTime*0.05;
  vec3  s2c   = vec3(cos(s2Lon)*cos(s2Lat), sin(s2Lat), sin(s2Lon)*cos(s2Lat));
  float s2m   = 1.0 - smoothstep(0.0, 0.14, length(pos - s2c));
  if(s2m > 0.001) {
    float s2ang = atan(pos.z-s2c.z, pos.x-s2c.x);
    float s2swirl = sin(s2ang*5.0 + length(pos-s2c)*20.0 + uTime*1.1)*0.5+0.5;
    col = mix(col, uColor3 * 1.15 + vec3(0.06,0.04,0.0), s2m * (0.55 + s2swirl*0.25));
  }

  // Tertiary oval — smaller, faster-drifting, mid-latitude opposite side
  float s3Lat = 0.15 + sin(seed*8.31)*0.12;
  float s3Lon = seed*4.23 + uTime*0.09;
  vec3  s3c   = vec3(cos(s3Lon)*cos(s3Lat), sin(s3Lat), sin(s3Lon)*cos(s3Lat));
  float s3m   = 1.0 - smoothstep(0.0, 0.10, length(pos - s3c));
  if(s3m > 0.001) {
    float s3ang   = atan(pos.z-s3c.z, pos.x-s3c.x);
    float s3swirl = sin(s3ang*6.0 + length(pos-s3c)*24.0 - uTime*1.4)*0.5+0.5;
    col = mix(col, uColor1 * 1.20 + vec3(0.04,0.02,0.0), s3m * (0.45 + s3swirl*0.30));
  }

  // Polar vortex — dark cool cyclone cap at both poles (Jupiter/Neptune analog)
  float polarT  = smoothstep(0.70, 0.95, abs(lat));
  if(polarT > 0.001) {
    float polLon  = atan(wpos.z, wpos.x) * 3.0 + uTime * 0.18 * sign(lat);
    float polSwirl = fbm3(vec3(polLon * 0.15, abs(lat) * 4.0, seed + 500.0) + uTime * 0.03);
    // Dark core surrounded by turbulent vortex clouds
    vec3 vortexCol = mix(uColor2 * 0.55, uColor1 * 0.80, polSwirl);
    vortexCol = mix(vortexCol, vortexCol * 0.60, smoothstep(0.85, 0.98, abs(lat)));
    col = mix(col, vortexCol, polarT * 0.70);
    // Bright vortex ring just inside the dark polar cap
    float vortexRing = smoothstep(0.68, 0.72, abs(lat)) * (1.0 - smoothstep(0.72, 0.80, abs(lat)));
    col = mix(col, col * 1.30 + vec3(0.04, 0.03, 0.01), vortexRing * 0.40);
  }

  return col;
}

// =============================================================
// ZONE TEXTURE SPLAT helper — 5 textures bilinear-blended
// elev = zone.x (0=basin, 1=highland), rough = zone.y (0=smooth, 1=active)
// =============================================================
vec3 zoneSplat(vec3 p, vec3 n, float sc, float elev, float rough) {
  float w0=(1.0-elev)*(1.0-rough);
  float w1=(1.0-elev)*rough;
  float w2=clamp(1.0-2.0*abs(elev-0.5),0.0,1.0)*clamp(1.0-2.0*abs(rough-0.5),0.0,1.0);
  float w3=elev*(1.0-rough);
  float w4=elev*rough;
  float wS=max(w0+w1+w2+w3+w4,0.001);
  vec3 z0=triplanarSample(uZoneTex0,p,n,sc);
  vec3 z1=triplanarSample(uZoneTex1,p,n,sc*1.15);
  vec3 z2=triplanarSample(uZoneTex2,p,n,sc*0.85);
  vec3 z3=triplanarSample(uZoneTex3,p,n,sc*1.05);
  vec3 z4=triplanarSample(uZoneTex4,p,n,sc*1.30);
  return (z0*w0+z1*w1+z2*w2+z3*w3+z4*w4)/wS;
}

` + ICEBERGS_GLSL + ICECAPS_GLSL + CLOUDS_GLSL + CRYOPLUMES_GLSL + ICEFLOES_GLSL + /* glsl */`

// =============================================================
// FEATURE 6: VEGETATION BIOME ZONES
// Zone-char axes drive continuous biome weights.
// Called on land fragments only (isOcean == false).
// =============================================================
void applyVegetation(inout vec3 color, vec3 pos, vec3 N, float NdotL,
                     int bZone, vec3 zoneChar, float absLat,
                     float globalIce, bool isOcean) {
  if(isOcean) return;
  if(uAtmThickness <= 0.04) return;
  // FIX 5: No vegetation on worlds too hot or too cold for biology
  if(uEquatorTemp > 375.0 || uEquatorTemp < 185.0) return;
  // FIX 5: No vegetation without surface water
  if(uOceanLevel < 0.08) return;

  // zoneChar.x = elevation/aridity (0=low/wet, 1=high/dry)
  // zoneChar.y = roughness/geology
  // zoneChar.z = temperature proxy (0=cold, 1=hot)
  float aridity = zoneChar.x;
  // FIX 6: Physical temperature proxy — maps 200K-400K to 0-1
  float temp = clamp((uEquatorTemp - 200.0) / 200.0, 0.0, 1.0);

  // Continuous biome weights from character axes + latitude
  // Tropical rainforest: hot, wet, low latitude
  float wTropical = smoothstep(0.6, 0.85, temp)
                  * smoothstep(0.4, 0.1, aridity)
                  * smoothstep(0.45, 0.25, absLat);

  // Temperate forest: moderate temp, wet, mid latitude
  float wTemperate = smoothstep(0.35, 0.50, temp) * (1.0 - smoothstep(0.55, 0.75, temp))
                   * smoothstep(0.5, 0.2, aridity)
                   * smoothstep(0.25, 0.38, absLat) * (1.0 - smoothstep(0.55, 0.70, absLat));

  // Boreal taiga: cold, moderate moisture, high latitude
  float wBoreal = smoothstep(0.40, 0.20, temp)
                * smoothstep(0.65, 0.45, aridity)
                * smoothstep(0.50, 0.65, absLat);

  // Savanna/grassland: moderate temp, dry, low-mid latitude
  float wSavanna = smoothstep(0.3, 0.55, temp) * (1.0 - smoothstep(0.55, 0.70, temp))
                 * smoothstep(0.45, 0.65, aridity)
                 * smoothstep(0.50, 0.30, absLat);

  // Desert scrub: hot + very dry
  float wDesertScrub = smoothstep(0.65, 0.85, aridity)
                     * smoothstep(0.5, 0.7, temp);

  // Tundra: cold, moderate latitude
  float wTundra = smoothstep(0.35, 0.15, temp)
                * smoothstep(0.40, 0.58, absLat) * (1.0 - smoothstep(0.72, 0.85, absLat));

  float wSum = wTropical + wTemperate + wBoreal + wSavanna + wDesertScrub + wTundra;
  if(wSum < 0.001) return;

  // Normalise
  wTropical    /= wSum;
  wTemperate   /= wSum;
  wBoreal      /= wSum;
  wSavanna     /= wSum;
  wDesertScrub /= wSum;
  wTundra      /= wSum;

  // Biome colour palettes (additive tints)
  vec3 cTropical    = vec3(0.08, 0.28, 0.06);
  // Temperate: summer or autumn tint based on seed
  vec3 cTemperate   = mix(vec3(0.12, 0.32, 0.08), vec3(0.38, 0.28, 0.08),
                          step(0.5, fract(uSeed * 0.01)));
  vec3 cBoreal      = vec3(0.06, 0.18, 0.10);
  vec3 cSavanna     = vec3(0.38, 0.34, 0.08);
  vec3 cDesertScrub = vec3(0.28, 0.26, 0.14);
  vec3 cTundra      = vec3(0.22, 0.26, 0.16);

  // Blend strengths (desert scrub is sparse)
  float sTropical    = 0.38;
  float sTemperate   = 0.32;
  float sBoreal      = 0.28;
  float sSavanna     = 0.30;
  float sDesertScrub = 0.12;
  float sTundra      = 0.25;

  vec3 vegTint = cTropical    * wTropical    * sTropical
               + cTemperate   * wTemperate   * sTemperate
               + cBoreal      * wBoreal      * sBoreal
               + cSavanna     * wSavanna     * sSavanna
               + cDesertScrub * wDesertScrub * sDesertScrub
               + cTundra      * wTundra      * sTundra;

  // Global modifiers: no ice, sunlit only, fine-grain noise variation
  float noIce    = 1.0 - globalIce;
  float sunlit   = smoothstep(0.02, 0.12, NdotL);
  // FIX 7: larger-scale variation pattern (was 35.0 — fine speckle)
  float varNoise = noise3D(pos * 5.0 + uSeed + 77.0) * 0.5 + 0.5;

  float vegStr = wSum * noIce * sunlit * varNoise;
  color = mix(color, color + vegTint, clamp(vegStr, 0.0, 1.0));
}

// =============================================================
// FEATURE 9: SUBSURFACE OCEAN WORLDS (Europa-type)
// Called after ice caps, guarded by uSubsurfaceOcean > 0.5.
// Replaces color entirely — fully ice-covered worlds.
// =============================================================
void applySubsurfaceOcean(inout vec3 color, vec3 pos, vec3 N, vec3 L, vec3 V, vec3 H,
                           float NdotL, float globalIce, float ice) {
  if(uSubsurfaceOcean <= 0.5) return;

  // 1. Ice shell base: smooth blue-white
  vec3 iceShellColor = vec3(0.78, 0.88, 0.96) * (0.15 + NdotL * 0.85);

  // 2. Tholins: reddish-brown organic chemistry in crevasse/crack network
  float tholinPattern = abs(sin(dot(pos * 12.0 + uSeed, vec3(1.0, 1.618, 2.414))));
  float tholinMask    = step(tholinPattern, 0.08);
  vec3  tholinColor   = vec3(0.52, 0.28, 0.12);
  iceShellColor = mix(iceShellColor, tholinColor * (0.15 + NdotL * 0.60), tholinMask * 0.72);

  // 3. Subsurface ocean glow: blue-teal through thin ice regions
  float thinIceN = noise3D(pos * 5.0 + uSeed + 700.0) * 0.5 + 0.5;
  float thinIce  = smoothstep(0.55, 0.35, thinIceN);
  vec3  oceanGlow = vec3(0.04, 0.18, 0.52) * thinIce * 0.30 * (0.5 + NdotL * 0.5);
  iceShellColor += oceanGlow;

  // 4. Cryovolcanic geysers along fault seams (if tidal heating present)
  if(uResonanceHeat > 0.4) {
    float geyserSeam = step(abs(sin(pos.x * 11.0 + uSeed * 3.1)), 0.025);
    vec3  geyserCol  = vec3(0.95, 0.98, 1.00);
    iceShellColor = mix(iceShellColor, iceShellColor + geyserCol * uResonanceHeat * 0.55,
                        geyserSeam * 0.80);
  }

  // 5. Ridge systems: double-ridge morphology compression features
  float ridgeRaw  = sin(dot(pos * 15.0 + uSeed, vec3(1.0, 0.0, 1.0))) * 0.5 + 0.5;
  float ridgeLine = 1.0 - smoothstep(0.0, 0.08, abs(ridgeRaw - 0.5));
  iceShellColor += vec3(0.15, 0.18, 0.22) * ridgeLine * 0.45;

  // Replace color entirely
  color = iceShellColor;
}

// =============================================================
// FEATURE A — REEF / BIOLUMINESCENT SHALLOWS
// Active zone: depth01 < 0.10, absLat < 0.60, uAtmThickness > 0.03
// Dayside: coral/sandy reef patchwork + specular sparkle.
// Night-side: animated bioluminescent glow cells.
// =============================================================
void applyReef(inout vec3 color, vec3 pos, vec3 N, vec3 L, vec3 V, vec3 H,
               float NdotL, float depth01, float absLat, bool isOcean) {
  if(!isOcean) return;
  if(depth01 >= 0.10) return;
  if(absLat >= 0.60)  return;
  if(uAtmThickness <= 0.03) return;

  // ── Dayside reef appearance ─────────────────────────────────
  // Base reef colour: turquoise-cyan mixed with sandy substrate
  float substrateN = noise3D(pos * 22.0 + uSeed + 440.0) * 0.5 + 0.5;
  vec3  reefBase   = mix(vec3(0.12, 0.65, 0.72), vec3(0.72, 0.62, 0.38), substrateN);

  // Coral patchiness: live (bright) vs dead/rubble (pale grey-brown)
  float coralHash = fract(sin(dot(floor(pos * 18.0 + uSeed + 450.0),
                                  vec3(127.1, 311.7, 74.7))) * 43758.5);
  // 60% live reef (coralHash > 0.40), 40% dead/rubble
  vec3  reefCol   = coralHash > 0.40 ? reefBase
                  : mix(vec3(0.72, 0.68, 0.62), vec3(0.68, 0.60, 0.48), coralHash * 2.5);

  // Depth-based bleaching toward edge of reef zone
  reefCol = mix(reefCol, vec3(0.85, 0.82, 0.78), smoothstep(0.04, 0.09, depth01));

  // Specular sparkle through shallow water
  float reefSpec = pow(max(dot(N, H), 0.0), 28.0) * NdotL * 0.65;
  reefCol += vec3(0.90, 0.95, 1.00) * reefSpec;

  // Reef mask: fade at depth boundary
  float reefMask = smoothstep(0.10, 0.02, depth01);

  // Blend dayside reef
  color = mix(color, reefCol, reefMask * 0.78);

  // ── Night-side bioluminescence ──────────────────────────────
  float nightFrac = 1.0 - clamp(NdotL * 8.0, 0.0, 1.0);

  // Animated pulse per-cell
  float bioPhase  = sin(uTime * 0.8 + dot(pos, vec3(7.3, 11.2, 5.7)) * 8.0) * 0.5 + 0.5;

  // Sparse glowing cells: hash > 0.72 activates
  float bioHash   = fract(sin(dot(floor(pos * 25.0 + uSeed * 3.1 + 460.0),
                                  vec3(269.5, 183.3, 246.1))) * 43758.5);
  float bioCell   = step(0.72, bioHash);

  float bioStr    = nightFrac * 0.35 * uAtmThickness * smoothstep(0.10, 0.02, depth01);
  vec3  bioCol    = vec3(0.02, 0.55, 0.72) * bioPhase * bioCell * bioStr;

  // Additive glow on night side
  color += bioCol;
}

// ── Ring band opacity: 0=transparent, 1=opaque ──────────────────────────
// r: normalised radius, 0=inner edge of ring system, 1=outer edge.
// Encodes Saturn-analogue A/B/C rings + Cassini division.
float ringBandDensity(float r) {
  float d   = smoothstep(0.00,0.04,r)*(1.0-smoothstep(0.05,0.08,r))*0.10;  // D ring
  float c   = smoothstep(0.08,0.14,r)*(1.0-smoothstep(0.28,0.31,r))*0.32;  // C ring
  float b   = smoothstep(0.31,0.36,r)*(1.0-smoothstep(0.59,0.62,r))*0.88;  // B ring (dense)
  float cas = smoothstep(0.620,0.625,r)*(1.0-smoothstep(0.645,0.650,r));    // Cassini gap
  float a   = smoothstep(0.65,0.70,r)*(1.0-smoothstep(0.93,0.98,r))*0.70;  // A ring
  return clamp((d+c+b+a)*(1.0-cas*0.93), 0.0, 1.0);
}

// =============================================================
// FEATURE B — SNOWBALL / ROGUE PLANET
// Active when uIsIceWorld > 0.5.
// Three surface types: fresh snow, compacted ice, methane/tholin.
// Rogue variant (uAtmThickness < 0.05): near-black, decay heat in fractures.
// =============================================================
void applySnowball(inout vec3 color, vec3 pos, vec3 N, vec3 L, vec3 V, vec3 H, float NdotL) {
  if(uIsIceWorld <= 0.5) return;

  float baseN = noise3D(pos * 3.0 + uSeed) * 0.5 + 0.5;

  // ── Three surface type zones ────────────────────────────────
  // Fresh CO2/N2 snow plains (high, ~40%): brilliant white-blue
  vec3  snowPlains = vec3(0.88, 0.92, 0.98);
  // Compacted water ice (mid, ~35%): blue-grey
  vec3  compactIce = vec3(0.62, 0.72, 0.86);
  // Methane/tholin ice (low, ~25%): warm rust-orange
  vec3  tholinIce  = vec3(0.62, 0.38, 0.18);

  // Blend: 0-0.35 = tholin, 0.35-0.65 = compact ice, 0.65-1.0 = snow
  vec3 snowballColor;
  if(baseN < 0.35) {
    snowballColor = mix(tholinIce, compactIce, baseN / 0.35);
  } else if(baseN < 0.65) {
    snowballColor = mix(compactIce, snowPlains, (baseN - 0.35) / 0.30);
  } else {
    snowballColor = snowPlains;
  }

  // ── Rogue planet (no atmosphere) ───────────────────────────
  bool isRogue = uAtmThickness < 0.05;
  if(isRogue) {
    // Near-black surface — no stellar illumination
    snowballColor *= 0.15;

    // Internal decay heat in fractures
    float fracturePat = abs(sin(dot(pos * 9.0 + uSeed, vec3(1.618, 2.414, 1.0))));
    float fractureMask = step(fracturePat, 0.03);
    snowballColor = mix(snowballColor, vec3(0.28, 0.08, 0.02), fractureMask);

    // Dim ambient so silhouette is visible
    snowballColor += vec3(0.02, 0.02, 0.04);
  }

  // ── Universal snowball features ─────────────────────────────
  // Sublimation flow streaks: pole→equator direction
  float streakFbm = fbm3(pos * 4.0 + uSeed);
  float streak    = sin(pos.x * 14.0 + streakFbm * 3.0) * 0.5 + 0.5;
  snowballColor   = mix(snowballColor, snowballColor * mix(0.88, 1.08, streak), 0.25);

  // Pressure crack network: dark linear slots
  vec3  crW  = pos * 3.5 + uSeed + 400.0;
  crW += vec3(fbm3(pos * 1.8 + uSeed + 410.0),
              fbm3(pos * 1.8 + uSeed + 420.0),
              fbm3(pos * 1.8 + uSeed + 430.0)) * 0.45;
  float crRaw = abs(noise3D(crW) * 2.0 - 1.0);
  float crSlot = 1.0 - smoothstep(0.0, 0.10, crRaw);
  snowballColor *= mix(1.0, 0.55, crSlot * 0.60);

  // SSS in cracks: blue-violet tint
  float crSSS = pow(1.0 - max(dot(N, V), 0.0), 2.8) * crSlot * 0.30;
  snowballColor += vec3(0.04, 0.12, 0.42) * crSSS;

  // High specular on ice surface
  float iceSpec = pow(max(dot(N, H), 0.0), 95.0) * NdotL * 0.90;
  snowballColor += vec3(0.95, 0.98, 1.00) * iceSpec;

  // Final blend: mix(color, snowballColor, uIsIceWorld)
  color = mix(color, snowballColor, uIsIceWorld);
}

// =============================================================
// FEATURE: MOON-SPECIFIC SURFACE RENDERING
// Guard: uIsMoon > 0.01. Apply after vegetation/desert streaks on land.
// =============================================================
void applyMoonSurface(inout vec3 color, vec3 pos, vec3 N, vec3 L, vec3 H,
                      float NdotL, vec3 zoneCharIn, bool isOcean, float globalIce) {
  if(uIsMoon <= 0.01) return;

  // 1. Regolith base tone — greyish-brown powdery surface
  vec3 regoColor = mix(color, vec3(0.52, 0.48, 0.42), uIsMoon * 0.55);
  // Darker maria basalt in low terrain (low zoneCharIn.x)
  regoColor = mix(regoColor, vec3(0.22, 0.20, 0.18),
                  smoothstep(0.55, 0.38, zoneCharIn.x) * 0.60);
  color = regoColor;

  // 2. Ray system — bright ejecta rays from large craters
  float rayPattern = sin(atan(pos.z, pos.x) * 8.0 + uSeed * 2.3) * 0.5 + 0.5;
  float rayMask    = smoothstep(0.60, 0.90, rayPattern);
  float rayNoiseV  = noise3D(pos * 4.0 + uSeed) * 0.5 + 0.5;
  color = mix(color, vec3(0.78, 0.76, 0.72),
              0.30 * rayMask * (1.0 - smoothstep(0.45, 0.70, rayNoiseV)));

  // 3. Space weathering darkening — micrometeorite gardening on sunlit faces
  color *= (1.0 - uIsMoon * 0.18 * NdotL);

  // 4. Terminator sharpening — extremely sharp day/night transition without atmosphere
  color = mix(color, vec3(0.0),
              (1.0 - clamp(NdotL * 8.0, 0.0, 1.0)) * uIsMoon * 0.85);

  // 5. Specular suppression — regolith is extremely non-specular
  color = mix(color, color * 0.92,
              uIsMoon * 0.35 * pow(max(dot(N, H), 0.0), 2.0));
}

// =============================================================
// STORM SYSTEMS
// =============================================================
void applyStorms(inout vec3 color, vec3 pos, vec3 N, vec3 L, float NdotL, bool isOcean) {
  if(uStormIntensity < 0.01 || uStormSize < 0.01) return;

  // Storm centre in Cartesian space: (lat, lon) → unit sphere
  vec3 sCent = vec3(cos(uStormLon) * cos(uStormLat),
                   sin(uStormLat),
                   sin(uStormLon) * cos(uStormLat));

  // Angular distance from storm centre via dot product distance
  float stormDist = length(pos - sCent);

  float outerR = uStormSize * 0.55;
  // Storm disk mask: smooth falloff from centre
  float stormMask = (1.0 - smoothstep(0.0, outerR, stormDist)) * uStormIntensity;
  if(stormMask < 0.005) return;

  // Latitude/longitude of current fragment for spiral
  float lat = asin(clamp(pos.y, -1.0, 1.0));
  float lon = atan(pos.z, pos.x);

  // Vectors from storm center in local tangent space
  float dx = pos.x - sCent.x;
  float dz = pos.z - sCent.z;

  // Eye of storm: clear region at the very centre
  float eyeR = uStormSize * 0.07;
  float eyeMask = smoothstep(eyeR * 0.6, eyeR, stormDist);  // 0 inside eye, 1 outside

  // Spiral cloud bands: rotating vortex pattern
  float spiral = sin(stormDist * 28.0 - atan(dz, dx) * 3.0 + uTime * 0.15) * 0.5 + 0.5;

  // Eye wall: bright thick ring of cloud
  float eyeWallInner = uStormSize * 0.07;
  float eyeWallOuter = uStormSize * 0.12;
  float eyeWall = smoothstep(eyeWallInner, eyeWallOuter * 0.5, stormDist)
                * (1.0 - smoothstep(eyeWallOuter * 0.5, eyeWallOuter, stormDist));

  // Storm cloud color: slightly darker and more saturated than ambient clouds
  // Ocean storms: greenish-grey; gas giant great spots: reddish-brown
  vec3 stormCloudBase;
  if(isOcean) {
    stormCloudBase = mix(vec3(0.58, 0.68, 0.62), vec3(0.72, 0.78, 0.74), spiral * 0.5);
  } else {
    stormCloudBase = mix(uColor3 * 1.08, uColor1 * 0.78 + vec3(0.06, 0.03, 0.0), spiral * 0.5);
  }

  // Blend storm into color — spiral bands + eye wall brightness
  color = mix(color, stormCloudBase, stormMask * eyeMask * (0.55 + spiral * 0.25));
  color = mix(color, vec3(0.90, 0.93, 0.96), eyeWall * stormMask * 0.72);
  // Eye: clear, shows underlying surface
  color = mix(color, color * 1.08, (1.0 - eyeMask) * stormMask * 0.50);

  // Lightning flash: brief white flash at uStormIntensity > 0.5
  if(uStormIntensity > 0.5) {
    float ltFlash = fract(uTime * 0.3 + dot(pos, vec3(13.7, 7.3, 19.1)));
    if(ltFlash > 0.995) {
      color += vec3(0.90, 0.92, 1.00) * stormMask * eyeMask * 0.55;
    }
  }
}

// =============================================================
// TERRAIN BASE — world-type × zone-role → curated (ze, zr, zm)
// =============================================================
// Replaces arbitrary hash-driven zone characters with a world-type-
// specific terrain vocabulary. Each world type has named terrain types
// per zone role; tV (0.0 / 0.5 / 1.0) picks one of 3 variants within
// the DEFAULT role, giving within-role diversity without randomness.
//
// ze: elevation  0=basin  1=highland
// zr: roughness  0=smooth 1=rough/active
// zm: mineral    0=silicate  1=iron-oxide/dark
//
// wm:   uWorldMode  0=rocky/airless 1=habitable 2=volcanic 3=icy 4=moon
// role: zone role float (ZONE_ROLE constants)
// tV:   variant 0.0/0.5/1.0
void terrainBase(float wm, float role, float tV,
                 out float ze, out float zr, out float zm) {
  // Safe fallback
  ze = 0.35; zr = 0.30; zm = 0.45;

  float isDefault = step(role, 0.5);

  // ── ROCKY / AIRLESS ───────────────────────────────────────────────────
  if(wm < 0.5) {
    // DEFAULT: dust plain / reg gravel / hamada plateau
    if(isDefault > 0.5) {
      ze = mix(mix(0.18, 0.35, step(0.25, tV)), 0.65, step(0.75, tV));
      zr = mix(mix(0.12, 0.42, step(0.25, tV)), 0.22, step(0.75, tV));
      zm = mix(mix(0.35, 0.55, step(0.25, tV)), 0.62, step(0.75, tV));
    }
    if(role > 4.5 && role < 5.5) { ze=0.82; zr=0.14; zm=0.72; } // CRATON: old slab
    if(role > 5.5 && role < 6.5) { ze=0.12; zr=0.88; zm=0.20; } // RIFT: scarp
    if(role > 9.5)                { ze=0.30; zr=0.92; zm=0.38; } // HOTSPOT: lava field
  }

  // ── HABITABLE ─────────────────────────────────────────────────────────
  else if(wm < 1.5) {
    // DEFAULT: lowland soil / mixed terrain / highland meadow
    if(isDefault > 0.5) {
      ze = mix(mix(0.28, 0.50, step(0.25, tV)), 0.72, step(0.75, tV));
      zr = mix(mix(0.25, 0.40, step(0.25, tV)), 0.30, step(0.75, tV));
      zm = mix(mix(0.32, 0.45, step(0.25, tV)), 0.58, step(0.75, tV));
    }
    if(role > 4.5 && role < 5.5) { ze=0.78; zr=0.18; zm=0.65; } // CRATON: granite shield
    if(role > 5.5 && role < 6.5) { ze=0.15; zr=0.82; zm=0.22; } // RIFT: fresh basalt
    if(role > 6.5 && role < 7.5) { ze=0.22; zr=0.15; zm=0.40; } // SHELF: carbonate flat
    if(role > 7.5 && role < 8.5) { ze=0.85; zr=0.78; zm=0.28; } // RIDGE: submarine crest
    if(role > 8.5 && role < 9.5) { ze=0.08; zr=0.55; zm=0.18; } // TRENCH: hadal mud
    if(role > 9.5)                { ze=0.40; zr=0.90; zm=0.28; } // HOTSPOT: island chain
  }

  // ── VOLCANIC ──────────────────────────────────────────────────────────
  else if(wm < 2.5) {
    // DEFAULT: ash plain / lava field / obsidian plateau
    if(isDefault > 0.5) {
      ze = mix(mix(0.15, 0.25, step(0.25, tV)), 0.55, step(0.75, tV));
      zr = mix(mix(0.35, 0.75, step(0.25, tV)), 0.58, step(0.75, tV));
      zm = mix(mix(0.42, 0.22, step(0.25, tV)), 0.18, step(0.75, tV));
    }
    if(role > 4.5 && role < 5.5) { ze=0.65; zr=0.28; zm=0.25; } // CRATON: old lava dome
    if(role > 5.5 && role < 6.5) { ze=0.08; zr=0.95; zm=0.15; } // RIFT: active caldera
    if(role > 9.5)                { ze=0.45; zr=0.95; zm=0.15; } // HOTSPOT: shield volcano
  }

  // ── ICY / SNOWBALL ────────────────────────────────────────────────────
  else if(wm < 3.5) {
    // DEFAULT: glacial plain / crevasse field / ice dome
    if(isDefault > 0.5) {
      ze = mix(mix(0.40, 0.50, step(0.25, tV)), 0.70, step(0.75, tV));
      zr = mix(mix(0.12, 0.65, step(0.25, tV)), 0.22, step(0.75, tV));
      zm = mix(mix(0.15, 0.12, step(0.25, tV)), 0.10, step(0.75, tV));
    }
    if(role > 0.5 && role < 1.5) { ze=0.55; zr=0.08; zm=0.08; } // POLAR_ICE: ice sheet
    if(role > 5.5 && role < 6.5) { ze=0.18; zr=0.78; zm=0.15; } // RIFT: cryo-rift
  }

  // ── MOON ──────────────────────────────────────────────────────────────
  else if(wm < 4.5) {
    // DEFAULT: mare basalt / highland regolith / crater ejecta blanket
    if(isDefault > 0.5) {
      ze = mix(mix(0.22, 0.62, step(0.25, tV)), 0.38, step(0.75, tV));
      zr = mix(mix(0.18, 0.32, step(0.25, tV)), 0.68, step(0.75, tV));
      zm = mix(mix(0.45, 0.65, step(0.25, tV)), 0.55, step(0.75, tV));
    }
    if(role > 4.5 && role < 5.5) { ze=0.75; zr=0.15; zm=0.72; } // CRATON: highland crust
    if(role > 5.5 && role < 6.5) { ze=0.12; zr=0.70; zm=0.48; } // RIFT: graben/scarp
    if(role > 9.5)                { ze=0.32; zr=0.85; zm=0.38; } // HOTSPOT: impact melt
  }
}

// =============================================================
// MAIN
// =============================================================
void main() {
  vec3 N   = normalize(vNormal);
  vec3 V   = normalize(vViewDir);
  vec3 L   = normalize(uSunDir);
  vec3 pos = normalize(vObjPos);
  vec3 H   = normalize(L + V);
  float rim    = 1.0 - max(dot(N, V), 0.0);
  float absLat = abs(pos.y);

  vec3 finalColor;

  // ══════════════════════════════════════════════════════════
  // GAS GIANT PATH
  // ══════════════════════════════════════════════════════════
  if(uIsGas > 0.5) {
    vec3 color = gasGiantColor(pos);
    float gasLum = dot(color,vec3(0.299,0.587,0.114));
    color = mix(vec3(gasLum),color,1.35);
    color *= 0.95+sin(pos.y*48.0+uTime*0.014+uSeed*6.3)*0.5*0.08+0.04;

    // ── FEATURE 3: Gas Giant Cloud Deck Palette ─────────────────
    // uCloudRegime: 0.0=H₂/He Jupiter, 0.33=ammonia cold giant, 0.66=methane ice, 1.0=H₂S Saturn
    // Each regime defines bandBase / bandDark / bandBright plus per-regime features.
    {
      // Band shading from latitude — layered sin drives belt/zone alternation
      float bandLat = sin(pos.y * 18.0 + fbm3(pos * 2.0 + uSeed) * 2.5) * 0.5 + 0.5;

      // Per-regime palette definitions
      // 0.0 — hydrogen/helium (Jupiter-type): cream, tan, brown, rust
      vec3 bb0 = vec3(0.86, 0.74, 0.44);  // bandBase: ochre zone
      vec3 bd0 = vec3(0.42, 0.22, 0.08);  // bandDark: brown belt
      vec3 bh0 = vec3(0.96, 0.92, 0.80);  // bandBright: cream zone highlight

      // 0.33 — ammonia cold outer giant: bright white ammonia cirrus, faint blue tint
      vec3 bb1 = vec3(0.82, 0.86, 0.92);  // bandBase: pale blue-white zone
      vec3 bd1 = vec3(0.62, 0.68, 0.78);  // bandDark: blue-grey belt
      vec3 bh1 = vec3(0.96, 0.97, 1.00);  // bandBright: bright ammonia cirrus white

      // 0.66 — methane (Uranus/Neptune): deep teal/cyan methane absorption
      vec3 bb2 = vec3(0.12, 0.52, 0.82);  // bandBase: electric azure
      vec3 bd2 = vec3(0.04, 0.24, 0.60);  // bandDark: deep navy-indigo
      vec3 bh2 = vec3(0.48, 0.74, 0.96);  // bandBright: bright blue-cyan cirrus

      // 1.0 — hydrogen-sulfide (Saturn): golden-yellow H2S hazes, cream ammonia
      vec3 bb3 = vec3(0.90, 0.78, 0.40);  // bandBase: warm golden zone
      vec3 bd3 = vec3(0.58, 0.38, 0.14);  // bandDark: warm tan H2S belt
      vec3 bh3 = vec3(0.98, 0.92, 0.70);  // bandBright: pale cream ammonia

      // Smooth interpolation between regimes using smoothstep chains
      // regime 0.0 → 0.33 → 0.66 → 1.0
      float t01 = smoothstep(0.0, 0.33, uCloudRegime);
      float t12 = smoothstep(0.33, 0.66, uCloudRegime);
      float t23 = smoothstep(0.66, 1.0,  uCloudRegime);

      vec3 bandBase   = mix(mix(bb0, bb1, t01), mix(bb2, bb3, t23), step(0.50, uCloudRegime));
      vec3 bandDark   = mix(mix(bd0, bd1, t01), mix(bd2, bd3, t23), step(0.50, uCloudRegime));
      vec3 bandBright = mix(mix(bh0, bh1, t01), mix(bh2, bh3, t23), step(0.50, uCloudRegime));

      // Apply regime palette on top of existing banding formula
      vec3 regimeColor = mix(bandDark, mix(bandBase, bandBright, bandLat), bandLat);
      float regimeBlend = clamp(0.32 + uCloudRegime * 0.10, 0.28, 0.45);
      color = mix(color, color * regimeColor * 1.35, regimeBlend);

      // Regime-specific features
      // 0.0 H₂/He: subtle oval storm scar (permanent, seeded) — already handled by gasGiantColor()
      // 0.33 ammonia: wispy cirrus streaks (high-frequency fbm elongated in longitude)
      if(uCloudRegime > 0.15 && uCloudRegime < 0.55) {
        float cirrN = fbm3(vec3(pos.x * 0.5, pos.y * 8.0, pos.z * 0.5) + uSeed + 600.0);
        float cirrStr = smoothstep(0.55, 0.70, cirrN) * (1.0 - abs(pos.y) * 1.2) * t01 * (1.0 - t12);
        color = mix(color, bh1 * 1.05, cirrStr * 0.25);
      }
      // 0.66 methane: limb-darkening enhancement + deeper polar absorption
      if(uCloudRegime > 0.48) {
        float methLimb  = pow(1.0 - abs(dot(N, V)), 2.5) * t12;
        float polarAbs  = smoothstep(0.50, 0.85, abs(pos.y)) * t12;
        color = mix(color, color * vec3(0.72, 0.88, 1.08), methLimb * 0.30);
        color = mix(color, color * vec3(0.60, 0.72, 0.96), polarAbs * 0.35);
      }
      // 1.0 H₂S: warm golden glow to cloud tops
      if(uCloudRegime > 0.75) {
        color = mix(color, color * vec3(1.12, 1.05, 0.80) + vec3(0.04, 0.02, 0.0), t23 * 0.30);
      }

      // Legacy regime tint block (kept for backward compat — subtle integration)
      vec3 cr0 = vec3(0.96, 0.94, 0.86);
      vec3 cr1 = vec3(0.64, 0.46, 0.28);
      vec3 cr2 = vec3(0.78, 0.88, 0.98);
      vec3 cr3 = vec3(0.38, 0.16, 0.08);
      vec3 regimeTint;
      if(uCloudRegime < 0.5)      regimeTint = cr0;
      else if(uCloudRegime < 1.5) regimeTint = cr1;
      else if(uCloudRegime < 2.5) regimeTint = cr2;
      else                        regimeTint = cr3;
      float regimeStr = 0.28 + abs(uCloudRegime - 1.0) * 0.12;
      color = mix(color, color * regimeTint * 1.4, clamp(regimeStr, 0.0, 0.55) * 0.40);
    }

    // ── Night-cloud asymmetry (hot Jupiters) ─────────────────
    // Clear dayside + cloud-loaded night side → night side is brighter/greyer.
    float NdotL=max(dot(N,L),0.0), term=smoothstep(-0.05,0.18,NdotL);
    float nightFace = max(0.0, -(dot(N, L) - 0.05));
    if(uNightCloudFraction > 0.01) {
      vec3 nightCloud = mix(uAtmColor * 0.65 + 0.38, vec3(0.62,0.65,0.72), 0.4);
      float ncN = fbm3(pos * 2.2 + uSeed + vec3(uTime * 0.012, 0.0, 0.0));
      color = mix(color,
                  color * 0.60 + nightCloud * 0.55,
                  uNightCloudFraction * nightFace * smoothstep(0.42, 0.65, ncN));
    }

    color *= 1.0-smoothstep(0.55,0.90,absLat)*0.25;

    // ── Hot Jupiter thermal dynamics ─────────────────────────
    // Fired when thermalGlow > 0 (hot-jupiter, cloudless-hot-jupiter, night-cloud-giant).
    // Dayside: silicate cloud evaporation → incandescent orange-white at substellar point.
    // Equatorial super-rotation: fast eastward jet stream brighter than quiescent bands.
    // Terminator storm arc: violent wind shear produces a bright streak at the day/night edge.
    if(uThermalGlow > 0.01) {
      float dayFace = max(0.0, dot(N, L));
      float hotT    = pow(dayFace, 1.4) * uThermalGlow;
      // Dayside incandescence: cool red at limb → white-orange at nadir
      vec3 dayGlow = mix(vec3(0.92, 0.36, 0.06), vec3(1.00, 0.76, 0.24), hotT * hotT);
      color = mix(color, color * 0.40 + dayGlow * 0.88, hotT * 0.60);

      // Equatorial super-rotation jet — eastward streak, elevated brightness
      float jetMask = smoothstep(0.22, 0.0, abs(pos.y));
      float jetN    = fbm3(vec3(pos.x * 0.4, pos.y * 16.0, pos.z * 0.4)
                          + uSeed + vec3(uTime * 0.045, 0.0, 0.0));
      color = mix(color, color * 1.35 + vec3(0.10, 0.04, 0.01),
                  jetMask * smoothstep(0.50, 0.68, jetN) * uThermalGlow * 0.28);

      // Terminator storm arc — wind shear instability, bright turbulent streak
      float termDot  = dot(N, L);
      float termMask = smoothstep(0.10, 0.0, abs(termDot - 0.03));
      float termN    = fbm3(pos * 4.0 + uSeed + vec3(uTime * 0.006, 0.0, 0.0));
      color = mix(color, color + vec3(0.20, 0.09, 0.02),
                  termMask * termN * uThermalGlow * 0.38);
    }

    // ── Dual-sun composite lighting ───────────────────────────
    float sunB  = max(uSunBrightness,  0.01);
    float sunB2 = uSunBrightness2;
    // Safe normalize: avoid NaN when second sun is absent (uSunDir2 = 0,0,0)
    vec3  L2    = normalize(dot(uSunDir2, uSunDir2) > 0.0001 ? uSunDir2 : L);
    float NdotL2 = max(dot(N, L2), 0.0);
    float term2  = smoothstep(-0.05, 0.18, NdotL2);
    float combinedNdotL  = clamp(NdotL  * sunB  + NdotL2 * sunB2, 0.0, 1.0);
    float combinedTerm   = mix(term, term2, sunB2 / max(sunB + sunB2, 0.01));

    finalColor = color * combinedNdotL * 0.95 * combinedTerm + color * 0.02;

    // ── Hot Jupiter night-side iron/silicate condensation glow ─
    // Iron and silicate vapors condense on the cold night side → deep crimson emissive.
    // Patchy — driven by FBM (condensation fronts aren't uniform).
    if(uThermalGlow > 0.01) {
      float nightFace2 = max(0.0, -dot(N, L) - 0.06);
      float nightN2    = fbm3(pos * 3.2 + uSeed + 880.0 + vec3(uTime * 0.018, 0.0, 0.0));
      vec3  condensGlow = mix(vec3(0.18, 0.03, 0.01), vec3(0.32, 0.08, 0.02), nightN2);
      finalColor += condensGlow * nightFace2 * uThermalGlow * 0.35;
    }

    // ── Star color tint on lit side ───────────────────────────
    finalColor = mix(finalColor, finalColor * uStarColor * 1.15, combinedTerm * 0.30);

    // ── Post-MS ambient ───────────────────────────────────────
    finalColor += uPostMsAmbient * 0.08 * (1.0 - combinedTerm);

    finalColor += mix(vec3(1.0),uAtmColor*0.5+0.5,0.3)*pow(max(dot(N,H),0.0),120.0)*0.06*combinedTerm;
    finalColor += (uAtmColor*0.6+vec3(0.05,0.08,0.12))*pow(rim,3.0)*0.20*combinedTerm;
    finalColor *= 1.0-pow(rim,4.0)*0.40;
    finalColor = finalColor*(finalColor*2.51+0.03)/(finalColor*(finalColor*2.43+0.59)+0.14);
    gl_FragColor = vec4(clamp(finalColor,0.0,1.0),1.0);
    return;
  }

  // ══════════════════════════════════════════════════════════
  // SOLID WORLD PATH — v5 zone-role-driven
  // ══════════════════════════════════════════════════════════

  // ── 1. PROVINCE ZONES + ROLES ──────────────────────────────
  // Two wpos for two different concerns:
  //   wpos_zone:  coarse amplitude (0.28), used for Voronoi cell ASSIGNMENT only.
  //               Coherent displacement — nearby points stay in the same zone,
  //               preventing exclaves (isolated wrong-color patches).
  //   wpos_blend: full amplitude (0.44+0.10), used for bdBlend border shape only.
  //               Organic silhouette — zone boundary follows terrain, not geometry.
  vec3 ow = vec3(fbm3(pos*2.2+uSeed*0.009+17.3),
                 fbm3(pos*2.2+uSeed*0.009+43.7),
                 fbm3(pos*2.2+uSeed*0.009+81.2))*2.0-1.0;
  vec3 ow2 = vec3(fbm3(pos*6.0+uSeed*0.017+200.3),
                  fbm3(pos*6.0+uSeed*0.017+224.7),
                  fbm3(pos*6.0+uSeed*0.017+249.1))*2.0-1.0;
  vec3 wpos_zone  = normalize(pos + ow*0.28);
  vec3 wpos_blend = normalize(pos + ow*0.44 + ow2*0.10);

  float provEdge      = 999.0;
  vec3  zoneChar      = vec3(0.5, 0.5, 0.5);
  vec3  zoneCharSolid = vec3(0.5, 0.5, 0.5); // narrow-blend version for base color
  vec3  zoneChar2     = vec3(0.5, 0.5, 0.5); // raw character of 2nd-nearest zone (for bleed)
  float zoneRole  = ROLE_DEFAULT;
  int   bZone     = -1;
  float zr1       = 0.0;  // role of nearest zone
  float zr2       = 0.0;  // role of second-nearest zone
  float roleBlend = 0.0;  // boundary weight for continuous role blending

  int   neighborZone = 0;   // second-nearest zone index (for terrain seed)
  float localBdBlend = 0.0; // char blend weight at zone boundary

  if(uBiomeCount > 0.5) {
    int   count = int(uBiomeCount);
    float zd1=999.0, zd2=999.0;
    int   zi1=0,     zi2=0;
    for(int i = 0; i < 64; i++) {
      if(i >= count) break;
      float d = 1.0 - dot(wpos_zone, uBiomeCenters[i]);
      if(d < zd1) { zd2=zd1; zi2=zi1; zr2=zr1; zd1=d; zi1=i; zr1=uZoneRoles[i]; }
      else if(d < zd2) { zd2=d; zi2=i; zr2=uZoneRoles[i]; }
    }
    bZone        = zi1;
    neighborZone = zi2;
    provEdge = max(zd2 - zd1, 0.0);  // clamp: numerical precision guard against tiny negatives
    zoneRole = zr1;
    float bz1=float(zi1), bz2=float(zi2);
    vec3 zc1=vec3(fract(sin(bz1*127.1+uSeed)*43758.5),
                  fract(sin(bz1*311.7+uSeed*0.37)*43758.5),
                  fract(sin(bz1*491.3+uSeed*0.71)*43758.5));
    vec3 zc2=vec3(fract(sin(bz2*127.1+uSeed)*43758.5),
                  fract(sin(bz2*311.7+uSeed*0.37)*43758.5),
                  fract(sin(bz2*491.3+uSeed*0.71)*43758.5));
    // Boundary blend: multi-scale noise for organic, terrain-following edges.
    // Low-freq (3.0): large-scale lobes that follow topographic ridges.
    // Mid-freq (8.5): medium irregularity.
    // High-freq (22.0): fine frayed edge so borders look like real biome ecotones.
    // Boundary blend: three-frequency noise creates organic ecotone edges.
    // NOTE: provEdge (zd2-zd1) uses metric 1-dot(unit,unit) → range ~0.04-0.25 for
    // 20-60 zones. bdNoise offsets that slightly for organic edge shaping.
    // FIX 2: bdNoise amplitudes halved (coefficients and bias)
    float bdNoise   = fbm3(wpos_blend*3.0+uSeed+99.0)*0.019
                    + fbm3(wpos_blend*8.5+uSeed+211.0)*0.007
                    + fbm3(wpos_blend*22.0+uSeed+333.0)*0.003 - 0.014;

    // FIX 2: tightened blend windows
    // solidBlend: 0.030 → 0.015, bdBlend: 0.10 → 0.06, roleBlend: 0.14 → 0.09
    float edgeArg       = zd2-zd1 + bdNoise;
    float solidBlend    = 1.0 - smoothstep(0.0, 0.015, edgeArg); // narrow: color only
    float bdBlend       = 1.0 - smoothstep(0.0, 0.06,  edgeArg); // moderate: char/features
    roleBlend           = 1.0 - smoothstep(0.0, 0.09,  edgeArg); // wide: role features
    localBdBlend        = bdBlend;
    // zoneCharSolid: zone's own character, only blends at narrow ecotone boundary.
    // Used for BASE COLOR so each zone has a solid dominant hue.
    zoneCharSolid  = zc1;    // always own char — blending done via feather mask below
    zoneChar2      = zc2;    // save raw neighbour char for bleed computation
    // zoneChar: moderately blended character for feature gating (vegetation, craters, etc.)
    zoneChar = mix(zc1, zc2, bdBlend);
  }

  // Intra-zone char drift removed (FIX 1) — was pushing pixels over feature-gating thresholds
  zoneChar  = clamp(zoneChar, 0.0, 1.0);

  // Item 4: Planet-scale continent noise — completely independent of zones,
  // breaks the block-fill at global scale (slow-varying macro albedo).
  float gVar = fbm3(pos*0.65+uSeed*0.03+33.0) * 0.28 - 0.14;

  // Per-zone triplanar rotation — each zone gets a unique Y-axis rotation so
  // the axis-aligned UV boundaries appear at different angles. Eliminates the
  // repeating "decal" pattern visible at triplanar projection seams.
  float zRot   = fract(float(bZone) * 0.618034 + uSeed * 0.001) * 6.28318;
  float zRotC  = cos(zRot);
  float zRotS  = sin(zRot);
  vec3 rpos = vec3(pos.x * zRotC - pos.z * zRotS, pos.y,
                   pos.x * zRotS + pos.z * zRotC);

  // Blended role floats — continuous at zone boundaries (roleBlend: 0=nearest, 1=2nd-nearest).
  // Each float is 0..1, enabling smooth feature cross-fades rather than hard cutoffs.
  #define ROLE_BLEND(lo, hi) mix(step(lo, zr1)*step(zr1, hi), step(lo, zr2)*step(zr2, hi), roleBlend)
  float isPolar       = ROLE_BLEND(0.5, 1.5);   // role==1
  float isSubstellar  = ROLE_BLEND(1.5, 2.5);   // role==2
  float isAntistellar = ROLE_BLEND(2.5, 3.5);   // role==3
  float isTerminator  = ROLE_BLEND(3.5, 4.5);   // role==4
  float isCraton      = ROLE_BLEND(4.5, 5.5);   // role==5
  float isRift        = ROLE_BLEND(5.5, 6.5);   // role==6
  float bIsShelf      = ROLE_BLEND(6.5, 7.5);   // role==7
  float bIsRidge      = ROLE_BLEND(7.5, 8.5);   // role==8
  float bIsTrench     = ROLE_BLEND(8.5, 9.5);   // role==9
  float bIsHotspot    = mix(step(9.5, zr1), step(9.5, zr2), roleBlend); // role==10
  #undef ROLE_BLEND

  // Strong role-driven character — each zone type gets a clear geological identity.
  // This is what makes a desert zone look like desert and a rift look like a rift.
  // Safe to be aggressive here because texture is luma-only (no within-zone color patches).
  vec3 zoneCharAdj = zoneChar;
  zoneCharAdj = mix(zoneCharAdj, vec3(0.8, 0.2, 0.5), isPolar      * 0.55);
  zoneCharAdj = mix(zoneCharAdj, vec3(0.2, 0.9, 0.7), isSubstellar * 0.60);
  zoneCharAdj = mix(zoneCharAdj, vec3(0.7, 0.3, 0.3), isAntistellar* 0.50);
  // Craton: ancient stable plateau — smooth, elevated, moderate mineral.
  // Rift: active basin — rough, low, iron-bearing fresh crust.
  zoneCharAdj = mix(zoneCharAdj, vec3(0.85, 0.10, 0.42), isCraton * 0.60);
  zoneCharAdj = mix(zoneCharAdj, vec3(0.18, 0.88, 0.62), isRift   * 0.55);

  // Zone-driven terrain elevation bias — additive, blended across zone boundaries.
  // Values calibrated against FBM amplitude (~±0.20) to reliably push zones into
  // their morphological depth regime. All three calls (h, hX, hZ) use the same
  // bias so the gradient (slope/normals) is unaffected — only absolute depth changes.
  // POLAR_ICE intentionally omitted: _gIsPolar handles the flatten in terrainHeight().
  _gZoneElev =  isCraton  *  0.14   // CRATON: elevated plateau
              - isRift     *  0.12   // RIFT: depressed valley
              + bIsShelf   *  0.20   // SHELF: shallow ocean floor
              + bIsRidge   *  0.10   // RIDGE: submarine ridge
              - bIsTrench  *  0.26   // TRENCH: deep ocean floor
              + bIsHotspot *  0.06;  // HOTSPOT: slight volcanic uplift

  // Polar flag + zone boundary distance + zone terrain seeds: written here so
  // all three terrainHeight() calls (h, hX, hZ) see the same values and the
  // bump gradient is consistent.
  _gIsPolar    = isPolar;
  _gProvEdge   = provEdge;
  _gZoneSeed1  = float(bZone)       * 37.1;
  _gZoneSeed2  = float(neighborZone) * 37.1;
  _gZoneBlend  = localBdBlend;

  // ── 2. TERRAIN + BUMP ─────────────────────────────────────
  float eps = 0.005;
  float h   = terrainHeight(pos);
  float hX  = terrainHeight(normalize(pos+vec3(eps,0,0)));
  float hZ  = terrainHeight(normalize(pos+vec3(0,0,eps)));
  vec3  dH  = vec3(h-hX, 0.0, h-hZ);
  dH.y = -(dH.x+dH.z)*0.5;
  float slope = length(dH)*110.0;

  // Bump amplitude:
  //   Zone roughness (zoneCharAdj.y) drives the base amplitude.
  //   Atmospheric erosion SOFTENS terrain over geological time — thick atm = smoother.
  //   Craters on airless worlds are PRESERVED & sharp — enhance bump there.
  //   Role-specific bump: cratons are smooth, rifts are jagged.
  float airlessScale = smoothstep(0.10, 0.0, uAtmThickness);
  // General bump amplitude is LOW — we want zones to read as flat until
  // the terrain actually has structure. High values cause "noisy carpet" look.
  float bumpBase = mix(0.8, 2.5, zoneCharAdj.y);
  // Atmospheric erosion softens terrain (NOT a hard suppress — gradual erosion)
  float bumpAtmErode  = mix(1.0, 0.72, clamp(uAtmThickness * 2.5, 0.0, 1.0));
  // Crater-local boost: near crater walls _gCraterInfluence is 0-1.
  // We ramp up bumpAmp sharply there so crater rims/walls cast hard shadows.
  float bumpCraterEnh = 1.0 + _gCraterInfluence * 7.0 * airlessScale
                      + uCraterDensity * airlessScale * 0.8;  // global airless texture
  // Cratons are smooth, rifts are rough — push in both directions
  float bumpRoleMod   = mix(1.0, 0.40, isCraton) * mix(1.0, 1.50, isRift + bIsHotspot * 0.6);
  float bumpAmp  = bumpBase * bumpAtmErode * bumpCraterEnh * bumpRoleMod;
  vec3  bumpN    = normalize(N + dH * bumpAmp);
  float NdotL    = max(dot(bumpN, L), 0.0);

  // ── 3. OCEAN / LAND ────────────────────────────────────────
  float shoreN    = noise3D(pos*18.0+uSeed*3.3)*0.012
                  + noise3D(pos*36.0+uSeed*5.1)*0.006;
  float effOcean  = uOceanLevel + shoreN;
  float underwaterDepth = effOcean - h;
  float shoreBlend = smoothstep(-0.04, 0.03, underwaterDepth);

  // Antistellar ice zones override ocean (they become ice regardless)
  bool  isOcean  = shoreBlend > 0.01 && isAntistellar < 0.5;
  // depth01 declared at function scope so Features 02/07b can access it outside the ocean block
  float depth01 = clamp(underwaterDepth / max(uOceanLevel, 0.01), 0.0, 1.0);

  // ── 4. SURFACE COLOR ───────────────────────────────────────
  vec3 color;

  if(isOcean) {
    // ══════════════════════════════════════════════════════════
    // OCEAN — Zone-role-driven bathymetric system
    // ══════════════════════════════════════════════════════════
    // _gZoneElev in terrainHeight() shifts depth01 by zone role:
    //   SHELF  (+0.20): depth01 ~ 0.02-0.18  — shallow carbonate shelf
    //   RIDGE  (+0.10): depth01 ~ 0.10-0.30  — submarine mountain chain
    //   TRENCH (-0.26): depth01 ~ 0.65-0.95  — hadal zone
    //   DEFAULT:        depth01 ~ 0.20-0.65  — open mid-ocean
    // bIsShelf/bIsRidge/bIsTrench are continuous 0..1 from blended zone roles above.

    // ── WATER COLUMN: FULL DEPTH GRADIENT ──────────────────
    // Real ocean colour progression: coastal cyan → mid blue → deep navy → abyssal black
    // bIsShelf/bIsRidge/bIsTrench are blended 0..1 from the zone role system above.
    // Coastal phytoplankton tint scales with greenness; alien/dark oceans preserve hue
    float earthBias = 1.0 - clamp(uOceanColor.b * 2.2, 0.0, 1.0);
    vec3 coastalW = uOceanColor * 1.58 + vec3(0.02, 0.06, 0.01) * earthBias;
    vec3 midW     = uOceanColor * 0.88;
    // Deep/abyss blue shift is proportional to ocean blue channel — keeps alien oceans alien
    vec3 deepW    = uOceanColor * 0.38 + uOceanColor * vec3(0.0, 0.0, 0.12);
    vec3 abyssW   = uOceanColor * 0.07 + uOceanColor * vec3(0.0, 0.0, 0.22);

    // Compute each zone's water colour independently, then blend by role weight.
    vec3 waterDefault = coastalW;
    waterDefault = mix(waterDefault, midW,   smoothstep(0.05, 0.32, depth01));
    waterDefault = mix(waterDefault, deepW,  smoothstep(0.32, 0.62, depth01));
    waterDefault = mix(waterDefault, abyssW, smoothstep(0.62, 0.92, depth01));

    vec3 waterShelf = mix(coastalW, midW, smoothstep(0.0, 0.50, depth01));

    vec3 waterRidge = mix(midW * 0.88, deepW, smoothstep(0.0, 0.48, depth01));

    vec3 waterTrench = mix(deepW, abyssW, smoothstep(0.45, 0.88, depth01));
    waterTrench = mix(waterTrench, vec3(0.01, 0.01, 0.02), smoothstep(0.78, 0.97, depth01));

    // Additive role blending: shelf/ridge/trench smoothly displace default.
    vec3 waterCol = waterDefault;
    waterCol = mix(waterCol, waterShelf,  bIsShelf);
    waterCol = mix(waterCol, waterRidge,  bIsRidge);
    waterCol = mix(waterCol, waterTrench, bIsTrench);

    // ── FEATURE 8: Ocean thermal colour variation ─────────────────────────────
    // Equatorial warm (cyan-green phytoplankton bloom), polar cold (deep navy-indigo)
    {
      float oceanThermal = 1.0 - absLat;  // 1 = equator, 0 = pole
      vec3 warmTint = vec3(-0.02, 0.04, 0.06) * oceanThermal * (1.0 - absLat * 1.2);
      vec3 coldTint = vec3(-0.01, -0.02, 0.06) * (1.0 - oceanThermal);
      waterCol += (warmTint + coldTint) * 0.55;

      // Gyre-pattern variation: large circular current rings visible from orbit
      float gyrePattern = sin(pos.x * 3.2 + pos.z * 2.1 + uSeed * 0.003)
                        * cos(pos.z * 2.8 - pos.y * 1.4 + uSeed * 0.007) * 0.5 + 0.5;
      float gyreStr = smoothstep(0.25, 0.60, absLat) * smoothstep(0.85, 0.60, absLat) * 0.08;
      waterCol += vec3(-0.01, 0.015, 0.025) * gyrePattern * gyreStr;
    }

    // ── FEATURE 9: Shore foam & surf ──────────────────────────────────────────
    // Animated breaking-wave bands + persistent strandline foam at the waterline.
    if(depth01 < 0.22 && uAtmThickness > 0.04) {
      float shoreShallow = 1.0 - smoothstep(0.0, 0.20, depth01);
      // Two wave-front rings phased so they interleave
      float wP1     = fract(depth01 * 14.0 - uTime * 0.82);
      float wP2     = fract(depth01 * 20.0 - uTime * 1.18 + 0.50);
      float wBreak1 = smoothstep(0.58,0.80,wP1)*(1.0-smoothstep(0.80,0.97,wP1));
      float wBreak2 = smoothstep(0.55,0.76,wP2)*(1.0-smoothstep(0.76,0.95,wP2));
      float foamN   = noise3D(pos*28.0+uSeed+vec3(uTime*0.42,0.0,uTime*0.31))*0.5+0.5;
      float waveFoam   = max(wBreak1, wBreak2) * foamN;
      // Persistent strandline foam at the exact waterline
      float strandN    = noise3D(pos*18.0+uSeed+vec3(uTime*0.20,0.0,0.0))*0.5+0.5;
      float strandFoam = smoothstep(0.055,0.0,depth01)*(0.4+strandN*0.6);
      float totalFoam  = clamp(waveFoam*shoreShallow*0.72 + strandFoam*0.90, 0.0, 1.0);
      vec3  foamCol = mix(vec3(0.78,0.84,0.92), vec3(0.96,0.97,0.99), NdotL);
      waterCol = mix(waterCol, foamCol, totalFoam);
    }

    // Substellar ocean (tidally-locked day side) — permanent storm + upwelling
    if(isSubstellar > 0.5) {
      // Deep thermal upwelling: warm water rising at the permanent noon point.
      // Color: darker warm teal-green upwelling plume surrounded by cooler ocean.
      float facingS  = clamp(dot(pos, L), 0.0, 1.0);
      float upwellR  = smoothstep(0.90, 0.62, facingS);  // radial from substellar
      waterCol = mix(waterCol,
                     waterCol * 0.88 + uOceanColor * 0.22 + vec3(0.04, 0.06, 0.02),
                     upwellR * 0.40);
      // Permanent storm spiral: giant cyclone locked over the substellar point
      float boilN = fbm3(pos * 4.8 + vec3(uTime * 0.06, 0.0, uTime * 0.04) + uSeed);
      float spiral = fbm3(pos * 8.0 + vec3(-uTime * 0.10, 0.0, uTime * 0.07) + uSeed + 88.0);
      // Surface foam bands in the spiral arms
      waterCol = mix(waterCol, waterCol * 0.78 + vec3(0.12, 0.18, 0.14),
                     smoothstep(0.56, 0.72, boilN) * upwellR * 0.30);
      // Bright foam/spray at the core
      float coreR = smoothstep(0.95, 0.80, facingS);
      waterCol = mix(waterCol, vec3(0.75, 0.85, 0.90),
                     step(0.70, spiral) * coreR * 0.35);
      // Steam plume fragments (very high temp day side)
      if(uSubstellarTemp > 320.0) {
        float steam = step(0.78, noise3D(pos * 5.0 + uTime * 0.55 + uSeed + 100.0));
        waterCol = mix(waterCol, vec3(0.88, 0.86, 0.82) * max(NdotL, 0.12),
                       steam * smoothstep(320.0, 420.0, uSubstellarTemp) * 0.22);
      }
    }

    // ── OCEAN FLOOR: DEPTH + ZONE-DRIVEN, NO ZONE-TEXTURE SEAMS ──
    float sedN = fbm3(pos * uNoiseScale * 2.8 + uSeed + 500.0);
    vec3 sandFloor   = vec3(0.62, 0.54, 0.36) * 0.62 + uOceanColor * 0.18;
    vec3 sedFloor    = vec3(0.20, 0.26, 0.36) * 0.52;
    vec3 basaltFloor = vec3(0.14, 0.15, 0.18) * 0.80;
    vec3 abyssFloor  = vec3(0.05, 0.07, 0.11) * 0.62;

    // Compute each floor type, blend by role weight (no hard cutoffs).
    // Open ocean: sand → ooze → abyss → manganese nodule field
    vec3 floorDefault = sandFloor;
    floorDefault = mix(floorDefault, sedFloor,   smoothstep(0.12, 0.45, depth01));
    floorDefault = mix(floorDefault, abyssFloor, smoothstep(0.50, 0.82, depth01));
    float nodN = noise3D(pos * uNoiseScale * 5.5 + uSeed + 1052.0) * 0.5 + 0.5;
    floorDefault = mix(floorDefault, floorDefault * 0.52 + vec3(0.12, 0.05, 0.07) * 0.45,
                       smoothstep(0.46, 0.66, depth01) * smoothstep(0.44, 0.62, nodN) * 0.42);

    // Shelf: carbonate platform — bright biogenic shell hash + sand
    float carbN    = fbm3(pos * uNoiseScale * 5.5 + uSeed + 712.0);
    vec3 floorShelf = mix(sandFloor, sandFloor * 1.14 + vec3(0.05, 0.07, 0.01), carbN * 0.55);

    // Ridge: fresh pillow basalt — actively extruded, no sediment cover
    float pillow    = noise3D(pos * uNoiseScale * 5.0 + uSeed + 625.0);
    vec3 floorRidge = mix(basaltFloor * 0.72, basaltFloor * 1.28, pillow);
    floorRidge += vec3(0.07, 0.04, 0.01) * smoothstep(0.70, 0.84, pillow) * uVolcanism;

    // Trench: compressed dark ooze, near featureless
    vec3 floorTrench = vec3(0.03, 0.04, 0.06) + sedN * vec3(0.02, 0.02, 0.03);

    vec3 floorCol = floorDefault;
    floorCol = mix(floorCol, floorShelf,  bIsShelf);
    floorCol = mix(floorCol, floorRidge,  bIsRidge);
    floorCol = mix(floorCol, floorTrench, bIsTrench);
    floorCol = mix(floorCol, vec3(0.66, 0.78, 0.90) * 0.52, uIsIceWorld * 0.60);

    // Floor visible only through shallow transparent water
    float floorVis = smoothstep(0.22, 0.04, depth01);
    floorVis = max(floorVis, smoothstep(0.30, 0.05, depth01) * bIsShelf);
    color = mix(waterCol, mix(floorCol * 0.65, waterCol, 0.30), floorVis);

    // ── SHORE: foam + sandy shallows ─────────────────────────
    float foam = (1.0 - smoothstep(0.0, 0.014, underwaterDepth))
               * (noise3D(pos * 60.0 + uTime * 0.5 + uSeed) * 0.65 + 0.35);
    color = mix(color, vec3(0.86, 0.91, 0.95), foam * 0.44);
    float sand = smoothstep(0.0, 0.025, underwaterDepth)
               * (1.0 - smoothstep(0.025, 0.08, underwaterDepth));
    color = mix(color, uOceanColor * 1.18 + vec3(0.08, 0.06, 0.03), sand * 0.24);

    // ── FEATURE 5: Abyssal plain — very deep water near-black ────────────
    {
      float abyssal = smoothstep(0.45, 0.75, depth01);
      color = mix(color, vec3(0.01, 0.03, 0.08) + vec3(0.0, 0.01, 0.04) * NdotL,
                  abyssal * 0.65);
    }

    // ── FEATURE 5: Trench formations — elongated ultra-dark slots ─────────
    {
      float trenchN = abs(sin(dot(pos * 8.0 + uSeed + 600.0,
                                   vec3(1.0, 0.618, 1.414))));
      float trench = smoothstep(0.06, 0.0, trenchN) * smoothstep(0.50, 0.75, depth01);
      color = mix(color, vec3(0.0, 0.01, 0.04), trench * 0.85);
    }

    // ── FEATURE 5: Mid-ocean ridge color + seamount shoals ───────────────
    {
      // Ridge color warm tint (vent heat shimmering through water)
      float ridgeN = fbm3(pos * uNoiseScale * 3.5 + uSeed + 650.0) * 0.5 + 0.5;
      float ridgeMask = smoothstep(0.28, 0.18, depth01) * smoothstep(0.18, 0.28, depth01)
                      * smoothstep(0.62, 0.72, ridgeN);
      color = mix(color, color + vec3(0.02, 0.01, 0.0), ridgeMask * 0.35);

      // Seamount shoals — underwater mountains appearing as lighter patches
      float seamount = smoothstep(0.55, 0.35, depth01)
                     * step(0.68, noise3D(pos * 5.5 + uSeed + 620.0) * 0.5 + 0.5);
      color = mix(color, color + vec3(0.02, 0.06, 0.08), seamount * 0.40);
    }

    // ── FEATURE A: Reef / Bioluminescent Shallows ─────────────
    applyReef(color, pos, N, L, V, H, NdotL, depth01, absLat, isOcean);

    // ── CONTINENTAL SHELF FEATURES ────────────────────────────
    if(bIsShelf > 0.01 && uAtmThickness > 0.07) {
      // Kelp / seagrass fringe (temperate and tropical shallows)
      if(depth01 < 0.22) {
        float kelpN = fbm3(pos * uNoiseScale * 4.0 + uSeed + 222.0);
        float kelp  = smoothstep(0.46, 0.62, kelpN)
                    * (1.0 - depth01 * 4.5)
                    * clamp(1.0 - absLat * 1.7, 0.0, 1.0)
                    * bIsShelf;
        color = mix(color, color * 0.72 + vec3(0.04, 0.20, 0.06) * 0.28, kelp * 0.55);
      }
      // Coral patch reefs (tropical shallows only)
      if(depth01 < 0.18 && absLat < 0.40) {
        float coralN = noise3D(pos * uNoiseScale * 7.5 + uSeed + 912.0);
        float coral  = smoothstep(0.62, 0.82, coralN) * (1.0 - depth01 * 5.5) * bIsShelf;
        vec3  coralC = mix(vec3(0.84, 0.36, 0.20), vec3(0.92, 0.58, 0.18), coralN);
        color = mix(color, color * 0.82 + coralC * 0.20, coral * 0.38);
      }
      // Underwater caustic light columns
      if(depth01 < 0.32 && uAtmThickness > 0.08) {
        vec3  cP  = pos * uNoiseScale * 6.5 + vec3(uTime*0.18, 0.0, uTime*0.14) + uSeed + 942.0;
        float caus = noise3D(cP) * 0.6 + noise3D(cP * 1.35 + 15.0) * 0.4;
        float causStr = smoothstep(0.60, 0.80, caus) * (1.0-depth01*2.8) * max(dot(N,L),0.0) * bIsShelf;
        color += (uOceanColor * 0.48 + vec3(0.04, 0.10, 0.26)) * causStr * 0.22;
      }
    }

    // ── MID-OCEAN RIDGE FEATURES ──────────────────────────────
    if(bIsRidge > 0.01) {
      // Hydrothermal vents: intense pinpoint warm glow on ridge axis
      float ventN = noise3D(pos * uNoiseScale * 9.5 + uSeed + 1122.0);
      float vent  = smoothstep(0.84, 0.92, ventN)
                  * (1.0 - smoothstep(0.05, 0.32, depth01))
                  * bIsRidge;
      color = mix(color, color * 0.72 + vec3(0.92, 0.48, 0.10) * 0.30,
                  vent * 0.75 * max(uVolcanism, 0.25));
      // Warm diffuse plume rising from vent field
      float plumeN = fbm3(pos * uNoiseScale * 2.5 + uSeed + vec3(uTime*0.016, 0, 0) + 1204.0);
      color += vec3(0.05, 0.03, 0.01) * smoothstep(0.55, 0.68, plumeN)
             * smoothstep(0.35, 0.08, depth01) * bIsRidge * 0.38;
      // Ridge flank algae (nutrients from vents support blooms)
      float rAlgN = fbm3(pos * uNoiseScale * 2.0 + uSeed + 1305.0);
      float rAlg  = smoothstep(0.52, 0.68, rAlgN) * (1.0-depth01*2.2)
                  * clamp(1.0 - absLat * 2.0, 0.0, 1.0) * uAtmThickness * bIsRidge;
      color = mix(color, color * 0.80 + vec3(0.08, 0.26, 0.12) * 0.20, rAlg * 0.38);
    }

    // ── TRENCH / HADAL FEATURES ───────────────────────────────
    if(bIsTrench > 0.01) {
      // Crushing darkness: near-black with depth
      color = mix(color, color * 0.12, smoothstep(0.55, 0.95, depth01) * bIsTrench);
      // Bioluminescence: sparse blue-green pulses from hadal organisms
      float bioN = noise3D(pos * uNoiseScale * 14.0 + uSeed
                 + vec3(uTime * 0.005, 0.0, 0.0) + 1405.0);
      float bio  = smoothstep(0.89, 0.96, bioN) * smoothstep(0.45, 0.72, depth01) * bIsTrench;
      color += vec3(0.02, 0.18, 0.34) * bio * 0.58;
    }

    // ── DEFAULT OPEN OCEAN FEATURES ───────────────────────────
    // Weight: full strength in open ocean, fades as specialised roles blend in.
    float openOceanW = clamp(1.0 - bIsShelf - bIsRidge - bIsTrench, 0.0, 1.0);
    if(openOceanW > 0.01) {
      // Ocean current bands: warm/cold circulation visible from orbit
      {
        vec3 cWarp1 = cloudWarp(pos,  0.016) * 12.0;
        vec3 cWarp2 = cloudWarp(pos, -0.011) *  9.0;
        float curr1 = noise3D(cWarp1 + vec3(0, 0, uTime*0.024+pos.y*8.0+uSeed))*2.0-1.0;
        float curr2 = noise3D(cWarp2 + vec3(uTime*0.018-pos.y*6.0+uSeed*0.7, 0, 0))*2.0-1.0;
        float curr  = curr1 * 0.65 + curr2 * 0.35;
        float cDepth = 1.0 - depth01 * 0.55;
        color += vec3( 0.036, 0.015,-0.005) * smoothstep( 0.28, 0.60, curr) * cDepth * 0.20 * openOceanW;
        color -= vec3( 0.015, 0.006,-0.022) * smoothstep(-0.28,-0.60, curr) * cDepth * 0.16 * openOceanW;
      }
      // Submarine canyon shadows (mid-depth)
      if(depth01 > 0.18 && depth01 < 0.72) {
        vec3  canyW = pos * uNoiseScale * 2.8 + uSeed + 782.0;
        canyW += vec3(fbm3(pos * uNoiseScale + uSeed + 792.0)) * 0.35;
        float canyR = abs(noise3D(canyW) * 2.0 - 1.0);
        color = mix(color, color * 0.65,
                    smoothstep(0.0, 0.14, canyR) * (depth01-0.18)*1.5 * 0.28 * openOceanW);
      }
      // Algae bloom patches (warm, shallow, equatorial)
      if(depth01 < 0.40 && uAtmThickness > 0.05 && uOceanLevel > 0.18) {
        float algN = fbm3(pos * uNoiseScale * 1.8 + uSeed + vec3(uTime*0.012, 0.0, 0.0));
        float algM = smoothstep(0.54, 0.70, algN)
                   * (1.0 - smoothstep(0.0, 0.60, absLat))
                   * (1.0 - depth01 * 1.8)
                   * openOceanW;
        if(algM > 0.005) {
          vec3 algC = mix(vec3(0.18,0.62,0.38), vec3(0.42,0.72,0.28),
                          fbm3(pos * 8.0 + uSeed + 322.0));
          color = mix(color, color * 0.72 + algC * 0.30, algM * 0.45);
        }
      }
      // Open-ocean whitecaps (subtle)
      {
        vec3  wcP = pos * uNoiseScale * 9.0 + vec3(uTime*0.26, 0.0, uTime*0.19) + uSeed + 882.0;
        float wc  = step(0.87, noise3D(wcP)*0.6 + noise3D(wcP*0.7+30.0)*0.4)
                  * (1.0 - depth01 * 1.4) * (1.0 - isPolar) * openOceanW;
        color = mix(color, vec3(0.88, 0.91, 0.95), wc * 0.28);
      }
    }

    // ── SEA ICE FRINGE (zone-driven only) ────────────────────
    // Only inside or adjacent to POLAR_ICE zones — no latitude fallback.
    // Ice-worlds get a global version driven by uIsIceWorld.
    {
      float seaIceZone = isPolar * uIceCaps;
      float seaIceIW   = uIsIceWorld > 0.5 ? smoothstep(0.0, 0.45, isPolar + 0.3) : 0.0;
      float seaIce     = clamp(max(seaIceZone, seaIceIW), 0.0, 1.0);
      if(seaIce > 0.01) {
        float siN = noise3D(pos * 12.0 + uSeed + 902.0) * 0.5 + 0.5;
        vec3  siC = mix(vec3(0.82, 0.90, 0.96), vec3(0.95, 0.97, 1.0), siN);
        color = mix(color, siC, seaIce * smoothstep(0.38, 0.62, siN) * 0.75);
      }
    }

    // ── ICEBERGS ──────────────────────────────────────────────
    applyIcebergs(color, pos, N, L, H, bumpN, depth01, isPolar, NdotL);

    // ── WAVE NORMALS (3-octave animated) ─────────────────────
    {
      vec3  wp1 = cloudWarp(pos,  0.08) * 45.0;
      vec3  wp2 = cloudWarp(pos, -0.06) * 32.0;
      vec3  wp3 = cloudWarp(pos,  0.14) * 62.0;
      float w1n = noise3D(wp1 + uSeed        ) * 2.0 - 1.0;
      float w2n = noise3D(wp2 + uSeed + 50.0 ) * 2.0 - 1.0;
      float w3n = noise3D(wp3 + uSeed + 100.0) * 2.0 - 1.0;
      float wDF = 1.0 - depth01 * 0.80;
      bumpN = normalize(N + vec3(w1n + w3n*0.30, 0.0,
                                 w2n + w3n*0.30) * 0.22 * wDF);
      NdotL = max(dot(bumpN, L), 0.0);
    }
    // Capillary micro-wave ripple (shallow clear water only)
    if(depth01 < 0.30) {
      float capStr = 1.0 - depth01 * (1.0 / 0.30);
      vec3  cW1 = pos * 90.0  + uSeed       + vec3(uTime*0.85, 0.0, uTime*0.65);
      vec3  cW2 = pos * 120.0 + uSeed * 0.7 + vec3(uTime*1.10, 0.0, uTime*0.90);
      float cN1 = noise3D(cW1)*2.0-1.0, cN2 = noise3D(cW2)*2.0-1.0;
      float cN3 = noise3D(pos*66.0+uSeed+uTime*1.4)*2.0-1.0;
      bumpN = normalize(bumpN + vec3(cN1*0.5+cN3*0.28, 0.0,
                                     cN2*0.5+cN3*0.28) * 0.14 * capStr);
      NdotL = max(dot(bumpN, L), 0.0);
    }

    // Atmosphere Fresnel reflection on water (grazing-angle sky mirror)
    if(uAtmThickness > 0.06) {
      float wFresnel = pow(1.0 - max(dot(bumpN, V), 0.0), 4.2);
      vec3  skyTint  = uAtmColor * 0.55 + vec3(0.04, 0.07, 0.16);
      float skyBright = smoothstep(-0.1, 0.5, dot(N, L)) * 0.5 + 0.5;
      color = mix(color, skyTint * skyBright * 0.90,
                  wFresnel * (1.0 - depth01 * 0.65) * 0.40);
    }
    // Iridescent organic surface sheen (shallow, warm latitudes)
    if(uAtmThickness > 0.14 && depth01 < 0.22 && isPolar < 0.5) {
      float iTheta   = max(dot(bumpN, V), 0.0);
      float iFresnel = pow(1.0 - iTheta, 3.5);
      vec3  iridC    = vec3(sin(iFresnel*5.5+uSeed)*0.5+0.5,
                            sin(iFresnel*5.5+uSeed+2.09)*0.5+0.5,
                            sin(iFresnel*5.5+uSeed+4.19)*0.5+0.5);
      float iridStr  = iFresnel * (1.0 - depth01*4.5)
                     * clamp(1.0 - absLat * 2.8, 0.0, 1.0);
      color = mix(color, color + iridC * 0.07, iridStr * 0.28);
    }
    // Sun glint — wide specular reflection band
    float gF     = 0.04 + 0.96 * pow(1.0 - max(dot(bumpN, V), 0.0), 5.0);
    float gNdotH = max(dot(bumpN, normalize(L + V)), 0.0);
    color += vec3(1.0, 0.98, 0.92) * (pow(gNdotH, 80.0) * 1.00
           + pow(gNdotH, 18.0) * 0.15
           + pow(gNdotH,  6.0) * 0.04) * gF * (1.0 - depth01 * 0.55);

  } else {
    // ────────────────────────────────────────────────────────
    // LAND: zone-texture splat driven by per-zone character
    // ────────────────────────────────────────────────────────
    // ── REGION-DRIVEN TERRAIN ────────────────────────────────
    // Each zone has a unique BASE COLOR derived from its character axes.
    // Texture provides surface grain/detail ON TOP of that base color.
    // This ensures every zone looks visually distinct regardless of world type.
    // ─────────────────────────────────────────────────────────

    // BASE TERRAIN CHARACTER — world-type × zone-role → curated (ze, zr, zm).
    // tV: variant index derived from zone index. Spreads 3 terrain sub-types
    // across DEFAULT zones so neighbours differ without random patchwork.
    float tV  = step(0.333, fract(float(bZone) * 0.618034))
              + step(0.667, fract(float(bZone) * 0.618034));  // 0, 1, or 2
    tV *= 0.5;  // → 0.0 / 0.5 / 1.0
    float ze, zr, zm;
    terrainBase(uWorldMode, zr1, tV, ze, zr, zm);

    // Latitudinal bias: tropical zones drier/sandier (lower zm), polar zones smoother.
    // Uses zone center latitude (uBiomeCenters[bZone].y) not fragment latitude
    // so the entire zone shifts together, not per-pixel.
    float zoneLat = abs(uBiomeCenters[bZone].y);   // 0=equator, 1=pole
    ze += (1.0 - zoneLat) * 0.06;                   // tropics: slightly lower elevation
    zr -= zoneLat * 0.08;                            // polar: smoother (erosion/ice smoothing)
    zm += (1.0 - zoneLat) * 0.05;                   // tropics: warmer mineral tint
    ze = clamp(ze, 0.05, 0.95);
    zr = clamp(zr, 0.05, 0.95);
    zm = clamp(zm, 0.05, 0.95);

    // Elevation coherence: neighbour zones with same base elevation stay near the
    // same brightness level, creating broad highlands/basins rather than checkerboard.
    // Small sine wave keyed to zone index adds gentle rolling variation.
    float elevWave = sin(float(bZone) * 2.399963) * 0.07;  // golden-angle spread
    ze = clamp(ze + elevWave, 0.05, 0.95);

    // ── ROLE-DRIVEN TEXTURE SELECTION ─────────────────────────────
    // ze/zr (hash-based) drive BASE COLOR variation — each zone gets a
    // unique palette from the planet's color set.
    // zeT/zrT (role-overridden) drive TEXTURE TYPE — each role maps to a
    // SPECIFIC region of the zoneSplat atlas, overriding the hash fully.
    //
    // zoneSplat atlas layout (by ze/zr weight):
    //   tex0 = low+smooth  (sediment, clay flats)
    //   tex1 = low+rough   (basalt, regolith, volcanic)
    //   tex2 = mid blend
    //   tex3 = high+smooth (granite, limestone, carbonate)
    //   tex4 = high+rough  (scree, alpine, submarine ridge)
    //
    // We use clamp(role, 0, 1) as the mix weight so at role boundaries
    // we blend from hash-driven → role-locked over the roleBlend region.
    float isCratonC  = clamp(isCraton,  0.0, 1.0);
    float isRiftC    = clamp(isRift,    0.0, 1.0);
    float isHotspotC = clamp(bIsHotspot,0.0, 1.0);
    float zeT = ze, zrT = zr;  // inherit from zoneCharSolid-based ze/zr
    // Lock to specific atlas quadrants — use full target value at role center
    zeT = mix(zeT, 0.92, isCratonC);   zrT = mix(zrT, 0.04, isCratonC);  // → tex3: smooth granite slab
    zeT = mix(zeT, 0.04, isRiftC);     zrT = mix(zrT, 0.94, isRiftC);    // → tex1: fresh rough basalt
    zeT = mix(zeT, 0.88, bIsRidge);    zrT = mix(zrT, 0.86, bIsRidge);   // → tex4: submarine scree
    zeT = mix(zeT, 0.86, bIsShelf);    zrT = mix(zrT, 0.08, bIsShelf);   // → tex3: carbonate sediment
    zeT = mix(zeT, 0.08, bIsTrench);   zrT = mix(zrT, 0.90, bIsTrench);  // → tex1: dark hadal mud
    zeT = mix(zeT, 0.14, isHotspotC);  zrT = mix(zrT, 0.96, isHotspotC); // → tex1: rough lava crust

    // Base color — wide range gives zones strong visual identity.
    // basin (dark sediment) → highland (bright exposed rock): clearly different.
    // roughness bends colour toward the volcanic/active uColor2 palette.
    // mineral tint: silicate (cool grey-blue) vs iron-oxide (warm rust-red).
    vec3 zBaseLow  = uColor1 * mix(0.55, 0.92, 1.0-zr);
    vec3 zBaseHigh = uColor3 * mix(1.25, 0.95, zr);
    vec3 zBase     = mix(zBaseLow, zBaseHigh, ze);
    zBase = mix(zBase, uColor2 * mix(0.80, 0.60, ze), zr * 0.50);
    zBase *= mix(vec3(0.88, 0.94, 1.10), vec3(1.20, 0.88, 0.65), zm);

    // ── ZONE 1 ROLE COLOUR — full strength, no fade ──────────────────────────
    // Role colours are applied at FULL STRENGTH here; the bleed/feather mask
    // (computed after zone 2) decides which zone's complete colour shows at each
    // pixel. No fade-to-neutral at edges needed.
    {
      float ownCraton  = step(4.5, zr1)*step(zr1, 5.5);
      float ownRift    = step(5.5, zr1)*step(zr1, 6.5);
      float ownShelf   = step(6.5, zr1)*step(zr1, 7.5);
      float ownRidge   = step(7.5, zr1)*step(zr1, 8.5);
      float ownTrench  = step(8.5, zr1)*step(zr1, 9.5);
      float ownHotspot = step(9.5, zr1);

      vec3 cratonTarget = mix(vec3(0.60,0.57,0.52), vec3(0.50,0.52,0.56), zm)
                        * mix(0.78, 1.08, ze);
      zBase = mix(zBase, cratonTarget,                         ownCraton  * 0.62);
      zBase = mix(zBase, zBase * 0.72 * vec3(0.86, 0.94, 1.10), ownRift    * 0.58);
      zBase = mix(zBase, zBase * vec3(0.68, 0.60, 0.52),        ownHotspot * 0.55);
      zBase = mix(zBase, zBase + vec3(0.12,0.04,0.01)*uVolcanism, ownHotspot * 0.42);
      zBase = mix(zBase, zBase * vec3(1.14, 1.10, 0.90) * 1.08, ownShelf   * 0.50);
      zBase = mix(zBase, zBase * vec3(0.82, 1.06, 0.90) * 0.88, ownRidge   * 0.48);
      zBase = mix(zBase, zBase * vec3(0.65, 0.72, 1.08) * 0.55, ownTrench  * 0.70);
    }

    // ── ZONE 2 BASE CHARACTER (for bleed/feather at boundaries) ─────────────
    float tV2 = step(0.333, fract(float(neighborZone) * 0.618034))
              + step(0.667, fract(float(neighborZone) * 0.618034));
    tV2 *= 0.5;
    float ze2v, zr2v, zm2v;
    terrainBase(uWorldMode, zr2, tV2, ze2v, zr2v, zm2v);
    // Apply same latitudinal bias for zone 2
    float zone2Lat = abs(uBiomeCenters[neighborZone].y);
    ze2v += (1.0 - zone2Lat) * 0.06;
    zr2v -= zone2Lat * 0.08;
    zm2v += (1.0 - zone2Lat) * 0.05;
    ze2v = clamp(ze2v, 0.05, 0.95);
    zr2v = clamp(zr2v, 0.05, 0.95);
    zm2v = clamp(zm2v, 0.05, 0.95);
    float elevWave2 = sin(float(neighborZone) * 2.399963) * 0.07;
    ze2v = clamp(ze2v + elevWave2, 0.05, 0.95);
    vec3 zBase2 = mix(uColor1 * mix(0.55, 0.92, 1.0-zr2v),
                      uColor3 * mix(1.25, 0.95,     zr2v), ze2v);
    zBase2 = mix(zBase2, uColor2 * mix(0.80, 0.60, ze2v), zr2v * 0.50);
    zBase2 *= mix(vec3(0.88, 0.94, 1.10), vec3(1.20, 0.88, 0.65), zm2v);
    {
      float z2c = step(4.5, zr2)*step(zr2, 5.5);
      float z2r = step(5.5, zr2)*step(zr2, 6.5);
      float z2sh= step(6.5, zr2)*step(zr2, 7.5);
      float z2ri= step(7.5, zr2)*step(zr2, 8.5);
      float z2t = step(8.5, zr2)*step(zr2, 9.5);
      float z2h = step(9.5, zr2);
      vec3 ct2 = mix(vec3(0.60,0.57,0.52), vec3(0.50,0.52,0.56), zm2v) * mix(0.78,1.08,ze2v);
      zBase2 = mix(zBase2, ct2,                                      z2c  * 0.62);
      zBase2 = mix(zBase2, zBase2 * 0.72 * vec3(0.86, 0.94, 1.10),  z2r  * 0.58);
      zBase2 = mix(zBase2, zBase2 * vec3(0.68, 0.60, 0.52),         z2h  * 0.55);
      zBase2 = mix(zBase2, zBase2 + vec3(0.12,0.04,0.01)*uVolcanism, z2h  * 0.42);
      zBase2 = mix(zBase2, zBase2 * vec3(1.14, 1.10, 0.90) * 1.08,  z2sh * 0.50);
      zBase2 = mix(zBase2, zBase2 * vec3(0.82, 1.06, 0.90) * 0.88,  z2ri * 0.48);
      zBase2 = mix(zBase2, zBase2 * vec3(0.65, 0.72, 1.08) * 0.55,  z2t  * 0.70);
    }

    // ── TEXTURE GRAIN (luma-only, shared across both zones) ──────────────────
    float dynScale = uZoneTexScale * mix(0.60, 1.60, zrT);
    vec3 texDetail = zoneSplat(rpos, N, dynScale, zeT, zrT);
    float texLum   = max(dot(texDetail, vec3(0.299,0.587,0.114)), 0.001);
    vec3 col1 = zBase  * (0.74 + texLum * 0.52);
    vec3 col2 = zBase2 * (0.74 + texLum * 0.52);

    // ── HEIGHT-BASED TERRITORY BLEND ─────────────────────────────────────────
    // Each zone gets a unique noise "paint height" keyed to its zone index.
    // At boundaries, the two heights compete: where zone1's height > zone2's,
    // zone1's colour shows; where zone2's height > zone1's, zone2 bleeds in.
    // provEdge*k tilts the contest toward zone1 in its interior.
    // Result: organic interlocking blobs — NOT a lerp gradient. Looks like two
    // painted regions where the paint bleeds past the boundary in blob-shaped patches.
    float bScale = uNoiseScale * 5.5;
    float bH1 = fbm3(pos * bScale + float(bZone)       * 13.7 + uSeed + 50.0);
    float bH2 = fbm3(pos * bScale + float(neighborZone) * 13.7 + uSeed + 50.0);
    // k: age-driven boundary sharpness.
    // Young terrain (uTerrainAge=0): crisp fault lines (k=20).
    // Old terrain (uTerrainAge=1): eroded, soft/diffuse margins (k=8).
    float k       = mix(20.0, 8.0, uTerrainAge);
    float contest = (bH1 + provEdge * k) - bH2;
    // Small smoothstep window → near-hard edge, antialiased not gradient
    float blendW  = smoothstep(-0.04, 0.04, contest);
    color = mix(col2, col1, blendW);

    // Boundary terrain strip: thin contact seam where two zones meet.
    // The seam is darker and desaturated — exposed bedrock / fault gouge.
    // Width ~0.006 in provEdge space; peaks at the 50/50 blend point.
    float seamPeak = 1.0 - abs(blendW * 2.0 - 1.0);           // 0 at interiors, 1 at contact
    float seamW    = pow(seamPeak, 3.0)                         // sharp peak
                   * smoothstep(0.0, 0.015, provEdge)           // no seam right at boundary edge
                   * 0.50;
    color = mix(color, (col1 + col2) * 0.38, seamW);

    // Per-zone elevation contrast — basins darker, highlands brighter
    color *= mix(0.78, 1.18, ze) * mix(1.0, 0.88, zr * 0.45);

    // FIX 10: Terrain height: minimal topographic shading — keeps zones solid-colored.
    // Reduced from 0.03 to 0.02 — subtler brightness modulation.
    color *= 0.98 + h * 0.02;

    // Planet-scale continent albedo — very slow wave, too low-freq to matter within a zone.
    // Reduced from 0.18 to 0.06 — keeps macro variation without muddying zone identity.
    color *= 1.0 + gVar * 0.06 * (1.0 - airlessScale * 0.70);

    // Per-zone hue: subtle tonal variation so adjacent zones don't look identical.
    // Kept very small (±5%) and suppressed on airless bodies — real planetary
    // surfaces show mineral/compositional variation, not rainbow patchwork.
    // No additive per-zone hue — zone identity is already fully expressed in zBase.
    // Adding a hue shift on top creates internal patchwork when textures vary.

    // Saturation: toned back so zones within a region look cohesive.
    // On airless worlds satBoost → 1.0 (neutral, no saturation push) so the
    // mineral dust reads as a single unified tone rather than clashing patches.
    float cL = max(dot(color, vec3(0.299,0.587,0.114)), 0.001);
    float satBoost = mix(1.04 + zr * 0.05 - ze * 0.02, 1.0, airlessScale);
    color = mix(vec3(cL), color, satBoost) * (0.94 + ze * 0.06);

    // FIX 3: Slope — angle-based brightness only, no zone-color patchwork
    // Darkens steep slopes slightly but never changes zone hue.
    color *= mix(1.0, 0.84, smoothstep(0.18, 0.55, slope) * zrT * 0.35);

    // ── RIVER NETWORKS ────────────────────────────────────────
    // Same domain-warp pattern as terrainHeight() river carving (seed+700)
    // so surface color aligns exactly with the carved channel geometry.
    // Channel: dark wet mud. Banks: moisture/vegetation strip.
    // Delta: sandy alluvial fan spreading toward coast.
    // FIX 4 + FIX 13: gate on surface water presence and habitable world mode
    if(uAtmThickness > 0.08 && isPolar < 0.1 && uOceanLevel > 0.15 && uWorldMode == 1.0) {
      vec3 rp = pos * uNoiseScale * 1.0 + uSeed + 700.0;
      vec3 rw = rp + vec3(fbm3(rp + 12.3) - 0.5,
                          0.0,
                          fbm3(rp + 87.6) - 0.5) * 0.55;
      float rivN    = abs(fbm3(rw) * 2.0 - 1.0);
      float rivChan = smoothstep(0.06, 0.0, rivN);
      float rivBank = smoothstep(0.18, 0.06, rivN) * (1.0 - rivChan);
      // Strength fades away from coast (rivers are widest near sea level)
      float rivStr  = clamp(1.0 - (h - uOceanLevel) * 5.5, 0.0, 1.0)
                    * clamp(uAtmThickness * 6.0, 0.0, 1.0);
      // Channel: dark wet rock/mud tinted by ocean color
      color = mix(color, color * 0.48 + uOceanColor * 0.22,
                  rivChan * rivStr * 0.72);
      // Bank: vegetation or moist soil strip
      float hasVeg  = step(0.1, uFoliageColor.g);
      vec3  bankCol = mix(color * 0.76 + vec3(0.01, 0.04, 0.01),
                          uFoliageColor * 0.82 + vec3(0.01, 0.06, 0.01), hasVeg);
      color = mix(color, bankCol, rivBank * rivStr * 0.52);
      // Delta: sandy alluvial fan at river mouth
      float deltaStr = smoothstep(0.06, 0.0, h - uOceanLevel - 0.015) * rivChan;
      color = mix(color, vec3(0.74, 0.66, 0.50) * 0.82, deltaStr * 0.55);
    }

    // ── FEATURE 08: Volcanic ash fields ──────────────────────
    // Rough zones near high-volcanism worlds get grey-brown ash overlay.
    // Ash settles in valleys (low-elevation rough zones) most heavily.
    // FIX 11: raise gate — prevent ash on Earth-like worlds and thick-atm worlds
    if(uVolcanism > 0.20 && uAtmThickness < 0.50) {
      float ashN = fbm3(pos*uNoiseScale*1.6 + uSeed + 600.0);
      float ashMask = smoothstep(0.42, 0.60, ashN)
                    * smoothstep(0.35, 0.65, zr)
                    * (1.0-ze*0.55)       // less ash on highlands
                    * (1.0-isPolar);      // no ash under ice
      color = mix(color, color*0.62 + vec3(0.10,0.09,0.07), ashMask*uVolcanism*0.60);
    }

    // ── FEATURE 09: Terrain age saturation effect ─────────────
    // Young terrain: high contrast, saturated.
    // Old terrain: muted, slightly darkened and uniform.
    {
      float cL = max(dot(color, vec3(0.299,0.587,0.114)), 0.001);
      float youngStr = (1.0-uTerrainAge) * (1.0-isPolar) * 0.30;
      color = mix(vec3(cL), color, 1.0 + youngStr);          // saturation boost
      color *= mix(1.0, 0.86 + ze*0.12, uTerrainAge*0.40);  // old = darker basins
    }

    // ── FEATURE 21: Snow line ─────────────────────────────────
    // Mountain peaks above a temperature-dependent altitude threshold get snow.
    // Independent of polar ice caps — appears at any latitude on high terrain.
    // FIX 8: Only apply on worlds where peaks can be cold enough to freeze
    if(uEquatorTemp < 340.0) {
      float snowThresh = mix(0.74, 0.85, clamp(uAtmThickness*1.8, 0.0, 1.0));
      float snowFract  = smoothstep(snowThresh, snowThresh+0.07, h + ze*0.12);
      float snowMask   = snowFract * (1.0 - clamp(uIceCaps*1.8, 0.0, 1.0)) * (1.0-isPolar);
      if(snowMask > 0.002) {
        float snowN = noise3D(pos*16.0+uSeed+310.0)*0.5+0.5;
        vec3  snowC = mix(vec3(0.86,0.91,0.96), vec3(0.96,0.98,1.0),
                          smoothstep(0.38, 0.68, snowN));
        color = mix(color, snowC, snowMask * smoothstep(0.35, 0.65, snowN) * 0.88);
      }
    }

    // ── FEATURE 22: Salt pans ────────────────────────────────
    // Dry worlds, smooth low-elevation zones: blinding white crystalline flats.
    if(uOceanLevel < 0.08 && ze < 0.38 && zr < 0.38 && isPolar < 0.5) {
      float saltStr = clamp((0.08-uOceanLevel)*14.0 * (0.38-ze)*3.0 * (0.38-zr)*3.0, 0.0, 0.7);
      float saltN   = noise3D(pos*uNoiseScale*7.0 + uSeed + 360.0);
      vec3  saltC   = mix(vec3(0.92,0.91,0.87), vec3(0.98,0.97,0.93),
                          smoothstep(0.4, 0.7, saltN));
      color = mix(color, saltC, saltStr * smoothstep(0.50, 0.72, saltN) * 0.58);
    }

    // ── FEATURE 23: Mineral vein exposure ───────────────────
    // Ore veins cross zone boundaries where geology is exposed on airless/thin-atm worlds.
    if(airlessScale > 0.15 && (uIronPct > 0.30 || uSilicatePct > 0.40 || uKreepIndex > 0.25)) {
      float veinEdge = smoothstep(0.020, 0.002, provEdge);
      float veinN    = abs(noise3D(pos*uNoiseScale*4.5+uSeed+460.0)*2.0-1.0);
      float veinStr  = smoothstep(0.0, 0.22, veinEdge*veinN) * airlessScale;
      vec3  veinC    = uIronPct > uSilicatePct
        ? mix(vec3(0.54,0.26,0.12), vec3(0.75,0.44,0.20), uKreepIndex)
        : mix(vec3(0.80,0.76,0.72), vec3(0.90,0.84,0.60), uKreepIndex);
      color = mix(color, veinC, veinStr * 0.42);
    }

    // ── FEATURE 24: Sand dune seas ───────────────────────────
    // Arid smooth low-elevation zones: wind-sculpted dune ripple pattern.
    if(uOceanLevel < 0.14 && ze < 0.44 && zr < 0.32 && isPolar < 0.5) {
      float dStr  = clamp((0.14-uOceanLevel)*7.0 * (0.44-ze)*2.5 * (0.32-zr)*3.5, 0.0, 0.55);
      vec3  dDir1 = normalize(vec3(8.5, 0.5, 5.2));
      vec3  dDir2 = normalize(vec3(3.1, 0.8, 9.7));
      float dS    = dynScale * 1.6;
      float dune  = (sin(dot(pos,dDir1)*dS + uSeed*3.1)
                   + sin(dot(pos,dDir2)*dS + uSeed*5.7))*0.5*0.5+0.5;
      dune = mix(dune, fbm3(pos*dS*0.55+uSeed+560.0), 0.28);
      color = mix(color, color * mix(0.70, 1.30, dune), dStr * 0.40);
    }

    // ── FEATURE 40: Craton + Rift fine surface detail (post-texture) ─────────
    // Base colours set pre-texture in ROLE COLOUR block above.
    // Here: specular glints on granite crests, lava vein streaks in rifts.
    if(isCraton > 0.01) {
      float cratonGlint = smoothstep(0.72, 0.88, h)
                        * pow(max(dot(bumpN,H),0.0), 55.0) * 0.16 * isCraton;
      color += vec3(0.78,0.74,0.66) * cratonGlint;
    }
    if(isRift > 0.01) {
      float rfN    = fbm3(pos*uNoiseScale*3.0 + uSeed + 650.0);
      float rfVein = smoothstep(0.60, 0.75, rfN) * zr;
      color = mix(color, color*0.58 + vec3(0.28,0.09,0.02), rfVein * isRift * 0.12);
    }

    // ── Crater coloring: bowl floor, rim highlight, ejecta rays ──
    if(uCraterDensity > 0.01) {
      vec3 ecp=pos*uNoiseScale*2.5+uSeed+333.0; vec3 eci=floor(ecp),ecf=fract(ecp);
      float eF1=99.0, eF2=99.0; vec3 eCenter=vec3(0.5);
      for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
        vec3 g=vec3(float(x),float(y),float(z));
        vec3 o=fract(sin(vec3(dot(eci+g,vec3(127.1,311.7,74.7)),
                              dot(eci+g,vec3(269.5,183.3,246.1)),
                              dot(eci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
        float d=length(g+o-ecf);
        if(d<eF1){eF2=eF1; eF1=d; eCenter=o;} else if(d<eF2){eF2=d;}
      }
      float cSzH = fract(sin(dot(eci,vec3(71.3,23.9,157.7)))*43758.5);
      float cSz  = mix(0.14, 0.28, cSzH);
      float fresh = step(0.50, fract(sin(dot(eci,vec3(37.1,91.7,53.3)))*43758.5));

      // ── CRATER WALL NORMAL — sun-aware, not a flat decal ─────────────────
      // The vector from crater center to fragment (in cell fract space) maps
      // directly to world-space direction (same scale everywhere in cell space).
      // Project it onto the sphere tangent plane so it's a valid surface tangent.
      vec3  radialRaw    = ecf - eCenter;                  // center → fragment in cell space
      vec3  radialTan    = normalize(radialRaw - dot(radialRaw, N) * N + N * 0.001);

      // Wall slope: zero at center (floor, N is horizontal), peaks at ~60% of radius
      // (steepest wall), returns to zero at the rim (top of berm).
      float innerSlope   = smoothstep(0.0,   cSz * 0.65, eF1)
                         * (1.0 - smoothstep(cSz * 0.50, cSz, eF1));
      // Wall normal tilts INWARD (toward center) — opposite of radialTan
      vec3  craterWallN  = normalize(N - radialTan * innerSlope * 2.4);
      float craterNdotL  = max(dot(craterWallN, L), 0.0);

      // Bowl floor: impact melt + wall-normal lighting + deep horizon AO.
      // horizonAO: a deep crater bowl occludes ~50% of sky hemisphere at center.
      // This is geometry-correct, not a fake radial fade.
      float bowlMask   = 1.0 - smoothstep(0.0, cSz * 0.72, eF1);
      float horizonAO  = mix(0.32, 1.0, smoothstep(0.0, cSz * 0.70, eF1));
      // Bowl lighting: wall-normal NdotL for directional shading + hard AO floor
      float bowlLight  = craterNdotL * 0.70 + horizonAO * 0.30;
      vec3  meltColor  = mix(vec3(0.08,0.06,0.04), vec3(0.18,0.14,0.10), cSzH);
      vec3  bowlColor  = mix(meltColor, color, smoothstep(0.0, cSz * 0.65, eF1));
      bowlColor       *= bowlLight;
      color = mix(color, bowlColor, bowlMask * uCraterDensity * 0.92);

      // Rim berm: bright sun-facing wall, dark shadow-facing wall.
      // Use the outward-tilted wall normal (opposite side from bowl) for the rim.
      float rimMask   = smoothstep(cSz*0.82, cSz, eF1) * (1.0-smoothstep(cSz, cSz*1.15, eF1));
      // Rim outer-wall normal tilts outward (away from crater center)
      vec3  rimWallN  = normalize(N + radialTan * rimMask * 1.6);
      float rimLit    = max(dot(rimWallN, L), 0.0) * 1.60 + 0.22;
      vec3  rimColor  = (color * 1.22 + vec3(0.06,0.05,0.03)) * rimLit;
      color = mix(color, rimColor, rimMask * uCraterDensity * (0.50 + fresh * 0.42));
      // Specular glint on the sharp crest of fresh rims (crushed anorthosite / glass)
      float rimSpec   = pow(max(dot(bumpN, H), 0.0), 38.0) * rimMask * fresh * airlessScale;
      color += vec3(0.82, 0.80, 0.76) * rimSpec * uCraterDensity * 0.55;

      // Radial ejecta rays — asymmetric, 7-12 rays per crater
      vec3 toC = normalize(ecf - eCenter);
      float nRays = 7.0 + floor(cSzH * 5.0);
      float rays = sin(atan(toC.z, toC.x) * nRays
                  + fract(sin(dot(eci,vec3(37.1,91.7,53.3)))*43758.5)*6.28)*0.5+0.5;
      rays = smoothstep(0.48, 0.82, rays);
      float ejRing = smoothstep(cSz, cSz*1.05, eF1) * (1.0-smoothstep(cSz*1.05, cSz*3.0, eF1));
      // Fade rays with distance — bright near rim, ghost-thin at far end
      float rayFade = 1.0 - smoothstep(cSz*1.1, cSz*3.0, eF1);
      vec3 ejectaCol = mix(color*1.22+vec3(0.07,0.06,0.04),
                           color*0.88+vec3(0.05,0.04,0.02), eF1/(cSz*3.0));
      color = mix(color, ejectaCol, rays * ejRing * rayFade * uCraterDensity * fresh * 0.70);

      // Central peak: bright exposed deep-crust rock
      float peakMask = (1.0-smoothstep(0.0, cSz*0.16, eF1)) * step(0.55, cSzH);
      color = mix(color, color*1.45+vec3(0.06,0.04,0.02), peakMask*uCraterDensity*0.65);
    }

    // ── Shader-driven boulders ────────────────────────────────
    // Scattered rounded rocks in rough rocky/craton/upland zones.
    // Voronoi cell centers = boulder positions; hemisphere shading fakes 3D.
    // Only fires where terrain is bumpy (slope > 0.18, zoneCharAdj roughness high).
    if(!isOcean && isPolar < 0.1 && zoneCharAdj.y > 0.42
        && uMountainHeight > 0.04 && slope > 0.12) {
      float bScale = uNoiseScale * 6.5;
      vec3  bPos = pos * bScale + uSeed + vec3(333.0, 71.0, 245.0);
      vec3  bI   = floor(bPos); vec3 bF = fract(bPos);
      float bF1  = 99.0; vec3 bCtr = vec3(0.5);
      for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
        vec3 g = vec3(float(x),float(y),float(z));
        vec3 o = fract(sin(vec3(dot(bI+g,vec3(127.1,311.7,74.7)),
                               dot(bI+g,vec3(269.5,183.3,246.1)),
                               dot(bI+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
        float d = length(g+o-bF);
        if(d < bF1){ bF1 = d; bCtr = o; }
      }
      // ~40% of cells activate as boulders (size varies)
      float bHash = fract(sin(dot(bI, vec3(7.13,157.9,113.2)))*43758.5);
      float bSz   = mix(0.22, 0.40, bHash);
      float bShape = smoothstep(bSz, bSz*0.35, bF1) * step(0.60, bHash);
      if(bShape > 0.005) {
        // Normal of the boulder surface (from cell center → fragment)
        vec3 bNorm   = normalize(bF - bCtr);
        float bNdotL = max(dot(bNorm, L), 0.0);
        float bNdotV = max(dot(bNorm, V), 0.0);
        // Base rock color inherits terrain + mineral tint
        vec3 bRockCol = mix(color, color * zoneCharAdj.z * 1.4 + vec3(0.04,0.03,0.02), 0.45);
        // Hemisphere shading: lit face bright, shadow face dark
        vec3 bShaded = bRockCol * (0.15 + bNdotL * 0.85);
        // Specular glint — gritty highlight
        bShaded += vec3(0.80,0.78,0.72) * pow(max(dot(bNorm, H), 0.0), 22.0) * bNdotL * 0.18;
        // Fresnel rim darkening (ambient occlusion at boulder base)
        float bAO = 1.0 - pow(1.0 - bNdotV, 2.5) * 0.35;
        bShaded *= bAO;
        float roughWeight = smoothstep(0.42, 0.85, zoneCharAdj.y) * slope;
        color = mix(color, bShaded, bShape * roughWeight * 0.65);
      }
    }

    // Vegetation
    if(length(uFoliageColor) > 0.01) {
      float veg = smoothstep(0.32,0.54,h)*(1.0-smoothstep(0.58,0.78,h));
      veg *= clamp(1.0-absLat*1.4,0.0,1.0)*clamp(1.0-slope*2.5,0.0,1.0);
      float vegP=voronoiPlates(pos,uNoiseScale*0.55+uSeed*0.005).z;
      color = mix(color,uFoliageColor,veg*step(0.0,underwaterDepth-0.01)*step(0.25,vegP)*step(vegP,0.85)*0.55);
    }

    // ── FEATURE 6: Vegetation biome zones ────────────────────
    // globalIce not yet computed here; use isPolar as ice proxy for the call.
    // FIX 13: habitable worlds only
    if(uWorldMode == 1.0) {
      applyVegetation(color, pos, N, NdotL, bZone, zoneChar, absLat, isPolar, false);
    }

    // ── #7 Flow channels — dendritic drainage on wet terrain ──────────────
    // Voronoi cell edges = dark drainage channels on land surface of habitable worlds.
    // Gate: habitable, has ocean, non-polar, non-ocean pixel, not too arid.
    if(uWorldMode == 1.0 && uOceanLevel > 0.1 && !isOcean && absLat < 0.80
       && zoneChar.x < 0.72 && uAtmThickness > 0.08) {
      vec3  fcp  = pos * uNoiseScale * 3.2 + uSeed + 711.0;
      vec3  fci  = floor(fcp);
      vec3  fcf  = fract(fcp);
      float fF1  = 99.0, fF2 = 99.0;
      for(int dx=-1;dx<=1;dx++)
      for(int dy=-1;dy<=1;dy++)
      for(int dz=-1;dz<=1;dz++) {
        vec3 g = vec3(float(dx),float(dy),float(dz));
        vec3 o = fract(sin(vec3(
          dot(fci+g,vec3(127.1,311.7, 74.7)),
          dot(fci+g,vec3(269.5,183.3,246.1)),
          dot(fci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
        float d = length(g + o - fcf);
        if(d < fF1){ fF2=fF1; fF1=d; } else if(d < fF2){ fF2=d; }
      }
      // F2-F1 small = near a cell edge = drainage line
      float channelEdge = 1.0 - smoothstep(0.0, 0.07, fF2 - fF1);
      // Only draw in low-elevation areas (valleys, basins)
      float valleyMask = smoothstep(0.55, 0.35, h);
      float channelStr = channelEdge * valleyMask
                       * (1.0 - zoneChar.x)          // wetter zones have more channels
                       * clamp(uOceanLevel * 2.5, 0.0, 0.80);
      // Dark muddy water color for channels, lighter for dry gullies
      vec3 channelCol = mix(color * 0.42, vec3(0.08, 0.12, 0.20), clamp(uOceanLevel * 2.0, 0.0, 0.65));
      color = mix(color, channelCol, channelStr * 0.62);
    }

    // ── FEATURE C: Desert Wind-Streak Patterns ────────────────
    // Gate: arid+hot zone, below polar latitude
    // FIX 14: prevent dune patterns on ocean-bearing worlds
    if(zoneChar.x > 0.40 && zoneChar.z > 0.35 && absLat < 0.75 && !isOcean && uOceanLevel < 0.12) {
      // Seed-driven global wind direction
      vec2 windDir = normalize(vec2(cos(uSeed * 0.37), sin(uSeed * 0.51)));

      // 1. Crater wind-streaks: bright pale sand downwind of elevated features
      {
        float elevN = noise3D(pos * 6.0 + uSeed) * 0.5 + 0.5;
        float isElevated = step(0.62, elevN);
        float windProj = dot(vec2(pos.x, pos.z), windDir);
        // Streak extends downwind of elevated terrain
        float streakN = fbm3(pos * 4.0 + uSeed + 100.0);
        float streakMask = isElevated * smoothstep(-0.10, 0.20, windProj - fbm3(pos * 2.5 + uSeed + 110.0) * 0.5)
                         * (1.0 - smoothstep(0.20, 0.55, windProj + streakN * 0.3));
        vec3 streakCol = vec3(0.88, 0.82, 0.68);
        color = mix(color, streakCol, streakMask * 0.22 * smoothstep(0.52, 0.80, zoneChar.x));
      }

      // 2. Longitudinal dune alignment: only in basins (not highlands)
      if((1.0 - zoneChar.x) > 0.45) {
        float duneFbm  = fbm3(pos * 3.0 + uSeed + 200.0);
        float dune     = sin(dot(vec2(pos.x, pos.z), windDir) * 22.0 + duneFbm * 4.0) * 0.5 + 0.5;
        float duneSharp = pow(dune, 2.8);
        vec3  duneCrest  = vec3(0.92, 0.85, 0.65);
        vec3  duneTrough = vec3(0.42, 0.35, 0.22);
        vec3  duneColor  = mix(duneTrough, duneCrest, duneSharp);
        color = mix(color, duneColor, duneSharp * 0.22 * smoothstep(0.52, 0.80, zoneChar.x));
      }

      // 3. Yardang erosion shadows
      {
        float yardang    = step(0.64, noise3D(pos * 12.0 + uSeed + 300.0) * 0.5 + 0.5);
        vec3  windDir3   = normalize(vec3(windDir.x, 0.0, windDir.y));
        float windDotN   = dot(windDir3, N);
        // Windward: bright; leeward: shadow
        float highlight  = clamp(windDotN,  0.0, 1.0);
        float shadow     = clamp(-windDotN, 0.0, 1.0);
        color = mix(color, color * 1.18 + vec3(0.04, 0.03, 0.02) * highlight, yardang * 0.18);
        color = mix(color, color * 0.78, yardang * shadow * 0.22);
      }
    }
    // total blend already embedded above (0.35 * smoothstep weight per sub-feature)

    // ── FEATURE: Moon-specific surface path ──────────────────
    applyMoonSurface(color, pos, N, L, H, NdotL, zoneChar, false, isPolar);

    // Shore blend
    color = mix(color, uOceanColor*0.78+0.05, shoreBlend*0.55);
  }

  // ── FEATURE B: Snowball / Rogue Planet ────────────────────
  if(uIsIceWorld > 0.5) {
    applySnowball(color, pos, N, L, V, H, NdotL);
  }

  // ── 5. ICE CAPS — POLAR-ZONE DRIVEN ───────────────────────
  float globalIce = 0.0;
  {
    // Suppress latitude-based ice caps on tidally-locked eyeballs — their glacier
    // is a terminator ring (fixed longitude), handled entirely in the eyeball block below.
    float iceCapsActive = uTidallyLocked > 0.5 && uSpinOrbit32 < 0.5 ? 0.0 : 1.0;
    float isNeighborPolar = step(0.5, zr2) * step(zr2, 1.5);
    if(iceCapsActive > 0.5) {
      globalIce = applyIceCaps(color, pos, N, L, V, H, bumpN, NdotL, absLat,
                                provEdge, isPolar, isNeighborPolar, bZone, zoneChar);
      // ── #8 Polar frost fringe — soft white dusting just outside the ice zone ──
      // Non-polar pixels that neighbour a polar zone get a noise-warped frost edge.
      if(uIceCaps > 0.05 && isPolar < 0.5 && isNeighborPolar > 0.5 && !isOcean) {
        float frostFall  = smoothstep(0.075, 0.002, provEdge);
        float frostNoise = fbm3(pos * 28.0 + uSeed + 550.0) * 0.65 + 0.35;
        float frostMask  = frostFall * frostNoise * (1.0 - globalIce);
        color = mix(color, vec3(0.80, 0.87, 0.93), frostMask * clamp(uIceCaps * 1.8, 0.0, 0.70));
      }
    }
  }

  // ── FEATURE 9: Subsurface ocean worlds (Europa-type) ──────
  // Guard: uSubsurfaceOcean > 0.5. Replaces color entirely.
  if(uSubsurfaceOcean > 0.5) {
    applySubsurfaceOcean(color, pos, N, L, V, H, NdotL, globalIce, isPolar);
  }

  // ── FEATURE: Cryo-plumes (Enceladus / Triton / Europa analogs) ──────────
  // Surface geyser halos + radial frost streaks on ice-shell moons.
  // Guard: uIceCaps >= 0.25 && uVolcanism >= 0.04 (checked inside function).
  applyCryoPlumes(color, pos, N, L, NdotL);

  // ── 6. EYEBALL / TIDALLY LOCKED RENDERING ─────────────────
  if(uTidallyLocked > 0.5 && uSpinOrbit32 < 0.5) {
    float facing = dot(pos, L);

    // Detect ocean eyeball — high ocean level means most of the day side is liquid.
    // Affects glacier color, substellar land treatment, and crack intensity.
    float isOceanEyeball = step(0.30, uOceanLevel);

    // ── Glacier base color ─────────────────────────────────────────────────────
    // Applied everywhere EXCEPT the substellar ocean zone.
    // Real glacier ice is not stark blue-white — it's warm beige/tan from
    // trapped dust, sediment, and UV-discolored organics (old snow = warm cream).
    // Cracks/meltwater channels are vivid blue where fresh water is exposed.
    vec3 glacierBeige = mix(vec3(0.86, 0.83, 0.76), vec3(0.78, 0.80, 0.88),
                             fbm3(pos * 2.8 + uSeed + 44.0) * 0.5 + 0.5);
    float glacierMask = clamp(1.0 - isSubstellar * 1.8, 0.0, 1.0);

    // ── Substellar zone ────────────────────────────────────────────────────────
    if(isSubstellar > 0.5) {
      if(isOceanEyeball > 0.5) {
        // OCEAN EYEBALL: permanent noon ocean — deep thermal blue, big wave crests.
        // The absolute sub-solar point drives strong convective upwelling,
        // giving a distinctive warm-teal plume surrounded by cooler blue.
        float shoreN = fbm3(pos * 6.0 + uSeed + 900.0);
        // Central noon ocean: mix toward rich warm-teal (upwelling) at peak facing
        float noonBlend = smoothstep(0.40, 0.90, facing);
        color = mix(color, uOceanColor * 0.70 + vec3(0.02, 0.08, 0.10), noonBlend * 0.65);
        // Wave-crest foam: bright specks on the active surface
        float waveGlint = smoothstep(0.62, 0.78, shoreN) * smoothstep(0.92, 0.72, facing);
        color = mix(color, vec3(0.88, 0.92, 0.96), waveGlint * 0.50);
        // Steam haze near absolute substellar (near-boiling surface)
        if(uSubstellarTemp > 320.0) {
          float steam = smoothstep(0.72, 0.96, facing) * fbm3(pos * 8.0 + uTime * 0.30 + uSeed + 901.0);
          color = mix(color, vec3(0.84, 0.88, 0.96), steam * 0.38);
        }
      } else {
        // ROCKY/HOT EYEBALL: sun-baked, bleached, incandescent toward noon.
        // The hot side is the ILLUMINATED side — minerals thermally volatilize
        // and redeposit as bright salts/sulfur. Think: bright pale ochre / bleached tan.
        float heatN = fbm3(pos * 4.0 + uSeed + 170.0);
        // Sun-bleached palette: pale sandy ochre → bright salt-white near peak
        vec3 bleachedRock = mix(vec3(0.68, 0.58, 0.42), vec3(0.88, 0.82, 0.68), heatN);
        color = mix(color, bleachedRock, 0.58);
        // Brighter / whiter right at the sub-solar point (maximum irradiance)
        color = mix(color, vec3(0.92, 0.88, 0.76), smoothstep(0.62, 0.96, facing) * 0.42);
        if(uSubstellarTemp > 500.0) {
          // Extreme temps: lava starts showing through cracked bleached crust
          float molten = smoothstep(0.82, 0.97, facing) * smoothstep(0.38, 0.58, heatN);
          color = mix(color, vec3(1.0, 0.38, 0.06), molten * 0.58);
          // Incandescent glow bleeds into surroundings
          color += vec3(0.18, 0.05, 0.0) * molten * 0.28;
        }
      }
    }

    // ── Glacier: purely facing-based, follows the terminator circle ───────────
    // The glacier is at FIXED LONGITUDE — it wraps uniformly around the great
    // circle where dot(pos, L) = 0, regardless of latitude or Voronoi zone.
    // Antistellar/terminator zone roles are intentionally ignored here so the
    // ice boundary is a smooth longitude ring, not a blocky Voronoi patchwork.
    else {
      // Multi-scale noise warps the ice front edge organically (lobes/bays)
      // but the overall shape is always a longitude ring, never latitude-based.
      float iceWarpT = fbm3(pos * 5.5 + uSeed + 150.0) * 0.18
                     + fbm3(pos * 14.0 + uSeed + 320.0) * 0.06;

      // Glacier front: starts just past the terminator into the night side,
      // thickens smoothly toward the antistellar point.
      float iceMask = smoothstep(0.10, -0.62, facing + iceWarpT);

      // Colour gradient: warm dusty beige at the glacier front (young ice,
      // blown dust) → cool blue-grey deep into the permanent night side (old
      // compressed ice, no solar heating at all).
      float depthFade = clamp(-facing * 1.25, 0.0, 1.0);
      vec3 tidalIce = mix(
        glacierBeige,                                           // warm dusty edge
        glacierBeige * 0.72 + vec3(0.02, 0.07, 0.18),         // cool compressed interior
        depthFade * 0.55
      );

      // Melt / slush strip right at the glacier front (facing ≈ 0)
      float meltFront = smoothstep(0.16, 0.02, facing + iceWarpT)
                      * smoothstep(-0.05, 0.14, facing + iceWarpT);
      tidalIce = mix(tidalIce, vec3(0.22, 0.40, 0.66) * 0.82, meltFront * 0.55);

      // Crevasse network in the deep ice (antistellar side only)
      float crevD = clamp(-facing * 1.8, 0.0, 1.0);
      float acrevas = abs(noise3D(pos * 22.0 + uSeed + 88.0) * 2.0 - 1.0);
      tidalIce -= smoothstep(0.0, 0.08, acrevas) * 0.06 * crevD;

      color = mix(color, tidalIce, iceMask);
      globalIce = max(globalIce, iceMask);

      // Day-side habitable fringe: gentle warming toward the terminator from the day side
      float warmSide = smoothstep(0.0, 0.60, facing) * (1.0 - iceMask);
      color = mix(color, color * 1.06 + vec3(0.03, 0.01, 0.0), warmSide * 0.22);
    }

    // ── TIDAL CRACK NETWORK ────────────────────────────────────────────────────
    // Branching fracture lines in the global ice shell.
    // Driven by tidal flexing: cracks radiate outward from the substellar-antistellar
    // axis, warped by multi-scale FBM to produce organic branching.
    // Key visual in the reference: vivid blue cracks on pale glacier, Europa-style.
    float crackZoneW = clamp(globalIce * 1.4 - isSubstellar * 2.0, 0.0, 1.0)
                     * uTidallyLocked;
    if(crackZoneW > 0.02) {
      // Three-level domain warp for branching (each level adds more subdivisions)
      vec3 cp0 = pos * 5.2 + uSeed + 555.0;
      // Tidal axis: L (toward sun) forces cracks to radiate from the substellar pole
      cp0 -= L * 2.2;
      vec3 w1 = vec3(fbm3(cp0 * 0.65 + 110.0),
                     fbm3(cp0 * 0.65 + 220.0),
                     fbm3(cp0 * 0.65 + 330.0)) - 0.5;
      vec3 cp1 = cp0 + w1 * 1.8;
      vec3 w2 = vec3(fbm3(cp1 * 1.30 + 440.0),
                     fbm3(cp1 * 1.30 + 550.0),
                     fbm3(cp1 * 1.30 + 660.0)) - 0.5;
      vec3 cp2 = cp1 + w2 * 0.90;
      // Fine branching at highest level
      vec3 w3 = vec3(noise3D(cp2 * 2.8 + 770.0),
                     noise3D(cp2 * 2.8 + 880.0),
                     noise3D(cp2 * 2.8 + 990.0)) - 0.5;
      vec3 cp3 = cp2 + w3 * 0.40;

      float crackRaw  = abs(noise3D(cp3) * 2.0 - 1.0);
      // Two widths: bright thin core + wide blue-glow halo
      float crackCore = smoothstep(0.032, 0.0, crackRaw);
      float crackHalo = smoothstep(0.120, 0.032, crackRaw) * (1.0 - crackCore);

      // Crack color: vivid cobalt to ice-blue to white at center
      // Fresh cracks: brighter, more vivid blue (SSS tidal heat)
      float crackDepth = 1.0 - crackRaw / 0.120;
      vec3 crackCol = mix(
        vec3(0.16, 0.42, 0.80),          // outer halo: deep blue
        mix(vec3(0.35, 0.68, 1.00),       // mid: bright blue
            vec3(0.80, 0.92, 1.00), crackCore), // core: ice-white
        crackDepth
      );
      // SSS from tidal deformation heating: cracks glow slightly from edge
      float crackSSS = pow(1.0 - max(dot(N, V), 0.0), 2.8) * 0.24;
      crackCol += vec3(0.08, 0.22, 0.50) * crackSSS;

      color = mix(color, crackCol, crackCore * crackZoneW * 0.90);
      color += vec3(0.04, 0.14, 0.38) * crackHalo * crackZoneW * 0.32;
    }
  }

  // ── FEATURE: Drifting polar ice floes (ocean + icecap worlds) ─────────────
  // Voronoi-cell ice plates calving from the polar shelf, drifting equatorward.
  // Guard inside: requires isOcean && uIceCaps >= 0.05
  applyIceFloes(color, pos, N, L, V, H, NdotL, isOcean, globalIce);

  // ── 7. LIGHTING ────────────────────────────────────────────
  // Dual-sun composite: blend primary + secondary NdotL by brightness weights
  float sunB  = max(uSunBrightness,  0.01);
  float sunB2 = uSunBrightness2;
  // Safe normalize: avoid NaN when second sun is absent (uSunDir2 = 0,0,0)
  vec3  L2     = normalize(dot(uSunDir2, uSunDir2) > 0.0001 ? uSunDir2 : L);
  float NdotL2 = max(dot(bumpN, L2), 0.0);
  float term2  = smoothstep(-0.08, 0.22, NdotL2);
  float totalB = sunB + sunB2;
  float blendedNdotL = clamp((NdotL * sunB + NdotL2 * sunB2) / totalB, 0.0, 1.0);
  // #16 Terminator softening: wide penumbra for thick-atm worlds, sharp for airless/moons
  float _trmSoft  = clamp(uAtmThickness * 3.0, 0.0, 1.0) * (1.0 - airlessScale * 0.8);
  float terminator = smoothstep(mix(-0.04, -0.16, _trmSoft), mix(0.15, 0.38, _trmSoft), blendedNdotL);

  float ao = 0.87 + 0.13*smoothstep(0.35,0.65,h);
  float ambientAmt = mix(0.13, 0.22, airlessScale);

  // Post-MS ambient: red giant / white dwarf / pulsar tints the ambient light
  vec3  baseAmbient = mix(vec3(ambientAmt), uPostMsAmbient + vec3(ambientAmt), 0.60);
  vec3  ambient     = color * baseAmbient * ao;

  // Star color tint: the lit hemisphere takes on the star's spectral hue
  // M-dwarf → warm orange; A-star → cool blue-white; this is the single highest-impact line
  vec3 starTintedColor = mix(color, color * uStarColor * 1.12, 0.28);
  vec3  diffuse    = starTintedColor * blendedNdotL * 0.87;
  finalColor = diffuse * terminator + ambient;

  // ── FEATURE 2: Post-MS stellar ambient contributions ─────────────────
  // Red giant / AGB: flood system with strong IR/red radiation.
  float postMsLen = length(uPostMsAmbient);
  if(postMsLen > 0.001) {
    // 1. Red ambient fill — warms the dark side with expanded-star glow
    finalColor += uPostMsAmbient * 0.35 * (1.0 - blendedNdotL * 0.5);
    // 2. Surface heating tint — dayside warm red-orange cast
    finalColor = mix(finalColor, finalColor * vec3(1.18, 0.88, 0.62),
                     postMsLen * blendedNdotL * 0.25);
    // 3. Atmospheric scorch — thickened atmosphere rim with post-MS tint
    if(uAtmThickness > 0.1) {
      finalColor += uPostMsAmbient * 1.4 * pow(rim, 3.0) * postMsLen * 0.18;
    }
  }

  // ── 8. SPECULAR ────────────────────────────────────────────
  if(isOcean) {
    // Physically correct water: IOR 1.34 → f0 = ((1.34-1)/(1.34+1))² ≈ 0.0204
    float f0water = 0.0204;
    float NdotV_w = max(dot(bumpN, V), 0.0);
    float NdotH_w = max(dot(bumpN, H), 0.0);
    // Schlick approximation with actual water IOR
    float fO = f0water + (1.0 - f0water) * pow(1.0 - NdotV_w, 5.0);

    // ── Anisotropic sun-glitter path ─────────────────────────
    // The ocean glitter forms a streak from the viewer toward the specular point.
    // We decompose H into: sunTan (toward sun along surface) and perpTan (cross).
    // Wide exponent along sunTan (creates the path), tight exponent perpendicular.
    vec3 sunTan  = normalize(L - dot(L, N) * N + vec3(0.0, 0.0001, 0.0));
    vec3 perpTan = cross(N, sunTan);
    float hDotT  = dot(H, sunTan);
    float hDotP  = dot(H, perpTan);
    // Ashikhmin-Shirley anisotropic exponents: e1=14 along path (wide), e2=420 across (tight)
    float eT = 14.0, eP = 420.0;
    float anisoExp = clamp((eT * hDotT * hDotT + eP * hDotP * hDotP) / max(1.0 - NdotH_w * NdotH_w, 0.02), 0.0, 512.0);
    float sAniso   = sqrt((eT + 1.0) * (eP + 1.0)) / 25.133 * pow(max(NdotH_w, 0.0), anisoExp) * NdotL;
    sAniso = clamp(sAniso, 0.0, 2.5) * (0.45 + fO * 0.55);

    // Keep the tight bright sun-disc highlight + wide Fresnel bloom
    float sSharp = pow(NdotH_w, 320.0) * (0.60 + fO * 0.30);
    float sWide  = pow(NdotH_w, 18.0)  * fO * 0.06;

    // Star-tinted specular (sun color reflected in ocean)
    vec3 specTint = mix(vec3(1.0), uStarColor * 1.08, 0.40);
    finalColor += specTint * (sSharp + sWide + sAniso * 0.55) * terminator;
    // Underwater scattering: light bouncing up from depth tints shallow areas
    float uwScatter = pow(max(dot(-bumpN, L), 0.0), 3.0) * (1.0 - depth01 * 0.7);
    finalColor += uOceanColor * uwScatter * 0.08 * terminator;
    // Turbid water: deep sediment-loaded water scatters more yellow-green
    float turbidity = smoothstep(0.15, 0.55, depth01) * (1.0 - bIsShelf);
    finalColor = mix(finalColor, finalColor * (vec3(1.0) + vec3(0.04, 0.06, -0.02)), turbidity * 0.22);
  } else {
    finalColor += vec3(pow(max(dot(bumpN,H),0.0),40.0)*0.035)*terminator;

    // ── FEATURE 10: Metallic world specular ──────────────────
    // uMetallic: explicit profile-driven metallic (iron-planets, stripped cores)
    // uIronPct / uKreepIndex: mineral-derived metallic on airless bodies
    float mineralMetallic = clamp(uIronPct*1.5 + uKreepIndex*0.8, 0.0, 1.0) * airlessScale;
    float metallic = clamp(uMetallic + mineralMetallic, 0.0, 1.0);
    if(metallic > 0.04) {
      // Cook-Torrance GGX: roughness driven by zone roughness axis
      float roughness = mix(0.06, 0.28, zoneCharAdj.y * (1.0 - uMetallic * 0.6));
      float alpha2    = roughness * roughness;
      float NdotH     = max(dot(bumpN, H), 0.0);
      float NdotV     = max(dot(bumpN, V), 0.0);
      float denom     = NdotH*NdotH*(alpha2-1.0)+1.0;
      float D         = alpha2/(3.14159*denom*denom);
      float G         = NdotL * NdotV / max(mix(NdotL,1.0,roughness)*mix(NdotV,1.0,roughness), 0.001);
      float fresnel   = 0.08 + 0.92*pow(1.0-max(dot(bumpN,V),0.0), 5.0);
      float mSpec     = D * G * fresnel * metallic * 0.22;
      // Metal tint: iron = warm gold-silver, explicit metallic from profile = polished
      vec3 mTint = mix(
        mix(vec3(1.0,0.95,0.88), vec3(0.90,0.88,0.82), zoneCharAdj.z),
        uStarColor * 1.05,   // mirror the star color in the metal
        uMetallic * 0.45
      );
      finalColor += mTint * mSpec * terminator;
    }
  }

  // Ice sparkle
  if(globalIce > 0.001 && !isOcean) {
    float iS=pow(max(dot(bumpN,H),0.0),240.0)*NdotL*0.45*globalIce;
    finalColor += vec3(1.0,0.97,0.94)*iS*terminator;
  }

  // ── FEATURE 5: Circumbinary Double-Sun Lighting ────────────────────────────
  // Second sun diffuse + specular contribution. Primary lighting already blended via
  // blendedNdotL above; here we add specular and ice from the second sun separately.
  if(uSunBrightness2 > 0.001) {
    vec3  L2b     = normalize(dot(uSunDir2, uSunDir2) > 0.0001 ? uSunDir2 : L);
    float NdotL2b = max(dot(bumpN, L2b), 0.0);
    vec3  H2      = normalize(L2b + V);

    // Specular roughness/power — same as primary sun land specular
    float specPow = 40.0;
    vec3  specCol = uStarColor2;

    // Diffuse from second sun (additive — not already in blendedNdotL path)
    // We use a fraction to avoid double-counting with the blended path above
    vec3 albedo = color;
    vec3 diffuse2 = albedo * NdotL2b * uSunBrightness2 * 0.55;

    // Specular from second sun
    float spec2 = pow(max(dot(bumpN, H2), 0.0), specPow) * NdotL2b * uSunBrightness2;

    // Ice sparkle from second sun
    float iceSpec2 = (globalIce > 0.3 && !isOcean)
      ? pow(max(dot(bumpN, H2), 0.0), 85.0) * NdotL2b * globalIce * uSunBrightness2
      : 0.0;

    finalColor += diffuse2 + specCol * spec2 * 0.035 + vec3(0.90, 0.96, 1.00) * iceSpec2 * 0.45;

    // Shadow overlap: both suns illuminate → warm tint on doubly-lit areas
    float dualLit = min(NdotL, NdotL2b) * uSunBrightness2;
    finalColor += vec3(0.12, 0.08, 0.02) * dualLit * 0.40;

    // Double shadow terminator: primary sun set, secondary still up → eerie blue ambient
    float secTwilight = (1.0 - NdotL) * max(NdotL2b, 0.0) * uSunBrightness2;
    finalColor += vec3(0.08, 0.12, 0.22) * secTwilight * 0.18 * uAtmThickness;
  }

  // ── FEATURE 32: Ring shadow on planet surface ────────────────────────────
  // Equatorial shadow band cast by the ring system. Uses modelMatrix to derive
  // the ring plane normal (planet's world-space Y-axis) and equatorial scale,
  // then ray-traces from each fragment toward the sun through the ring plane.
  if(uHasRings > 0.5 && uRingOuter > 0.001) {
    vec3  ringN   = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
    vec3  wP      = (modelMatrix * vec4(pos, 1.0)).xyz;
    vec3  pCentre = modelMatrix[3].xyz;
    vec3  relPos  = wP - pCentre;
    float pScale  = length(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
    float denom   = dot(L, ringN);
    if(abs(denom) > 0.001) {
      float t = -dot(relPos, ringN) / denom;
      if(t > 0.005) {
        float hitR = length(relPos + t * L) / pScale;
        if(hitR >= uRingInner && hitR <= uRingOuter) {
          float rNorm   = (hitR - uRingInner) / (uRingOuter - uRingInner);
          float rShadow = ringBandDensity(rNorm);
          finalColor    = mix(finalColor, finalColor * 0.22, rShadow * 0.88);
        }
      }
    }
  }

  // ── 9. LAVA EMISSION — Voronoi crack network ────────────────
  // Replaces old FBM blob pattern (looked like clouds) with a real
  // cooling-crust crack topology: black basalt plates separated by
  // glowing magma channels.  Brighter cracks near center (F1→0),
  // dimmer toward plate interior.  Whole thing pulses and advects.
  if(uEmissive > 0.01) {
    // Slow advection of crack cell centers — plate drift
    float flowX = sin(uTime * 0.045 + uSeed) * 0.18;
    float flowZ = cos(uTime * 0.038 + uSeed * 0.7) * 0.16;
    vec3 crPos = pos * uNoiseScale * 4.2 + uSeed + vec3(flowX, 0.0, flowZ);
    vec3 ci = floor(crPos); vec3 cf = fract(crPos);
    float F1 = 99.0, F2 = 99.0;
    for(int ix=-1;ix<=1;ix++) for(int iy=-1;iy<=1;iy++) for(int iz=-1;iz<=1;iz++) {
      vec3 g = vec3(float(ix), float(iy), float(iz));
      // Each cell center jitters slowly in time for heat-convection feel
      vec3 o = fract(sin(vec3(
        dot(ci+g, vec3(127.1,311.7,74.7)),
        dot(ci+g, vec3(269.5,183.3,246.1)),
        dot(ci+g, vec3(113.5,271.9,124.6))))*43758.5453)*0.5 + 0.25;
      o.xz += sin(uTime * 0.10 + g.xy * 3.14 + uSeed * 0.3) * 0.05;
      float d = length(g + o - cf);
      if(d < F1){ F2 = F1; F1 = d; } else if(d < F2){ F2 = d; }
    }

    // Crack channel = region where F2-F1 is small
    float crackW  = F2 - F1;
    float crackVar = fbm3(pos * uNoiseScale * 11.0 + uSeed + 14.0) * 0.05;
    float inCrack  = 1.0 - smoothstep(0.0, 0.09 + crackVar, crackW);
    float innerHot = 1.0 - smoothstep(0.0, 0.045, F1);  // hottest at crack center

    // Heat pulse: individual cracks breathe independently
    float crackHash = fract(sin(dot(ci, vec3(37.1,91.7,53.3)))*43758.5);
    float pulse = 0.55 + 0.45 * sin(uTime * (1.1 + crackHash * 0.9) + crackHash * 6.28 + F1 * 20.0);

    // Basalt plate: darken terrain between cracks to near-black cooling rock
    float plateInterior = smoothstep(0.05, 0.30, crackW);
    // Thin crust over lava — crinkled dark surface (crustal plates)
    float crustTex = fbm3(pos * uNoiseScale * 6.5 + uSeed + 77.0);
    float crustCol = mix(0.08, 0.22, crustTex);

    // Dayside plates slightly lit, night side pitch black
    finalColor = mix(finalColor,
      vec3(crustCol, crustCol * 0.55, crustCol * 0.28) * (0.12 + NdotL * 0.28),
      plateInterior * uEmissive * 0.92);

    // Crack glow: orange outer → yellow inner → white-hot core
    vec3 crackCol = mix(
      vec3(0.70, 0.10, 0.01),               // outer cooler rim
      mix(vec3(1.00, 0.55, 0.08),            // main orange channel
          mix(vec3(1.00, 0.90, 0.40),        // hot yellow
              vec3(1.00, 0.98, 0.88),        // white-hot core
              pow(innerHot, 2.2)),
          innerHot),
      inCrack);
    finalColor += crackCol * inCrack * pulse * uEmissive * 0.95;

    // Secondary: wide plate-edge glow where cold crust meets hot crack
    float edgeGlow = smoothstep(0.10, 0.04, crackW) * (1.0 - innerHot);
    finalColor += vec3(0.62, 0.08, 0.01) * edgeGlow * (0.40 + pulse * 0.25) * uEmissive * 0.35;

    // Bright eruptive vents: rare hotspot cells with extra intensity
    float ventHash = fract(sin(dot(ci, vec3(71.3, 23.9, 157.7)))*43758.5);
    if(ventHash > 0.82 && F1 < 0.06) {
      float ventStr = (1.0 - F1 / 0.06) * uEmissive;
      finalColor += vec3(1.0, 0.96, 0.80) * ventStr * pulse * 0.55;
    }
  }

  // ── FEATURE NEW-A: USP thermal dayside glow ──────────────────
  // Ultra-short-period rocks bake at 800–3000K: the dayside turns
  // incandescent red-orange like a cooling stellar forge.
  // Night side stays cold rock (no atmosphere to redistribute heat).
  if(uThermalGlow > 0.01) {
    float facingDot = dot(N, L);
    float dayFacing = smoothstep(0.0, 0.65, facingDot);
    float thermalN  = fbm3(pos * uNoiseScale * 1.6 + uSeed + 92.0);
    // Core incandescence — hottest at nadir, dimmer toward terminator
    vec3 hotCol  = mix(vec3(0.80, 0.22, 0.04),  // dull-red
                       vec3(1.00, 0.72, 0.24),   // yellow-white hot
                       dayFacing * uThermalGlow);
    float thermalStr = dayFacing * uThermalGlow * (0.55 + thermalN * 0.45);
    finalColor = mix(finalColor, finalColor * 0.38 + hotCol * 0.90, thermalStr * 0.72);
    // Terminator glow ring — red-hot limb visible from space
    float terminatorBand = exp(-pow(facingDot * 6.0, 2.0)) * uThermalGlow;
    finalColor += vec3(0.80, 0.24, 0.04) * terminatorBand * 0.22;
  }

  // Night/day face weights — used by tidal heating and emissive effects below
  float darkFace  = max(0.0, -(dot(N,L) + 0.06));
  float litFaceE  = smoothstep(-0.12, 0.25, NdotL);

  // ── FEATURE 2 (cont.): Post-MS night-side thermal re-emission ──────────
  // Planet surface reradiates absorbed heat as faint IR glow on the night side.
  {
    float postMsL2 = length(uPostMsAmbient);
    finalColor += uPostMsAmbient * 0.15 * darkFace * smoothstep(0.0, 0.8, postMsL2);
  }

  // ── FEATURE 3: Night-side thermal emission — hot/Venus-type worlds ────────
  // Dense-atmosphere worlds trap heat; the night side glows from re-emission.
  if(uThermalGlow > 0.15 || (uAtmThickness > 0.55 && uCloudDensity > 0.60)) {
    float thermalRetain = clamp(uThermalGlow * 1.5 + (uAtmThickness - 0.55) * 0.8, 0.0, 1.0);
    // Terrain-modulated emission: lowlands hotter (deeper in atmosphere)
    float terrainHeat = 1.0 - zoneChar.x * 0.35;
    // Noise variation for patchy cloud-hole thermal windows
    float thermalN = fbm3(pos * uNoiseScale * 2.2 + uSeed + 801.0) * 0.5 + 0.5;
    // Emission colour: deep red at moderate heat → orange → yellow-white at extreme
    vec3 thermalEmit = mix(
      vec3(0.35, 0.04, 0.01),
      mix(vec3(0.72, 0.22, 0.04), vec3(0.95, 0.62, 0.18), thermalRetain),
      thermalRetain * 0.70
    );
    float emitStr = darkFace * thermalRetain * terrainHeat * (0.65 + thermalN * 0.35);
    finalColor += thermalEmit * emitStr * 0.28;
    // Global thermal halo — faint warm limb disc on the night side
    float limbGlow = pow(1.0 - max(dot(N, V), 0.0), 3.5) * darkFace;
    finalColor += vec3(0.45, 0.12, 0.02) * limbGlow * clamp(uThermalGlow * 2.0, 0.0, 1.0) * 0.15;
  }

  // ── FEATURE 5: Mid-ocean ridge hydrothermal vent emission ─────────────
  // Hydrothermal vents on dark side emit faint warm glow.
  if(isOcean && bIsRidge > 0.01) {
    float ridgeNe = fbm3(pos * uNoiseScale * 3.5 + uSeed + 650.0) * 0.5 + 0.5;
    float ridgeMaskE = smoothstep(0.28, 0.18, depth01) * smoothstep(0.18, 0.28, depth01)
                     * smoothstep(0.62, 0.72, ridgeNe) * bIsRidge;
    finalColor += vec3(0.22, 0.06, 0.01) * ridgeMaskE * darkFace * 0.08;
  }

  // ── FEATURE NEW-B: Resonance chain tidal heat ─────────────────
  // Compact TRAPPIST-1-style chains: tidal flexing from orbital resonances
  // pumps heat into the interior — inner chain members glow orange-red.
  if(uResonanceHeat > 0.01) {
    float resoN = fbm3(pos * uNoiseScale * 2.4 + uSeed + 777.0 + vec3(uTime*0.04, 0.0, 0.0));
    float resoGlow = smoothstep(0.45, 0.72, resoN) * uResonanceHeat;
    vec3  resoCol  = mix(vec3(0.70, 0.22, 0.06), vec3(1.0, 0.52, 0.12),
                         smoothstep(0.3, 0.7, resoN));
    // Visible as a global hot-spot network on both day and night sides
    finalColor += resoCol * resoGlow * 0.18;
    // Crack-channel bright seams where tidal stress fractures the crust
    float resoEdge = smoothstep(0.024, 0.002, provEdge);
    finalColor += vec3(1.0, 0.48, 0.08) * resoEdge * resoGlow * uResonanceHeat * 0.14;
  }

  // ── FEATURE 7: Tidal heating emission extensions ──────────────
  // 1. Tidal hotspot emission: uniform warm orange even on low-volcanism worlds
  if(uResonanceHeat > 0.20 && uVolcanism < 0.20) {
    vec3  hpTPos = pos * uNoiseScale * 3.2 + uSeed + vec3(191.0, 47.0, 113.0) + vec3(uTime*0.03, 0.0, 0.0);
    vec3  hpTI   = floor(hpTPos); vec3 hpTF = fract(hpTPos);
    float hpTF1  = 99.0;
    for(int hx=-1;hx<=1;hx++) for(int hy=-1;hy<=1;hy++) for(int hz=-1;hz<=1;hz++) {
      vec3 g = vec3(float(hx),float(hy),float(hz));
      vec3 o = fract(sin(vec3(
        dot(hpTI+g,vec3(127.1,311.7, 74.7)),
        dot(hpTI+g,vec3(269.5,183.3,246.1)),
        dot(hpTI+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
      float d = length(g+o-hpTF);
      if(d < hpTF1) hpTF1 = d;
    }
    float hpTHash = fract(sin(dot(hpTI,vec3(71.3,23.9,157.7)))*43758.5);
    float hpTSz   = mix(0.15, 0.28, hpTHash);
    float hpTGlow = smoothstep(hpTSz, hpTSz*0.18, hpTF1) * step(0.62, hpTHash);
    if(hpTGlow > 0.005) {
      float hpTDepth = 1.0 - hpTF1 / hpTSz;
      vec3  tidalLavaGlow = mix(vec3(0.55, 0.22, 0.02), vec3(0.88, 0.52, 0.08), hpTDepth);
      float hpTPulse = 0.60 + 0.40 * sin(uTime*(0.85+hpTHash*0.65) + hpTHash*6.28);
      finalColor += tidalLavaGlow * hpTGlow * hpTPulse * uResonanceHeat * 0.70 * darkFace * 0.50;
    }
  }

  // 2. Tidal ocean thermal flush: warm bioluminescent-red subsurface glow
  if(uResonanceHeat > 0.30 && isOcean) {
    float NdotL_night = clamp(1.0 - NdotL, 0.0, 1.0);
    float thermalFlush = NdotL_night * smoothstep(0.3, 0.8, uResonanceHeat);
    finalColor += vec3(0.45, 0.04, 0.02) * thermalFlush * uResonanceHeat * 0.35;
  }

  // 3. Tidal vent cracks: secondary seam pattern (cross-cutting fault network)
  if(uResonanceHeat > 0.50 && !isOcean) {
    float faultSeam = step(abs(sin(pos.x * 18.0 + uSeed)), 0.04);
    float faultN    = noise3D(pos * uNoiseScale * 5.5 + uSeed + vec3(uTime*0.03, 0.0, 0.0));
    finalColor += vec3(1.00, 0.42, 0.06) * faultSeam * smoothstep(0.55, 0.78, faultN)
                * uResonanceHeat * darkFace * 0.22;
  }

  // ── EMISSIVE WORLD EFFECTS ──────────────────────────────────
  // (darkFace / litFaceE declared above, before tidal heating block)

  // ── FEATURE 01: Night-side city lights (v2) ──────────────────
  // Metropolitan clusters: Voronoi defines city footprints.
  // Within each city: street-grid interference pattern + downtown core.
  // Three light types: orange sodium, white LED, cool industrial blue.
  // Highways: bright lines connecting metros (high-intensity corridors).
  if(!isOcean && uAtmThickness > 0.07 && uOceanLevel > 0.01 && uOceanLevel < 0.96) {
    // Metro-region Voronoi: coarse scale determines city location + size
    float msc = uNoiseScale * 2.2;
    vec3  mCell = floor(pos * msc + uSeed * 0.4 + vec3(88.0, 33.0, 55.0));
    vec3  mFrac = fract(pos * msc + uSeed * 0.4 + vec3(88.0, 33.0, 55.0));
    float mHash = fract(sin(dot(mCell, vec3(127.1,311.7,74.7)))*43758.5);
    float mSize = fract(sin(dot(mCell, vec3(269.5,183.3,246.1)))*43758.5);
    float mType = fract(sin(dot(mCell, vec3(71.3,23.9,157.7)))*43758.5);

    // ~22% of cells have cities; city size ranges small-town → megalopolis
    float hasCity = step(0.78, mHash);
    if(hasCity > 0.0) {
      // City center distance (Voronoi F1 in cell space)
      vec3 cellCtr = vec3(0.5) + (mSize - 0.5) * 0.3; // jitter center
      float cityDist = length(mFrac - cellCtr);
      float cityR = mix(0.08, 0.38, mSize);             // small→mega
      float cityMask = 1.0 - smoothstep(0.0, cityR, cityDist);

      if(cityMask > 0.005) {
        // Street grid: two sine-wave grids at slight angle → interference = grid dots
        float gsc = uNoiseScale * 32.0;
        vec3  gp  = pos * gsc + mCell * 0.3 + uSeed;
        float g1  = sin(gp.x * 6.283) * sin(gp.z * 6.283);
        float g2  = sin((gp.x + gp.z) * 4.443) * sin((gp.x - gp.z) * 4.443);
        float grid = max(smoothstep(0.78, 0.96, g1), smoothstep(0.80, 0.97, g2));

        // Highway lines: strong perpendicular corridors
        float hw1 = smoothstep(0.90, 0.98, abs(sin(gp.x * 1.571)));
        float hw2 = smoothstep(0.90, 0.98, abs(sin(gp.z * 1.571)));
        float highways = max(hw1, hw2) * 0.55;

        // Downtown core: dense central cluster
        float coreR = cityR * 0.22;
        float core  = (1.0 - smoothstep(0.0, coreR, cityDist)) * 1.60;

        // Suburb scatter: isolated lights between grid intersections
        float subN = fract(sin(dot(floor(pos * gsc * 0.5 + uSeed * 3.7), vec3(37.1,91.7,53.3)))*43758.5);
        float suburb = step(0.82, subN) * smoothstep(cityR*0.45, 0.0, cityDist) * 0.25;

        // Light color: warm sodium orange ↔ cool LED white ↔ industrial blue
        vec3 lightCol;
        if(mType < 0.40)      lightCol = vec3(1.00, 0.72, 0.28); // sodium orange (old city)
        else if(mType < 0.72) lightCol = vec3(0.90, 0.94, 1.00); // cool LED white (modern)
        else                  lightCol = mix(vec3(0.48, 0.70, 1.00), vec3(1.00, 0.55, 0.22), 0.35); // mixed

        float totalCity = (grid * 0.65 + highways + core + suburb) * cityMask;
        finalColor += lightCol * totalCity * darkFace * 0.17;

        // Core sky glow: upward light pollution bloom on large cities
        float lglow = cityMask * mSize * (1.0 - smoothstep(0.0, cityR*0.5, cityDist));
        finalColor += lightCol * lglow * darkFace * 0.06;
      }
    }
  }

  // ── FEATURE 02: Ocean bioluminescence ────────────────────────
  // Ocean worlds: dark side emits blue-green bio-light. Driven by fbm patches.
  if(isOcean && uOceanLevel > 0.22) {
    float bioN = fbm3(pos*7.5 + uSeed + vec3(0.0, uTime*0.20, 0.0));
    float bioPat = smoothstep(0.52, 0.75, bioN) * (1.0 - smoothstep(0.0, 0.65, depth01));
    vec3 bioCol = mix(vec3(0.08,0.42,0.28), vec3(0.12,0.65,0.82), bioPat);
    finalColor += bioCol * bioPat * darkFace * 0.060;

    // ── FEATURE 07b: Surface phosphorescence (wave crests)
    float shimN = noise3D(pos*22.0 + uSeed + vec3(uTime*2.0, 0, 0));
    float shimmer = smoothstep(0.70, 0.92, shimN) * (1.0-depth01) * 0.40;
    finalColor += vec3(0.18,0.52,0.58) * shimmer * litFaceE * 0.036;
  }

  // ── FEATURE 03: Cryovolcanic plumes ──────────────────────────
  // Icy bodies with active geology: bright geyser-like eruption columns.
  if(uIsIceWorld > 0.5 && uVolcanism > 0.008) {
    vec3 cpI = floor(pos * uNoiseScale * 3.0 + uSeed + 700.0);
    float cpCell = fract(sin(dot(cpI, vec3(37.1,127.9,91.3)))*43758.5);
    float cpR    = fract(sin(dot(cpI, vec3(71.3, 23.9,157.7)))*43758.5);
    float cpZone = zoneCharAdj.y;   // rough zones host more vents
    float cpStr  = step(0.74, cpCell) * uVolcanism * (0.5 + cpZone*0.5);
    vec3  cpCol  = mix(vec3(0.92,0.96,1.00), vec3(0.68,0.82,1.00), cpR);
    finalColor += cpCol * cpStr * litFaceE * 0.070;
  }

  // ── FEATURE 04: Geothermal hot spring fields ─────────────────
  // Bright warm patches at zone boundaries where fluids circulate.
  if(uVolcanism > 0.02 && !isOcean && globalIce < 0.5) {
    float geoEdge = smoothstep(0.022, 0.003, provEdge);
    float geoN    = noise3D(pos*uNoiseScale*3.5 + uSeed + 800.0);
    float geoStr  = geoEdge * smoothstep(0.55, 0.78, geoN) * uVolcanism * 0.60;
    finalColor += mix(vec3(0.55,0.22,0.06), vec3(0.82,0.42,0.12), geoN)
                * geoStr * litFaceE * 0.038;
  }

  // ── FEATURE NEW-VOLC: Night-side volcanic hotspot glow ───────────────────
  // High-volcanism worlds show scattered lava-lake / caldera emission on the
  // dark hemisphere. Uses a coarser Voronoi hotspot field (different seed from
  // the dayside boulder / crater passes so it doesn't spatially coincide).
  if(uVolcanism > 0.30 && !isOcean && globalIce < 0.40) {
    vec3  hpPos = pos * uNoiseScale * 3.2 + uSeed + vec3(191.0, 47.0, 113.0);
    vec3  hpI   = floor(hpPos); vec3 hpF = fract(hpPos);
    float hpF1  = 99.0;
    for(int hx=-1;hx<=1;hx++) for(int hy=-1;hy<=1;hy++) for(int hz=-1;hz<=1;hz++) {
      vec3 g = vec3(float(hx),float(hy),float(hz));
      vec3 o = fract(sin(vec3(
        dot(hpI+g,vec3(127.1,311.7, 74.7)),
        dot(hpI+g,vec3(269.5,183.3,246.1)),
        dot(hpI+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
      float d = length(g+o-hpF);
      if(d < hpF1) hpF1 = d;
    }
    float hpHash = fract(sin(dot(hpI,vec3(71.3,23.9,157.7)))*43758.5);
    float hpSz   = mix(0.15, 0.28, hpHash);
    float hpGlow = smoothstep(hpSz, hpSz*0.18, hpF1) * step(0.62, hpHash);
    if(hpGlow > 0.005) {
      float hpPulse = 0.60 + 0.40 * sin(uTime*(0.85+hpHash*0.65) + hpHash*6.28);
      float hpDepth = 1.0 - hpF1 / hpSz;
      vec3  lavaGlow = mix(
        vec3(0.55,0.08,0.01),
        mix(vec3(0.95,0.38,0.04), vec3(1.00,0.82,0.30), pow(hpDepth,2.0)),
        pow(hpDepth,0.7)
      );
      finalColor += lavaGlow * hpGlow * hpPulse * darkFace * clamp(uVolcanism*1.4,0.0,1.0) * 0.55;
    }
    // Linear seam-vents along zone boundaries
    float ventEdge = smoothstep(0.018,0.002,provEdge);
    float ventN    = noise3D(pos*uNoiseScale*5.5+uSeed+vec3(uTime*0.04,0.0,0.0));
    finalColor += vec3(1.00,0.42,0.06) * ventEdge * smoothstep(0.55,0.78,ventN)
                * darkFace * uVolcanism * 0.20;
  }

  // ── FEATURE 05: Cold rogue-planet thermal glow ────────────────
  // Very cold, airless, icy → faint cryogenic IR glow on night side.
  if(uIsIceWorld > 0.5 && uAtmThickness < 0.04 && uVolcanism < 0.01) {
    finalColor += vec3(0.04,0.10,0.26) * darkFace * 0.025;
  }

  // ── 10. ATMOSPHERE RIM ─────────────────────────────────────
  if(uAtmThickness > 0.14) {
    float aF = smoothstep(0.14,0.32,uAtmThickness);
    float dT = smoothstep(-0.12,0.28,dot(N,L));
    float sL = smoothstep(0.55,0.92,rim);

    // Rayleigh tint from stellar spectrum: blends the default scattering hue
    // with the star's color. M-dwarf → mauve sky; A-star → pale azure; G → Earth blue.
    vec3 rayleighBase = mix(vec3(0.22,0.52,1.0), uRayleighColor * 2.0, 0.45);
    vec3 rC = uAtmColor * rayleighBase;

    float dR = pow(rim,3.5)*uAtmThickness*dT*sL*aF;
    finalColor = mix(finalColor,finalColor*(vec3(1.0)+rC*0.28),dR*0.45);
    float aer = pow(rim,3.0)*uAtmThickness*dT*sL*0.09*aF;
    finalColor = mix(finalColor,finalColor*(uAtmColor*0.5+0.55),aer);
    float tA=dot(N,L)+0.03, tG=exp(-tA*tA/0.028)*uAtmThickness*aF;

    // Terminator golden-hour band — tinted by star color for realism
    // (G-star → warm gold, M-star → deep orange-red, A-star → cool lavender)
    vec3 goldenHour = mix(vec3(1.38,0.72,0.28), uStarColor * vec3(1.4,0.85,0.30), 0.35);
    finalColor *= mix(vec3(1.0), goldenHour, tG*sL*0.58);
    finalColor += vec3(1.0,0.38,0.08)*uStarColor*exp(-pow(tA*8.5,2.0))*max(0.0,uAtmThickness-0.28)*aF*sL*0.20;
    if(uAtmThickness>0.28)
      finalColor+=(uAtmColor*1.45+vec3(0.05,0.03,0.0))*
                  pow(rim,1.8)*exp(-pow(dot(N,L)+0.56,2.0)/0.010)*uAtmThickness*aF*0.26;
  }

  // ── FEATURE NEW-C: Stratospheric haze banding ─────────────────────
  // High-altitude photochemical haze (Titan-like, sulfuric aerosols, ammonia).
  // Adds altitude-stratified layers: base haze + photochemical smog band + terminator scatter.
  if(uHazeHeight > 0.01 && uAtmThickness > 0.10) {
    float hazeRim = pow(rim, mix(3.5, 1.8, uHazeHeight));
    float hazeD   = smoothstep(0.0, 0.55, dot(N,L) + 0.15);
    vec3  hazeC   = mix(uAtmColor * 0.55 + vec3(0.22), uHazeColor, 0.60);
    // Base haze layer — blends uHazeColor into the limb rim weighted by uHazeHeight
    finalColor += hazeC * hazeRim * uHazeHeight * hazeD * 0.20;
    // Secondary photochemical smog band — slightly yellow-orange tint above the base layer
    // Appears at a higher rim exponent (tighter band) so it sits above the main haze
    float hazeRim2 = pow(rim, mix(4.2, 2.2, uHazeHeight * 0.8));
    vec3  smogTint = hazeC * vec3(1.12, 1.06, 0.72);  // warm yellow-orange photochemical shift
    finalColor += smogTint * hazeRim2 * uHazeHeight * 0.55 * hazeD * 0.10;
    // Terminator scatter enhancement — haze intensifies where sunlight rakes at shallow angle
    // cos(angle) near zero = terminator, so (1 - abs(NdotL_raw)) peaks there
    float NdotL_raw = dot(N, L);
    float termScatter = 1.0 - abs(NdotL_raw);
    termScatter = pow(clamp(termScatter, 0.0, 1.0), 2.2);
    finalColor += uHazeColor * hazeRim * termScatter * uHazeHeight * 0.28 * uAtmThickness;

    // ── FEATURE 4 additions: Stratospheric UV-absorber band ──────────────
    // Slightly higher altitude, sharper limb exponent (pow 6.0), desaturated purple-grey
    float stratRim = pow(rim, 6.0);
    vec3  stratColor = uHazeColor * 0.6 + vec3(0.05, 0.02, 0.08);
    finalColor += stratColor * stratRim * uHazeHeight * 0.25 * hazeD;

    // ── FEATURE 4: Mesospheric noctilucent layer — terminator only ────────
    // Very high altitude, only visible at the terminator (abs(NdotL) < 0.20)
    float noctGate = 1.0 - smoothstep(0.0, 0.20, abs(NdotL_raw));
    float noctRim  = pow(rim, 5.0);
    finalColor += vec3(0.78, 0.86, 0.98) * noctRim * noctGate
                * 0.12 * uHazeHeight * uAtmThickness;

    // ── FEATURE 4: Limb colour deepening — longer path through haze ───────
    float limbRed = pow(rim, 9.0) * uHazeHeight * uAtmThickness;
    finalColor += (uHazeColor * 1.3 + vec3(0.08, 0.04, 0.0)) * limbRed * 0.18;
  }

  // ── FEATURE NEW-D: Multiple scattering approximation ─────────────────
  // Thick atmospheres forward-scatter sunlight into the shadow side — the sky
  // doesn't go instantly black at the terminator. This approximates that brightening
  // by adding a Rayleigh-colored fill that rises on the night-side near the terminator.
  if(uAtmThickness > 0.28) {
    float msStr = (uAtmThickness - 0.28) * 1.4;
    // Forward scatter peaks just past the terminator
    float msAngle = dot(N, L);
    float msFwd  = exp(-pow((msAngle + 0.55) * 4.0, 2.0)) * msStr;
    float msSide = smoothstep(-0.40, 0.10, msAngle) * (1.0 - smoothstep(0.10, 0.55, msAngle));
    vec3  msCol  = mix(uRayleighColor * 0.6, uAtmColor * 0.45, 0.4);
    finalColor += msCol * (msFwd * 0.12 + msSide * 0.06 * msStr);
  }

  // ── FEATURE NEW-E: Terminator atmospheric thickness gradient ─────────
  // The atmosphere appears progressively thicker near the terminator as you look
  // through an increasingly long column of air — crescent worlds show bright limbs.
  if(uAtmThickness > 0.18) {
    float limb80 = pow(rim, 4.5);
    float sunSide = smoothstep(-0.25, 0.45, dot(N, L));
    // Bright crescent: high-rim on the day side only
    finalColor += uAtmColor * 0.55 * limb80 * sunSide * uAtmThickness * 0.18;
    // Night-side limb crescent — faint scattered light
    float nightLimb = pow(rim, 5.5) * max(0.0, -dot(N, L) + 0.05);
    finalColor += uRayleighColor * 0.35 * nightLimb * uAtmThickness * 0.12;
  }

  // ── FEATURE NEW-F2: Terminator corona ──────────────────────────────────
  // The terminator line glows warm orange-red as sunlight refracts through the
  // atmosphere column. Thicker the atmosphere, wider and more intense the ring.
  if(uAtmThickness > 0.06) {
    float NdotL_raw = dot(N, L);
    // Narrow Gaussian spike centred on NdotL≈0 (the terminator line)
    float coronaBand = exp(-pow(NdotL_raw * (12.0 - uAtmThickness * 8.0), 2.0));
    // Strongest on the limb (rim=1): column path-length is longest there
    float coronaLimb = pow(rim, 1.8);
    // Color: orange on thin/dry worlds, more golden/amber on thick atmospheres
    vec3 coronaCol = mix(
      vec3(1.00, 0.48, 0.14),   // thin: orange-red
      vec3(1.00, 0.72, 0.28),   // thick: amber-gold (scattering shifts it)
      smoothstep(0.15, 0.65, uAtmThickness)
    );
    // Star-tinted: M-dwarf terminator is deep crimson, A-star is cool white-gold
    coronaCol = mix(coronaCol, coronaCol * uStarColor * 1.15, 0.30);
    float coronaStr = uAtmThickness * (0.28 + uAtmThickness * 0.35);
    finalColor += coronaCol * coronaBand * coronaLimb * coronaStr;
  }

  // ── #17 Second-sun limb tint (circumbinary) ───────────────────────────
  // When a second star is present, the atmosphere rim takes on a blend of both
  // star colours — the limb facing each star glows with that star's spectral hue.
  if(uSunBrightness2 > 0.01 && uAtmThickness > 0.06) {
    float limb2 = pow(rim, 3.5);
    float side1 = smoothstep(-0.20, 0.50, dot(N, L));
    float side2 = smoothstep(-0.20, 0.50, dot(N, L2));
    finalColor += uStarColor  * limb2 * side1 * uSunBrightness  * uAtmThickness * 0.10;
    finalColor += uStarColor2 * limb2 * side2 * uSunBrightness2 * uAtmThickness * 0.10;
  }

  // ── FEATURE NEW-F: USP night-side cold rock darkening ────────────────
  // No atmosphere = zero heat redistribution. The night side of a USP rock is
  // near absolute zero — cold basalt is darker than warm basalt. Darkens the
  // night hemisphere so the thermal glow contrast is maximised.
  if(uThermalGlow > 0.05 && !isOcean) {
    float nightRock = max(0.0, -(dot(N, L) + 0.08));
    finalColor *= mix(1.0, 0.55, nightRock * uThermalGlow * 0.85);
    // Plus very faint dark-reddish IR glow from residual rock heat
    finalColor += vec3(0.06, 0.01, 0.0) * nightRock * uThermalGlow * 0.10;
  }

  // ── FEATURE 4: Terminator Quality — Belt of Venus, Anti-twilight Arch, Terminator Glow ──
  // Three additive colour contributions near the terminator (|NdotL| < ~0.25).
  // All guarded by uAtmThickness > 0.05.
  if(uAtmThickness > 0.05) {
    // Belt of Venus: warm pink/purple band on dayside just above the shadow
    // Narrow band centred on NdotL ≈ 0.14 (dayside approaching terminator)
    float bov = smoothstep(0.0, 0.18, NdotL) * smoothstep(0.22, 0.06, NdotL);
    finalColor += vec3(0.85, 0.52, 0.68) * bov * 0.35 * uAtmThickness;

    // Anti-twilight arch: blue shadow rising above horizon from night side
    // Earth's shadow on its own atmosphere — just below Belt of Venus
    float ata = smoothstep(-0.12, 0.04, NdotL) * smoothstep(0.08, -0.06, NdotL);
    finalColor += vec3(0.22, 0.32, 0.55) * ata * 0.28 * uAtmThickness;

    // Terminator glow: thin atmosphere glows warm orange-red just past terminator
    // Refracted sunlight stronger at limb (grazing angle)
    float tGlow = smoothstep(-0.15, -0.02, NdotL) * smoothstep(0.0, -0.12, NdotL);
    float isLimb = 1.0 - abs(dot(N, V));
    finalColor += vec3(0.95, 0.55, 0.22) * tGlow * isLimb * 0.22 * uAtmThickness;
  }

  // ── 11. AURORA ─────────────────────────────────────────────
  // Particle precipitation along magnetic field lines creates curtain arcs
  // at 65-80° magnetic latitude. Green lower (557.7 nm O), red/violet upper.
  // Fires on any world with atmosphere > 0.10; uAuroraStrength amplifies it.
  float auroraBase  = step(0.10, uAtmThickness);
  float auroraTotal = clamp(auroraBase + uAuroraStrength * 2.0, 0.0, 2.0);
  if(auroraTotal > 0.01) {
    float ovalExpand = uAuroraStrength * 0.22;
    float aZ = smoothstep(0.68 - ovalExpand, 0.78 - ovalExpand * 0.5, absLat)
             * (1.0 - smoothstep(0.90, 0.98, absLat));
    if(aZ > 0.01) {
      float aLon = atan(pos.z, pos.x);
      // Three-harmonic curtain: bright ray peaks with dark gaps between them
      float cur = sin(aLon * 7.0  + uTime * 0.55 + uSeed * 3.1) * 0.5 + 0.5;
      cur      *= sin(aLon * 11.0 + uTime * 0.28 + uSeed * 7.3) * 0.35 + 0.65;
      cur      *= sin(aLon * 19.0 + uTime * 0.14 + uSeed * 2.7) * 0.20 + 0.80;
      float rays = pow(cur, 2.2);  // sharpen peaks, deepen gaps
      // Altitude shimmer: fine-scale vertical flicker
      float shim = noise3D(pos*18.0 + vec3(aLon*3.0, uTime*3.5, uSeed*10.0)) * 0.5 + 0.5;
      float vertFlicker = smoothstep(0.25, 0.70, shim);
      // Night-side gate: strongest on dark side, fades through twilight
      float ns = 1.0 - smoothstep(-0.10, 0.22, NdotL);
      // Altitude-based colour: green at base, red mid, violet apex
      float af        = smoothstep(0.70, 0.96, absLat);
      vec3 greenBand  = vec3(0.08, 0.92, 0.22);   // 557.7 nm O green
      vec3 redBand    = vec3(0.88, 0.12, 0.06);   // 630 nm O red
      vec3 violetBand = vec3(0.44, 0.08, 0.82);   // N₂ violet
      vec3 defaultAC  = mix(
        mix(greenBand, redBand,    smoothstep(0.0, 0.55, af)),
        violetBand,                smoothstep(0.55, 1.0, af)
      );
      float hasProfileColor = step(0.01, dot(uAuroraColor, vec3(1.0)));
      vec3 aC = mix(defaultAC, uAuroraColor, hasProfileColor);
      float baseStr = 0.09 + uAuroraStrength * 0.18;
      // Soft diffuse oval glow (always present in the band)
      finalColor += aC * aZ * (0.30 + shim * 0.35) * ns
                  * baseStr * 0.45 * uAtmThickness * auroraTotal;
      // Bright curtain rays
      finalColor += aC * aZ * rays * vertFlicker * ns
                  * baseStr * uAtmThickness * auroraTotal;
    }
  }

  // ── FEATURE 11: Ice subsurface scattering ────────────────────
  // Blue light penetrates into and refracts through ice layers.
  // SSS wrap-around glow + edge translucency — strengthened for realism.
  if(uIsIceWorld > 0.5 && globalIce > 0.08) {
    float sssDot = max(dot(normalize(-L + N*1.5), V), 0.0);
    float sssWrap = pow(sssDot, 3.5) * globalIce;
    // Deep glacier core: pure blue-violet (400-450nm dominant)
    // Shallow ice fringe: blue-green (ice Brewster angle scatter)
    float iceDepthFactor = smoothstep(0.15, 0.85, globalIce);
    vec3 deepIceSSS  = vec3(0.04, 0.14, 0.55);  // deep blue-violet
    vec3 shallowSSS  = vec3(0.10, 0.34, 0.52);  // blue-green fringe
    vec3 sssCol = mix(shallowSSS, deepIceSSS, iceDepthFactor);
    finalColor += sssCol * sssWrap * 0.42 * litFaceE;            // was 0.26
    // Edge translucency — glacier walls catch transmitted light
    float iceEdgeT = globalIce * (1.0-smoothstep(0.28, 0.72, globalIce));
    finalColor += mix(vec3(0.12,0.32,0.58), vec3(0.06,0.18,0.50), iceDepthFactor)
                * iceEdgeT * pow(rim, 2.5) * 0.30;               // was 0.22
    // Chromatic dispersion at grazing angles — slight red-blue separation
    float dispRim = pow(rim, 4.0) * globalIce * litFaceE;
    finalColor += vec3(0.0, 0.04, 0.12) * dispRim * 0.18;
  }

  // ── FEATURE 12: Dust storm atmosphere ────────────────────────
  // Arid worlds: suspended dust browns the limb and reddish-tints lit side.
  if(uOceanLevel < 0.06 && uAtmThickness > 0.04 && uAtmThickness < 0.65) {
    float dustN = fbm3(pos*2.2 + uSeed + vec3(uTime*0.06, 0.0, 0.0));
    float dustH = smoothstep(0.40, 0.65, dustN) * uAtmThickness * 1.6;
    float dustLimb = pow(rim, 2.2) * dustH * 0.65 * smoothstep(-0.1, 0.3, NdotL);
    finalColor *= mix(vec3(1.0), uAtmColor*1.3 + vec3(0.20,0.07,-0.04), dustH*0.42);
    finalColor  = mix(finalColor, finalColor*(uAtmColor*0.7+vec3(0.16,0.05,0.0)), dustLimb);
  }

  // ── FEATURE 13: Atmospheric diffraction halo ─────────────────
  // Near the terminator: sunlight splits into spectral halo (glory ring).
  if(uAtmThickness > 0.18) {
    float sunGraze = dot(N, L) + 0.02;
    float diffW = exp(-sunGraze*sunGraze / 0.005) * uAtmThickness;
    if(diffW > 0.01) {
      float dl = pow(rim, 2.2) * diffW;
      finalColor += vec3(0.22, 0.04, 0.01) * dl * 0.09;
      finalColor += vec3(0.02, 0.14, 0.02) * dl * 0.07;
      finalColor += vec3(0.01, 0.05, 0.24) * dl * 0.11;
    }
  }

  // FEATURE 14: Polar vortex cloud brightening — REMOVED (latitude-based flat-top cap)

  // ── FEATURE 15: Active storm system ──────────────────────────
  // Uses existing uStorm uniforms to show a dynamic storm region.
  if(uStormIntensity > 0.01 && uAtmThickness > 0.04) {
    vec3 sCent = vec3(cos(uStormLon)*cos(uStormLat), sin(uStormLat),
                      sin(uStormLon)*cos(uStormLat));
    float sDist = length(pos - sCent);
    float sMask = (1.0-smoothstep(0.0, uStormSize, sDist)) * uStormIntensity;
    if(sMask > 0.005) {
      float sAng  = atan(pos.z-sCent.z, pos.x-sCent.x);
      float sSwirl= sin(sAng*3.0 + sDist*22.0 - uTime*0.45)*0.5+0.5;
      float sN    = fbm3(pos*6.0+uSeed+vec3(uTime*0.08,0,0));
      vec3  sCol  = mix(uAtmColor*0.5+0.55, vec3(0.88,0.92,0.96), sSwirl*0.6);
      finalColor  = mix(finalColor, finalColor*0.85 + sCol*0.18,
                        sMask*smoothstep(-0.1,0.35,NdotL)*0.70);
    }
  }

  // ── FEATURE 28: Cloud shadow dappling ────────────────────────
  // Animated low-frequency cloud shadows dapple the lit surface.
  // Parallax: shadow offset toward antisolar direction (clouds float above surface).
  if(uCloudDensity > 0.06 && uAtmThickness > 0.06) {
    // Parallax shift: cloud deck altitude pushes shadow antisunward
    // Altitude factor: ~0.02 unit offset for thick atmosphere (60km cloud deck)
    float cloudAlt  = uAtmThickness * 0.018;
    vec3  shadowPos  = normalize(pos - L * cloudAlt);
    float cshN = fbm3(shadowPos*1.80 + uSeed + vec3(uTime*0.018, 0.0, uTime*0.011));
    float cshad = smoothstep(0.58, 0.72, cshN) * uCloudDensity * 0.42;
    finalColor *= mix(1.0, 0.76, cshad * smoothstep(-0.1, 0.35, NdotL));
  }

  // ── Atmospheric cloud layer ──────────────────────────────
  // Circulation-aware: ITCZ / subtropical / storm-track / polar bands.
  // Domain-warped FBM breaks oval blobs — see features/clouds.ts.
  applyClouds(finalColor, pos, N, L, NdotL);

  // ── FEATURE STORM: Storm systems ─────────────────────────────
  // Large tropical cyclone / great-spot vortex centred at (uStormLat, uStormLon).
  // Called after cloud compositing, before aurora. Guard inside function.
  if(uIsGas < 0.5) {
    applyStorms(finalColor, pos, N, L, NdotL, isOcean);
  }

  // ── FEATURE 29: Cooling lava crust dark lines ─────────────────
  // Moderately volcanic worlds: basalt cooling-crack networks between
  // faintly glowing channels. Not as extreme as full lava worlds.
  if(uVolcanism > 0.25 && uEmissive < 0.12 && !isOcean) {
    float crustN = fbm3(pos*uNoiseScale*3.5 + uSeed + 850.0);
    float crustE = smoothstep(0.60, 0.78, crustN) * uVolcanism * (1.0-globalIce);
    finalColor = mix(finalColor, finalColor*0.52 + vec3(0.04,0.02,0.01), crustE*0.28);
    float crackGlow = smoothstep(0.78, 0.86, crustN) * uVolcanism;
    finalColor += vec3(0.65,0.22,0.04) * crackGlow * (1.0-terminator) * 0.08;
  }

  // ── FEATURE 30: Terminator cloud band ────────────────────────
  // Tidally-locked worlds accumulate thick cloud wall at the terminator.
  if(uTidallyLocked > 0.5 && uCloudDensity > 0.05 && uAtmThickness > 0.08) {
    float tBand = exp(-pow(dot(N,L)*8.0, 2.0));
    float tcN   = fbm3(pos*3.5 + uSeed + vec3(uTime*0.022, 0.0, 0.0));
    float tCld  = tBand * smoothstep(0.42, 0.60, tcN) * uCloudDensity * uAtmThickness * 1.8;
    finalColor = mix(finalColor,
                     finalColor*0.88 + vec3(0.55,0.60,0.68)*0.25,
                     tCld * 0.50);
  }

  // ── FEATURE 31: Subsurface ocean luminous seep ───────────────
  // Icy worlds with internal oceans: faint blue light bleeds through cracks.
  if(uIsIceWorld > 0.5 && uOceanLevel > 0.02 && globalIce > 0.20) {
    float seepN = abs(noise3D(pos*uNoiseScale*3.5 + uSeed + 420.0)*2.0-1.0);
    float seepStr = smoothstep(0.0, 0.08, seepN) * globalIce * uOceanLevel * 0.55;
    finalColor += vec3(0.10,0.28,0.55) * seepStr * 0.055;
  }


  // ── FEATURE 33: Stellar UV surface darkening ──────────────────
  // Thin-atmosphere worlds face unfiltered UV on the day side.
  // Organic-rich materials darken; mineral surfaces are less affected.
  if(uAtmThickness > 0.02 && uAtmThickness < 0.30 && uOceanLevel < 0.55) {
    float uvFacing = max(0.0, dot(N, L));
    float uvDark   = pow(uvFacing, 2.2) * (0.20 - uAtmThickness) * 4.0;
    finalColor *= mix(1.0, 0.84, clamp(uvDark, 0.0, 0.28));
  }

  // ── FEATURE 34: Snow high-albedo specular boost ───────────────
  // Fresh snow / global ice: bright forward-scatter specular.
  if(globalIce > 0.05 || uIsIceWorld > 0.5) {
    float snowSpec = pow(max(dot(bumpN, H), 0.0), 80.0) * NdotL * 0.35;
    float snowAlb  = clamp(mix(0.0, 0.65, globalIce)
                         + (uIsIceWorld > 0.5 ? 0.25 : 0.0), 0.0, 0.8);
    finalColor += vec3(1.0,0.98,0.96) * snowSpec * snowAlb * terminator;
  }

  // ── FEATURE 35: Aurora latitude expansion ─────────────────────
  // Highly active tectonics → strong magnetic field → aurora extends
  // further toward the equator, expanding the auroral oval.
  if(uAtmThickness > 0.18 && uTectonics > 0.45) {
    float expF = clamp((uTectonics - 0.45) * 2.5, 0.0, 1.0);
    float exAZ = smoothstep(0.55 - expF*0.15, 0.72, absLat)
               * (1.0-smoothstep(0.88, 0.97, absLat));
    if(exAZ > 0.01) {
      float exALon  = atan(pos.z, pos.x);
      float exAcur  = sin(exALon*5.0 + uTime*0.50 + uSeed*4.5)*0.5+0.5;
      float exAshim = smoothstep(0.3, 0.7, noise3D(pos*18.0+vec3(0.0,uTime*2.0,uSeed*8.0)));
      float exAns   = 1.0-smoothstep(-0.05, 0.20, NdotL);
      vec3  exAC    = mix(vec3(0.2,0.7,0.9), vec3(0.8,0.2,0.6), expF);
      finalColor += exAC * exAZ * exAcur * exAshim * exAns * 0.06 * uAtmThickness;
    }
  }

  // ── FEATURE 55: Cloud underbelly dark layer ──────────────────
  // Looking at the cloud deck from below (near limb) shows the dark grey
  // underside — creates a two-tone cloud appearance with depth.
  if(uCloudDensity > 0.12 && uAtmThickness > 0.10) {
    float bellyN = fbm3(pos*2.0 + uSeed + vec3(uTime*0.014, 0.0, 0.0));
    float belly  = smoothstep(0.52, 0.70, bellyN) * uCloudDensity
                 * pow(rim, 1.8) * (1.0-smoothstep(0.0, 0.5, NdotL));
    finalColor = mix(finalColor, finalColor*0.62 + vec3(0.05,0.07,0.10)*0.28, belly * 0.42);
  }

  // ── FEATURE 56: High stratospheric haze ──────────────────────
  // Thin high-altitude haze layer brightens the limb above the cloud deck.
  // Visible as a bright diffuse band above the planet rim.
  if(uAtmThickness > 0.22 && uOceanLevel > 0.25) {
    float hazeH = smoothstep(0.0, 0.80, rim) * uAtmThickness * 0.45;
    finalColor += vec3(0.14,0.20,0.40) * hazeH * smoothstep(0.0, 0.55, dot(N,L)+0.1) * 0.09;
  }

  // ── FEATURE 57: Ocean atmospheric column (blue depth) ─────────
  // The atmosphere appears deeper blue over open ocean due to increased
  // Rayleigh scattering over the water column.
  if(isOcean && uAtmThickness > 0.10) {
    float oceanBlue = depth01 * uAtmThickness * 0.38
                    * smoothstep(0.0, 0.45, NdotL);
    finalColor = mix(finalColor, finalColor * vec3(0.80,0.90,1.14), oceanBlue * 0.24);
  }

  // ── FEATURE 58: Tropical convection towers ───────────────────
  // Deep cumulonimbus plumes over warm equatorial ocean — bright white
  // vertical towers visible from orbit as discrete bright cells.
  if(uCloudDensity > 0.14 && uAtmThickness > 0.12 && uOceanLevel > 0.22) {
    float tropLat = clamp(1.0-absLat*2.8, 0.0, 1.0);
    vec3  tcI     = floor(pos*uNoiseScale*3.5+uSeed+1100.0);
    float tcC     = fract(sin(dot(tcI, vec3( 71.3,157.9, 93.5)))*43758.5);
    float tcH     = fract(sin(dot(tcI, vec3(127.1,311.7, 74.7)))*43758.5);
    float tower   = step(0.80, tcC) * uCloudDensity * tropLat;
    vec3  twrC    = mix(vec3(0.72,0.78,0.88), vec3(0.92,0.95,0.98), tcH);
    finalColor = mix(finalColor, finalColor*0.86 + twrC*0.22,
                     tower * smoothstep(0.1,0.5,NdotL) * 0.38);
  }

  // FEATURE 59: Polar cloud streets — REMOVED (latitude-based flat-top cap)

  // ── FEATURE 60: Lightning flash ───────────────────────────────
  // Rare bright impulse inside active storm cells.
  // Quantised time floor gives a crisp flash rather than a gradient.
  if(uStormIntensity > 0.28 && uAtmThickness > 0.08 && uStormSize > 0.0) {
    float ltR = fract(sin(floor(uTime*4.0)+uSeed*137.0)*43758.5);
    if(ltR > 0.93) {
      vec3  stC = vec3(cos(uStormLon)*cos(uStormLat), sin(uStormLat),
                       sin(uStormLon)*cos(uStormLat));
      float ltDist = length(pos - stC);
      vec3  ltI    = floor(pos*8.0+uSeed+200.0);
      float ltCell = fract(sin(dot(ltI,vec3(127.1,311.7,74.7)))*43758.5);
      float lt = step(0.90, ltCell) * (1.0-smoothstep(0.0, uStormSize*1.3, ltDist));
      finalColor += vec3(0.78,0.84,1.00) * lt * (1.0-darkFace) * 0.70;
    }
  }

  // Desert heat tint
  if(uOceanLevel<0.08&&uAtmThickness>0.04&&uAtmThickness<0.55)
    finalColor+=vec3(0.14,0.06,0.01)*(1.0-terminator)*(1.0-uOceanLevel*12.0)*0.11;

  // Airless opposition surge
  if(uAtmThickness<0.04&&uOceanLevel<0.04)
    finalColor+=color*pow(max(dot(V,L),0.0),14.0)*0.38*terminator;

  // Night floor
  finalColor = max(finalColor, vec3(0.004,0.004,0.006));

  // ── 12. PROVINCE BORDERS ───────────────────────────────────
  // Toggled by uShowBorders uniform (0 = hidden, 1 = visible).
  // Border lines use slight sun-shading so they read as terrain edges on lit side.
  // Suppressed in deep ocean — seabed zone seams read as artifacts through water.
  if(uBiomeCount > 0.5 && uShowBorders > 0.5) {
    // Ocean: fade borders out in water deeper than a shallow threshold
    float borderOceanFade = isOcean ? (1.0 - smoothstep(0.02, 0.18, depth01)) : 1.0;
    float border    = smoothstep(0.015, 0.001, provEdge) * borderOceanFade;
    float borderLit = smoothstep(-0.12, 0.25, dot(N,L))*0.45 + 0.55;
    finalColor *= mix(1.0, 0.52, border*borderLit);
    float scarp = smoothstep(0.015,0.006,provEdge)*(1.0-smoothstep(0.006,0.001,provEdge));
    finalColor += vec3(0.25,0.32,0.42)*scarp*0.14*borderLit*borderOceanFade;
  }

  // ── 13. ZONE SELECTION — EMISSIVE REGION HIGHLIGHT ─────────
  // Always glows regardless of sun angle — visible on night side too.
  // Animated pulse on the border glow for clear feedback.
  if(uBiomeCount > 0.5 && bZone >= 0 && float(bZone) == uSelectedZone) {
    float distToEdge = smoothstep(0.0, 0.028, provEdge);
    float borderGlow = smoothstep(0.028, 0.0, provEdge);
    float pulse      = 0.65 + 0.35 * uPickStrength;
    // Interior fill: always-on blue-white overlay (emissive, not lit)
    finalColor = mix(finalColor, finalColor + vec3(0.10,0.38,0.78)*0.20, distToEdge*0.70);
    // Border edge: bright emissive accent — visible on dark side
    finalColor += vec3(0.20, 0.55, 1.00) * borderGlow * pulse * 0.55;
  }

  // ── 14. SCIENCE OVERLAYS ───────────────────────────────────
  if(uShowTempMap > 0.5) {
    float sT=mix(uPolarTemp,uEquatorTemp,1.0-absLat);
    if(uTidallyLocked>0.5) sT=mix(uAntistellarTemp,uSubstellarTemp,dot(pos,L)*0.5+0.5);
    vec3 tC=sT<273.0?mix(vec3(0,0,1),vec3(0,1,1),sT/273.0)
           :sT<373.0?mix(vec3(0,1,0),vec3(1,1,0),(sT-273.0)/100.0)
           :mix(vec3(1,0.5,0),vec3(1,0,0),min((sT-373.0)/500.0,1.0));
    finalColor=mix(finalColor,tC*(0.35+dot(finalColor,vec3(0.3,0.6,0.1))*0.65),0.72);
  }
  if(uShowMineralMap > 0.5) {
    vec3 mC=vec3(uIronPct,uSilicatePct,uWaterIcePct)*0.5+0.3;
    mC+=vec3(uCarbonPct*0.3,uKreepIndex*0.5,0);
    finalColor=mix(finalColor,mC*(0.3+dot(finalColor,vec3(0.3,0.6,0.1))*0.7),0.75);
  }

  // ── 15. TONE MAP + GAMMA ───────────────────────────────────
  finalColor = finalColor*(finalColor*2.51+0.04)/(finalColor*(finalColor*2.43+0.55)+0.14);
  finalColor = max(finalColor, vec3(0.015,0.015,0.020));
  finalColor = pow(clamp(finalColor,0.0,1.0), vec3(0.4545));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export const FRAG = WORLD_FRAG;
