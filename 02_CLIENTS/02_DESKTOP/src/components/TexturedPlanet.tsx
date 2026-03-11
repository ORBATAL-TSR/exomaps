/**
 * TexturedPlanet v3 — Perlin-noise base + texture stamp/decal system
 * with heightmap-aware blending, color matching, and Rayleigh scattering.
 *
 * Architecture:
 *   1. BASE layer:   Equirectangular texture mapped to sphere, tinted by
 *                    multi-octave Perlin noise for organic color variation.
 *   2. STAMP layer:  N stamp decals scattered at seed-deterministic positions.
 *                    Each stamp is a square texture projected onto the sphere
 *                    as a spherical cap. Edges are feathered using:
 *                    - Distance-from-center falloff
 *                    - Perlin noise dithering for organic borders
 *                    - Heightmap-aware blending (stamps prefer similar heights)
 *                    - Color/luminance matching at edges
 *   3. LIQUID layer: Semi-transparent ocean below a heightmap threshold
 *                    with depth-based coloring.
 *   4. ATMOSPHERE:   Physically-based Rayleigh + Mie scattering shell.
 *
 * Falls back to ProceduralPlanet for gas giants.
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getWorldPalette, getStarColor, textureUrl, GAS_TYPES,
  type WorldPalette, type StampTexture,
} from '../data/textureManifest';
import ProceduralPlanet from './ProceduralPlanet';

/* ── Types ──────────────────────────────────────────── */

interface Props {
  planetType: string;
  temperature?: number;
  seed?: number;
  sunDirection?: [number, number, number];
  rotationSpeed?: number;
  colorShift?: [number, number, number];
  mass?: number;
  tidalHeating?: number;
  starSpectralClass?: string;
  displacement?: number;
  segments?: number;
  tidallyLocked?: boolean;
  spinOrbit32?: boolean;
  showTempMap?: boolean;
  showMineralMap?: boolean;
  tempDistribution?: any;
  mineralAbundance?: any;
  planetShineColor?: [number, number, number];
}

/* ── Texture loader / cache ─────────────────────────── */

const _loader = new THREE.TextureLoader();
const _cache = new Map<string, THREE.Texture>();
const _failed = new Set<string>();

