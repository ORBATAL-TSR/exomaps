/**
 * ProceduralPlanet.tsx — backwards-compat re-export shim.
 *
 * The canonical implementation lives in ../world/ProceduralWorld.tsx.
 * This file exists so that existing consumers (SystemFocusView, TexturedPlanet,
 * etc.) continue to import from './ProceduralPlanet' without modification.
 */

export { ProceduralWorld as default, ProceduralWorld as ProceduralPlanet } from '../world/ProceduralWorld';
export type { BiomeInfo } from '../world/zones';
export { V } from '../world/profiles';
export { deriveWorldVisuals } from '../world/derive';
export { getBiomeAt, BIOME_DATA, zoneArchetype, zoneCharLabel, GEOLOGICAL_ARCHETYPES, ZONE_ROLE, computeZoneRoles } from '../world/zones';
