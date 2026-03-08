/**
 * CompanionBonds – Visual tethers between gravitationally bound stars.
 *
 * Renders two styles of connection:
 *   - CLOSE BINARY: tight orbital ellipse arc (pulsing amber)
 *   - WIDE COMPANION: long dashed tether (dim cyan)
 *
 * Always visible for catalogued systems; brightens when either end is selected.
 * Uses custom GLSL for the animated dash/pulse effect.
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { StarSystemFull } from '../types/api';

interface CompanionBondsProps {
  systems: StarSystemFull[];
  selectedId: string | null;
}

/* ── Bond shaders ──────────────────────────────────── */
const bondVertexShader = /* glsl */ `
  attribute float aLineT;
  varying float vLineT;
  void main() {
    vLineT = aLineT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const closeBinaryFragShader = /* glsl */ `
  uniform float uTime;
  uniform float uSelected;
  varying float vLineT;
  void main() {
    // Tight pulsing amber for close binaries
    float pulse = sin((vLineT - uTime * 0.8) * 25.13) * 0.5 + 0.5;
    pulse = pow(pulse, 3.0);
    float base = mix(0.10, 0.30, uSelected);
    float alpha = base + pulse * mix(0.35, 0.60, uSelected);
    float endFade = smoothstep(0.0, 0.08, vLineT) * smoothstep(1.0, 0.92, vLineT);
    alpha *= endFade;
    vec3 color = mix(vec3(1.0, 0.75, 0.2), vec3(1.0, 0.85, 0.4), pulse);
    gl_FragColor = vec4(color, alpha);
  }
`;

const wideCompanionFragShader = /* glsl */ `
  uniform float uTime;
  uniform float uSelected;
  varying float vLineT;
  void main() {
    // Dashed tether for wide companions
    float dashPattern = step(0.5, fract(vLineT * 12.0 - uTime * 0.3));
    float base = mix(0.06, 0.18, uSelected);
    float alpha = base + dashPattern * mix(0.14, 0.35, uSelected);
    float endFade = smoothstep(0.0, 0.04, vLineT) * smoothstep(1.0, 0.96, vLineT);
    alpha *= endFade;
    vec3 color = vec3(0.35, 0.75, 0.90);
    gl_FragColor = vec4(color, alpha);
  }
`;

/* ── Single bond segment ──────────────────────────── */
function BondSegment({
  from,
  to,
  bondType,
  separationAU,
  selected,
  fromName,
  toName,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  bondType: 'close_binary' | 'wide_companion';
  separationAU: number;
  selected: boolean;
  fromName: string;
  toName: string;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);

  const { geometry, midpoint } = useMemo(() => {
    const SEGMENTS = bondType === 'close_binary' ? 24 : 40;
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const lineTs = new Float32Array(SEGMENTS + 1);

    if (bondType === 'close_binary') {
      // Slight arc (orbital hint) between close components
      const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
      const offset = new THREE.Vector3()
        .subVectors(to, from)
        .cross(new THREE.Vector3(0, 1, 0))
        .normalize()
        .multiplyScalar(from.distanceTo(to) * 0.15);
      const ctrl = mid.clone().add(offset);

      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        // Quadratic Bezier
        const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * ctrl.x + t * t * to.x;
        const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * ctrl.y + t * t * to.y;
        const z = (1 - t) * (1 - t) * from.z + 2 * (1 - t) * t * ctrl.z + t * t * to.z;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        lineTs[i] = t;
      }
    } else {
      // Straight dashed line for wide companions
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        positions[i * 3] = from.x + (to.x - from.x) * t;
        positions[i * 3 + 1] = from.y + (to.y - from.y) * t;
        positions[i * 3 + 2] = from.z + (to.z - from.z) * t;
        lineTs[i] = t;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLineT', new THREE.BufferAttribute(lineTs, 1));
    return {
      geometry: geo,
      midpoint: new THREE.Vector3().lerpVectors(from, to, 0.5),
    };
  }, [from, to, bondType]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: bondVertexShader,
      fragmentShader: bondType === 'close_binary' ? closeBinaryFragShader : wideCompanionFragShader,
      uniforms: {
        uTime: { value: 0 },
        uSelected: { value: selected ? 1.0 : 0.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [bondType, selected]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.getElapsedTime();
      matRef.current.uniforms.uSelected.value = selected ? 1.0 : 0.0;
    }
  });

  const sepLabel = separationAU >= 1000
    ? `${(separationAU / 1000).toFixed(1)}k AU`
    : `${separationAU.toFixed(0)} AU`;

  return (
    <group>
      <primitive
        ref={(obj: any) => {
          if (obj) matRef.current = obj.material;
        }}
        object={new THREE.Line(geometry, material)}
      />
      {/* Midpoint label (only when selected) */}
      {selected && (
        <Html position={midpoint} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              color: bondType === 'close_binary' ? '#fbbf24' : '#67e8f9',
              fontSize: 8,
              fontFamily: "'JetBrains Mono', monospace",
              background: 'rgba(6,10,18,0.80)',
              padding: '1px 4px',
              borderRadius: 2,
              border: `1px solid ${bondType === 'close_binary' ? 'rgba(251,191,36,0.3)' : 'rgba(34,211,238,0.2)'}`,
              whiteSpace: 'nowrap',
              opacity: 0.9,
            }}
          >
            {sepLabel} · {bondType === 'close_binary' ? 'binary' : 'wide'}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ── Main CompanionBonds component ─────────────────── */
export default function CompanionBonds({ systems, selectedId }: CompanionBondsProps) {
  // Build all bonds to render (deduplicate: only render A→B, not B→A)
  const bonds = useMemo(() => {
    const nameMap = new Map<string, StarSystemFull>();
    for (const s of systems) {
      nameMap.set(s.main_id, s);
    }

    const rendered = new Set<string>();
    const result: {
      from: StarSystemFull;
      to: StarSystemFull;
      bondType: 'close_binary' | 'wide_companion';
      separationAU: number;
    }[] = [];

    for (const s of systems) {
      if (!s.companions || s.companions.length === 0) continue;
      for (const comp of s.companions) {
        const partner = nameMap.get(comp.name);
        if (!partner) continue;
        // Deduplicate: use sorted key
        const key = [s.main_id, comp.name].sort().join('|');
        if (rendered.has(key)) continue;
        rendered.add(key);
        result.push({
          from: s,
          to: partner,
          bondType: comp.bond_type,
          separationAU: comp.separation_au,
        });
      }
    }
    return result;
  }, [systems]);

  if (bonds.length === 0) return null;

  return (
    <group>
      {bonds.map((bond) => {
        const fromPos = new THREE.Vector3(bond.from.x, bond.from.y, bond.from.z);
        const toPos = new THREE.Vector3(bond.to.x, bond.to.y, bond.to.z);
        const isSelected = selectedId === bond.from.main_id || selectedId === bond.to.main_id;

        return (
          <BondSegment
            key={`${bond.from.main_id}|${bond.to.main_id}`}
            from={fromPos}
            to={toPos}
            bondType={bond.bondType}
            separationAU={bond.separationAU}
            selected={isSelected}
            fromName={bond.from.main_id}
            toName={bond.to.main_id}
          />
        );
      })}
    </group>
  );
}
