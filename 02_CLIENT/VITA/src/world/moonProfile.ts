/**
 * moonProfile.ts — Shared moon world-type resolver.
 *
 * Extracted from SystemFocusView so both the orrery renderer and the
 * system manifest builder use identical logic when deriving a moon's
 * ProceduralWorld profile from raw API data.
 */

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

/**
 * Derive the ProceduralWorld planet-type string for a moon from its
 * raw API object. Mirrors the logic in SystemFocusView exactly.
 */
export function pickMoonProfile(m: any, moonIdx: number): string {
  const flags: string[] = m.sub_type_flags ?? [];
  const has = (f: string) => flags.includes(f);
  const type = m.moon_type || 'cratered-airless';
  const tidal = m.tidal_heating ?? 0;
  const mass  = m.mass_earth  ?? 0;

  // Flag-driven overrides (most specific first)
  if (has('lava_lakes') && tidal > 0.6)                              return 'moon-magma-ocean';
  if (has('sulfur_eruptions'))                                        return 'moon-volcanic';
  if (has('nitrogen_geysers') || has('nitrogen_atmosphere'))          return 'moon-nitrogen-ice';
  if (has('hydrocarbon_lakes') || has('thick_haze'))                  return 'moon-atmosphere';
  if (has('possible_biosignatures') || (has('subsurface_ocean') && has('cracked_ice'))) return 'moon-ice-shell';
  if (has('chevron_terrain') || has('possible_geysers'))              return 'moon-ocean';
  if (has('captured_kbo'))                                            return 'moon-tholin';
  if (has('dark_material'))                                           return 'moon-carbon-soot';

  // Refine by moon_type
  if (type === 'volcanic')           return tidal > 0.7 ? 'moon-magma-ocean' : 'moon-volcanic';
  if (type === 'ice-shell') {
    if (has('cracked_ice'))   return 'moon-ice-shell';
    if (has('resurfaced'))    return 'moon-ocean';
    if (mass > 0.02)          return 'moon-ice-shell';
    return 'moon-co2-frost';
  }
  if (type === 'ocean-moon')         return has('tidal_flexing') ? 'moon-ammonia-slush' : 'moon-ocean';
  if (type === 'atmosphere-moon')    return 'moon-atmosphere';
  if (type === 'captured-irregular') {
    if (has('retrograde_orbit')) return 'moon-tholin';
    return mass < 0.0001 ? 'moon-carbon-soot' : 'moon-captured';
  }
  if (type === 'shepherd')           return 'moon-shepherd';
  if (type === 'binary-moon')        return 'moon-binary';

  // cratered-airless: diversify by flags/mass
  if (has('heavily_cratered') && has('undifferentiated')) return 'moon-regolith';
  if (has('magnetic_field') || mass > 0.02)               return 'moon-thin-atm';
  if (has('death_star_crater') || has('extreme_geology'))  return 'moon-basalt';
  if (has('cryogenic_surface'))                            return 'moon-silicate-frost';
  if (has('possible_subsurface_ocean'))                    return 'moon-ammonia-slush';

  // Hash-based fallback for visual diversity
  const rocky = [
    'moon-cratered', 'moon-iron-rich', 'moon-olivine', 'moon-basalt',
    'moon-regolith',  'moon-silicate-frost', 'moon-sulfate',
  ];
  const h = hashStr((m.moon_name ?? '') + moonIdx);
  return rocky[Math.floor(h * rocky.length) % rocky.length];
}
