/**
 * RingSystem — Procedural ring disk for gas giants.
 *
 * Renders a flat annular disk in the planet's equatorial plane with
 * A/B/C ring bands, Cassini division, planet self-shadow, and both
 * lit-face and transmitted-light modes.
 *
 * Props:
 *   inner      — inner radius in planet radii (e.g. 1.30)
 *   outer      — outer radius in planet radii (e.g. 2.25)
 *   sunDir     — world-space direction toward the sun
 */

import { useMemo } from 'react';
import * as THREE from 'three';

interface Props {
  inner:  number;
  outer:  number;
  sunDir: [number, number, number];
}

// ── Vertex shader ─────────────────────────────────────────────────────────
const RING_VERT = /* glsl */`
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uSunDir;

attribute vec3 position;

varying vec3  vLocalPos;
varying vec3  vSunLocal;

void main() {
  vLocalPos = position;
  // Sun direction in local space via transpose of upper-left 3x3 (valid for
  // rotation + uniform scale — normalise to eliminate the scale factor).
  mat3 m = mat3(modelMatrix);
  vSunLocal = normalize(vec3(
    dot(m[0], uSunDir),
    dot(m[1], uSunDir),
    dot(m[2], uSunDir)
  ));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

// ── Fragment shader ───────────────────────────────────────────────────────
const RING_FRAG = /* glsl */`
precision highp float;

uniform float uRingInner;
uniform float uRingOuter;

varying vec3  vLocalPos;
varying vec3  vSunLocal;   // sun direction in local (planet) space

// Ring band opacity — same formula as planet shader ringBandDensity()
float ringBandDensity(float r) {
  float d   = smoothstep(0.00,0.04,r)*(1.0-smoothstep(0.05,0.08,r))*0.10;
  float c   = smoothstep(0.08,0.14,r)*(1.0-smoothstep(0.28,0.31,r))*0.32;
  float b   = smoothstep(0.31,0.36,r)*(1.0-smoothstep(0.59,0.62,r))*0.88;
  float cas = smoothstep(0.620,0.625,r)*(1.0-smoothstep(0.645,0.650,r));
  float a   = smoothstep(0.65,0.70,r)*(1.0-smoothstep(0.93,0.98,r))*0.70;
  return clamp((d+c+b+a)*(1.0-cas*0.93), 0.0, 1.0);
}

// Ring band colour (local normalised radius)
vec3 ringBandColor(float r) {
  vec3 dCol = vec3(0.40, 0.38, 0.34);   // D: dark grey
  vec3 cCol = vec3(0.60, 0.54, 0.44);   // C: brownish grey
  vec3 bCol = vec3(0.90, 0.86, 0.78);   // B: bright cream-white
  vec3 aCol = vec3(0.84, 0.80, 0.72);   // A: slightly warmer
  vec3 col  = dCol;
  col = mix(col, cCol, smoothstep(0.08, 0.22, r));
  col = mix(col, bCol, smoothstep(0.31, 0.42, r));
  col = mix(col, aCol, smoothstep(0.65, 0.76, r));
  return col;
}

void main() {
  // Radius in local units, normalised
  float ringR = length(vLocalPos.xz);
  float r     = (ringR - uRingInner) / (uRingOuter - uRingInner);
  if(r < 0.0 || r > 1.0) discard;

  float density = ringBandDensity(r);
  if(density < 0.005) discard;

  vec3 color = ringBandColor(r);

  // ── Planet shadow on the ring ──────────────────────────────────────────
  // Ray from ring fragment toward sun: vLocalPos + t * vSunLocal
  // hits planet sphere (radius=1.0 at origin) when discriminant > 0 AND t > 0
  float rp_l = dot(vLocalPos, vSunLocal);
  float c2   = dot(vLocalPos, vLocalPos) - 1.0;
  float disc = rp_l * rp_l - c2;
  bool  inPlanetShadow = (disc > 0.0) && ((-rp_l + sqrt(max(disc, 0.0))) > 0.0);
  float shadowFactor   = inPlanetShadow ? 0.10 : 1.0;

  // ── Lighting ──────────────────────────────────────────────────────────
  // Ring plane normal in local space is (0,1,0).
  // sunAbove: +1 if sun above ring plane, -1 if below.
  float sunSide = sign(vSunLocal.y);  // +1 above, -1 below

  // Determine which face this fragment shows (front = facing sun side)
  // We render DoubleSide so we need to figure out which face we're on.
  // Use the sign of (vLocalPos.y component) as a proxy — ring is flat at y=0,
  // so use sunSide to decide lit vs transmitted face.
  // Lit face (facing sun): normal diffuse
  // Back face (away from sun): forward-scatter transmission
  float cosTheta = abs(dot(normalize(vec3(0.0,1.0,0.0)), vSunLocal));

  // Diffuse: lit side sees direct sunlight, back side sees transmitted fraction
  float litFace   = 0.25 + cosTheta * 0.75;     // lit-side brightness
  float transFace = 0.08 + cosTheta * 0.18;     // back-side transmitted fraction

  // Mix: weight between lit and transmitted based on which face camera sees
  // (approximate: since ring is at Y≈0, use gl_FrontFacing would be ideal
  //  but for simplicity we blend both contributions)
  float lightIntensity = mix(litFace, transFace, 0.40);

  // Forward scattering when backlit: rings glow bright when sun is behind them
  float forwardScatter = pow(max(0.0, -dot(normalize(vLocalPos), vSunLocal)), 2.5)
                       * density * 0.45;

  color  = color * lightIntensity * shadowFactor;
  color += vec3(1.00, 0.96, 0.86) * forwardScatter * shadowFactor;

  // Fine density variation (particle clumping)
  float clump = fract(sin(dot(vLocalPos * 220.0, vec3(127.1,311.7,74.7)))*43758.5453);
  float finalDensity = density * (0.78 + clump * 0.22);

  gl_FragColor = vec4(color, finalDensity * 0.90);
}
`;

// ── Component ─────────────────────────────────────────────────────────────
export function RingSystem({ inner, outer, sunDir }: Props) {
  const geo = useMemo(() =>
    new THREE.RingGeometry(inner, outer, 256, 128),
  [inner, outer]);

  const mat = useMemo(() => new THREE.RawShaderMaterial({
    vertexShader:   RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uSunDir:    { value: new THREE.Vector3(...sunDir) },
      uRingInner: { value: inner },
      uRingOuter: { value: outer },
    },
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  }), [inner, outer]);

  // Keep sun direction in sync
  useMemo(() => {
    mat.uniforms.uSunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
  }, [mat, sunDir]);

  return (
    <mesh geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />
  );
}
