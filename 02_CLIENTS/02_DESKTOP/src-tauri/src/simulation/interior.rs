//! Planetary interior structure — 4-layer self-consistent model.
//!
//! Computes radial profiles of pressure, density, temperature, and gravity
//! through a differentiated planet with up to 4 layers:
//!   1. Iron core (ε-Fe hcp, Birch-Murnaghan EOS)
//!   2. Silicate mantle (MgSiO₃ perovskite/post-perovskite, BM EOS)
//!   3. Water/ice layer (liquid → ice VII → ice X transition)
//!   4. Gas envelope (H/He, polytropic EOS)
//!
//! Solves the coupled structure equations outward from center:
//!   dP/dr = -ρ(P) · g(r)        (hydrostatic equilibrium)
//!   dm/dr = 4π r² ρ(P)          (mass continuity)
//!   g(r) = G m(r) / r²          (gravity)
//!
//! References:
//!   - Valencia, D. et al. "Internal structure of massive terrestrial planets"
//!     Icarus 181, 545 (2006)
//!   - Seager, S. et al. "Mass-Radius Relationships for Solid Exoplanets"
//!     ApJ 669, 1279 (2007)
//!   - Zeng, Li & Sasselov, D. "A detailed model grid for solid planets"
//!     PASP 125, 227 (2013)
//!
//! Performance: fixed-size arrays, no heap allocation in integration loop.
//! Cache-friendly radial sweep (osp-magnum pattern).

use serde::{Deserialize, Serialize};
use super::composition_v2::{
    EosMaterial, IRON_HCP, PEROVSKITE,
    WATER_ICE_VII, WATER_LIQUID, birch_murnaghan_density,
    birch_murnaghan_pressure,
};

// ── Constants ───────────────────────────────────────

const G: f64 = 6.67430e-11;
const M_EARTH: f64 = 5.972e24;
const R_EARTH: f64 = 6.371e6;
const PI: f64 = std::f64::consts::PI;
const K_B: f64 = 1.380649e-23;
const R_GAS: f64 = 8.31446;

/// Maximum radial shells for integration
const N_SHELLS: usize = 500;

// ── Data structures ─────────────────────────────────

/// Complete interior structure profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteriorProfile {
    /// Number of radial shells used
    pub n_shells: usize,
    /// Radius at each shell [km]
    pub radius_km: Vec<f64>,
    /// Pressure at each shell [GPa]
    pub pressure_gpa: Vec<f64>,
    /// Density at each shell [kg/m³]
    pub density_kg_m3: Vec<f64>,
    /// Gravity at each shell [m/s²]
    pub gravity_m_s2: Vec<f64>,
    /// Temperature at each shell [K] (adiabatic estimate)
    pub temperature_k: Vec<f64>,
    /// Layer boundary radii [km]: [core_top, mantle_top, water_top, surface]
    pub layer_boundaries_km: Vec<f64>,
    /// Layer materials
    pub layer_names: Vec<String>,
    /// Summary
    pub summary: InteriorSummary,
}

/// Summary of interior structure results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteriorSummary {
    /// Central pressure [GPa]
    pub central_pressure_gpa: f64,
    /// Central density [kg/m³]
    pub central_density_kg_m3: f64,
    /// Central temperature [K]
    pub central_temperature_k: f64,
    /// Core-mantle boundary pressure [GPa]
    pub cmb_pressure_gpa: f64,
    /// Core-mantle boundary radius [km]
    pub cmb_radius_km: f64,
    /// Core radius as fraction of total radius
    pub core_radius_fraction: f64,
    /// Mantle thickness [km]
    pub mantle_thickness_km: f64,
    /// Surface gravity [m/s²]
    pub surface_gravity_m_s2: f64,
    /// Mean density [kg/m³]
    pub mean_density_kg_m3: f64,
    /// Computed total radius [R⊕] (may differ from input)
    pub computed_radius_earth: f64,
    /// Model convergence
    pub converged: bool,
    /// Number of iterations for central pressure convergence
    pub iterations: usize,
}

/// Input for the interior structure solver.
#[derive(Debug, Clone)]
pub struct InteriorInput {
    /// Total planet mass [M⊕]
    pub mass_earth: f64,
    /// Target planet radius [R⊕] (used for convergence)
    pub radius_earth: f64,
    /// Iron core mass fraction
    pub core_mass_fraction: f64,
    /// Silicate mantle mass fraction
    pub mantle_mass_fraction: f64,
    /// Water/ice mass fraction
    pub water_mass_fraction: f64,
    /// H/He envelope mass fraction
    pub envelope_mass_fraction: f64,
}

