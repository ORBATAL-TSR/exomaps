/**
 * TexturedPlanet v2 — Multi-region blended PBR planet renderer.
 *
 * Loads 2-3 terrain textures per world type from the EWoCS palette,
 * blends them by latitude band + noise, applies hue/color shifts,
 * normal mapping, heightmap displacement, star-tinted lighting,
 * and planetshine / moon reflections.
 *
 * Falls back to ProceduralPlanet when textures are unavailable.
 */

import { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getWorldPalette, getStarColor, textureUrl, GAS_TYPES,
  type WorldPalette, type RegionTexture,
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
  const d = new Uint8Array([128, 128, 255, 255]); // (0,0,1) in tangent space
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
        tex.wrapT = THREE.ClampToEdgeWrapping;
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

/* ── Palette texture bundle ─────────────────────────── */

interface PaletteTex {
  diffuse: THREE.Texture[];   // length 3 (padded with placeholder)
  normals: THREE.Texture[];   // length 3
  height: THREE.Texture;      // primary heightmap
  regions: RegionTexture[];   // top-3 regions
  palette: WorldPalette;
}

function usePaletteTextures(
  planetType: string, temperature: number,
): PaletteTex | 'loading' | null {
  const palette = useMemo(
    () => getWorldPalette(planetType, temperature),
    [planetType, temperature],
  );
  const top3 = useMemo(() => {
    const s = [...palette.regions].sort((a, b) => b.weight - a.weight);
    return s.slice(0, 3);
  }, [palette]);
  const key = top3.map(r => r.id).join(',');

  const [result, setResult] = useState<PaletteTex | 'loading' | null>('loading');

  useEffect(() => {
    let dead = false;
    setResult('loading');
    (async () => {
      const diffs = await Promise.all(top3.map(r => loadTex(textureUrl(r.id))));
      if (dead) return;
      if (!diffs[0]) { setResult(null); return; }          // primary missing → procedural

      const norms = await Promise.all(top3.map(r => loadTex(textureUrl(r.id, '_normal'), false)));
      const hm    = await loadTex(textureUrl(top3[0].id, '_height'), false);
      if (dead) return;

      // Pad to length 3
      const pad = <T,>(arr: (T | null)[], fallback: T): T[] => {
        const out: T[] = [];
        for (let i = 0; i < 3; i++) out.push(arr[i] ?? fallback);
        return out;
      };

      setResult({
        diffuse: pad(diffs, _placeholder1x1),
        normals: pad(norms, _flatNormal1x1),
        height: hm ?? _placeholder1x1,
        regions: top3,
        palette,
      });
    })();
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}

/* ── Simplex noise (Ashima / webgl-noise) ────────────── */

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
`;

/* ── Vertex shader ──────────────────────────────────── */

const SURFACE_VERT = /* glsl */ `
uniform sampler2D uHeightMap;
uniform float     uDisplacement;
uniform float     uHasHeight;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObjPos;       // unit-sphere position (for latitude)
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
    float h = texture2D(uHeightMap, uv).r;
    pos += normal * h * uDisplacement;
  }

  vWorldPos   = (modelMatrix * vec4(pos,1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
}
`;

/* ── Fragment shader ────────────────────────────────── */

const SURFACE_FRAG = /* glsl */ `
${GLSL_NOISE}

// ── Region textures (up to 3) ──
uniform sampler2D uMap0, uMap1, uMap2;
uniform sampler2D uNorm0, uNorm1, uNorm2;
uniform int       uRegionCount;

// Per-region packed params
uniform vec3 uWeights;      // base weight per region
uniform vec3 uBands;        // 0=equator 1=mid 2=polar 3=any
uniform vec3 uHueShifts;    // degrees
uniform vec3 uSatMuls;      // multiplier
uniform vec3 uBrightMuls;   // multiplier

// Lighting
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uEmissive;
uniform vec3  uAtmColor;
uniform float uAtmThick;
uniform float uNormStr;
uniform vec3  uPlanetShine;

// State
uniform float uTime;
uniform float uSeed;
uniform float uCloudDensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vTangent;
varying vec3 vBitangent;

/* ── HSV ─────────────────────────────────────────── */
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

/* ── Band weight ─────────────────────────────────── */
float bandW(float band,float lat){
  if(band>2.5) return 1.0;                      // any
  if(band<0.5) return smoothstep(0.50,0.00,lat); // equator
  if(band<1.5) return smoothstep(0.0,0.25,lat)*smoothstep(0.75,0.45,lat); // mid
  return smoothstep(0.35,0.75,lat);               // polar
}

void main(){
  float lat=abs(vObjPos.y);  // 0 at equator, ~1 at poles

  // Organic noise for soft blending edges
  vec3 np=vObjPos*3.0+uSeed*0.1;
  float n1=snoise(np)*0.5+0.5;
  float n2=snoise(np*2.1+7.0)*0.5+0.5;

  // Per-region blend weights (base × band × noise jitter)
  float w0=uWeights.x * bandW(uBands.x,lat) * mix(0.7,1.3,n1);
  float w1=uWeights.y * bandW(uBands.y,lat) * mix(0.7,1.3,n2);
  float w2=uWeights.z * bandW(uBands.z,lat) * mix(0.7,1.3,1.0-n1);
  if(uRegionCount<2){ w1=0.0; w2=0.0; }
  if(uRegionCount<3){ w2=0.0; }
  float wSum=w0+w1+w2+1e-4;
  w0/=wSum; w1/=wSum; w2/=wSum;

  // Sample diffuse + apply HSB shifts
  vec3 c0=hsbShift(texture2D(uMap0,vUv).rgb, uHueShifts.x, uSatMuls.x, uBrightMuls.x);
  vec3 c1=hsbShift(texture2D(uMap1,vUv).rgb, uHueShifts.y, uSatMuls.y, uBrightMuls.y);
  vec3 c2=hsbShift(texture2D(uMap2,vUv).rgb, uHueShifts.z, uSatMuls.z, uBrightMuls.z);
  vec3 surface=c0*w0+c1*w1+c2*w2;

  // Sample & blend normal maps → tangent-space normal
  vec3 nm0=texture2D(uNorm0,vUv).rgb*2.0-1.0;
  vec3 nm1=texture2D(uNorm1,vUv).rgb*2.0-1.0;
  vec3 nm2=texture2D(uNorm2,vUv).rgb*2.0-1.0;
  vec3 tsN=normalize(nm0*w0+nm1*w1+nm2*w2);
  tsN.xy*=uNormStr;
  tsN=normalize(tsN);

  // TBN → view-space normal
  mat3 TBN=mat3(normalize(vTangent),normalize(vBitangent),normalize(vNormal));
  vec3 N=(uNormStr>0.01) ? normalize(TBN*tsN) : normalize(vNormal);

  // ── Lighting ──────────────────────────────────── */
  vec3 L=normalize(uSunDir);
  float NdL=dot(N,L);
  float diff=max(NdL,0.0);
  float term=smoothstep(-0.10,0.15,NdL);

  float ambient=0.02+uAtmThick*0.08;
  vec3 starLight=uSunColor*diff*term;

  // Rim glow
  float fres=1.0-max(dot(normalize(vNormal),normalize(-vWorldPos)),0.0);
  float rim=pow(fres,3.0)*uAtmThick*0.4;
  vec3 rimC=uAtmColor*rim;

  // Planet-shine (from parent planet or reflected moonlight)
  vec3 ps=vec3(0.0);
  float psL=length(uPlanetShine);
  if(psL>0.01){
    float psWrap=max(dot(N,-L)*0.5+0.2,0.0);
    float psFres=pow(fres,2.0);
    ps=uPlanetShine*(psWrap*0.12+psFres*0.06);
  }

  // Emissive (lava glow in dark side)
  vec3 emC=vec3(0.0);
  if(uEmissive>0.01){
    float night=1.0-term;
    emC=surface*uEmissive*1.5*night*vec3(1.2,0.8,0.5);
  }

  vec3 lit=surface*(starLight+ambient)+rimC+emC+ps;

  // Atmospheric scattering on lit side
  if(uAtmThick>0.05){
    float sc=pow(max(NdL,0.0),0.5)*uAtmThick*0.15;
    lit+=uAtmColor*sc*uSunColor;
  }

  gl_FragColor=vec4(lit,1.0);
}
`;

/* ── Atmosphere shaders ─────────────────────────────── */

const ATM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
void main(){
  vNormal  = normalize(normalMatrix * normal);
  vec4 wp  = modelMatrix * vec4(position,1.0);
  vWorldPos= wp.xyz;
  vViewDir = normalize(cameraPosition - wp.xyz);
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

void main(){
  vec3 N=normalize(vNormal);
  vec3 V=normalize(vViewDir);
  vec3 L=normalize(uSunDir);

  float fres   = 1.0 - max(dot(N,V),0.0);
  float rim    = pow(fres,2.6);
  float sunG   = max(dot(N,L),0.0);
  float scat   = pow(sunG,0.6);
  float termG  = exp(-4.0*pow(max(0.0,-dot(N,L)+0.1),2.0));

  float alpha  = rim*(0.3*scat+0.12+0.15*termG)*uAtmThick;
  vec3 col     = uAtmColor*(scat*0.8+0.35)*uSunColor;
  col         += uAtmColor*termG*0.30*uSunColor;

  // Planet-shine tint
  float psL=length(uPlanetShine);
  if(psL>0.01){
    float psF=pow(fres,2.0);
    float psW=max(dot(N,-L),0.0)*0.4;
    col  += uPlanetShine*(psF*0.20+psW*0.15);
    alpha+= psF*psL*0.06;
  }

  gl_FragColor=vec4(col,clamp(alpha,0.0,0.65));
}
`;

/* ── Encode band type as float ──────────────────────── */
function bandToFloat(b: string): number {
  return b === 'equator' ? 0 : b === 'mid' ? 1 : b === 'polar' ? 2 : 3;
}

/* ═══════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════*/

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

  const loaded = usePaletteTextures(planetType, temperature);

  // Still loading → placeholder procedural
  if (loaded === 'loading') return <ProceduralPlanet {...props} />;
  // Textures missing → fallback procedural
  if (loaded === null)      return <ProceduralPlanet {...props} />;

  return (
    <TexturedPlanetInner
      ptex={loaded}
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
  ptex, seed,
  sunDirection, rotationSpeed,
  segments, starSpectralClass, planetShineColor, tidalHeating,
}: {
  ptex: PaletteTex;
  seed: number;
  sunDirection: [number, number, number];
  rotationSpeed: number;
  segments: number;
  starSpectralClass?: string;
  planetShineColor?: [number, number, number];
  tidalHeating?: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const { palette, regions, diffuse, normals, height } = ptex;

  // Star color from spectral class
  const sunColor = useMemo(() => getStarColor(starSpectralClass), [starSpectralClass]);

  // Tidal heating boosts emissive
  const emissive = useMemo(() => {
    let em = palette.emissive;
    if (tidalHeating && tidalHeating > 0.3) {
      em = Math.min(1, em + tidalHeating * 0.3);
    }
    return em;
  }, [palette, tidalHeating]);

  // Pack per-region data into vec3s (regions already padded to 3 via diffuse/normals)
  const pack = useMemo(() => {
    const w  = new THREE.Vector3();
    const b  = new THREE.Vector3();
    const hs = new THREE.Vector3();
    const sm = new THREE.Vector3();
    const bm = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      const r: RegionTexture | undefined = regions[i];
      const vals = r
        ? [r.weight, bandToFloat(r.band), r.hueShift ?? 0, r.satMul ?? 1, r.brightMul ?? 1]
        : [0, 3, 0, 1, 1];
      if (i === 0)      { w.x=vals[0]; b.x=vals[1]; hs.x=vals[2]; sm.x=vals[3]; bm.x=vals[4]; }
      else if (i === 1) { w.y=vals[0]; b.y=vals[1]; hs.y=vals[2]; sm.y=vals[3]; bm.y=vals[4]; }
      else              { w.z=vals[0]; b.z=vals[1]; hs.z=vals[2]; sm.z=vals[3]; bm.z=vals[4]; }
    }
    return { weights: w, bands: b, hueShifts: hs, satMuls: sm, brightMuls: bm };
  }, [regions]);

  const psc = planetShineColor ?? [0, 0, 0];

  /* ── Surface material ── */
  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    uniforms: {
      uMap0:          { value: diffuse[0] },
      uMap1:          { value: diffuse[1] },
      uMap2:          { value: diffuse[2] },
      uNorm0:         { value: normals[0] },
      uNorm1:         { value: normals[1] },
      uNorm2:         { value: normals[2] },
      uHeightMap:     { value: height },
      uHasHeight:     { value: height !== _placeholder1x1 ? 1.0 : 0.0 },
      uDisplacement:  { value: palette.displacementScale },
      uRegionCount:   { value: regions.length },
      uWeights:       { value: pack.weights },
      uBands:         { value: pack.bands },
      uHueShifts:     { value: pack.hueShifts },
      uSatMuls:       { value: pack.satMuls },
      uBrightMuls:    { value: pack.brightMuls },
      uSunDir:        { value: new THREE.Vector3(...sunDirection).normalize() },
      uSunColor:      { value: new THREE.Vector3(...sunColor) },
      uEmissive:      { value: emissive },
      uAtmColor:      { value: new THREE.Color(...palette.atmColor) },
      uAtmThick:      { value: palette.atmThickness },
      uNormStr:       { value: palette.normalStrength },
      uPlanetShine:   { value: new THREE.Vector3(...psc) },
      uTime:          { value: 0 },
      uSeed:          { value: seed * 137.0 },
      uCloudDensity:  { value: palette.cloudDensity },
    },
  }), [diffuse, normals, height, regions, pack, sunDirection, sunColor, emissive, palette, psc, seed]);

  /* ── Atmosphere material ── */
  const atmMat = useMemo(() => {
    if (palette.atmThickness < 0.05) return null;
    return new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor:     { value: new THREE.Color(...palette.atmColor) },
        uAtmThick:     { value: palette.atmThickness },
        uSunDir:       { value: new THREE.Vector3(...sunDirection).normalize() },
        uSunColor:     { value: new THREE.Vector3(...sunColor) },
        uPlanetShine:  { value: new THREE.Vector3(...psc) },
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
