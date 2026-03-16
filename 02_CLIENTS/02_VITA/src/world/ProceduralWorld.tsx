/**
 * ProceduralWorld — Noise-based world renderer that ALWAYS works.
 *
 * No texture dependency. Generates terrain, color, clouds, atmosphere,
 * and lighting entirely in GLSL shaders using 3D value noise / FBM.
 * This is the instant-on renderer that ensures worlds are NEVER dark.
 *
 * Two visual modes:
 *   Solid — noise terrain + color ramps + ocean + ice caps + atmosphere rim
 *   Gas   — latitude bands + turbulence + storms + deep atmosphere
 *
 * All world types have hand-tuned visual profiles.
 *
 * Canonical component — replaces src/components/ProceduralPlanet.tsx.
 * ProceduralPlanet.tsx is kept as a thin backwards-compat re-export.
 */

import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTextureTriplet, getZoneTextures, texUrl, GAS_TYPES as TEX_GAS_TYPES } from './textures';
import { VERT } from './shaders/vert';
import { WORLD_FRAG } from './shaders/solid.frag';
import { ATM_VERT, ATM_FRAG } from './shaders/atm';
import { V } from './profiles';
import { deriveWorldVisuals, applyGasGenome, applyWorldGenome, NO_GENOME } from './derive';
import type { WorldVisuals } from './types';
import { getBiomeAt, numZones, computeZoneCenters, nearestZone } from './zones';
import type { BiomeInfo } from './zones';

/* ── Gas type set (local copy for component use) ──────── */
const GAS_TYPES = new Set([
  'gas-giant', 'super-jupiter', 'hot-jupiter',
  'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune',
]);

/* ── Ice type set (local, reserved for future use) ─────── */
const _ICE_TYPES = new Set([
  'ice-dwarf', 'moon-ice-shell', 'moon-ocean', 'moon-nitrogen-ice',
  'moon-co2-frost', 'moon-ammonia-slush', 'moon-silicate-frost',
]);
void _ICE_TYPES;

/* ── Component interfaces ────────────────────────────── */

interface TempDistribution {
  substellar_k?: number;
  antistellar_k?: number;
  equator_k?: number;
  polar_k?: number;
  terminator_k?: number;
  heat_redistribution?: number;
  hot_longitude_k?: number;
  cold_longitude_k?: number;
  day_night_contrast?: number;
  pattern?: string;
  storms?: Array<{ latitude_deg: number; longitude_deg: number; diameter_deg: number; intensity: number; wind_speed_ms?: number }>;
}

interface MineralAbundance {
  iron_pct?: number;
  silicate_pct?: number;
  water_ice_pct?: number;
  kreep_index?: number;
  carbon_pct?: number;
  [key: string]: unknown;
}

interface Props {
  planetType: string;
  temperature?: number;
  seed?: number;
  sunDirection?: [number, number, number];
  rotationSpeed?: number;
  /** Per-instance color shifts [r,g,b] added to base profile colors (−0.3 to +0.3) */
  colorShift?: [number, number, number];
  /** Physical parameters for universal world derivation */
  mass?: number;
  tidalHeating?: number;
  /** Star spectral class (e.g. 'G2V', 'M4', 'K1') for foliage color derivation */
  starSpectralClass?: string;
  /** Tidal locking state */
  tidallyLocked?: boolean;
  spinOrbit32?: boolean;
  /** Science overlay toggles */
  showTempMap?: boolean;
  showMineralMap?: boolean;
  /** Temperature distribution data from backend */
  tempDistribution?: TempDistribution;
  /** Mineral abundance data from backend */
  mineralAbundance?: MineralAbundance;
  /** Planetshine — colored reflected light from nearby parent planet (rgb 0-1) */
  planetShineColor?: [number, number, number];
  /** Axial tilt in degrees (0 = upright, 23.5 = Earth-like, 90 = sideways).
   *  Shifts ice cap position off the geometric poles toward the actual rotational poles. */
  axialTilt?: number;
  /** Called when user clicks a region — provides biome info + world-space hit point */
  onBiomeClick?: (biome: BiomeInfo, hitPoint: THREE.Vector3) => void;
}

