/**
 * solid.frag.ts — World fragment shader (solid + gas giant paths).
 *
 * Clean rewrite v4. Helper functions (noise, terrain, gas giant) preserved.
 * Solid world main path rewritten from scratch with correct architecture.
 *
 * Critical fix: ice cap formula was (1.0 - iceCaps*0.55) causing caps to
 * start at latitude 46° (half the planet). Now (1.0 - iceCaps*0.12):
 *   iceCaps=0.5 (super-earth) → ice above lat 72°  ✓
 *   iceCaps=0.7 (earth-like)  → ice above lat 67°  ✓
 *   iceCaps=1.0 (maximum)     → ice above lat 61°  ✓
 */

import { NOISE_GLSL } from './noise';

// precision MUST come before all function definitions — place it before NOISE_GLSL
export const WORLD_FRAG = 'precision highp float;\n' + NOISE_GLSL + /* glsl */`

// =============================================================
// ProceduralWorld FRAG v4 — Clean solid + gas giant renderer
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
uniform vec3  uBiomeCenters[32];
uniform float uBiomeCount;
uniform float uSelectedZone;
uniform float uAxialTilt;

varying vec3  vObjPos;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vFresnel;

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
// TERRAIN HEIGHT — domain-warped with tectonic plates
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

  if(uTectonics > 0.02) {
    vec3 vp = voronoiPlates(pos, sc * 0.7 + uSeed * 0.01);
    float plateH = fract(vp.z * 7.13) * 0.4 - 0.15;
    float edgeNoise = noise3D(pos * 8.0 + uSeed * 2.7) * 0.5 + 0.5;
    float edgeWidth = mix(0.04, 0.14, edgeNoise);
    float edgeBreak = smoothstep(0.25, 0.45, noise3D(pos * 3.2 + uSeed * 5.1));
    float edge = smoothstep(0.0, edgeWidth, vp.y);
    float edgeMask = (1.0 - edge) * edgeBreak;
    h += plateH * uTectonics * 0.25;
    h += edgeMask * uTectonics * 0.12;
    float riftBias = fract(vp.z * 13.7);
    if(riftBias > 0.6)
      h -= edgeMask * uTectonics * 0.08;
  }

  if(uMountainHeight > 0.01)
    h += ridgedFbm(pos*sc*2.0 + uSeed + 200.0) * uMountainHeight * 0.30;

  if(uValleyDepth > 0.01)
    h -= smoothstep(0.45,0.55,fbm3(pos*sc*1.5+uSeed+300.0)) * uValleyDepth * 0.15;

  if(uCraterDensity > 0.01) {
    vec3 cp = pos*sc*3.0 + uSeed;
    vec3 ci = floor(cp), cf = fract(cp);
    float md = 1.0;
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

  if(uVolcanism > 0.01)
    h += smoothstep(0.62,0.82,fbm3(pos*sc*0.8+uSeed+500.0)) * uVolcanism * 0.18;

  if(uCrackIntensity > 0.01) {
    vec3 crWarp = pos*sc*3.5 + uSeed + 400.0;
    crWarp += vec3(noise3D(pos*sc*1.8+uSeed+410.0),
                   noise3D(pos*sc*1.8+uSeed+420.0),
                   noise3D(pos*sc*1.8+uSeed+430.0)) * 0.35;
    float cr = abs(noise3D(crWarp)*2.0-1.0);
    float crWidth = 0.06 + noise3D(pos*sc*2.0+uSeed+440.0) * 0.05;
    float crBreak = smoothstep(0.2, 0.5, noise3D(pos*sc*1.2+uSeed+450.0));
    h -= (1.0-smoothstep(0.0, crWidth, cr)) * uCrackIntensity * 0.06 * crBreak;
  }

  h = mix(h, h*0.7+0.15, (1.0-uTerrainAge)*0.3);
  return h;
}

// =============================================================
// GAS GIANT
// =============================================================
vec3 gasGiantColor(vec3 pos) {
  float lat = pos.y;
  float seed = uSeed;
  float bf = 4.5 + sin(seed*7.13)*1.5;

  float windAngle = cos(asin(clamp(lat,-1.0,1.0))) * uTime * 0.12;
  vec3 wpos = vec3(
    pos.x * cos(windAngle) - pos.z * sin(windAngle),
    pos.y,
    pos.x * sin(windAngle) + pos.z * cos(windAngle));

  float tEvol = uTime * 0.04;
  vec3 evolOffset = vec3(sin(tEvol*0.7)*0.3, 0.0, cos(tEvol*1.1)*0.3);

  float bands  = sin(lat*bf + fbm3(wpos*2.5+seed+evolOffset)*1.6);
  float bands2 = sin(lat*bf*1.7+1.0 + fbm3(wpos*4.0+seed+80.0+evolOffset*0.7)*0.7);
  float turb = fbm5(wpos*5.0 + vec3(0,tEvol*0.5,seed+100.0));
  float turbFine = fbm3(wpos*10.0 + vec3(0,tEvol*0.8,seed+200.0));
  float shear = noise3D(vec3(lat*3.5, uTime*0.05, seed))*0.22;

  float bandEdge = abs(fract(lat*bf*0.5/(3.14159*2.0)+0.5)-0.5)*2.0;
  float chevronZone = smoothstep(0.0, 0.18, bandEdge) * (1.0 - smoothstep(0.18, 0.40, bandEdge));
  float lon = atan(wpos.z, wpos.x);
  float chevron = sin(lon * 8.0 + lat * 18.0 + turb * 6.0 + uTime * 0.22) * 0.5 + 0.5;
  float chevronFine = sin(lon * 13.0 - lat * 12.0 + turbFine * 4.5 + uTime * 0.30) * 0.3 + 0.5;
  float festoon = chevronZone * (chevron * 0.6 + chevronFine * 0.4);

  float bandMix = bands*0.65 + bands2*0.18 + shear;
  bandMix += (turb-0.5)*0.42 + (turbFine-0.5)*0.14;
  bandMix += festoon * 0.22;

  float beltZone = sin(lat*bf*0.5)*0.5+0.5;
  vec3 beltCol = uColor1 * 0.50;
  vec3 zoneCol = uColor2 * 1.40;

  vec3 col = mix(beltCol, zoneCol, beltZone*0.50+0.20);
  col = mix(col, mix(uColor1, uColor2, smoothstep(-0.8,0.8,bandMix)), 0.40);
  col = mix(col, uColor3, smoothstep(0.55,0.72,turb)*0.40);

  float sLat = 0.35 + sin(seed*3.14)*0.2;
  float sLon = seed * 1.618 + uTime * 0.07;
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
    float gasLum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gasLum), color, 1.35);
    float fineBand = sin(pos.y * 48.0 + uTime * 0.014 + uSeed * 6.3) * 0.5 + 0.5;
    color *= 0.95 + fineBand * 0.08;
    float NdotL = max(dot(N,L),0.0);
    float term  = smoothstep(-0.05,0.18,NdotL);
    color *= 1.0 - smoothstep(0.55, 0.90, absLat) * 0.25;
    finalColor  = color * NdotL * 0.95 * term + color * 0.02;
    vec3 specTint = mix(vec3(1.0), uAtmColor * 0.5 + 0.5, 0.3);
    finalColor += specTint * pow(max(dot(N,H),0.0),120.0) * 0.06 * term;
    finalColor += (uAtmColor*0.6+vec3(0.05,0.08,0.12)) * pow(rim,3.0) * 0.20 * term;
    finalColor *= 1.0 - pow(rim,4.0)*0.40;
    finalColor  = finalColor*(finalColor*2.51+0.03)/(finalColor*(finalColor*2.43+0.59)+0.14);
    gl_FragColor = vec4(clamp(finalColor,0.0,1.0),1.0);
    return;
  }

  // ══════════════════════════════════════════════════════════
  // SOLID WORLD PATH — v4 clean architecture
  // ══════════════════════════════════════════════════════════

  // ── 1. PROVINCE ZONES ─────────────────────────────────────
  // Domain-warped Voronoi for organic zone boundaries
  vec3 ow = vec3(fbm3(pos*2.4+uSeed*0.009+17.3),
                 fbm3(pos*2.4+uSeed*0.009+43.7),
                 fbm3(pos*2.4+uSeed*0.009+81.2)) * 2.0 - 1.0;
  vec3 wpos = normalize(pos + ow * 0.45);

  float provEdge = 999.0;
  vec3  zoneChar = vec3(0.5, 0.5, 0.5);
  int   bZone    = -1;

  if(uBiomeCount > 0.5) {
    int   count = int(uBiomeCount);
    float zd1 = 999.0, zd2 = 999.0;
    int   zi1 = 0,     zi2 = 0;
    for(int i = 0; i < 32; i++) {
      if(i >= count) break;
      float d = 1.0 - dot(wpos, uBiomeCenters[i]);
      if(d < zd1) { zd2=zd1; zi2=zi1; zd1=d; zi1=i; }
      else if(d < zd2) { zd2=d; zi2=i; }
    }
    bZone    = zi1;
    provEdge = zd2 - zd1;
    float bz1 = float(zi1), bz2 = float(zi2);
    vec3 zc1 = vec3(fract(sin(bz1*127.1+uSeed)*43758.5),
                    fract(sin(bz1*311.7+uSeed*0.37)*43758.5),
                    fract(sin(bz1*491.3+uSeed*0.71)*43758.5));
    vec3 zc2 = vec3(fract(sin(bz2*127.1+uSeed)*43758.5),
                    fract(sin(bz2*311.7+uSeed*0.37)*43758.5),
                    fract(sin(bz2*491.3+uSeed*0.71)*43758.5));
    float blendW = 1.0 - smoothstep(0.0, 0.10, zd2-zd1);
    zoneChar = mix(zc1, zc2, blendW * 0.88);
  }

  // Zone-derived factors
  float contFactor   = smoothstep(0.72, 0.40, uOceanLevel);
  float elevBiasAmp  = mix(0.06, 0.24, contFactor);
  float zoneElevBias = (zoneChar.x - 0.5) * elevBiasAmp;

  // ── 2. TERRAIN + BUMP ─────────────────────────────────────
  float eps = 0.005;
  float h   = terrainHeight(pos);
  float hX  = terrainHeight(normalize(pos + vec3(eps, 0, 0)));
  float hZ  = terrainHeight(normalize(pos + vec3(0, 0, eps)));
  vec3  dH  = vec3(h-hX, 0.0, h-hZ);
  dH.y = -(dH.x + dH.z) * 0.5;
  float slope = length(dH) * 110.0;

  // Airless worlds: ancient smooth surfaces, damp bump
  float airlessScale = smoothstep(0.10, 0.0, uAtmThickness);
  float bumpAmp = mix(3.5, 15.0, zoneChar.y) * mix(1.0, 0.28, airlessScale);
  vec3  bumpN   = normalize(N + dH * bumpAmp);
  float NdotL   = max(dot(bumpN, L), 0.0);

  // ── 3. OCEAN / LAND ────────────────────────────────────────
  float shoreN    = noise3D(pos*18.0+uSeed*3.3)*0.012
                  + noise3D(pos*36.0+uSeed*5.1)*0.006;
  float effOcean  = uOceanLevel + shoreN;
  float underwaterDepth = effOcean - h;
  float shoreBlend = smoothstep(-0.04, 0.03, underwaterDepth);
  bool  isOcean   = shoreBlend > 0.01;

  // ── 4. SURFACE COLOR ───────────────────────────────────────
  vec3 color;

  if(isOcean) {
    // ── OCEAN: depth-graded color ──────────────────────────
    float depth01  = clamp(underwaterDepth / max(uOceanLevel, 0.01), 0.0, 1.0);
    vec3  shallowC = uOceanColor * 1.38 + vec3(0.03, 0.07, 0.04);
    vec3  deepC    = uOceanColor * 0.32;
    color = mix(shallowC, deepC, smoothstep(0.0, 0.50, depth01));

    // Seafloor topology visible through shallow water
    float seaH = clamp((h + zoneElevBias*0.6) / max(effOcean,0.01), 0.0, 1.0);
    float ridge   = smoothstep(0.55, 0.90, seaH);
    float abyssal = smoothstep(0.45, 0.10, seaH);
    float shelfBoost = smoothstep(0.40, 0.75, zoneChar.x) * 0.45;
    ridge = clamp(ridge + shelfBoost*(1.0-depth01), 0.0, 1.0);
    float waterOpacity = smoothstep(0.0, 0.60, depth01);
    color = mix(color, color*1.28+vec3(0.03,0.06,0.02), ridge*(1.0-waterOpacity)*0.40);
    color = mix(color, deepC*0.62, abyssal*waterOpacity*0.28);

    // Shore foam
    float foam = 1.0 - smoothstep(0.0, 0.014, underwaterDepth);
    foam *= noise3D(pos*60.0+uTime*0.5)*0.65+0.35;
    color = mix(color, vec3(0.86,0.91,0.95), foam*0.45);

    // Sandy shallows
    float sandyS = smoothstep(0.0,0.025,underwaterDepth)*(1.0-smoothstep(0.025,0.08,underwaterDepth));
    color = mix(color, uOceanColor*1.18+vec3(0.08,0.06,0.03), sandyS*0.28);

    // Wave normals
    vec3 wp1 = cloudWarp(pos, 0.02) * 45.0;
    vec3 wp2 = cloudWarp(pos, -0.015) * 30.0;
    float w1 = noise3D(wp1+uSeed)*2.0-1.0;
    float w2 = noise3D(wp2+uSeed+50.0)*2.0-1.0;
    bumpN  = normalize(N + vec3(w1,0,w2) * 0.055 * (1.0-depth01*0.75));
    NdotL  = max(dot(bumpN, L), 0.0);

    // Ocean sun-glint
    vec3  oceanH     = normalize(L + V);
    float oceanNdotH = max(dot(bumpN, oceanH), 0.0);
    float glintFresnel = 0.04 + 0.96*pow(1.0-max(dot(bumpN,V),0.0),5.0);
    color += vec3(1.0,0.98,0.92) * (pow(oceanNdotH,300.0)*0.50 + pow(oceanNdotH,48.0)*0.07)
           * glintFresnel * (1.0-depth01*0.55);

  } else {
    // ── LAND: zone texture splat ───────────────────────────
    // 5 textures bilinear-blended by zone elevation × roughness
    float elev  = zoneChar.x;
    float rough = zoneChar.y;

    float w0 = (1.0-elev) * (1.0-rough);                    // low+smooth: plains/mare
    float w1 = (1.0-elev) * rough;                          // low+rough: lava/rift
    float w2 = clamp(1.0-2.0*abs(elev-0.5),0.0,1.0)
             * clamp(1.0-2.0*abs(rough-0.5),0.0,1.0);      // mid+mid: transition
    float w3 = elev * (1.0-rough);                          // high+smooth: highlands
    float w4 = elev * rough;                                 // high+rough: mountains
    float wSum = max(w0+w1+w2+w3+w4, 0.001);

    vec3 zt0 = triplanarSample(uZoneTex0, pos, N, uZoneTexScale);
    vec3 zt1 = triplanarSample(uZoneTex1, pos, N, uZoneTexScale*1.15);
    vec3 zt2 = triplanarSample(uZoneTex2, pos, N, uZoneTexScale*0.85);
    vec3 zt3 = triplanarSample(uZoneTex3, pos, N, uZoneTexScale*1.05);
    vec3 zt4 = triplanarSample(uZoneTex4, pos, N, uZoneTexScale*1.30);
    color = (zt0*w0 + zt1*w1 + zt2*w2 + zt3*w3 + zt4*w4) / wSum;

    // Zone albedo multiplier (subtle brightness variation by archetype)
    float zA = clamp(mix(0.92, 1.15, elev*0.65+rough*0.20+zoneChar.z*0.15), 0.90, 1.15);
    color *= zA;

    // Planet hue tint — 20% blend preserves zone texture identity
    float tH = clamp(h + zoneElevBias, 0.0, 1.0);
    vec3  hueBase = mix(uColor1, mix(uColor2, uColor3, tH*0.8), tH);
    float hueLum  = max(dot(hueBase, vec3(0.299,0.587,0.114)), 0.001);
    color = mix(color, color * (hueBase / hueLum), 0.20);

    // Slope: exposed rock face on steep terrain
    float slopeRough = smoothstep(0.20, 0.55, slope);
    color = mix(color, zt1 * zA * 0.52, slopeRough * 0.40);

    // Polar toning: subtle cool shift toward poles
    color = mix(color, mix(color, vec3(0.76,0.79,0.86), 0.18),
                smoothstep(0.50, 0.85, absLat));

    // Crater ejecta rays
    if(uCraterDensity > 0.01) {
      vec3 ecp = pos * uNoiseScale * 3.0 + uSeed;
      vec3 eci = floor(ecp), ecf = fract(ecp);
      float eDist = 1.0;
      vec3  eCenter = vec3(0.0);
      for(int x=-1;x<=1;x++)
        for(int y=-1;y<=1;y++)
          for(int z=-1;z<=1;z++){
            vec3 g = vec3(float(x),float(y),float(z));
            vec3 o = fract(sin(vec3(
              dot(eci+g,vec3(127.1,311.7,74.7)),
              dot(eci+g,vec3(269.5,183.3,246.1)),
              dot(eci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
            float d = length(g+o-ecf);
            if(d < eDist) { eDist=d; eCenter=g+o; }
          }
      vec3  toCenter = normalize(ecf - eCenter);
      float rayAngle = atan(toCenter.z, toCenter.x);
      float rays = sin(rayAngle*7.0 + fract(sin(dot(eci,vec3(37.1,91.7,53.3)))*43758.5)*6.28)*0.5+0.5;
      rays = smoothstep(0.55, 0.85, rays);
      float ejectaZone = smoothstep(0.18,0.25,eDist)*(1.0-smoothstep(0.25,0.55,eDist));
      float freshness  = step(0.5, fract(sin(dot(eci,vec3(71.3,23.9,17.1)))*43758.5));
      float craterWt   = mix(0.08, 1.0, rough*0.7+elev*0.3);
      color += vec3(0.12,0.10,0.08)*rays*ejectaZone*freshness*uCraterDensity*0.6*craterWt;
    }

    // Vegetation
    if(length(uFoliageColor) > 0.01) {
      float veg = smoothstep(0.32,0.54,h) * (1.0-smoothstep(0.58,0.78,h));
      veg *= clamp(1.0-absLat*1.4, 0.0, 1.0);
      veg *= clamp(1.0-slope*2.5, 0.0, 1.0);
      float land = step(0.0, underwaterDepth - 0.01);
      float vegP = voronoiPlates(pos, uNoiseScale*0.55+uSeed*0.005).z;
      float vegPlate = step(0.25, vegP) * step(vegP, 0.85);
      color = mix(color, uFoliageColor, veg*land*vegPlate*0.55);
    }

    // Shore transition
    color = mix(color, uOceanColor*0.78+0.05, shoreBlend*0.55);
  }

  // ── 5. ICE CAPS ────────────────────────────────────────────
  // FIXED: multiplier 0.12 (not 0.55) gives correct polar cap size.
  // iceCaps=0.5 → iceLine=0.940 → ice above lat 70°  ✓
  // iceCaps=0.7 → iceLine=0.916 → ice above lat 66°  ✓
  float globalIce = 0.0;
  if(uIceCaps > 0.01) {
    float iceLine = 1.0 - uIceCaps * 0.12;
    float iceWarp = fbm3(pos*5.0+uSeed+50.0) * 0.04;  // subtle edge roughness

    // Axial-tilt: shift ice caps toward actual rotational pole
    vec3  tiltedPole = normalize(vec3(sin(uAxialTilt), cos(uAxialTilt), 0.0));
    float tiltedLat  = abs(dot(pos, tiltedPole));
    float tiltWeight = smoothstep(0.08, 0.45, uAxialTilt);
    float effectiveLat = mix(absLat, tiltedLat, tiltWeight);

    float ice = smoothstep(iceLine-0.04, iceLine+0.04, effectiveLat + iceWarp);
    ice *= uIsIceWorld > 0.5 ? 0.25 : 1.0;  // ice worlds use base color, not cap overlay
    globalIce = ice;

    if(ice > 0.001) {
      // Ice color: bright white at fresh poles, blue-tinted older ice inward
      vec3 iceCol = mix(vec3(0.88,0.92,0.96), vec3(0.66,0.79,0.94),
                        smoothstep(iceLine, iceLine+0.16, effectiveLat) * 0.45);
      // Subsurface scattering: translucent blue at glancing angles
      float iceSS = pow(1.0-max(dot(N,V),0.0), 3.0);
      iceCol += vec3(0.10,0.20,0.36) * iceSS * 0.20 * max(dot(N,L),0.0);
      // For frost worlds: tint by base surface color
      if(uIsIceWorld > 0.5) iceCol = mix(iceCol, color*1.10, 0.28);
      // Glacier crevasses
      float glacier = abs(noise3D(pos*24.0+uSeed+60.0)*2.0-1.0);
      iceCol -= smoothstep(0.0, 0.10, glacier) * 0.04;
      color = mix(color, iceCol, ice);
    }
  }

  // ── 6. TIDALLY LOCKED EYEBALL ──────────────────────────────
  if(uTidallyLocked > 0.5 && uSpinOrbit32 < 0.5) {
    float facing   = dot(pos, L);
    float iceWarpT = fbm3(pos*6.0+uSeed+150.0)*0.20;
    float iceMask  = smoothstep(0.12,-0.55, facing+iceWarpT);
    vec3  tidalIce = mix(vec3(0.82,0.86,0.94),vec3(0.55,0.68,0.88),
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

  // ── 7. LIGHTING ────────────────────────────────────────────
  float terminator = smoothstep(-0.08, 0.22, NdotL);
  float ao         = 0.87 + 0.13 * smoothstep(0.35, 0.65, h);
  // Airless worlds get a slight ambient boost (opposition surge, planetshine)
  float ambientAmt  = mix(0.13, 0.22, airlessScale);
  vec3  ambient     = color * ambientAmt * ao;
  vec3  diffuse     = color * NdotL * 0.87;
  finalColor = diffuse * terminator + ambient;

  // ── 8. SPECULAR ────────────────────────────────────────────
  if(isOcean) {
    float f0       = 0.02;
    float fresnelO = f0 + (1.0-f0)*pow(1.0-max(dot(bumpN,V),0.0),5.0);
    float specO    = pow(max(dot(bumpN,H),0.0),280.0) * (0.38+fresnelO*0.42);
    finalColor += vec3(specO) * terminator;
    float wideG = pow(max(dot(bumpN,H),0.0),40.0) * fresnelO * 0.10;
    finalColor += vec3(wideG) * terminator;
    // Sub-surface scatter
    finalColor += uOceanColor * pow(max(dot(-bumpN,L),0.0),3.0)*0.07*terminator;
  } else {
    finalColor += vec3(pow(max(dot(bumpN,H),0.0),40.0)*0.035) * terminator;
  }

  // Ice cap sparkle
  if(globalIce > 0.001 && !isOcean) {
    float iceSpec = pow(max(dot(bumpN,H),0.0),240.0) * NdotL * 0.45 * globalIce;
    finalColor += vec3(1.0,0.97,0.94) * iceSpec * terminator;
  }

  // ── 9. LAVA EMISSION ───────────────────────────────────────
  if(uEmissive > 0.01) {
    vec3  lavaWarp = pos*uNoiseScale*2.0+uSeed+80.0;
    lavaWarp += vec3(sin(uTime*0.08)*0.15, cos(uTime*0.06)*0.12, sin(uTime*0.10)*0.10);
    float lavaN  = fbm3(lavaWarp);
    float crackN = noise3D(pos*uNoiseScale*5.0+uSeed+120.0);
    float lavaMask  = smoothstep(0.43,0.58,lavaN)*smoothstep(0.35,0.50,crackN);
    float lavaPulse = 0.75+0.25*sin(uTime*1.2+lavaN*12.0+pos.x*5.0);
    finalColor = mix(finalColor, finalColor*0.45, lavaMask*0.40*terminator);
    float nightLava = 1.0 - terminator;
    vec3 lavaCol = mix(vec3(1.0,0.65,0.20), vec3(1.0,0.90,0.60),
                       smoothstep(0.3,0.7,lavaMask*lavaPulse));
    finalColor += lavaCol * lavaMask * lavaPulse * uEmissive * 0.65 * nightLava;
    if(uEmissive > 0.50) {
      float plumeN = smoothstep(0.88,0.97,lavaN*1.15+crackN*0.6);
      finalColor += vec3(1.0,0.95,0.55)*plumeN*uEmissive*0.45;
    }
  }

  // ── 10. ATMOSPHERE RIM ─────────────────────────────────────
  if(uAtmThickness > 0.14) {
    float atmFade  = smoothstep(0.14, 0.32, uAtmThickness);
    float dayTerm  = smoothstep(-0.12, 0.28, dot(N,L));
    float surfLimb = smoothstep(0.55, 0.92, rim);

    // Rayleigh sky-light tint
    vec3  rayleighC = uAtmColor * vec3(0.22,0.52,1.0);
    float dayRim    = pow(rim,3.5)*uAtmThickness*dayTerm*surfLimb*atmFade;
    finalColor = mix(finalColor, finalColor*(vec3(1.0)+rayleighC*0.28), dayRim*0.45);

    // Aerial perspective
    float aerial = pow(rim,3.0)*uAtmThickness*dayTerm*surfLimb*0.09*atmFade;
    finalColor = mix(finalColor, finalColor*(uAtmColor*0.5+0.55), aerial);

    // Terminator glow
    float termA    = dot(N,L) + 0.03;
    float termGlow = exp(-termA*termA/0.028) * uAtmThickness * atmFade;
    vec3  sunsetT  = mix(vec3(1.0), vec3(1.38,0.72,0.28), termGlow*surfLimb*0.58);
    finalColor *= sunsetT;
    float tSpike = exp(-pow(termA*8.5,2.0)) * max(0.0,uAtmThickness-0.28) * atmFade;
    finalColor += vec3(1.0,0.38,0.08)*tSpike*surfLimb*0.20;

    // Forward-scatter crescent (thick atmospheres only)
    if(uAtmThickness > 0.28) {
      float crescBand = exp(-pow(dot(N,L)+0.56,2.0)/0.010);
      float crescMask = pow(rim,1.8)*crescBand*uAtmThickness*atmFade;
      finalColor += (uAtmColor*1.45+vec3(0.05,0.03,0.0))*crescMask*0.26;
    }
  }

  // ── 11. AURORA ─────────────────────────────────────────────
  if(uAtmThickness > 0.10) {
    float aurZone = smoothstep(0.72,0.82,absLat)*(1.0-smoothstep(0.88,0.95,absLat));
    if(aurZone > 0.01) {
      float aLon = atan(pos.z,pos.x);
      float curtain = sin(aLon*8.0+uTime*0.60+uSeed*3.0)*0.5+0.5;
      curtain *= sin(aLon*13.0+uTime*0.35+uSeed*7.0)*0.3+0.7;
      float shimmer = smoothstep(0.3,0.7,noise3D(pos*20.0+vec3(0,uTime*2.5,uSeed*10.0)));
      float nightSide = 1.0 - smoothstep(-0.05,0.15,NdotL);
      float altFrac   = smoothstep(0.72,0.92,absLat);
      vec3 aurColor = mix(mix(vec3(0.1,0.9,0.3),vec3(0.15,0.6,0.5),
                              smoothstep(0.0,0.5,altFrac)),
                          vec3(0.5,0.1,0.7), smoothstep(0.5,1.0,altFrac));
      finalColor += aurColor*aurZone*curtain*shimmer*nightSide*0.09*uAtmThickness;
    }
  }

  // Desert shadow heat tint
  if(uOceanLevel < 0.08 && uAtmThickness > 0.04 && uAtmThickness < 0.55) {
    finalColor += vec3(0.14,0.06,0.01)*(1.0-terminator)*(1.0-uOceanLevel*12.0)*0.11;
  }

  // Airless opposition surge
  if(uAtmThickness < 0.04 && uOceanLevel < 0.04) {
    finalColor += color * pow(max(dot(V,L),0.0),14.0) * 0.38 * terminator;
  }

  // Night-side floor
  finalColor = max(finalColor, vec3(0.004,0.004,0.006));

  // ── 12. PROVINCE BORDERS ───────────────────────────────────
  if(uBiomeCount > 0.5) {
    float border    = smoothstep(0.018, 0.001, provEdge);
    float borderLit = smoothstep(-0.12, 0.25, dot(N,L))*0.55 + 0.45;
    finalColor *= mix(1.0, 0.50, border * borderLit);
    float scarp = smoothstep(0.018,0.008,provEdge)*(1.0-smoothstep(0.008,0.001,provEdge));
    finalColor += vec3(0.28,0.35,0.44)*scarp*0.16*borderLit;
  }

  // ── 13. ZONE SELECTION HIGHLIGHT ───────────────────────────
  if(uBiomeCount > 0.5 && bZone >= 0) {
    float litFace = smoothstep(-0.08, 0.18, dot(N,L));
    if(float(bZone) == uSelectedZone && !isOcean)
      finalColor = mix(finalColor, finalColor+vec3(0.18,0.48,0.82)*0.18, litFace*0.55);
  }

  // ── 14. BIOME PICK RING ─────────────────────────────────────
  if(uPickStrength > 0.001) {
    float pd   = 1.0 - dot(normalize(pos), normalize(uPickPos));
    float ring = smoothstep(0.004,0.015,pd)*smoothstep(0.040,0.022,pd);
    float cent = smoothstep(0.012,0.0,pd);
    finalColor += vec3(0.45,0.80,1.00)*(ring*0.90+cent*0.45)*uPickStrength;
  }

  // ── 15. SCIENCE OVERLAYS ───────────────────────────────────
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

  // ── 16. TONE MAP + GAMMA ───────────────────────────────────
  // ACES-inspired filmic tone mapping
  finalColor = finalColor*(finalColor*2.51+0.04)/(finalColor*(finalColor*2.43+0.55)+0.14);
  finalColor = max(finalColor, vec3(0.015,0.015,0.020));
  finalColor = pow(clamp(finalColor,0.0,1.0), vec3(0.4545));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// Alias for backwards compat
export const FRAG = WORLD_FRAG;
