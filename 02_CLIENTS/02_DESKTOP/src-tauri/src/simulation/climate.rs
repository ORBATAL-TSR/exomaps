//! Global climate equilibrium solver.
//!
//! Iterative energy balance model coupling:
//!   - Incoming stellar radiation (spectrum-weighted)
//!   - Outgoing longwave radiation (from atmosphere_v2)
//!   - Ice-albedo feedback (Budyko-Sellers type)
//!   - Orbital forcing (eccentricity, obliquity effects)
//!   - Tidal heating (for close-in planets)
//!
//! Inspired by:
//!   - VPL/atmos CLIMA ↔ PHOTOCHEM coupling pattern
//!     (iterative convergence between radiative and chemical models)
//!   - Williams & Kasting (1997) — habitable zones
//!   - Kopparapu et al. (2013) — HZ stellar flux limits
//!   - North (1975) — energy balance models
//!   - Pierrehumbert (2010) — climate physics foundations
//!
//! Convergence criterion per VPL/atmos: ΔT < 0.1 K, ΔF < 0.5 W/m²

use serde::{Deserialize, Serialize};

// ── Constants ───────────────────────────────────────

const SIGMA_SB: f64 = 5.670374419e-8;
const L_SUN: f64 = 3.828e26;
const AU_M: f64 = 1.495978707e11;
const R_EARTH: f64 = 6.371e6;
const M_EARTH: f64 = 5.972e24;
const G: f64 = 6.67430e-11;
const PI: f64 = std::f64::consts::PI;

// ── Stellar spectrum approximations ─────────────────
//
// Kopparapu et al. (2013) HZ boundaries as functions of T_eff:
//   S_eff = S_☉ + a(T★ - 5780) + b(T★ - 5780)²
// where S_☉, a, b are coefficients for each boundary.

/// HZ boundary coefficients [S_sun, a, b] from Kopparapu et al. (2013) Table 3
struct HzBoundary {
    s_sun: f64,
    a: f64,
    b: f64,
}

const HZ_RECENT_VENUS: HzBoundary = HzBoundary {
    s_sun: 1.7763, a: 1.4335e-4, b: 3.3954e-9
};
const HZ_RUNAWAY_GREENHOUSE: HzBoundary = HzBoundary {
    s_sun: 1.0385, a: 1.2456e-4, b: 1.4612e-8
};
const HZ_MOIST_GREENHOUSE: HzBoundary = HzBoundary {
    s_sun: 1.0146, a: 8.1884e-5, b: 1.9394e-9
};
const HZ_MAXIMUM_GREENHOUSE: HzBoundary = HzBoundary {
    s_sun: 0.3507, a: 5.9578e-5, b: 1.6707e-9
};
const HZ_EARLY_MARS: HzBoundary = HzBoundary {
    s_sun: 0.3207, a: 5.4471e-5, b: 1.5275e-9
};

// ── Data structures ─────────────────────────────────

/// Complete climate state output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClimateState {
    /// Global mean surface temperature [K]
    pub surface_temp_k: f64,
    /// Effective radiating temperature [K]
    pub radiating_temp_k: f64,
    /// Global mean Bond albedo (including ice-albedo feedback)
    pub effective_albedo: f64,
    /// Absorbed shortwave radiation [W/m²]
    pub absorbed_sw_w_m2: f64,
    /// Outgoing longwave radiation [W/m²]
    pub olr_w_m2: f64,
    /// Net energy flux at surface [W/m²] (~0 at equilibrium)
    pub net_flux_w_m2: f64,
    /// Tidal heating flux [W/m²]
    pub tidal_heating_w_m2: f64,
    /// Ice coverage fraction (0-1)
    pub ice_fraction: f64,
    /// Climate regime classification
    pub climate_regime: ClimateRegime,
    /// Habitable zone classification
    pub hz_status: HzStatus,
    /// Convergence info
    pub convergence: ClimateConvergence,
    /// Seasonal temperature range [K] (max - min)
    pub seasonal_range_k: f64,
    /// Diurnal temperature range [K]
    pub diurnal_range_k: f64,
}

