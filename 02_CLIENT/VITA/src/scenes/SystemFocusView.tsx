/**
 * SystemFocusView V5 — Spatial depth-drill system explorer
 *
 * Philosophy: ONE full-screen 3D canvas IS the navigation.
 * No redundant sidebar or strip. Click bodies to drill deeper.
 * Fractal zoom: Star system → Planet system → Moon close-up.
 *
 * Depth levels:
 *   system  — Star at center, planets orbit, belts, habitable zone
 *   planet  — Planet fills center (ProceduralPlanet), moons orbit it
 *   moon    — Moon fills center, parent planet backdrop, habitats orbit
 *   belt    — Kirkwood scatter chart (2D Canvas)
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ← Map  ★ Sol  [G2V] [solar-analog]  4.3 ly  8 planets     │
 *   ├─────────────────────────────────────────────────────┬────────┤
 *   │                                                     │ ☀ Sol  │
 *   │  ☀ Sol › ♃ Jupiter › 🌑 Europa   ← breadcrumb      │ 5778 K │
 *   │                                                     │ G-type │
 *   │       FULL-SCREEN 3D ORRERY                         │────────│
 *   │     (depth-sensitive, click to navigate)             │ Planets│
 *   │                                                     │ ● Merc │
 *   │  system: star+planets+belts+HZ                      │ ● Venus│
 *   │  planet: globe+moons+rings+habitats                 │ ● Earth│
 *   │  moon:   globe+habitats+parent backdrop             │────────│
 *   │                                                     │ Belts  │
 *   │     [🔲 habitat cylinders in orbit]                  │ 🪨 Ast │
 *   │                                                     │ 🧊 Kui │
 *   └─────────────────────────────────────────────────────┴────────┘
 */

import React, { useEffect, useState, useRef, Suspense, useMemo, useCallback } from 'react';
import { View, PerspectiveCamera } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { buildManifest }          from '../world/systemManifest';
import { useActivePlanetPreload }  from '../hooks/useActivePlanetPreload';
// Bloom removed — multi-pass FBO causes flickering on Tauri wgpu/Vulkan
import * as THREE from 'three';
import type { PlanetTexturesV2 } from '../hooks/useTauriGPU';
import { useScience } from '../hooks/useScience';
import { useCampaign } from '../hooks/useCampaign';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { V as PlanetProfiles, deriveWorldVisuals, ProceduralPlanet, zoneArchetype } from '../components/ProceduralPlanet';
// TexturedPlanet replaced by ProceduralPlanet with texture-informed coloring
import type { TerrainParams } from '../panels/ColonyTerrain';
// hygStarCatalog used in OrreryComponents (Starfield component)
import { getCachedSystems } from '../hooks/useSystemsList';
import { verifiedFetch } from '../utils/verifiedFetch';
import { PlanetSurfaceV2 } from '../components/PlanetSurfaceV2';
import { PlanetEditorPanel } from '../components/PlanetEditorPanel';
import { CompositionPanel } from '../components/CompositionPanel';
import { AtmospherePanel } from '../components/AtmospherePanel';
import { InteriorPanel } from '../components/InteriorPanel';
import { ClimatePanel } from '../components/ClimatePanel';
import { AtmosphereV2Panel } from '../components/AtmosphereV2Panel';
import { ModelManifestPanel } from '../components/ModelManifestPanel';
import { ColonyOverlay } from '../panels/ColonyOverlay';
import type { ColonyBuilding, BuildingType } from '../panels/ColonyOverlay';
import type { Ship } from '../panels/ColonyTerrain';
import type { BiomeInfo } from '../components/ProceduralPlanet';

/** ms to wait after systemData arrives before signalling ready.
 *  Enough for orrery geometry to build + GPU to stabilise at system depth.
 *  At system depth there are zero ProceduralWorld instances, so no shader stall. */
// SCENE_READY_DELAY_MS removed — ready is now gated on shaderWarmed (GPU warmup)

import { VERT }       from '../world/shaders/vert';
import { WORLD_FRAG } from '../world/shaders/solid.frag';
import type { Props, ViewState, ScienceTab } from '../world/OrreryComponents';
import {
  _orbit,
  OrbitClock,
  OrreryBody,
  OrreryStar,
  MoonOrbitLine,
  KuiperDustGlow,
  BeltGapRings,
  OrbitingMoon,
  CapturedMiniMoonSwarm,
  layoutMoonOrbits,
  detectResonance,
  moonSeed,
  moonColorShift,
  logOrbitRadius,
  starLifecycle,
  surfaceG,
  formatPeriod,
  shortName,
  hashStr,
  vizPeriod,
  pickMoonProfile,
  pickPotatoColors,
  planetShineFromType,
  STAR_COLOR,
  PT_COLOR,
  MOON_COLOR,
  MOON_TEMP,
  MOON_ICON,
  FLAG_ICON,
  FLAG_COLOR,
  SPEC_COLOR,
  BELT_TYPE_LABEL,
  MOON_DESC,
  STAR_VIS_R,
  starVisRadius,
  SmoothCamera,
  Starfield,
  HabitableZone,
  TemperatureZone,
  RadiationZone,
  FrostLine,
  CompanionStar,
  CompanionLight,
  BeltParticles,
  BeltAsteroids,
  NamedBeltBodies,
  RotatingSurfaceGroup,
  LODPlanet,
  RingParticles,
  HabitatOrbitRing,
  HabitatStation,
  AsteroidCloseupGroup,
  BeltFamilyChart,
  DepthBreadcrumb,
  BiomeInfoPanel,
  PotatoMoon,
} from '../world/OrreryComponents';



/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SHADER PRE-COMPILER
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Uses gl.compileAsync() + WEBGL_parallel_shader_compile (Chrome/D3D11)
   to pre-compile WORLD_FRAG off the hot path.

   Why this works:
   - gl.compileAsync() is non-blocking on Chrome/ANGLE/D3D11 (uses the
     WEBGL_parallel_shader_compile extension). The 3305-line shader
     compiles on the driver thread while the JS thread keeps running.
     No D3D11 TDR possible because the GPU command never blocks the OS.
   - Runs even when View visible=false (useEffect fires at React mount
     time, independent of scissor rendering).
   - Keeps a ref to the ShaderMaterial so Three.js never evicts it from
     the program cache — subsequent ProceduralPlanet renders get a cache
     hit and compile instantly.
