/**
 * PlanetSurfaceV2 — Next-gen planet renderer using the unified terrain pipeline.
 *
 * Features:
 *   - QuadSphere geometry (subdivided cube → sphere, no pole singularity)
 *   - PBR Cook-Torrance BRDF shader
 *   - 4 texture maps: albedo, heightmap, normal, PBR (roughness/metalness/AO/emissive)
 *   - Atmosphere scattering shell (separate transparent sphere)
 *   - Displacement mapping for terrain elevation
 *   - Ocean specular glint + lava night emission
 *   - Slow rotation animation
 *
 * Usage:
 *   <PlanetSurfaceV2
 *     textures={v2Result}
 *     sunDirection={[1, 0.3, 0.5]}
 *     starTeff={5778}
 *     starLuminosity={1.0}
 *     radius={1}
 *   />
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildQuadSphere } from '../lib/shared/geometry';
import {
  pbrVertexShader,
  pbrFragmentShader,
  atmosphereShellVertexShader,
  atmosphereShellFragmentShader,
} from '../lib/shared/shaders';

/* ── Types ──────────────────────────────────────────── */

export interface PlanetTexturesV2 {
  albedo_texture_b64: string;
  heightmap_texture_b64: string;
  normal_texture_b64: string;
  pbr_texture_b64: string;
  atmosphere_lut_b64: string;
  ocean_level: number;
  composition: {
    iron_fraction: number;
    silicate_fraction: number;
    volatile_fraction: number;
    h_he_fraction: number;
  };
  atmosphere: {
    surface_pressure_bar: number;
    scale_height_km: number;
    equilibrium_temp_k: number;
    surface_temp_k: number;
    dominant_gas: string;
    rayleigh_color: [number, number, number];
  };
  render_time_ms: number;
}

interface Props {
  textures: PlanetTexturesV2;
  sunDirection?: [number, number, number];
  starTeff?: number;
  starLuminosity?: number;
  radius?: number;
  rotationSpeed?: number;
  showAtmosphere?: boolean;
  resolution?: number; // QuadSphere segments per face (8, 16, 32, 64)
}

/* ── Helpers ────────────────────────────────────────── */

/**
 * Decode a base64 PNG into a Three.js texture using an offscreen canvas.
 * This is SYNCHRONOUS after the initial decode — the texture is immediately
 * valid for rendering (no async Image.onload race condition).
 */
function base64ToTexture(
  base64: string,
  invalidate: () => void,
): THREE.Texture {
  // Create a canvas that we'll draw the decoded image onto
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const img = new Image();
  const tex = new THREE.CanvasTexture(canvas);

  // All textures stay LINEAR — the PBR shader does its own sRGB decode
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    tex.needsUpdate = true;
    invalidate(); // trigger a new R3F frame
  };
  img.src = `data:image/png;base64,${base64}`;

  return tex;
}

/** Convert star Teff (K) to approximate RGB color. */
function teffToColor(teff: number): THREE.Color {
  // Simplified Planck curve → sRGB approximation
  const t = teff / 100.0;
  let r: number, g: number, b: number;

  // Red
  if (t <= 66) {
    r = 1.0;
  } else {
    r = 1.292936 * Math.pow(t - 60, -0.1332047592);
  }

  // Green
  if (t <= 66) {
    g = 0.39008157 * Math.log(t) - 0.63184144;
  } else {
    g = 1.129890 * Math.pow(t - 60, -0.0755148492);
  }

  // Blue
  if (t >= 66) {
    b = 1.0;
  } else if (t <= 19) {
    b = 0.0;
  } else {
    b = 0.54320680 * Math.log(t - 10) - 1.19625408;
  }

  return new THREE.Color(
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, b)),
  );
}

/* ── Component ──────────────────────────────────────── */

