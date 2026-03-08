/**
 * DistanceRings — Concentric rings on the galactic plane showing
 * distance from Sol (2, 5, 10, 15, 20, 30 light-years).
 *
 * Each ring is a thin line loop with a label. Replaces the old flat grid.
 */
import { useMemo } from 'react';
import { Line, Text } from '@react-three/drei';

const RINGS = [
  { radius: 2,  label: '2 ly',  opacity: 0.20 },
  { radius: 5,  label: '5 ly',  opacity: 0.18 },
  { radius: 10, label: '10 ly', opacity: 0.14 },
  { radius: 15, label: '15 ly', opacity: 0.10 },
  { radius: 20, label: '20 ly', opacity: 0.08 },
  { radius: 30, label: '30 ly', opacity: 0.06 },
];

const RING_SEGMENTS = 128;

function RingCircle({ radius, opacity }: { radius: number; opacity: number }) {
  const points = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const theta = (i / RING_SEGMENTS) * Math.PI * 2;
      pts.push([Math.cos(theta) * radius, 0, Math.sin(theta) * radius]);
    }
    return pts;
  }, [radius]);

  return (
    <Line
      points={points}
      color="#2a5090"
      lineWidth={1}
      transparent
      opacity={opacity}
    />
  );
}

export function DistanceRings() {
  return (
    <group position={[0, -0.02, 0]}>
      {RINGS.map(ring => (
        <group key={ring.radius}>
          <RingCircle radius={ring.radius} opacity={ring.opacity} />
          <Text
            position={[ring.radius + 0.1, 0, 0.3]}
            fontSize={ring.radius < 10 ? 0.25 : 0.35}
            color="#2a5090"
            fillOpacity={ring.opacity * 2.5}
            anchorX="left"
            anchorY="middle"
            rotation={[-Math.PI / 2, 0, 0]}
          >
            {ring.label}
          </Text>
        </group>
      ))}

      {/* Subtle galactic plane — very faint grid for orientation */}
      <gridHelper args={[80, 80, '#0d1825', '#080e18']} />

      {/* Axis indicators — subtle, shorter */}
      <group>
        {/* X axis — faint red */}
        <mesh position={[1.5, 0, 0]}>
          <boxGeometry args={[3, 0.003, 0.003]} />
          <meshBasicMaterial color="#ff4444" transparent opacity={0.12} />
        </mesh>
        {/* Z axis — faint blue */}
        <mesh position={[0, 0, 1.5]}>
          <boxGeometry args={[0.003, 0.003, 3]} />
          <meshBasicMaterial color="#4488ff" transparent opacity={0.12} />
        </mesh>
      </group>
    </group>
  );
}
