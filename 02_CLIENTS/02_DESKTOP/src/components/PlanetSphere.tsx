/**
 * PlanetSphere — Renders a planet using GPU-generated textures.
 *
 * Receives base64-encoded PNG textures from the Rust backend
 * and maps them onto a sphere with slow rotation.
 */

import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlanetTextures } from '../hooks/useTauriGPU';

interface Props {
  textures: PlanetTextures;
  radius?: number;
}

/** Decode a base64 PNG into a Three.js texture. */
function base64ToTexture(base64: string): THREE.Texture {
  const img = new Image();
  img.src = `data:image/png;base64,${base64}`;
  const tex = new THREE.Texture(img);
  img.onload = () => {
    tex.needsUpdate = true;
  };
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function PlanetSphere({ textures, radius = 1 }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);

  const [albedoTex, normalTex, heightTex] = useMemo(() => {
    return [
      base64ToTexture(textures.albedo_base64),
      base64ToTexture(textures.normal_base64),
      base64ToTexture(textures.heightmap_base64),
    ];
  }, [textures]);

  // Slow rotation
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius, 64, 64]} />
      <meshStandardMaterial
        map={albedoTex}
        normalMap={normalTex}
        displacementMap={heightTex}
        displacementScale={0.05}
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  );
}
