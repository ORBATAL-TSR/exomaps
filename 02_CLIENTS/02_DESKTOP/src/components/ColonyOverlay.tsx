/**
 * ColonyOverlay — Click-to-place colony buildings on a planet's surface.
 *
 * Features:
 *  - 4 built-in building types (dome, tower, mine, pad)
 *  - Admin mode: import .GLB models as custom buildings
 *  - Auto-linking road system between nearby buildings
 *  - Zones of control that merge visually
 *
 * The component must be rendered as a sibling of LODPlanet at planet depth,
 * so both share the same origin. It keeps its own rotation in sync via
 * matching rotationSpeed.
 */

import { useRef, useMemo, useCallback, Suspense } from 'react';
import * as THREE from 'three';
import { useFrame, ThreeEvent, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  computeColonyData, toTerrainSpherePos, getHeightMap, extractCoastline, TerrainParams,
  computeShipRoute, isOcean, latLonToCell, cellIdx,
  GRID_W, GRID_H,
  type Ship,
} from './ColonyTerrain';

/* ── Types ── */

export type BuildingType = 'dome' | 'tower' | 'mine' | 'pad' | 'custom';

export interface ColonyBuilding {
  id: string;
  lat: number;   // degrees  −90 … +90
  lon: number;   // degrees −180 … +180
  type: BuildingType;
  modelUrl?: string;      // object URL for custom GLB models
  modelName?: string;     // display name for custom models
  customScale?: number;   // scale multiplier for custom models
}

export interface ColonyOverlayProps {
  buildings: ColonyBuilding[];
  ships: Ship[];
  buildMode: boolean;
  shipMode: boolean;             // true = click places/commands ships
  selectedShipId: string | null; // which ship is selected for movement
  selectedType: BuildingType;
  planetRadius: number;     // world-space planet radius (= LODPlanet baseScale)
  rotationSpeed: number;    // must match ProceduralPlanet rotationSpeed
  showRoads: boolean;
  showZones: boolean;
  roadMaxDist?: number;     // max great-circle degrees for road connections (default 30)
  zoneFaction?: string;     // faction color key
  terrainParams?: TerrainParams;  // for terrain-aware roads, territory & sea routes
  onPlace?: (lat: number, lon: number) => void;
  onRemove?: (id: string) => void;
  onShipPlace?: (lat: number, lon: number) => void;
  onShipCommand?: (shipId: string, toLat: number, toLon: number) => void;
  onShipSelect?: (shipId: string) => void;
}

/* ── Math helpers ── */

/** Lat/lon (degrees) → position on sphere of radius r */
function latLonToPos(lat: number, lon: number, r: number = 1): THREE.Vector3 {
  const phi   = (90 - lat) * Math.PI / 180;   // polar angle from +Y
  const theta = (lon + 180) * Math.PI / 180;   // azimuthal from −X
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}

/** Direction vector → lat/lon (degrees) */
function dirToLatLon(dir: THREE.Vector3): { lat: number; lon: number } {
  const n = dir.clone().normalize();
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, n.y))) * 180 / Math.PI;
  let   lon = Math.atan2(n.z, -n.x) * 180 / Math.PI - 180;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

/** Quaternion that rotates +Y to the given outward normal */
function surfaceQuat(normal: THREE.Vector3): THREE.Quaternion {
  const q = new THREE.Quaternion();
  q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  return q;
}

/* ── Constants ── */

/** Building scale relative to the unit sphere (before planetRadius scaling) */
const S = 0.018;

/* used for the pulsing placement cursor */
const CURSOR_RING_INNER = S * 0.6;
const CURSOR_RING_OUTER = S * 1.4;

/** Faction colors for zones of control */
const FACTION_COLORS: Record<string, string> = {
  player:  '#2266ff',
  ally:    '#22cc66',
  neutral: '#ccaa22',
  hostile: '#cc3322',
};

/* ── Building meshes ── */