const _placeholder1x1 = (() => {
  const d = new Uint8Array([128, 128, 128, 255]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();
const _flatNormal1x1 = (() => {
  const d = new Uint8Array([128, 128, 255, 255]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

function loadTex(url: string, srgb = true): Promise<THREE.Texture | null> {
  if (_failed.has(url)) return Promise.resolve(null);
  if (_cache.has(url)) return Promise.resolve(_cache.get(url)!);
  return new Promise(resolve => {
    _loader.load(
      url,
      tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        tex.generateMipmaps = true;
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        _cache.set(url, tex);
        resolve(tex);
      },
      undefined,
      () => { _failed.add(url); resolve(null); },
    );
  });
}

/* ── Loaded texture bundle ──────────────────────────── */

/** Maximum stamps we can pass to the GPU at once */
const MAX_GPU_STAMPS = 6;

interface LoadedPlanet {
  baseDiffuse: THREE.Texture;
  baseNormal: THREE.Texture;
  baseHeight: THREE.Texture;
  stampDiffuse: THREE.Texture[];   // up to MAX_GPU_STAMPS
  stampNormals: THREE.Texture[];   // up to MAX_GPU_STAMPS
  stampHeight: THREE.Texture[];    // up to MAX_GPU_STAMPS
  stampMeta: StampTexture[];       // metadata for loaded stamps
  liquidDiffuse: THREE.Texture | null;
  palette: WorldPalette;
}

/**
 * Deterministically select which stamps to instantiate on this world.
 * Uses the seed to pick from the weighted pool, respecting band preferences.
 */
function selectStamps(stamps: StampTexture[], count: number, seed: number): StampTexture[] {
  if (stamps.length === 0) return [];
  // Simple seeded PRNG
  let s = Math.abs(seed * 2654435761) >>> 0;
  const rng = () => { s = (s * 1103515245 + 12345) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; };

  // Weighted random selection (with replacement to fill count)
  const totalW = stamps.reduce((a, s) => a + s.weight, 0);
  const selected: StampTexture[] = [];
  for (let i = 0; i < count; i++) {
    let r = rng() * totalW;
    for (const st of stamps) {
      r -= st.weight;
      if (r <= 0) { selected.push(st); break; }
    }
    if (selected.length <= i) selected.push(stamps[0]);
  }
  return selected;
}

/**
 * Deduplicate stamps to unique textures (max MAX_GPU_STAMPS).
 * Returns the unique stamps whose textures we need to load.
 */
function uniqueStampTextures(stamps: StampTexture[]): StampTexture[] {
  const seen = new Set<string>();
  const uniq: StampTexture[] = [];
  for (const s of stamps) {
    if (!seen.has(s.id) && uniq.length < MAX_GPU_STAMPS) {
      seen.add(s.id);
      uniq.push(s);
    }
  }
  return uniq;
}

function usePlanetTextures(
  planetType: string, temperature: number, seed: number,
): LoadedPlanet | 'loading' | null {
  const palette = useMemo(
    () => getWorldPalette(planetType, temperature),
    [planetType, temperature],
  );

  const stampCount = palette.stampCount ?? 8;
  const selectedStamps = useMemo(
    () => selectStamps(palette.stamps, stampCount, seed),
    [palette.stamps, stampCount, seed],
  );
  const uniqueStamps = useMemo(
    () => uniqueStampTextures(selectedStamps),
    [selectedStamps],
  );

  const key = `${palette.baseTexture}|${uniqueStamps.map(s => s.id).join(',')}|${palette.liquid ?? ''}`;

  const [result, setResult] = useState<LoadedPlanet | 'loading' | null>('loading');

  useEffect(() => {
    let dead = false;
    setResult('loading');
    (async () => {
      // Load base textures
      const baseDiff = await loadTex(textureUrl(palette.baseTexture));
      if (dead) return;
      if (!baseDiff) { setResult(null); return; }

      const [baseNorm, baseHt] = await Promise.all([
        loadTex(textureUrl(palette.baseTexture, '_normal'), false),
        loadTex(textureUrl(palette.baseTexture, '_height'), false),
      ]);
      if (dead) return;

      // Load stamp textures (parallel)
      const sDiffs = await Promise.all(uniqueStamps.map(s => loadTex(textureUrl(s.id))));
      const sNorms = await Promise.all(uniqueStamps.map(s => loadTex(textureUrl(s.id, '_normal'), false)));
      const sHts   = await Promise.all(uniqueStamps.map(s => loadTex(textureUrl(s.id, '_height'), false)));
      if (dead) return;

      // Load liquid texture if present
      let liqTex: THREE.Texture | null = null;
      if (palette.liquid) {
        liqTex = await loadTex(textureUrl(palette.liquid));
      }
      if (dead) return;

      // Pad arrays to MAX_GPU_STAMPS
      const pad = <T,>(arr: (T | null)[], fb: T, len: number): T[] => {
        const out: T[] = [];
        for (let i = 0; i < len; i++) out.push(arr[i] ?? fb);
        return out;
      };

      setResult({
        baseDiffuse: baseDiff,
        baseNormal: baseNorm ?? _flatNormal1x1,
        baseHeight: baseHt ?? _placeholder1x1,
        stampDiffuse: pad(sDiffs, _placeholder1x1, MAX_GPU_STAMPS),
        stampNormals: pad(sNorms, _flatNormal1x1, MAX_GPU_STAMPS),
        stampHeight: pad(sHts, _placeholder1x1, MAX_GPU_STAMPS),
        stampMeta: uniqueStamps,
        liquidDiffuse: liqTex,
        palette,
      });
    })();
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}

/* ════════════════════════════════════════════════════════
   GLSL — Simplex noise (Ashima / webgl-noise)
   ════════════════════════════════════════════════════════ */

const GLSL_NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g,l.zxy);
  vec3 i2=max(g,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
    i.z+vec4(0.0,i1.z,i2.z,1.0))
    +i.y+vec4(0.0,i1.y,i2.y,1.0))
    +i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

/* Multi-octave FBM */
float fbm(vec3 p, int octaves){
  float val=0.0; float amp=0.5; float freq=1.0;
  for(int i=0;i<8;i++){
    if(i>=octaves) break;
    val+=amp*snoise(p*freq);
    freq*=2.03; amp*=0.48;
  }
  return val;
}
`;

/* ════════════════════════════════════════════════════════
   GLSL — HSV utilities
   ════════════════════════════════════════════════════════ */

const GLSL_HSV = /* glsl */ `
vec3 rgb2hsv(vec3 c){
  vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);
  vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));
  float d=q.x-min(q.w,q.y);
  float e=1.0e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.0*d+e)),d/(q.x+e),q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);
  vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);
}
vec3 hsbShift(vec3 col,float hDeg,float sMul,float bMul){
  vec3 h=rgb2hsv(col);
  h.x=fract(h.x+hDeg/360.0);
  h.y=clamp(h.y*sMul,0.0,1.0);
  h.z=clamp(h.z*bMul,0.0,1.0);
  return hsv2rgb(h);
}
/* Luminance */
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
`;

/* ════════════════════════════════════════════════════════
   Vertex shader — surface
   ════════════════════════════════════════════════════════ */

const SURFACE_VERT = /* glsl */ `
uniform sampler2D uBaseHeight;
uniform float     uDisplacement;
uniform float     uHasHeight;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