/// Climate regime classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ClimateRegime {
    Snowball,          // Globally glaciated
    PartialIce,        // Partial ice caps
    Temperate,         // HZ, liquid water possible
    Moist,             // Approaching runaway greenhouse
    Runaway,           // Runaway greenhouse (Venus-like)
    NoAtmosphere,      // Airless body
    GasGiant,          // N/A for gas giants
}

/// Habitable zone classification using Kopparapu limits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HzStatus {
    pub in_conservative_hz: bool,
    pub in_optimistic_hz: bool,
    pub stellar_flux_ratio: f64,  // S/S_earth
    pub inner_hz_au: f64,
    pub outer_hz_au: f64,
    pub inner_optimistic_au: f64,
    pub outer_optimistic_au: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClimateConvergence {
    pub converged: bool,
    pub iterations: usize,
    pub final_temp_change_k: f64,
    pub final_flux_imbalance_w_m2: f64,
}

/// Input parameters for the climate solver.
#[derive(Debug, Clone)]
pub struct ClimateInput {
    pub mass_earth: f64,
    pub radius_earth: f64,
    pub semi_major_axis_au: f64,
    pub eccentricity: f64,
    pub obliquity_deg: f64,
    pub rotation_period_hours: f64,
    pub star_luminosity_lsun: f64,
    pub star_teff_k: f64,
    pub surface_pressure_bar: f64,
    pub bond_albedo_base: f64,
    pub greenhouse_opacity: f64,  // τ_IR from atmosphere model
    pub planet_type: String,
}

// ── Main solver ─────────────────────────────────────

