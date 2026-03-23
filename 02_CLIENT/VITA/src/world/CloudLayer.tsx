/**
 * CloudLayer — Animated 3D cloud deck for solid worlds.
 *
 * Rendered as a semi-transparent sphere slightly above the planet surface
 * (r = 1.015 + atmThickness * 0.04). Uses FBM noise animated along the
 * equatorial axis (trade-wind drift). Separate from the solid.frag surface
 * baked clouds — this layer adds parallax depth, proper underside shading,
 * and independent wind speed.
 *
 * Cloud regimes drive color + morphology:
 *   regime 0 (H₂O)    — white/grey, Earth-like cumulus
 *   regime 1 (NH₄SH)  — tan/brown banded, Jupiter-style
 *   regime 2 (NH₃)    — cream/pale, cold giant
 *   regime 3 (hycean)  — dense white, high albedo ocean world
 *
 * Only rendered when cloudDensity > 0.18 && atmThickness >= 0.10.
 */

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from './shaders/noise';

const CLOUD_VERT = /* glsl */`
${NOISE_GLSL}

uniform float uTime;
uniform float uSeed;
uniform float uScale;

varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vNormal   = normalize(normalMatrix * normal);

  // Displace surface slightly outward at cloud-dense points (gives puffiness)
  vec3 np = position * uScale + uSeed * 0.083;
  np.x += uTime * 0.007;
  float disp = fbm3(np) * 0.010 - 0.003;
  vec3 pos = position + normal * disp;

  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const CLOUD_FRAG = /* glsl */`
${NOISE_GLSL}

uniform float uTime;
uniform float uSeed;
uniform float uScale;
uniform float uDensity;
uniform float uRegime;      // 0=H2O 1=NH4SH 2=NH3 3=hycean
uniform vec3  uSunDir;
uniform vec3  uAtmColor;

varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec3 p1 = normalize(vWorldPos) * uScale + uSeed * 0.07;
  p1.x += uTime * 0.008;           // equatorial trade-wind drift
  p1.z += uTime * 0.0022;          // weak polar drift

  vec3 p2 = p1 * 2.1 + 77.3;
  p2.x += uTime * 0.013;

  float raw = fbm5(p1) * 0.70 + fbm3(p2) * 0.30;

  float threshold = 0.60 - uDensity * 0.40;
  float cld = smoothstep(threshold, threshold + 0.18, raw);
  if (cld < 0.005) discard;

  // Cloud color by regime
  vec3 cloudCol;
  if (uRegime < 0.5) {
    cloudCol = vec3(0.92, 0.92, 0.92);
  } else if (uRegime < 1.5) {
    float band = noise3D(normalize(vWorldPos) * vec3(1.0, 4.0, 1.0) * 2.0 + uSeed);
    cloudCol = mix(vec3(0.76, 0.62, 0.44), vec3(0.90, 0.80, 0.65), band);
  } else if (uRegime < 2.5) {
    cloudCol = mix(vec3(0.85, 0.88, 0.92), vec3(0.95, 0.92, 0.80),
                   noise3D(normalize(vWorldPos) * 3.0 + uSeed));
  } else {
    cloudCol = vec3(0.96, 0.96, 0.96);
  }

  // Lighting: bright top, dark underside
  vec3  N   = normalize(vNormal);
  vec3  L   = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);

  float face   = clamp(ndl * 2.0 - 0.2, 0.0, 1.0);
  vec3  topCol = cloudCol * (0.18 + 0.82 * ndl);
  vec3  btmCol = cloudCol * 0.12 + uAtmColor * 0.10;
  vec3  litCol = mix(btmCol, topCol, face);

  // Edge darkening (crude AO)
  litCol *= 1.0 - (1.0 - cld) * 0.38;

  gl_FragColor = vec4(litCol, cld * 0.80);
}`;

interface Props {
  cloudDensity: number;
  cloudRegime:  number;
  atmThickness: number;
  atmColor:     [number,number,number];
  sunDirection: [number,number,number];
  noiseScale:   number;
  seed:         number;
  windSpeed?:   number;
}

export function CloudLayer({
  cloudDensity, cloudRegime, atmThickness, atmColor,
  sunDirection, noiseScale, seed, windSpeed = 1.35,
}: Props) {
  if (cloudDensity < 0.18 || atmThickness < 0.10) return null;

  const cloudRadius = 1.015 + atmThickness * 0.04;

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent:    true,
    depthWrite:     false,
    side:           THREE.FrontSide,
    uniforms: {
      uTime:     { value: 0 },
      uSeed:     { value: seed * 0.00137 },
      uScale:    { value: noiseScale * 0.8 },
      uDensity:  { value: cloudDensity },
      uRegime:   { value: cloudRegime },
      uSunDir:   { value: new THREE.Vector3(...sunDirection).normalize() },
      uAtmColor: { value: new THREE.Vector3(...atmColor) },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [seed, cloudRegime, noiseScale]);

  useFrame((_, delta) => {
    mat.uniforms.uTime.value    += delta * windSpeed;
    mat.uniforms.uDensity.value  = cloudDensity;
    (mat.uniforms.uSunDir.value as THREE.Vector3)
      .set(sunDirection[0], sunDirection[1], sunDirection[2]).normalize();
  });

  return (
    <mesh material={mat} renderOrder={1}>
      <sphereGeometry args={[cloudRadius, 96, 64]} />
    </mesh>
  );
}