void main(){
  vUv     = uv;
  vObjPos = position;
  vNormal = normalize(normalMatrix * normal);

  // Tangent frame for normal-mapping on a sphere
  vec3 up = abs(normal.y) < 0.999 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 T  = normalize(cross(up, normal));
  vec3 B  = cross(normal, T);
  vTangent   = normalize(normalMatrix * T);
  vBitangent = normalize(normalMatrix * B);

  // Heightmap displacement along normal
  vec3 pos = position;
  if(uHasHeight > 0.5 && uDisplacement > 0.0005){
    float h = texture2D(uBaseHeight, uv).r;
    pos += normal * h * uDisplacement;
  }

  vWorldPos   = (modelMatrix * vec4(pos,1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
}
`;

/* ════════════════════════════════════════════════════════
   Fragment shader — Perlin base + stamp decals + liquid
   ════════════════════════════════════════════════════════ */

const SURFACE_FRAG = /* glsl */ `
${GLSL_NOISE}
${GLSL_HSV}

#define MAX_STAMPS 6

// ── Base textures ──
uniform sampler2D uBaseDiffuse;
uniform sampler2D uBaseNormal;
uniform sampler2D uBaseHeight;

// ── Stamp textures (up to 6 unique) ──
uniform sampler2D uStamp0, uStamp1, uStamp2, uStamp3, uStamp4, uStamp5;
uniform sampler2D uStampN0, uStampN1, uStampN2, uStampN3, uStampN4, uStampN5;
uniform sampler2D uStampH0, uStampH1, uStampH2, uStampH3, uStampH4, uStampH5;
uniform int       uStampCount;   // number of unique stamp textures loaded

// ── Per-stamp-instance data (up to 16 instances) ──
#define MAX_INSTANCES 16
uniform int   uInstanceCount;             // how many stamp instances placed
uniform vec3  uStampCenters[MAX_INSTANCES]; // xyz = unit-sphere position of stamp center
uniform vec4  uStampParams[MAX_INSTANCES];  // x=radius, y=texIdx, z=hueShift, w=satMul
uniform vec2  uStampExtra[MAX_INSTANCES];   // x=brightMul, y=rotation angle

// ── Base tint (procedural Perlin variation) ──
uniform vec3  uBaseTint;       // x=hueShift, y=satMul, z=brightMul (0,1,1 = neutral)

// ── Liquid ──
uniform float     uLiquidLevel;  // 0-1 heightmap threshold
uniform vec3      uLiquidColor;  // tint
uniform sampler2D uLiquidDiffuse;
uniform float     uHasLiquid;

// ── Lighting ──
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uEmissive;
uniform vec3  uAtmColor;
uniform float uAtmThick;
uniform float uNormStr;
uniform vec3  uPlanetShine;

// ── State ──
uniform float uTime;
uniform float uSeed;
uniform float uCloudDensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

/* ── Sample stamp texture by index ──────────────── */
vec4 sampleStampDiffuse(int idx, vec2 uv){
  if(idx==0) return texture2D(uStamp0, uv);
  if(idx==1) return texture2D(uStamp1, uv);
  if(idx==2) return texture2D(uStamp2, uv);
  if(idx==3) return texture2D(uStamp3, uv);
  if(idx==4) return texture2D(uStamp4, uv);
  return texture2D(uStamp5, uv);
}
vec3 sampleStampNormal(int idx, vec2 uv){
  vec3 n;
  if(idx==0) n=texture2D(uStampN0, uv).rgb;
  else if(idx==1) n=texture2D(uStampN1, uv).rgb;
  else if(idx==2) n=texture2D(uStampN2, uv).rgb;
  else if(idx==3) n=texture2D(uStampN3, uv).rgb;
  else if(idx==4) n=texture2D(uStampN4, uv).rgb;
  else n=texture2D(uStampN5, uv).rgb;
  return n*2.0-1.0;
}
float sampleStampHeight(int idx, vec2 uv){
  if(idx==0) return texture2D(uStampH0, uv).r;
  if(idx==1) return texture2D(uStampH1, uv).r;
  if(idx==2) return texture2D(uStampH2, uv).r;
  if(idx==3) return texture2D(uStampH3, uv).r;
  if(idx==4) return texture2D(uStampH4, uv).r;
  return texture2D(uStampH5, uv).r;
}

/* ── Stamp projection: sphere-cap → UV ──────────── */
vec2 stampUV(vec3 pos, vec3 center, float radius, float rotation){
  // Great-circle distance from stamp center
  float d = acos(clamp(dot(normalize(pos), normalize(center)), -1.0, 1.0));
  if(d > radius) return vec2(-1.0); // outside stamp

  // Project onto tangent plane of stamp center
  vec3 N = normalize(center);
  vec3 up = abs(N.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);

  vec3 diff = normalize(pos) - N * dot(normalize(pos), N);
  float u = dot(diff, T);
  float v = dot(diff, B);

  // Apply rotation
  float c = cos(rotation);
  float s = sin(rotation);
  float ru = u*c - v*s;
  float rv = u*s + v*c;

  // Map to 0-1 UV space
  float scale = 1.0 / (sin(radius) + 0.001);
  return vec2(ru * scale * 0.5 + 0.5, rv * scale * 0.5 + 0.5);
}

void main(){
  float lat = abs(vObjPos.y);  // 0 at equator, ~1 at poles
  vec3 objN = normalize(vObjPos);

  // ═══ 1. Base layer ═══════════════════════════════════
  vec3 baseCol = texture2D(uBaseDiffuse, vUv).rgb;
  vec3 baseNrm = texture2D(uBaseNormal, vUv).rgb * 2.0 - 1.0;
  float baseHt = texture2D(uBaseHeight, vUv).r;

  // Perlin noise variation on the base color for organic feel
  vec3 noiseP = objN * 4.0 + uSeed * 0.137;
  float pn1 = fbm(noiseP, 4) * 0.5 + 0.5;
  float pn2 = fbm(noiseP * 1.7 + 5.0, 3) * 0.5 + 0.5;

  // Apply base tint (from palette) modulated by noise
  float tH = uBaseTint.x * (0.7 + 0.6 * pn1);
  float tS = mix(1.0, uBaseTint.y, 0.5 + 0.5 * pn2);
  float tB = mix(1.0, uBaseTint.z, 0.3 + 0.4 * pn1);
  baseCol = hsbShift(baseCol, tH, tS, tB);

  // Subtle noise-driven brightness variation
  baseCol *= 0.92 + 0.16 * pn1;

  // Running totals for normal blending
  vec3 blendedNormal = baseNrm;
  float totalStampAlpha = 0.0;

  // ═══ 2. Stamp decal layer ════════════════════════════
  vec3 stampAccum = vec3(0.0);
  vec3 stampNormAccum = vec3(0.0);
  float stampAlphaAccum = 0.0;

  for(int i = 0; i < MAX_INSTANCES; i++){
    if(i >= uInstanceCount) break;

    vec3  center   = uStampCenters[i];
    float radius   = uStampParams[i].x;
    int   texIdx   = int(uStampParams[i].y);
    float hShift   = uStampParams[i].z;
    float sMul     = uStampParams[i].w;
    float bMul     = uStampExtra[i].x;
    float rotation = uStampExtra[i].y;

    vec2 suv = stampUV(vObjPos, center, radius, rotation);
    if(suv.x < 0.0) continue; // outside this stamp

    // Clamp UV to valid range
    if(suv.x < 0.01 || suv.x > 0.99 || suv.y < 0.01 || suv.y > 0.99) continue;

    // ── Distance-based falloff with Perlin dithering ──
    float d = acos(clamp(dot(objN, normalize(center)), -1.0, 1.0));
    float edgeDist = 1.0 - smoothstep(radius * 0.5, radius, d);

    // Perlin noise dithering at the edge
    float edgeNoise = snoise(objN * 12.0 + float(i) * 7.3 + uSeed * 0.5) * 0.5 + 0.5;
    float dither = smoothstep(0.2, 0.8, edgeNoise);
    float alpha = edgeDist * mix(0.7, 1.0, dither);

    // ── Heightmap-aware blending ──
    // Stamps blend stronger where their height matches the base
    float stampHt = sampleStampHeight(texIdx, suv);
    float htDiff = abs(stampHt - baseHt);
    float htMatch = 1.0 - smoothstep(0.0, 0.4, htDiff);
    alpha *= mix(0.6, 1.0, htMatch);

    // ── Sample stamp diffuse and apply HSB shift ──
    vec3 sCol = sampleStampDiffuse(texIdx, suv).rgb;
    sCol = hsbShift(sCol, hShift, sMul, bMul);

    // ── Color/luminance matching at edges ──
    // Blend stamp color toward base luminance at edges for smooth transition
    float baseLum = luma(baseCol);
    float stampLum = luma(sCol);
    float lumaDiff = abs(baseLum - stampLum);

    // At edges (low alpha), shift stamp toward base brightness
    float edgeFactor = 1.0 - edgeDist;
    float lumCorrect = mix(1.0, baseLum / (stampLum + 0.001), edgeFactor * 0.6);
    lumCorrect = clamp(lumCorrect, 0.5, 2.0);
    sCol *= lumCorrect;

    // Also shift hue toward base at edges for smooth color transition
    vec3 sHSV = rgb2hsv(sCol);
    vec3 bHSV = rgb2hsv(baseCol);
    float hueLerp = edgeFactor * 0.4;
    sHSV.x = mix(sHSV.x, bHSV.x, hueLerp);
    sHSV.y = mix(sHSV.y, bHSV.y, hueLerp * 0.5);
    sCol = hsv2rgb(sHSV);

    // ── Normal blending ──
    vec3 sNrm = sampleStampNormal(texIdx, suv);

    // Accumulate (alpha-premultiplied)
    stampAccum     += sCol * alpha;
    stampNormAccum += sNrm * alpha;
    stampAlphaAccum += alpha;
  }

  // ═══ 3. Composite: base + stamps ═════════════════════
  vec3 surface;
  vec3 compositeNormal;

  if(stampAlphaAccum > 0.01){
    // Normalize stamp contributions
    float invA = 1.0 / stampAlphaAccum;
    vec3 avgStamp = stampAccum * invA;
    vec3 avgStampN = normalize(stampNormAccum * invA);

    // Blend ratio (clamp stamp coverage)
    float blend = clamp(stampAlphaAccum, 0.0, 1.0);

    surface = mix(baseCol, avgStamp, blend);
    compositeNormal = mix(baseNrm, avgStampN, blend);
  } else {
    surface = baseCol;
    compositeNormal = baseNrm;
  }

  // ═══ 4. Liquid layer ═════════════════════════════════
  if(uHasLiquid > 0.5 && baseHt < uLiquidLevel){
    // Depth below liquid surface (0 = at surface, 1 = deep)
    float depth = (uLiquidLevel - baseHt) / (uLiquidLevel + 0.001);
    depth = clamp(depth, 0.0, 1.0);

    // Liquid color: deeper = darker, with subtle wave noise
    float wave = snoise(objN * 20.0 + vec3(uTime * 0.3, 0.0, uTime * 0.2)) * 0.03;
    vec3 liquidSurf = uLiquidColor * (1.2 - depth * 0.5) + wave;

    // Sample liquid texture if available
    vec3 liqTex = texture2D(uLiquidDiffuse, vUv).rgb;
    liquidSurf = mix(liquidSurf, liqTex, 0.4);

    // Shallow areas show terrain through liquid
    float transparency = smoothstep(0.0, 0.5, depth);
    surface = mix(surface, liquidSurf, transparency * 0.7 + 0.3);

    // Flatten normals underwater (water is smooth)
    compositeNormal = mix(compositeNormal, vec3(0.0, 0.0, 1.0), transparency * 0.8);
  }

  // ═══ 5. Normal mapping ═══════════════════════════════
  compositeNormal.xy *= uNormStr;
  compositeNormal = normalize(compositeNormal);

  mat3 TBN = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
  vec3 N = (uNormStr > 0.01) ? normalize(TBN * compositeNormal) : normalize(vNormal);

  // ═══ 6. Lighting ═════════════════════════════════════
  vec3 L = normalize(uSunDir);
  float NdL = dot(N, L);
  float diff = max(NdL, 0.0);
  float term = smoothstep(-0.10, 0.15, NdL);

  float ambient = 0.02 + uAtmThick * 0.08;
  vec3 starLight = uSunColor * diff * term;

  // Fresnel rim
  float fres = 1.0 - max(dot(normalize(vNormal), normalize(-vWorldPos)), 0.0);
  float rim = pow(fres, 3.0) * uAtmThick * 0.3;
  vec3 rimC = uAtmColor * rim;

  // Planet-shine
  vec3 ps = vec3(0.0);
  float psL = length(uPlanetShine);
  if(psL > 0.01){
    float psWrap = max(dot(N, -L) * 0.5 + 0.2, 0.0);
    float psFres = pow(fres, 2.0);
    ps = uPlanetShine * (psWrap * 0.12 + psFres * 0.06);
  }

  // Emissive (lava glow on night side)
  vec3 emC = vec3(0.0);
  if(uEmissive > 0.01){
    float night = 1.0 - term;
    emC = surface * uEmissive * 1.5 * night * vec3(1.2, 0.8, 0.5);
  }

  vec3 lit = surface * (starLight + ambient) + rimC + emC + ps;

  // Atmospheric forward-scatter on lit side
  if(uAtmThick > 0.05){
    float sc = pow(max(NdL, 0.0), 0.5) * uAtmThick * 0.12;
    lit += uAtmColor * sc * uSunColor;
  }

  gl_FragColor = vec4(lit, 1.0);
}
`;

/* ════════════════════════════════════════════════════════
   Rayleigh + Mie scattering atmosphere shader
   ════════════════════════════════════════════════════════ */

const ATM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
void main(){
  vNormal   = normalize(normalMatrix * normal);
  vec4 wp   = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vViewDir  = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATM_FRAG = /* glsl */ `
uniform vec3  uAtmColor;
uniform float uAtmThick;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uPlanetShine;

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;

/*
 * Physically-inspired Rayleigh + Mie scattering.
 *
 * Rayleigh:  Short wavelengths scatter more (λ^-4).
 *            Produces blue sky on day-side, red-orange at terminator.
 * Mie:       Forward-scattering haze (larger particles).
 *            Produces bright halo around sun direction.
 */
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);

  float cosTheta = dot(V, L);     // view-sun angle for Mie phase
  float NdL      = dot(N, L);     // surface-sun angle
  float NdV      = max(dot(N, V), 0.0);
  float fres     = 1.0 - NdV;

  // ── Rayleigh scattering (wavelength-dependent) ──────
  // Scatter coefficients — shorter wavelength (blue) scatters more
  vec3 rayleighCoeff = vec3(0.35, 0.55, 1.0); // relative R<G<B scattering
  rayleighCoeff = mix(vec3(1.0), rayleighCoeff, 0.8); // blend with atm color
  rayleighCoeff *= uAtmColor; // tinted by planet's atmosphere

  // Rayleigh phase function: (3/16π)(1 + cos²θ) ≈ simplified
  float rayleighPhase = 0.75 * (1.0 + cosTheta * cosTheta);

  // Optical depth — thicker at rim (limb), geometric falloff
  float rimDepth = pow(fres, 2.2);
  float scatter  = max(NdL, 0.0);  // only on lit side
  float termGlow = exp(-6.0 * pow(max(0.0, -NdL + 0.15), 2.0)); // terminator bloom

  vec3 rayleigh = rayleighCoeff * rayleighPhase * (scatter * 0.7 + termGlow * 0.35);

  // ── Mie scattering (forward lobe near sun) ──────────
  // Henyey-Greenstein phase function
  float g = 0.76; // asymmetry parameter (forward peaked)
  float g2 = g * g;
  float miePhase = (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
  miePhase *= 0.08; // scale down — Mie is a small bright halo

  vec3 mie = uAtmColor * miePhase * scatter * uSunColor;

  // ── Combine scattering ──────────────────────────────
  vec3 totalScatter = rayleigh + mie;

  // Apply sun color tint
  totalScatter *= uSunColor;

  // Scale by atmosphere thickness
  totalScatter *= uAtmThick;

  // ── Alpha: rim-based with scatter contribution ──────
  float baseAlpha = rimDepth * (0.25 + scatter * 0.3 + termGlow * 0.15);
  baseAlpha *= uAtmThick;

  // Planet-shine contribution (back-lit by parent planet)
  float psL = length(uPlanetShine);
  if(psL > 0.01){
    float psF = pow(fres, 2.0);
    float psW = max(dot(N, -L), 0.0) * 0.4;
    totalScatter += uPlanetShine * (psF * 0.20 + psW * 0.15) * uAtmThick;
    baseAlpha += psF * psL * 0.06;
  }

  // ── Night-side limb glow (scattered starlight through atmosphere) ──
  float nightRim = rimDepth * max(-NdL, 0.0) * 0.15;
  totalScatter += uAtmColor * nightRim * uAtmThick;
  baseAlpha += nightRim * uAtmThick * 0.3;

  gl_FragColor = vec4(totalScatter, clamp(baseAlpha, 0.0, 0.72));
}
`;

/* ════════════════════════════════════════════════════════
   Stamp instance generation (CPU side, seed-deterministic)
   ════════════════════════════════════════════════════════ */

interface StampInstance {
  center: THREE.Vector3;    // unit-sphere position
  radius: number;           // angular radius in radians
  texIdx: number;           // index into unique stamp texture array
  hueShift: number;
  satMul: number;
  brightMul: number;
  rotation: number;         // radians
}

function generateStampInstances(
  palette: WorldPalette,
  uniqueStamps: StampTexture[],
  seed: number,
): StampInstance[] {
  const count = Math.min(palette.stampCount ?? 8, 16); // MAX_INSTANCES
  if (uniqueStamps.length === 0 || count === 0) return [];

  // Seeded PRNG
  let s = Math.abs(seed * 2654435761 + 1) >>> 0;
  const rng = () => { s = (s * 1103515245 + 12345) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; };

  // Build index map: stamp id → texture array index
  const idxMap = new Map<string, number>();
  uniqueStamps.forEach((st, i) => idxMap.set(st.id, i));

  // Weighted selection of which stamp definition to use per instance
  const allStamps = palette.stamps;
  const totalW = allStamps.reduce((a, s) => a + s.weight, 0);

  const instances: StampInstance[] = [];
  for (let i = 0; i < count; i++) {
    // Pick stamp type
    let r = rng() * totalW;
    let picked = allStamps[0];
    for (const st of allStamps) {
      r -= st.weight;
      if (r <= 0) { picked = st; break; }
    }

    // Find texture index
    let texIdx = idxMap.get(picked.id) ?? 0;

    // Generate position on unit sphere respecting band preference
    let theta: number; // polar angle (0=north pole, π=south pole)
    const phi = rng() * Math.PI * 2; // azimuthal angle

    switch (picked.band) {
      case 'equator':
        theta = Math.PI * 0.5 + (rng() - 0.5) * Math.PI * 0.4;
        break;
      case 'mid':
        theta = rng() < 0.5
          ? Math.PI * 0.25 + rng() * Math.PI * 0.2
          : Math.PI * 0.55 + rng() * Math.PI * 0.2;
        break;
      case 'polar':
        theta = rng() < 0.5
          ? rng() * Math.PI * 0.25
          : Math.PI * 0.75 + rng() * Math.PI * 0.25;
        break;
      default: // 'any'
        theta = Math.acos(1 - 2 * rng()); // uniform on sphere
    }

    const center = new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi),
    );

    instances.push({
      center,
      radius: picked.stampRadius ?? 0.25,
      texIdx,
      hueShift: picked.hueShift ?? 0,
      satMul: picked.satMul ?? 1,
      brightMul: picked.brightMul ?? 1,
      rotation: rng() * Math.PI * 2, // random rotation for variety
    });
  }

  return instances;
}

/* ════════════════════════════════════════════════════════
   Main component
   ════════════════════════════════════════════════════════ */

export function TexturedPlanet(props: Props) {
  const {
    planetType,
    temperature = 300,
    seed = 0,
    sunDirection = [1, 0.3, 0.5],
    rotationSpeed = 0.08,
    segments = 96,
    starSpectralClass,
    planetShineColor,
    tidalHeating,
  } = props;

  // Gas giants → always procedural (band shader)
  if (GAS_TYPES.has(planetType)) {
    return <ProceduralPlanet {...props} />;
  }

  const loaded = usePlanetTextures(planetType, temperature, seed);

  if (loaded === 'loading') return <ProceduralPlanet {...props} />;
  if (loaded === null)      return <ProceduralPlanet {...props} />;

  return (
    <TexturedPlanetInner
      data={loaded}
      seed={seed}
      sunDirection={sunDirection}
      rotationSpeed={rotationSpeed}
      segments={segments}
      starSpectralClass={starSpectralClass}
      planetShineColor={planetShineColor}
      tidalHeating={tidalHeating}
    />
  );
}

/* ── Inner renderer (textures already loaded) ──────── */

function TexturedPlanetInner({
  data, seed,
  sunDirection, rotationSpeed,
  segments, starSpectralClass, planetShineColor, tidalHeating,
}: {
  data: LoadedPlanet;
  seed: number;
  sunDirection: [number, number, number];
  rotationSpeed: number;
  segments: number;
  starSpectralClass?: string;
  planetShineColor?: [number, number, number];
  tidalHeating?: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const { palette, stampMeta } = data;

  // Star color
  const sunColor = useMemo(() => getStarColor(starSpectralClass), [starSpectralClass]);

  // Tidal heating
  const emissive = useMemo(() => {
    let em = palette.emissive;
    if (tidalHeating && tidalHeating > 0.3) em = Math.min(1, em + tidalHeating * 0.3);
    return em;
  }, [palette, tidalHeating]);

  // Generate stamp instances (deterministic from seed)
  const stampInstances = useMemo(
    () => generateStampInstances(palette, stampMeta, seed),
    [palette, stampMeta, seed],
  );

  // Pack stamp instance data into uniform arrays
  const stampUniforms = useMemo(() => {
    const centers: THREE.Vector3[] = [];
    const params: THREE.Vector4[] = [];
    const extras: THREE.Vector2[] = [];

    for (let i = 0; i < 16; i++) {
      const inst = stampInstances[i];
      if (inst) {
        centers.push(inst.center);
        params.push(new THREE.Vector4(inst.radius, inst.texIdx, inst.hueShift, inst.satMul));
        extras.push(new THREE.Vector2(inst.brightMul, inst.rotation));
      } else {
        centers.push(new THREE.Vector3(0, 0, 0));
        params.push(new THREE.Vector4(0, 0, 0, 1));
        extras.push(new THREE.Vector2(1, 0));
      }
    }
    return { centers, params, extras };
  }, [stampInstances]);

  const psc = planetShineColor ?? [0, 0, 0];
  const baseTint = palette.baseTint ?? [0, 1, 1];

  /* ── Surface material ── */
  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    uniforms: {
      // Base
      uBaseDiffuse:  { value: data.baseDiffuse },
      uBaseNormal:   { value: data.baseNormal },
      uBaseHeight:   { value: data.baseHeight },
      // Stamps (up to 6 unique textures)
      uStamp0: { value: data.stampDiffuse[0] },
      uStamp1: { value: data.stampDiffuse[1] },
      uStamp2: { value: data.stampDiffuse[2] },
      uStamp3: { value: data.stampDiffuse[3] },
      uStamp4: { value: data.stampDiffuse[4] },
      uStamp5: { value: data.stampDiffuse[5] },
      uStampN0: { value: data.stampNormals[0] },
      uStampN1: { value: data.stampNormals[1] },
      uStampN2: { value: data.stampNormals[2] },
      uStampN3: { value: data.stampNormals[3] },
      uStampN4: { value: data.stampNormals[4] },
      uStampN5: { value: data.stampNormals[5] },
      uStampH0: { value: data.stampHeight[0] },
      uStampH1: { value: data.stampHeight[1] },
      uStampH2: { value: data.stampHeight[2] },
      uStampH3: { value: data.stampHeight[3] },
      uStampH4: { value: data.stampHeight[4] },
      uStampH5: { value: data.stampHeight[5] },
      uStampCount:    { value: stampMeta.length },
      // Stamp instances
      uInstanceCount: { value: stampInstances.length },
      uStampCenters:  { value: stampUniforms.centers },
      uStampParams:   { value: stampUniforms.params },
      uStampExtra:    { value: stampUniforms.extras },
      // Base tint
      uBaseTint:      { value: new THREE.Vector3(...baseTint) },
      // Liquid
      uLiquidLevel:   { value: palette.liquidLevel ?? 0 },
      uLiquidColor:   { value: new THREE.Vector3(...(palette.liquidColor ?? [0, 0, 0])) },
      uLiquidDiffuse: { value: data.liquidDiffuse ?? _placeholder1x1 },
      uHasLiquid:     { value: (palette.liquid && palette.liquidLevel) ? 1.0 : 0.0 },
      // Displacement
      uDisplacement:  { value: palette.displacementScale },
      uHasHeight:     { value: data.baseHeight !== _placeholder1x1 ? 1.0 : 0.0 },
      // Lighting
      uSunDir:        { value: new THREE.Vector3(...sunDirection).normalize() },
      uSunColor:      { value: new THREE.Vector3(...sunColor) },
      uEmissive:      { value: emissive },
      uAtmColor:      { value: new THREE.Color(...palette.atmColor) },
      uAtmThick:      { value: palette.atmThickness },
      uNormStr:       { value: palette.normalStrength },
      uPlanetShine:   { value: new THREE.Vector3(...psc) },
      // State
      uTime:          { value: 0 },
      uSeed:          { value: seed * 137.0 },
      uCloudDensity:  { value: palette.cloudDensity },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, stampMeta, stampInstances, stampUniforms, sunDirection, sunColor, emissive, palette, psc, seed, baseTint]);

  /* ── Rayleigh atmosphere material ── */
  const atmMat = useMemo(() => {
    if (palette.atmThickness < 0.05) return null;
    return new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor:    { value: new THREE.Color(...palette.atmColor) },
        uAtmThick:    { value: palette.atmThickness },
        uSunDir:      { value: new THREE.Vector3(...sunDirection).normalize() },
        uSunColor:    { value: new THREE.Vector3(...sunColor) },
        uPlanetShine: { value: new THREE.Vector3(...psc) },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
    });
  }, [palette, sunDirection, sunColor, psc]);

  /* ── Animation loop ── */
  useFrame((_, dt) => {
    const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
    if (groupRef.current) groupRef.current.rotation.y += dt * rotationSpeed * spd;
    surfMat.uniforms.uTime.value += dt * spd;
    surfMat.uniformsNeedUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <mesh material={surfMat}>
        <sphereGeometry args={[1, segments, Math.round(segments * 0.67)]} />
      </mesh>
      {atmMat && (
        <mesh material={atmMat}>
          <sphereGeometry args={[1.015 + palette.atmThickness * 0.04, 48, 32]} />
        </mesh>
      )}
    </group>
  );
}

export default TexturedPlanet;
