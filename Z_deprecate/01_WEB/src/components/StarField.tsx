/**
 * StarField – GPU-instanced star renderer using custom GLSL shaders.
 *
 * Renders thousands of stars as GL_POINTS with:
 *   - Vivid spectral-type colors (Harvard classification Teff → sRGB)
 *   - Luminosity-scaled sizes (L^0.35)
 *   - Binary/trinary ring indicators
 *   - Planet-host breathing pulse
 *   - Selected-star aura
 *   - Twinkle animation
 *   - Distance fog
 *   - Confidence dimming for inferred stars
 *
 * Supports click-to-select and hover detection for tooltips.
 */
import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { starVertexShader, starFragmentShader } from '../shaders/starShaders';
import type { StarSystemFull } from '../types/api';

interface StarFieldProps {
  systems: StarSystemFull[];
  /** Called when close enough star is clicked / ray-picked */
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  /** Called on pointer hover with system index (null = unhover) */
  onHover?: (system: StarSystemFull | null, event?: ThreeEvent<PointerEvent>) => void;
}

/** Map confidence string → float for shader. */
function confidenceFloat(c: string): number {
  return c === 'observed' ? 1.0 : 0.3;
}

export default function StarField({ systems, onSelect, selectedId, onHover }: StarFieldProps) {
  const pointsRef = useRef<THREE.Points>(null!);
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  const selectedBufRef = useRef<THREE.BufferAttribute | null>(null);

  /* ── Build attribute buffers ──────────────────────── */
  const buffers = useMemo(() => {
    const n = systems.length;
    const pos = new Float32Array(n * 3);
    const lum = new Float32Array(n);
    const tef = new Float32Array(n);
    const mul = new Float32Array(n);
    const con = new Float32Array(n);
    const pla = new Float32Array(n);
    const sel = new Float32Array(n);  // all 0 initially

    for (let i = 0; i < n; i++) {
      const s = systems[i];
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.y;
      pos[i * 3 + 2] = s.z;
      lum[i] = Math.max(s.luminosity, 0.01);
      tef[i] = s.teff;
      mul[i] = s.multiplicity;
      con[i] = confidenceFloat(s.confidence);
      pla[i] = s.planet_count;
    }

    return { positions: pos, luminosities: lum, teffs: tef, multiplicities: mul, confidences: con, planetCounts: pla, selected: sel };
  }, [systems]);

  /* ── Geometry with custom attributes ──────────────── */
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geo.setAttribute('aLuminosity', new THREE.BufferAttribute(buffers.luminosities, 1));
    geo.setAttribute('aTeff', new THREE.BufferAttribute(buffers.teffs, 1));
    geo.setAttribute('aMultiplicity', new THREE.BufferAttribute(buffers.multiplicities, 1));
    geo.setAttribute('aConfidence', new THREE.BufferAttribute(buffers.confidences, 1));
    geo.setAttribute('aPlanetCount', new THREE.BufferAttribute(buffers.planetCounts, 1));
    const selAttr = new THREE.BufferAttribute(buffers.selected, 1);
    selAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSelected', selAttr);
    selectedBufRef.current = selAttr;
    return geo;
  }, [buffers]);

  /* ── Update aSelected buffer when selection changes ─ */
  useEffect(() => {
    const attr = selectedBufRef.current;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < systems.length; i++) {
      arr[i] = systems[i].main_id === selectedId ? 1.0 : 0.0;
    }
    attr.needsUpdate = true;
  }, [selectedId, systems]);

  /* ── Shader material ──────────────────────────────── */
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBaseSize: { value: 22.0 },
      uFocusCenter: { value: new THREE.Vector3(0, 0, 0) },
      uFocusRadius: { value: 4.6 },  // ~15 ly in parsecs
    }),
    [],
  );

  /* ── Animate: update time uniform ─────────────────── */
  useFrame(({ clock, camera }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
      // Focus center follows the camera's look-at target (approximated by camera position)
      materialRef.current.uniforms.uFocusCenter.value.copy(camera.position).multiplyScalar(0.3);
    }
  });

  /* ── Click / raycasting handler ───────────────────── */
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return;
    e.stopPropagation();
    const idx = e.index as number | undefined;
    if (idx != null && idx < systems.length) {
      const sys = systems[idx];
      onSelect(selectedId === sys.main_id ? null : sys.main_id);
    }
  }, [onSelect, selectedId, systems]);

  /* ── Hover handler ────────────────────────────────── */
  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!onHover) return;
    e.stopPropagation();
    const idx = e.index as number | undefined;
    if (idx != null && idx < systems.length) {
      onHover(systems[idx], e);
    }
  }, [onHover, systems]);

  const handlePointerOut = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  if (systems.length === 0) return null;

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
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
