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
import { deriveWorldVisuals, applyGasGenome, applyWorldGenome, NO_GENOME, deriveKBOType } from './derive';
import { getWorldConfig } from './worldtypes/definitions';
import type { WorldVisuals } from './types';
import { getBiomeAt, numZones, computeZoneCenters, computeZoneCentersEyeball, computeZoneRoles, nearestZone, zoneArchetype } from './zones';
import { IcebergField }  from './IcebergField';
import { VolcanoField }  from './VolcanoField';
import { AuroraField }   from './AuroraField';
import { CloudLayer }    from './CloudLayer';
import { RingSystem }    from './RingSystem';
import type { BiomeInfo } from './zones';

/* ── Gas type set (local copy for component use) ──────── */
const GAS_TYPES = new Set([
  'gas-giant', 'super-jupiter', 'hot-jupiter',
  'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune',
  // v2 cloud-regime gas giants
  'water-cloud-giant', 'nh4sh-cloud-giant', 'cloudless-hot-jupiter', 'night-cloud-giant',
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
  /** Whether this world has a ring system — enables ring-plane shadow (Feature 32) */
  hasRings?: boolean;
  /** Whether to draw province/zone border lines (default true) */
  showBorders?: boolean;
  /** Called when user clicks a region — provides biome info + world-space hit point */
  onBiomeClick?: (biome: BiomeInfo, hitPoint: THREE.Vector3) => void;
  /** Called after the first GPU frame — shader is compiled, safe to show the planet */
  onReady?: () => void;

  // ── v2: stellar environment ──────────────────────────────────
  /** Second star direction for circumbinary systems */
  sunDirection2?: [number, number, number];
  /** Primary sun brightness scale (default 1.0) */
  sunBrightness?: number;
  /** Second sun brightness (0 = no second sun) */
  sunBrightness2?: number;
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
  hasRings = false,
  showBorders = true,
  onBiomeClick,
  sunDirection2 = [0, 0, 0],
  sunBrightness = 1.0,
  sunBrightness2 = 0.0,
  onReady,
}: Props & { displacement?: number; segments?: number }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  // Track latest sunDirection prop for per-frame uniform updates
  const sunDirRef = useRef(sunDirection);
  sunDirRef.current = sunDirection;

  // ── #20 Auto-LOD — dynamic segment count from camera distance ──────────
  const [dynSegs, setDynSegs] = useState(segments);
  const dynSegsRef = useRef(segments);

  // Biome pick state — pick position in object space + animated strength
  const pickPosRef    = useRef(new THREE.Vector3(0, 1, 0));
  const pickActiveRef = useRef(false);
  const pickTimeRef   = useRef(0);

  const selectedZoneRef = useRef(-1);
  // Clear zone selection when world changes
  useEffect(() => { selectedZoneRef.current = -1; pickActiveRef.current = false; }, [planetType, seed]);

  const effectivePlanetType = planetType === 'ice-dwarf'
    ? deriveKBOType(seed, temperature)
    : planetType;
  const baseVis = V[effectivePlanetType] || V[planetType] || V['rocky'];
  const vis = deriveWorldVisuals(baseVis, { temperature, mass, tidalHeating, starSpectralClass });

  // ── v7: definitions.ts config — apply type defaults for missing vis values ──
  const typeCfg = getWorldConfig(effectivePlanetType);
  const d = typeCfg.defaults;
  if (d.craterDensity  !== undefined && (vis.craterDensity  ?? 0) === 0) vis.craterDensity  = d.craterDensity;
  if (d.cloudDensity   !== undefined && (vis.clouds         ?? 0) === 0) vis.clouds         = d.cloudDensity;
  // atmThickness: only override when the cfg type explicitly declares airless (=== 0).
  // Never boost from default — the profile's own value is authoritative for unknown types.
  if (d.atmThickness === 0) vis.atmThickness = 0;
  if (d.volcanism      !== undefined && (vis.volcanism      ?? 0) === 0) vis.volcanism      = d.volcanism;
  if (d.terrainAge     !== undefined &&  vis.terrainAge     === undefined) vis.terrainAge   = d.terrainAge;
  if (d.tectonicsLevel !== undefined &&  vis.tectonicsLevel === undefined) vis.tectonicsLevel = d.tectonicsLevel;
  if (d.mountainHeight !== undefined && (vis.mountainHeight ?? 0) === 0) vis.mountainHeight = d.mountainHeight;

  // ── World genome diversity — slot-machine combinatorial colors ──
  if (seed) {
    if (GAS_TYPES.has(effectivePlanetType)) {
      applyGasGenome(vis, seed);
    } else if (!NO_GENOME.has(effectivePlanetType)) {
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

  const isEyeball = planetType === 'eyeball-world' || tidallyLocked;

  // Voronoi zone centers — eyeball worlds use strategic clustering
  const zoneCenters = useMemo(() => {
    const n = numZones(mass, isGas);
    if (n === 0) return [];
    return isEyeball ? computeZoneCentersEyeball(seed, n) : computeZoneCenters(seed, n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, isGas, mass, isEyeball]);

  // Zone roles — semantic role per zone (polar, substellar, antistellar, terminator, default)
  const zoneRoles = useMemo(() => {
    return computeZoneRoles(
      zoneCenters, planetType, tidallyLocked, vis.iceCaps ?? 0, seed,
      vis.oceanLevel ?? 0, vis.volcanism ?? 0,
      temperature,
      vis.terrainAge ?? 0.5,
      vis.tectonicsLevel ?? 0.5,
      vis.craterDensity ?? 0.0,
      vis.atmThickness ?? 0.3,
      vis.mountainHeight ?? 0.0,
      sunDirection,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneCenters, planetType, tidallyLocked, vis.iceCaps, seed, temperature,
      sunDirection[0], sunDirection[1], sunDirection[2]]);

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

  // Extract storm data: backend data → profile storm → tidal vortex fallback
  // Note: uStormLat/uStormLon are used with sin()/cos() in the shader (radians).
  // tempDistribution.latitude_deg is passed as-is (near-zero values work for tidal vortex).
  // Profile storm values (stormLat/Lon) are already in radians, passed directly.
  const storm0 = tempDistribution?.storms?.[0] ??
    (vis.stormLat !== undefined && vis.stormSize !== undefined
      ? {
          // Profile storm values are in radians — pass directly as latitude_deg/longitude_deg
          // (the uniform name says "deg" but the shader uses sin/cos treating value as radians)
          latitude_deg:  vis.stormLat  ?? 0,
          longitude_deg: vis.stormLon  ?? 0,
          // stormSize is already sin(half-angle chord radius) — encode as diameter_deg such
          // that the standard conversion below reproduces it: sin(d/2 * π/180) = stormSize
          // → d = stormSize * 2 * 180/π  (approximate for small angles; fine for this purpose)
          diameter_deg:  (vis.stormSize ?? 0) * (2 * 180 / Math.PI),
          intensity:     vis.stormIntensity ?? 0.5,
        }
      : tidallyLocked && vis.atmThickness > 0.1
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
        uIceCapsV:   { value: vis.iceCaps },
        uIsIceWorldV:{ value: isIceWorld ? 1.0 : 0.0 },
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
        // diameter_deg → sphere chord radius: sin(deg/2 * π/180) ≈ deg * 0.00873
        uStormSize: { value: storm0 ? Math.sin((storm0.diameter_deg / 2) * Math.PI / 180) : 0.0 },
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
        // Auto-scale with mountainHeight + volcanism so dramatic worlds look dramatic.
        // Base displacement (prop default 0.055) + up to +0.22 from terrain features.
        uDisplacement: { value: isGas ? 0 : displacement + (vis.mountainHeight ?? 0) * 0.22 + (vis.volcanism ?? 0) * 0.14 },
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
        uBiomeCenters: { value: Array(64).fill(null).map(() => new THREE.Vector3()) },
        uZoneRoles: { value: new Float32Array(64) },
        uBiomeCount: { value: 0.0 },
        uSelectedZone: { value: -1.0 },
        uAxialTilt: { value: 0.0 },
        uHasRings:  { value: (hasRings || vis.hasRings) ? 1.0 : 0.0 },
        uRingInner: { value: vis.ringInner ?? 1.30 },
        uRingOuter: { value: vis.ringOuter ?? 2.25 },
        uShowBorders: { value: showBorders ? 1.0 : 0.0 },
        // iceCaps * 1.6 so even moderate polar worlds (0.25) get density 0.40+ (~14% cell activation).
        // Deep ocean worlds with iceCaps get a further +0.3 bonus since the whole surface is water.
        uIcebergDensity: { value: Math.min(1.0, (vis.iceCaps ?? 0) * 1.6
          + (isIceWorld ? 0.70 : 0.0)
          + (vis.oceanLevel > 0.80 && (vis.iceCaps ?? 0) > 0.10 ? 0.30 : 0.0)) },

        // ── v2 uniforms ──────────────────────────────────────────
        uStarColor: { value: new THREE.Vector3(
          ...(vis.starColor ?? [1.0, 1.0, 1.0]) as [number,number,number]) },
        uStarColor2: { value: new THREE.Vector3(
          ...(vis.starColor2 ?? [1.0, 1.0, 1.0]) as [number,number,number]) },
        // Default to primary sun direction so normalize is never called on vec3(0,0,0)
        uSunDir2: { value: new THREE.Vector3(
          sunDirection2[0] || sunDirection[0],
          sunDirection2[1] || sunDirection[1],
          sunDirection2[2] || sunDirection[2]).normalize() },
        uSunBrightness: { value: sunBrightness },
        uSunBrightness2: { value: sunBrightness2 },
        uRayleighColor: { value: new THREE.Vector3(
          ...(vis.rayleighColor ?? [0.28, 0.52, 1.0]) as [number,number,number]) },
        uHazeColor: { value: new THREE.Vector3(
          ...(vis.hazeColor ?? [0.55, 0.48, 0.32]) as [number,number,number]) },
        uHazeHeight: { value: vis.hazeHeight ?? 0.0 },
        uThermalGlow: { value: vis.thermalGlow ?? 0.0 },
        uMetallic: { value: vis.metallic ?? 0.0 },
        uCloudRegime: { value: vis.cloudRegime ?? 0.0 },
        uNightCloudFraction: { value: vis.nightCloudFraction ?? 0.0 },
        uResonanceHeat: { value: vis.resonanceHeat ?? 0.0 },
        uSubsurfaceOcean: { value: vis.subsurfaceOcean ?? 0.0 },
        uAuroraStrength: { value: vis.auroraStrength ?? 0.0 },
        uAuroraColor: { value: new THREE.Vector3(
          ...(vis.auroraColor ?? [0.0, 0.0, 0.0]) as [number,number,number]) },
        uPostMsAmbient: { value: new THREE.Vector3(
          ...(vis.postMsAmbient ?? [0.0, 0.0, 0.0]) as [number,number,number]) },
        uIsMoon: { value: vis.isMoon ?? 0.0 },
        // FIX 13: world mode for clean world-type gating in GLSL
        uWorldMode: { value: (() => {
          const t = planetType ?? '';
          if (['moon-cratered','moon-ice-shell','moon-volcanic'].some(s => t.includes(s))) return 4;
          if (['gas-giant','super-jupiter','neptune-like'].some(s => t.includes(s))) return 5;
          if (['lava','volcanic','hot-rock','usp'].some(s => t.includes(s))) return 2;
          if (['snowball','rogue','ice'].some(s => t.includes(s))) return 3;
          if (['earth','ocean','garden','chain','terra','tropical'].some(s => t.includes(s))) return 1;
          return 0; // default rocky
        })() },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed, cs[0], cs[1], cs[2], mass, tidalHeating, starSpectralClass,
      tidallyLocked, spinOrbit32, showTempMap, showMineralMap,
      sunBrightness, sunBrightness2]);

  // Atmosphere shell material (solid worlds only, not gas giants)
  // Fresnel rim glow with AdditiveBlending — adds light, never obscures planet.
  const atmMaterial = useMemo(() => {
    if (isGas) return null;
    if (!typeCfg.features.includes('atmosphere-rim')) return null;  // explicitly airless type
    if ((mass ?? 0) < 0.05) return null;                            // too low mass to retain atm
    if (vis.atmThickness < 0.08) return null;
    const psc = planetShineColor || [0, 0, 0];
    return new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor:        { value: new THREE.Color(vis.atmColor[0], vis.atmColor[1], vis.atmColor[2]) },
        uAtmThickness:    { value: vis.atmThickness },
        uSunDir:          { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
        uPlanetShineColor:{ value: new THREE.Vector3(psc[0], psc[1], psc[2]) },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed]);


  // ── Update showBorders toggle without recreating material ──────────
  useEffect(() => {
    if (material.uniforms.uShowBorders)
      material.uniforms.uShowBorders.value = showBorders ? 1.0 : 0.0;
  }, [material, showBorders]);

  // ── Update zone center + role uniforms whenever zones are recomputed ──
  useEffect(() => {
    const centers = material.uniforms.uBiomeCenters.value as THREE.Vector3[];
    const roles   = material.uniforms.uZoneRoles.value as Float32Array;
    for (let i = 0; i < 64; i++) {
      centers[i].copy(zoneCenters[i] ?? new THREE.Vector3(0, 1, 0));
      roles[i] = zoneRoles[i] ?? 0.0;
    }
    material.uniforms.uBiomeCount.value = zoneCenters.length;
    material.uniformsNeedUpdate = true;
  }, [material, zoneCenters, zoneRoles]);

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

  // Fire onReady after the first rendered frame (shader compiled, GPU settled)
  const readyFiredRef = useRef(false);
  useEffect(() => { readyFiredRef.current = false; }, [planetType, seed]);

  useFrame(({ camera }, delta) => {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      onReady?.();
    }
    const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
    if (groupRef.current) {
      // Tidally-locked planets don't self-rotate — the same face always points at the star.
      if (!tidallyLocked) {
        groupRef.current.rotation.y += delta * rotationSpeed * spd;
      }
      // ── #20 Auto-LOD ─────────────────────────────────────────────────────
      const dist = camera.position.distanceTo(groupRef.current.position);
      const lod = dist < 3.5 ? 192 : dist < 6 ? 128 : dist < 14 ? 96 : dist < 28 ? 64 : 48;
      if (lod !== dynSegsRef.current) {
        dynSegsRef.current = lod;
        setDynSegs(lod);
      }
    }
    material.uniforms.uTime.value += delta;
    // Update sun direction each frame so orrery planets light correctly
    const sd = sunDirRef.current;
    const sdVec = material.uniforms.uSunDir.value as THREE.Vector3;
    sdVec.set(sd[0], sd[1], sd[2]).normalize();
    // Second sun direction (circumbinary) — update each frame
    if (material.uniforms.uSunDir2) {
      (material.uniforms.uSunDir2.value as THREE.Vector3)
        .set(sunDirection2[0], sunDirection2[1], sunDirection2[2]).normalize();
    }
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
            // Feature 17: enrich biome with geological archetype for this zone
            const baseBiome = zoneBiomes[zIdx] ?? getBiomeAt([local.x, local.y, local.z], vis, seed, temperature, planetType);
            const archetype = zoneArchetype(zIdx, seed, zoneRoles[zIdx]);
            const enriched = { ...baseBiome, geology: archetype };
            onBiomeClick(enriched, e.point.clone());
          } else {
            selectedZoneRef.current = -1;
            onBiomeClick(getBiomeAt([local.x, local.y, local.z], vis, seed, temperature, planetType), e.point.clone());
          }
        } : undefined}
        onPointerEnter={onBiomeClick ? () => { document.body.style.cursor = 'crosshair'; } : undefined}
        onPointerLeave={onBiomeClick ? () => { document.body.style.cursor = ''; } : undefined}
      >
        <sphereGeometry args={[1, dynSegs, Math.round(dynSegs * 0.67)]} />
      </mesh>
      {(hasRings || vis.hasRings) && (
        <RingSystem
          inner={vis.ringInner ?? 1.30}
          outer={vis.ringOuter ?? 2.25}
          sunDir={sunDirection}
        />
      )}
      {!isGas && (vis.iceCaps ?? 0) >= 0.05 && (
        <IcebergField
          iceCaps={vis.iceCaps ?? 0}
          oceanLevel={vis.oceanLevel ?? 0}
          seed={seed}
          displacement={displacement + (vis.mountainHeight ?? 0) * 0.22 + (vis.volcanism ?? 0) * 0.14}
          zoneCenters={zoneCenters}
          zoneRoles={zoneRoles}
        />
      )}
      {!isGas && dynSegs >= 128 && typeCfg.features.includes('lava') && (vis.volcanism ?? 0) >= 0.08 && (
        <VolcanoField
          seed={seed}
          volcanism={vis.volcanism ?? 0}
          sphereRadius={1.0 + (displacement + (vis.mountainHeight ?? 0) * 0.22) * 0.08}
          mass={mass ?? 1}
          sunDirection={sunDirection}
          c1={c1}
          c2={c2}
        />
      )}
      {typeCfg.features.includes('aurora') && (vis.auroraStrength ?? 0) > 0.02 && (
        <AuroraField
          auroraStrength={vis.auroraStrength ?? 0}
          auroraColor={vis.auroraColor ?? [0.1, 0.9, 0.4]}
          sphereRadius={1.04 + vis.atmThickness * 0.06}
          sunDirection={sunDirection}
          axialTilt={axialTilt}
        />
      )}
      {!isGas && typeCfg.features.includes('clouds') && (vis.clouds ?? 0) > 0.10 && (vis.atmThickness ?? 0) >= 0.08 && (
        <CloudLayer
          cloudDensity={vis.clouds ?? 0}
          cloudRegime={vis.cloudRegime ?? 0}
          atmThickness={vis.atmThickness ?? 0}
          atmColor={vis.atmColor}
          sunDirection={sunDirection}
          noiseScale={vis.noiseScale}
          seed={seed}
        />
      )}
      {atmMaterial && (
        <mesh material={atmMaterial} renderOrder={2}>
          <sphereGeometry args={[1.04 + vis.atmThickness * 0.12 + (isIceWorld ? 0.020 : 0.0), 64, 48]} />
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
