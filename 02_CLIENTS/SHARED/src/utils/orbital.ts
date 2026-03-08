/**
 * Orbital mechanics utilities.
 *
 * Standard Keplerian calculations used across all clients
 * for orbit rendering, period computation, and zone estimation.
 */

import { G, M_SUN_KG, M_EARTH_KG, AU_TO_M, YEAR_SECONDS, DAY_SECONDS } from '../constants/physics';

/**
 * Solve Kepler's equation M = E - e*sin(E) via Newton-Raphson.
 * @param M — mean anomaly (radians)
 * @param e — eccentricity (0 ≤ e < 1)
 * @param maxIter — iteration limit
 * @returns E — eccentric anomaly (radians)
 */
export function solveKepler(M: number, e: number, maxIter = 30): number {
  let E = M; // initial guess
  for (let i = 0; i < maxIter; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Eccentric anomaly → true anomaly
 */
export function eccentricToTrue(E: number, e: number): number {
  return 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  );
}

/**
 * Mean anomaly at time t for a given period
 * @param t — elapsed time (same units as period)
 * @param period — orbital period
 * @param M0 — mean anomaly at epoch (default 0)
 */
export function meanAnomaly(t: number, period: number, M0 = 0): number {
  return (M0 + 2 * Math.PI * (t / period)) % (2 * Math.PI);
}

/**
 * Orbital position in the orbital plane (2D)
 * @param a — semi-major axis (any unit)
 * @param e — eccentricity
 * @param trueAnomaly — true anomaly (radians)
 * @returns [x, y] in orbital plane
 */
export function orbitalPosition(a: number, e: number, trueAnomaly: number): [number, number] {
  const r = a * (1 - e * e) / (1 + e * Math.cos(trueAnomaly));
  return [r * Math.cos(trueAnomaly), r * Math.sin(trueAnomaly)];
}

/**
 * Kepler's third law: period (days) from semi-major axis (AU) and stellar mass (solar).
 */
export function periodFromSMA(sma_au: number, mStar_solar = 1.0): number {
  const a_m = sma_au * AU_TO_M;
  const M = mStar_solar * M_SUN_KG;
  const T_seconds = 2 * Math.PI * Math.sqrt(a_m ** 3 / (G * M));
  return T_seconds / DAY_SECONDS;
}

/**
 * Kepler's third law: semi-major axis (AU) from period (days) and stellar mass (solar).
 */
export function smaFromPeriod(period_days: number, mStar_solar = 1.0): number {
  const T_seconds = period_days * DAY_SECONDS;
  const M = mStar_solar * M_SUN_KG;
  const a_m = Math.pow((G * M * T_seconds ** 2) / (4 * Math.PI ** 2), 1 / 3);
  return a_m / AU_TO_M;
}

/**
 * Hill sphere radius (AU).
 */
export function hillSphere(a_au: number, m_planet_earth: number, m_star_solar: number): number {
  const massRatio = (m_planet_earth * M_EARTH_KG) / (m_star_solar * M_SUN_KG);
  return a_au * Math.pow(massRatio / 3, 1 / 3);
}

/**
 * Roche limit (in planet radii) — rigid body approximation.
 */
export function rocheLimit(density_primary: number, density_secondary: number): number {
  return 2.44 * Math.pow(density_primary / density_secondary, 1 / 3);
}

/**
 * Orbital velocity (km/s) at a given distance from a star.
 */
export function orbitalVelocity(distance_au: number, mStar_solar = 1.0): number {
  const r_m = distance_au * AU_TO_M;
  const M = mStar_solar * M_SUN_KG;
  return Math.sqrt(G * M / r_m) / 1000; // m/s → km/s
}

/**
 * Escape velocity (km/s) from a body's surface.
 * @param mass_kg — mass in kg
 * @param radius_m — radius in meters
 */
export function escapeVelocity(mass_kg: number, radius_m: number): number {
  return Math.sqrt(2 * G * mass_kg / radius_m) / 1000;
}

/**
 * Generate ellipse points for rendering an orbit ring.
 * @param a — semi-major axis
 * @param e — eccentricity
 * @param segments — number of line segments
 * @returns Array of [x, y] pairs in the orbital plane
 */
export function ellipsePoints(a: number, e: number, segments = 128): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const r = a * (1 - e * e) / (1 + e * Math.cos(theta));
    points.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  return points;
}
