/**
 * Starlanes – Renders a faint network of nearest-neighbor connections
 * across the entire star field. Selected star's lanes brighten with
 * animated energy pulses and distance labels.
 *
 * Performance: precomputes all lane geometry once into merged buffers.
 * Only the selected star's lanes get the full pulse treatment.
 */
import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { StarSystemFull } from '../types/api';

const K_NEIGHBORS = 3;

interface StarlanesProps {
  systems: StarSystemFull[];
  selectedId: string | null;
  /** Called when user clicks a neighbor node on a starlane */
  onNavigate?: (id: string) => void;
}

/* ── Nearest-neighbor computation ──────────────────── */
function findKNearest(
  target: StarSystemFull,
  systems: StarSystemFull[],
  k: number,
): StarSystemFull[] {
  const dists: { sys: StarSystemFull; d: number }[] = [];
  for (const s of systems) {
    if (s.main_id === target.main_id) continue;
    const dx = s.x - target.x;
    const dy = s.y - target.y;
    const dz = s.z - target.z;
    dists.push({ sys: s, d: dx * dx + dy * dy + dz * dz });
  }
  dists.sort((a, b) => a.d - b.d);
  return dists.slice(0, k).map((d) => d.sys);
}

/* ── Passive lane shader (faint static lines, camera-distance fade) ── */
const passiveVertexShader = /* glsl */ `
  varying float vDist;
  uniform vec3 uCameraPos;
  void main() {
    // World-space distance to camera for proximity fade
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vDist = distance(worldPos.xyz, uCameraPos);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const passiveFragmentShader = /* glsl */ `
  varying float vDist;
  void main() {
    // Close starlanes visible, far ones fade out
    float nearFade = smoothstep(70.0, 20.0, vDist);
    float alpha = 0.07 * nearFade;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(0.18, 0.35, 0.55, alpha);
  }
`;

/* ── Active lane shader (pulsing selected lanes) ───── */
const laneVertexShader = /* glsl */ `
  attribute float aLineT;  // 0 at start, 1 at end
  varying float vLineT;
  void main() {
    vLineT = aLineT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const laneFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying float vLineT;
  void main() {
    // Traveling pulse along the line
    float pulse = sin((vLineT - uTime * 0.6) * 12.566) * 0.5 + 0.5;
    pulse = pow(pulse, 4.0);

    float base = 0.14;
    float alpha = base + pulse * 0.55;

    // Fade at endpoints
    float endFade = smoothstep(0.0, 0.05, vLineT) * smoothstep(1.0, 0.95, vLineT);
    alpha *= endFade;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

/* ── Passive network: merged geometry of ALL lanes ─── */
function PassiveNetwork({ systems }: { systems: StarSystemFull[] }) {
  const meshRef = useRef<THREE.LineSegments>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const { camera } = useThree();

  const geometry = useMemo(() => {
    if (systems.length === 0) return null;

    // Precompute all edges (deduplicated)
    const edges = new Set<string>();
    const positions: number[] = [];

    for (const s of systems) {
      const neighbors = findKNearest(s, systems, K_NEIGHBORS);
      for (const nb of neighbors) {
        const key = [s.main_id, nb.main_id].sort().join('|');
        if (edges.has(key)) continue;
        edges.add(key);
        // Just two endpoints per segment for LineSegments
        positions.push(s.x, s.y, s.z, nb.x, nb.y, nb.z);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [systems]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: passiveVertexShader,
      fragmentShader: passiveFragmentShader,
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  useEffect(() => {
    matRef.current = material;
  }, [material]);

  // Update camera position uniform every frame
  useFrame(() => {
    if (matRef.current) {
      matRef.current.uniforms.uCameraPos.value.copy(camera.position);
    }
  });

  if (!geometry) return null;

  return <lineSegments ref={meshRef} geometry={geometry} material={material} />;
}

/* ── Single active starlane line ───────────────────── */
function StarlaneSegment({
  from,
  to,
  color,
  distancePc,
  onNavigate,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  distancePc: number;
  onNavigate?: () => void;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);

  const { geometry, midpoint } = useMemo(() => {
    const SEGMENTS = 32;
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const lineTs = new Float32Array(SEGMENTS + 1);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      positions[i * 3] = from.x + (to.x - from.x) * t;
      positions[i * 3 + 1] = from.y + (to.y - from.y) * t;
      positions[i * 3 + 2] = from.z + (to.z - from.z) * t;
      lineTs[i] = t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLineT', new THREE.BufferAttribute(lineTs, 1));
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    return { geometry: geo, midpoint: mid };
  }, [from, to]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: laneVertexShader,
      fragmentShader: laneFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: color },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [color]);

  useEffect(() => {
    matRef.current = material;
  }, [material]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  const distLy = distancePc * 3.26156;

  return (
    <group>
      <primitive ref={(obj: any) => { if (obj) matRef.current = obj.material; }} object={new THREE.Line(geometry, material)} />
      {/* Midpoint distance label */}
      <Html position={midpoint} center style={{ pointerEvents: onNavigate ? 'auto' : 'none' }}>
        <div
          onClick={onNavigate}
          style={{
            color: '#67e8f9',
            fontSize: 9,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            background: 'rgba(6,10,18,0.75)',
            padding: '1px 5px',
            borderRadius: 3,
            border: '1px solid rgba(34,211,238,0.25)',
            whiteSpace: 'nowrap',
            cursor: onNavigate ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          {distLy.toFixed(1)} ly
        </div>
      </Html>
    </group>
  );
}

/* ── Main Starlanes component ──────────────────────── */
export default function Starlanes({ systems, selectedId, onNavigate }: StarlanesProps) {
  const selected = useMemo(
    () => systems.find((s) => s.main_id === selectedId) ?? null,
    [systems, selectedId],
  );

  const neighbors = useMemo(() => {
    if (!selected) return [];
    return findKNearest(selected, systems, K_NEIGHBORS);
  }, [selected, systems]);

  const laneColor = useMemo(() => new THREE.Color(0x22d3ee), []);

  return (
    <group>
      {/* Faint network of ALL neighbor connections */}
      <PassiveNetwork systems={systems} />

      {/* Active pulsing lanes for selected star */}
      {selected && neighbors.map((nb) => {
        const origin = new THREE.Vector3(selected.x, selected.y, selected.z);
        const dest = new THREE.Vector3(nb.x, nb.y, nb.z);
        const distPc = origin.distanceTo(dest);
        return (
          <StarlaneSegment
            key={nb.main_id}
            from={origin}
            to={dest}
            color={laneColor}
            distancePc={distPc}
            onNavigate={onNavigate ? () => onNavigate(nb.main_id) : undefined}
          />
        );
      })}
    </group>
  );
}

/** Export the neighbor finder for use by the star card */
export { findKNearest, K_NEIGHBORS };