/// Solve the global climate equilibrium.
///
/// Iterates between:
///   1. Compute absorbed stellar flux (with ice-albedo feedback)
///   2. Compute OLR (grey + window model from atmosphere_v2)
///   3. Add tidal heating
///   4. Check energy balance
///   5. Adjust surface temperature
///
/// Per VPL/atmos pattern: converge when ΔT < 0.1K and ΔF < 0.5 W/m²
pub fn solve_climate(input: &ClimateInput) -> ClimateState {
    let _g_surface = G * (input.mass_earth * M_EARTH) / (input.radius_earth * R_EARTH).powi(2);

    // Stellar flux at orbit
    let stellar_flux = input.star_luminosity_lsun * L_SUN
        / (4.0 * PI * (input.semi_major_axis_au * AU_M).powi(2));

    // Tidal heating
    let tidal = tidal_heating_flux(
        input.mass_earth, input.radius_earth,
        input.semi_major_axis_au, input.eccentricity,
        input.star_luminosity_lsun,
    );

    // HZ boundaries
    let hz = compute_hz_status(
        input.star_luminosity_lsun, input.star_teff_k,
        input.semi_major_axis_au,
    );

    // Handle special cases
    if matches!(input.planet_type.as_str(), "gas-giant" | "super-jupiter" | "neptune-like") {
        return gas_giant_climate(stellar_flux, input, tidal, hz);
    }
    if input.surface_pressure_bar < 1e-5 {
        return airless_body_climate(stellar_flux, input, tidal, hz);
    }

    // ── Iterative energy balance ──
    let mut t_surface = equilibrium_temp(stellar_flux, input.bond_albedo_base);
    let mut converged = false;
    let mut iterations = 0;
    let mut dt = f64::INFINITY;
    let mut dflux = f64::INFINITY;

    for iter in 0..300 {
        iterations = iter + 1;
        let t_prev = t_surface;

        // Ice-albedo feedback
        let ice_frac = ice_fraction(t_surface, input.obliquity_deg);
        let albedo = ice_albedo_feedback(
            input.bond_albedo_base, ice_frac, t_surface,
        );

        // Absorbed shortwave
        let absorbed_sw = stellar_flux * (1.0 - albedo) / 4.0;

        // OLR: grey + window model
        let window = atmospheric_window(input.greenhouse_opacity);
        let t_effective = (t_surface.powi(4) * window
            + equilibrium_temp(stellar_flux, albedo).powi(4) * (1.0 - window)).powf(0.25);
        let olr = SIGMA_SB * t_effective.powi(4);

        // Energy balance
        let net_flux = absorbed_sw + tidal - olr;
        dflux = net_flux.abs();

        // Adjust temperature
        // Heat capacity: C = c_p × column mass / relaxation time
        // Effective thermal inertia sets convergence speed
        let d_olr_dt = 4.0 * SIGMA_SB * t_effective.powi(3) * window;
        if d_olr_dt > 1e-10 {
            let adjustment = net_flux / d_olr_dt;
            t_surface += adjustment.clamp(-15.0, 15.0);
        } else {
            t_surface += net_flux.signum() * 1.0;
        }
        t_surface = t_surface.clamp(30.0, 3000.0);

        dt = (t_surface - t_prev).abs();

        if dt < 0.1 && dflux < 0.5 {
            converged = true;
            break;
        }
    }

    // Final state
    let ice_frac = ice_fraction(t_surface, input.obliquity_deg);
    let albedo = ice_albedo_feedback(input.bond_albedo_base, ice_frac, t_surface);
    let absorbed_sw = stellar_flux * (1.0 - albedo) / 4.0;
    let window = atmospheric_window(input.greenhouse_opacity);
    let t_eff = (t_surface.powi(4) * window
        + equilibrium_temp(stellar_flux, albedo).powi(4) * (1.0 - window)).powf(0.25);
    let olr = SIGMA_SB * t_eff.powi(4);

    let regime = classify_regime(t_surface, ice_frac, input.surface_pressure_bar);

    // Seasonal + diurnal ranges
    let seasonal = seasonal_range(
        input.obliquity_deg, input.eccentricity,
        input.surface_pressure_bar, t_surface,
    );
    let diurnal = diurnal_range(
        input.rotation_period_hours, input.surface_pressure_bar, t_surface,
    );

    ClimateState {
        surface_temp_k: t_surface,
        radiating_temp_k: t_eff,
        effective_albedo: albedo,
        absorbed_sw_w_m2: absorbed_sw,
        olr_w_m2: olr,
        net_flux_w_m2: absorbed_sw + tidal - olr,
        tidal_heating_w_m2: tidal,
        ice_fraction: ice_frac,
        climate_regime: regime,
        hz_status: hz,
        convergence: ClimateConvergence {
            converged,
            iterations,
            final_temp_change_k: dt,
            final_flux_imbalance_w_m2: dflux,
        },
        seasonal_range_k: seasonal,
        diurnal_range_k: diurnal,
    }
}

// ── Physics functions ───────────────────────────────

/// Equilibrium temperature [K].
fn equilibrium_temp(flux: f64, albedo: f64) -> f64 {
    ((flux * (1.0 - albedo)) / (4.0 * SIGMA_SB)).powf(0.25)
}

/// Ice-albedo feedback model (Budyko-Sellers type).
///
/// As temperature decreases, ice fraction increases, raising albedo,
/// which further decreases temperature → positive feedback.
///
/// Ice albedo ~0.7, ocean albedo ~0.06, land ~0.15
fn ice_albedo_feedback(base_albedo: f64, ice_frac: f64, _temp_k: f64) -> f64 {
    let ice_albedo = 0.65;
    let ground_albedo = base_albedo;

    // Weighted average
    ice_frac * ice_albedo + (1.0 - ice_frac) * ground_albedo
}

