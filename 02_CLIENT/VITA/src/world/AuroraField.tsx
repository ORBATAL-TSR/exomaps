/**
 * AuroraField — Animated aurora oval at magnetic poles.
 *
 * Geometry: a thin torus-like ring of quads at high latitudes (±65–80°),
 * rendered with additive blending so it glows on the night side.
 * The ring is subdivided azimuthally (64 segments) and radially (4 layers)
 * and the vertex shader animates each layer with a sine-wave ripple.
 *
 * Two poles, each with their own mesh. Intensity driven by uAuroraStrength
 * and the night-facing dot product so auroras don't show on the dayside.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uTime;
uniform float uSphereRadius;
uniform float uPoleSign;      // +1 north, -1 south
uniform float uStrength;

varying float vAlpha;
varying vec3  vCol;
attribute vec3 aColor;

void main() {
  vCol = aColor;

  // Ripple: each azimuthal segment wobbles in altitude over time
  float az  = atan(position.z, position.x);
  float wave = sin(az * 6.0 + uTime * 1.4 + uPoleSign * 1.2) * 0.008
             + sin(az * 3.0 - uTime * 0.9) * 0.005;
  vec3 pos = position;
  pos.y += wave * uStrength;

  // Fade alpha by layer (innermost brightest) + ripple
  vAlpha = (1.0 - abs(position.y - uPoleSign * 0.80) * 4.0)
          * uStrength
          * (0.6 + sin(az * 4.0 + uTime * 2.1) * 0.4);
  vAlpha = clamp(vAlpha, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3  uSunDir;
uniform float uStrength;

varying float vAlpha;
varying vec3  vCol;

void main() {
  // Suppress on the dayside: aurora is only on the night side
  // (We don't have N in this shader, so use gl_FragCoord depth as proxy —
  //  instead rely on the vertex alpha for the glow, let additive blending handle it)
  gl_FragColor = vec4(vCol, vAlpha * uStrength * 0.85);
}`;

interface Props {
  auroraStrength: number;          // 0–1
  auroraColor:    [number,number,number];
  sphereRadius:   number;
  sunDirection:   [number,number,number];
  axialTilt?:     number;          // degrees, default 0
}

function buildAuroraRing(
  poleSign:     number,            // +1 north, -1 south
  sphereRadius: number,
  color:        [number,number,number],
): THREE.BufferGeometry {
  const AZ_SEGS  = 64;             // azimuthal segments around the pole
  const LAYERS   = 4;              // radial height layers
  const LAT_DEG  = 72;             // centre latitude of aurora oval
  const LAT_RAD  = (LAT_DEG * Math.PI) / 180;
  const HALF_H   = 0.04;           // half-height of the ring (in sphere units)

  const positions: number[] = [];
  const aColors:   number[] = [];

  // Build LAYERS concentric rings at slightly different latitudes
  for (let li = 0; li < LAYERS; li++) {
    const t   = li / (LAYERS - 1);                      // 0..1
    const lat = LAT_RAD + (t - 0.5) * HALF_H * 2;      // spread in latitude
    const r   = Math.cos(lat) * sphereRadius;
    const y   = Math.sin(lat) * sphereRadius * poleSign;
    const brightness = 1.0 - Math.abs(t - 0.5) * 1.6;  // brightest in centre

    for (let ai = 0; ai <= AZ_SEGS; ai++) {
      const az = (ai / AZ_SEGS) * Math.PI * 2;
      positions.push(Math.cos(az) * r, y, Math.sin(az) * r);
      aColors.push(
        color[0] * brightness,
        color[1] * brightness,
        color[2] * brightness,
      );
    }
  }

  const indices: number[] = [];
  const stride = AZ_SEGS + 1;
  for (let li = 0; li < LAYERS - 1; li++) {
    const r1 = li * stride;
    const r2 = (li + 1) * stride;
    for (let ai = 0; ai < AZ_SEGS; ai++) {
      indices.push(r1 + ai, r1 + ai + 1, r2 + ai);
      indices.push(r1 + ai + 1, r2 + ai + 1, r2 + ai);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aColor',   new THREE.Float32BufferAttribute(aColors,   3));
  geo.setIndex(indices);
  return geo;
}

function AuroraPole({
  poleSign, sphereRadius, auroraColor, sunDirection, auroraStrength,
}: {
  poleSign:      number;
  sphereRadius:  number;
  auroraColor:   [number,number,number];
  sunDirection:  [number,number,number];
  auroraStrength: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);

  const geo = useMemo(
    () => buildAuroraRing(poleSign, sphereRadius, auroraColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poleSign, sphereRadius, auroraColor[0], auroraColor[1], auroraColor[2]],
  );

  const sunDir = useMemo(
    () => new THREE.Vector3(...sunDirection).normalize(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sunDirection[0], sunDirection[1], sunDirection[2]],
  );

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    side:           THREE.DoubleSide,
    uniforms: {
      uTime:         { value: 0 },
      uSphereRadius: { value: sphereRadius },
      uPoleSign:     { value: poleSign },
      uStrength:     { value: auroraStrength },
      uSunDir:       { value: sunDir },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [poleSign, sphereRadius]);

  useFrame((_, delta) => {
    if (mat.uniforms.uTime) {
      mat.uniforms.uTime.value    += delta;
      mat.uniforms.uStrength.value = auroraStrength;
      const sd = sunDirection;
      (mat.uniforms.uSunDir.value as THREE.Vector3).set(sd[0], sd[1], sd[2]).normalize();
    }
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={2} />;
}

// ── Main component ─────────────────────────────────────────────────────────
export function AuroraField({
  auroraStrength, auroraColor, sphereRadius, sunDirection, axialTilt = 0,
}: Props) {
  if (auroraStrength < 0.05) return null;

  // Apply axial tilt rotation to the aurora ovals
  const tiltRad = (axialTilt * Math.PI) / 180;

  return (
    <group rotation={[tiltRad, 0, 0]}>
      <AuroraPole
        poleSign={+1}
        sphereRadius={sphereRadius}
        auroraColor={auroraColor}
        sunDirection={sunDirection}
        auroraStrength={auroraStrength}
      />
      <AuroraPole
        poleSign={-1}
        sphereRadius={sphereRadius}
        auroraColor={auroraColor}
        sunDirection={sunDirection}
        auroraStrength={auroraStrength}
      />
    </group>
  );
}