export function PlanetSurfaceV2({
  textures,
  sunDirection = [1, 0.3, 0.5],
  starTeff = 5778,
  starLuminosity = 1.0,
  radius = 1,
  rotationSpeed = 0.05,
  showAtmosphere = true,
  resolution = 32,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const surfaceRef = useRef<THREE.Mesh>(null);
  const atmosRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const atmosMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const { invalidate } = useThree();

  // ── Build QuadSphere geometry ──
  const geometry = useMemo(() => {
    // Map resolution hint to QuadSphere subdivisions (5 = 1024 tris/face, 6 = 4096)
    const subdivisions = resolution >= 64 ? 6 : 5;
    return buildQuadSphere({ subdivisions, radius });
  }, [resolution, radius]);

  // ── Decode textures (all LINEAR — PBR shader handles gamma) ──
  const { albedoTex, heightmapTex, normalTex, pbrTex } = useMemo(() => ({
    albedoTex: base64ToTexture(textures.albedo_texture_b64, invalidate),
    heightmapTex: base64ToTexture(textures.heightmap_texture_b64, invalidate),
    normalTex: base64ToTexture(textures.normal_texture_b64, invalidate),
    pbrTex: base64ToTexture(textures.pbr_texture_b64, invalidate),
  }), [textures, invalidate]);

  // ── Atmosphere properties ──
  const atmosphereColor = useMemo(() => {
    const rc = textures.atmosphere.rayleigh_color;
    return new THREE.Color(rc[0], rc[1], rc[2]);
  }, [textures.atmosphere.rayleigh_color]);

  const atmosphereThickness = useMemo(() => {
    // Map surface pressure to optical density (Earth = 1 bar → ~0.6)
    const p = textures.atmosphere.surface_pressure_bar;
    return Math.min(Math.sqrt(p / 1.0) * 0.6, 1.0);
  }, [textures.atmosphere.surface_pressure_bar]);

  const sunColor = useMemo(() => teffToColor(starTeff), [starTeff]);
  const sunDir = useMemo(
    () => new THREE.Vector3(...sunDirection).normalize(),
    [sunDirection],
  );

  // ── Surface PBR material ──
  const surfaceMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: pbrVertexShader,
      fragmentShader: pbrFragmentShader,
      uniforms: {
        uAlbedo: { value: albedoTex },
        uHeightmap: { value: heightmapTex },
        uNormalMap: { value: normalTex },
        uPbrMap: { value: pbrTex },
        uSunDirection: { value: sunDir },
        uSunColor: { value: sunColor },
        uSunIntensity: { value: starLuminosity },
        uOceanLevel: { value: textures.ocean_level },
        uAtmosphereColor: { value: atmosphereColor },
        uAtmosphereThickness: { value: atmosphereThickness },
        uPlanetRadius: { value: radius },
        uDisplacementScale: { value: radius * 0.02 }, // 2% of radius for terrain
        uTimeOfDay: { value: 0.0 },
      },
    });
  }, [albedoTex, heightmapTex, normalTex, pbrTex, sunDir, sunColor, starLuminosity, textures.ocean_level, atmosphereColor, atmosphereThickness, radius]);

  // ── Atmosphere shell material ──
  const atmosphereMaterial = useMemo(() => {
    if (!showAtmosphere || atmosphereThickness < 0.01) return null;

    return new THREE.ShaderMaterial({
      vertexShader: atmosphereShellVertexShader,
      fragmentShader: atmosphereShellFragmentShader,
      uniforms: {
        uSunDirection: { value: sunDir },
        uSunColor: { value: sunColor },
        uSunIntensity: { value: starLuminosity },
        uAtmosphereColor: { value: atmosphereColor },
        uAtmosphereThickness: { value: atmosphereThickness },
        uAtmosphereFalloff: { value: 3.0 },
      },
      transparent: true,
      side: THREE.BackSide, // render inner face for proper compositing
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, [showAtmosphere, atmosphereThickness, sunDir, sunColor, starLuminosity, atmosphereColor]);

  // Store refs for animation
  useEffect(() => {
    materialRef.current = surfaceMaterial;
    atmosMaterialRef.current = atmosphereMaterial;
  }, [surfaceMaterial, atmosphereMaterial]);

  // ── Rotation + time animation + force uniform sync ──
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * rotationSpeed;
    }
    // Force ShaderMaterial to pick up async texture updates
    if (materialRef.current) {
      materialRef.current.uniformsNeedUpdate = true;
    }
  });

  // Atmosphere shell scale (slightly larger than planet)
  const atmosScale = 1.0 + atmosphereThickness * 0.08;

  return (
    <group ref={groupRef}>
      {/* Planet surface */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <mesh ref={surfaceRef} geometry={geometry as any} material={surfaceMaterial} />

      {/* Atmosphere shell */}
      {atmosphereMaterial && (
        <mesh
          ref={atmosRef}
          material={atmosphereMaterial}
          scale={[atmosScale, atmosScale, atmosScale]}
        >
          <sphereGeometry args={[radius, 64, 48]} />
        </mesh>
      )}
    </group>
  );
}

export default PlanetSurfaceV2;