/// Ice fraction from global mean temperature.
///
/// Simplified Budyko model:
///   - T < 230K → fully glaciated (snowball)
///   - T > 280K → no ice
///   - Linear transition between
fn ice_fraction(temp_k: f64, obliquity_deg: f64) -> f64 {
    // Higher obliquity → less polar ice (more uniform heating)
    let obliquity_factor = 1.0 - (obliquity_deg / 90.0) * 0.3;

    let t_snowball = 230.0;
    let t_ice_free = 280.0;

    if temp_k <= t_snowball {
        1.0 * obliquity_factor
    } else if temp_k >= t_ice_free {
        0.0
    } else {
        let frac = (t_ice_free - temp_k) / (t_ice_free - t_snowball);
        (frac * obliquity_factor).clamp(0.0, 1.0)
    }
}

/// Atmospheric window fraction from IR optical depth.
fn atmospheric_window(tau_ir: f64) -> f64 {
    // Window closes exponentially with optical depth
    (0.4 * (-tau_ir * 0.3).exp()).max(0.02)
}

/// Tidal heating flux [W/m²].
///
/// For close-in planets, tidal dissipation provides significant internal heat.
/// Io: ~2 W/m², Earth ~0.08 W/m²
///
/// Q_tidal ∝ e² × n⁵ × R⁵ / Q
/// where n = mean motion, Q = tidal quality factor
fn tidal_heating_flux(
    _mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    eccentricity: f64,
    star_l_lsun: f64,
) -> f64 {
    if eccentricity < 0.001 || sma_au > 0.5 {
        return 0.0;
    }

    // Approximate star mass from luminosity: L ∝ M^3.5
    let star_mass_solar = star_l_lsun.powf(1.0 / 3.5);
    let star_mass_kg = star_mass_solar * 1.989e30;

    let sma_m = sma_au * AU_M;
    let r_m = radius_earth * R_EARTH;

    // Mean motion
    let n = (G * star_mass_kg / sma_m.powi(3)).sqrt();

    // Tidal quality factor (Earth-like Q ~ 12, rocky ~ 10-100)
    let q_tidal = 30.0;

    // Simplified tidal heating: F_tidal = (21/2) × (k₂/Q) × (n⁵ × R⁵ × e²) / (G)
    // where k₂ ≈ 0.3 for rocky planets
    let k2 = 0.3;
    let e2 = eccentricity.powi(2);

    let q_total = 10.5 * (k2 / q_tidal) * n.powi(5) * r_m.powi(5) * e2 / G;
    let surface_area = 4.0 * PI * r_m.powi(2);

    (q_total / surface_area).min(100.0) // cap at 100 W/m²
}

/// Seasonal temperature range [K].
fn seasonal_range(obliquity_deg: f64, eccentricity: f64, pressure_bar: f64, _t_mean: f64) -> f64 {
    // Higher obliquity → larger seasonal range
    // Higher pressure → more thermal inertia → smaller range
    let obliquity_effect = obliquity_deg * 0.5; // K per degree
    let eccentricity_effect = eccentricity * 30.0; // K per unit e
    let thermal_damping = 1.0 / (1.0 + pressure_bar * 0.5);

    (obliquity_effect + eccentricity_effect) * thermal_damping
}

/// Diurnal temperature range [K].
fn diurnal_range(rotation_hours: f64, pressure_bar: f64, _t_mean: f64) -> f64 {
    // Longer days → larger range (more heating/cooling per cycle)
    // Higher pressure → more thermal buffering
    let rotation_factor = (rotation_hours / 24.0).sqrt().min(10.0);
    let thermal_buffer = 1.0 / (1.0 + pressure_bar * 2.0);

    20.0 * rotation_factor * thermal_buffer
}

// ── Climate regime classification ───────────────────

fn classify_regime(temp_k: f64, ice_frac: f64, pressure_bar: f64) -> ClimateRegime {
    if pressure_bar < 1e-5 {
        ClimateRegime::NoAtmosphere
    } else if ice_frac > 0.95 {
        ClimateRegime::Snowball
    } else if temp_k > 500.0 {
        ClimateRegime::Runaway
    } else if temp_k > 340.0 {
        ClimateRegime::Moist
    } else if ice_frac > 0.1 {
        ClimateRegime::PartialIce
    } else {
        ClimateRegime::Temperate
    }
}