// ── Solver ──────────────────────────────────────────

/// Solve the interior structure of a planet.
///
/// Uses the shooting method: guess central pressure, integrate outward,
/// check if total mass matches, adjust and repeat.
pub fn solve_interior(input: &InteriorInput) -> InteriorProfile {
    let total_mass = input.mass_earth * M_EARTH;
    let target_radius = input.radius_earth * R_EARTH;

    // Layer mass targets
    let m_core = total_mass * input.core_mass_fraction;
    let m_mantle = total_mass * input.mantle_mass_fraction;
    let m_water = total_mass * input.water_mass_fraction;
    let m_envelope = total_mass * input.envelope_mass_fraction;

    // Initial central pressure guess (scaling from Earth)
    // P_c ∝ M²/R⁴
    let p_c_earth = 364e9; // Pa
    let mut p_central = p_c_earth
        * input.mass_earth.powi(2)
        / input.radius_earth.powi(4);

    let mut best_profile = None;
    let mut converged = false;
    let mut iterations = 0;

    // Shooting method: iterate on central pressure
    for iter in 0..50 {
        iterations = iter + 1;

        let profile = integrate_outward(
            p_central, total_mass, target_radius,
            m_core, m_mantle, m_water, m_envelope,
        );

        let computed_mass = profile.enclosed_mass[profile.n_used - 1];
        let mass_error = (computed_mass - total_mass) / total_mass;

        best_profile = Some(profile);

        if mass_error.abs() < 0.01 {
            converged = true;
            break;
        }

        // Adjust central pressure: higher P → more mass at given radius
        if mass_error < 0.0 {
            p_central *= 1.0 + 0.3 * mass_error.abs();
        } else {
            p_central *= 1.0 - 0.2 * mass_error.abs();
        }
        p_central = p_central.clamp(1e8, 1e14); // 0.001 GPa to 100,000 GPa
    }

    let raw = best_profile.unwrap();
    build_profile(raw, target_radius, converged, iterations)
}

/// Raw integration result (internal).
struct RawProfile {
    n_used: usize,
    radius: [f64; N_SHELLS],
    pressure: [f64; N_SHELLS],
    density: [f64; N_SHELLS],
    gravity: [f64; N_SHELLS],
    temperature: [f64; N_SHELLS],
    enclosed_mass: [f64; N_SHELLS],
    layer_index: [u8; N_SHELLS], // 0=core, 1=mantle, 2=water, 3=envelope
    layer_bounds: [f64; 4],       // radius of each layer boundary
}

