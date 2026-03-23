/**
 * StarLabels – Camera-proximity name labels for stars.
 *
 * Labels are shown for stars nearest the CAMERA (not just Sol),
 * so zooming into any region of the map reveals local star names.
 * Labels are clickable, show common names, include planet-host
 * indicators, and render faint "drop lines" to the galactic plane
 * for 3D depth perception.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { StarSystemFull } from '../types/api';
import { getShortName } from '../utils/commonNames';

interface StarLabelsProps {
  systems: StarSystemFull[];
  selectedId: string | null;
  onNavigate?: (id: string) => void;
  /** Maximum number of auto-labels (camera-proximity) */
  maxLabels?: number;
}

/** Harvard spectral class → badge color */
const SPECTRAL_HEX: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

/**
 * Stars that always get their own individual label even if they
 * belong to a system group.
 */
const ALWAYS_LABEL_INDIVIDUALLY = new Set([
  'Proxima Centauri',
  'Sirius A',
  'Sirius B',
  "Barnard's Star",
]);

/** Pick the "anchor" star for a system group (closest to Sol) */
function pickGroupAnchor(group: string, systems: StarSystemFull[]): StarSystemFull | null {
  let best: StarSystemFull | null = null;
  for (const s of systems) {
    if (s.system_group === group) {
      if (!best || s.distance_ly < best.distance_ly) best = s;
    }
  }
  return best;
}

