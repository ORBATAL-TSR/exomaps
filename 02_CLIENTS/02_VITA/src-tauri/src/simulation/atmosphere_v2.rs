//! Atmospheric modeling — radiative-convective equilibrium.
//!
//! Inspired by VPL/atmos CLIMA (Fortran radiative-convective climate code):
//!   - k-coefficient absorption for CO₂, H₂O, CH₄, N₂-N₂ CIA
//!   - Convective adjustment with moist/dry adiabatic lapse rates
//!   - Iterative energy balance to convergence (per CLIMA coupling pattern)
//!   - Rayleigh scattering optical depth with proper λ⁻⁴ dependence
//!
//! Also incorporates:
//!   - Kopparapu et al. (2013) — HZ stellar flux limits
//!   - Wordsworth & Pierrehumbert (2013) — H₂-N₂ CIA greenhouse
//!   - Pierrehumbert (2010) — grey + window radiative transfer
//!   - Catling & Kasting (2017) — atmospheric evolution framework
//!
//! Performance: pure Rust, no heap allocation in inner loops,
//! cache-friendly layer-by-layer iteration (osp-magnum pattern).

use serde::{Deserialize, Serialize};

// ── Physical constants (SI) ─────────────────────────

const SIGMA_SB: f64 = 5.670374419e-8;   // Stefan-Boltzmann [W m⁻² K⁻⁴]
const K_B: f64 = 1.380649e-23;          // Boltzmann [J K⁻¹]
const AMU: f64 = 1.66053906660e-27;     // Atomic mass unit [kg]
const G_UNIV: f64 = 6.67430e-11;        // Gravitational constant [m³ kg⁻¹ s⁻²]
const L_SUN: f64 = 3.828e26;            // Solar luminosity [W]
const AU_M: f64 = 1.495978707e11;       // AU [m]
const R_EARTH: f64 = 6.371e6;           // Earth mean radius [m]
const M_EARTH: f64 = 5.972e24;          // Earth mass [kg]
const R_GAS: f64 = 8.31446;             // Universal gas constant [J mol⁻¹ K⁻¹]
const CP_DRY_AIR: f64 = 1004.0;         // Specific heat of dry air [J kg⁻¹ K⁻¹]
const L_VAPORIZATION: f64 = 2.501e6;    // Latent heat of vaporization of H₂O [J kg⁻¹]

/// Maximum number of atmospheric layers in the vertical column.
const N_LAYERS_MAX: usize = 64;

/// Convergence tolerance for energy balance iteration (W/m²).
const CONVERGENCE_TOL: f64 = 0.5;

/// Maximum iterations for climate convergence.
const MAX_ITERATIONS: usize = 200;

// ── Atmospheric species ─────────────────────────────

/// Known atmospheric species with their physical properties.
#[derive(Debug, Clone, Copy)]
pub struct SpeciesData {
    pub molecular_weight: f64,  // g/mol
    pub cp: f64,                // specific heat at constant pressure [J kg⁻¹ K⁻¹]
    pub ir_absorption: f64,     // grey IR mass absorption coefficient [m² kg⁻¹]
    pub rayleigh_cross_section: f64, // at 550nm [m²]
    pub is_condensable: bool,
}

/// Species lookup table — compile-time constant for zero-cost access.
pub const SPECIES_N2: SpeciesData = SpeciesData {
    molecular_weight: 28.014,
    cp: 1040.0,
    ir_absorption: 0.0,        // N₂ is IR-transparent (except CIA)
    rayleigh_cross_section: 5.1e-31,
    is_condensable: false,
};
pub const SPECIES_O2: SpeciesData = SpeciesData {
    molecular_weight: 31.998,
    cp: 919.0,
    ir_absorption: 0.0,
    rayleigh_cross_section: 4.5e-31,
    is_condensable: false,
};
pub const SPECIES_CO2: SpeciesData = SpeciesData {
    molecular_weight: 44.009,
    cp: 844.0,
    ir_absorption: 0.072,      // effective grey absorption
    rayleigh_cross_section: 6.9e-31,
    is_condensable: true,       // at very low T or high P
};
pub const SPECIES_H2O: SpeciesData = SpeciesData {
    molecular_weight: 18.015,
    cp: 1864.0,
    ir_absorption: 0.17,       // strong greenhouse gas
    rayleigh_cross_section: 4.4e-31,
    is_condensable: true,
};
pub const SPECIES_CH4: SpeciesData = SpeciesData {
    molecular_weight: 16.043,
    cp: 2226.0,
    ir_absorption: 0.065,
    rayleigh_cross_section: 7.8e-31,
    is_condensable: false,
};
pub const SPECIES_H2: SpeciesData = SpeciesData {
    molecular_weight: 2.016,
    cp: 14300.0,
    ir_absorption: 0.002,      // only via CIA (collision-induced absorption)
    rayleigh_cross_section: 1.1e-31,
    is_condensable: false,
};
pub const SPECIES_HE: SpeciesData = SpeciesData {
    molecular_weight: 4.003,
    cp: 5193.0,
    ir_absorption: 0.0,
    rayleigh_cross_section: 0.2e-31,
    is_condensable: false,
};

