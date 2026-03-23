/**
 * systemManifest.ts — Declarative description of every asset a system needs.
 *
 * Built synchronously from raw API data the moment systemData arrives.
 * Nothing in here blocks rendering — the manifest is used for background
 * preloading only, never as a gate.
 *
 * Designed to grow: add BuildingAssets, ShipAssets, etc. as new layers
 * are added to the simulation without changing the loading flow.
 */

import { WORLD_TRIPLETS, texUrl, GAS_TYPES } from './textures';
import { pickMoonProfile } from './moonProfile';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorldAssets {
  /** ProceduralWorld planet-type string (e.g. 'earth-like', 'moon-volcanic') */
  worldType:   string;
  /** Resolved texture URLs for this world type (empty for gas giants) */
  textureUrls: string[];
}

export interface PlanetRecord {
  planet: WorldAssets;
  moons:  WorldAssets[];
}

export interface SystemManifest {
  systemId: string;
  starSpectralClass: string;
  planets: PlanetRecord[];   // index-aligned with systemData.planets
  /** All unique texture URLs across the whole system (deduplicated) */
  allTextureUrls: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function textureUrlsForType(worldType: string): string[] {
  if (GAS_TYPES.has(worldType)) return [];       // gas: pure procedural, no disk textures
  const t = WORLD_TRIPLETS[worldType];
  if (!t) return [];
  return [texUrl(t.texLow), texUrl(t.texMid), texUrl(t.texHigh)];
}

function worldAssets(worldType: string): WorldAssets {
  return { worldType, textureUrls: textureUrlsForType(worldType) };
}

// ── Builder ────────────────────────────────────────────────────────────────

export function buildManifest(systemId: string, systemData: any): SystemManifest {
  const starSpectralClass: string = systemData?.star?.spectral_class ?? 'G';

  const allUrls = new Set<string>();

  const planets: PlanetRecord[] = (systemData?.planets ?? []).map((p: any) => {
    const pType   = p.planet_type ?? 'rocky';
    const pAssets = worldAssets(pType);
    pAssets.textureUrls.forEach(u => allUrls.add(u));

    const moons: WorldAssets[] = (p.moons ?? []).map((m: any, mi: number) => {
      const mType   = pickMoonProfile(m, mi);
      const mAssets = worldAssets(mType);
      mAssets.textureUrls.forEach(u => allUrls.add(u));
      return mAssets;
    });

    return { planet: pAssets, moons };
  });

  return {
    systemId,
    starSpectralClass,
    planets,
    allTextureUrls: Array.from(allUrls),
  };
}