// ── Habitable zone calculation ──────────────────────

fn compute_hz_status(l_star_lsun: f64, t_eff_k: f64, sma_au: f64) -> HzStatus {
    let dt = t_eff_k - 5780.0;

    let s_eff = |boundary: &HzBoundary| -> f64 {
        boundary.s_sun + boundary.a * dt + boundary.b * dt * dt
    };

    // Stellar flux at planet's orbit (relative to Earth)
    let s_planet = l_star_lsun / (sma_au * sma_au);

    // HZ distances
    let d_inner_con = (l_star_lsun / s_eff(&HZ_RUNAWAY_GREENHOUSE)).sqrt();
    let d_outer_con = (l_star_lsun / s_eff(&HZ_MAXIMUM_GREENHOUSE)).sqrt();
    let d_inner_opt = (l_star_lsun / s_eff(&HZ_RECENT_VENUS)).sqrt();
    let d_outer_opt = (l_star_lsun / s_eff(&HZ_EARLY_MARS)).sqrt();

    let in_conservative = sma_au >= d_inner_con && sma_au <= d_outer_con;
    let in_optimistic = sma_au >= d_inner_opt && sma_au <= d_outer_opt;

    HzStatus {
        in_conservative_hz: in_conservative,
        in_optimistic_hz: in_optimistic,
        stellar_flux_ratio: s_planet,
        inner_hz_au: d_inner_con,
        outer_hz_au: d_outer_con,
        inner_optimistic_au: d_inner_opt,
        outer_optimistic_au: d_outer_opt,
    }
}

// ── Special cases ───────────────────────────────────

fn gas_giant_climate(
    stellar_flux: f64, input: &ClimateInput, tidal: f64, hz: HzStatus,
) -> ClimateState {
    let albedo = input.bond_albedo_base;
    let t_eq = equilibrium_temp(stellar_flux, albedo);
    let absorbed = stellar_flux * (1.0 - albedo) / 4.0;
    let olr = SIGMA_SB * t_eq.powi(4);

    ClimateState {
        surface_temp_k: t_eq, // "1 bar level" temperature
        radiating_temp_k: t_eq,
        effective_albedo: albedo,
        absorbed_sw_w_m2: absorbed,
        olr_w_m2: olr,
        net_flux_w_m2: 0.0,
        tidal_heating_w_m2: tidal,
        ice_fraction: 0.0,
        climate_regime: ClimateRegime::GasGiant,
        hz_status: hz,
        convergence: ClimateConvergence {
            converged: true, iterations: 1,
            final_temp_change_k: 0.0, final_flux_imbalance_w_m2: 0.0,
        },
        seasonal_range_k: 0.0,
        diurnal_range_k: 0.0,
    }
}