function BuildingMesh({ building, ghost = false, heightMap, terrainParams }: {
  building: ColonyBuilding; ghost?: boolean;
  heightMap?: Float32Array; terrainParams?: TerrainParams;
}) {
  const { pos, quat } = useMemo(() => {
    if (heightMap && terrainParams) {
      const [x, y, z] = toTerrainSpherePos(building.lat, building.lon, heightMap, terrainParams, 0.055, 0.001);
      const p = new THREE.Vector3(x, y, z);
      return { pos: p, quat: surfaceQuat(p) };
    }
    const p = latLonToPos(building.lat, building.lon, 1.0);
    return { pos: p, quat: surfaceQuat(p) };
  }, [building.lat, building.lon, heightMap, terrainParams]);

  const o = ghost ? 0.35 : 1.0;  // opacity
  const ei = ghost ? 0.3 : 1.0;  // emissive multiplier

  return (
    <group position={pos} quaternion={quat}>
      {/* ── Dome: habitat half-sphere + base ring ── */}
      {building.type === 'dome' && (
        <group>
          <mesh castShadow>
            <sphereGeometry args={[S, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial
              color="#88ccff" emissive="#2266aa" emissiveIntensity={0.4 * ei}
              metalness={0.5} roughness={0.3}
              transparent={ghost} opacity={o} depthWrite={!ghost}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[S * 0.85, S * 1.08, 16]} />
            <meshStandardMaterial
              color="#44aacc" emissive="#226688" emissiveIntensity={0.6 * ei}
              side={THREE.DoubleSide}
              transparent={ghost} opacity={o} depthWrite={!ghost}
            />
          </mesh>
        </group>
      )}

      {/* ── Tower: cylinder + red beacon ── */}
      {building.type === 'tower' && (
        <group>
          <mesh position={[0, S * 1.2, 0]} castShadow>
            <cylinderGeometry args={[S * 0.15, S * 0.3, S * 2.4, 6]} />
            <meshStandardMaterial
              color="#aabbdd" emissive="#445566" emissiveIntensity={0.2 * ei}
              metalness={0.7} roughness={0.3}
              transparent={ghost} opacity={o} depthWrite={!ghost}
            />
          </mesh>
          <mesh position={[0, S * 2.6, 0]}>
            <sphereGeometry args={[S * 0.12, 6, 6]} />
            <meshStandardMaterial
              color="#ff4444" emissive="#ff2222" emissiveIntensity={2.0 * ei}
              transparent={ghost} opacity={Math.min(o, 0.9)} depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* ── Mine: ore crate + derrick + glow ── */}
      {building.type === 'mine' && (
        <group>
          <mesh position={[0, S * 0.25, 0]} castShadow>
            <boxGeometry args={[S * 1.0, S * 0.5, S * 1.0]} />
            <meshStandardMaterial
              color="#997744" emissive="#553311" emissiveIntensity={0.25 * ei}
              metalness={0.4} roughness={0.6}
              transparent={ghost} opacity={o} depthWrite={!ghost}
            />
          </mesh>
          <mesh position={[0, S * 1.2, 0]}>
            <cylinderGeometry args={[S * 0.06, S * 0.12, S * 1.5, 4]} />
            <meshStandardMaterial
              color="#aa8855" emissive="#664422" emissiveIntensity={0.3 * ei}
              metalness={0.8} roughness={0.35}
              transparent={ghost} opacity={o} depthWrite={!ghost}
            />
          </mesh>
          <mesh position={[0, S * 0.08, 0]}>
            <sphereGeometry args={[S * 0.2, 6, 6]} />
            <meshStandardMaterial
              color="#ffaa33" emissive="#ff8800" emissiveIntensity={1.2 * ei}
              transparent opacity={ghost ? 0.25 : 0.55} depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* ── Pad: hexagonal landing surface + 4 corner lights ── */}
      {building.type === 'pad' && (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, S * 0.02, 0]}>
            <circleGeometry args={[S * 1.3, 6]} />
            <meshStandardMaterial
              color="#667788" emissive="#334455" emissiveIntensity={0.3 * ei}
              metalness={0.3} roughness={0.5} side={THREE.DoubleSide}
              transparent={ghost} opacity={o} depthWrite={!ghost}
            />
          </mesh>
          {([[-1, -1], [-1, 1], [1, -1], [1, 1]] as [number, number][]).map(([dx, dz], i) => (
            <mesh key={i} position={[dx * S * 1.0, S * 0.08, dz * S * 1.0]}>
              <sphereGeometry args={[S * 0.07, 4, 4]} />
              <meshStandardMaterial
                color="#22ff66" emissive="#11ff44" emissiveIntensity={1.5 * ei}
                transparent={ghost} opacity={o} depthWrite={false}
              />
            </mesh>
          ))}
        </group>
      )}

      {/* ── Custom GLB model ── */}
      {building.type === 'custom' && building.modelUrl && (
        <Suspense fallback={
          <mesh>
            <boxGeometry args={[S, S, S]} />
            <meshStandardMaterial color="#ff66aa" wireframe />
          </mesh>
        }>
          <CustomGLBModel
            url={building.modelUrl}
            scale={building.customScale || 1.0}
            ghost={ghost}
          />
        </Suspense>
      )}
      {building.type === 'custom' && !building.modelUrl && (
        <mesh>
          <boxGeometry args={[S, S, S]} />
          <meshStandardMaterial
            color="#ff66aa" emissive="#cc2266" emissiveIntensity={0.5 * ei}
            transparent={ghost} opacity={o} depthWrite={!ghost}
          />
        </mesh>
      )}
    </group>
  );
}

/* ── Custom GLB model loader ── */

function CustomGLBModel({ url, scale, ghost }: { url: string; scale: number; ghost: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const cloned = useMemo(() => {
    const scene = gltf.scene.clone(true);
    // Normalize the model to fit within the standard building scale
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const normScale = (S * 2.5) / maxDim * scale;
    scene.scale.setScalar(normScale);
    // Center the base on the origin
    const center = new THREE.Vector3();
    box.getCenter(center);
    scene.position.set(
      -center.x * normScale,
      -box.min.y * normScale,
      -center.z * normScale,
    );
    // If ghost mode, set transparency on all materials
    if (ghost) {
      scene.traverse((child: any) => {
        if (child.isMesh && child.material) {
          const mat = child.material.clone();
          mat.transparent = true;
          mat.opacity = 0.35;
          mat.depthWrite = false;
          child.material = mat;
        }
      });
    }
    return scene;
  }, [gltf, scale, ghost]);

  return <primitive object={cloned} />;
}

/* ── Terrain-aware road and sea-route renderer ── */

function TerrainRoads({
  landRoads, seaRoutes, heightMap, terrainParams,
}: {
  landRoads: [number, number][][];
  seaRoutes: [number, number][][];
  heightMap: Float32Array;
  terrainParams: TerrainParams;
}) {
  const { landGeo, seaGeo } = useMemo(() => {
    // Land roads → line segments projected onto terrain
    const lPts: number[] = [];
    for (const path of landRoads) {
      for (let i = 0; i < path.length - 1; i++) {
        const [a0, a1, a2] = toTerrainSpherePos(path[i][0], path[i][1], heightMap, terrainParams, 0.055, 0.005);
        const [b0, b1, b2] = toTerrainSpherePos(path[i + 1][0], path[i + 1][1], heightMap, terrainParams, 0.055, 0.005);
        lPts.push(a0, a1, a2, b0, b1, b2);
      }
    }
    const lg = lPts.length > 0
      ? new THREE.BufferGeometry().setAttribute(
          'position', new THREE.Float32BufferAttribute(lPts, 3))
      : null;

    // Sea routes → polyline per route on ocean surface (flat radius)
    const sg: THREE.BufferGeometry[] = [];
    for (const path of seaRoutes) {
      if (path.length < 2) continue;
      const pts = path.map(([lt, ln]) => {
        const [x, y, z] = toTerrainSpherePos(lt, ln, heightMap, terrainParams);
        return new THREE.Vector3(x, y, z);
      });
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      g.computeBoundingSphere();
      sg.push(g);
    }

    return { landGeo: lg, seaGeo: sg };
  }, [landRoads, seaRoutes, heightMap, terrainParams]);

  // Sea route dash material
  const seaMat = useMemo(() => {
    const m = new THREE.LineDashedMaterial({
      color: '#3388ff',
      dashSize: 0.008,
      gapSize: 0.005,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return m;
  }, []);

  return (
    <group>
      {/* Land roads */}
      {landGeo && (
        <lineSegments geometry={landGeo}>
          <lineBasicMaterial
            color="#ee9944"
            transparent
            opacity={0.65}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      )}
      {/* Sea trade routes (dashed blue) */}
      {seaGeo.map((g, i) => (
        <primitive
          key={i}
          object={(() => {
            const line = new THREE.Line(g, seaMat);
            line.computeLineDistances();
            return line;
          })()}
        />
      ))}
    </group>
  );
}

/* ── Natural territory renderer (terrain-aware flood-fill) ── */

function NaturalTerritory({
  territory, borderSegments, faction, heightMap, terrainParams,
}: {
  territory: Set<number>;
  borderSegments: [number, number, number, number][];
  faction: string;
  heightMap: Float32Array;
  terrainParams: TerrainParams;
}) {
  const color = FACTION_COLORS[faction] || FACTION_COLORS.player;

  const { fillGeo, borderGeo } = useMemo(() => {
    if (territory.size === 0) return { fillGeo: null, borderGeo: null };

    // ── Fill: one quad per territory cell — projected onto terrain ──
    const CELL_LAT_DEG = 180 / GRID_H;
    const CELL_LON_DEG = 360 / GRID_W;
    const positions: number[] = [];
    const indices: number[] = [];
    let vi = 0;

    for (const idx of territory) {
      const r = (idx / GRID_W) | 0;
      const c = idx % GRID_W;
      const lat0 = 90 - r * CELL_LAT_DEG;
      const lat1 = 90 - (r + 1) * CELL_LAT_DEG;
      const lon0 = -180 + c * CELL_LON_DEG;
      const lon1 = -180 + (c + 1) * CELL_LON_DEG;

      // Project quad corners onto terrain surface + offset to float above
      const [ax, ay, az] = toTerrainSpherePos(lat0, lon0, heightMap, terrainParams, 0.055, 0.012);
      const [bx, by, bz] = toTerrainSpherePos(lat0, lon1, heightMap, terrainParams, 0.055, 0.012);
      const [cx, cy, cz] = toTerrainSpherePos(lat1, lon1, heightMap, terrainParams, 0.055, 0.012);
      const [dx, dy, dz] = toTerrainSpherePos(lat1, lon0, heightMap, terrainParams, 0.055, 0.012);

      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }

    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    fg.setIndex(indices);
    fg.computeVertexNormals();

    // ── Border: line segments projected onto terrain ──
    const bPts: number[] = [];
    for (const [lt1, ln1, lt2, ln2] of borderSegments) {
      const [x1, y1, z1] = toTerrainSpherePos(lt1, ln1, heightMap, terrainParams, 0.055, 0.015);
      const [x2, y2, z2] = toTerrainSpherePos(lt2, ln2, heightMap, terrainParams, 0.055, 0.015);
      bPts.push(x1, y1, z1, x2, y2, z2);
    }
    const bg = bPts.length > 0
      ? new THREE.BufferGeometry().setAttribute(
          'position', new THREE.Float32BufferAttribute(bPts, 3))
      : null;

    return { fillGeo: fg, borderGeo: bg };
  }, [territory, borderSegments, heightMap, terrainParams]);

  if (!fillGeo) return null;

  return (
    <group>
      {/* Territory fill */}
      <mesh geometry={fillGeo}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      {/* Territory border */}
      {borderGeo && (
        <lineSegments geometry={borderGeo}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={0.40}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      )}
    </group>
  );
}

/* ── Coastline renderer (land/ocean boundary glow) ── */

function CoastlineRenderer({
  coastline, heightMap, terrainParams,
}: {
  coastline: [number, number, number, number][];
  heightMap: Float32Array;
  terrainParams: TerrainParams;
}) {
  const geo = useMemo(() => {
    if (coastline.length === 0) return null;
    const pts: number[] = [];
    for (const [lt1, ln1, lt2, ln2] of coastline) {
      const [x1, y1, z1] = toTerrainSpherePos(lt1, ln1, heightMap, terrainParams, 0.055, 0.004);
      const [x2, y2, z2] = toTerrainSpherePos(lt2, ln2, heightMap, terrainParams, 0.055, 0.004);
      pts.push(x1, y1, z1, x2, y2, z2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [coastline, heightMap, terrainParams]);

  if (!geo) return null;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial
        color="#44aacc"
        transparent
        opacity={0.22}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

/* ── Ship mesh (boat hull on water surface) ── */

function ShipMesh({ ship, selected, heightMap, terrainParams, onClick }: {
  ship: Ship; selected: boolean;
  heightMap?: Float32Array; terrainParams?: TerrainParams;
  onClick?: () => void;
}) {
  const meshRef = useRef<THREE.Group>(null!);
  const { pos, quat } = useMemo(() => {
    if (heightMap && terrainParams) {
      // Place on ocean surface (no displacement offset — sit ON water)
      const [x, y, z] = toTerrainSpherePos(ship.lat, ship.lon, heightMap, terrainParams, 0.055, 0.003);
      const p = new THREE.Vector3(x, y, z);
      return { pos: p, quat: surfaceQuat(p) };
    }
    const p = latLonToPos(ship.lat, ship.lon, 1.0);
    return { pos: p, quat: surfaceQuat(p) };
  }, [ship.lat, ship.lon, heightMap, terrainParams]);

  // Gentle bob animation
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() + ship.lat * 10;
    meshRef.current.position.y = Math.sin(t * 1.5) * S * 0.08;
    meshRef.current.rotation.z = Math.sin(t * 0.9) * 0.04;
  });

  const hullColor = selected ? '#44ddff' : '#88aacc';
  const emColor   = selected ? '#22bbff' : '#446688';

  return (
    <group position={pos} quaternion={quat} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      <group ref={meshRef}>
        {/* Hull — stretched sphere */}
        <mesh castShadow scale={[S * 1.6, S * 0.3, S * 0.7]}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial
            color={hullColor} emissive={emColor} emissiveIntensity={selected ? 0.8 : 0.3}
            metalness={0.6} roughness={0.35}
          />
        </mesh>
        {/* Mast */}
        <mesh position={[0, S * 0.6, 0]}>
          <cylinderGeometry args={[S * 0.03, S * 0.04, S * 1.0, 4]} />
          <meshStandardMaterial color="#aabbcc" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Beacon */}
        <mesh position={[0, S * 1.2, 0]}>
          <sphereGeometry args={[S * 0.08, 6, 6]} />
          <meshStandardMaterial
            color={selected ? '#00ffff' : '#ffaa22'}
            emissive={selected ? '#00cccc' : '#ff8800'}
            emissiveIntensity={2.0}
            transparent opacity={0.8} depthWrite={false}
          />
        </mesh>
        {/* Name label glow */}
        {selected && (
          <mesh position={[0, S * 1.6, 0]}>
            <sphereGeometry args={[S * 0.15, 6, 6]} />
            <meshStandardMaterial
              color="#44ddff" emissive="#22bbff" emissiveIntensity={3.0}
              transparent opacity={0.25} depthWrite={false}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

/* ── Ship route trail (dashed cyan line from ship to destination) ── */

function ShipRouteTrail({ route, heightMap, terrainParams }: {
  route: [number, number][];
  heightMap: Float32Array;
  terrainParams: TerrainParams;
}) {
  const geo = useMemo(() => {
    if (route.length < 2) return null;
    const pts = route.map(([lt, ln]) => {
      const [x, y, z] = toTerrainSpherePos(lt, ln, heightMap, terrainParams, 0.055, 0.004);
      return new THREE.Vector3(x, y, z);
    });
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return g;
  }, [route, heightMap, terrainParams]);

  const mat = useMemo(() => new THREE.LineDashedMaterial({
    color: '#00ffcc',
    dashSize: 0.006,
    gapSize: 0.004,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  if (!geo) return null;
  return (
    <primitive object={(() => {
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    })()} />
  );
}

/* ── Maritime territory renderer (sea zones — different blue tint) ── */

function MaritimeTerritory({
  territory, borderSegments, heightMap, terrainParams,
}: {
  territory: Set<number>;
  borderSegments: [number, number, number, number][];
  heightMap: Float32Array;
  terrainParams: TerrainParams;
}) {
  const { fillGeo, borderGeo } = useMemo(() => {
    if (territory.size === 0) return { fillGeo: null, borderGeo: null };

    const CELL_LAT_DEG = 180 / GRID_H;
    const CELL_LON_DEG = 360 / GRID_W;
    const positions: number[] = [];
    const indices: number[] = [];
    let vi = 0;

    for (const idx of territory) {
      const r = (idx / GRID_W) | 0;
      const c = idx % GRID_W;
      const lat0 = 90 - r * CELL_LAT_DEG;
      const lat1 = 90 - (r + 1) * CELL_LAT_DEG;
      const lon0 = -180 + c * CELL_LON_DEG;
      const lon1 = -180 + (c + 1) * CELL_LON_DEG;

      // Project onto ocean surface (no terrain bump — flat water)
      const [ax, ay, az] = toTerrainSpherePos(lat0, lon0, heightMap, terrainParams, 0.055, 0.008);
      const [bx, by, bz] = toTerrainSpherePos(lat0, lon1, heightMap, terrainParams, 0.055, 0.008);
      const [cx, cy, cz] = toTerrainSpherePos(lat1, lon1, heightMap, terrainParams, 0.055, 0.008);
      const [dx, dy, dz] = toTerrainSpherePos(lat1, lon0, heightMap, terrainParams, 0.055, 0.008);

      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }

    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    fg.setIndex(indices);
    fg.computeVertexNormals();

    const bPts: number[] = [];
    for (const [lt1, ln1, lt2, ln2] of borderSegments) {
      const [x1, y1, z1] = toTerrainSpherePos(lt1, ln1, heightMap, terrainParams, 0.055, 0.010);
      const [x2, y2, z2] = toTerrainSpherePos(lt2, ln2, heightMap, terrainParams, 0.055, 0.010);
      bPts.push(x1, y1, z1, x2, y2, z2);
    }
    const bg = bPts.length > 0
      ? new THREE.BufferGeometry().setAttribute(
          'position', new THREE.Float32BufferAttribute(bPts, 3))
      : null;

    return { fillGeo: fg, borderGeo: bg };
  }, [territory, borderSegments, heightMap, terrainParams]);

  if (!fillGeo) return null;

  return (
    <group>
      {/* Sea territory fill — blue tint */}
      <mesh geometry={fillGeo}>
        <meshBasicMaterial
          color="#1166cc"
          transparent
          opacity={0.06}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>
      {/* Maritime border — cyan */}
      {borderGeo && (
        <lineSegments geometry={borderGeo}>
          <lineBasicMaterial
            color="#22aadd"
            transparent
            opacity={0.35}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      )}
    </group>
  );
}

/* ── Placement cursor (pulsing ring on surface) ── */

function PlacementCursor() {
  const ringRef = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const t = clock.getElapsedTime();
    const pulse = 0.35 + Math.sin(t * 4) * 0.15;
    (ringRef.current.material as THREE.MeshStandardMaterial).opacity = pulse;
    const s = 1.0 + Math.sin(t * 3) * 0.08;
    ringRef.current.scale.set(s, s, s);
  });

  return (
    <group>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[CURSOR_RING_INNER, CURSOR_RING_OUTER, 24]} />
        <meshStandardMaterial
          color="#4488ff" emissive="#2266ff" emissiveIntensity={1.8}
          transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[S * 0.18, 8, 8]} />
        <meshStandardMaterial
          color="#66aaff" emissive="#4488ff" emissiveIntensity={2.5}
          transparent opacity={0.35} depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════ */

export function ColonyOverlay({
  buildings,
  ships,
  buildMode,
  shipMode,
  selectedShipId,
  selectedType,
  planetRadius,
  rotationSpeed,
  showRoads,
  showZones,
  roadMaxDist = 30,
  zoneFaction = 'player',
  terrainParams,
  onPlace,
  onRemove,
  onShipPlace,
  onShipCommand,
  onShipSelect,
}: ColonyOverlayProps) {
  const groupRef  = useRef<THREE.Group>(null!);
  const cursorRef = useRef<THREE.Group>(null!);

  /* ── Standalone heightmap (always available, even with 0 buildings) ── */
  const heightMap = useMemo(() => {
    if (!terrainParams) return null;
    return getHeightMap(terrainParams);
  }, [terrainParams]);

  /* ── Compute terrain-aware roads, territory, sea routes ── */
  const colonyData = useMemo(() => {
    if (!terrainParams || buildings.length === 0) return null;
    return computeColonyData(terrainParams, buildings, roadMaxDist, ships);
  }, [terrainParams, buildings, roadMaxDist, ships]);

  /* ── Coastline (always available when heightmap + ocean exists) ── */
  const coastline = useMemo(() => {
    if (!heightMap || !terrainParams || terrainParams.oceanLevel < 0.01) return null;
    return extractCoastline(heightMap, terrainParams.oceanLevel);
  }, [heightMap, terrainParams]);

  /* ── Ship routes (for ships that are moving) ── */
  const shipRoutes = useMemo(() => {
    if (!terrainParams) return new Map<string, [number, number][]>();
    const routes = new Map<string, [number, number][]>();
    for (const s of ships) {
      if (s.targetLat != null && s.targetLon != null) {
        const route = computeShipRoute(terrainParams, s.lat, s.lon, s.targetLat, s.targetLon);
        if (route) routes.set(s.id, route);
      }
    }
    return routes;
  }, [terrainParams, ships]);

  /* ── Sync rotation with planet (respects time controls) ── */
  useFrame((_, delta) => {
    if (groupRef.current) {
      const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
      groupRef.current.rotation.y += delta * rotationSpeed * spd;
    }
  });

  /* ── Pointer handlers ── */
  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if ((!buildMode && !shipMode) || !cursorRef.current || !groupRef.current) return;
    e.stopPropagation();
    const local = groupRef.current.worldToLocal(e.point.clone());
    const normal = local.clone().normalize();
    if (heightMap && terrainParams) {
      const ll = dirToLatLon(local);
      const [tx, ty, tz] = toTerrainSpherePos(ll.lat, ll.lon, heightMap, terrainParams, 0.055, 0.002);
      cursorRef.current.position.set(tx, ty, tz);
    } else {
      cursorRef.current.position.copy(normal);
    }
    cursorRef.current.quaternion.copy(surfaceQuat(normal));
    cursorRef.current.visible = true;
  }, [buildMode, shipMode, heightMap, terrainParams]);

  const handlePointerLeave = useCallback(() => {
    if (cursorRef.current) cursorRef.current.visible = false;
  }, []);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!groupRef.current) return;
    e.stopPropagation();
    const local = groupRef.current.worldToLocal(e.point.clone());
    const ll = dirToLatLon(local);

    if (shipMode) {
      if (selectedShipId && onShipCommand) {
        if (heightMap && terrainParams) {
          const [r, c] = latLonToCell(ll.lat, ll.lon);
          const h = heightMap[cellIdx(r, c)];
          if (isOcean(h, terrainParams.oceanLevel)) {
            onShipCommand(selectedShipId, ll.lat, ll.lon);
          }
        }
      } else if (onShipPlace) {
        if (heightMap && terrainParams) {
          const [r, c] = latLonToCell(ll.lat, ll.lon);
          const h = heightMap[cellIdx(r, c)];
          if (isOcean(h, terrainParams.oceanLevel)) {
            onShipPlace(ll.lat, ll.lon);
          }
        }
      }
      return;
    }

    if (!buildMode || !onPlace) return;
    if (ll) onPlace(ll.lat, ll.lon);
  }, [buildMode, shipMode, selectedShipId, onPlace, onShipPlace, onShipCommand, heightMap, terrainParams]);

  const handleContextMenu = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (!buildMode || !onRemove || buildings.length === 0) return;
    e.stopPropagation();
    const last = buildings[buildings.length - 1];
    if (last) onRemove(last.id);
  }, [buildMode, onRemove, buildings]);

  const activeMode = buildMode || shipMode;

  return (
    <group ref={groupRef} scale={[planetRadius, planetRadius, planetRadius]}>
      {/* Hit sphere for raycasting */}
      <mesh
        onPointerMove={activeMode ? handlePointerMove : undefined}
        onPointerLeave={activeMode ? handlePointerLeave : undefined}
        onClick={activeMode ? handleClick : undefined}
        onContextMenu={activeMode ? handleContextMenu : undefined}
      >
        <sphereGeometry args={[1.006, 48, 32]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Coastline glow (ocean/land boundary) */}
      {coastline && coastline.length > 0 && heightMap && terrainParams && (
        <CoastlineRenderer
          coastline={coastline}
          heightMap={heightMap}
          terrainParams={terrainParams}
        />
      )}

      {/* Natural territory (terrain flood-fill) */}
      {showZones && colonyData && colonyData.territory.size > 0 && terrainParams && (
        <NaturalTerritory
          territory={colonyData.territory}
          borderSegments={colonyData.borderSegments}
          faction={zoneFaction}
          heightMap={colonyData.heightMap}
          terrainParams={terrainParams}
        />
      )}

      {/* Maritime territory (sea zones — coastal 200km + ship influence) */}
      {showZones && colonyData && colonyData.maritimeTerritory.size > 0 && heightMap && terrainParams && (
        <MaritimeTerritory
          territory={colonyData.maritimeTerritory}
          borderSegments={colonyData.maritimeBorderSegments}
          heightMap={heightMap}
          terrainParams={terrainParams}
        />
      )}

      {/* Terrain-aware roads + sea trade routes */}
      {showRoads && colonyData && terrainParams && (colonyData.landRoads.length > 0 || colonyData.seaRoutes.length > 0) && (
        <TerrainRoads
          landRoads={colonyData.landRoads}
          seaRoutes={colonyData.seaRoutes}
          heightMap={colonyData.heightMap}
          terrainParams={terrainParams}
        />
      )}

      {/* Placed buildings */}
      {buildings.map(b => (
        <BuildingMesh key={b.id} building={b}
          heightMap={heightMap ?? undefined} terrainParams={terrainParams} />
      ))}

      {/* Ships on water */}
      {ships.map(s => (
        <ShipMesh key={s.id} ship={s}
          selected={s.id === selectedShipId}
          heightMap={heightMap ?? undefined}
          terrainParams={terrainParams}
          onClick={() => onShipSelect?.(s.id)}
        />
      ))}

      {/* Ship route trails (moving ships) */}
      {heightMap && terrainParams && Array.from(shipRoutes.entries()).map(([id, route]) => (
        <ShipRouteTrail key={`route-${id}`} route={route}
          heightMap={heightMap} terrainParams={terrainParams} />
      ))}

      {/* Ghost building preview at cursor */}
      {buildMode && (
        <group ref={cursorRef} visible={false}>
          <PlacementCursor />
          <BuildingMesh
            building={{ id: '_ghost', lat: 0, lon: 0, type: selectedType }}
            ghost
          />
        </group>
      )}
    </group>
  );
}

export default ColonyOverlay;