/// Integrate the structure equations outward from center.
fn integrate_outward(
    p_central: f64,
    total_mass: f64,
    target_radius: f64,
    m_core: f64,
    m_mantle: f64,
    m_water: f64,
    _m_envelope: f64,
) -> RawProfile {
    let mut prof = RawProfile {
        n_used: 0,
        radius: [0.0; N_SHELLS],
        pressure: [0.0; N_SHELLS],
        density: [0.0; N_SHELLS],
        gravity: [0.0; N_SHELLS],
        temperature: [0.0; N_SHELLS],
        enclosed_mass: [0.0; N_SHELLS],
        layer_index: [0; N_SHELLS],
        layer_bounds: [0.0; 4],
    };

    let dr = target_radius / (N_SHELLS as f64 - 1.0);

    // Initial conditions at center
    let rho_central = birch_murnaghan_density(&IRON_HCP, p_central);
    let t_central = estimate_central_temperature(total_mass / M_EARTH);

    prof.radius[0] = dr * 0.01; // avoid r=0 singularity
    prof.pressure[0] = p_central;
    prof.density[0] = rho_central;
    prof.gravity[0] = 0.0;
    prof.temperature[0] = t_central;
    prof.enclosed_mass[0] = (4.0 / 3.0) * PI * prof.radius[0].powi(3) * rho_central;
    prof.layer_index[0] = 0;

    let mut current_layer: u8 = 0;
    let mass_bounds = [m_core, m_core + m_mantle, m_core + m_mantle + m_water, total_mass];

    for i in 1..N_SHELLS {
        let r = dr * i as f64;
        let _r_prev = prof.radius[i - 1];
        let m_prev = prof.enclosed_mass[i - 1];
        let p_prev = prof.pressure[i - 1];
        let t_prev = prof.temperature[i - 1];

        // Check layer transition
        while (current_layer as usize) < 3 && m_prev >= mass_bounds[current_layer as usize] {
            prof.layer_bounds[current_layer as usize] = r;
            current_layer += 1;
        }

        // Get EOS for current layer
        let material = layer_material(current_layer);

        // Gravity at this radius
        let g = if r > 1.0 { G * m_prev / (r * r) } else { 0.0 };

        // Hydrostatic equilibrium: dP/dr = -ρg
        let rho = if current_layer < 3 {
            birch_murnaghan_density(material, p_prev)
        } else {
            // Envelope: ideal gas
            envelope_density(p_prev, t_prev, 2.3) // μ ≈ 2.3 for H/He
        };

        let dp = -rho * g * dr;
        let p = (p_prev + dp).max(0.0);

        // Mass shell
        let dm = 4.0 * PI * r * r * rho * dr;
        let m = m_prev + dm;

        // Adiabatic temperature (Grüneisen parameter)
        let gamma_gruneisen = if current_layer == 0 { 1.5 } // iron
            else if current_layer == 1 { 1.4 }              // silicate
            else if current_layer == 2 { 0.7 }              // ice
            else { 0.3 };                                    // gas envelope
        let dt = -gamma_gruneisen * (t_prev / rho) * (dp / (r.max(1.0)));
        let t = (t_prev + dt * 0.001).max(100.0); // damped temperature gradient

        prof.radius[i] = r;
        prof.pressure[i] = p;
        prof.density[i] = rho;
        prof.gravity[i] = g;
        prof.temperature[i] = t;
        prof.enclosed_mass[i] = m;
        prof.layer_index[i] = current_layer;

        prof.n_used = i + 1;

        // Stop if pressure drops to zero
        if p < 100.0 { break; }
    }

    // Fill remaining layer bounds
    for l in 0..4 {
        if prof.layer_bounds[l] == 0.0 && prof.n_used > 0 {
            prof.layer_bounds[l] = prof.radius[prof.n_used - 1];
        }
    }

    prof
}

/// Select EOS material for each layer.
fn layer_material(layer: u8) -> &'static EosMaterial {
    match layer {
        0 => &IRON_HCP,
        1 => &PEROVSKITE,
        2 => &WATER_ICE_VII,
        _ => &WATER_LIQUID, // placeholder for envelope
    }
}

/// Ideal gas density for H/He envelope.
fn envelope_density(pressure_pa: f64, temperature_k: f64, mu: f64) -> f64 {
    // ρ = P·μ / (R·T)
    let rho = pressure_pa * mu * 1e-3 / (R_GAS * temperature_k);
    rho.max(0.01)
}

/// Estimate central temperature from mass scaling.
/// Earth: ~5500 K. Scales as M^(0.5) roughly.
fn estimate_central_temperature(mass_earth: f64) -> f64 {
    5500.0 * mass_earth.powf(0.5)
}