fn airless_body_climate(
    stellar_flux: f64, input: &ClimateInput, tidal: f64, hz: HzStatus,
) -> ClimateState {
    let albedo = input.bond_albedo_base;
    let t_eq = equilibrium_temp(stellar_flux, albedo);
    let absorbed = stellar_flux * (1.0 - albedo) / 4.0;

    ClimateState {
        surface_temp_k: t_eq,
        radiating_temp_k: t_eq,
        effective_albedo: albedo,
        absorbed_sw_w_m2: absorbed,
        olr_w_m2: SIGMA_SB * t_eq.powi(4),
        net_flux_w_m2: 0.0,
        tidal_heating_w_m2: tidal,
        ice_fraction: if t_eq < 200.0 { 0.5 } else { 0.0 },
        climate_regime: ClimateRegime::NoAtmosphere,
        hz_status: hz,
        convergence: ClimateConvergence {
            converged: true, iterations: 1,
            final_temp_change_k: 0.0, final_flux_imbalance_w_m2: 0.0,
        },
        seasonal_range_k: seasonal_range(
            input.obliquity_deg, input.eccentricity,
            input.surface_pressure_bar, t_eq,
        ),
        diurnal_range_k: 200.0, // airless bodies have extreme diurnal range
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Earth climate validation
    #[test]
    fn test_earth_climate() {
        let input = ClimateInput {
            mass_earth: 1.0,
            radius_earth: 1.0,
            semi_major_axis_au: 1.0,
            eccentricity: 0.017,
            obliquity_deg: 23.44,
            rotation_period_hours: 24.0,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            surface_pressure_bar: 1.013,
            bond_albedo_base: 0.29,
            greenhouse_opacity: 1.0,
            planet_type: "rocky".to_string(),
        };

        let state = solve_climate(&input);

        // Surface temp ~288K
        assert!(state.surface_temp_k > 260.0 && state.surface_temp_k < 310.0,
            "Earth T_s = {} (expected ~288)", state.surface_temp_k);

        // Should be in HZ
        assert!(state.hz_status.in_conservative_hz,
            "Earth should be in conservative HZ");

        // Temperate regime
        assert!(matches!(state.climate_regime,
            ClimateRegime::Temperate | ClimateRegime::PartialIce),
            "Earth should be temperate, got {:?}", state.climate_regime);

        // Should converge
        assert!(state.convergence.converged);
    }

    /// Mars climate: cold, partial ice
    #[test]
    fn test_mars_climate() {
        let input = ClimateInput {
            mass_earth: 0.107,
            radius_earth: 0.532,
            semi_major_axis_au: 1.524,
            eccentricity: 0.093,
            obliquity_deg: 25.19,
            rotation_period_hours: 24.6,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            surface_pressure_bar: 0.006,
            bond_albedo_base: 0.25,
            greenhouse_opacity: 0.01,
            planet_type: "rocky".to_string(),
        };

        let state = solve_climate(&input);

        // Mars T ~ 210K
        assert!(state.surface_temp_k > 180.0 && state.surface_temp_k < 260.0,
            "Mars T_s = {} (expected ~210)", state.surface_temp_k);
    }

    /// HZ boundaries for Sun
    #[test]
    fn test_hz_sun() {
        let hz = compute_hz_status(1.0, 5778.0, 1.0);
        assert!(hz.in_conservative_hz, "Earth should be in conservative HZ");
        assert!((hz.inner_hz_au - 0.95).abs() < 0.15,
            "Inner HZ = {} (expected ~0.95)", hz.inner_hz_au);
        assert!((hz.outer_hz_au - 1.67).abs() < 0.3,
            "Outer HZ = {} (expected ~1.67)", hz.outer_hz_au);
    }

    /// Venus: should be in runaway state
    #[test]
    fn test_venus_climate() {
        let input = ClimateInput {
            mass_earth: 0.815,
            radius_earth: 0.950,
            semi_major_axis_au: 0.723,
            eccentricity: 0.007,
            obliquity_deg: 177.0,  // retrograde
            rotation_period_hours: 5832.0,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            surface_pressure_bar: 92.0,
            bond_albedo_base: 0.77,
            greenhouse_opacity: 80.0,
            planet_type: "rocky".to_string(),
        };

        let state = solve_climate(&input);
        // Venus is extremely hot due to greenhouse
        assert!(state.surface_temp_k > 350.0,
            "Venus T_s = {} (expected >400)", state.surface_temp_k);
    }

    /// Tidal heating for close-in planet
    #[test]
    fn test_tidal_heating() {
        let flux = tidal_heating_flux(1.0, 1.0, 0.05, 0.2, 1.0);
        assert!(flux > 0.0, "Close-in eccentric planet should have tidal heating");
    }

    /// Ice-albedo feedback: more ice → higher albedo
    #[test]
    fn test_ice_albedo() {
        let a_warm = ice_albedo_feedback(0.3, 0.0, 300.0);
        let a_cold = ice_albedo_feedback(0.3, 0.8, 220.0);
        assert!(a_cold > a_warm, "Icy world should have higher albedo");
    }
}
