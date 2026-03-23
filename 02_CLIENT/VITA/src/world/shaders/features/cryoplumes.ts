/**
 * cryoplumes.ts — GLSL feature: cryovolcanic geyser plumes.
 *
 * Models ice-shell moon surface geysers (Enceladus, Triton, Europa analogs).
 * Procedurally places sparse vent sites across the surface using hash-seeded
 * positions. Around each active vent:
 *   - A bright ice-dust halo (freshly deposited crystalline material)
 *   - Radial frost streaks diverging from the vent along the terrain
 *   - Slow pulse animation (geyser intermittency)
 *   - A faint plume column visible at the limb (brightened near-terminator region)
 *
 * Reads uniforms: uTime, uSeed, uVolcanism, uIceCaps
 *
 * Call site: after main terrain color, before atmosphere compositing.
 *   applyCryoPlumes(color, pos, N, L, NdotL);
 *
 * Guard: skips entirely when uIceCaps < 0.25 or uVolcanism < 0.04.
 */
export const CRYOPLUMES_GLSL = /* glsl */`

// ── Deterministic vent site hash ────────────────────────────────────────
// Returns a [0,1] hash for any 3D integer lattice point — used to pick
// vent positions and per-vent activity phases.
float ventHash(vec3 cell) {
  return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// ── Cryovolcanic plume surface effect ────────────────────────────────────
// Renders icy geyser vents as bright frost halos + radial streak deposits.
void applyCryoPlumes(inout vec3 color, vec3 pos, vec3 N, vec3 L, float NdotL) {
  if(uIceCaps < 0.25 || uVolcanism < 0.04) return;

  // Activity scale: stronger volcanism → more vent sites and brighter halos.
  float activity = smoothstep(0.04, 0.55, uVolcanism) * smoothstep(0.25, 0.70, uIceCaps);

  // Vent lattice — 6×6×6 cells on the unit sphere surface.
  // Each cell either hosts a vent (hash-activated) or is dormant.
  vec3  ventCell  = floor(pos * 6.0);
  vec3  ventFract = fract(pos * 6.0);

  float totalHalo    = 0.0;
  float totalStreak  = 0.0;
  float nearestDist  = 1.0;

  // 2×2×2 neighborhood search — one level is sufficient for 6-unit grid
  for(int dx = -1; dx <= 1; dx++)
  for(int dy = -1; dy <= 1; dy++)
  for(int dz = -1; dz <= 1; dz++) {
    vec3  nb      = ventCell + vec3(float(dx), float(dy), float(dz));
    float h1      = ventHash(nb + uSeed);
    float h2      = ventHash(nb + uSeed + 17.0);
    float h3      = ventHash(nb + uSeed + 31.0);

    // ~20% of cells are active vents (scaled by activity)
    if(h1 > activity * 0.20) continue;

    // Vent center offset within cell: biased away from cell edges
    vec3  offset  = vec3(h1, h2, h3) * 0.6 + 0.2;
    float dist    = length(ventFract - offset);
    nearestDist   = min(nearestDist, dist);

    // Per-vent pulse: each vent has its own period (3–9 s) and phase offset
    float period  = 3.0 + h2 * 6.0;
    float phase   = h3 * 6.2832;
    float pulse   = 0.55 + 0.45 * sin(uTime / period + phase);

    // Frost halo: circular bright patch centered on vent
    float haloR   = 0.22 + h2 * 0.14;    // halo radius in cell units
    float halo    = smoothstep(haloR, haloR * 0.30, dist) * pulse;
    totalHalo    += halo;

    // Radial frost streaks: elongated in random directions away from vent
    // Computed by projecting the offset vector into two tangent directions
    // and checking alignment.
    vec3  toFrag  = ventFract - offset;
    float streakR = 0.45 + h1 * 0.30;   // streak reach
    float dPerp   = abs(toFrag.x * h2 - toFrag.y * h1);  // perpendicular distance proxy
    float dPar    = length(toFrag);
    float streak  = smoothstep(streakR, streakR * 0.25, dPar)
                  * smoothstep(0.05, 0.0, dPerp * 2.5)
                  * pulse * 0.50;
    totalStreak  += streak;
  }

  totalHalo   = clamp(totalHalo,  0.0, 1.0);
  totalStreak = clamp(totalStreak, 0.0, 1.0);

  // Frost halo color: bright crystalline white-blue, sun-lit
  vec3 frostWhite = vec3(0.88, 0.93, 1.00);
  vec3 frostShade = vec3(0.58, 0.68, 0.88);
  vec3 frostCol   = mix(frostShade, frostWhite, clamp(NdotL * 1.5, 0.0, 1.0));

  // Streak color: slightly yellower (sulfur/organic trace contamination)
  vec3 streakCol  = mix(frostCol, vec3(0.92, 0.90, 0.78), 0.22);

  color = mix(color, frostCol,  totalHalo   * activity * 0.72);
  color = mix(color, streakCol, totalStreak * activity * 0.38);

  // Limb-enhanced plume column: near the terminator, cryovolcanic outgassing
  // creates a visible icy column against space. Approximate by brightening
  // toward the grazing-angle terminator strip where NdotL is near zero.
  float terminatorZone = smoothstep(0.25, 0.0, abs(NdotL));
  float plumeColumn    = terminatorZone * nearestDist < 0.30
                       ? smoothstep(0.30, 0.08, nearestDist) * 0.35
                       : 0.0;
  color = mix(color, frostWhite * 1.15, plumeColumn * activity * terminatorZone);
}
`;