/* ── Drop lines: faint verticals from stars to y=0 ─── */
function DropLines({ systems }: { systems: StarSystemFull[] }) {
  const geometry = useMemo(() => {
    if (systems.length === 0) return null;
    const positions: number[] = [];
    for (const s of systems) {
      if (Math.abs(s.y) < 0.05) continue;
      positions.push(s.x, s.y, s.z);
      positions.push(s.x, 0, s.z);
    }
    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [systems]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#334155" transparent opacity={0.12} depthWrite={false} />
    </lineSegments>
  );
}

/* ── Small dot at each star's projection on y=0 ─── */
function PlaneMarkers({ systems }: { systems: StarSystemFull[] }) {
  const geometry = useMemo(() => {
    if (systems.length === 0) return null;
    const positions: number[] = [];
    for (const s of systems) {
      if (Math.abs(s.y) < 0.05) continue;
      positions.push(s.x, 0.001, s.z);
    }
    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [systems]);

  if (!geometry) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial color="#334155" size={1.5} transparent opacity={0.2} depthWrite={false} sizeAttenuation={false} />
    </points>
  );
}

export default function StarLabels({
  systems,
  selectedId,
  onNavigate,
  maxLabels = 80,
}: StarLabelsProps) {
  const { camera } = useThree();
  const [cameraPos, setCameraPos] = useState<THREE.Vector3>(() => new THREE.Vector3(15, 10, 15));
  const frameRef = useRef(0);

  // Update camera position state periodically (every ~12 frames)
  useFrame(() => {
    frameRef.current++;
    if (frameRef.current % 12 === 0) {
      const pos = camera.position;
      setCameraPos((prev) => {
        if (prev.distanceToSquared(pos) > 0.25) {
          return pos.clone();
        }
        return prev;
      });
    }
  });

  const { labels, groupLabels, dropLineSystems } = useMemo(() => {
    if (systems.length === 0) {
      return {
        labels: [] as StarSystemFull[],
        groupLabels: [] as { group: string; anchor: StarSystemFull }[],
        dropLineSystems: [] as StarSystemFull[],
      };
    }

    // Sort by distance to CAMERA (not Sol)
    const withDist = systems.map((s) => ({
      system: s,
      camDist: Math.sqrt(
        (s.x - cameraPos.x) ** 2 +
        (s.y - cameraPos.y) ** 2 +
        (s.z - cameraPos.z) ** 2,
      ),
    }));
    withDist.sort((a, b) => a.camDist - b.camDist);

    const labelSet = new Map<string, StarSystemFull>();

    // Always add individually famous stars
    for (const s of systems) {
      if (ALWAYS_LABEL_INDIVIDUALLY.has(s.main_id)) {
        labelSet.set(s.main_id, s);
      }
    }

    // Always include selected star + its system group members
    if (selectedId) {
      const sel = systems.find((s) => s.main_id === selectedId);
      if (sel) {
        labelSet.set(sel.main_id, sel);
        if (sel.system_group) {
          for (const s of systems) {
            if (s.system_group === sel.system_group) {
              labelSet.set(s.main_id, s);
            }
          }
        }
      }
    }

    // Fill remaining slots with stars nearest to camera
    for (const { system: s } of withDist) {
      if (labelSet.size >= maxLabels) break;
      if (s.system_group && !ALWAYS_LABEL_INDIVIDUALLY.has(s.main_id)) continue;
      labelSet.set(s.main_id, s);
    }

    // Build group labels
    const seenGroups = new Set<string>();
    const gLabels: { group: string; anchor: StarSystemFull }[] = [];
    for (const s of systems) {
      if (s.system_group && !seenGroups.has(s.system_group)) {
        seenGroups.add(s.system_group);
        const anchor = pickGroupAnchor(s.system_group, systems);
        if (anchor) gLabels.push({ group: s.system_group, anchor });
      }
    }

    const allLabeled = Array.from(labelSet.values());

    return {
      labels: allLabeled,
      groupLabels: gLabels,
      dropLineSystems: allLabeled,
    };
  }, [systems, selectedId, maxLabels, cameraPos]);

  const selectedGroup = useMemo(() => {
    if (!selectedId) return null;
    const sel = systems.find((s) => s.main_id === selectedId);
    return sel?.system_group ?? null;
  }, [systems, selectedId]);

  return (
    <group>
      {/* ── Drop lines to galactic plane ───────────── */}
      <DropLines systems={dropLineSystems} />
      <PlaneMarkers systems={dropLineSystems} />

      {/* ── Individual star labels ───────────────────── */}
      {labels.map((s) => {
        const isSelected = s.main_id === selectedId;
        const specColor = SPECTRAL_HEX[s.spectral_class?.[0]?.toUpperCase()] ?? '#6b7280';
        const yOffset = 0.06;

        const camDist = cameraPos.distanceTo(new THREE.Vector3(s.x, s.y, s.z));
        const distOpacity = isSelected
          ? 1.0
          : THREE.MathUtils.clamp(1.0 - camDist / 60, 0.0, 1.0);
        if (distOpacity <= 0.02 && !isSelected) return null;

        const displayName = getShortName(s.main_id);

        return (
          <Html
            key={s.main_id}
            position={[s.x, s.y + yOffset, s.z]}
            center
            style={{
              pointerEvents: onNavigate ? 'auto' : 'none',
              cursor: onNavigate ? 'pointer' : 'default',
            }}
            zIndexRange={[10, 0]}
          >
            <span
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.(s.main_id);
              }}
              style={{
                color: isSelected ? '#f3f4f6' : specColor,
                fontSize: isSelected ? 11 : 9,
                fontWeight: isSelected ? 700 : 500,
                fontFamily: "'Inter', sans-serif",
                textShadow: `0 0 6px ${specColor}40, 0 1px 3px rgba(0,0,0,0.8)`,
                whiteSpace: 'nowrap',
                letterSpacing: 0.3,
                opacity: distOpacity,
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {displayName}
              {s.planet_count > 0 && (
                <span
                  style={{
                    fontSize: 7,
                    color: '#22d3ee',
                    opacity: 0.8,
                  }}
                  title={`${s.planet_count} planet${s.planet_count > 1 ? 's' : ''}`}
                >
                  {'\u2295'}{s.planet_count}
                </span>
              )}
            </span>
          </Html>
        );
      })}

      {/* ── System group labels (one per group) ──────── */}
      {groupLabels.map(({ group, anchor }) => {
        const isActive = selectedGroup === group;
        const specColor = SPECTRAL_HEX[anchor.spectral_class?.[0]?.toUpperCase()] ?? '#6b7280';
        const yOffset = 0.08;

        const camDist = cameraPos.distanceTo(new THREE.Vector3(anchor.x, anchor.y, anchor.z));
        const distOpacity = isActive
          ? 1.0
          : THREE.MathUtils.clamp(1.0 - camDist / 60, 0.0, 1.0);
        if (distOpacity <= 0.02 && !isActive) return null;

        return (
          <Html
            key={`grp-${group}`}
            position={[anchor.x, anchor.y + yOffset, anchor.z]}
            center
            style={{
              pointerEvents: onNavigate ? 'auto' : 'none',
              cursor: onNavigate ? 'pointer' : 'default',
            }}
            zIndexRange={[10, 0]}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.(anchor.main_id);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                opacity: distOpacity,
                userSelect: 'none',
              }}
            >
              <span
                style={{
                  color: isActive ? '#67e8f9' : specColor,
                  fontSize: isActive ? 11 : 9,
                  fontWeight: isActive ? 700 : 600,
                  fontFamily: "'Inter', sans-serif",
                  textShadow: `0 0 6px ${specColor}40, 0 1px 3px rgba(0,0,0,0.8)`,
                  whiteSpace: 'nowrap',
                  letterSpacing: 0.3,
                }}
              >
                {group}
              </span>
              {isActive && anchor.group_hierarchy && (
                <span
                  style={{
                    fontSize: 7,
                    color: '#67e8f9',
                    fontFamily: "'JetBrains Mono', monospace",
                    opacity: 0.7,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {anchor.group_hierarchy}
                </span>
              )}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
