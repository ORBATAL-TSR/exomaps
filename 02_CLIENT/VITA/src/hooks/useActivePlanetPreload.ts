/**
 * useActivePlanetPreload — Background-preloads textures for the active planet,
 * its moons, and the immediately adjacent planets into the browser HTTP cache.
 *
 * Fires Image() loads whenever the active planet index changes. THREE.js reads
 * from the browser cache when it later creates TextureLoader instances for the
 * same URLs, so the first render of that world's ProceduralWorld is instant
 * instead of waiting for a network round-trip.
 *
 * Preloads: active planet + moons (priority), then prev/next planet + moons
 * (low priority, via requestIdleCallback so they don't compete with the render).
 *
 * Non-blocking: returns nothing, never gates rendering.
 */

import { useEffect } from 'react';
import type { SystemManifest } from '../world/systemManifest';

function urlsForRecord(manifest: SystemManifest, idx: number): string[] {
  const record = manifest.planets[idx];
  if (!record) return [];
  return [
    ...record.planet.textureUrls,
    ...record.moons.flatMap(m => m.textureUrls),
  ];
}

export function useActivePlanetPreload(
  manifest:        SystemManifest | null,
  activePlanetIdx: number,
): void {
  useEffect(() => {
    if (!manifest) return;

    let cancelled = false;

    // Priority: active planet + its moons
    const priorityUrls = urlsForRecord(manifest, activePlanetIdx);
    for (const url of priorityUrls) {
      if (cancelled) break;
      const img = new Image();
      img.onload = img.onerror = () => { /* fire-and-forget into browser cache */ };
      img.src = url;
    }

    // Low-priority: adjacent planets (prev + next) — fire during idle time
    const adjacentUrls = [
      ...urlsForRecord(manifest, activePlanetIdx - 1),
      ...urlsForRecord(manifest, activePlanetIdx + 1),
    ];
    if (adjacentUrls.length > 0) {
      const scheduleAdjacent = () => {
        for (const url of adjacentUrls) {
          if (cancelled) break;
          const img = new Image();
          img.onload = img.onerror = () => {};
          img.src = url;
        }
      };
      if (typeof requestIdleCallback !== 'undefined') {
        const id = requestIdleCallback(scheduleAdjacent);
        return () => { cancelled = true; cancelIdleCallback(id); };
      } else {
        const t = setTimeout(scheduleAdjacent, 200);
        return () => { cancelled = true; clearTimeout(t); };
      }
    }

    return () => { cancelled = true; };
  }, [manifest, activePlanetIdx]);
}
