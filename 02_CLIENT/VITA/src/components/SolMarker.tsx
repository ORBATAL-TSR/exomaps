/**
 * SolMarker — Animated 3D reticle at the origin (Sol's position).
 *
 * Pure 3D geometry (spheres + rings + cylinders) —
 * no flat planes or sprites, so no clipping from any angle.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

const GOLD = '#fbbf24';
const WARM = '#ffd866';

export function SolMarker() {
  const innerRingRef = useRef<THREE.Mesh>(null!);
  const outerRingRef = useRef<THREE.Mesh>(null!);
  const coreRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (innerRingRef.current) {
      innerRingRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.3) * 0.15;
      innerRingRef.current.rotation.z = t * 0.2;
      (innerRingRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.35 + 0.1 * Math.sin(t * 1.4);
    }
    if (outerRingRef.current) {
      outerRingRef.current.rotation.x = Math.PI / 2 + Math.cos(t * 0.25) * 0.2;
      outerRingRef.current.rotation.z = -t * 0.12;
      (outerRingRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.18 + 0.06 * Math.sin(t * 0.9 + 1.0);
    }
    if (coreRef.current) {
      const pulse = 0.9 + 0.15 * Math.sin(t * 2.0);
      coreRef.current.scale.setScalar(pulse);
    }
    if (haloRef.current) {
      const hPulse = 0.85 + 0.2 * Math.sin(t * 1.5);
      haloRef.current.scale.setScalar(hPulse);
      (haloRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.08 + 0.04 * Math.sin(t * 1.8);
    }
  });

  const crossLines = useMemo(() => [
    { pos: [0.28, 0, 0] as [number,number,number], rot: [0, 0, Math.PI / 2] as [number,number,number], len: 0.2 },
    { pos: [-0.28, 0, 0] as [number,number,number], rot: [0, 0, Math.PI / 2] as [number,number,number], len: 0.2 },
    { pos: [0, 0, 0.28] as [number,number,number], rot: [Math.PI / 2, 0, 0] as [number,number,number], len: 0.2 },
    { pos: [0, 0, -0.28] as [number,number,number], rot: [Math.PI / 2, 0, 0] as [number,number,number], len: 0.2 },
  ], []);

  return (
    <group position={[0, 0, 0]}>
      {/* Glowing core sphere — visible from all angles */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color={WARM} transparent opacity={0.9}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Soft outer halo sphere */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.1}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Inner ring — rotating, tilts gently */}
      <mesh ref={innerRingRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.20, 32]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.35}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Outer ring — counter-rotating */}
      <mesh ref={outerRingRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.30, 0.33, 48]} />
        <meshBasicMaterial color={WARM} transparent opacity={0.18}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Crosshair lines — thin cylinders, no clipping */}
      {crossLines.map((seg, i) => (
        <mesh key={i} position={seg.pos} rotation={seg.rot}>
          <cylinderGeometry args={[0.004, 0.004, seg.len, 4]} />
          <meshBasicMaterial color={GOLD} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}

      {/* "SOL" label */}
      <Text position={[0, 0.05, 0.45]} fontSize={0.12}
        color={GOLD} fillOpacity={0.45}
        anchorX="center" anchorY="middle"
        rotation={[-Math.PI / 2, 0, 0]}>
        SOL
      </Text>

      <pointLight color="#ffd866" intensity={0.4} distance={8} />
    </group>
  );
}