*/
function ShaderWarmup({ systemId, onReady, onDetail }: {
  systemId: string;
  onReady: () => void;
  onDetail?: (d: string) => void;
}) {
  const { gl } = useThree();
  // Keep the material alive so Three.js program cache retains the compiled program.
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  // Track whether we've already compiled for this systemId.
  const compiledRef = useRef<string | null>(null);

  useEffect(() => {
    // If we already compiled (cache hit for this or any systemId), signal immediately.
    if (compiledRef.current !== null) {
      console.log(`[Load] ${systemId} | WORLD_FRAG cache hit — instant ready`);
      onDetail?.('SHADER CACHE HIT');
      onReady();
      return;
    }

    const ctx = gl.getContext() as WebGL2RenderingContext;
    const gpuRenderer = ctx.getParameter(ctx.RENDERER) as string;
    const gpuVendor   = ctx.getParameter(ctx.VENDOR)   as string;
    const webglVer    = ctx.getParameter(ctx.VERSION)   as string;
    const hasParallel = !!ctx.getExtension('WEBGL_parallel_shader_compile');

    console.group(`[Load] ${systemId} | shader warmup`);
    console.log(`  GPU      : ${gpuRenderer}`);
    console.log(`  Vendor   : ${gpuVendor}`);
    console.log(`  WebGL    : ${webglVer}`);
    console.log(`  parallel : ${hasParallel ? 'WEBGL_parallel_shader_compile ✓' : 'NOT available — sync compile'}`);
    console.log(`  shader   : WORLD_FRAG (${WORLD_FRAG.length.toLocaleString()} chars)`);
    console.groupEnd();

    onDetail?.(hasParallel ? 'COMPILING SHADERS  (parallel)' : 'COMPILING SHADERS  (sync)');

    const t0 = performance.now();

    // Periodic "still compiling" heartbeat every 5s
    const interval = setInterval(() => {
      const s = ((performance.now() - t0) / 1000).toFixed(0);
      console.log(`[Load] ${systemId} | shader compiling… ${s}s elapsed`);
      onDetail?.(`COMPILING SHADERS  ${s}s`);
    }, 5_000);

    if (!matRef.current) {
      matRef.current = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: WORLD_FRAG,
      });
    }
    const dummy = new THREE.Scene();
    const mesh  = new THREE.Mesh(new THREE.SphereGeometry(0.001, 3, 2), matRef.current);
    dummy.add(mesh);

    gl.compileAsync(dummy, new THREE.PerspectiveCamera()).then(() => {
      clearInterval(interval);
      const ms = (performance.now() - t0).toFixed(0);
      console.log(`[Load] ${systemId} | WORLD_FRAG compiled in ${ms}ms ✓`);
      onDetail?.(`SHADER COMPILED  ${ms}ms`);
      dummy.remove(mesh);
      mesh.geometry.dispose();
      compiledRef.current = systemId;
      onReady();
    }).catch((e: unknown) => {
      clearInterval(interval);
      const ms = (performance.now() - t0).toFixed(0);
      console.warn(`[Load] ${systemId} | compileAsync failed after ${ms}ms:`, e);
      onDetail?.(`SHADER ERROR — ${ms}ms`);
      dummy.remove(mesh);
      mesh.geometry.dispose();
      compiledRef.current = systemId;
      onReady();
    });

    return () => clearInterval(interval);
  }, [systemId]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN COMPONENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function SystemFocusView({ systemId, gpu, onBack, onLoadStage, onSubProgress, onLoadDetail, active = true }: Props) {
  const [systemData, setSystemData] = useState<any>(null);
  const [view, setView] = useState<ViewState>({ depth: 'system', planetIdx: 0 });
  const [texturesV2, setTexturesV2] = useState<PlanetTexturesV2 | null>(null);
  const [texStatus, setTexStatus] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [usePBR, setUsePBR] = useState(false);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ScienceTab>('editor');
  const [regenCounter, setRegenCounter] = useState(0);
  // True once WORLD_FRAG has been pre-compiled via gl.compileAsync().
  // 'ready' is NOT signalled until this fires — prevents cold TDR on first planet render.
  // ShaderWarmup (below) sets this via onReady callback when compileAsync resolves.
  const [shaderWarmed, setShaderWarmed] = useState(false);
  const [orbitSpeed, setOrbitSpeed] = useState(1.0);
  const [showTemp, setShowTemp] = useState(false);
  const [showRad, setShowRad] = useState(false);
  const [orreryScale, setOrreryScale] = useState(0.65);
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [showPlanetTempMap, setShowPlanetTempMap] = useState(false);
  const [showPlanetMineralMap, setShowPlanetMineralMap] = useState(false);
  const [showPlanetBorders, setShowPlanetBorders] = useState(true);
  // Ref for auto-scrolling sidebar to selected planet
  const activeRowRef = useRef<HTMLDivElement>(null);
  // Collapsible sidebar sections
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    planets: true, belts: true,
  });
  /* ── Colony builder state ── */
  // Per-world building storage: keyed by "p{planetIdx}" or "p{planetIdx}-m{moonIdx}"
  const [colonyBuildingsMap, setColonyBuildingsMap] = useState<Record<string, ColonyBuilding[]>>({});
  const [buildMode, setBuildMode] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [showRoads, setShowRoads] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [selectedBuildingType, setSelectedBuildingType] = useState<BuildingType>('dome');
  const [customModelUrl, setCustomModelUrl] = useState<string | null>(null);
  const [customModelName, setCustomModelName] = useState<string>('Custom');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colonyIdCounter = useRef(0);
  /* ── Biome selection ── */
  const [selectedBiome, setSelectedBiome] = useState<BiomeInfo | null>(null);

  /* ── Asset manifest & texture preload ── */
  const manifest = useMemo(
    () => systemData ? buildManifest(systemId, systemData) : null,
    [systemId, systemData],
  );

  // Whole-system preload: fires once when manifest first arrives (during/just after loading screen).
  // Seeds the browser HTTP cache with every texture in the system so navigation between
  // planets doesn't stall on first visit. Uses low-priority Image() loads so they don't
  // compete with the scene render that's starting up simultaneously.
  useEffect(() => {
    if (!manifest) return;
    const urls = manifest.allTextureUrls;
    if (urls.length === 0) return;
    let cancelled = false;
    // Stagger: yield every 4 images so we don't flood the network at once
    let i = 0;
    const next = () => {
      if (cancelled) return;
      const batch = urls.slice(i, i + 4);
      for (const url of batch) {
        const img = new Image();
        img.src = url;
      }
      i += 4;
      if (i < urls.length) requestIdleCallback ? requestIdleCallback(next) : setTimeout(next, 50);
    };
    next();
    return () => { cancelled = true; };
  }, [manifest]);

  useActivePlanetPreload(manifest, view.planetIdx);

  /* ── Ship state ── */
  const [shipsMap, setShipsMap] = useState<Record<string, Ship[]>>({});
  const [shipMode, setShipMode] = useState(false);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const shipIdCounter = useRef(0);

  const science = useScience();
  const campaign = useCampaign();

  // Current world key for building storage
  const worldKey = useMemo(() => {
    if (view.depth === 'moon' && view.moonIdx != null)
      return `p${view.planetIdx}-m${view.moonIdx}`;
    return `p${view.planetIdx}`;
  }, [view.depth, view.planetIdx, view.moonIdx]);

  // Current world's buildings (derived from map)
  const colonyBuildings = colonyBuildingsMap[worldKey] || [];

  /* ── Colony handlers ── */
  const handleColonyPlace = useCallback((lat: number, lon: number) => {
    colonyIdCounter.current += 1;
    const newBuilding: ColonyBuilding = {
      id: `b-${colonyIdCounter.current}`,
      lat, lon,
      type: selectedBuildingType,
      ...(selectedBuildingType === 'custom' && customModelUrl ? {
        modelUrl: customModelUrl,
        modelName: customModelName,
        customScale: 1.0,
      } : {}),
    };
    setColonyBuildingsMap(prev => ({
      ...prev,
      [worldKey]: [...(prev[worldKey] || []), newBuilding],
    }));
  }, [selectedBuildingType, customModelUrl, customModelName, worldKey]);

  const handleColonyRemove = useCallback((id: string) => {
    setColonyBuildingsMap(prev => ({
      ...prev,
      [worldKey]: (prev[worldKey] || []).filter(b => b.id !== id),
    }));
  }, [worldKey]);

  const handleGLBImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCustomModelUrl(url);
    setCustomModelName(file.name.replace(/\.(glb|gltf)$/i, ''));
    setSelectedBuildingType('custom');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Current world's ships
  const ships = shipsMap[worldKey] || [];

  // Ship placement handler
  const handleShipPlace = useCallback((lat: number, lon: number) => {
    shipIdCounter.current += 1;
    const newShip: Ship = {
      id: `ship-${shipIdCounter.current}`,
      lat, lon,
      progress: 0,
      speed: 2.0,
      name: `Ship ${shipIdCounter.current}`,
    };
    setShipsMap(prev => ({
      ...prev,
      [worldKey]: [...(prev[worldKey] || []), newShip],
    }));
  }, [worldKey]);

  // Ship command handler — sets movement destination
  const handleShipCommand = useCallback((shipId: string, toLat: number, toLon: number) => {
    setShipsMap(prev => {
      const worldShips = prev[worldKey] || [];
      return {
        ...prev,
        [worldKey]: worldShips.map(s =>
          s.id === shipId
            ? { ...s, targetLat: toLat, targetLon: toLon, progress: 0 }
            : s
        ),
      };
    });
  }, [worldKey]);

  // Ship select handler
  const handleShipSelect = useCallback((shipId: string) => {
    setSelectedShipId(prev => prev === shipId ? null : shipId);
  }, []);

  // Ship movement tick — advance all moving ships toward their destination
  useEffect(() => {
    const interval = setInterval(() => {
      setShipsMap(prev => {
        const worldShips = prev[worldKey];
        if (!worldShips || worldShips.length === 0) return prev;
        let changed = false;
        const updated = worldShips.map(s => {
          if (s.targetLat == null || s.targetLon == null) return s;
          const dLat = s.targetLat - s.lat;
          const dLon = s.targetLon - s.lon;
          const totalDist = Math.sqrt(dLat * dLat + dLon * dLon) || 0.001;
          const step = (s.speed * 0.05) / totalDist;
          const newProgress = Math.min(s.progress + step, 1.0);
          changed = true;
          if (newProgress >= 1.0) {
            return { ...s, lat: s.targetLat, lon: s.targetLon,
                     targetLat: undefined, targetLon: undefined, progress: 0 };
          }
          return { ...s,
            lat: s.lat + dLat * step,
            lon: s.lon + dLon * step,
            progress: newProgress,
          };
        });
        if (!changed) return prev;
        return { ...prev, [worldKey]: updated };
      });
    }, 50);
    return () => clearInterval(interval);
  }, [worldKey]);

  // Exit build/ship mode when leaving colonizable depth
  useEffect(() => {
    if (view.depth !== 'planet' && view.depth !== 'moon') {
      setBuildMode(false);
      setShipMode(false);
      setSelectedShipId(null);
    }
  }, [view.depth]);

  /* ── Fetch system data ──
   * Priority: live API → bundled static data → Tauri cache */
  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    const t0 = performance.now();
    const ts = () => `+${(performance.now() - t0).toFixed(0)}ms`;

    console.log(`[Load] ${systemId} | fetch start`);
    onLoadStage?.('connecting');
    onLoadDetail?.('CONNECTING TO GATEWAY');

    (async () => {
      await new Promise(r => setTimeout(r, 80));
      if (signal.aborted) return;

      onLoadStage?.('data');
      onLoadDetail?.('FETCHING STELLAR DATA');
      console.log(`[Load] ${systemId} | stage→data (${ts()})`);

      // 1. Try live API
      try {
        onSubProgress?.(0.1);
        const apiCtrl = new AbortController();
        const apiTimeout = setTimeout(() => {
          console.warn(`[Load] ${systemId} | API timeout after 6000ms — falling back`);
          onLoadDetail?.('API TIMEOUT — trying static data');
          apiCtrl.abort();
        }, 6000);
        signal.addEventListener('abort', () => apiCtrl.abort(), { once: true });
        console.log(`[Load] ${systemId} | API fetch start → /api/system/${systemId}`);
        try {
          const r = await verifiedFetch(`/api/system/${encodeURIComponent(systemId)}`, { signal: apiCtrl.signal });
          clearTimeout(apiTimeout);
          console.log(`[Load] ${systemId} | API response ${r.status} (${ts()})`);
          if (r.ok) {
            onSubProgress?.(0.6);
            const d = await r.json();
            if (!signal.aborted && d?.star) {
              const npl = d.planets?.length ?? 0;
              console.info(`[Load] ${systemId} | ✓ API — ${npl} planets (${ts()})`);
              onLoadDetail?.(`API OK — ${npl} planet${npl !== 1 ? 's' : ''}`);
              onSubProgress?.(1.0);
              onLoadStage?.('scene');
              setSystemData(d);
              return;
            } else {
              console.warn(`[Load] ${systemId} | API ok but no star data in response`, d);
              onLoadDetail?.('API: no star data — trying static');
            }
          }
        } catch (eInner: any) {
          clearTimeout(apiTimeout);
          throw eInner;
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          console.warn(`[Load] ${systemId} | API aborted (${ts()})`);
        } else {
          console.warn(`[Load] ${systemId} | API error (${ts()}):`, e?.message ?? e);
          onLoadDetail?.('API error — trying static data');
        }
      }

      // 2. Try static detail data (public/data/systemDetails.json)
      console.log(`[Load] ${systemId} | trying /data/systemDetails.json (${ts()})`);
      onLoadDetail?.('LOADING STATIC DATA');
      try {
        onSubProgress?.(0.2);
        const r2 = await verifiedFetch('/data/systemDetails.json', { signal });
        console.log(`[Load] ${systemId} | systemDetails.json response ${r2.status} (${ts()})`);
        if (r2.ok) {
          onSubProgress?.(0.7);
          const allDetails = await r2.json();
          const detail = allDetails[systemId];
          if (!signal.aborted && detail) {
            const planets = detail.planets ?? [];
            const belts = detail.belts ?? [];
            const starMeta = getCachedSystems().find((s: any) => s.main_id === systemId);
            const lum = starMeta?.luminosity ?? 1.0;
            const star = starMeta
              ? { ...starMeta }
              : { main_id: systemId, spectral_class: 'G', teff: 5600, luminosity: lum };
            console.info(`[Load] ${systemId} | ✓ static JSON — ${planets.length} planets (${ts()})`);
            onLoadDetail?.(`STATIC OK — ${planets.length} planet${planets.length !== 1 ? 's' : ''}`);
            onSubProgress?.(1.0);
            onLoadStage?.('scene');
            setSystemData({
              star, planets, belts,
              habitable_zone: { inner_au: Math.sqrt(lum) * 0.95, outer_au: Math.sqrt(lum) * 1.37 },
              summary: {
                total_planets: planets.length, total_belts: belts.length,
                observed_planets: planets.filter((p: any) => p.confidence === 'observed').length,
                inferred_planets: planets.filter((p: any) => p.confidence === 'inferred').length,
              },
            });
            return;
          } else {
            console.warn(`[Load] ${systemId} | not found in systemDetails.json`);
          }
        }
      } catch (e2: any) {
        if (e2?.name !== 'AbortError') console.warn(`[Load] ${systemId} | systemDetails.json error:`, e2?.message ?? e2);
      }

      // 3. Try Tauri SQLite cache
      console.log(`[Load] ${systemId} | trying Tauri cache (${ts()})`);
      onLoadDetail?.('CHECKING LOCAL CACHE');
      try {
        if (signal.aborted) return;
        onSubProgress?.(0.3);
        const { invoke } = await import('@tauri-apps/api/core');
        const cached = await invoke<{ data_json: string } | null>('get_cached_system', { mainId: systemId });
        if (!signal.aborted && cached?.data_json) {
          const d = JSON.parse(cached.data_json);
          console.info(`[Load] ${systemId} | ✓ Tauri cache (${ts()})`);
          onLoadDetail?.('CACHE HIT — building scene');
          onSubProgress?.(1.0);
          onLoadStage?.('scene');
          setSystemData(d);
          return;
        } else {
          console.warn(`[Load] ${systemId} | Tauri cache: no entry`);
        }
      } catch (e3: any) {
        console.warn(`[Load] ${systemId} | Tauri cache unavailable:`, e3?.message ?? e3);
      }

      if (!signal.aborted) {
        console.error(`[Load] ${systemId} | ✗ all sources failed (${ts()})`);
        onLoadDetail?.('ALL SOURCES FAILED');
        onLoadStage?.('failed' as any);
      }
    })();
    return () => {
      console.log(`[Load] ${systemId} | fetch aborted (unmount/systemId change)`);
      ctrl.abort();
    };
  }, [systemId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Reset shaderWarmed when system changes so ShaderWarmup re-checks cache ── */
  useEffect(() => {
    console.log(`[Load] ${systemId} | systemId changed — resetting shaderWarmed`);
    setShaderWarmed(false);
  }, [systemId]);

  /* ── Signal ready — fires when (a) fresh data+warmup both land, or
   *   (b) active flips back to true and everything was already warmed (same-system re-nav).
   *   Adding `active` to deps is the fix for the "LoadingScreen never dismisses" deadlock. */
  useEffect(() => {
    if (!active || !systemData || !shaderWarmed) return;
    console.log(`[Load] ${systemId} | stage→ready ✓`);
    onLoadDetail?.('ENTERING SYSTEM');
    onSubProgress?.(1.0);
    onLoadStage?.('ready');
  }, [systemData, shaderWarmed, active]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Safety fallback: only fires if compileAsync NEVER calls onReady (broken driver).
   *   90s gives plenty of time for even slow parallel compilation.
   *   DO NOT lower this below the expected compilation time — the 2500ms value previously
   *   here caused a race: fallback fired before WEBGL_parallel_shader_compile finished,
   *   allowing planet navigation while WORLD_FRAG was still compiling → TDR / browser kill. */
  useEffect(() => {
    if (!systemData) return;
    const t = setTimeout(() => {
      if (!shaderWarmed) {
        console.warn(`[Load] ${systemId} | safety fallback after 90s — driver may not support WEBGL_parallel_shader_compile or compileAsync hung`);
        setShaderWarmed(true);
      }
    }, 90_000);
    return () => clearTimeout(t);
  }, [systemData]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Texture generation for planet depth ── */
  useEffect(() => {
    if (view.depth !== 'planet') return;
    if (!systemData?.planets?.length) return;
    const p = systemData.planets[view.planetIdx];
    if (!p) return;

    const mass = p.mass_earth ?? p.pl_bmasse ?? 1;
    const radius = p.radius_earth ?? p.pl_rade ?? 1;
    const sma = p.semi_major_axis_au ?? p.pl_orbsmax ?? 1;
    const ecc = p.eccentricity ?? p.pl_orbeccen ?? 0;
    const starTeff = systemData.star?.teff ?? 5778;
    const starLum = systemData.star?.luminosity ?? 1;
    const ptype = p.planet_type || 'rocky';

    let dead = false;
    setTexStatus('loading');
    setTexturesV2(null);
    setUsePBR(false);

    (async () => {
      try {
        const result = await gpu.generatePlanetV2({
          system_id: systemId, planet_index: view.planetIdx,
          mass_earth: mass, radius_earth: radius,
          semi_major_axis_au: sma, eccentricity: ecc,
          star_teff: starTeff, star_luminosity: starLum,
          planet_type: ptype,
          temperature_k: p.temp_calculated_k ?? 288,
          in_habitable_zone: (p.sub_type_flags || []).includes('habitable_zone'),
          texture_resolution: 512,
        });
        if (!dead) { setTexturesV2(result); setTexStatus('done'); }
      } catch { if (!dead) setTexStatus('failed'); }
    })();

    if (mass && radius && sma && starLum && starTeff) {
      science.computeAll({
        mass_earth: mass, radius_earth: radius, sma_au: sma,
        eccentricity: ecc, star_luminosity: starLum, star_teff: starTeff,
        planet_type: ptype,
      }).catch(() => {});
    }
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemData, view.planetIdx, view.depth, regenCounter]);

  /* ── Navigation handlers ── */
  const handleDrillPlanet = useCallback((idx: number) => {
    setView({ depth: 'planet', planetIdx: idx });
    setScienceOpen(false);
    setSelectedBiome(null);
  }, []);

  const handleDrillMoon = useCallback((moonIdx: number) => {
    setView(prev => ({ depth: 'moon', planetIdx: prev.planetIdx, moonIdx }));
    setScienceOpen(false);
    setSelectedBiome(null);
  }, []);

  const handleDrillBelt = useCallback((beltIdx: number) => {
    setView({ depth: 'belt', planetIdx: 0, beltIdx });
    setScienceOpen(false);
  }, []);

  const handleDrillAsteroid = useCallback((beltIdx: number, asteroidIdx: number, source: 'major' | 'ice_dwarf') => {
    setView({ depth: 'asteroid', planetIdx: 0, beltIdx, asteroidIdx, asteroidSource: source });
    setScienceOpen(false);
  }, []);

  const handleNavigate = useCallback((v: ViewState) => {
    setView(v);
    setScienceOpen(false);
  }, []);

  /* ── Keyboard navigation ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' ||
          (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      const pLen = systemData?.planets?.length || 0;
      setView(prev => {
        const moons = systemData?.planets?.[prev.planetIdx]?.moons || [];
        const mLen = moons.length;

        if (e.key === 'Escape') {
          if (prev.depth === 'moon')     return { ...prev, depth: 'planet' };
          if (prev.depth === 'planet')   return { depth: 'system', planetIdx: prev.planetIdx };
          if (prev.depth === 'asteroid') return { depth: 'belt', planetIdx: 0, beltIdx: prev.beltIdx };
          if (prev.depth === 'belt')     return { depth: 'system', planetIdx: 0 };
          return prev;
        }
        if (e.key === 'ArrowUp' && !e.ctrlKey) {
          e.preventDefault();
          if (prev.depth === 'moon' && mLen > 1)
            return { ...prev, moonIdx: ((prev.moonIdx ?? 0) - 1 + mLen) % mLen };
          if ((prev.depth === 'planet' || prev.depth === 'system') && pLen > 1)
            return { depth: 'planet', planetIdx: (prev.planetIdx - 1 + pLen) % pLen };
          return prev;
        }
        if (e.key === 'ArrowDown' && !e.ctrlKey) {
          e.preventDefault();
          if (prev.depth === 'moon' && mLen > 1)
            return { ...prev, moonIdx: ((prev.moonIdx ?? 0) + 1) % mLen };
          if ((prev.depth === 'planet' || prev.depth === 'system') && pLen > 1)
            return { depth: 'planet', planetIdx: (prev.planetIdx + 1) % pLen };
          return prev;
        }
        if (e.key === 'ArrowRight') {
          if (prev.depth === 'system' && pLen > 0)
            return { depth: 'planet', planetIdx: prev.planetIdx };
          if (prev.depth === 'planet' && mLen > 0)
            return { depth: 'moon', planetIdx: prev.planetIdx, moonIdx: 0 };
          return prev;
        }
        if (e.key === 'ArrowLeft') {
          if (prev.depth === 'moon')   return { ...prev, depth: 'planet' };
          if (prev.depth === 'planet') return { depth: 'system', planetIdx: prev.planetIdx };
          return prev;
        }
        return prev;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [systemData]);

  /* ── Auto-scroll sidebar to selected planet ── */
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [view.depth, view.planetIdx, view.moonIdx]);

  /* ── Derived data ── */
  const planets = systemData?.planets ?? [];
  const belts = systemData?.belts ?? [];
  const starColor = STAR_COLOR[systemData?.star?.spectral_class?.[0]] ?? '#ffcc44';
  const starSpec = systemData?.star?.spectral_class || 'G';
  const hz = systemData?.habitable_zone;
  const arch = systemData?.architecture;

  /* ── Companion star (circumbinary / close binary) ── */
  const companion = systemData?.star?.companions?.[0];
  const compSepAu: number | undefined = companion?.separation_au;
  const compColor = companion?.spectral_class
    ? (STAR_COLOR[companion.spectral_class[0]] ?? '#ffcc44')
    : '#ffcc44';

  const curPlanet = planets[view.planetIdx];
  const curMoon = view.depth === 'moon' ? curPlanet?.moons?.[view.moonIdx!] : null;
  const curBelt = view.depth === 'belt' ? belts[view.beltIdx!] : null;

  const minPeriod = useMemo(() =>
    Math.min(...planets.map((p: any) => p.orbital_period_days ?? p.pl_orbper ?? 365), 365),
    [planets]
  );
  const maxSma = useMemo(() => {
    const vals = planets.map((p: any) => {
      const v = p.semi_major_axis_au ?? p.pl_orbsmax ?? 1;
      return isFinite(v) && v > 0 ? v : 1;
    });
    return Math.max(...vals, 1);
  }, [planets]);

  // Companion star orrery layout — derived after maxSma is known
  const compOrbitR = compSepAu
    ? logOrbitRadius(Math.min(compSepAu, maxSma * 1.5 + 2), STAR_VIS_R, maxSma)
    : undefined;
  // Binary orbital period via Kepler's third law (assume ~2 M☉ total)
  const compPeriodDays = compSepAu ? Math.pow(compSepAu, 1.5) * 365.25 * Math.SQRT2 : undefined;
  const compVizPrd = compPeriodDays
    ? Math.max(vizPeriod(compPeriodDays, minPeriod), 8)
    : undefined;
  // Companion brightness: rough fraction of primary, capped so planets are still readable
  const sunBrightness2 = companion ? Math.min(0.70, (companion.luminosity ?? 0.5) * 0.4 + 0.12) : 0;

  // Moon orbit scaling (planet depth) — also needed for moon depth backdrop
  const moonOrbitData = useMemo(() => {
    if (!curPlanet?.moons?.length) return null;
    if (view.depth !== 'planet' && view.depth !== 'moon') return null;
    const moons = curPlanet.moons;
    const maxAU = Math.max(...moons.map((m: any) => m.orbital_radius_au || 0.005), 0.001);
    const maxRingR = Math.max(
      ...(curPlanet.ring_system?.rings?.map((r: any) => (r.outer_radius_re || 0) * 0.1) || [0]), 1.3
    );
    const minR = maxRingR + 0.4;
    return { maxAU, minR };
  }, [view.depth, curPlanet]);

  // Globe rendering — resolve Venus-type for thick atmosphere worlds
  const resolveVenusType = (p: any) => {
    const raw = p?.planet_type || 'rocky';
    const flags: string[] = p?.sub_type_flags || [];
    return (raw === 'rocky' && flags.includes('thick_atmosphere') && flags.includes('greenhouse_runaway'))
      ? 'venus' : raw;
  };
  const globeType = view.depth === 'moon'
    ? (curMoon ? pickMoonProfile(curMoon, view.moonIdx ?? 0) : 'moon-cratered')
    : resolveVenusType(curPlanet);
  const globeTemp = view.depth === 'moon'
    ? (MOON_TEMP[curMoon?.moon_type] || 150)
    : (curPlanet?.temp_calculated_k ?? 288);
  const globeSeed = view.depth === 'moon'
    ? moonSeed(curMoon, view.planetIdx, view.moonIdx ?? 0)
    : hashStr(curPlanet?.planet_name || `${systemId}-${view.planetIdx}`);

  const showPBR = usePBR && texturesV2 && view.depth === 'planet';
  const isSystemExplored = campaign.isExplored(systemId);

  // ── Terrain params for colony overlay (planets + moons) ──
  const terrainParams: TerrainParams | undefined = useMemo(() => {
    if (view.depth !== 'planet' && view.depth !== 'moon') return undefined;
    const profile = PlanetProfiles[globeType] || PlanetProfiles['rocky'];
    const tp = view.depth === 'moon' ? curMoon : curPlanet;
    const vis = deriveWorldVisuals(profile, {
      temperature: globeTemp,
      mass: tp?.mass_earth,
      tidalHeating: tp?.tidal_heating,
      starSpectralClass: starSpec,
    });
    // Apply same seed-based ocean diversity as ProceduralPlanet
    let oLevel = vis.oceanLevel;
    if (oLevel > 0.1 && oLevel < 0.95 && globeSeed) {
      const variation = Math.sin(globeSeed * 127.1 + 37.7) * 0.5 + 0.5;
      oLevel = Math.max(0.15, Math.min(0.93, oLevel + (variation - 0.5) * 0.35));
    }
    let mtnH = vis.mountainHeight || 0;
    if (mtnH > 0.02 && globeSeed) {
      mtnH *= 0.55 + (Math.sin(globeSeed * 211.3 + 19.1) * 0.5 + 0.5) * 0.9;
    }
    let valD = vis.valleyDepth || 0;
    if (valD > 0.02 && globeSeed) {
      valD *= 0.5 + (Math.sin(globeSeed * 53.7 + 88.3) * 0.5 + 0.5) * 1.0;
    }
    // Match ProceduralWorld's uDisplacement formula exactly so objects sit on terrain
    const baseDisplacement = 0.055;
    const displacement = baseDisplacement + mtnH * 0.22 + (vis.volcanism || 0) * 0.14;
    return {
      seed: globeSeed,
      noiseScale: vis.noiseScale,
      oceanLevel: oLevel,
      mountainHeight: mtnH,
      valleyDepth: valD,
      volcanism: vis.volcanism || 0,
      displacement,
    };
  }, [view.depth, globeType, globeTemp, globeSeed, curPlanet, curMoon, starSpec]);

  const TABS: { id: ScienceTab; label: string }[] = [
    { id: 'editor', label: 'Editor' }, { id: 'composition', label: 'Composition' },
    { id: 'atm-v2', label: 'Atmosphere' }, { id: 'interior', label: 'Interior' },
    { id: 'climate', label: 'Climate' }, { id: 'atmosphere', label: 'Atm (basic)' },
    { id: 'models', label: 'Models' },
  ];

  /* ════════════════════════ Render ═════════════════════════ */
  return (
    <div className="sf">

      {/* ═══ Header Bar ═══ */}
      <div className="sf-header">
        <button className="sf-back" onClick={onBack}>← Map</button>
        <h2 className="sf-title">{systemData?.star?.main_id ?? systemId}</h2>
        {systemData?.star?.spectral_class && (
          <span className="sf-badge" style={{ background: starColor, color: '#0a0e17' }}>
            {systemData.star.spectral_class}
          </span>
        )}
        {arch && <span className="sf-badge sf-arch">{arch.class}</span>}
        {systemData?.star?.confidence === 'observed'
          ? <span className="sf-badge sf-confirmed" title="Real catalogued system">⊕ CONFIRMED</span>
          : <span className="sf-badge sf-generated" title="Procedurally generated">⟡ Generated</span>
        }
        {systemData?.star?.distance_ly != null && (
          <span className="sf-dim">{systemData.star.distance_ly.toFixed(1)} ly</span>
        )}
        {systemData?.star?.mass != null && (
          <span className="sf-dim">{systemData.star.mass.toFixed(2)} M☉</span>
        )}
        {companion && (
          <span className={`sf-badge sf-binary-badge${companion.bond_type === 'close_binary' ? ' sf-close-binary' : ''}`}
            title={`${companion.name} · ${companion.separation_au?.toFixed(1)} AU`}>
            {companion.bond_type === 'close_binary' ? '◎ Binary' : '◌ Wide Binary'}
          </span>
        )}
        <span className="sf-dim">{planets.length} planet{planets.length !== 1 ? 's' : ''}</span>
        {belts.length > 0 && <span className="sf-dim">{belts.length} belt{belts.length !== 1 ? 's' : ''}</span>}
        <div style={{ flex: 1 }} />
        <div className="sf-speed">
          {[0, 0.25, 0.5, 1, 2, 4].map(s => (
            <button key={s}
              className={`sf-speed-btn${orbitSpeed === s ? ' active' : ''}`}
              onClick={() => { _orbit.speed = s; setOrbitSpeed(s); }}>
              {s === 0 ? '⏸' : s < 1 ? `${s}×` : `${s}×`}
            </button>
          ))}
        </div>

        {/* ── Always-visible overlay toggles ── */}
        <div className="sf-hdr-toggles">
          <button className={`sf-hdr-toggle${showTemp ? ' active' : ''}`}
            onClick={() => setShowTemp(v => !v)} title="Habitable zone temperature bands">
            Temp
          </button>
          <button className={`sf-hdr-toggle${showRad ? ' active' : ''}`}
            onClick={() => setShowRad(v => !v)} title="Radiation zones">
            RAD
          </button>
          {(view.depth === 'planet' || view.depth === 'moon') && (<>
            <span className="sf-hdr-divider" />
            <button className={`sf-hdr-toggle${showPlanetTempMap ? ' active' : ''}`}
              onClick={() => { setShowPlanetTempMap(v => !v); setShowPlanetMineralMap(false); }}
              title="Surface temperature map">
              🌡
            </button>
            <button className={`sf-hdr-toggle${showPlanetMineralMap ? ' active' : ''}`}
              onClick={() => { setShowPlanetMineralMap(v => !v); setShowPlanetTempMap(false); }}
              title="Mineral map">
              ⛏
            </button>
            <button className={`sf-hdr-toggle${showPlanetBorders ? ' active' : ''}`}
              onClick={() => setShowPlanetBorders(v => !v)} title="Biome borders">
              ⬡
            </button>
          </>)}
        </div>

        {/* ── Map Controls submenu ── */}
        <div className="sf-map-controls">
          <button className={`sf-map-toggle${mapMenuOpen ? ' active' : ''}`}
            onClick={() => setMapMenuOpen(!mapMenuOpen)}>
            ⚙ Map
          </button>
          {mapMenuOpen && (
            <div className="sf-map-menu">
              {(view.depth === 'planet' || view.depth === 'moon') && (
                <div className="sf-map-menu-row">
                  <button className={`sf-map-btn sf-map-btn-planet${showPlanetTempMap ? ' active' : ''}`}
                    onClick={() => { setShowPlanetTempMap(!showPlanetTempMap); setShowPlanetMineralMap(false); }}>
                    🌡 Surface Temp
                  </button>
                  <button className={`sf-map-btn sf-map-btn-planet${showPlanetMineralMap ? ' active' : ''}`}
                    onClick={() => { setShowPlanetMineralMap(!showPlanetMineralMap); setShowPlanetTempMap(false); }}>
                    ⛏ Minerals
                  </button>
                  <button className={`sf-map-btn sf-map-btn-planet${showPlanetBorders ? ' active' : ''}`}
                    onClick={() => setShowPlanetBorders(!showPlanetBorders)}>
                    ⬡ Borders
                  </button>
                </div>
              )}
              <div className="sf-map-menu-row">
                <label className="sf-map-slider-label">
                  Scale: {orreryScale.toFixed(2)}
                </label>
                <input type="range" className="sf-map-slider"
                  min={0.3} max={1.2} step={0.05}
                  value={orreryScale}
                  onChange={(e) => setOrreryScale(parseFloat(e.target.value))} />
              </div>
  {/* ── Ship controls ── */}
            <button
              className={`sf-colony-toggle${shipMode ? ' active' : ''}`}
              onClick={() => { setShipMode(!shipMode); if (!shipMode) setBuildMode(false); }}
              style={{ marginTop: 4 }}
            >
              {shipMode ? '✕ Exit Navy' : '⚓ Navy'}
            </button>
            {shipMode && (
              <div className="sf-colony-toggles" style={{ fontSize: '0.72rem', opacity: 0.8 }}>
                {selectedShipId
                  ? <span>Click water to move <b>{ships.find(s => s.id === selectedShipId)?.name || 'ship'}</b></span>
                  : <span>Click water to place ship, or click a ship to select</span>}
              </div>
            )}
            {ships.length > 0 && (
              <span className="sf-colony-count">
                {ships.length} ship{ships.length !== 1 ? 's' : ''}
                {ships.some(s => s.targetLat != null) && (
                  <span style={{ color: '#44ddff', marginLeft: 4, fontSize: '0.7rem' }}>⛵ moving</span>
                )}
                <button className="sf-colony-clear"
                  onClick={() => { setShipsMap(prev => ({ ...prev, [worldKey]: [] })); setSelectedShipId(null); }}
                  title="Clear all ships on this world"
                >🗑</button>
              </span>
            )}
          
            </div>
          )}
        </div>
        {/* ── Colony Builder (planet + moon depth) ── */}
        {(view.depth === 'planet' || view.depth === 'moon') && (
          <div className="sf-colony-controls">
            <button
              className={`sf-colony-toggle${buildMode ? ' active' : ''}`}
              onClick={() => setBuildMode(!buildMode)}
            >
              {buildMode ? '✕ Exit Build' : '🏗 Colony'}
            </button>
            {buildMode && (
              <div className="sf-colony-types">
                {(['dome', 'tower', 'mine', 'pad'] as BuildingType[]).map(bt => (
                  <button key={bt}
                    className={`sf-colony-type-btn${selectedBuildingType === bt ? ' active' : ''}`}
                    onClick={() => setSelectedBuildingType(bt)}
                    title={bt.charAt(0).toUpperCase() + bt.slice(1)}
                  >
                    {bt === 'dome'  ? '🏠' :
                     bt === 'tower' ? '📡' :
                     bt === 'mine'  ? '⛏'  : '🛬'}
                  </button>
                ))}
                {/* Admin mode: import GLB */}
                {adminMode && (
                  <>
                    <button
                      className={`sf-colony-type-btn${selectedBuildingType === 'custom' ? ' active' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      title="Import .GLB model"
                    >📦</button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".glb,.gltf"
                      style={{ display: 'none' }}
                      onChange={handleGLBImport}
                    />
                  </>
                )}
                {selectedBuildingType === 'custom' && customModelName && (
                  <span className="sf-colony-custom-name" title={customModelName}>
                    {customModelName.length > 12 ? customModelName.slice(0, 12) + '…' : customModelName}
                  </span>
                )}
              </div>
            )}
            {buildMode && (
              <div className="sf-colony-toggles">
                <button
                  className={`sf-colony-mini-btn${adminMode ? ' active' : ''}`}
                  onClick={() => setAdminMode(!adminMode)}
                  title="Admin mode — import custom GLB models"
                >⚙</button>
                <button
                  className={`sf-colony-mini-btn${showRoads ? ' active' : ''}`}
                  onClick={() => setShowRoads(!showRoads)}
                  title="Toggle roads between buildings"
                >🛤</button>
                <button
                  className={`sf-colony-mini-btn${showZones ? ' active' : ''}`}
                  onClick={() => setShowZones(!showZones)}
                  title="Toggle zones of control"
                >🏴</button>
              </div>
            )}
            {colonyBuildings.length > 0 && (
              <span className="sf-colony-count">
                {colonyBuildings.length} bldg{colonyBuildings.length !== 1 ? 's' : ''}
                <button className="sf-colony-clear"
                  onClick={() => setColonyBuildingsMap(prev => ({ ...prev, [worldKey]: [] }))}
                  title="Clear all buildings on this world"
                >🗑</button>
              </span>
            )}
          </div>
        )}
        {campaign.activeCampaign && !isSystemExplored && (
          <button className="sf-explore" onClick={() => campaign.exploreSystem(systemId)}>⬡ Explore</button>
        )}
        {campaign.activeCampaign && isSystemExplored && (
          <span className="sf-explored">✓ Explored</span>
        )}
        {campaign.devMode && (
          <button className="sf-dev-btn" onClick={() => {
            setTexturesV2(null); setTexStatus('idle'); setUsePBR(false);
            setRegenCounter(c => c + 1);
          }}>↻ Regen</button>
        )}
      </div>

      {/* ═══ Full Viewport ═══ */}
      <div className="sf-viewport">

        {/* ── 3D viewport — renders into the shared App Canvas ── */}
        <div className="sf-canvas-wrap">
          <ErrorBoundary label="Orrery">
            <View style={{ position: 'absolute', inset: 0 }} visible={active}>
              <PerspectiveCamera makeDefault position={[0, 8, 14]} fov={45} />
              <color attach="background" args={['#020408']} />

              {/* ── ShaderWarmup: MUST be OUTSIDE <Suspense>.
                  If inside Suspense, any sibling that suspends (data fetch, useLoader)
                  would block ShaderWarmup from mounting until Suspense resolves.
                  That delays compileAsync — the safety fallback then fires first,
                  giving a premature shaderWarmed=true → TDR on first planet render.
                  Outside Suspense it mounts immediately when the View mounts. ── */}
              <ShaderWarmup
                systemId={systemId}
                onDetail={onLoadDetail}
                onReady={() => {
                  onSubProgress?.(0.5);
                  setShaderWarmed(true);
                }}
              />

              <Suspense fallback={null}>
                <OrbitClock />
                <SmoothCamera depth={view.depth} />
                <Starfield />

                {/* ═══ SYSTEM DEPTH ═══
                    Gate on systemData: prevents OrreryStar's complex shaders from
                    compiling at Canvas mount time (before data loads) which caused
                    D3D11 TDR / WebGL context loss on Windows/ANGLE. */}
                <group visible={view.depth === 'system'}>
                    {systemData && <OrreryStar color={starColor} size={starVisRadius(systemData?.star?.luminosity ?? 1)} teff={systemData?.star?.teff} />}
                    <pointLight position={[0, 0, 0]} intensity={3} color={starColor} distance={40} />
                    {/* Hemisphere light: star tint above, deep space blue below */}
                    <hemisphereLight args={[starColor, '#040810', 0.04]} />

                    {hz && <HabitableZone inner={hz.inner_au} outer={hz.outer_au}
                      starVisR={STAR_VIS_R} maxSma={maxSma} />}

                    {showTemp && systemData?.star && (
                      <TemperatureZone
                        starTeff={systemData.star.teff || 5778}
                        starLum={systemData.star.luminosity || 1}
                        starVisR={STAR_VIS_R}
                        maxSma={maxSma}
                      />
                    )}

                    {showRad && systemData?.star && (
                      <RadiationZone
                        starLum={systemData.star.luminosity || 1}
                        starVisR={STAR_VIS_R}
                        maxSma={maxSma}
                      />
                    )}

                    {(showTemp || showRad) && systemData?.star && (
                      <FrostLine
                        starLum={systemData.star.luminosity || 1}
                        starVisR={STAR_VIS_R}
                        maxSma={maxSma}
                      />
                    )}

                    {/* ── Companion star (close binary / circumbinary) ── */}
                    {companion && compOrbitR && compVizPrd && (
                      <>
                        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
                          <ringGeometry args={[compOrbitR - 0.012, compOrbitR + 0.012, 80]} />
                          <meshBasicMaterial color={compColor} transparent opacity={0.18} depthWrite={false} />
                        </mesh>
                        <CompanionStar
                          orbitR={compOrbitR}
                          color={compColor}
                          size={starVisRadius(companion.luminosity ?? 0.5)}
                          teff={companion.teff}
                          vizPrd={compVizPrd}
                        />
                        <CompanionLight orbitR={compOrbitR} color={compColor} vizPrd={compVizPrd} />
                      </>
                    )}

                    {belts.map((b: any, i: number) => (
                      <React.Fragment key={`belt-${i}`}>
                        <KuiperDustGlow belt={b}
                          starVisR={STAR_VIS_R} maxSma={maxSma} />
                        <BeltGapRings belt={b}
                          starVisR={STAR_VIS_R} maxSma={maxSma} />
                        <BeltParticles belt={b}
                          starVisR={STAR_VIS_R} maxSma={maxSma} />
                        <BeltAsteroids belt={b}
                          starVisR={STAR_VIS_R} maxSma={maxSma} />
                        <NamedBeltBodies belt={b} beltIdx={i}
                          starVisR={STAR_VIS_R} maxSma={maxSma}
                          onDrill={handleDrillAsteroid} />
                      </React.Fragment>
                    ))}

                    {planets.map((p: any, i: number) => {
                      const sma = p.semi_major_axis_au ?? p.pl_orbsmax ?? (0.5 + i * 0.8);
                      const oR = logOrbitRadius(sma, STAR_VIS_R, maxSma);
                      const period = p.orbital_period_days ?? p.pl_orbper ?? (10 + i * 8);
                      const vp = vizPeriod(period, minPeriod);
                      // Venus-type detection: rocky + thick_atmosphere + greenhouse_runaway
                      const rawType = p.planet_type || 'rocky';
                      const flags: string[] = p.sub_type_flags || [];
                      const ptype = (rawType === 'rocky' && flags.includes('thick_atmosphere') && flags.includes('greenhouse_runaway'))
                        ? 'venus' : rawType;
                      const pr = Math.max(0.08, Math.min(0.35, (p.radius_earth ?? p.pl_rade ?? 1) * 0.08)) * orreryScale;
                      const pc = PT_COLOR[ptype] || '#aaa';
                      const isActive = i === view.planetIdx && view.depth !== 'system';
                      return (
                        <group key={`planet-${i}`}>
                          <mesh rotation={[-Math.PI / 2, 0, 0]}>
                            <ringGeometry args={[oR - 0.015, oR + 0.015, 80]} />
                            <meshBasicMaterial
                              color={isActive ? '#4d9fff' : '#3a5a8a'}
                              transparent opacity={isActive ? 0.7 : 0.35}
                              depthWrite={false} />
                          </mesh>
                          <OrreryBody
                            orbitR={oR} r={pr} color={pc}
                            active={isActive}
                            vizPrd={vp}
                            startAngle={i * 1.3}
                            onClick={() => handleDrillPlanet(i)}
                            label={shortName(p.planet_name, i)}
                            ringSystem={p.ring_system}
                            moonHints={p.moons?.map((m: any) => ({
                              color: MOON_COLOR[m.moon_type] || '#888',
                            }))}
                            planetType={ptype}
                            planetSeed={hashStr(p.planet_name || `planet-${i}`)}
                            temperature={p.temp_calculated_k ?? 288}
                            mass={p.mass_earth}
                            starSpectralClass={starSpec}
                            compOrbitR={compOrbitR}
                            compVizPrd={compVizPrd}
                            sunBrightness={1.0}
                            sunBrightness2={sunBrightness2}
                          />
                        </group>
                      );
                    })}
                </group>

                {/* ═══ PLANET DEPTH — lazy-mounted: shaders compile only when user drills in ═══ */}
                {view.depth === 'planet' && <group>
                  {/* Lighting: star-colored key + hemisphere fill */}
                  <directionalLight position={[-1, 0.5, 0.5]} intensity={1.4} color={starColor} />
                  <hemisphereLight args={[starColor, '#020408', 0.02]} />
                  {/* Planetshine — colored reflected light from parent onto moons */}
                  {curPlanet && (() => {
                    const ps = planetShineFromType(curPlanet.planet_type);
                    const psHex = '#' + [ps[0], ps[1], ps[2]].map(
                      v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
                    return <pointLight position={[0, 0, 0]} intensity={0.6} color={psHex} distance={12} />;
                  })()}
                  {curPlanet && (<>
                    <RotatingSurfaceGroup rotationSpeed={curPlanet?.rotation_period_days
                      ? 0.04 * (1.0 / Math.max(curPlanet.rotation_period_days, 0.1))
                      : 0.04}>
                    {showPBR ? (
                      <PlanetSurfaceV2 textures={texturesV2!}
                        sunDirection={[-1, 0.5, 0.5]}
                        starTeff={systemData?.star?.teff ?? 5778}
                        starLuminosity={systemData?.star?.luminosity ?? 1}
                        radius={1} resolution={32} />
                    ) : (
                      <LODPlanet
                        planetType={globeType}
                        temperature={globeTemp}
                        seed={globeSeed}
                        sunDirection={[-1, 0.5, 0.5]}
                        rotationSpeed={0}
                        mass={curPlanet?.mass_earth}
                        tidalHeating={0}
                        starSpectralClass={starSpec}
                        tidallyLocked={!!curPlanet?.tidally_locked}
                        spinOrbit32={curPlanet?.spin_orbit_resonance === '3:2'}
                        showTempMap={showPlanetTempMap}
                        showMineralMap={showPlanetMineralMap}
                        showBorders={showPlanetBorders}
                        tempDistribution={curPlanet?.temp_distribution}
                        mineralAbundance={curPlanet?.mineral_abundance}
                        axialTilt={curPlanet?.axial_tilt ?? 0}
                        baseScale={(() => {
                          const re = curPlanet?.radius_earth || 1;
                          return 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                        })()}
                        onBiomeClick={view.depth === 'planet' ? (biome) => setSelectedBiome(biome) : undefined}
                      />
                    )}

                    {/* Colony buildings on planet surface */}
                    <ColonyOverlay
                      buildings={colonyBuildings}
                      ships={ships}
                      buildMode={buildMode && view.depth === 'planet'}
                      shipMode={shipMode && view.depth === 'planet'}
                      selectedShipId={selectedShipId}
                      selectedType={selectedBuildingType}
                      planetRadius={(() => {
                        const re = curPlanet?.radius_earth || 1;
                        return 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                      })()}
                      rotationSpeed={0}
                      showRoads={showRoads}
                      showZones={showZones}
                      terrainParams={terrainParams}
                      onPlace={handleColonyPlace}
                      onRemove={handleColonyRemove}
                      onShipPlace={handleShipPlace}
                      onShipCommand={handleShipCommand}
                      onShipSelect={handleShipSelect}
                    />
                    </RotatingSurfaceGroup>

                    {curPlanet.ring_system?.rings?.length > 0 && (() => {
                      // At planet depth the globe is rendered at baseScale scene units.
                      // Ring radii are in Earth radii, so 1 RE = baseScale / planet.radius_earth su.
                      const re   = curPlanet?.radius_earth || 1;
                      const bs   = 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                      const rePerSU = re / bs;  // Earth radii per scene unit
                      return (
                        <RingParticles rings={curPlanet.ring_system.rings}
                          tilt={Math.sin((globeSeed || 0) * 47.3) * 0.15}
                          rePerSceneUnit={rePerSU} />
                      );
                    })()}

                    {(() => {
                      if (!moonOrbitData || !curPlanet.moons?.length) return null;
                      // Tidally locked worlds: strip moons (Roche limit / astrodynamics)
                      // Only allow tiny captured irregulars if tidal locked
                      const isTidalLocked = !!curPlanet.tidally_locked;
                      const filteredMoons: any[] = isTidalLocked
                        ? curPlanet.moons.filter((m: any) =>
                            m.moon_type === 'captured-irregular' && (m.radius_earth || 0) < 0.003)
                        : curPlanet.moons;
                      if (!filteredMoons.length) return null;
                      const moonOrbits = layoutMoonOrbits(filteredMoons, moonOrbitData.minR, moonOrbitData.maxAU);
                      const moonRadii = filteredMoons.map((mm: any) => mm.radius_earth || 0.005);
                      const maxMoonRad = Math.max(...moonRadii);
                      // Find original index for each filtered moon
                      const origIndices = filteredMoons.map((m: any) =>
                        curPlanet.moons.indexOf(m));
                      return filteredMoons.map((m: any, fi: number) => {
                      const mi = origIndices[fi];
                      const oR = moonOrbits[fi];

                      const relR = (m.radius_earth || 0.005) / maxMoonRad;
                      const moonR = 0.02 + relR * 0.14;

                      // Potato moon detection: very small bodies (< 50km radius equivalent)
                      const isPotato = (m.radius_earth || 0) < 0.008;

                      // Keplerian period: use orbital_radius_au for period estimate if no data
                      const auOrb = m.orbital_radius_au || 0.001;
                      const estPeriodDays = m.orbital_period_days || Math.pow(auOrb / 0.001, 1.5) * 1.5;
                      const minMoonPeriod = Math.min(...curPlanet.moons.map((mm: any) =>
                        mm.orbital_period_days || Math.pow((mm.orbital_radius_au || 0.001) / 0.001, 1.5) * 1.5
                      ));
                      const period = vizPeriod(estPeriodDays, minMoonPeriod);

                      const moonName = m.moon_name?.split(' ').pop() || `moon-${mi}`;
                      const mType = pickMoonProfile(m, mi);
                      const mSeed = moonSeed(m, view.planetIdx, mi);
                      const mShift = moonColorShift(m, mi);
                      const isActive = view.depth === 'moon' && view.moonIdx === mi;

                      // ── Potato moon visual diversity ──
                      // Deform style from flags
                      const moonFlags: string[] = m.sub_type_flags || [];
                      const potatoDeform: 'generic' | 'miranda' | 'hyperion' | 'eros' =
                        moonFlags.includes('chevron_terrain') || moonFlags.includes('coronae') ? 'miranda' :
                        moonFlags.includes('spongy_pitted') || m.moon_type === 'captured-irregular' && (m.mass_earth || 0) < 0.0003 ? 'hyperion' :
                        moonFlags.includes('elongated') || moonFlags.includes('contact_binary') ? 'eros' :
                        'generic';
                      // Potato color: two-tone based on moon type/profile
                      const potatoColors = isPotato ? pickPotatoColors(m, mType) : undefined;

                      // Atmosphere detection (Titan, etc.)
                      const hasMoonAtm = moonFlags.includes('thick_haze') ||
                        moonFlags.includes('dense_atmosphere') ||
                        m.moon_type === 'atmosphere-moon' ||
                        m.moon_type === 'terrestrial-like';
                      const moonAtmColor = m.moon_type === 'terrestrial-like' ? '#cc8844' :
                        m.moon_type === 'atmosphere-moon' ? '#cc8844' : '#7799bb';

                      return (
                        <group key={`moon-${mi}`}>
                          <MoonOrbitLine radius={oR} active={isActive} />
                          <OrbitingMoon
                            orbitR={oR} r={moonR}
                            vizPrd={period} startAngle={mi * 2.1 + mSeed * 4.0}
                            active={isActive}
                            onClick={() => handleDrillMoon(mi)}
                            label={moonName}
                            planetType={mType}
                            temperature={MOON_TEMP[m.moon_type] || 150}
                            seed={mSeed}
                            colorShift={mShift}
                            mass={m.mass_earth}
                            tidalHeating={m.tidal_heating}
                            isPotato={isPotato}
                            potatoColor={potatoColors?.[0]}
                            potatoColor2={potatoColors?.[1]}
                            potatoDeform={potatoDeform}
                            starSpectralClass={starSpec}
                            hasAtmosphere={hasMoonAtm}
                            atmColor={moonAtmColor}
                            planetShineColor={planetShineFromType(curPlanet?.planet_type)}
                          />
                        </group>
                      );
                    });
                    })()}

                    {/* Shepherd moons near ring edges */}
                    {curPlanet.ring_system?.rings?.map((ring: any, ri: number) => {
                      if (!moonOrbitData) return null;
                      // Same scale fix as RingParticles — convert RE to scene units at planet depth
                      const _re  = curPlanet?.radius_earth || 1;
                      const _bs  = 0.7 + Math.min(Math.log2(1 + _re) * 0.25, 0.5);
                      const _scl = _bs / _re;   // scene units per Earth radius
                      const innerR = ring.inner_radius_re * _scl;
                      const outerR = ring.outer_radius_re * _scl;
                      const sSeed = hashStr(`shepherd-${ri}-${curPlanet.planet_name}`);
                      return (
                        <group key={`shepherd-${ri}`}>
                          {/* Inner shepherd */}
                          <OrbitingMoon
                            orbitR={innerR * 0.92}
                            r={0.025}
                            vizPrd={vizPeriod(0.8 + ri * 0.3, 0.8)}
                            startAngle={sSeed * 6.28}
                            active={false}
                            onClick={() => {}}
                            label=""
                            planetType="moon-shepherd"
                            temperature={100}
                            seed={sSeed}
                            colorShift={[0, 0, 0]}
                            isPotato={true}
                            potatoColor="#99aabb"
                            potatoColor2="#686878"
                            potatoDeform="generic"
                          />
                          {/* Outer shepherd */}
                          <OrbitingMoon
                            orbitR={outerR * 1.06}
                            r={0.020}
                            vizPrd={vizPeriod(0.8 + ri * 0.3 + 0.1, 0.8)}
                            startAngle={sSeed * 6.28 + 3.14}
                            active={false}
                            onClick={() => {}}
                            label=""
                            planetType="moon-shepherd"
                            temperature={100}
                            seed={sSeed + 1000}
                            colorShift={[0, 0, 0]}
                            isPotato={true}
                            potatoColor="#aabbcc"
                            potatoColor2="#787888"
                            potatoDeform="eros"
                          />
                        </group>
                      );
                    })}

                    {/* Captured asteroid mini-moon swarm — outer irregular population */}
                    {(() => {
                      const pMass = curPlanet?.mass_earth ?? 0;
                      const pType = curPlanet?.planet_type ?? '';
                      const GAS_SET = new Set([
                        'gas-giant','super-jupiter','neptune-like','warm-neptune',
                        'mini-neptune','sub-neptune','hot-jupiter','cloudless-hot-jupiter',
                        'night-cloud-giant','water-cloud-giant','nh4sh-cloud-giant',
                      ]);
                      const eligible = GAS_SET.has(pType) || pMass > 15 ||
                        (curPlanet?.moons || []).some((m: any) => m.moon_type === 'captured-irregular');
                      if (!eligible) return null;

                      // Outer radius: beyond the outermost rendered moon (or ring edge + buffer)
                      let outerR = moonOrbitData?.minR ?? 1.8;
                      if (moonOrbitData && curPlanet?.moons?.length) {
                        const moonOrbits = layoutMoonOrbits(
                          curPlanet.moons, moonOrbitData.minR, moonOrbitData.maxAU,
                        );
                        outerR = Math.max(...moonOrbits) + 0.3;
                      }
                      const swarmSeed = hashStr(curPlanet?.planet_name || `planet-${view.planetIdx}`);
                      return (
                        <CapturedMiniMoonSwarm
                          seed={swarmSeed}
                          outerR={outerR}
                          planetMass={pMass}
                          planetType={pType}
                        />
                      );
                    })()}

                    {isSystemExplored && (
                      <>
                        {(curPlanet.sub_type_flags || []).includes('habitable_zone') && (
                          <>
                            <HabitatOrbitRing radius={moonOrbitData ? moonOrbitData.minR * 0.6 : 1.4} />
                            <HabitatStation
                              orbitR={moonOrbitData ? moonOrbitData.minR * 0.6 : 1.4}
                              period={8} startAngle={0.5}
                              type="station" label="Orbital Station" />
                          </>
                        )}
                        {((curPlanet.sub_type_flags || []).includes('global_ocean') ||
                          (curPlanet.sub_type_flags || []).includes('subsurface_ocean')) && (
                          <>
                            <HabitatOrbitRing radius={moonOrbitData ? moonOrbitData.minR * 0.75 : 1.6} />
                            <HabitatStation
                              orbitR={moonOrbitData ? moonOrbitData.minR * 0.75 : 1.6}
                              period={6} startAngle={2.5}
                              type="outpost" label="Research Platform" />
                          </>
                        )}
                      </>
                    )}

                    <directionalLight position={[-1, 0.5, 0.5]} intensity={1.5} color={starColor} />
                    <hemisphereLight args={[starColor, '#020408', 0.02]} />
                    {/* Star billboard — matches orrery OrreryStar, depth-tested so planet occludes it */}
                    <group position={[-36.7, 18.4, 18.4]}>
                      <OrreryStar
                        color={starColor}
                        size={starVisRadius(systemData?.star?.luminosity ?? 1) * 2.8}
                        teff={systemData?.star?.teff}
                        occludable
                      />
                    </group>
                  </>)}
                </group>}

                {/* ═══ MOON DEPTH — lazy-mounted: shaders compile only when user drills in ═══ */}
                {view.depth === 'moon' && <group>
                  {curMoon && (<>
                    <group scale={(() => {
                      const re = curMoon?.radius_earth || 0.3;
                      const s = 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                      return [s, s, s] as [number, number, number];
                    })()}>
                      <RotatingSurfaceGroup rotationSpeed={0.05}>
                      {/* Potato moons keep their irregular shape at moon depth */}
                      {(curMoon.radius_earth || 0) < 0.008 ? (
                        <PotatoMoon
                          seed={moonSeed(curMoon, view.planetIdx, view.moonIdx ?? 0)}
                          color={curMoon.moon_type === 'captured-irregular' ? '#887766' :
                                 curMoon.moon_type === 'shepherd' ? '#99aabb' : '#776655'}
                          detail={4}
                        />
                      ) : (
                        <ProceduralPlanet
                          planetType={globeType}
                          temperature={globeTemp}
                          seed={globeSeed}
                          sunDirection={[-1, 0.5, 0.5]}
                          rotationSpeed={0}
                          colorShift={moonColorShift(curMoon, view.moonIdx ?? 0)}
                          mass={curMoon?.mass_earth}
                          tidalHeating={curMoon?.tidal_heating}
                          starSpectralClass={starSpec}
                          showTempMap={showPlanetTempMap}
                          showMineralMap={showPlanetMineralMap}
                          showBorders={showPlanetBorders}
                          tempDistribution={curMoon?.temp_distribution}
                          mineralAbundance={curMoon?.mineral_abundance}
                          onBiomeClick={view.depth === 'moon' ? (biome) => setSelectedBiome(biome) : undefined} />
                      )}

                      {/* Colony buildings on moon surface (inside scale group → radius=1) */}
                      <ColonyOverlay
                        buildings={colonyBuildings}
                        ships={ships}
                        buildMode={buildMode && view.depth === 'moon'}
                        shipMode={shipMode && view.depth === 'moon'}
                        selectedShipId={selectedShipId}
                        selectedType={selectedBuildingType}
                        planetRadius={1}
                        rotationSpeed={0}
                        showRoads={showRoads}
                        showZones={showZones}
                        terrainParams={terrainParams}
                        onPlace={handleColonyPlace}
                        onRemove={handleColonyRemove}
                        onShipPlace={handleShipPlace}
                        onShipCommand={handleShipCommand}
                        onShipSelect={handleShipSelect}
                      />
                      </RotatingSurfaceGroup>

                      {/* Titan-style atmosphere for moons with thick_haze flag */}
                      {((curMoon.sub_type_flags || []).includes('thick_haze') ||
                        (curMoon.sub_type_flags || []).includes('dense_atmosphere') ||
                        curMoon.moon_type === 'terrestrial-like') && (
                        <mesh>
                          <sphereGeometry args={[1.04, 48, 32]} />
                          <meshBasicMaterial
                            color={curMoon.moon_type === 'terrestrial-like' ? '#cc8844' : '#7799bb'}
                            transparent opacity={0.18}
                            side={THREE.FrontSide} depthWrite={false}
                            blending={THREE.AdditiveBlending}
                          />
                        </mesh>
                      )}
                    </group>

                    <group position={[4, 2.5, -8]} scale={[2.8, 2.8, 2.8]}>
                      {/* Backdrop parent planet — cheap static sphere, no shader compile */}
                      <mesh>
                        <sphereGeometry args={[1, 48, 32]} />
                        <meshStandardMaterial
                          color={(() => {
                            const t = resolveVenusType(curPlanet) || 'rocky';
                            if (t === 'gas-giant') return '#c4a46b';
                            if (t === 'ice-giant') return '#7ab3d4';
                            if (t === 'water-world' || t === 'ocean') return '#3a7bbf';
                            if (t === 'lava' || t === 'venus') return '#c25a2a';
                            if (t === 'ice' || t === 'frozen') return '#cce8f4';
                            if (t === 'desert') return '#c8a96e';
                            if (t === 'tundra') return '#8aaa9a';
                            return '#8a8f7a'; // rocky default
                          })()}
                          roughness={0.85}
                          metalness={0.05}
                        />
                      </mesh>
                      {curPlanet?.ring_system && (() => {
                        // Seed-based tilt so the ring looks like an inclined oval around
                        // the backdrop planet rather than a flat XZ hula hoop.
                        const pSeed = hashStr(curPlanet?.planet_name || `${systemId}-${view.planetIdx}`);
                        const tiltX = (-Math.PI / 2) + 0.55 + Math.sin(pSeed * 47.3) * 0.18;
                        const tiltY = Math.sin(pSeed * 31.7) * 0.25;
                        return (
                          <mesh rotation={[tiltX, tiltY, 0]}>
                            <ringGeometry args={[1.35, 2.25, 64]} />
                            <meshBasicMaterial color="#aabbcc" transparent opacity={0.10}
                              side={THREE.DoubleSide} depthWrite={false} />
                          </mesh>
                        );
                      })()}
                    </group>

                    {isSystemExplored && (
                      <>
                        <HabitatOrbitRing radius={1.8} />
                        <HabitatStation
                          orbitR={1.8} period={5} startAngle={0}
                          type="outpost"
                          label={curMoon.moon_type === 'ice-shell' ? 'Drilling Platform' :
                                 curMoon.moon_type === 'volcanic' ? 'Monitoring Post' :
                                 curMoon.moon_type === 'ocean-moon' ? 'Deep Probe' :
                                 'Survey Station'} />
                        {curMoon.tidal_heating > 0.5 && (
                          <HabitatStation
                            orbitR={2.2} period={7} startAngle={3.1}
                            type="relay" label="Tidal Sensor" />
                        )}
                      </>
                    )}

                    <directionalLight position={[-1, 0.5, 0.5]} intensity={1.3} color={starColor} />
                    <hemisphereLight args={[starColor, '#020408', 0.02]} />
                    <group position={[-36.7, 18.4, 18.4]}>
                      <OrreryStar
                        color={starColor}
                        size={starVisRadius(systemData?.star?.luminosity ?? 1) * 2.8}
                        teff={systemData?.star?.teff}
                      />
                    </group>
                  </>)}
                </group>}

                {/* ═══ ASTEROID DEPTH — lazy-mounted ═══ */}
                {view.depth === 'asteroid' && <group>
                  {(() => {
                    const belt = belts[view.beltIdx ?? 0];
                    if (!belt) return null;
                    const src = view.asteroidSource === 'ice_dwarf' ? belt.ice_dwarfs : belt.major_asteroids;
                    const astData = src?.[view.asteroidIdx ?? 0];
                    if (!astData) return null;
                    const isIcy = view.asteroidSource === 'ice_dwarf' ||
                      belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc';
                    const diam = astData.diameter_km || 200;
                    const visualScale = 0.7 + Math.min(Math.log2(1 + diam / 100) * 0.3, 0.6);
                    const astSeed = hashStr(astData.name || `asteroid-${view.asteroidIdx}`);

                    // Spectral-class surface properties
                    const specClass = (astData.spectral_class || '').toUpperCase();
                    const surf = astData.surface_type || '';
                    type AstMat = [string, string, number, number];
                    const [astColor, astColor2, astRough, astMetal]: AstMat = isIcy
                      ? surf === 'nitrogen-ice' ? ['#b8d0ee', '#708aaa', 0.55, 0.00]
                      : surf === 'methane-frost' ? ['#e0c898', '#907858', 0.65, 0.00]
                      : ['#9ab8d8', '#5c7898', 0.60, 0.00]
                      : specClass === 'C' ? ['#4a4438', '#2e2820', 0.96, 0.02]
                      : specClass === 'S' ? ['#a09070', '#6a5840', 0.90, 0.04]
                      : specClass === 'M' ? ['#c8c2b8', '#888880', 0.30, 0.75]
                      : specClass === 'D' ? ['#6a5038', '#3e2e20', 0.95, 0.02]
                      : specClass === 'V' ? ['#907060', '#604840', 0.88, 0.05]
                      : ['#887755', '#554433', 0.92, 0.04];

                    const binaryType: string | null = astData.binary_type ?? null;
                    const isContactBin = binaryType === 'contact';

                    // Deform: contact binary gets two-lobe render; elongated small = eros; icy pitted = hyperion
                    const deformStyle = (!isContactBin && (astData.is_elongated || diam < 60)) ? 'eros'
                      : (!isContactBin && isIcy && diam < 400) ? 'hyperion'
                      : 'generic';

                    return (<AsteroidCloseupGroup
                      seed={astSeed}
                      visualScale={visualScale}
                      color={astColor} color2={astColor2}
                      roughness={astRough} metalness={astMetal}
                      deformStyle={deformStyle}
                      diam={diam}
                      isIcy={isIcy}
                      specClass={specClass}
                      name={astData.name}
                      starColor={starColor}
                      binaryType={binaryType}
                      axisRatio={astData.axis_ratio}
                    />);
                  })()}
                </group>}

              </Suspense>
            </View>
          </ErrorBoundary>
          {/* Build mode HUD indicator */}
          {buildMode && (view.depth === 'planet' || view.depth === 'moon') && (
            <div className="sf-build-indicator">
              🏗 BUILD MODE — click surface to place {selectedBuildingType} · right-click to undo
            </div>
          )}
        </div>

        {/* ── Belt chart overlay (over Canvas, not replacing it) ── */}
        {view.depth === 'belt' && curBelt && (
          <div className="sf-belt-overlay">
            <BeltFamilyChart belt={curBelt}
              highlightSma={view.depth === 'belt' && view.beltIdx != null ? undefined : undefined} />
            <div className="sf-belt-legend">
              {(curBelt.families || []).map((f: any, i: number) => (
                <span key={i} className="sf-belt-legend-item">
                  <span className="sf-belt-legend-dot"
                    style={{ background: SPEC_COLOR[f.spectral_class] || '#888' }} />
                  {f.name} ({f.spectral_class})
                </span>
              ))}
              {(curBelt.resonance_gaps || []).length > 0 && (
                <span className="sf-belt-legend-item">
                  <span className="sf-belt-legend-dot" style={{ background: '#ff4444' }} />
                  Resonance gaps
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Belt context strip — frames asteroid close-up with orbital context ── */}
        {view.depth === 'asteroid' && curBelt && (() => {
          const astSrc = view.asteroidSource === 'ice_dwarf' ? curBelt.ice_dwarfs : curBelt.major_asteroids;
          const astCtx = astSrc?.[view.asteroidIdx ?? 0];
          return (
            <div className="sf-belt-overlay sf-belt-overlay--strip">
              <BeltFamilyChart belt={curBelt}
                highlightSma={astCtx?.semi_major_axis_au}
                highlightInc={astCtx?.inclination_deg} />
            </div>
          );
        })()}

        {/* ── Breadcrumb overlay ── */}
        <DepthBreadcrumb
          view={view}
          systemData={systemData}
          planets={planets}
          belts={belts}
          onNavigate={handleNavigate}
        />

        {/* ═══ PERSISTENT SIDEBAR — system tree + contextual detail ═══ */}
        <div className="sf-sidebar">
          <div className="sf-sidebar-scroll">

            {/* ── Star info (always visible, click to return to system view) ── */}
            <div className="sf-tree-star" style={{ cursor: 'pointer' }}
              onClick={() => handleNavigate({ depth: 'system', planetIdx: 0 })}>
              <div className="sf-tree-star-row">
                <span className="sf-tree-star-dot" style={{ background: starColor, boxShadow: `0 0 6px ${starColor}` }} />
                <span className="sf-tree-star-name">{systemData?.star?.main_id || systemId}</span>
                {systemData?.star?.spectral_class && (
                  <span className="sf-tree-star-spec" style={{ color: starColor }}>
                    {systemData.star.spectral_class}
                  </span>
                )}
              </div>
              {systemData?.star && (
                <div className="sf-tree-star-meta">
                  {systemData.star.teff && <span>{systemData.star.teff} K</span>}
                  {systemData.star.luminosity != null && <span>{systemData.star.luminosity.toFixed(2)} L☉</span>}
                  {systemData.star.distance_ly != null && <span>{systemData.star.distance_ly.toFixed(1)} ly</span>}
                  {systemData.star.mass != null && <span>{systemData.star.mass.toFixed(2)} M☉</span>}
                  {systemData.star.age_gyr != null && <span>{systemData.star.age_gyr.toFixed(1)} Gyr</span>}
                </div>
              )}
              {systemData?.star && (
                <div className="sf-star-lifecycle">
                  {starLifecycle(systemData.star.spectral_class, systemData.star.luminosity)}
                </div>
              )}

              {/* ── Mini system map: HZ band + planet dots ── */}
              {systemData?.star?.luminosity != null && planets.length > 0 && (() => {
                const lum = Math.max(systemData.star.luminosity, 0.0001);
                const hzIn  = Math.sqrt(lum / 1.1);
                const hzOut = Math.sqrt(lum / 0.53);
                const span  = Math.max(maxSma * 1.15, hzOut * 1.3, 0.2);
                const toX = (au: number) =>
                  Math.min(100, Math.max(0,
                    (Math.log(au + 0.05) - Math.log(0.05)) /
                    (Math.log(span + 0.05) - Math.log(0.05)) * 100));
                const hzL = toX(hzIn), hzR = toX(hzOut);
                return (
                  <div className="sf-sysmap" onClick={e => e.stopPropagation()}
                    title={`HZ: ${hzIn.toFixed(2)}–${hzOut.toFixed(2)} AU`}>
                    <div className="sf-sysmap-track">
                      {/* HZ band */}
                      <div className="sf-sysmap-hz"
                        style={{ left: `${hzL}%`, width: `${Math.max(hzR - hzL, 2)}%` }} />
                      {/* Planet dots */}
                      {planets.map((p: any, i: number) => {
                        const sma = p.semi_major_axis_au ?? p.pl_orbsmax;
                        if (!sma) return null;
                        const x = toX(sma);
                        const pc = PT_COLOR[p.planet_type] || '#667788';
                        const isActive = (view.depth === 'planet' || view.depth === 'moon') && view.planetIdx === i;
                        return (
                          <div key={i} className={`sf-sysmap-dot${isActive ? ' active' : ''}`}
                            style={{ left: `${x}%`, background: pc,
                              boxShadow: isActive ? `0 0 4px ${pc}` : undefined }}
                            title={`${shortName(p.planet_name, i)} — ${sma.toFixed(2)} AU`}
                            onClick={(e) => { e.stopPropagation(); handleDrillPlanet(i); }} />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Companion stars */}
              {systemData?.star?.companions?.map((comp: any, ci: number) => {
                const cCol = STAR_COLOR[comp.spectral_class?.[0]] ?? '#ffcc44';
                const sepLabel = comp.separation_au < 100
                  ? `${comp.separation_au.toFixed(1)} AU`
                  : `${(comp.separation_au / 63241).toFixed(2)} ly`;
                const bondLabel = comp.bond_type === 'close_binary' ? 'close binary' : 'wide companion';
                return (
                  <div key={ci} className="sf-tree-companion">
                    <span className="sf-tree-star-dot" style={{ background: cCol, boxShadow: `0 0 4px ${cCol}`, width: 7, height: 7 }} />
                    <span className="sf-tree-comp-name">{comp.name}</span>
                    {comp.spectral_class && (
                      <span className="sf-tree-star-spec" style={{ color: cCol }}>{comp.spectral_class}</span>
                    )}
                    <span className="sf-dim" style={{ fontSize: 9 }}>{sepLabel} · {bondLabel}</span>
                  </div>
                );
              })}
            </div>

            {/* ── Planets tree (always visible, expandable) ── */}
            {planets.length > 0 && (
              <div className="sf-tree-section">
                <div className="sf-tree-label sf-tree-label--toggle"
                  onClick={() => setSectionsOpen(s => ({ ...s, planets: !s.planets }))}>
                  <span>PLANETS ({planets.length})</span>
                  <span className="sf-section-chevron">{sectionsOpen.planets ? '▾' : '▸'}</span>
                </div>
                {sectionsOpen.planets && planets.map((p: any, i: number) => {
                  const pc = PT_COLOR[p.planet_type] || '#667788';
                  const isSelected = (view.depth === 'planet' || view.depth === 'moon') && view.planetIdx === i;
                  const r = p.radius_earth ?? p.pl_rade ?? 1;

                  const isHZ = p.sub_type_flags?.includes('habitable_zone');
                  const tk = p.temp_calculated_k;
                  const tempColor = !tk ? '#556677'
                    : tk > 700 ? '#ff5533' : tk > 400 ? '#ff9944'
                    : tk > 240 && tk < 360 ? '#44cc88' : tk > 140 ? '#7799dd' : '#5577bb';

                  return (
                    <div key={i} className="sf-tree-group">
                      {/* Planet row — always visible */}
                      <div
                        ref={isSelected ? activeRowRef : undefined}
                        className={`sf-tree-row${isSelected ? ' active' : ''}`}
                        style={{ borderLeftColor: isSelected ? undefined : isHZ ? 'rgba(68,204,102,0.35)' : undefined }}
                        onClick={() => {
                          if (isSelected && view.depth === 'planet') {
                            handleNavigate({ depth: 'system', planetIdx: view.planetIdx });
                          } else {
                            handleDrillPlanet(i);
                          }
                        }}
                      >
                        <span className="sf-nav-dot" style={{ background: pc }} />
                        <span className="sf-tree-name">{shortName(p.planet_name, i)}</span>
                        <span className="sf-tree-type" style={{ color: pc + 'bb' }}>
                          {p.planet_type?.replace(/-/g, '·')}
                        </span>
                        {tk != null && (
                          <span className="sf-tree-stat" style={{ color: tempColor }}>{tk}K</span>
                        )}
                        <span className="sf-tree-stat">{r.toFixed(1)} R⊕</span>
                        {(() => {
                          const gStr = surfaceG(p.mass_earth, p.radius_earth ?? p.pl_rade);
                          return gStr ? (
                            <span className="sf-tree-stat sf-gravity" title="Surface gravity">{gStr}</span>
                          ) : null;
                        })()}
                        {p.resonances?.length > 0 && (
                          <span className="sf-tree-badge sf-resonance-badge"
                            title={`Resonance chain: ${p.resonances.map((rr: any) => rr.ratio).join(', ')}`}>
                            ⚛ {p.resonances[0].ratio}
                          </span>
                        )}
                        {p.moons?.length > 0 && !p.tidally_locked && (
                          <span className="sf-tree-badge">{p.moons.length}🌑</span>
                        )}
                        {/* Top-priority surface flags — max 2 micro-icons */}
                        {(() => {
                          const FLAGS_PRIORITY = [
                            'habitable_zone','possible_biosignatures','global_ocean',
                            'subsurface_ocean','magma_ocean','plate_tectonics',
                            'polar_ice_caps','greenhouse_runaway','tidally_locked',
                          ];
                          const activeFlags = (p.sub_type_flags || [])
                            .filter((f: string) => FLAG_ICON[f])
                            .sort((a: string, b: string) =>
                              FLAGS_PRIORITY.indexOf(a) - FLAGS_PRIORITY.indexOf(b))
                            .slice(0, 2);
                          return activeFlags.length > 0 ? (
                            <span className="sf-tree-badge sf-row-flags"
                              title={activeFlags.map((f: string) => f.replace(/_/g, ' ')).join(', ')}>
                              {activeFlags.map((f: string) => FLAG_ICON[f]).join('')}
                            </span>
                          ) : null;
                        })()}
                        {/* Quick-nav arrows when selected */}
                        {isSelected && planets.length > 1 && (
                          <div className="sf-row-nav" onClick={e => e.stopPropagation()}>
                            <button className="sf-row-nav-btn"
                              onClick={(e) => { e.stopPropagation(); handleDrillPlanet((i - 1 + planets.length) % planets.length); }}
                              title="Previous planet">◂</button>
                            <button className="sf-row-nav-btn"
                              onClick={(e) => { e.stopPropagation(); handleDrillPlanet((i + 1) % planets.length); }}
                              title="Next planet">▸</button>
                          </div>
                        )}
                        <span className="sf-tree-chevron">{isSelected ? '▾' : '›'}</span>
                      </div>

                      {/* ── Expanded planet detail (inline) ── */}
                      {isSelected && (
                        <div className="sf-tree-detail">
                          {/* Quick stats */}
                          <div className="sf-mini-stats">
                            {p.mass_earth != null && (
                              <span>{p.mass_earth.toFixed(1)} M⊕</span>
                            )}
                            {p.temp_calculated_k != null && (
                              <span>{p.temp_calculated_k} K</span>
                            )}
                            {p.semi_major_axis_au != null && (
                              <span>{p.semi_major_axis_au.toFixed(2)} AU</span>
                            )}
                            {p.orbital_period_days != null && (
                              <span>{formatPeriod(p.orbital_period_days)}</span>
                            )}
                            {p.eccentricity != null && p.eccentricity > 0.05 && (
                              <span style={{ color: p.eccentricity > 0.3 ? '#ff9944' : undefined }}>
                                e={p.eccentricity.toFixed(3)}
                              </span>
                            )}
                          </div>

                          {/* Flags — color-coded by category */}
                          {p.sub_type_flags?.length > 0 && (
                            <div className="sf-flags-compact">
                              {p.sub_type_flags.map((f: string, fi: number) => {
                                const fc = FLAG_COLOR[f] || '#778899';
                                return (
                                  <span key={fi} className="sf-flag-sm"
                                    style={{ color: fc, borderColor: fc + '44', background: fc + '12' }}>
                                    {FLAG_ICON[f] || '•'} {f.replace(/_/g, ' ')}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {/* Atmosphere pressure bar */}
                          {p.atmosphere_pressure_bar != null && (() => {
                            const bar = p.atmosphere_pressure_bar as number;
                            // Log-scale mapping: 0.001 bar → 10%, 1 bar → 60%, 100 bar → 100%
                            const pct = Math.min(100, Math.max(4,
                              (Math.log10(Math.max(bar, 0.0001) + 0.001) + 4) / 6 * 100));
                            const barColor = bar < 0.001 ? '#334455'
                              : bar < 0.1 ? '#5577aa' : bar < 0.5 ? '#6699cc'
                              : bar < 2.0 ? '#44cc88' : bar < 10 ? '#ff9944' : '#ff4422';
                            const barLabel = bar < 0.001 ? 'trace'
                              : bar < 1 ? bar.toFixed(3) + ' bar'
                              : bar < 10 ? bar.toFixed(2) + ' bar'
                              : bar.toFixed(1) + ' bar';
                            return (
                              <div className="sf-atm-bar-wrap">
                                <span className="sf-atm-bar-label">Atm</span>
                                <div className="sf-atm-bar-track">
                                  <div className="sf-atm-bar-fill"
                                    style={{ width: `${pct}%`, background: barColor }} />
                                </div>
                                <span className="sf-atm-bar-val" style={{ color: barColor }}>
                                  {barLabel}
                                </span>
                              </div>
                            );
                          })()}

                          {/* Geological terrain profile */}
                          {(() => {
                            const pSeed = hashStr(p.planet_name || `planet-${i}`);
                            const GAS_P = new Set(['gas-giant','super-jupiter','hot-jupiter',
                              'neptune-like','warm-neptune','mini-neptune','sub-neptune']);
                            if (GAS_P.has(p.planet_type)) return null;
                            // Sample 8 zone archetypes and tally the top 3 distinct ones
                            const counts: Record<string, number> = {};
                            for (let zi = 0; zi < 8; zi++) {
                              const a = zoneArchetype(zi, pSeed);
                              counts[a] = (counts[a] || 0) + 1;
                            }
                            const sorted = Object.entries(counts)
                              .sort((a, b) => b[1] - a[1]).slice(0, 3);
                            return (
                              <div className="sf-tree-subsection">
                                <div className="sf-tree-sublabel">TERRAIN</div>
                                {sorted.map(([name, count]) => (
                                  <div key={name} className="sf-terrain-row">
                                    <span className="sf-terrain-bar"
                                      style={{ width: `${Math.round(count / 8 * 100)}%` }} />
                                    <span className="sf-terrain-label">{name}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}

                          {/* Tidal lock + rotation + mining info */}
                          {(p.tidally_locked || p.spin_orbit_resonance || p.mineral_abundance) && (
                            <div className="sf-tree-subsection">
                              {p.tidally_locked && (
                                <div className="sf-tree-sublabel">
                                  🔒 Tidally Locked ({p.spin_orbit_resonance || '1:1'})
                                  {p.rotation_period_days != null && (
                                    <span className="sf-dim"> — {p.rotation_period_days.toFixed(1)}d rot</span>
                                  )}
                                </div>
                              )}
                              {!p.tidally_locked && p.rotation_period_days != null && (
                                <div className="sf-dim" style={{fontSize: '9px'}}>
                                  Rotation: {p.rotation_period_days < 1
                                    ? `${(p.rotation_period_days * 24).toFixed(1)}h`
                                    : `${p.rotation_period_days.toFixed(1)}d`}
                                </div>
                              )}
                              {p.temp_distribution?.pattern && (
                                <div className="sf-dim" style={{fontSize: '9px'}}>
                                  Thermal: {p.temp_distribution.pattern}
                                  {p.temp_distribution.day_night_contrast != null &&
                                    ` (ΔT ${p.temp_distribution.day_night_contrast.toFixed(0)}K)`}
                                </div>
                              )}
                              {p.mineral_abundance?.mining_viability && (
                                <div className="sf-dim" style={{fontSize: '9px'}}>
                                  ⛏ Mining: {p.mineral_abundance.mining_viability.replace(/_/g, ' ')}
                                  {p.mineral_abundance.notable_deposits?.length > 0 && (
                                    <span> — {p.mineral_abundance.notable_deposits.slice(0, 3).join(', ')}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* PBR toggle */}
                          {view.depth === 'planet' && (
                            <div className="sf-globe-controls">
                              {texStatus === 'loading' && (
                                <span className="sf-tex-status">
                                  <span className="sf-spinner" /> PBR…
                                </span>
                              )}
                              {texStatus === 'done' && (
                                <button
                                  className={`sf-pbr-toggle${usePBR ? ' active' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setUsePBR(!usePBR); }}
                                >
                                  {usePBR ? '◆ PBR' : '◇ PBR'}
                                </button>
                              )}
                              {texStatus === 'failed' && (
                                <span className="sf-tex-status sf-tex-fail">PBR n/a</span>
                              )}
                            </div>
                          )}

                          {/* Ring system */}
                          {p.ring_system?.rings?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">RINGS</div>
                              {p.ring_system.rings.map((rr: any, ri: number) => (
                                <div key={ri} className="sf-ring-row-compact">
                                  <span>{rr.name || `Ring ${ri + 1}`}</span>
                                  <span className="sf-dim">{rr.composition}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Moons — expandable per-moon */}
                          {p.moons?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">MOONS ({p.moons.length})</div>
                              {p.moons.map((m: any, mi: number) => {
                                const mc = MOON_COLOR[m.moon_type] || '#888';
                                const isMoonSel = view.depth === 'moon' && view.moonIdx === mi;
                                // Moon-moon resonance with next sibling
                                const nextMoon = p.moons[mi + 1];
                                const moonResLabel = (nextMoon && m.orbital_period_days && nextMoon.orbital_period_days)
                                  ? detectResonance(m.orbital_period_days, nextMoon.orbital_period_days)
                                  : null;

                                return (
                                  <div key={mi} className="sf-tree-moon-group">
                                    <div
                                      ref={isMoonSel ? activeRowRef : undefined}
                                      className={`sf-tree-row moon${isMoonSel ? ' active' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isMoonSel) {
                                          handleNavigate({ depth: 'planet', planetIdx: view.planetIdx });
                                        } else {
                                          handleDrillMoon(mi);
                                        }
                                      }}
                                    >
                                      <span className="sf-nav-dot" style={{ background: mc, width: 5, height: 5 }} />
                                      <span className="sf-tree-name">
                                        {m.moon_name?.split(' ').pop() || `moon-${mi}`}
                                      </span>
                                      <span className="sf-tree-type" style={{ color: mc }}>
                                        {MOON_ICON[m.moon_type] || '🌑'} {m.moon_type?.replace(/-/g, '·')}
                                      </span>
                                      {moonResLabel && (
                                        <span className="sf-tree-badge sf-resonance-badge"
                                          title={`Orbital resonance with next moon: ${moonResLabel}`}>
                                          ⚛ {moonResLabel}
                                        </span>
                                      )}
                                      {m.orbital_period_days != null && (
                                        <span className="sf-tree-stat sf-moon-period">
                                          {formatPeriod(m.orbital_period_days)}
                                        </span>
                                      )}
                                      {m.tidal_heating > 0 && (
                                        <span className="sf-tree-badge">🔥</span>
                                      )}
                                      {/* Quick-nav arrows when this moon is selected */}
                                      {isMoonSel && p.moons.length > 1 && (
                                        <div className="sf-row-nav" onClick={e => e.stopPropagation()}>
                                          <button className="sf-row-nav-btn"
                                            onClick={(e) => { e.stopPropagation(); handleDrillMoon((mi - 1 + p.moons.length) % p.moons.length); }}
                                            title="Previous moon">◂</button>
                                          <button className="sf-row-nav-btn"
                                            onClick={(e) => { e.stopPropagation(); handleDrillMoon((mi + 1) % p.moons.length); }}
                                            title="Next moon">▸</button>
                                        </div>
                                      )}
                                    </div>

                                    {/* Moon expanded detail */}
                                    {isMoonSel && (
                                      <div className="sf-moon-inline">
                                        <div className="sf-mini-stats">
                                          {m.radius_earth != null && (
                                            <span>{m.radius_earth.toFixed(3)} R⊕</span>
                                          )}
                                          {(() => {
                                            const gStr = surfaceG(m.mass_earth, m.radius_earth);
                                            return gStr ? <span className="sf-gravity">{gStr}</span> : null;
                                          })()}
                                          {m.orbital_radius_au != null && (
                                            <span>{(m.orbital_radius_au * 149597870.7).toFixed(0)} km</span>
                                          )}
                                          {m.tidal_heating > 0 && (
                                            <span>🔥 {m.tidal_heating.toFixed(2)}</span>
                                          )}
                                          {m.mass_earth != null && (
                                            <span>{m.mass_earth.toFixed(4)} M⊕</span>
                                          )}
                                        </div>
                                        {m.sub_type_flags?.length > 0 && (
                                          <div className="sf-flags-compact">
                                            {m.sub_type_flags.map((f: string, fi: number) => {
                                              const fc = FLAG_COLOR[f] || '#778899';
                                              return (
                                                <span key={fi} className="sf-flag-sm"
                                                  style={{ color: fc, borderColor: fc + '44', background: fc + '12' }}>
                                                  {FLAG_ICON[f] || '•'} {f.replace(/_/g, ' ')}
                                                </span>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {MOON_DESC[m.moon_type] && (
                                          <div className="sf-moon-desc-compact">
                                            {MOON_DESC[m.moon_type]}
                                          </div>
                                        )}
                                        {isSystemExplored && (
                                          <div className="sf-habitat-compact">
                                            <span className="sf-habitat-inline">
                                              {m.moon_type === 'ice-shell' ? '⛏️ Drilling Platform' :
                                               m.moon_type === 'volcanic' ? '📡 Monitoring Post' :
                                               m.moon_type === 'ocean-moon' ? '🔬 Deep Probe' :
                                               '🛸 Survey Station'}
                                            </span>
                                            {m.tidal_heating > 0.5 && (
                                              <span className="sf-habitat-inline">📡 Tidal Sensor</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Habitat infrastructure */}
                          {isSystemExplored && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">🛰️ INFRASTRUCTURE</div>
                              {(p.sub_type_flags || []).includes('habitable_zone') && (
                                <div className="sf-habitat-item-compact">🏗️ Orbital Station</div>
                              )}
                              {((p.sub_type_flags || []).includes('global_ocean') ||
                                (p.sub_type_flags || []).includes('subsurface_ocean')) && (
                                <div className="sf-habitat-item-compact">🔬 Research Platform</div>
                              )}
                              <div className="sf-habitat-item-compact dim">🛸 More via Campaign</div>
                            </div>
                          )}

                          {/* Resonances */}
                          {arch?.features?.includes('resonance_chain') &&
                            systemData.resonance_chains?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">RESONANCES</div>
                              {systemData.resonance_chains.map((rc: any, rci: number) => (
                                <div key={rci} className="sf-dim" style={{ fontSize: 10, marginBottom: 1 }}>
                                  {rc.inner} ↔ {rc.outer} ({rc.ratio})
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Science panels */}
                          {view.depth === 'planet' && (
                            <div className="sf-tree-subsection">
                              <button className="sf-science-toggle"
                                onClick={(e) => { e.stopPropagation(); setScienceOpen(!scienceOpen); }}>
                                {scienceOpen ? '▾' : '▸'} Science
                                {science.loading && <span className="sf-computing">computing…</span>}
                              </button>
                              {scienceOpen && (
                                <div className="sf-science">
                                  <div className="sf-sci-tabs">
                                    {TABS.map(t => (
                                      <button key={t.id}
                                        onClick={(e) => { e.stopPropagation(); setActiveTab(t.id); }}
                                        className={`sf-sci-tab${activeTab === t.id ? ' active' : ''}`}>
                                        {t.label}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="science-panel sf-sci-content">
                                    {activeTab === 'editor' && (
                                      <PlanetEditorPanel systemId={systemId}
                                        planetIndex={view.planetIdx}
                                        planet={curPlanet}
                                        starTeff={systemData?.star?.teff ?? 5778}
                                        starLuminosity={systemData?.star?.luminosity ?? 1}
                                        onTexturesGenerated={(tex) => {
                                          setTexturesV2(tex as any);
                                          setTexStatus('done');
                                        }}
                                        onStatusChange={() => {}} />
                                    )}
                                    {activeTab === 'composition' && (
                                      <CompositionPanel planet={curPlanet} textures={null}
                                        systemData={systemData} />
                                    )}
                                    {activeTab === 'atmosphere' && (
                                      <AtmospherePanel planet={curPlanet} textures={null} />
                                    )}
                                    {activeTab === 'atm-v2' && (
                                      <AtmosphereV2Panel profile={science.atmosphereV2}
                                        planetName={curPlanet?.planet_name} />
                                    )}
                                    {activeTab === 'interior' && (
                                      <InteriorPanel profile={science.interior}
                                        planetName={curPlanet?.planet_name} />
                                    )}
                                    {activeTab === 'climate' && (
                                      <ClimatePanel climate={science.climate}
                                        smaAu={curPlanet?.semi_major_axis_au}
                                        planetName={curPlanet?.planet_name} />
                                    )}
                                    {activeTab === 'models' && (
                                      <ModelManifestPanel science={science} />
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Belts tree (always visible, expandable) ── */}
            {belts.length > 0 && (
              <div className="sf-tree-section">
                <div className="sf-tree-label sf-tree-label--toggle"
                  onClick={() => setSectionsOpen(s => ({ ...s, belts: !s.belts }))}>
                  <span>BELTS ({belts.length})</span>
                  <span className="sf-section-chevron">{sectionsOpen.belts ? '▾' : '▸'}</span>
                </div>
                {sectionsOpen.belts && belts.map((b: any, i: number) => {
                  const isActive = view.depth === 'belt' && view.beltIdx === i;
                  return (
                    <div key={i} className="sf-tree-group">
                      <div
                        className={`sf-tree-row${isActive ? ' active' : ''}`}
                        onClick={() => {
                          if (isActive) {
                            handleNavigate({ depth: 'system', planetIdx: 0 });
                          } else {
                            handleDrillBelt(i);
                          }
                        }}
                      >
                        <span className="sf-tree-name">
                          {BELT_TYPE_LABEL[b.belt_type] || b.belt_type}
                        </span>
                        <span className="sf-tree-stat">
                          {b.inner_radius_au?.toFixed(1)}–{b.outer_radius_au?.toFixed(1)} AU
                        </span>
                        <span className="sf-tree-chevron">{isActive ? '▾' : '›'}</span>
                      </div>

                      {isActive && (
                        <div className="sf-tree-detail">
                          <div className="sf-mini-stats">
                            <span>{(b.estimated_bodies || 0).toLocaleString()} bodies</span>
                            <span>{b.confidence || '?'} conf</span>
                          </div>

                          {b.families?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">FAMILIES ({b.families.length})</div>
                              <div className="sf-belt-families">
                                {b.families.map((f: any, fi: number) => (
                                  <div key={fi} className="sf-belt-fam-item">
                                    <span className="sf-belt-fam-dot"
                                      style={{ background: SPEC_COLOR[f.spectral_class] || '#888' }} />
                                    <span className="sf-belt-fam-name">{f.name}</span>
                                    <span className="sf-belt-fam-spec">{f.spectral_class}-type</span>
                                    <span className="sf-dim">{f.member_count}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {b.resonance_gaps?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">GAPS ({b.resonance_gaps.length})</div>
                              <div className="sf-belt-families">
                                {b.resonance_gaps.map((g: any, gi: number) => (
                                  <div key={gi} className="sf-belt-fam-item gap">
                                    <span className="sf-belt-fam-name">{g.resonance}</span>
                                    <span className="sf-dim">{g.position_au?.toFixed(3)} AU</span>
                                    <span className="sf-dim">{g.width_class}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {b.major_asteroids?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">MAJOR BODIES</div>
                              <div className="sf-belt-families">
                                {b.major_asteroids.map((a: any, ai: number) => (
                                  <div key={ai} className="sf-belt-fam-item sf-clickable"
                                    onClick={(e) => { e.stopPropagation(); handleDrillAsteroid(i, ai, 'major'); }}
                                    title="Click to view close-up">
                                    <span className="sf-belt-fam-dot"
                                      style={{ background: SPEC_COLOR[a.spectral_class] || '#ccc' }} />
                                    <span className="sf-belt-fam-name">{a.name}</span>
                                    <span className="sf-dim">{a.diameter_km?.toFixed(0)} km</span>
                                    {a.binary_type === 'contact' && <span className="sf-dim" title="Contact binary">⚭</span>}
                                    {(a.binary_type === 'wide' || a.binary_type === 'close') && <span className="sf-dim" title="Binary">⚭</span>}
                                    {a.is_elongated && <span className="sf-dim" title={`Elongated a/b ${a.axis_ratio}`}>↔</span>}
                                    <span className="sf-dim" style={{ color: '#4d9fff', fontSize: 9 }}>🔍</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {b.ice_dwarfs?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">ICE DWARFS</div>
                              <div className="sf-belt-families">
                                {b.ice_dwarfs.map((d: any, di: number) => (
                                  <div key={di} className="sf-belt-fam-item sf-clickable"
                                    onClick={(e) => { e.stopPropagation(); handleDrillAsteroid(i, di, 'ice_dwarf'); }}
                                    title="Click to view close-up">
                                    <span className="sf-belt-fam-dot"
                                      style={{ background: d.surface_type === 'nitrogen-ice' ? '#aaccff' :
                                        d.surface_type === 'methane-frost' ? '#ffccaa' : '#99ddff' }} />
                                    <span className="sf-belt-fam-name">{d.name}</span>
                                    <span className="sf-dim">{d.diameter_km?.toFixed(0)} km</span>
                                    {d.binary_type === 'contact' && <span className="sf-dim" title="Contact binary">⚭c</span>}
                                    {(d.binary_type === 'wide' || d.binary_type === 'close') && <span className="sf-dim" title="Binary">⚭</span>}
                                    {d.has_trinary && <span className="sf-dim" title="Trinary">⚭⚭</span>}
                                    {d.is_elongated && <span className="sf-dim" title={`Elongated a/b ${d.axis_ratio}`}>↔</span>}
                                    <span className="sf-dim" style={{ color: '#4d9fff', fontSize: 9 }}>🔍</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Architecture ── */}
            {arch?.features?.length > 0 && (
              <div className="sf-tree-section">
                <div className="sf-tree-label">ARCHITECTURE</div>
                <div className="sf-arch-class">{arch.class}</div>
                <div className="sf-flags-compact">
                  {arch.features.map((f: string, i: number) => (
                    <span key={i} className="sf-flag-sm">{f.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Asteroid detail panel ── */}
            {view.depth === 'asteroid' && view.beltIdx != null && view.asteroidIdx != null && (() => {
              const b = belts[view.beltIdx];
              if (!b) return null;
              const src = view.asteroidSource === 'ice_dwarf' ? b.ice_dwarfs : b.major_asteroids;
              const a = src?.[view.asteroidIdx];
              if (!a) return null;
              const isIcy = view.asteroidSource === 'ice_dwarf' ||
                b.belt_type === 'icy-kuiper' || b.belt_type === 'scattered-disc';
              const specClass = (a.spectral_class || '').toUpperCase();
              const COMP: Record<string, string> = {
                C: 'Carbon, hydrated silicates, organic compounds',
                S: 'Olivine, pyroxene, iron-nickel',
                M: 'Iron-nickel alloy, trace silicates',
                D: 'Dark organic material, carbon',
                V: 'Basalt, pyroxene (HED meteorite source)',
                P: 'Organic material, dark silicates',
                B: 'Anhydrous silicates, carbon',
                X: 'Mixed / unclassified',
              };
              const composition = isIcy
                ? (a.surface_type === 'nitrogen-ice' ? 'N₂ ice, trace CH₄, tholin haze'
                  : a.surface_type === 'methane-frost' ? 'CH₄ frost, CO, tholins'
                  : 'H₂O ice, rock, tholins')
                : (COMP[specClass] || 'Silicates, rock');
              const albedos: Record<string, string> = {
                C: '0.03–0.09', S: '0.10–0.22', M: '0.10–0.18',
                D: '0.02–0.06', V: '0.20–0.48', P: '0.02–0.06',
                B: '0.05–0.12', X: '0.02–0.30',
              };
              return (
                <div className="sf-tree-section">
                  <div className="sf-tree-label">ASTEROID</div>
                  <div className="sf-tree-row" style={{ cursor: 'default', gap: 6 }}>
                    <span className="sf-nav-dot"
                      style={{ background: isIcy ? '#9ab8d8' : SPEC_COLOR[specClass] || '#aaa' }} />
                    <span className="sf-tree-name" style={{ fontSize: 12 }}>{a.name || 'Unnamed'}</span>
                  </div>
                  <div className="sf-mini-stats" style={{ marginTop: 4 }}>
                    <span>{(a.diameter_km || 0).toFixed(0)} km diam</span>
                    {a.semi_major_axis_au && <span>{a.semi_major_axis_au.toFixed(3)} AU</span>}
                    {a.inclination_deg != null && <span>{a.inclination_deg.toFixed(1)}° incl</span>}
                  </div>
                  <div className="sf-mini-stats" style={{ marginTop: 2 }}>
                    <span>{isIcy ? 'KBO/Icy' : `${specClass || '?'}-type`}</span>
                    {!isIcy && albedos[specClass] && <span>albedo {albedos[specClass]}</span>}
                    {isIcy && a.has_companion && !a.binary_type && <span>⚭ binary</span>}
                  </div>
                  <div className="sf-tree-sublabel" style={{ marginTop: 6 }}>COMPOSITION</div>
                  <div className="sf-dim" style={{ fontSize: 10, lineHeight: 1.5, padding: '2px 0' }}>
                    {composition}
                  </div>
                  {isIcy && a.surface_type && (
                    <div className="sf-mini-stats" style={{ marginTop: 4 }}>
                      <span>surface: {a.surface_type.replace(/-/g, ' ')}</span>
                    </div>
                  )}
                  {(a.binary_type || a.is_elongated) && (
                    <>
                      <div className="sf-tree-sublabel" style={{ marginTop: 6 }}>SYSTEM / SHAPE</div>
                      <div className="sf-mini-stats" style={{ marginTop: 2, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        {a.binary_type === 'contact' && <span>⚭ Contact binary — bilobed</span>}
                        {a.binary_type === 'wide' && <span>⚭ Wide binary system</span>}
                        {a.binary_type === 'close' && <span>⚭ Close binary</span>}
                        {a.has_trinary && <span>⚭⚭ Trinary system</span>}
                        {a.is_elongated && (
                          <span>↔ Elongated a/b {(a.axis_ratio || 1.5).toFixed(1)}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {view.depth === 'system' && (
              <div className="sf-depth-hint">
                Click a planet or use ↑↓ → to navigate
              </div>
            )}

            {/* ── Keyboard hint bar ── */}
            <div className="sf-kb-hint">
              <span>↑↓ planets</span>
              <span>→ drill in</span>
              <span>Esc back</span>
            </div>

          </div>
        </div>

        {/* Loading state */}
        {!systemData && (
          <div className="sf-empty-overlay">Loading system…</div>
        )}

        {/* Biome info panel — shown when a biome region is selected (planet or moon) */}
        {selectedBiome && (view.depth === 'planet' || view.depth === 'moon') && (
          <BiomeInfoPanel biome={selectedBiome} onClose={() => setSelectedBiome(null)} />
        )}

      </div>
    </div>
  );
}