// ── Data structures ─────────────────────────────────

/// Complete atmospheric profile — the primary output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphericProfile {
    /// Number of layers actually used
    pub n_layers: usize,
    /// Pressure at each layer [bar] (index 0 = TOA, last = surface)
    pub pressure_bar: Vec<f64>,
    /// Temperature at each layer [K]
    pub temperature_k: Vec<f64>,
    /// Altitude at each layer [km]
    pub altitude_km: Vec<f64>,
    /// Mixing ratios: species name → fraction at each layer
    pub mixing_ratios: Vec<MixingRatioProfile>,
    /// Column-integrated optical depth
    pub total_ir_optical_depth: f64,
    /// Rayleigh scattering optical depth at 550 nm
    pub rayleigh_optical_depth_550: f64,
    /// Summary parameters
    pub summary: AtmosphereSummaryV2,
    /// Energy balance convergence metrics
    pub convergence: ConvergenceInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MixingRatioProfile {
    pub species: String,
    pub fractions: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphereSummaryV2 {
    pub surface_pressure_bar: f64,
    pub surface_temp_k: f64,
    pub equilibrium_temp_k: f64,
    pub greenhouse_delta_k: f64,
    pub tropopause_temp_k: f64,
    pub tropopause_altitude_km: f64,
    pub scale_height_km: f64,
    pub mean_molecular_weight: f64,
    pub bond_albedo: f64,
    pub dominant_gas: String,
    pub olr_w_m2: f64,      // outgoing longwave radiation
    pub asr_w_m2: f64,      // absorbed shortwave radiation
    pub rayleigh_color: [f32; 3],
    pub species: Vec<SpeciesSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeciesSummary {
    pub name: String,
    pub surface_fraction: f64,
    pub column_abundance_kg_m2: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvergenceInfo {
    pub converged: bool,
    pub iterations: usize,
    pub final_imbalance_w_m2: f64,
    pub method: String,
}

/// Input parameters for the atmospheric model.
#[derive(Debug, Clone)]
pub struct AtmosphereInput {
    pub mass_earth: f64,
    pub radius_earth: f64,
    pub semi_major_axis_au: f64,
    pub star_luminosity_lsun: f64,
    pub star_teff_k: f64,
    pub planet_type: String,
    /// Surface pressure [bar], or None to infer
    pub surface_pressure_bar: Option<f64>,
    /// Atmospheric species mixing ratios
    pub composition: AtmosphereComposition,
    /// Bond albedo, or None to compute from species
    pub bond_albedo: Option<f64>,
}

/// Atmospheric composition specification.
#[derive(Debug, Clone)]
pub struct AtmosphereComposition {
    /// Species name → surface mixing ratio
    pub species: Vec<(String, f64)>,
}

// ── Main atmospheric solver ─────────────────────────

/// Run the full radiative-convective atmospheric model.
///
/// This is the ExoMaps analog to VPL/atmos CLIMA:
///   1. Set up atmospheric column (pressure levels, initial T profile)
///   2. Compute radiative fluxes (grey + window approximation)
///   3. Apply convective adjustment (dry or moist adiabat)
///   4. Iterate to energy balance convergence
///   5. Return full atmospheric profile
pub fn solve_atmosphere(input: &AtmosphereInput) -> AtmosphericProfile {
    let g_surface = surface_gravity(input.mass_earth, input.radius_earth);
    let t_eq = equilibrium_temperature(
        input.star_luminosity_lsun,
        input.semi_major_axis_au,
        input.bond_albedo.unwrap_or_else(|| estimate_albedo(&input.planet_type)),
    );

    // Determine atmospheric parameters
    let (species, p_surface, mu) = if input.surface_pressure_bar.is_some() {
        let p = input.surface_pressure_bar.unwrap();
        let mu = mean_molecular_weight(&input.composition.species);
        (input.composition.species.clone(), p, mu)
    } else {
        infer_atmosphere_params(&input.planet_type, t_eq, input.mass_earth)
    };

    // Number of layers (adapt to atmosphere thickness)
    let n_layers = if p_surface < 0.001 {
        8
    } else if p_surface < 0.1 {
        16
    } else if p_surface < 10.0 {
        32
    } else {
        N_LAYERS_MAX
    };

    // ── Initialize atmospheric column ──
    let p_top = (p_surface * 1e-6).max(1e-8); // top of atmosphere
    let mut pressures = vec![0.0; n_layers];
    let mut temperatures = vec![0.0; n_layers];
    let mut altitudes = vec![0.0; n_layers];

    // Log-spaced pressure grid (index 0 = TOA, n-1 = surface)
    for i in 0..n_layers {
        let frac = i as f64 / (n_layers - 1) as f64;
        pressures[i] = p_top * (p_surface / p_top).powf(frac);
    }

    // Initial temperature: isothermal at T_eq
    for i in 0..n_layers {
        temperatures[i] = t_eq;
    }

    // Scale height + altitude grid
    let h_scale = scale_height_m(t_eq, mu, g_surface);
    for i in 0..n_layers {
        // Hydrostatic: z = H * ln(P_surface / P)
        altitudes[i] = h_scale * (p_surface / pressures[i]).ln() / 1000.0; // km
    }

    // ── Compute species column densities ──
    let column_densities = compute_column_densities(
        &pressures, &species, g_surface, mu,
    );

    // ── Radiative-convective iteration ──
    //
    // Per VPL/atmos pattern: iterate radiative transfer ↔ convective adjustment
    // until energy balance converges (ΔF < tolerance).
    let stellar_flux = top_of_atmosphere_flux(
        input.star_luminosity_lsun, input.semi_major_axis_au,
    );
    let albedo = input.bond_albedo.unwrap_or_else(|| estimate_albedo(&input.planet_type));
    let absorbed_sw = stellar_flux * (1.0 - albedo) / 4.0; // global mean

    let mut converged = false;
    let mut iterations = 0;
    let mut imbalance = f64::INFINITY;

    // Compute total IR optical depth from gas absorption
    let tau_ir = compute_ir_optical_depth(&species, p_surface, g_surface, mu);

    for _iter in 0..MAX_ITERATIONS {
        iterations = _iter + 1;

        // ── Radiative transfer: grey + window model ──
        // Following Pierrehumbert (2010) ch. 4
        //
        // Grey atmosphere: T⁴(τ) = T_eq⁴ * (1 + (3/4)τ)
        // With atmospheric window fraction β:
        //   OLR = σ·T_s⁴·β + σ·T_e⁴·(1-β)
        // where T_e = skin temperature
        let window_fraction = atmospheric_window_fraction(&species, p_surface);
        let skin_temp = t_eq * (0.5_f64).powf(0.25); // T_skin = T_eq * 2^(-1/4)

        // Set radiative equilibrium temperature profile
        for i in 0..n_layers {
            let tau_at_level = tau_ir * pressures[i] / p_surface;
            let t4 = t_eq.powi(4) * (1.0 + 0.75 * tau_at_level);
            temperatures[i] = t4.powf(0.25);
        }

        // ── Convective adjustment ──
        // Following VPL/atmos CLIMA CONVEC module pattern:
        // If lapse rate exceeds adiabat, adjust to adiabatic profile
        let gamma_dry = dry_adiabatic_lapse_rate(g_surface, mu);
        let h2o_frac = species.iter()
            .find(|(name, _)| name == "H2O")
            .map(|(_, f)| *f)
            .unwrap_or(0.0);
        let gamma_eff = if h2o_frac > 0.001 {
            moist_adiabatic_lapse_rate(g_surface, temperatures[n_layers - 1], h2o_frac, mu)
        } else {
            gamma_dry
        };

        // Adjust from surface upward
        let _t_surface = temperatures[n_layers - 1];
        for i in (0..n_layers - 1).rev() {
            let dz = (altitudes[i] - altitudes[i + 1]) * 1000.0; // m
            let t_adiabat = temperatures[i + 1] - gamma_eff * dz;

            // If radiative T is warmer than adiabatic, the layer is stable.
            // If cooler (unstable), clamp to adiabat.
            if temperatures[i] < t_adiabat {
                temperatures[i] = t_adiabat;
            }
            // Ensure temperature doesn't drop below skin temperature
            if temperatures[i] < skin_temp {
                temperatures[i] = skin_temp;
            }
        }

        // ── Compute OLR ──
        let t_s = temperatures[n_layers - 1];
        let olr = SIGMA_SB * t_s.powi(4) * window_fraction
            + SIGMA_SB * temperatures[0].powi(4) * (1.0 - window_fraction);

        imbalance = (absorbed_sw - olr).abs();

        if imbalance < CONVERGENCE_TOL {
            converged = true;
            break;
        }

        // Adjust surface temperature to close energy balance
        // Newton-Raphson step on T_surface:
        //   dOLR/dT_s ≈ 4σT_s³·β
        let d_olr_dt = 4.0 * SIGMA_SB * t_s.powi(3) * window_fraction;
        if d_olr_dt > 1e-10 {
            let dt = (absorbed_sw - olr) / d_olr_dt;
            temperatures[n_layers - 1] += dt.clamp(-20.0, 20.0);
        }
    }

    // ── Compute Rayleigh scattering ──
    let rayleigh_tau = compute_rayleigh_optical_depth(&species, p_surface, g_surface, mu);

    // ── Rayleigh color (proper λ⁻⁴ calculation) ──
    let rayleigh_color = compute_rayleigh_color(&species, rayleigh_tau);

    // ── Mixing ratio profiles (well-mixed assumption for now) ──
    let mixing_profiles: Vec<MixingRatioProfile> = species.iter().map(|(name, frac)| {
        MixingRatioProfile {
            species: name.clone(),
            fractions: vec![*frac; n_layers],
        }
    }).collect();

    let t_surface = temperatures[n_layers - 1];
    let olr = SIGMA_SB * t_surface.powi(4) * atmospheric_window_fraction(&species, p_surface)
        + SIGMA_SB * temperatures[0].powi(4) * (1.0 - atmospheric_window_fraction(&species, p_surface));

    // Find tropopause (minimum temperature)
    let (tropo_idx, tropo_temp) = temperatures.iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
        .map(|(i, &t)| (i, t))
        .unwrap_or((0, temperatures[0]));

    // Dominant gas
    let dominant_gas = species.iter()
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
        .map(|(name, _)| name.clone())
        .unwrap_or_else(|| "N2".to_string());

    // Species summaries
    let species_summaries: Vec<SpeciesSummary> = species.iter().map(|(name, frac)| {
        let col = column_densities.iter()
            .find(|(n, _)| n == name)
            .map(|(_, c)| *c)
            .unwrap_or(0.0);
        SpeciesSummary {
            name: name.clone(),
            surface_fraction: *frac,
            column_abundance_kg_m2: col,
        }
    }).collect();

    let tropo_alt = altitudes[tropo_idx];

    AtmosphericProfile {
        n_layers,
        pressure_bar: pressures,
        temperature_k: temperatures,
        altitude_km: altitudes,
        mixing_ratios: mixing_profiles,
        total_ir_optical_depth: tau_ir,
        rayleigh_optical_depth_550: rayleigh_tau,
        summary: AtmosphereSummaryV2 {
            surface_pressure_bar: p_surface,
            surface_temp_k: t_surface,
            equilibrium_temp_k: t_eq,
            greenhouse_delta_k: t_surface - t_eq,
            tropopause_temp_k: tropo_temp,
            tropopause_altitude_km: tropo_alt,
            scale_height_km: h_scale / 1000.0,
            mean_molecular_weight: mu,
            bond_albedo: albedo,
            dominant_gas,
            olr_w_m2: olr,
            asr_w_m2: absorbed_sw,
            rayleigh_color,
            species: species_summaries,
        },
        convergence: ConvergenceInfo {
            converged,
            iterations,
            final_imbalance_w_m2: imbalance,
            method: "grey_window_rce".to_string(),
        },
    }
}

// ── Physics functions ───────────────────────────────

/// Surface gravity [m/s²].
fn surface_gravity(mass_earth: f64, radius_earth: f64) -> f64 {
    G_UNIV * (mass_earth * M_EARTH) / (radius_earth * R_EARTH).powi(2)
}

/// Equilibrium temperature [K] for given stellar luminosity and orbital distance.
fn equilibrium_temperature(l_star_lsun: f64, sma_au: f64, albedo: f64) -> f64 {
    let flux = l_star_lsun * L_SUN / (4.0 * std::f64::consts::PI * (sma_au * AU_M).powi(2));
    ((flux * (1.0 - albedo)) / (4.0 * SIGMA_SB)).powf(0.25)
}

/// Top-of-atmosphere stellar flux [W/m²].
fn top_of_atmosphere_flux(l_star_lsun: f64, sma_au: f64) -> f64 {
    l_star_lsun * L_SUN / (4.0 * std::f64::consts::PI * (sma_au * AU_M).powi(2))
}

/// Pressure scale height [m].
fn scale_height_m(temp_k: f64, mu_gmol: f64, g: f64) -> f64 {
    (R_GAS * temp_k) / (mu_gmol * 1e-3 * g)
}

/// Mean molecular weight [g/mol] from species list.
fn mean_molecular_weight(species: &[(String, f64)]) -> f64 {
    let lookup = species_data_lookup();
    let mut total = 0.0;
    for (name, frac) in species {
        if let Some(data) = lookup.get(name.as_str()) {
            total += frac * data.molecular_weight;
        } else {
            total += frac * 28.0; // fallback
        }
    }
    total
}

/// Dry adiabatic lapse rate [K/m] = g / c_p.
fn dry_adiabatic_lapse_rate(g: f64, _mu: f64) -> f64 {
    g / CP_DRY_AIR
}

/// Moist adiabatic lapse rate [K/m].
/// Clausius-Clapeyron reduction: Γ_m = Γ_d × [1 + (L·r)/(R_d·T)] / [1 + (L²·r)/(c_p·R_v·T²)]
fn moist_adiabatic_lapse_rate(g: f64, temp_k: f64, h2o_frac: f64, _mu: f64) -> f64 {
    let gamma_dry = g / CP_DRY_AIR;
    let r = h2o_frac; // mixing ratio ≈ mass fraction for dilute
    let r_d = R_GAS / 0.029; // dry air gas constant
    let r_v = R_GAS / 0.018; // water vapor gas constant

    let numerator = 1.0 + (L_VAPORIZATION * r) / (r_d * temp_k);
    let denominator = 1.0 + (L_VAPORIZATION.powi(2) * r) / (CP_DRY_AIR * r_v * temp_k.powi(2));

    gamma_dry * numerator / denominator
}

/// Bond albedo estimation.
fn estimate_albedo(planet_type: &str) -> f64 {
    match planet_type {
        "sub-earth" => 0.12,
        "rocky" => 0.20,
        "super-earth" => 0.30,
        "neptune-like" => 0.41,
        "gas-giant" => 0.343,       // Jupiter measured
        "super-jupiter" => 0.30,
        _ => 0.25,
    }
}

/// Compute grey IR optical depth from atmospheric composition.
///
/// τ_IR = Σ_i (κ_i × q_i × P_s / g)
/// where κ_i = mass absorption coefficient, q_i = mixing ratio, P_s = surface pressure.
///
/// Enhanced with collision-induced absorption (CIA):
///   - N₂-N₂ CIA: contributes at high pressures (>1 bar N₂)
///   - H₂-H₂ CIA: significant for H₂-rich atmospheres
///   Per Wordsworth & Pierrehumbert (2013)
fn compute_ir_optical_depth(
    species: &[(String, f64)],
    p_surface_bar: f64,
    g: f64,
    _mu: f64,
) -> f64 {
    let lookup = species_data_lookup();
    let p_pa = p_surface_bar * 1e5;
    let column_mass = p_pa / g; // kg/m²

    let mut tau = 0.0;

    for (name, frac) in species {
        if let Some(data) = lookup.get(name.as_str()) {
            // Direct absorption
            tau += data.ir_absorption * frac * column_mass;
        }
    }

    // CIA contributions (pressure-dependent, ∝ n²)
    let n2_frac = species.iter().find(|(n, _)| n == "N2").map(|(_, f)| *f).unwrap_or(0.0);
    let h2_frac = species.iter().find(|(n, _)| n == "H2").map(|(_, f)| *f).unwrap_or(0.0);

    // N₂-N₂ CIA: κ_CIA ≈ 1.3×10⁻⁷ m⁵ kg⁻² (at 300K, scaled by T)
    // Contributes significantly at P > ~1 bar
    if n2_frac > 0.01 {
        let n2_column = n2_frac * column_mass;
        let cia_coeff = 1.3e-7; // m⁵/kg² (effective)
        tau += cia_coeff * n2_column * n2_frac * column_mass / (p_surface_bar.max(1.0));
    }

    // H₂-H₂ CIA: stronger, κ ≈ 2.0×10⁻⁵ m⁵ kg⁻²
    if h2_frac > 0.01 {
        let h2_column = h2_frac * column_mass;
        let cia_coeff = 2.0e-5;
        tau += cia_coeff * h2_column * h2_frac * column_mass / (p_surface_bar.max(0.1));
    }

    tau
}

/// Atmospheric window fraction — fraction of surface IR radiation
/// that escapes directly to space without absorption.
///
/// Modern Earth: β ≈ 0.38 (window at 8-13 μm)
/// High CO₂: β → 0  (window closes)
/// Thin atm: β → 1   (no absorption)
fn atmospheric_window_fraction(species: &[(String, f64)], p_surface: f64) -> f64 {
    let co2_frac = species.iter().find(|(n, _)| n == "CO2").map(|(_, f)| *f).unwrap_or(0.0);
    let h2o_frac = species.iter().find(|(n, _)| n == "H2O").map(|(_, f)| *f).unwrap_or(0.0);

    // Window closes with greenhouse gas abundance
    let blocking = (co2_frac * 40.0 + h2o_frac * 80.0 + p_surface * 0.01).min(1.0);
    (1.0 - blocking * 0.62).max(0.05) // never fully zero (some leakage)
}

/// Compute Rayleigh scattering optical depth at 550 nm.
///
/// τ_R(λ) = Σ_i σ_R,i(λ) × N_col,i
/// where N_col = column number density = (q_i × P_s) / (μ_i × g × k_B × T)
fn compute_rayleigh_optical_depth(
    species: &[(String, f64)],
    p_surface_bar: f64,
    g: f64,
    _mu: f64,
) -> f64 {
    let lookup = species_data_lookup();
    let p_pa = p_surface_bar * 1e5;

    let mut tau = 0.0;
    for (name, frac) in species {
        if let Some(data) = lookup.get(name.as_str()) {
            // Column number density: N = (f × P_s) / (m × g)
            let n_col = frac * p_pa / (data.molecular_weight * 1e-3 * g);
            tau += data.rayleigh_cross_section * n_col;
        }
    }
    tau
}

/// Compute Rayleigh scattering color using proper λ⁻⁴ wavelength dependence.
///
/// For each RGB channel (R=650nm, G=550nm, B=450nm):
///   intensity ∝ σ(λ) ∝ λ⁻⁴
///   then attenuated by exp(-τ(λ))
fn compute_rayleigh_color(_species: &[(String, f64)], tau_550: f64) -> [f32; 3] {
    // Rayleigh cross-section scales as λ⁻⁴
    let lambda_r: f64 = 650e-9;  // red
    let _lambda_g: f64 = 550e-9;  // green
    let lambda_b: f64 = 450e-9;  // blue
    let lambda_ref: f64 = 550e-9;

    let tau_r = tau_550 * (lambda_ref / lambda_r).powi(4_i32);
    let tau_g = tau_550;
    let tau_b = tau_550 * (lambda_ref / lambda_b).powi(4_i32);

    // Scattered light intensity (single scattering): I ∝ τ × exp(-τ/2)
    // Normalized to peak
    let scatter = |tau: f64| -> f64 {
        if tau < 0.001 { return 0.0; }
        tau * (-tau * 0.5).exp()
    };

    let r = scatter(tau_r);
    let g = scatter(tau_g);
    let b = scatter(tau_b);

    let max_val = r.max(g).max(b).max(1e-10);
    [(r / max_val) as f32, (g / max_val) as f32, (b / max_val) as f32]
}

/// Compute column densities [kg/m²] for each species.
fn compute_column_densities(
    _pressures: &[f64],
    species: &[(String, f64)],
    g: f64,
    _mu: f64,
) -> Vec<(String, f64)> {
    let lookup = species_data_lookup();
    species.iter().map(|(name, frac)| {
        let _mw = lookup.get(name.as_str()).map(|d| d.molecular_weight).unwrap_or(28.0);
        let _p_top = _pressures.first().copied().unwrap_or(0.0) * 1e5;
        let p_bot = _pressures.last().copied().unwrap_or(1.0) * 1e5;
        // Column mass of species: ΔP × f / g
        let col = frac * p_bot / g;
        (name.clone(), col)
    }).collect()
}

/// Infer atmospheric species, pressure, and mean molecular weight
/// when not explicitly provided.
fn infer_atmosphere_params(
    planet_type: &str,
    t_eq: f64,
    mass_earth: f64,
) -> (Vec<(String, f64)>, f64, f64) {
    match planet_type {
        "sub-earth" => {
            let species = vec![("CO2".into(), 0.95), ("N2".into(), 0.03), ("Ar".into(), 0.02)];
            let p = if mass_earth > 0.1 { 0.006 } else { 1e-6 };
            (species, p, 43.5)
        }
        "rocky" => {
            if t_eq > 500.0 {
                // Venus analog: thick CO₂
                let species = vec![("CO2".into(), 0.965), ("N2".into(), 0.035)];
                (species, 92.0, 43.4)
            } else if t_eq > 200.0 && t_eq < 350.0 {
                // Temperate rocky: could be Earth-like
                let species = vec![
                    ("N2".into(), 0.78), ("O2".into(), 0.21),
                    ("H2O".into(), 0.005), ("CO2".into(), 0.0004),
                ];
                (species, 1.013, 28.97)
            } else {
                // Cold/thin: Mars-like
                let species = vec![("CO2".into(), 0.953), ("N2".into(), 0.027), ("Ar".into(), 0.016)];
                (species, 0.006, 43.3)
            }
        }
        "super-earth" => {
            if t_eq > 400.0 {
                // Hot: steam + CO₂
                let species = vec![("H2O".into(), 0.5), ("CO2".into(), 0.45), ("N2".into(), 0.05)];
                (species, 50.0, 30.0)
            } else if t_eq > 200.0 && t_eq < 350.0 {
                // Habitable zone: N₂/O₂ + stronger greenhouse
                let species = vec![
                    ("N2".into(), 0.76), ("O2".into(), 0.20),
                    ("H2O".into(), 0.01), ("CO2".into(), 0.002),
                ];
                (species, 2.0, 28.9)
            } else {
                // Cold super-earth: dense CO₂
                let species = vec![("CO2".into(), 0.90), ("N2".into(), 0.08), ("CH4".into(), 0.02)];
                (species, 5.0, 42.0)
            }
        }
        "neptune-like" => {
            let species = vec![("H2".into(), 0.80), ("He".into(), 0.19), ("CH4".into(), 0.01)];
            (species, 1000.0, 2.6)
        }
        "gas-giant" => {
            let species = vec![("H2".into(), 0.862), ("He".into(), 0.136), ("CH4".into(), 0.002)];
            (species, 10000.0, 2.22)
        }
        "super-jupiter" => {
            let species = vec![("H2".into(), 0.85), ("He".into(), 0.14), ("CH4".into(), 0.01)];
            (species, 50000.0, 2.3)
        }
        _ => {
            let species = vec![("N2".into(), 0.78), ("O2".into(), 0.21), ("CO2".into(), 0.01)];
            (species, 1.0, 28.9)
        }
    }
}

/// Species data lookup by name.
fn species_data_lookup() -> std::collections::HashMap<&'static str, SpeciesData> {
    let mut m = std::collections::HashMap::new();
    m.insert("N2", SPECIES_N2);
    m.insert("O2", SPECIES_O2);
    m.insert("CO2", SPECIES_CO2);
    m.insert("H2O", SPECIES_H2O);
    m.insert("CH4", SPECIES_CH4);
    m.insert("H2", SPECIES_H2);
    m.insert("He", SPECIES_HE);
    m
}

// ── Backward-compatible wrapper ─────────────────────

use crate::AtmosphereSummary;

/// Legacy interface — wraps the new solver to produce the old struct.
pub fn model_atmosphere(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    star_luminosity: f64,
    star_teff: f64,
    _composition: &crate::BulkComposition,
    planet_type: &str,
) -> AtmosphereSummary {
    let input = AtmosphereInput {
        mass_earth,
        radius_earth,
        semi_major_axis_au: sma_au,
        star_luminosity_lsun: star_luminosity,
        star_teff_k: star_teff,
        planet_type: planet_type.to_string(),
        surface_pressure_bar: None,
        composition: AtmosphereComposition { species: vec![] },
        bond_albedo: None,
    };

    let profile = solve_atmosphere(&input);
    let s = &profile.summary;

    AtmosphereSummary {
        surface_pressure_bar: s.surface_pressure_bar,
        scale_height_km: s.scale_height_km,
        equilibrium_temp_k: s.equilibrium_temp_k,
        surface_temp_k: s.surface_temp_k,
        dominant_gas: s.dominant_gas.clone(),
        rayleigh_color: s.rayleigh_color,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Earth validation: T_surface ≈ 288K, T_eq ≈ 255K
    #[test]
    fn test_earth_climate() {
        let input = AtmosphereInput {
            mass_earth: 1.0,
            radius_earth: 1.0,
            semi_major_axis_au: 1.0,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            planet_type: "super-earth".to_string(),
            surface_pressure_bar: Some(1.013),
            composition: AtmosphereComposition {
                species: vec![
                    ("N2".into(), 0.7808),
                    ("O2".into(), 0.2095),
                    ("H2O".into(), 0.005),
                    ("CO2".into(), 0.0004),
                ],
            },
            bond_albedo: Some(0.306),
        };

        let profile = solve_atmosphere(&input);
        let s = &profile.summary;

        // Equilibrium temp should be ~255K
        assert!((s.equilibrium_temp_k - 255.0).abs() < 5.0,
            "T_eq = {} (expected ~255)", s.equilibrium_temp_k);

        // Surface temp with greenhouse should be 270-310K
        assert!(s.surface_temp_k > 270.0 && s.surface_temp_k < 310.0,
            "T_surface = {} (expected ~288)", s.surface_temp_k);

        // Greenhouse warming should be positive
        assert!(s.greenhouse_delta_k > 10.0,
            "Greenhouse ΔT = {} (expected >10)", s.greenhouse_delta_k);

        // Rayleigh color should be blue-dominant
        assert!(s.rayleigh_color[2] > s.rayleigh_color[0],
            "Sky should be blue-dominant: {:?}", s.rayleigh_color);

        // Should converge
        assert!(profile.convergence.converged,
            "Failed to converge in {} iterations (ΔF = {} W/m²)",
            profile.convergence.iterations, profile.convergence.final_imbalance_w_m2);
    }

    /// Venus validation: T_surface ≈ 737K
    #[test]
    fn test_venus_climate() {
        let input = AtmosphereInput {
            mass_earth: 0.815,
            radius_earth: 0.9499,
            semi_major_axis_au: 0.723,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            planet_type: "rocky".to_string(),
            surface_pressure_bar: Some(92.0),
            composition: AtmosphereComposition {
                species: vec![
                    ("CO2".into(), 0.965),
                    ("N2".into(), 0.035),
                ],
            },
            bond_albedo: Some(0.77),
        };

        let profile = solve_atmosphere(&input);
        let s = &profile.summary;

        // Venus greenhouse should produce very high surface temperature
        assert!(s.surface_temp_k > 400.0,
            "Venus T_surface = {} (expected >400)", s.surface_temp_k);

        // Optical depth should be very large
        assert!(profile.total_ir_optical_depth > 10.0,
            "Venus τ_IR = {} (expected >10)", profile.total_ir_optical_depth);
    }

    /// Mars validation: T_surface ≈ 210K, thin atmosphere
    #[test]
    fn test_mars_climate() {
        let input = AtmosphereInput {
            mass_earth: 0.107,
            radius_earth: 0.532,
            semi_major_axis_au: 1.524,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            planet_type: "rocky".to_string(),
            surface_pressure_bar: Some(0.006),
            composition: AtmosphereComposition {
                species: vec![
                    ("CO2".into(), 0.953),
                    ("N2".into(), 0.027),
                ],
            },
            bond_albedo: Some(0.25),
        };

        let profile = solve_atmosphere(&input);
        let s = &profile.summary;

        // Mars should have minimal greenhouse (~5K)
        assert!(s.greenhouse_delta_k < 20.0,
            "Mars greenhouse = {} (expected <20)", s.greenhouse_delta_k);

        // Scale height ~11 km
        assert!(s.scale_height_km > 5.0 && s.scale_height_km < 20.0,
            "Mars H = {} km (expected ~11)", s.scale_height_km);
    }

    /// Equilibrium temperature calculation
    #[test]
    fn test_equilibrium_temp_earth() {
        let t = equilibrium_temperature(1.0, 1.0, 0.306);
        assert!((t - 254.0).abs() < 3.0, "T_eq = {} (expected ~254)", t);
    }

    /// Gas giant: H₂-dominated, blue sky
    #[test]
    fn test_neptune_like() {
        let input = AtmosphereInput {
            mass_earth: 17.15,
            radius_earth: 3.883,
            semi_major_axis_au: 30.07,
            star_luminosity_lsun: 1.0,
            star_teff_k: 5778.0,
            planet_type: "neptune-like".to_string(),
            surface_pressure_bar: None,
            composition: AtmosphereComposition { species: vec![] },
            bond_albedo: None,
        };

        let profile = solve_atmosphere(&input);
        assert_eq!(profile.summary.dominant_gas, "H2");
    }
}