/* ── Component ───────────────────────────────────────── */

export function ProceduralWorld({
  planetType,
  temperature = 300,
  seed = 0,
  sunDirection = [1, 0.3, 0.5],
  rotationSpeed = 0.08,
  colorShift,
  mass,
  tidalHeating,
  starSpectralClass,
  displacement = 0.055,
  segments = 96,
  tidallyLocked = false,
  spinOrbit32 = false,
  showTempMap = false,
  showMineralMap = false,
  tempDistribution,
  mineralAbundance,
  planetShineColor,
  axialTilt = 0,
  onBiomeClick,
}: Props & { displacement?: number; segments?: number }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  // Track latest sunDirection prop for per-frame uniform updates
  const sunDirRef = useRef(sunDirection);
  sunDirRef.current = sunDirection;

  // Biome pick state — pick position in object space + animated strength
  const pickPosRef    = useRef(new THREE.Vector3(0, 1, 0));
  const pickActiveRef = useRef(false);
  const pickTimeRef   = useRef(0);

  const selectedZoneRef = useRef(-1);
  // Clear zone selection when world changes
  useEffect(() => { selectedZoneRef.current = -1; pickActiveRef.current = false; }, [planetType, seed]);

  const baseVis = V[planetType] || V['rocky'];
  const vis = deriveWorldVisuals(baseVis, { temperature, mass, tidalHeating, starSpectralClass });

  // ── World genome diversity — slot-machine combinatorial colors ──
  if (seed) {
    if (GAS_TYPES.has(planetType)) {
      applyGasGenome(vis, seed);
    } else if (!NO_GENOME.has(planetType)) {
      applyWorldGenome(vis, seed, temperature, mass ?? 1);
    }
  }

  // ── Seed-based ocean / terrain diversity ───────────────────────
  if (vis.oceanLevel > 0.1 && vis.oceanLevel < 0.95 && seed) {
    const variation = Math.sin(seed * 127.1 + 37.7) * 0.5 + 0.5; // 0-1
    vis.oceanLevel = Math.max(0.15, Math.min(0.93,
      vis.oceanLevel + (variation - 0.5) * 0.35));
  }
  if (vis.mountainHeight && vis.mountainHeight > 0.02 && seed) {
    const mtnVar = Math.sin(seed * 211.3 + 19.1) * 0.5 + 0.5;
    vis.mountainHeight *= 0.55 + mtnVar * 0.9;   // 0.55x – 1.45x range
  }
  if (vis.valleyDepth && vis.valleyDepth > 0.02 && seed) {
    const valVar = Math.sin(seed * 53.7 + 88.3) * 0.5 + 0.5;
    vis.valleyDepth *= 0.5 + valVar * 1.0;        // 0.5x – 1.5x range
  }

  const isGas = GAS_TYPES.has(planetType);
  const isIceWorld = !!(vis.isIce || temperature < 150);

  // Voronoi zone centers — computed once from seed/type (after isGas is known)
  const zoneCenters = useMemo(() => {
    const n = numZones(mass, isGas);
    return n > 0 ? computeZoneCenters(seed, n) : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, isGas, mass]);

  // Zone biome lookup (one biome per zone center, uses vis which depends on seed/type)
  const zoneBiomes = useMemo(() => {
    return zoneCenters.map(c => getBiomeAt([c.x, c.y, c.z], vis, seed, temperature, planetType));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneCenters]);

  const foliageColor = useMemo((): [number,number,number] => {
    if (isGas || vis.oceanLevel < 0.1 || vis.atmThickness < 0.15 || temperature < 180 || temperature > 400) {
      return [0, 0, 0]; // no vegetation possible
    }
    const s = (starSpectralClass || 'G')[0]?.toUpperCase() || 'G';
    switch (s) {
      case 'M': return [0.05, 0.01, 0.04] as [number,number,number]; // near-black burgundy
      case 'K': return [0.24, 0.28, 0.04] as [number,number,number]; // warm olive-brown
      case 'G': return [0.12, 0.48, 0.06] as [number,number,number]; // Earth green
      case 'F': return [0.42, 0.56, 0.10] as [number,number,number]; // chartreuse
      case 'A': return [0.54, 0.50, 0.14] as [number,number,number]; // golden-olive
      default:  return [0.12, 0.48, 0.06] as [number,number,number]; // Earth green
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vis.oceanLevel, vis.atmThickness, temperature, starSpectralClass]);

  // Per-instance color variation from geology
  const cs = colorShift || [0, 0, 0];
  const c1: [number,number,number] = [Math.min(1, Math.max(0, vis.color1[0] + cs[0])), Math.min(1, Math.max(0, vis.color1[1] + cs[1])), Math.min(1, Math.max(0, vis.color1[2] + cs[2]))];
  const c2: [number,number,number] = [Math.min(1, Math.max(0, vis.color2[0] + cs[0] * 0.7)), Math.min(1, Math.max(0, vis.color2[1] + cs[1] * 0.7)), Math.min(1, Math.max(0, vis.color2[2] + cs[2] * 0.7))];
  const c3: [number,number,number] = [Math.min(1, Math.max(0, vis.color3[0] + cs[0] * 0.4)), Math.min(1, Math.max(0, vis.color3[1] + cs[1] * 0.4)), Math.min(1, Math.max(0, vis.color3[2] + cs[2] * 0.4))];

  // Tweak emissive based on temperature for very hot planets
  const emissive = vis.emissive > 0 ? vis.emissive : (temperature > 1500 ? 0.5 : temperature > 800 ? 0.15 : 0);

  // Extract storm data for tidal vortex
  const storm0 = tempDistribution?.storms?.[0] ??
    (tidallyLocked && vis.atmThickness > 0.1
      ? { latitude_deg: 0, longitude_deg: 0, diameter_deg: 45, intensity: 0.75 }
      : undefined);

  // ── Texture-informed coloring: load reference textures ──────────
  const triplet = useMemo(() => {
    if (isGas || TEX_GAS_TYPES.has(planetType)) return null;
    return getTextureTriplet(planetType);
  }, [planetType, isGas]);

  const zoneTexSet = useMemo(() => {
    if (isGas || TEX_GAS_TYPES.has(planetType)) return null;
    return getZoneTextures(planetType);
  }, [planetType, isGas]);

  const placeholderTex = useMemo(() => {
    const t = new THREE.DataTexture(
      new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat
    );
    t.needsUpdate = true;
    return t;
  }, []);

  const [textures, setTextures] = useState<{
    low: THREE.Texture; mid: THREE.Texture; high: THREE.Texture;
  } | null>(null);
  const [zoneTextures, setZoneTextures] = useState<THREE.Texture[]>([]);

  useEffect(() => {
    if (!triplet) { setTextures(null); return; }
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    const loaded: Partial<{ low: THREE.Texture; mid: THREE.Texture; high: THREE.Texture }> = {};
    let count = 0;
    const onDone = () => {
      count++;
      if (count === 3 && !cancelled && loaded.low && loaded.mid && loaded.high) {
        setTextures(loaded as { low: THREE.Texture; mid: THREE.Texture; high: THREE.Texture });
      }
    };
    const loadOne = (id: string, key: 'low' | 'mid' | 'high') => {
      loader.load(
        texUrl(id),
        (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; loaded[key] = tex; onDone(); },
        undefined,
        () => { loaded[key] = placeholderTex; onDone(); }
      );
    };
    loadOne(triplet.texLow, 'low');
    loadOne(triplet.texMid, 'mid');
    loadOne(triplet.texHigh, 'high');
    return () => { cancelled = true; };
  }, [triplet, placeholderTex]);

  // Zone texture async loading — 5 textures in parallel
  useEffect(() => {
    if (!zoneTexSet) { setZoneTextures([]); return; }
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    const loaded: THREE.Texture[] = new Array(5).fill(placeholderTex);
    let count = 0;
    const onDone = () => {
      count++;
      if (count === 5 && !cancelled) setZoneTextures([...loaded]);
    };
    const ids = [zoneTexSet.z0, zoneTexSet.z1, zoneTexSet.z2, zoneTexSet.z3, zoneTexSet.z4];
    ids.forEach((id, i) => {
      loader.load(
        texUrl(id),
        (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; loaded[i] = tex; onDone(); },
        undefined,
        () => { loaded[i] = placeholderTex; onDone(); }
      );
    });
    return () => { cancelled = true; };
  }, [zoneTexSet, placeholderTex]);

  const texLow  = textures?.low  ?? placeholderTex;
  const texMid  = textures?.mid  ?? placeholderTex;
  const texHigh = textures?.high ?? placeholderTex;
  const texInfluence = triplet?.texInfluence ?? 0;
  const triplanarScale = triplet?.triplanarScale ?? 3.0;

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: WORLD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(c1[0], c1[1], c1[2]) },
        uColor2: { value: new THREE.Color(c2[0], c2[1], c2[2]) },
        uColor3: { value: new THREE.Color(c3[0], c3[1], c3[2]) },
        uOceanColor: { value: new THREE.Color(vis.oceanColor[0], vis.oceanColor[1], vis.oceanColor[2]) },
        uOceanLevel: { value: vis.oceanLevel },
        uAtmColor: { value: new THREE.Color(vis.atmColor[0], vis.atmColor[1], vis.atmColor[2]) },
        uAtmThickness: { value: vis.atmThickness },
        uEmissive: { value: emissive },
        uIceCaps: { value: vis.iceCaps },
        uCloudDensity: { value: vis.clouds },
        uNoiseScale: { value: vis.noiseScale },
        uSunDir: { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
        uIsGas: { value: isGas ? 1.0 : 0.0 },
        uTerrainAge: { value: vis.terrainAge ?? 0.5 },
        uTectonics: { value: vis.tectonicsLevel ?? 0.0 },
        uTerrainAgeV: { value: vis.terrainAge ?? 0.5 },
        uTectonicsV: { value: vis.tectonicsLevel ?? 0.0 },
        uSeed: { value: seed * 137.0 },
        uCraterDensity: { value: vis.craterDensity ?? 0 },
        uCrackIntensity: { value: vis.crackIntensity ?? 0 },
        uMountainHeight: { value: vis.mountainHeight ?? 0 },
        uValleyDepth: { value: vis.valleyDepth ?? 0 },
        uVolcanism: { value: vis.volcanism ?? 0 },
        uIsIceWorld: { value: isIceWorld ? 1.0 : 0.0 },
        uFoliageColor: { value: new THREE.Vector3(foliageColor[0], foliageColor[1], foliageColor[2]) },
        // Tidal lock + temperature + mineral overlays
        uTidallyLocked: { value: tidallyLocked ? 1.0 : 0.0 },
        uSpinOrbit32: { value: spinOrbit32 ? 1.0 : 0.0 },
        uShowTempMap: { value: showTempMap ? 1.0 : 0.0 },
        uSubstellarTemp: { value: tempDistribution?.substellar_k ?? temperature },
        uAntistellarTemp: { value: tempDistribution?.antistellar_k ?? Math.max(40, temperature * 0.25) },
        uEquatorTemp: { value: tempDistribution?.equator_k ?? temperature },
        uPolarTemp: { value: tempDistribution?.polar_k ?? Math.max(40, temperature * 0.7) },
        uHeatRedist: { value: tempDistribution?.heat_redistribution ?? 0.3 },
        uStormLat: { value: storm0?.latitude_deg ?? 0.0 },
        uStormLon: { value: storm0?.longitude_deg ?? 0.0 },
        uStormSize: { value: storm0?.diameter_deg ?? 0.0 },
        uStormIntensity: { value: storm0?.intensity ?? 0.0 },
        uShowMineralMap: { value: showMineralMap ? 1.0 : 0.0 },
        uIronPct: { value: mineralAbundance?.iron_pct ?? 0.0 },
        uSilicatePct: { value: mineralAbundance?.silicate_pct ?? 0.0 },
        uWaterIcePct: { value: mineralAbundance?.water_ice_pct ?? 0.0 },
        uKreepIndex: { value: mineralAbundance?.kreep_index ?? 0.0 },
        uCarbonPct: { value: mineralAbundance?.carbon_pct ?? 0.0 },
        uPlanetShineColor: { value: new THREE.Vector3(
          planetShineColor?.[0] ?? 0, planetShineColor?.[1] ?? 0, planetShineColor?.[2] ?? 0
        ) },
        // Vertex shader displacement uniforms
        uDisplacement: { value: isGas ? 0 : displacement },
        uSeedV: { value: seed * 137.0 },
        uNoiseScaleV: { value: vis.noiseScale },
        uIsGasV: { value: isGas ? 1.0 : 0.0 },
        uOceanLevelV: { value: vis.oceanLevel },
        uCraterDensityV: { value: vis.craterDensity ?? 0 },
        uMountainHeightV: { value: vis.mountainHeight ?? 0 },
        uValleyDepthV: { value: vis.valleyDepth ?? 0 },
        uVolcanismV: { value: vis.volcanism ?? 0 },
        // Texture-informed coloring uniforms
        uTexLow: { value: texLow },
        uTexMid: { value: texMid },
        uTexHigh: { value: texHigh },
        uTexInfluence: { value: texInfluence },
        uTriplanarScale: { value: triplanarScale },
        uZoneTex0: { value: placeholderTex },
        uZoneTex1: { value: placeholderTex },
        uZoneTex2: { value: placeholderTex },
        uZoneTex3: { value: placeholderTex },
        uZoneTex4: { value: placeholderTex },
        uZoneTexScale: { value: 3.0 },
        uPickPos: { value: new THREE.Vector3(0, 1, 0) },
        uPickStrength: { value: 0.0 },
        uBiomeCenters: { value: Array(32).fill(null).map(() => new THREE.Vector3()) },
        uBiomeCount: { value: 0.0 },
        uSelectedZone: { value: -1.0 },
        uAxialTilt: { value: 0.0 },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed, cs[0], cs[1], cs[2], mass, tidalHeating, starSpectralClass,
      tidallyLocked, spinOrbit32, showTempMap, showMineralMap]);

  // Atmosphere shell material (solid worlds only, not gas giants)
  const atmMaterial = useMemo(() => {
    if (vis.atmThickness < 0.08 || isGas) return null;
    const psc = planetShineColor || [0, 0, 0];
    return new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor: { value: new THREE.Color(vis.atmColor[0], vis.atmColor[1], vis.atmColor[2]) },
        uAtmThickness: { value: vis.atmThickness },
        uSunDir: { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
        uPlanetShineColor: { value: new THREE.Vector3(psc[0], psc[1], psc[2]) },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed]);

  // ── Update zone center uniforms whenever zone centers are recomputed ──
  useEffect(() => {
    const centers = material.uniforms.uBiomeCenters.value as THREE.Vector3[];
    for (let i = 0; i < 32; i++) {
      centers[i].copy(zoneCenters[i] ?? new THREE.Vector3(0, 1, 0));
    }
    material.uniforms.uBiomeCount.value = zoneCenters.length;
    material.uniformsNeedUpdate = true;
  }, [material, zoneCenters]);

  // ── Update texture uniforms when async textures arrive ──────
  useEffect(() => {
    if (material.uniforms.uTexLow) {
      material.uniforms.uTexLow.value = texLow;
      material.uniforms.uTexMid.value = texMid;
      material.uniforms.uTexHigh.value = texHigh;
      material.uniforms.uTexInfluence.value = texInfluence;
      material.uniforms.uTriplanarScale.value = triplanarScale;
      material.uniformsNeedUpdate = true;
    }
  }, [material, texLow, texMid, texHigh, texInfluence, triplanarScale]);

  useEffect(() => {
    if (!material.uniforms.uZoneTex0) return;
    const ph = placeholderTex;
    material.uniforms.uZoneTex0.value = zoneTextures[0] ?? ph;
    material.uniforms.uZoneTex1.value = zoneTextures[1] ?? ph;
    material.uniforms.uZoneTex2.value = zoneTextures[2] ?? ph;
    material.uniforms.uZoneTex3.value = zoneTextures[3] ?? ph;
    material.uniforms.uZoneTex4.value = zoneTextures[4] ?? ph;
    material.uniforms.uZoneTexScale.value = zoneTexSet?.scale ?? 3.0;
    material.uniformsNeedUpdate = true;
  }, [material, zoneTextures, zoneTexSet, placeholderTex]);

  useFrame((_, delta) => {
    const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * rotationSpeed * spd;
    }
    material.uniforms.uTime.value += delta;
    // Update sun direction each frame so orrery planets light correctly
    const sd = sunDirRef.current;
    const sdVec = material.uniforms.uSunDir.value as THREE.Vector3;
    sdVec.set(sd[0], sd[1], sd[2]).normalize();
    // Animate biome pick ring
    if (pickActiveRef.current) {
      pickTimeRef.current += delta;
      const str = 0.55 + Math.sin(pickTimeRef.current * 4.0) * 0.45;
      material.uniforms.uPickStrength.value = str;
      (material.uniforms.uPickPos.value as THREE.Vector3).copy(pickPosRef.current);
    } else {
      material.uniforms.uPickStrength.value = Math.max(0, material.uniforms.uPickStrength.value - delta * 2.0);
    }
    material.uniforms.uSelectedZone.value = selectedZoneRef.current;
    material.uniforms.uAxialTilt.value = axialTilt * Math.PI / 180;
    material.uniformsNeedUpdate = true;
    // Also update atmosphere shell sun direction
    if (atmMaterial) {
      const atmSd = atmMaterial.uniforms.uSunDir.value as THREE.Vector3;
      atmSd.set(sd[0], sd[1], sd[2]).normalize();
      atmMaterial.uniformsNeedUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        material={material}
        onClick={onBiomeClick ? (e) => {
          e.stopPropagation();
          const local = meshRef.current.worldToLocal(e.point.clone());
          local.normalize();
          pickPosRef.current.copy(local);
          pickActiveRef.current = true;
          pickTimeRef.current = 0;
          // Find which voronoi zone was clicked
          if (zoneCenters.length > 0) {
            const zIdx = nearestZone(local, zoneCenters);
            selectedZoneRef.current = zIdx;
            onBiomeClick(zoneBiomes[zIdx] ?? getBiomeAt([local.x, local.y, local.z], vis, seed, temperature, planetType), e.point.clone());
          } else {
            selectedZoneRef.current = -1;
            onBiomeClick(getBiomeAt([local.x, local.y, local.z], vis, seed, temperature, planetType), e.point.clone());
          }
        } : undefined}
        onPointerEnter={onBiomeClick ? () => { document.body.style.cursor = 'crosshair'; } : undefined}
        onPointerLeave={onBiomeClick ? () => { document.body.style.cursor = ''; } : undefined}
      >
        <sphereGeometry args={[1, segments, Math.round(segments * 0.67)]} />
      </mesh>
      {atmMaterial && (
        <mesh material={atmMaterial}>
          <sphereGeometry args={[1.02 + vis.atmThickness * 0.06, 64, 48]} />
        </mesh>
      )}
    </group>
  );
}

export default ProceduralWorld;

// Re-export types and data needed by other components
export type { BiomeInfo, WorldVisuals };
export { getBiomeAt, BIOME_DATA } from './zones';
export { V } from './profiles';
export { deriveWorldVisuals } from './derive';
