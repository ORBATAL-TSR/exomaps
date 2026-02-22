/**
 * StarField – GPU-instanced star renderer using custom GLSL shaders.
 *
 * Renders thousands of stars as GL_POINTS with:
 *   - Spectral-type colors (Harvard classification Teff → sRGB)
 *   - Luminosity-scaled sizes
 *   - Binary/trinary ring indicators
 *   - Twinkle animation
 *   - Distance fog
 *   - Confidence dimming for inferred stars
 */
import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { starVertexShader, starFragmentShader } from '../shaders/starShaders';
import type { StarSystemFull } from '../types/api';

interface StarFieldProps {
  systems: StarSystemFull[];
  /** Called when close enough star is clicked / ray-picked */
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
}

/**
 * Map confidence string → float for shader.
 */
function confidenceFloat(c: string): number {
  return c === 'observed' ? 1.0 : 0.3;
}

export default function StarField({ systems, onSelect, selectedId }: StarFieldProps) {
  const pointsRef = useRef<THREE.Points>(null!);
  const materialRef = useRef<THREE.ShaderMaterial>(null!);

  /* ── Build attribute buffers ──────────────────────── */
  const { positions, luminosities, teffs, multiplicities, confidences } = useMemo(() => {
    const n = systems.length;
    const pos = new Float32Array(n * 3);
    const lum = new Float32Array(n);
    const tef = new Float32Array(n);
    const mul = new Float32Array(n);
    const con = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const s = systems[i];
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
      lum[i] = Math.max(s.luminosity, 0.01);
      tef[i] = s.teff;
      mul[i] = s.multiplicity;
      con[i] = confidenceFloat(s.confidence);
    }

    return {
      positions: pos,
      luminosities: lum,
      teffs: tef,
      multiplicities: mul,
      confidences: con,
    };
  }, [systems]);

  /* ── Geometry with custom attributes ──────────────── */
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLuminosity', new THREE.BufferAttribute(luminosities, 1));
    geo.setAttribute('aTeff', new THREE.BufferAttribute(teffs, 1));
    geo.setAttribute('aMultiplicity', new THREE.BufferAttribute(multiplicities, 1));
    geo.setAttribute('aConfidence', new THREE.BufferAttribute(confidences, 1));
    return geo;
  }, [positions, luminosities, teffs, multiplicities, confidences]);

  /* ── Shader material ──────────────────────────────── */
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBaseSize: { value: 24.0 },
    }),
    [],
  );

  /* ── Animate: update time uniform ─────────────────── */
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  /* ── Click / raycasting handler ───────────────────── */
  const handleClick = (e: any) => {
    if (!onSelect) return;
    e.stopPropagation();
    const idx = e.index as number | undefined;
    if (idx != null && idx < systems.length) {
      const sys = systems[idx];
      onSelect(selectedId === sys.main_id ? null : sys.main_id);
    }
  };

  if (systems.length === 0) return null;

  return (
    <points ref={pointsRef} geometry={geometry} onClick={handleClick}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={starVertexShader}
        fragmentShader={starFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
