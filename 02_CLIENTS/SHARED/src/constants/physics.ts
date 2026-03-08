/**
 * Physical constants and unit conversions for astronomical calculations.
 *
 * All values in SI unless otherwise noted.
 * Sources: IAU 2015 resolutions, NIST 2018 CODATA.
 */

/* ── Distance ──────────────────────────────────────── */
export const PC_TO_LY         = 3.26156;                   // 1 parsec = 3.26156 light-years
export const LY_TO_PC         = 1 / PC_TO_LY;
export const AU_TO_KM         = 1.495978707e8;             // 1 AU in km
export const AU_TO_M          = 1.495978707e11;            // 1 AU in meters
export const PC_TO_AU         = 206264.806;                // 1 parsec in AU
export const LY_TO_KM         = 9.4607304725808e12;        // 1 light-year in km

/* ── Mass ──────────────────────────────────────────── */
export const M_SUN_KG         = 1.98892e30;                // solar mass
export const M_EARTH_KG       = 5.97237e24;                // Earth mass
export const M_JUPITER_KG     = 1.89813e27;                // Jupiter mass
export const M_SUN_EARTH      = M_SUN_KG / M_EARTH_KG;    // Sun in Earth masses
export const M_JUPITER_EARTH  = M_JUPITER_KG / M_EARTH_KG; // Jupiter in Earth masses

/* ── Radius ────────────────────────────────────────── */
export const R_SUN_KM         = 695700;                    // solar radius in km
export const R_EARTH_KM       = 6371;                      // Earth mean radius
export const R_JUPITER_KM     = 69911;                     // Jupiter mean radius

/* ── Luminosity & Temperature ──────────────────────── */
export const L_SUN_W          = 3.828e26;                  // solar luminosity in Watts
export const T_SUN_K          = 5778;                      // solar effective temperature
export const STEFAN_BOLTZMANN = 5.670374419e-8;            // W⋅m⁻²⋅K⁻⁴

/* ── Gravity ───────────────────────────────────────── */
export const G                = 6.67430e-11;               // gravitational constant (m³⋅kg⁻¹⋅s⁻²)
export const G_EARTH_MS2      = 9.80665;                   // standard gravity

/* ── Time ──────────────────────────────────────────── */
export const YEAR_SECONDS     = 365.25 * 24 * 3600;       // Julian year
export const DAY_SECONDS      = 86400;

/* ── Atmosphere ────────────────────────────────────── */
export const K_BOLTZMANN      = 1.380649e-23;              // Boltzmann constant (J⋅K⁻¹)
export const AMU_KG           = 1.66053906660e-27;         // atomic mass unit

/* ── Useful derived functions ──────────────────────── */

/** Convert parsecs to light-years */
export function pcToLy(pc: number): number { return pc * PC_TO_LY; }

/** Convert light-years to parsecs */
export function lyToPc(ly: number): number { return ly * LY_TO_PC; }

/** Equilibrium temperature (K) from stellar luminosity and distance */
export function equilibriumTemp(luminosity_solar: number, distance_au: number, albedo = 0.3): number {
  const flux = luminosity_solar * L_SUN_W / (4 * Math.PI * (distance_au * AU_TO_M) ** 2);
  return Math.pow((flux * (1 - albedo)) / (4 * STEFAN_BOLTZMANN), 0.25);
}

/** Atmospheric scale height (m) from temperature, mean molecular weight, surface gravity */
export function scaleHeight(temp_k: number, mu_amu: number, g_ms2: number): number {
  return (K_BOLTZMANN * temp_k) / (mu_amu * AMU_KG * g_ms2);
}

/** Surface gravity (m/s²) from mass (Earth masses) and radius (Earth radii) */
export function surfaceGravity(mass_earth: number, radius_earth: number): number {
  return G_EARTH_MS2 * mass_earth / (radius_earth * radius_earth);
}

/** Hill sphere radius (AU) for planet around star  */
export function hillSphere(a_au: number, m_planet_earth: number, m_star_solar: number): number {
  const massRatio = (m_planet_earth * M_EARTH_KG) / (m_star_solar * M_SUN_KG);
  return a_au * Math.pow(massRatio / 3, 1 / 3);
}

/** Roche limit (radii) — rigid body approximation */
export function rocheLimit(densityPrimary: number, densitySecondary: number): number {
  return 2.44 * Math.pow(densityPrimary / densitySecondary, 1 / 3);
}

/** Habitable zone inner/outer edges (AU) from luminosity (solar units) */
export function habitableZone(luminosity_solar: number): { inner_au: number; outer_au: number } {
  // Conservative HZ (Kopparapu et al. 2013)
  return {
    inner_au: Math.sqrt(luminosity_solar / 1.107),
    outer_au: Math.sqrt(luminosity_solar / 0.356),
  };
}
