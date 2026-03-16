/**
 * planetShaders.ts — GLSL shaders for ProceduralPlanet.
 *
 * Extracted from ProceduralPlanet.tsx with the following bug fixes:
 *   BUG FIX 1 — zA/zAlbedo multiplier floor raised from 0.35 to 0.88 (dark textures no longer go black)
 *   BUG FIX 2 — ambient light coefficient raised from 0.08 to 0.14
 *   BUG FIX 3 — night-side floor raised from 0.008 to 0.015
 *   BUG FIX 4 — ocean zoneShelfBoost raised from 0.25 to 0.45 for stronger zone depth variation
 */

export const VERT = /* glsl */ `
uniform float uDisplacement;
uniform float uSeedV;
uniform float uNoiseScaleV;
uniform float uIsGasV;
uniform float uOceanLevelV;
uniform float uCraterDensityV;
uniform float uMountainHeightV;
uniform float uValleyDepthV;
uniform float uVolcanismV;
uniform float uTerrainAgeV;
uniform float uTectonicsV;

varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFresnel;

/* -- Inline noise for vertex displacement -- */
float vHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x);
  f = f*f*f*(f*(f*6.0-15.0)+10.0); // quintic — matches FRAG for consistent terrain
  return mix(
    mix(mix(vHash(i), vHash(i+vec3(1,0,0)), f.x),
        mix(vHash(i+vec3(0,1,0)), vHash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(vHash(i+vec3(0,0,1)), vHash(i+vec3(1,0,1)), f.x),
        mix(vHash(i+vec3(0,1,1)), vHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float vFbm(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { f += amp * vNoise(p); p *= 2.03; amp *= 0.48; }
  return f;
}
float vWarpedFbm(vec3 p) {
  vec3 q = vec3(vFbm(p), vFbm(p + vec3(5.2,1.3,2.8)), vFbm(p + vec3(1.7,9.2,3.4)));
  return vFbm(p + q * 1.5);
}
/* Ridged noise for mountains */
float vRidged(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vNoise(p) * 2.0 - 1.0);
    f += n * n * amp; p *= 2.1; amp *= 0.45;
  }
  return f;
}

float vertexHeight(vec3 pos) {
  float h = vWarpedFbm(pos * uNoiseScaleV + uSeedV);
  // Mountains
  if (uMountainHeightV > 0.01) {
    h += vRidged(pos * 3.5 + uSeedV * 0.7) * uMountainHeightV * 0.35;
  }
  // Valleys (carve)
  if (uValleyDepthV > 0.01) {
    float v = abs(vNoise(pos * 4.0 + uSeedV * 1.3) * 2.0 - 1.0);
    v = pow(v, 0.3);
    h -= (1.0 - v) * uValleyDepthV * 0.20;
  }
  // Volcanism (peaks)
  if (uVolcanismV > 0.01) {
    float vp = 1.0 - smoothstep(0.0, 0.25, length(fract(pos * 2.5 + uSeedV) - 0.5));
    h += vp * uVolcanismV * 0.18;
  }
  return h;
}

void main() {
  vObjPos = position;
  vec3 displaced = position;
  if (uIsGasV < 0.5 && uDisplacement > 0.001) {
    vec3 dir = normalize(position);
    float h = vertexHeight(dir);
    // Clamp to ocean floor (no displacement below ocean level)
    float terrain = max(h, uOceanLevelV);
    float disp = (terrain - 0.5) * uDisplacement;
    displaced = position + dir * disp;
  }
  // World-space normal so lighting matches world-space uSunDir & vViewDir
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vFresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

export const FRAG = /* glsl */ `
precision highp float;

// =============================================================
// ProceduralPlanet FRAG v3 -- Tectonic plates, pole-free noise,
// heightmap water, dual clouds, texture-informed biomes
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
// Zone texture splat — 5 textures covering the archetype space
// blended by zoneChar.x (elevation) × zoneChar.y (roughness) bilinear weights
uniform sampler2D uZoneTex0, uZoneTex1, uZoneTex2, uZoneTex3, uZoneTex4;
uniform float uZoneTexScale;
uniform vec3  uPickPos;
uniform float uPickStrength;
uniform vec3  uBiomeCenters[32];
uniform float uBiomeCount;
uniform float uSelectedZone;
uniform float uAxialTilt;   // radians — rotational pole tilt, affects ice cap placement

varying vec3  vObjPos;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vFresnel;