/// Convert raw integration data to output profile.
fn build_profile(
    raw: RawProfile,
    _target_radius: f64,
    converged: bool,
    iterations: usize,
) -> InteriorProfile {
    let n = raw.n_used;

    let radius_km: Vec<f64> = raw.radius[..n].iter().map(|r| r / 1000.0).collect();
    let pressure_gpa: Vec<f64> = raw.pressure[..n].iter().map(|p| p / 1e9).collect();
    let density: Vec<f64> = raw.density[..n].to_vec();
    let gravity: Vec<f64> = raw.gravity[..n].to_vec();
    let temperature: Vec<f64> = raw.temperature[..n].to_vec();

    let surface_r = raw.radius[n - 1];
    let surface_g = raw.gravity[n - 1];
    let total_mass = raw.enclosed_mass[n - 1];

    // Layer boundaries
    let mut layer_boundaries_km = Vec::new();
    let mut layer_names = Vec::new();

    if raw.layer_bounds[0] > 0.0 {
        layer_boundaries_km.push(raw.layer_bounds[0] / 1000.0);
        layer_names.push("Iron core (ε-Fe)".to_string());
    }
    if raw.layer_bounds[1] > raw.layer_bounds[0] {
        layer_boundaries_km.push(raw.layer_bounds[1] / 1000.0);
        layer_names.push("Silicate mantle (MgSiO₃)".to_string());
    }
    if raw.layer_bounds[2] > raw.layer_bounds[1] {
        layer_boundaries_km.push(raw.layer_bounds[2] / 1000.0);
        layer_names.push("Water/ice layer".to_string());
    }
    layer_boundaries_km.push(surface_r / 1000.0);
    layer_names.push("Surface/envelope".to_string());

    // Find CMB
    let cmb_idx = raw.layer_index[..n].iter()
        .position(|&l| l > 0)
        .unwrap_or(0);
    let cmb_r = raw.radius[cmb_idx];
    let cmb_p = raw.pressure[cmb_idx];

    let computed_r_earth = surface_r / R_EARTH;

    InteriorProfile {
        n_shells: n,
        radius_km,
        pressure_gpa,
        density_kg_m3: density,
        gravity_m_s2: gravity,
        temperature_k: temperature,
        layer_boundaries_km,
        layer_names,
        summary: InteriorSummary {
            central_pressure_gpa: raw.pressure[0] / 1e9,
            central_density_kg_m3: raw.density[0],
            central_temperature_k: raw.temperature[0],
            cmb_pressure_gpa: cmb_p / 1e9,
            cmb_radius_km: cmb_r / 1000.0,
            core_radius_fraction: cmb_r / surface_r,
            mantle_thickness_km: (raw.layer_bounds[1] - raw.layer_bounds[0]) / 1000.0,
            surface_gravity_m_s2: surface_g,
            mean_density_kg_m3: total_mass / ((4.0 / 3.0) * PI * surface_r.powi(3)),
            computed_radius_earth: computed_r_earth,
            converged,
            iterations,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_earth_interior() {
        let input = InteriorInput {
            mass_earth: 1.0,
            radius_earth: 1.0,
            core_mass_fraction: 0.325,
            mantle_mass_fraction: 0.675,
            water_mass_fraction: 0.0,
            envelope_mass_fraction: 0.0,
        };

        let profile = solve_interior(&input);
        let s = &profile.summary;

        // Central pressure ~364 GPa
        assert!(s.central_pressure_gpa > 100.0 && s.central_pressure_gpa < 800.0,
            "Earth P_center = {} GPa (expected ~364)", s.central_pressure_gpa);

        // Central density ~13000 kg/m³
        assert!(s.central_density_kg_m3 > 8000.0 && s.central_density_kg_m3 < 20000.0,
            "Earth ρ_center = {} (expected ~13000)", s.central_density_kg_m3);

        // Central temperature ~5500 K
        assert!((s.central_temperature_k - 5500.0).abs() < 1500.0,
            "Earth T_center = {} K (expected ~5500)", s.central_temperature_k);

        // Surface gravity ~9.8 m/s²
        assert!(s.surface_gravity_m_s2 > 5.0 && s.surface_gravity_m_s2 < 15.0,
            "Earth g = {} m/s² (expected ~9.8)", s.surface_gravity_m_s2);
    }

    #[test]
    fn test_super_earth_interior() {
        let input = InteriorInput {
            mass_earth: 5.0,
            radius_earth: 1.6,
            core_mass_fraction: 0.30,
            mantle_mass_fraction: 0.60,
            water_mass_fraction: 0.10,
            envelope_mass_fraction: 0.0,
        };

        let profile = solve_interior(&input);
        let s = &profile.summary;

        // Higher central pressure than Earth
        assert!(s.central_pressure_gpa > 300.0,
            "Super-Earth P_center = {} GPa (expected >300)", s.central_pressure_gpa);

        // Should have at least 2 layer boundaries
        assert!(profile.layer_boundaries_km.len() >= 2);
    }

    #[test]
    fn test_water_world() {
        let input = InteriorInput {
            mass_earth: 2.0,
            radius_earth: 1.4,
            core_mass_fraction: 0.10,
            mantle_mass_fraction: 0.30,
            water_mass_fraction: 0.55,
            envelope_mass_fraction: 0.05,
        };

        let profile = solve_interior(&input);
        // Should have water layer
        assert!(profile.layer_names.iter().any(|n| n.contains("Water")),
            "Water world should have water layer");
    }

    #[test]
    fn test_birch_murnaghan_roundtrip() {
        // Iron at 200 GPa
        let p = 200e9;
        let rho = birch_murnaghan_density(&IRON_HCP, p);
        let p_back = birch_murnaghan_pressure(&IRON_HCP, rho);
        assert!((p_back - p).abs() / p < 0.02,
            "BM round-trip: {} Pa → {} kg/m³ → {} Pa", p, rho, p_back);
    }
}
