/**
 * StarField — GPU-instanced star renderer for the desktop client.
 *
 * Renders 1,600+ stars as GL_POINTS with custom GLSL shaders:
 *   - Spectral-type colors (Harvard Teff → sRGB)
 *   - Luminosity-scaled sizes
 *   - Binary/trinary ring indicators
 *   - Planet-host breathing pulse
 *   - Selected-star aura + neighborhood dimming
 *   - Twinkle animation
 *
 * Ported from 01_WEB StarField.tsx, using the shared shader source.
 */
import { useRef, useMemo, useEffect, useCallback } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { starVertexShader, starFragmentShader } from '@exomaps/shared/shaders/starShaders';

/* ── Types ────────────────────────────────────── */

export interface StarSystem {
  main_id: string;
  x: number;
  y: number;
  z: number;
  distance_ly: number;
  spectral_class: string;
  teff: number;
  luminosity: number;
  multiplicity: number;
  planet_count: number;
  confidence: string;
  companions: { name: string; separation_au: number; bond_type: string }[];
  system_group: string | null;
  group_hierarchy: string | null;
}

interface Props {
  systems: StarSystem[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onHover?: (system: StarSystem | null) => void;
  /** When set, unexplored systems are dimmed (campaign fog-of-war). */
  exploredIds?: Set<string> | null;
}

function confidenceFloat(c: string): number {
  return c === 'observed' ? 1.0 : 0.3;
}

export function StarField({ systems, selectedId, onSelect, onHover, exploredIds }: Props) {
  const pointsRef = useRef<THREE.Points>(null!);
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  const selectedBufRef = useRef<THREE.BufferAttribute | null>(null);
  const exploredBufRef = useRef<THREE.BufferAttribute | null>(null);

  /* ── Build attribute buffers ─────────────────── */
  const buffers = useMemo(() => {
    const n = systems.length;
    const pos = new Float32Array(n * 3);
    const lum = new Float32Array(n);
    const tef = new Float32Array(n);
    const mul = new Float32Array(n);
    const con = new Float32Array(n);
    const pla = new Float32Array(n);
    const sel = new Float32Array(n);
    const exp = new Float32Array(n);

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
      exp[i] = 1.0; // default: all visible when no campaign
    }

    return { positions: pos, luminosities: lum, teffs: tef, multiplicities: mul, confidences: con, planetCounts: pla, selected: sel, explored: exp };
  }, [systems]);

  /* ── Geometry ────────────────────────────────── */
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

    const expAttr = new THREE.BufferAttribute(buffers.explored, 1);
    expAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aExplored', expAttr);
    exploredBufRef.current = expAttr;

    return geo;
  }, [buffers]);

  /* ── Selection update ────────────────────────── */
  useEffect(() => {
    const attr = selectedBufRef.current;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < systems.length; i++) {
      arr[i] = systems[i].main_id === selectedId ? 1.0 : 0.0;
    }
    attr.needsUpdate = true;
  }, [selectedId, systems]);

  /* ── Fog-of-war update ─────────────────────────── */
  useEffect(() => {
    const attr = exploredBufRef.current;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    if (!exploredIds) {
      // No campaign active — all stars fully visible
      arr.fill(1.0);
    } else {
      for (let i = 0; i < systems.length; i++) {
        arr[i] = exploredIds.has(systems[i].main_id) ? 1.0 : 0.0;
      }
    }
    attr.needsUpdate = true;
  }, [exploredIds, systems]);

  /* ── Shader uniforms ─────────────────────────── */
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBaseSize: { value: 22.0 },
      uFocusCenter: { value: new THREE.Vector3(0, 0, 0) },
      uFocusRadius: { value: 4.6 },
      uFogEnabled: { value: 0.0 },
    }),
    [],
  );

  /* ── Patch shaders for fog-of-war ───────────── */
  const patchedVertex = useMemo(() => {
    // Inject aExplored attribute + varying after existing attributes
    let vs = starVertexShader;
    vs = vs.replace(
      'attribute float aSelected;',
      'attribute float aSelected;\n  attribute float aExplored;',
    );
    vs = vs.replace(
      'varying float vFocusFade;',
      'varying float vFocusFade;\n  varying float vExplored;',
    );
    // Set varying before gl_Position assignment
    vs = vs.replace(
      'vFocusFade = focusFade;',
      'vFocusFade = focusFade;\n    vExplored = aExplored;',
    );
    // Scale down unexplored stars
    vs = vs.replace(
      'gl_PointSize = clamp(gl_PointSize, 1.8, 55.0);',
      'gl_PointSize = clamp(gl_PointSize, 1.8, 55.0);\n    gl_PointSize *= mix(0.35, 1.0, aExplored);',
    );
    return vs;
  }, []);

  const patchedFragment = useMemo(() => {
    let fs = starFragmentShader;
    // Add varying and uniform
    fs = fs.replace(
      'varying float vFocusFade;',
      'varying float vFocusFade;\n  varying float vExplored;\n  uniform float uFogEnabled;',
    );
    // Before final gl_FragColor, apply fog dimming
    fs = fs.replace(
      'gl_FragColor = vec4(color * intensity * vFocusFade, alpha);',
      `// Fog-of-war: unexplored stars become dim blue ghosts
    if (uFogEnabled > 0.5 && vExplored < 0.5) {
      color = mix(color, vec3(0.10, 0.14, 0.28), 0.85);
      alpha *= 0.12;
    }
    gl_FragColor = vec4(color * intensity * vFocusFade, alpha);`,
    );
    return fs;
  }, []);

  /* ── Animate ─────────────────────────────────── */
  useFrame(({ clock, camera }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
      materialRef.current.uniforms.uFocusCenter.value.copy(camera.position).multiplyScalar(0.3);
      materialRef.current.uniforms.uFogEnabled.value = exploredIds ? 1.0 : 0.0;
    }
  });

  /* ── Click handler ───────────────────────────── */
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onSelect) return;
      e.stopPropagation();
      const idx = e.index as number | undefined;
      if (idx != null && idx < systems.length) {
        const sys = systems[idx];
        onSelect(selectedId === sys.main_id ? null : sys.main_id);
      }
    },
    [onSelect, selectedId, systems],
  );

  /* ── Hover handler ───────────────────────────── */
  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!onHover) return;
      e.stopPropagation();
      const idx = e.index as number | undefined;
      if (idx != null && idx < systems.length) {
        onHover(systems[idx]);
      }
    },
    [onHover, systems],
  );

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
        vertexShader={patchedVertex}
        fragmentShader={patchedFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