// =============================================================
// NOISE CORE -- gradient noise, NO pole pinching (all 3D)
// =============================================================
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1,311.7,74.7)),
           dot(p, vec3(269.5,183.3,246.1)),
           dot(p, vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float noise3D(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0); // quintic for C2-smooth transitions
  return mix(mix(mix(dot(hash33(i),f),
    dot(hash33(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
    mix(dot(hash33(i+vec3(0,1,0)),f-vec3(0,1,0)),
    dot(hash33(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
    mix(mix(dot(hash33(i+vec3(0,0,1)),f-vec3(0,0,1)),
    dot(hash33(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
    mix(dot(hash33(i+vec3(0,1,1)),f-vec3(0,1,1)),
    dot(hash33(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
}
float fbm5(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<6;i++){v+=a*noise3D(p);p=p*2.03+31.97;a*=0.48;}
  return v;
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<3;i++){v+=a*noise3D(p);p=p*2.03+31.97;a*=0.49;}
  return v;
}
float ridgedFbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){
    float n=abs(noise3D(p)*2.0-1.0);n=1.0-n;n=n*n;
    v+=a*n;p=p*2.1+17.3;a*=0.45;
  }
  return v;
}

// =============================================================
// VORONOI TECTONIC PLATES -- discrete biome regions
// Returns (cellDist, cellEdgeDist, cellID hash)
// =============================================================
vec3 voronoiPlates(vec3 p, float sc) {
  vec3 pp = p * sc;
  vec3 i = floor(pp), f = fract(pp);
  float d1 = 2.0, d2 = 2.0;
  float cellId = 0.0;
  // 3x3x3 neighbor search (27 iterations) — proper nearest-cell Voronoi
  for(int x=-1;x<=1;x++)
    for(int y=-1;y<=1;y++)
      for(int z=-1;z<=1;z++){
        vec3 g = vec3(float(x),float(y),float(z));
        vec3 o = fract(sin(vec3(
          dot(i+g,vec3(127.1,311.7,74.7)),
          dot(i+g,vec3(269.5,183.3,246.1)),
          dot(i+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.75+0.125;
        float dd = length(g+o-f);
        if(dd < d1){ d2=d1; d1=dd;
          cellId = fract(sin(dot(i+g,vec3(7.13,157.9,113.2)))*43758.5453);
        } else if(dd < d2){ d2=dd; }
      }
  return vec3(d1, d2-d1, cellId);
}

// =============================================================
// TERRAIN HEIGHT -- domain-warped with tectonic plates
// =============================================================
float terrainHeight(vec3 pos) {
  float sc = uNoiseScale;
  // Domain warp for organic continental shapes
  vec3 q = vec3(fbm3(pos*sc + uSeed),
                fbm3(pos*sc + uSeed + vec3(5.2,1.3,3.7)),
                fbm3(pos*sc + uSeed + vec3(9.1,4.8,7.2)));
  vec3 r = vec3(fbm3(pos*sc + q*3.5 + uSeed + vec3(1.7,8.2,2.1)),
                fbm3(pos*sc + q*3.5 + uSeed + vec3(6.3,3.1,5.8)),
                0.0);
  float h = fbm5(pos*sc + r*2.0 + uSeed);

  // Tectonic plate influence: raise/lower entire plate regions
  if(uTectonics > 0.02) {
    vec3 vp = voronoiPlates(pos, sc * 0.7 + uSeed * 0.01);
    float plateH = fract(vp.z * 7.13) * 0.4 - 0.15; // plate altitude bias
    // Noise-modulated edge width for organic plate boundaries in height too
    float edgeNoise = noise3D(pos * 8.0 + uSeed * 2.7) * 0.5 + 0.5;
    float edgeWidth = mix(0.04, 0.14, edgeNoise);
    float edgeBreak = smoothstep(0.25, 0.45, noise3D(pos * 3.2 + uSeed * 5.1));
    float edge = smoothstep(0.0, edgeWidth, vp.y);
    float edgeMask = (1.0 - edge) * edgeBreak;
    h += plateH * uTectonics * 0.25;
    // Mountain ridges at plate boundaries (subduction zones)
    h += edgeMask * uTectonics * 0.12;
    // Rift valleys at some boundaries
    float riftBias = fract(vp.z * 13.7);
    if(riftBias > 0.6)
      h -= edgeMask * uTectonics * 0.08;
  }

  // Mountain ridges
  if(uMountainHeight > 0.01)
    h += ridgedFbm(pos*sc*2.0 + uSeed + 200.0) * uMountainHeight * 0.30;

  // Valley carving
  if(uValleyDepth > 0.01)
    h -= smoothstep(0.45,0.55,fbm3(pos*sc*1.5+uSeed+300.0)) * uValleyDepth * 0.15;

  // Craters (3D Voronoi bowl+rim)
  if(uCraterDensity > 0.01) {
    vec3 cp = pos*sc*3.0 + uSeed;
    vec3 ci = floor(cp), cf = fract(cp);
    float md = 1.0;
    // 3x3x3 crater search — proper nearest-cell detection
    for(int x=-1;x<=1;x++)
      for(int y=-1;y<=1;y++)
        for(int z=-1;z<=1;z++){
          vec3 g = vec3(float(x),float(y),float(z));
          vec3 o = fract(sin(vec3(
            dot(ci+g,vec3(127.1,311.7,74.7)),
            dot(ci+g,vec3(269.5,183.3,246.1)),
            dot(ci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
          md = min(md, length(g+o-cf));
        }
    h -= (1.0-smoothstep(0.0,0.18,md)) * uCraterDensity * 0.10;
    h += smoothstep(0.16,0.22,md)*(1.0-smoothstep(0.22,0.30,md)) * uCraterDensity * 0.03;
  }

  // Volcanism
  if(uVolcanism > 0.01)
    h += smoothstep(0.62,0.82,fbm3(pos*sc*0.8+uSeed+500.0)) * uVolcanism * 0.18;

  // Cracks — domain-warped for organic, meandering paths
  if(uCrackIntensity > 0.01) {
    // Warp the crack coordinate for natural-looking paths
    vec3 crWarp = pos*sc*3.5 + uSeed + 400.0;
    crWarp += vec3(noise3D(pos*sc*1.8+uSeed+410.0),
                   noise3D(pos*sc*1.8+uSeed+420.0),
                   noise3D(pos*sc*1.8+uSeed+430.0)) * 0.35;
    float cr = abs(noise3D(crWarp)*2.0-1.0);
    // Wider smoothstep + noise-varied width for organic cracks
    float crWidth = 0.06 + noise3D(pos*sc*2.0+uSeed+440.0) * 0.05;
    // Some cracks fade out (breakup)
    float crBreak = smoothstep(0.2, 0.5, noise3D(pos*sc*1.2+uSeed+450.0));
    h -= (1.0-smoothstep(0.0, crWidth, cr)) * uCrackIntensity * 0.06 * crBreak;
  }

  // Age: young=smooth, old=rough
  h = mix(h, h*0.7+0.15, (1.0-uTerrainAge)*0.3);
  return h;
}

// =============================================================
// TRIPLANAR TEXTURE -- no pole pinching
// =============================================================
vec3 triplanarSample(sampler2D tex, vec3 p, vec3 n, float sc) {
  vec3 bl = abs(n); bl = pow(bl,vec3(8.0)); bl /= dot(bl,vec3(1.0));
  // Offset each projection plane slightly to break up tiling repetition
  vec2 uvYZ = p.yz * sc + vec2(0.37, 0.13);
  vec2 uvXZ = p.xz * sc + vec2(0.71, 0.59);
  vec2 uvXY = p.xy * sc + vec2(0.23, 0.47);
  return texture2D(tex, uvYZ).rgb * bl.x
       + texture2D(tex, uvXZ).rgb * bl.y
       + texture2D(tex, uvXY).rgb * bl.z;
}

// =============================================================
// BIOME ZONE LOOKUP — fast nearest-center search for per-zone terrain variation
// Returns index 0..15 of nearest biome zone, or -1 when no zones defined.
// =============================================================
int nearestBiomeZone(vec3 p) {
  if(uBiomeCount < 0.5) return -1;
  int count = int(uBiomeCount);
  float d1 = 999.0;
  int z = 0;
  for(int i = 0; i < 32; i++) {
    if(i >= count) break;
    float d = 1.0 - dot(p, uBiomeCenters[i]);
    if(d < d1) { d1 = d; z = i; }
  }
  return z;
}

// =============================================================
// WAVE ROTATION — latitude-differential rotation for ocean wave normals
// =============================================================
vec3 cloudWarp(vec3 p, float speed) {
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float angle = speed * cos(lat) * uTime;
  float c = cos(angle), s = sin(angle);
  return vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
}

// =============================================================
// GAS GIANT
// =============================================================
vec3 gasGiantColor(vec3 pos) {
  float lat = pos.y;
  float seed = uSeed;
  // Reduced band count: 3–6 primary bands (was 4–12) for cleaner, more Jupiter-like look
  float bf = 4.5 + sin(seed*7.13)*1.5;

  // Animated latitude-differential zonal wind (visible band drift)
  float windAngle = cos(asin(clamp(lat,-1.0,1.0))) * uTime * 0.12;
  vec3 wpos = vec3(
    pos.x * cos(windAngle) - pos.z * sin(windAngle),
    pos.y,
    pos.x * sin(windAngle) + pos.z * cos(windAngle));

  // Temporal turbulence evolution — bands shift and churn over time
  float tEvol = uTime * 0.04;
  vec3 evolOffset = vec3(sin(tEvol*0.7)*0.3, 0.0, cos(tEvol*1.1)*0.3);

  // Primary bands — wider, cleaner
  float bands = sin(lat*bf + fbm3(wpos*2.5+seed+evolOffset)*1.6);
  // Secondary harmonic at lower weight — less busy than before
  float bands2 = sin(lat*bf*1.7+1.0 + fbm3(wpos*4.0+seed+80.0+evolOffset*0.7)*0.7);
  float turb = fbm5(wpos*5.0 + vec3(0,tEvol*0.5,seed+100.0));
  float turbFine = fbm3(wpos*10.0 + vec3(0,tEvol*0.8,seed+200.0));
  float shear = noise3D(vec3(lat*3.5, uTime*0.05, seed))*0.22;

  // [27] Chevron / festoon patterns at band boundaries — moderated frequency
  float bandEdge = abs(fract(lat*bf*0.5/(3.14159*2.0)+0.5)-0.5)*2.0;
  float chevronZone = smoothstep(0.0, 0.18, bandEdge) * (1.0 - smoothstep(0.18, 0.40, bandEdge));
  float lon = atan(wpos.z, wpos.x);
  float chevron = sin(lon * 8.0 + lat * 18.0 + turb * 6.0 + uTime * 0.22) * 0.5 + 0.5;
  float chevronFine = sin(lon * 13.0 - lat * 12.0 + turbFine * 4.5 + uTime * 0.30) * 0.3 + 0.5;
  float festoon = chevronZone * (chevron * 0.6 + chevronFine * 0.4);

  // Reduced secondary contribution — primary bands dominate
  float bandMix = bands*0.65 + bands2*0.18 + shear;
  bandMix += (turb-0.5)*0.42 + (turbFine-0.5)*0.14;
  bandMix += festoon * 0.22;

  // Belt/zone color contrast — belts darker, zones brighter
  float beltZone = sin(lat*bf*0.5)*0.5+0.5;
  vec3 beltCol = uColor1 * 0.50;  // darker belts — deep contrast
  vec3 zoneCol = uColor2 * 1.40;  // brighter zones — vivid

  vec3 col = mix(beltCol, zoneCol, beltZone*0.50+0.20);
  col = mix(col, mix(uColor1, uColor2, smoothstep(-0.8,0.8,bandMix)), 0.40);
  col = mix(col, uColor3, smoothstep(0.55,0.72,turb)*0.40);

  // Great storm vortex — more prominent with visible rotation
  float sLat = 0.35 + sin(seed*3.14)*0.2;
  float sLon = seed * 1.618 + uTime * 0.07; // storm drifts in longitude
  vec3 sc = vec3(cos(sLon)*cos(sLat), sin(sLat), sin(sLon)*cos(sLat));
  float sd = length(pos - sc);
  float sm = 1.0 - smoothstep(0.0, 0.28, sd);
  if(sm > 0.001) {
    float ang = atan(pos.z-sc.z, pos.x-sc.x);
    float spiral = sin(ang*4.0+sd*22.0+uTime*0.70)*0.5+0.5;
    float spiralFine = sin(ang*8.0+sd*40.0+uTime*0.50)*0.3+0.5;
    vec3 stormCol = mix(uColor3,vec3(1,0.92,0.82),spiral*0.35+spiralFine*0.15);
    col = mix(col, stormCol, sm*0.75);
  }
  // Secondary storm
  float s2Lat = -0.20+sin(seed*5.67)*0.15;
  float s2Lon = seed*2.71 + uTime*0.05;
  vec3 sc2 = vec3(cos(s2Lon)*cos(s2Lat),sin(s2Lat),sin(s2Lon)*cos(s2Lat));
  col = mix(col, uColor3*1.1, (1.0-smoothstep(0.0,0.14,length(pos-sc2)))*0.55);

  return col;
}

// =============================================================
// MAIN
// =============================================================
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);
  vec3 pos = normalize(vObjPos);
  vec3 H = normalize(L+V);
  float rim = 1.0 - max(dot(N,V),0.0);

  vec3 finalColor;

  // ==== GAS GIANT PATH ====
  if(uIsGas > 0.5) {
    vec3 color = gasGiantColor(pos);
    // [5] Saturation boost — vivid but not oversaturated
    float gasLum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gasLum), color, 1.35);
    // Fine micro-turbulence only — much reduced to avoid band clutter
    float fineBand = sin(pos.y * 48.0 + uTime * 0.014 + uSeed * 6.3) * 0.5 + 0.5;
    color *= 0.95 + fineBand * 0.08;
    float NdotL = max(dot(N,L),0.0);
    float term = smoothstep(-0.05,0.18,NdotL);
    // [15] Polar darkening/brightening — Jupiter-like limb-darkened poles
    float gasLat = abs(pos.y);
    float polarDark = 1.0 - smoothstep(0.55, 0.90, gasLat) * 0.25;
    color *= polarDark;
    finalColor = color * NdotL * 0.95 * term + color * 0.02;
    // Tinted specular (not pure white — matches atmosphere)
    vec3 specTint = mix(vec3(1.0), uAtmColor * 0.5 + 0.5, 0.3);
    finalColor += specTint * pow(max(dot(N,H),0.0),120.0) * 0.06 * term;
    // [16] Atmospheric haze rim — subtle, day-side only
    float gasHazeRim = pow(rim, 3.0);
    vec3 gasHazeCol = uAtmColor * 0.6 + vec3(0.05, 0.08, 0.12);
    finalColor += gasHazeCol * gasHazeRim * 0.20 * term;
    // Limb darkening
    finalColor *= 1.0 - pow(rim,4.0)*0.40;
    // ACES filmic tone mapping (no gamma — ACES already maps to display range)
    finalColor = finalColor * (finalColor * 2.51 + 0.03) / (finalColor * (finalColor * 2.43 + 0.59) + 0.14);
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
    return;
  }

  // ==== SOLID WORLD PATH ====

  // ---- ORGANIC VORONOI PROVINCE SYSTEM (runs FIRST — drives all terrain below) ──
  // Computed before terrainHeight() so zone character controls bump amplitude,
  // land coloring base, seafloor depth, and ice cap distribution.
  // Domain-warp organic Voronoi — runs BEFORE terrainHeight() so zone drives bump + color
  vec3 ow1 = vec3(fbm3(pos * 2.4 + uSeed * 0.009 + 17.3),
                  fbm3(pos * 2.4 + uSeed * 0.009 + 43.7),
                  fbm3(pos * 2.4 + uSeed * 0.009 + 81.2)) * 2.0 - 1.0;
  vec3 warpedPos = normalize(pos + ow1 * 0.48);
  vec3 ow2 = vec3(fbm3(warpedPos * 7.0 + uSeed + 200.0),
                  fbm3(warpedPos * 7.0 + uSeed + 233.0),
                  fbm3(warpedPos * 7.0 + uSeed + 267.0)) * 2.0 - 1.0;
  warpedPos = normalize(warpedPos + ow2 * 0.13);

  int bZone = -1;
  vec3 zoneChar = vec3(0.5);
  float provEdge = 999.0;
  if(uBiomeCount > 0.5) {
    int count = int(uBiomeCount);
    float zd1 = 999.0, zd2 = 999.0;
    int zi1 = 0, zi2 = 0;
    for(int i = 0; i < 32; i++) {
      if(i >= count) break;
      float d = 1.0 - dot(warpedPos, uBiomeCenters[i]);
      if(d < zd1) { zd2 = zd1; zi2 = zi1; zd1 = d; zi1 = i; }
      else if(d < zd2) { zd2 = d; zi2 = i; }
    }
    bZone = zi1;
    provEdge = zd2 - zd1;
    float bz1 = float(zi1), bz2 = float(zi2);
    vec3 c1 = vec3(fract(sin(bz1*127.1+uSeed)*43758.5),
                   fract(sin(bz1*311.7+uSeed*0.37)*43758.5),
                   fract(sin(bz1*491.3+uSeed*0.71)*43758.5));
    vec3 c2 = vec3(fract(sin(bz2*127.1+uSeed)*43758.5),
                   fract(sin(bz2*311.7+uSeed*0.37)*43758.5),
                   fract(sin(bz2*491.3+uSeed*0.71)*43758.5));
    float blendW = 1.0 - smoothstep(0.0, 0.10, zd2 - zd1);
    zoneChar = mix(c1, c2, blendW * 0.88);
  }

  // Derived factors — available to ALL downstream systems
  float contFactor   = smoothstep(0.72, 0.40, uOceanLevel);
  float elevBiasAmp  = mix(0.07, 0.27, contFactor);
  float zoneElevBias = (zoneChar.x - 0.5) * elevBiasAmp;
  float zoneRough    = 0.55 + zoneChar.y * 0.90;
  float zoneTempBias = (zoneChar.z - 0.5) * 0.18;

  // Zone archetype palette — built once, used in land coloring + ice + border
  //   zoneChar.x: elevation (0=basin/mare, 1=highland/continent)
  //   zoneChar.y: roughness (0=ancient smooth, 1=young active)
  //   zoneChar.z: mineral   (0=cool basalt, 1=warm ferric/ochre)
  float zAlbedo = clamp(mix(0.92, 1.18, zoneChar.x*0.65 + zoneChar.y*0.20 + zoneChar.z*0.15), 0.90, 1.20);
  vec3 zArchMare  = vec3(0.24, 0.25, 0.28);  // dark grey-blue  (mare/ocean floor)
  vec3 zArchBasalt= vec3(0.31, 0.21, 0.17);  // dark red-brown  (basaltic plains)
  vec3 zArchPlain = vec3(0.60, 0.52, 0.39);  // tan             (sedimentary plain)
  vec3 zArchHigh  = vec3(0.82, 0.80, 0.74);  // bright buff     (highland craton)
  vec3 zArchMount = vec3(0.76, 0.75, 0.80);  // grey-blue       (mountain belt)
  vec3 zArchVolc  = vec3(0.27, 0.14, 0.09);  // dark red-black  (lava field)
  vec3 zLoElev  = mix(zArchMare,  zArchBasalt, zoneChar.z);
  vec3 zHiElev  = mix(zArchHigh,  zArchPlain,  zoneChar.z * 0.5);
  vec3 zElevPal = mix(zLoElev, zHiElev, zoneChar.x);
  vec3 zRoughEnd= zoneChar.x < 0.5 ? zArchVolc : zArchMount;
  vec3 zArchPal = mix(zElevPal, zRoughEnd, zoneChar.y * 0.55);

  // Height samples — after zone so zoneBumpAmp can scale the bump
  float eps = 0.005;
  vec3 pX = normalize(pos+vec3(eps,0,0));
  vec3 pZ = normalize(pos+vec3(0,0,eps));

  float h  = terrainHeight(pos);
  float hX = terrainHeight(pX);
  float hZ = terrainHeight(pZ);

  vec3 dH = vec3(h-hX, 0.0, h-hZ);
  dH.y = -(dH.x + dH.z) * 0.5;

  // Zone-driven bump amplitude: mare=flat(4×), highland=rough(18×)
  float zoneBumpAmp = mix(4.0, 18.0, zoneChar.y);
  vec3 bumpN = normalize(N + dH * zoneBumpAmp);

  // Micro-detail normals — amplitude also zone-scaled
  {
    float mScale = mix(0.016, 0.042, zoneChar.y);
    float mbn1 = (noise3D(pos * 110.0 + uSeed + 900.0) * 2.0 - 1.0) * mScale;
    float mbn2 = (noise3D(pos * 165.0 + uSeed + 960.0) * 2.0 - 1.0) * mScale;
    bumpN = normalize(bumpN + vec3(mbn1, 0.0, mbn2));
  }

  float NdotL = max(dot(bumpN,L),0.0);
  float absLat = abs(pos.y);
  float slope = length(dH) * 120.0;

  // ---- VORONOI BIOME REGIONS ----
  vec3 vp = voronoiPlates(pos, uNoiseScale * 0.55 + uSeed * 0.005);
  float biomeId = vp.z;     // 0-1 hash per plate

  // Plate borders: noise-modulated width for organic, natural-looking boundaries.
  // Some segments fade out entirely (geological breakup), others widen.
  float borderNoise = noise3D(pos * 8.0 + uSeed * 2.7) * 0.5 + 0.5;
  float borderBreak = smoothstep(0.20, 0.50, noise3D(pos * 3.2 + uSeed * 5.1)); // segments vanish
  float borderWidth = mix(0.08, 0.22, borderNoise); // wider blend range
  float plateBorder = (1.0 - smoothstep(0.0, borderWidth, vp.y)) * borderBreak;

  // ---- OCEAN (heightmap-driven water surface) ----
  float shoreN = noise3D(pos*18.0+uSeed*3.3)*0.012
               + noise3D(pos*36.0+uSeed*5.1)*0.006;  // dual-freq shore detail
  float effOcean = uOceanLevel + shoreN;
  float underwaterDepth = effOcean - h;
  float shoreBlend = smoothstep(-0.04, 0.035, underwaterDepth); // wider transition zone
  bool isOcean = shoreBlend > 0.01;

  vec3 color;
  if(isOcean) {
    // Depth-dependent ocean color (shallow turquoise -> deep navy)
    float depth01 = clamp(underwaterDepth / max(uOceanLevel,0.01), 0.0, 1.0);
    vec3 shallowC = uOceanColor * 1.4 + vec3(0.04,0.08,0.06);
    vec3 deepC = uOceanColor * 0.35;
    color = mix(shallowC, deepC, smoothstep(0.0,0.5,depth01));
    // Seafloor terrain topology — actual heightmap + zone character visible through water
    // High-elevation zones (zoneChar.x high) = continental shelves even if submerged
    // Low-elevation zones (zoneChar.x low) = abyssal plains
    float seaH = clamp((h + zoneElevBias * 0.6) / max(effOcean, 0.01), 0.0, 1.0);
    // Ridges and continental shelves: terrain near ocean level appears lighter/teal
    float ridge = smoothstep(0.55, 0.90, seaH);
    // Deep abyssal plains: terrain far below ocean level appears darker/cooler
    float abyssal = smoothstep(0.45, 0.10, seaH);
    // Zone-driven shelf tint: high zones push warm continental-shelf turquoise even deep
    float zoneShelfBoost = smoothstep(0.4, 0.75, zoneChar.x) * 0.45;
    ridge = clamp(ridge + zoneShelfBoost * (1.0 - depth01), 0.0, 1.0);
    // Transparency window: visible most in shallows, fades with depth
    float waterOpacity = smoothstep(0.0, 0.60, depth01);
    // Shallow shelves: warm turquoise tint over sand/rock
    color = mix(color, color * 1.30 + vec3(0.04, 0.07, 0.02), ridge * (1.0 - waterOpacity) * 0.45);
    // Deep trenches: darker, cooler blue
    color = mix(color, deepC * 0.65, abyssal * waterOpacity * 0.30);
    // Mid-depth variation: FBM noise on the seafloor
    float oceanVar1 = noise3D(pos * 3.5 + uSeed * 1.3) * 0.5 + 0.5;
    float oceanVar2 = noise3D(pos * 7.0 + uSeed * 2.7) * 0.5 + 0.5;
    float oceanVar  = oceanVar1 * 0.7 + oceanVar2 * 0.3;
    float floorHue = (oceanVar - 0.5) * 0.8;
    color += vec3(floorHue*0.03, -floorHue*0.02, floorHue*0.05) * (1.0 - waterOpacity * 0.8);

    // Shore foam fringe — wider, softer transition
    float foam = 1.0 - smoothstep(0.0, 0.015, underwaterDepth);
    foam *= noise3D(pos*60.0+uTime*0.5)*0.7+0.3;
    color = mix(color, vec3(0.85,0.90,0.95), foam*0.50);
    // Sandy shallows tint (warm near-shore band)
    float sandyShallow = smoothstep(0.0, 0.025, underwaterDepth) * (1.0-smoothstep(0.025, 0.08, underwaterDepth));
    color = mix(color, uOceanColor*1.2+vec3(0.1,0.08,0.04), sandyShallow*0.30);

    // Animated wave normals (dual-frequency, latitude-aware rotation)
    vec3 wp1 = cloudWarp(pos, 0.02) * 45.0;
    vec3 wp2 = cloudWarp(pos, -0.015) * 30.0;
    float w1 = noise3D(wp1+uSeed)*2.0-1.0;
    float w2 = noise3D(wp2+uSeed+50.0)*2.0-1.0;
    float waveStr = 0.06 * (1.0-depth01*0.8);
    bumpN = normalize(N + vec3(w1,0,w2)*waveStr);
    NdotL = max(dot(bumpN,L),0.0);

    // [22] Ocean sun-glint hotspot — concentrated specular reflection
    vec3 oceanH = normalize(L + V);
    float oceanNdotH = max(dot(bumpN, oceanH), 0.0);
    float glintPow = pow(oceanNdotH, 320.0);    // very tight hotspot
    float glintWide = pow(oceanNdotH, 48.0);    // broader shimmer
    // Fresnel-modulated intensity (brighter at grazing angles)
    float glintFresnel = 0.04 + 0.96 * pow(1.0 - max(dot(bumpN, V), 0.0), 5.0);
    vec3 glintCol = vec3(1.0, 0.98, 0.92);
    color += glintCol * (glintPow * 0.55 + glintWide * 0.08) * glintFresnel * (1.0 - depth01 * 0.6);
  } else {
    // ---- LAND: ZONE TEXTURE SPLAT ────────────────────────────────────────────
    // 5 real textures, one per geological archetype, blended by zone character.
    // This IS the terrain color — textures from the texture library provide the
    // actual visual character, not procedural noise pretending to be geology.
    //
    // Blend space: 2D bilinear in (elevation × roughness)
    //   elev 0 + rough 0 → w0 (smooth basin / mare)
    //   elev 0 + rough 1 → w1 (rough volcanic / fractured dark)
    //   elev 0.5 + rough 0.5 → w2 peaks (plains / sedimentary / transitional)
    //   elev 1 + rough 0 → w3 (smooth highland / craton)
    //   elev 1 + rough 1 → w4 (rough mountain / active young terrain)

    float tH   = clamp(h + zoneElevBias, 0.0, 1.0);
    float elev = zoneChar.x;
    float rough = zoneChar.y;

    float w0 = (1.0-elev) * (1.0-rough);
    float w1 = (1.0-elev) * rough;
    float w2 = clamp(1.0 - 2.0*abs(elev-0.5), 0.0, 1.0)
             * clamp(1.0 - 2.0*abs(rough-0.5), 0.0, 1.0);
    float w3 = elev * (1.0-rough);
    float w4 = elev * rough;
    float wSum = max(w0+w1+w2+w3+w4, 0.001);

    // Sample zone textures at slightly different scales to break tiling and add variation
    vec3 zt0 = triplanarSample(uZoneTex0, pos, N, uZoneTexScale);
    vec3 zt1 = triplanarSample(uZoneTex1, pos, N, uZoneTexScale * 1.15);
    vec3 zt2 = triplanarSample(uZoneTex2, pos, N, uZoneTexScale * 0.85);
    vec3 zt3 = triplanarSample(uZoneTex3, pos, N, uZoneTexScale * 1.05);
    vec3 zt4 = triplanarSample(uZoneTex4, pos, N, uZoneTexScale * 1.30);
    vec3 zoneTex = (zt0*w0 + zt1*w1 + zt2*w2 + zt3*w3 + zt4*w4) / wSum;

    // Zone albedo — brightness multiplier per archetype
    // Min 0.35 (dark but not black), max 1.50 (bright highland/ice)
    float zA = clamp(mix(0.92, 1.18, elev*0.65 + rough*0.20 + zoneChar.z*0.15), 0.90, 1.20);

    // Primary color: zone texture × albedo
    vec3 color = zoneTex * zA;

    // Mineral axis tint (warm iron-oxide ↔ cool basalt/ice)
    vec3 warmM = vec3(1.08, 0.96, 0.82);
    vec3 coolM = vec3(0.88, 0.95, 1.10);
    color *= mix(coolM, warmM, zoneChar.z);

    // Planet hue tint (secondary — shifts hue 25%, preserves zone albedo)
    // Uses height ramp so planet's high/low elevation colors subtly show through
    float planetT   = smoothstep(0.22, 0.80, tH);
    vec3 planetTint = mix(uColor1, mix(uColor2, uColor3, planetT * 0.8), planetT);
    float pLum = max(dot(planetTint, vec3(0.299, 0.587, 0.114)), 0.001);
    color = mix(color, color * (planetTint / pLum), 0.25);

    // Slope cliff — zone texture 0 (rough low) as exposed fresh rock face
    float slopeRough = smoothstep(0.20, 0.55, slope);
    float microBump  = noise3D(pos * 80.0 + uSeed + 700.0) * 0.5 + 0.5;
    color = mix(color, zt1 * zA * 0.55, slopeRough * 0.45);
    color *= 1.0 - slopeRough * (1.0 - microBump) * 0.10;

    // Latitude polar toning
    color = mix(color, mix(color, vec3(0.76, 0.79, 0.86), 0.20),
                smoothstep(0.50, 0.85, absLat));

    // Crater ejecta — zone-roughness gated
    if(uCraterDensity > 0.01) {
      vec3 ecp = pos * uNoiseScale * 3.0 + uSeed;
      vec3 eci = floor(ecp), ecf = fract(ecp);
      float eDist = 1.0;
      vec3 eCenter = vec3(0.0);
      for(int x=-1;x<=1;x++)
        for(int y=-1;y<=1;y++)
          for(int z=-1;z<=1;z++){
            vec3 g = vec3(float(x),float(y),float(z));
            vec3 o = fract(sin(vec3(
              dot(eci+g,vec3(127.1,311.7,74.7)),
              dot(eci+g,vec3(269.5,183.3,246.1)),
              dot(eci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
            float d = length(g+o-ecf);
            if(d < eDist) { eDist = d; eCenter = g + o; }
          }
      vec3 toCenter = normalize(ecf - eCenter);
      float rayAngle = atan(toCenter.z, toCenter.x);
      float rays = sin(rayAngle*7.0 + fract(sin(dot(eci,vec3(37.1,91.7,53.3)))*43758.5)*6.28)*0.5+0.5;
      rays = smoothstep(0.55, 0.85, rays);
      float ejectaZone = smoothstep(0.18, 0.25, eDist) * (1.0 - smoothstep(0.25, 0.55, eDist));
      float freshness = step(0.5, fract(sin(dot(eci, vec3(71.3,23.9,17.1))) * 43758.5));
      float craterWt  = mix(0.08, 1.0, rough * 0.7 + elev * 0.3);
      color += vec3(0.12, 0.10, 0.08) * rays * ejectaZone * freshness * uCraterDensity * 0.6 * craterWt;
    }

    // Fine Voronoi grain — facet-level surface detail (decoupled from province layer)
    {
      vec3 fcvp    = voronoiPlates(pos, 13.0 + sin(uSeed * 1.3 + 5.7) * 2.0);
      float fcId   = fcvp.z;
      float fcEdge = fcvp.y;
      float fcBright = 0.94 + fract(fcId * 37.13 + 0.17) * 0.12;
      float fcHue    = fract(fcId * 73.47 + 0.31) - 0.5;
      color = color * fcBright + vec3(fcHue * 0.04, fcHue * -0.02, fcHue * -0.03);
      color *= 1.0 - smoothstep(0.012, 0.0, fcEdge) * 0.07;
    }

    // [30] Wind erosion striations — anisotropic latitude-parallel grooves
    // Coriolis-driven winds carve grooves that follow latitude bands.
    // Achieved by compressing the y-axis in noise space → elongated E-W features.
    if(!isOcean && absLat < 0.82) {
      // Dual-scale anisotropic noise: stretched in xz (E-W), compressed in y (N-S)
      // → creates horizontal striation patterns like Mars yardangs or Venus tessera
      float s1 = noise3D(pos * vec3(78.0, 18.0, 78.0) + uSeed + 901.0) * 0.5 + 0.5;
      float s2 = noise3D(pos * vec3(195.0, 44.0, 195.0) + uSeed + 953.0) * 0.5 + 0.5;
      float stria = s1 * 0.62 + s2 * 0.38;
      // Strongest at mid-latitudes (wind belts), absent at polar ice and on steep cliffs
      float latWt = smoothstep(0.0, 0.10, absLat) * smoothstep(0.82, 0.55, absLat);
      float flatWt = 1.0 - smoothstep(0.08, 0.42, slope);
      color = mix(color, color * (0.78 + stria * 0.44), latWt * flatWt * 0.08);
    }

    // Plate boundaries: subtle tonal shift (not dark lines)
    float borderDarken = mix(0.92, 0.85, borderNoise); // very subtle
    color *= mix(1.0, borderDarken, plateBorder * uTectonics * smoothstep(0.10, 0.35, uTectonics));

    // Vegetation (habitable conditions)
    if(length(uFoliageColor) > 0.01) {
      float veg = smoothstep(0.32,0.54,h) * (1.0-smoothstep(0.58,0.78,h));
      veg *= clamp(1.0-absLat*1.4, 0.0, 1.0);
      veg *= clamp(1.0-slope*2.5, 0.0, 1.0);
      veg *= smoothstep(0.03, 0.12, underwaterDepth < 0.0 ? -underwaterDepth : 0.0) + step(0.0, underwaterDepth-0.01) < 0.5 ? 0.0 : 1.0;
      // Vegetation patches using plate biome (some plates barren)
      float vegPlate = step(0.25, biomeId) * step(biomeId, 0.85);
      color = mix(color, uFoliageColor, veg * vegPlate * 0.55);
    }

    // Shore transition
    // [14] Wet-sand darkening — narrow band just above waterline
    float wetSand = smoothstep(0.0, 0.02, -underwaterDepth) * (1.0 - smoothstep(0.02, 0.06, -underwaterDepth));
    color *= 1.0 - wetSand * 0.25;
    color = mix(color, uOceanColor*0.8+0.06, shoreBlend*0.6);
  }

  float globalIce = 0.0; // set inside ice caps block, used for specular later

  // ---- ICE CAPS (3D noise, no pole pinch) ----
  // Frost-zone worlds (already icy surfaces): subtle pole variation instead of dramatic white caps
  if(uIceCaps > 0.01) {
    float iceLine = 1.0 - uIceCaps*0.55;
    float iceWarp = fbm3(pos*5.0+uSeed+50.0)*0.10;
    // Tilted pole: ice caps form around the actual rotational pole, not +Y geometric pole.
    // uAxialTilt rotates the north pole away from +Y in the XZ plane.
    vec3 tiltedPole = normalize(vec3(sin(uAxialTilt), cos(uAxialTilt), 0.0));
    float tiltedSinLat = abs(dot(pos, tiltedPole));
    // Blend: small tilts use absLat (less noisy), large tilts fully use tilted pole
    float tiltWeight = smoothstep(0.08, 0.45, uAxialTilt);
    float effectiveLat = mix(absLat, tiltedSinLat, tiltWeight);
    float ice = smoothstep(iceLine-0.06, iceLine+0.06, effectiveLat+iceWarp);

    // Reduce polar whitening for ice worlds — they're already icy everywhere
    float iceWorldDampen = uIsIceWorld > 0.5 ? 0.25 : 1.0;
    ice *= iceWorldDampen;
    globalIce = ice;

    vec3 iceCol = mix(vec3(0.90,0.93,0.97), vec3(0.70,0.82,0.96),
                      smoothstep(iceLine, iceLine+0.22, effectiveLat)*0.42);
    // [13] Ice subsurface scattering — translucent blue-white at glancing angles
    float iceFresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    iceCol += vec3(0.15, 0.25, 0.40) * iceFresnel * 0.25 * max(dot(N, L), 0.0);
    // For frost-zone worlds, ice is slightly tinted by the base surface color
    if(uIsIceWorld > 0.5) {
      iceCol = mix(iceCol, color*1.15, 0.35);
    }
    // Glacier crevasses via 3D noise (not sin(pos.x) which pinches at poles)
    float glacier = abs(noise3D(pos*25.0+uSeed+60.0)*2.0-1.0);
    iceCol -= smoothstep(0.0,0.12,glacier)*0.05*ice;
    color = mix(color, iceCol, ice);
  }

  // ---- TIDALLY LOCKED EYEBALL ----
  if(uTidallyLocked > 0.5 && uSpinOrbit32 < 0.5) {
    float facing = dot(pos,L);
    float iceWarpT = fbm3(pos*6.0+uSeed+150.0)*0.20;
    float iceMask = smoothstep(0.12,-0.55,facing+iceWarpT);
    vec3 tidalIce = mix(vec3(0.82,0.86,0.94),vec3(0.55,0.68,0.88),
                        smoothstep(-0.3,-0.85,facing)*0.60);
    color = mix(color, tidalIce, iceMask);
    float heatMask = smoothstep(0.50,0.90,facing);
    color = mix(color, mix(color*0.50,vec3(0.28,0.14,0.05),0.55), heatMask*0.55);
    if(uSubstellarTemp > 500.0) {
      float molten = smoothstep(0.82,0.97,facing);
      color = mix(color, vec3(1,0.35,0.06)*smoothstep(0.35,0.55,
        fbm3(pos*10.0+uSeed+170.0)), molten*0.60);
    }
  }

  // ---- LIGHTING (Oren-Nayar diffuse + ambient fill) ----
  float terminator = smoothstep(-0.08, 0.25, NdotL);
  // Height-based ambient occlusion: low terrain darker, ridges brighter
  float ao = 0.85 + 0.15 * smoothstep(0.35, 0.65, h);
  vec3 ambient = color * 0.14 * ao;
  vec3 lit = color * NdotL * 0.88;
  finalColor = lit * terminator + ambient;

  // Specular: water gets sharp sun-glint, land gets subtle sheen
  if(isOcean) {
    // Schlick fresnel for wider glancing-angle sun glint
    float f0 = 0.02;
    float fresnelOcean = f0 + (1.0 - f0) * pow(1.0 - max(dot(bumpN, V), 0.0), 5.0);
    float spec = pow(max(dot(bumpN,H),0.0), 280.0) * (0.35 + fresnelOcean * 0.45);
    finalColor += vec3(spec) * terminator;
    // Wide-angle glint at grazing angles
    float wideGlint = pow(max(dot(bumpN,H),0.0), 40.0) * fresnelOcean * 0.12;
    finalColor += vec3(wideGlint) * terminator;
    // Subsurface scattering blue for shallow water
    float sss = pow(max(dot(-bumpN,L),0.0),3.0) * 0.08;
    finalColor += uOceanColor * sss * terminator;
  } else {
    float spec = pow(max(dot(bumpN,H),0.0), 40.0) * 0.04;
    finalColor += vec3(spec) * terminator;
  }

  // ---- LAVA EMISSION ----
  // [25] Animated flow + pulsing glow along cracks
  if(uEmissive > 0.01) {
    // Animated domain warp — lava flows slowly shift
    vec3 lavaWarp = pos*uNoiseScale*2.0 + uSeed + 80.0;
    lavaWarp += vec3(sin(uTime*0.08)*0.15, cos(uTime*0.06)*0.12, sin(uTime*0.1)*0.10);
    float lavaN = fbm3(lavaWarp);
    // Crack pattern with time-evolving domain warp
    vec3 crackWarp = pos*uNoiseScale*5.0 + uSeed + 120.0;
    crackWarp += vec3(sin(uTime*0.05+pos.x*3.0)*0.08, 0.0, cos(uTime*0.07+pos.z*3.0)*0.08);
    float crackN = noise3D(crackWarp);
    float lavaMask = smoothstep(0.43,0.58,lavaN)*smoothstep(0.35,0.50,crackN);
    float lavaPulse = 0.75 + 0.25 * sin(uTime * 1.2 + lavaN * 12.0 + pos.x * 5.0);
    // [1] Dayside: cracks darken sunlit crust
    finalColor = mix(finalColor, finalColor*0.45, lavaMask*0.40*terminator);
    // [1] Nightside: glowing cracks — real emission, but not overwhelming (0.65 vs old 3.5)
    float nightLava = 1.0 - terminator;
    vec3 lavaHot   = vec3(1.0, 0.65, 0.20);
    vec3 lavaWhite = vec3(1.0, 0.90, 0.60);
    vec3 lavaCol   = mix(lavaHot, lavaWhite, smoothstep(0.3, 0.7, lavaMask * lavaPulse));
    finalColor += lavaCol * lavaMask * lavaPulse * uEmissive * 0.65 * nightLava;
    // [2] Volcanic plume flares — white-hot eruption sites on highly active worlds
    if(uEmissive > 0.50) {
      float plumeN = smoothstep(0.88, 0.97, lavaN * 1.15 + crackN * 0.6);
      finalColor += vec3(1.0, 0.95, 0.55) * plumeN * uEmissive * 0.45;
    }
  }

  // [4] Ice cap sun sparkle — specular glint on polar ice
  if(globalIce > 0.01 && !isOcean) {
    float iceSpec = pow(max(dot(bumpN, H), 0.0), 280.0) * NdotL * 0.55 * globalIce;
    finalColor += vec3(1.0, 0.98, 0.95) * iceSpec * terminator;
  }

  // Tidal storm vortex
  if(uTidallyLocked > 0.5 && uStormIntensity > 0.01) {
    float sDist = acos(clamp(dot(pos,L),-1.0,1.0));
    float sMask = 1.0-smoothstep(0.0,radians(uStormSize),sDist);
    float sSpiral = sin(atan(pos.z,pos.x)*5.0+sDist*15.0+uTime*0.06);
    sMask *= (sSpiral*0.3+0.7);
    finalColor += vec3(0.90,0.92,0.95)*sMask*uStormIntensity*0.24;
  }

  // ---- ATMOSPHERE (surface-side Rayleigh + terminator + refraction) ----
  // Only for worlds with meaningful atmosphere (threshold raised to avoid rocky trace-gas haze)
  if(uAtmThickness > 0.14) {
    // Fade-in: effects scale smoothly from 0.14→0.30, so trace-atm worlds see nothing
    float atmFade = smoothstep(0.14, 0.30, uAtmThickness);

    float dayTerm  = smoothstep(-0.12,0.30,dot(N,L));

    // Hard limb gate — nothing visible inside 55% from edge
    float surfLimb = smoothstep(0.55, 0.92, rim);

    // Rayleigh sky-light — tint blend, not additive (no phantom brightness)
    vec3 rayleighC = uAtmColor * vec3(0.22, 0.52, 1.0);
    float dayRim   = pow(rim,3.5)*uAtmThickness*dayTerm*surfLimb*atmFade;
    // Multiply-blend: shifts color without adding light
    finalColor = mix(finalColor, finalColor * (vec3(1.0) + rayleighC * 0.30), dayRim * 0.50);

    // Aerial perspective — tint-only near edge
    float aerial = pow(rim,3.0) * uAtmThickness * dayTerm * surfLimb * 0.10 * atmFade;
    finalColor = mix(finalColor, finalColor * (uAtmColor * 0.5 + 0.55), aerial);

    // [7] Terminator glow — multiply/tint blend so it warms the surface color, not adds light
    float termA    = dot(N,L) + 0.03;
    float termGlow = exp(-termA*termA / 0.028) * uAtmThickness * atmFade;
    vec3 sunsetTint = mix(vec3(1.0), vec3(1.4, 0.75, 0.32), termGlow * surfLimb * 0.60);
    finalColor *= sunsetTint;
    // Thin sharp spike — still additive but only for thick-atm worlds (well above threshold)
    float tSpike = exp(-pow(termA * 8.5, 2.0)) * max(0.0, uAtmThickness - 0.28) * atmFade;
    finalColor += vec3(1.0, 0.38, 0.08) * tSpike * surfLimb * 0.22;

    // [6] Forward-scatter crescent — only substantial atmospheres (> 0.3)
    if(uAtmThickness > 0.28) {
      float crescentBand = exp(-pow(dot(N,L) + 0.56, 2.0) / 0.010);
      float crescentMask = pow(rim, 1.8) * crescentBand * uAtmThickness * atmFade;
      vec3 crescentCol   = uAtmColor * 1.5 + vec3(0.06, 0.03, 0.0);
      finalColor += crescentCol * crescentMask * 0.28;
    }
  }

  // ---- AURORA ----
  // [23] Proper curtain shapes with vertical structure & altitude-dependent color
  if(uAtmThickness > 0.10) {
    float aurZone = smoothstep(0.72,0.82,absLat)*(1.0-smoothstep(0.88,0.95,absLat));
    if(aurZone > 0.01) {
      // Curtain folds — undulating wave along longitude, animated drift
      float lon = atan(pos.z, pos.x);
      float curtainWave = sin(lon * 8.0 + uTime * 0.6 + uSeed * 3.0) * 0.5 + 0.5;
      curtainWave *= sin(lon * 13.0 + uTime * 0.35 + uSeed * 7.0) * 0.3 + 0.7;
      // Vertical shimmer — rapid flicker simulating electron precipitation
      float shimmer = noise3D(pos * 20.0 + vec3(0, uTime * 2.5, uSeed * 10.0));
      shimmer = smoothstep(0.3, 0.7, shimmer);
      float nightSide = 1.0 - smoothstep(-0.05, 0.15, NdotL);
      // Altitude-dependent color: green (557nm oxygen) at base,
      // red/purple (630nm oxygen + N2) at altitude
      float altFrac = smoothstep(0.72, 0.92, absLat); // proxy for altitude within auroral zone
      vec3 aurBase = vec3(0.1, 0.9, 0.3);    // green — most common
      vec3 aurMid  = vec3(0.15, 0.6, 0.5);   // teal transition
      vec3 aurTop  = vec3(0.5, 0.1, 0.7);    // purple/red — high altitude
      vec3 aurColor = mix(aurBase, aurMid, smoothstep(0.0, 0.5, altFrac));
      aurColor = mix(aurColor, aurTop, smoothstep(0.5, 1.0, altFrac));
      float aurIntensity = aurZone * curtainWave * shimmer * nightSide;
      finalColor += aurColor * aurIntensity * 0.09 * uAtmThickness;
    }
  }


  // [10] Desert shadow heat tint — warm dust scatter in shadow for dry worlds
  if(uOceanLevel < 0.08 && uAtmThickness > 0.04 && uAtmThickness < 0.55) {
    float dustShadow = (1.0 - terminator) * (1.0 - uOceanLevel * 12.0);
    finalColor += vec3(0.14, 0.06, 0.01) * dustShadow * 0.12;
  }

  // [11] Airless opposition surge — bright backscatter hotspot at antisolar point
  if(uAtmThickness < 0.04 && uOceanLevel < 0.04) {
    float backscatter = max(dot(V, L), 0.0);
    float surge = pow(backscatter, 14.0) * 0.40 * terminator;
    finalColor += color * surge;
  }

  // [8] Starlight ambient floor — dark side never pure black (cosmic background)
  finalColor = max(finalColor, vec3(0.004, 0.004, 0.006));

  // ---- PROVINCE BORDER LINE ────────────────────────────────────────────────────
  // Thin geological contact zone line at organic Voronoi province boundaries.
  // Uses provEdge (zd2-zd1 in warped space): near 0 at boundary, positive inside province.
  // Drawn on both land and ocean so the province map reads clearly across the whole world.
  // Slightly brighter at the inner edge (like a fault scarp), darker at the line center.
  if(uBiomeCount > 0.5) {
    float border = smoothstep(0.020, 0.001, provEdge);   // thin persistent line
    // Visible on lit side + faint on dark side (geological contacts don't vanish at night)
    float borderLit = smoothstep(-0.12, 0.25, dot(N, L)) * 0.60 + 0.40;
    // Darken the contact zone
    finalColor *= mix(1.0, 0.52, border * borderLit);
    // Subtle bright inner-edge highlight (fresh scarp / compositional contrast)
    float scarpEdge = smoothstep(0.020, 0.008, provEdge) * (1.0 - smoothstep(0.008, 0.001, provEdge));
    finalColor += vec3(0.38, 0.46, 0.58) * scarpEdge * 0.15 * borderLit;
  }

  // ---- BIOME ZONE SELECTION HIGHLIGHT ────────────────────────────────────────
  if(uBiomeCount > 0.5 && bZone >= 0) {
    float litFace = smoothstep(-0.08, 0.18, dot(N, L));
    if(float(bZone) == uSelectedZone && !isOcean) {
      finalColor = mix(finalColor, finalColor + vec3(0.18, 0.48, 0.82) * 0.18, litFace * 0.55);
    }
  }

  // ---- BIOME SELECTION RING ----
  if(uPickStrength > 0.001) {
    vec3 pp = normalize(uPickPos);
    float d = 1.0 - dot(pos, pp);            // 0 at center, 2 at antipode
    float ring = smoothstep(0.004, 0.015, d) * smoothstep(0.040, 0.022, d);
    float center = smoothstep(0.012, 0.0, d);
    finalColor += vec3(0.45, 0.80, 1.00) * (ring * 0.90 + center * 0.45) * uPickStrength;
  }

  // ---- SCIENCE OVERLAYS ----
  if(uShowTempMap > 0.5) {
    float sT = mix(uPolarTemp,uEquatorTemp,1.0-absLat);
    if(uTidallyLocked>0.5) sT=mix(uAntistellarTemp,uSubstellarTemp,dot(pos,L)*0.5+0.5);
    vec3 tC = sT<273.0 ? mix(vec3(0,0,1),vec3(0,1,1),sT/273.0)
            : sT<373.0 ? mix(vec3(0,1,0),vec3(1,1,0),(sT-273.0)/100.0)
            : mix(vec3(1,0.5,0),vec3(1,0,0),min((sT-373.0)/500.0,1.0));
    finalColor = mix(finalColor, tC*(0.35+dot(finalColor,vec3(0.3,0.6,0.1))*0.65), 0.72);
  }
  if(uShowMineralMap > 0.5) {
    vec3 mC = vec3(uIronPct,uSilicatePct,uWaterIcePct)*0.5+0.3;
    mC += vec3(uCarbonPct*0.3,uKreepIndex*0.5,0);
    finalColor = mix(finalColor, mC*(0.3+dot(finalColor,vec3(0.3,0.6,0.1))*0.7), 0.75);
  }

  // ---- TONE MAP (ACES-inspired, [19] adjusted shoulder/toe) + GAMMA ----
  // Slightly lifted toe for richer shadow detail, brighter mid highlights
  finalColor = finalColor * (finalColor * 2.51 + 0.04) / (finalColor * (finalColor * 2.43 + 0.55) + 0.14);
  // [20] Night-side ambient floor — ensure terrain never goes pure black
  finalColor = max(finalColor, vec3(0.015, 0.015, 0.020));
  finalColor = pow(clamp(finalColor, 0.0, 1.0), vec3(0.4545));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

export const ATM_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vPlanetCenter;
varying float vPlanetR;
varying float vAtmR;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // Planet center in world space (translation column of model matrix)
  vPlanetCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Planet surface radius in world units (= geometry scale factor × 1.0)
  vPlanetR = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  // Atmosphere radius (this sphere's geometry radius × scale)
  vAtmR = length(wp.xyz - vPlanetCenter);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATM_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uAtmColor;
uniform float uAtmThickness;
uniform vec3  uSunDir;
uniform vec3  uPlanetShineColor;

varying vec3 vWorldPos;
varying vec3 vPlanetCenter;
varying float vPlanetR;
varying float vAtmR;

// =============================================================
// Atmosphere v4 — 8-sample view-ray march through atmosphere
// volume with analytical sun optical depth.  Produces correct
// limb brightening, sunset colours, and visible halo.
// =============================================================

#define NUM_STEPS 8
#define PI 3.14159265

// Ray-sphere intersection → (tNear, tFar); both < 0 = miss
vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3  center = vPlanetCenter;
  float rP = vPlanetR;                        // planet surface radius
  float rA = vAtmR;                           // atmosphere outer radius
  float H  = rA - rP;                         // atmosphere height
  if (H < 0.0001) discard;

  vec3 ro  = cameraPosition;
  vec3 rd  = normalize(vWorldPos - cameraPosition);
  vec3 sun = normalize(uSunDir);
  float mu = dot(rd, sun);                    // view-sun cosine

  // ── Intersect view ray with atmosphere and planet ──────────
  vec2 tAtm = raySphere(ro, rd, center, rA);
  vec2 tPln = raySphere(ro, rd, center, rP);

  float tNear = max(tAtm.x, 0.0);
  float tFar  = tAtm.y;
  if (tPln.x > 0.0) tFar = min(tFar, tPln.x); // stop at planet surface
  if (tFar <= tNear) discard;

  float ds = (tFar - tNear) / float(NUM_STEPS);

  // ── Scattering coefficients (tuned for geometry scale) ─────
  float invH = 1.0 / H;

  // Rayleigh: λ^-4 wavelength dependence.  Mild tint by uAtmColor so
  // blue atmospheres stay strongly blue while exotic atm colours show.
  // [7] Reduced magnitude to avoid oversaturated blue halos
  vec3  bR = vec3(0.06, 0.16, 0.40) * invH * uAtmThickness;
  bR *= (0.50 + 0.50 * uAtmColor);

  // Mie: wavelength-independent scatter, coloured by atmosphere haze
  vec3 bM = uAtmColor * 0.035 * invH * uAtmThickness;

  // Scale heights (fraction of atmosphere height)
  float hR = 0.35;    // Rayleigh
  float hM = 0.12;    // Mie (concentrated lower)

  // ── Phase functions ────────────────────────────────────────
  float phR = (3.0 / (16.0 * PI)) * (1.0 + mu * mu);

  // Cornette-Shanks Mie phase (g = 0.55 for gentle forward glow, no hot-spot)
  float g   = 0.55;
  float g2  = g * g;
  float phM = (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu * mu))
            / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));

  // [9] Back-scatter lobe (g = -0.25) for realistic back-lit haze
  float gB  = -0.25;
  float gB2 = gB * gB;
  float phMback = (3.0 / (8.0 * PI)) * ((1.0 - gB2) * (1.0 + mu * mu))
               / ((2.0 + gB2) * pow(1.0 + gB2 - 2.0 * gB * mu, 1.5));
  phM = phM * 0.90 + phMback * 0.10; // blend forward + backward lobes

  // ── Multi-scatter approximation ─────────────────────────────
  // Real atmospheres scatter blue light back into long view paths
  // via higher-order bounces.  We approximate this by dampening
  // the view-path extinction (ms < 1).  Sun-path extinction stays
  // at full strength so sunsets are correctly reddened.
  float ms = 0.25;

  // ── March along view ray ───────────────────────────────────
  vec3  scatter = vec3(0.0);
  float odR = 0.0, odM = 0.0;           // accumulated view optical depth

  for (int i = 0; i < NUM_STEPS; i++) {
    float t  = tNear + (float(i) + 0.5) * ds;
    vec3  P  = ro + rd * t;
    float alt = (length(P - center) - rP) / H; // normalised altitude 0-1

    float dR = exp(-alt / hR) * ds;      // Rayleigh density × step
    float dM = exp(-alt / hM) * ds;      // Mie density × step
    odR += dR;
    odM += dM;

    // ── Sun illumination reaching this sample ──────────────
    vec3 Pn     = normalize(P - center);
    float sunCos = dot(Pn, sun);

    if (sunCos > -0.08) {
      // Analytical sun path optical depth (plane-parallel approx)
      float sf = 1.0 / max(sunCos + 0.08, 0.012);
      sf = min(sf, 55.0);                 // cap to prevent fireflies
      float sR = exp(-alt / hR) * H * hR * sf;
      float sM = exp(-alt / hM) * H * hM * sf;

      // Sun-path extinction at full strength (correct sunset reddening)
      vec3 sunAttn = exp(-(bR * sR + bM * sM));

      // View-path extinction with multi-scatter dampening
      // (prevents blue from being killed along long limb rays)
      vec3 viewAttn = exp(-(bR * odR + bM * odM) * ms);

      // [8] Sunset color injection near terminator
      // When sun is near horizon (sunCos ~ 0), inject orange/red tint
      float sunsetFactor = exp(-sunCos * sunCos / 0.025) * step(-0.08, sunCos);
      vec3 sunsetTint = mix(vec3(1.0), vec3(1.0, 0.55, 0.22), sunsetFactor * 0.25);

      scatter += (dR * bR * phR + dM * bM * phM) * sunAttn * viewAttn * sunsetTint;
    }
  }

  // ── Alpha from total view optical depth (dampened) ─────────
  float od = dot(bR * odR + bM * odM, vec3(0.33)) * ms;
  float alpha = 1.0 - exp(-od * 2.5);
  // Ensure bright scatter regions stay visible after blending
  alpha = max(alpha, length(scatter) * 0.45);
  float maxA = 0.35 + uAtmThickness * 0.55;

  gl_FragColor = vec4(scatter, clamp(alpha, 0.0, maxA));
}
`;
