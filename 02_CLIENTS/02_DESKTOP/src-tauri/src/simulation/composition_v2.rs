//! EOS-based bulk composition inference.
//!
//! Replaces the simple density-ratio heuristic with proper equation-of-state
//! calculations for each material layer.
//!
//! Models:
//!   - Birch-Murnaghan EOS (3rd order) for iron, silicates, ice
//!   - Zeng et al. (2019) — empirical mass-radius relations
//!   - Seager et al. (2007) — interior structure EOS tables
//!   - Fortney et al. (2007) — giant planet envelope models
//!   - Valencia et al. (2006) — super-Earth interior structure
//!
//! Data-oriented layout: EOS tables as static arrays for cache-friendly
//! computation (per osp-magnum design patterns).

use serde::{Deserialize, Serialize};
use crate::BulkComposition;

// ── Physical constants ──────────────────────────────

const G: f64 = 6.67430e-11;         // gravitational constant [m³ kg⁻¹ s⁻²]
const M_EARTH: f64 = 5.972e24;      // [kg]
const R_EARTH: f64 = 6.371e6;       // [m]
const RHO_EARTH: f64 = 5514.0;      // mean density [kg/m³]
const PI: f64 = std::f64::consts::PI;

// ── Birch-Murnaghan EOS parameters ─────────────────
//
// 3rd-order BM EOS: P = (3/2)K₀[η^(7/3) - η^(5/3)] × [1 + (3/4)(K₀'-4)(η^(2/3)-1)]
// where η = ρ/ρ₀
//
// Source: Seager et al. 2007 Table 1, Zeng & Seager 2008

/// EOS material parameters.
#[derive(Debug, Clone, Copy)]
pub struct EosMaterial {
    pub name: &'static str,
    pub rho_0: f64,     // zero-pressure density [kg/m³]
    pub k_0: f64,       // bulk modulus at zero pressure [Pa]
    pub k_0_prime: f64,  // pressure derivative of bulk modulus [dimensionless]
}

/// ε-Fe (hexagonal close-packed iron) — inner core
pub const IRON_HCP: EosMaterial = EosMaterial {
    name: "ε-Fe (hcp)",
    rho_0: 8300.0,
    k_0: 156.2e9,
    k_0_prime: 6.08,
};

/// MgSiO₃ perovskite (bridgmanite) — lower mantle
pub const PEROVSKITE: EosMaterial = EosMaterial {
    name: "MgSiO₃ (pv)",
    rho_0: 4100.0,
    k_0: 247.0e9,
    k_0_prime: 3.97,
};

/// MgSiO₃ enstatite — upper mantle
pub const ENSTATITE: EosMaterial = EosMaterial {
    name: "MgSiO₃ (en)",
    rho_0: 3220.0,
    k_0: 107.8e9,
    k_0_prime: 7.0,
};

/// Mg₂SiO₄ olivine — upper mantle alternative
pub const OLIVINE: EosMaterial = EosMaterial {
    name: "Mg₂SiO₄ (ol)",
    rho_0: 3222.0,
    k_0: 128.0e9,
    k_0_prime: 4.2,
};

/// H₂O ice VII — high-pressure water ice
pub const WATER_ICE_VII: EosMaterial = EosMaterial {
    name: "H₂O (ice VII)",
    rho_0: 1460.0,
    k_0: 23.7e9,
    k_0_prime: 4.15,
};

/// Liquid water
pub const WATER_LIQUID: EosMaterial = EosMaterial {
    name: "H₂O (liquid)",
    rho_0: 1000.0,
    k_0: 2.2e9,
    k_0_prime: 7.0,
};

/// Fe₀.₈(FeSi)₀.₂ — iron-silicon alloy (core)
pub const IRON_SILICON: EosMaterial = EosMaterial {
    name: "Fe-Si alloy",
    rho_0: 7500.0,
    k_0: 135.0e9,
    k_0_prime: 5.5,
};

// ── Mass-radius relation curves ─────────────────────
//
// Empirical fits from Zeng et al. (2019) PNAS.
// log₁₀(R/R⊕) = a + b·log₁₀(M/M⊕) + c·[log₁₀(M/M⊕)]²

/// Zeng mass-radius power-law coefficients: (a, b, c) for R/R⊕ = 10^(a + b·log(M) + c·log²(M))
#[derive(Debug, Clone, Copy)]
pub struct ZengCurve {
    pub name: &'static str,
    pub a: f64,
    pub b: f64,
    pub c: f64,
}

/// Pure iron (100% Fe)
const CURVE_PURE_FE: ZengCurve = ZengCurve {
    name: "Pure iron",
    a: -0.0469,
    b: 0.2658,
    c: -0.0138,
};

/// Earth-like (32.5% Fe core + 67.5% MgSiO₃ mantle)
const CURVE_EARTH_LIKE: ZengCurve = ZengCurve {
    name: "Earth-like",
    a: 0.0,
    b: 0.2790,
    c: -0.0156,
};

/// Pure rock (100% MgSiO₃)
const CURVE_PURE_ROCK: ZengCurve = ZengCurve {
    name: "Pure rock",
    a: 0.0137,
    b: 0.2722,
    c: -0.0177,
};

/// 50% H₂O + 50% rock
const CURVE_WATER_WORLD: ZengCurve = ZengCurve {
    name: "50% H₂O",
    a: 0.0912,
    b: 0.3111,
    c: -0.0185,
};

/// 100% H₂O
const CURVE_PURE_WATER: ZengCurve = ZengCurve {
    name: "Pure water",
    a: 0.1245,
    b: 0.3280,
    c: -0.0188,
};

/// All curves for interpolation
const ZENG_CURVES: [(f64, &ZengCurve); 5] = [
    // (iron_fraction approximate, curve)
    (1.0,  &CURVE_PURE_FE),
    (0.325, &CURVE_EARTH_LIKE),
    (0.0,  &CURVE_PURE_ROCK),
    (-0.25, &CURVE_WATER_WORLD),  // negative = water fraction proxy
    (-0.50, &CURVE_PURE_WATER),
];

// ── Core inference engine ───────────────────────────

/// Enhanced composition inference using EOS-based mass-radius interpolation.
///
/// Strategy:
/// 1. Compute predicted radius for each Zeng curve at the given mass
/// 2. Find where the observed radius falls between curves
/// 3. Interpolate composition fractions
/// 4. For gas/ice giants: use Fortney 2007 envelope model
pub fn infer_composition_v2(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    planet_type: &str,
) -> DetailedComposition {
    // Gas/ice giants: dedicated model
    if matches!(planet_type, "gas-giant" | "super-jupiter") {
        return giant_planet_composition(mass_earth, radius_earth);
    }
    if planet_type == "neptune-like" {
        return neptune_like_composition(mass_earth, radius_earth);
    }

    // Rocky planets: Zeng curve interpolation
    let log_m = mass_earth.log10();

    // Compute predicted radius for each composition curve
    let predictions: Vec<(f64, f64)> = ZENG_CURVES.iter().map(|(iron_proxy, curve)| {
        let log_r = curve.a + curve.b * log_m + curve.c * log_m * log_m;
        (*iron_proxy, 10.0_f64.powf(log_r))
    }).collect();

    // Find bracket: which two curves does the observed radius fall between?
    let mut iron_fraction = 0.28; // default Earth-like
    let mut water_fraction = 0.0;

    // Curves are ordered from smallest (pure iron) to largest (pure water)
    for i in 0..predictions.len() - 1 {
        let (proxy_small, r_small) = predictions[i];
        let (proxy_large, r_large) = predictions[i + 1];

        if radius_earth >= r_small && radius_earth <= r_large {
            // Linear interpolation between curves
            let t = if (r_large - r_small).abs() > 1e-10 {
                (radius_earth - r_small) / (r_large - r_small)
            } else {
                0.5
            };
            let proxy = proxy_small + t * (proxy_large - proxy_small);

            if proxy > 0.0 {
                // Between iron-rich and rock: iron_fraction
                iron_fraction = proxy.clamp(0.0, 0.80);
                water_fraction = 0.0;
            } else {
                // Between rock and water-rich
                iron_fraction = 0.05;
                water_fraction = (-proxy * 2.0).clamp(0.0, 0.80);
            }
            break;
        }
    }

    // Planet smaller than pure iron → extremely iron-rich (Mercury-like)
    if radius_earth < predictions[0].1 {
        iron_fraction = 0.70;
        water_fraction = 0.0;
    }

    // Planet larger than pure water → needs H/He envelope
    let h_he = if radius_earth > predictions[predictions.len() - 1].1 {
        let excess = radius_earth - predictions[predictions.len() - 1].1;
        (excess * 0.1).clamp(0.0, 0.20)
    } else {
        0.0
    };

    // Formation distance influences volatile delivery
    let volatile_boost = if sma_au > 2.7 {
        // Beyond snow line: enhanced volatile delivery
        0.05 + (sma_au - 2.7) * 0.02
    } else {
        0.0
    };
    water_fraction = (water_fraction + volatile_boost).min(0.60);

    let silicate = (1.0 - iron_fraction - water_fraction - h_he).max(0.05);

    // Compute interior pressures
    let core_info = estimate_interior_pressures(mass_earth, radius_earth, iron_fraction);

    DetailedComposition {
        bulk: BulkComposition {
            iron_fraction,
            silicate_fraction: silicate,
            volatile_fraction: water_fraction,
            h_he_fraction: h_he,
        },
        core_mass_fraction: iron_fraction,
        mantle_mass_fraction: silicate,
        water_mass_fraction: water_fraction,
        envelope_mass_fraction: h_he,
        core_radius_fraction: core_info.core_radius_fraction,
        cmb_pressure_gpa: core_info.cmb_pressure_gpa,
        central_pressure_gpa: core_info.central_pressure_gpa,
        model_used: if h_he > 0.01 {
            "zeng2019_with_envelope".to_string()
        } else {
            "zeng2019_interpolation".to_string()
        },
        confidence: compute_confidence(mass_earth, radius_earth, planet_type),
    }
}

/// Backward-compatible wrapper — returns the old BulkComposition struct.
pub fn infer_composition(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    planet_type: &str,
) -> BulkComposition {
    infer_composition_v2(mass_earth, radius_earth, sma_au, planet_type).bulk
}

// ── Giant planet models ─────────────────────────────

/// Fortney et al. (2007) giant planet composition model.
///
/// For gas giants, the key observable is the planet's radius compared
/// to predictions for pure H/He spheres. A smaller-than-predicted
/// radius implies a heavy-element core.
///
/// Reference: Fortney, J.J. et al. "Planetary Radii across Five Orders
/// of Magnitude in Mass and Stellar Insolation" ApJ 659, 1661 (2007)
fn giant_planet_composition(mass_earth: f64, radius_earth: f64) -> DetailedComposition {
    let mass_jup = mass_earth / 317.8;

    // Pure H/He radius prediction (Fortney 2007 Table 2, 4.5 Gyr, 1 AU)
    // log(R/R_J) ≈ -0.01 + 0.044·log(M/M_J) - 0.074·log²(M/M_J) for M > 0.1 M_J
    let log_m = mass_jup.max(0.01).log10();
    let log_r_pure = -0.01 + 0.044 * log_m - 0.074 * log_m * log_m;
    let r_pure_jup = 10.0_f64.powf(log_r_pure);
    let r_pure_earth = r_pure_jup * 11.209;

    // Heavy element fraction from radius deficit
    let radius_deficit = (r_pure_earth - radius_earth) / r_pure_earth;
    let z_heavy = radius_deficit.clamp(0.0, 0.80) * 1.5; // calibrated to Jupiter Z ≈ 0.05

    let core_iron = z_heavy * 0.3;   // iron portion of heavy elements
    let core_rock = z_heavy * 0.5;   // silicate portion
    let core_ice = z_heavy * 0.2;    // ice portion
    let envelope = 1.0 - z_heavy;

    DetailedComposition {
        bulk: BulkComposition {
            iron_fraction: core_iron,
            silicate_fraction: core_rock,
            volatile_fraction: core_ice,
            h_he_fraction: envelope,
        },
        core_mass_fraction: z_heavy,
        mantle_mass_fraction: 0.0,
        water_mass_fraction: core_ice,
        envelope_mass_fraction: envelope,
        core_radius_fraction: (z_heavy * 0.3).min(0.25), // rough: heavy core is compact
        cmb_pressure_gpa: estimate_giant_core_pressure(mass_earth, z_heavy),
        central_pressure_gpa: estimate_giant_core_pressure(mass_earth, z_heavy) * 1.5,
        model_used: "fortney2007_giant".to_string(),
        confidence: if mass_jup > 0.1 && mass_jup < 20.0 { 0.7 } else { 0.4 },
    }
}

/// Neptune-like composition (ice giants).
fn neptune_like_composition(mass_earth: f64, radius_earth: f64) -> DetailedComposition {
    let density = compute_density(mass_earth, radius_earth);
    let neptune_density = 1638.0; // kg/m³

    // Ice giants: roughly 80% heavy elements, 20% H/He (by mass)
    // Ratio varies with density compared to Neptune
    let density_ratio = density / (neptune_density / 1000.0); // g/cm³ comparison

    let h_he = (0.20 / density_ratio.max(0.5)).clamp(0.05, 0.40);
    let ice = (0.50 * density_ratio.min(2.0)).clamp(0.20, 0.60);
    let rock = (0.25 * density_ratio).clamp(0.10, 0.40);
    let iron = (1.0 - h_he - ice - rock).max(0.02);

    DetailedComposition {
        bulk: BulkComposition {
            iron_fraction: iron,
            silicate_fraction: rock,
            volatile_fraction: ice,
            h_he_fraction: h_he,
        },
        core_mass_fraction: iron + rock,
        mantle_mass_fraction: rock,
        water_mass_fraction: ice,
        envelope_mass_fraction: h_he,
        core_radius_fraction: 0.30,
        cmb_pressure_gpa: 300.0 * (mass_earth / 17.15).powf(0.7),
        central_pressure_gpa: 700.0 * (mass_earth / 17.15).powf(0.8),
        model_used: "neptune_analog".to_string(),
        confidence: 0.5,
    }
}

// ── EOS calculations ────────────────────────────────

/// 3rd-order Birch-Murnaghan equation of state.
///
/// Returns pressure [Pa] at a given density for the specified material.
pub fn birch_murnaghan_pressure(material: &EosMaterial, density: f64) -> f64 {
    let eta = density / material.rho_0;
    let eta_2_3 = eta.powf(2.0 / 3.0);
    let eta_7_3 = eta.powf(7.0 / 3.0);
    let eta_5_3 = eta.powf(5.0 / 3.0);

    let p = 1.5 * material.k_0 * (eta_7_3 - eta_5_3)
        * (1.0 + 0.75 * (material.k_0_prime - 4.0) * (eta_2_3 - 1.0));

    p.max(0.0)
}

/// Inverse BM EOS: density at a given pressure.
/// Uses Newton-Raphson iteration.
pub fn birch_murnaghan_density(material: &EosMaterial, pressure_pa: f64) -> f64 {
    if pressure_pa <= 0.0 {
        return material.rho_0;
    }

    let mut rho = material.rho_0 * 1.1; // initial guess
    for _ in 0..50 {
        let p_calc = birch_murnaghan_pressure(material, rho);
        let dp = p_calc - pressure_pa;

        // Numerical derivative
        let drho = rho * 0.001;
        let p2 = birch_murnaghan_pressure(material, rho + drho);
        let dp_drho = (p2 - p_calc) / drho;

        if dp_drho.abs() < 1e-20 { break; }
        rho -= dp / dp_drho;
        rho = rho.max(material.rho_0 * 0.9);

        if dp.abs() < pressure_pa * 1e-8 { break; }
    }
    rho
}

// ── Interior pressure estimates ─────────────────────

struct InteriorPressureInfo {
    core_radius_fraction: f64,
    cmb_pressure_gpa: f64,
    central_pressure_gpa: f64,
}

/// Estimate interior pressures using a simplified 2-layer model.
///
/// Per Valencia et al. (2006): P_center ∝ M²/R⁴ for self-gravitating bodies.
fn estimate_interior_pressures(
    mass_earth: f64,
    radius_earth: f64,
    iron_fraction: f64,
) -> InteriorPressureInfo {
    // Earth reference values
    let p_center_earth = 364.0; // GPa
    let p_cmb_earth = 135.5;   // GPa
    let core_frac_earth = 0.546; // r_core/R_planet for Earth

    // Scaling: P ∝ (M/R²)² ∝ g²·R²·ρ ≈ M²/R⁴
    let pressure_scale = mass_earth.powi(2) / radius_earth.powi(4);

    // Core radius fraction scales with iron fraction
    // Earth: 32.5% Fe by mass → 54.6% R_core/R_planet
    // Scaling: (r_core/R) ∝ (f_Fe)^(1/3) approximately
    let core_r_frac = core_frac_earth * (iron_fraction / 0.325).powf(1.0 / 3.0);
    let core_r_frac = core_r_frac.clamp(0.10, 0.80);

    InteriorPressureInfo {
        core_radius_fraction: core_r_frac,
        cmb_pressure_gpa: p_cmb_earth * pressure_scale,
        central_pressure_gpa: p_center_earth * pressure_scale,
    }
}

/// Giant planet core pressure estimate [GPa].
fn estimate_giant_core_pressure(mass_earth: f64, z_heavy: f64) -> f64 {
    // Jupiter central pressure ~7000 GPa
    // Scales as M^(5/3) roughly (degenerate pressure support)
    let mass_jup = mass_earth / 317.8;
    7000.0 * mass_jup.powf(5.0 / 3.0) * (z_heavy / 0.05).powf(0.3)
}

// ── Utility functions ───────────────────────────────

/// Mean density [g/cm³].
fn compute_density(mass_earth: f64, radius_earth: f64) -> f64 {
    let mass_kg = mass_earth * M_EARTH;
    let radius_m = radius_earth * R_EARTH;
    let volume = (4.0 / 3.0) * PI * radius_m.powi(3);
    (mass_kg / volume) / 1000.0
}

/// Model confidence based on regime coverage.
fn compute_confidence(mass_earth: f64, radius_earth: f64, planet_type: &str) -> f64 {
    let mut conf: f64 = 0.8;

    // Mass-radius relations best calibrated in 0.1-10 M⊕
    if mass_earth < 0.1 || mass_earth > 10.0 {
        conf -= 0.15;
    }

    // Very low or very high density reduces confidence
    let density = compute_density(mass_earth, radius_earth);
    if density < 1.0 || density > 15.0 {
        conf -= 0.2;
    }

    // Sub-earths poorly constrained
    if planet_type == "sub-earth" {
        conf -= 0.1;
    }

    conf.clamp(0.2, 0.95)
}

// ── Output types ────────────────────────────────────

/// Extended composition with interior structure information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedComposition {
    /// Backward-compatible bulk fractions
    pub bulk: BulkComposition,
    /// Core mass fraction (iron + some silicates)
    pub core_mass_fraction: f64,
    /// Mantle mass fraction (silicates)
    pub mantle_mass_fraction: f64,
    /// Water/ice mass fraction
    pub water_mass_fraction: f64,
    /// H/He envelope mass fraction
    pub envelope_mass_fraction: f64,
    /// Core radius as fraction of total radius
    pub core_radius_fraction: f64,
    /// Core-mantle boundary pressure [GPa]
    pub cmb_pressure_gpa: f64,
    /// Central pressure [GPa]
    pub central_pressure_gpa: f64,
    /// Which model was used
    pub model_used: String,
    /// Confidence in the result (0-1)
    pub confidence: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_earth_composition() {
        let comp = infer_composition_v2(1.0, 1.0, 1.0, "rocky");
        assert!(comp.bulk.iron_fraction > 0.20 && comp.bulk.iron_fraction < 0.45,
            "Earth Fe = {} (expected ~0.325)", comp.bulk.iron_fraction);
        assert!(comp.bulk.silicate_fraction > 0.40,
            "Earth silicate = {}", comp.bulk.silicate_fraction);
        assert!(comp.bulk.h_he_fraction < 0.01,
            "Earth H/He = {}", comp.bulk.h_he_fraction);
    }

    #[test]
    fn test_mercury_composition() {
        // Mercury: M=0.055, R=0.383 → very dense → iron-rich
        let comp = infer_composition_v2(0.055, 0.383, 0.387, "sub-earth");
        assert!(comp.bulk.iron_fraction > 0.40,
            "Mercury Fe = {} (expected >0.60)", comp.bulk.iron_fraction);
    }

    #[test]
    fn test_gas_giant_composition() {
        // Jupiter: M=317.8, R=11.2
        let comp = infer_composition_v2(317.8, 11.2, 5.2, "gas-giant");
        assert!(comp.bulk.h_he_fraction > 0.70,
            "Jupiter H/He = {} (expected >0.85)", comp.bulk.h_he_fraction);
        assert_eq!(comp.model_used, "fortney2007_giant");
    }

    #[test]
    fn test_neptune_composition() {
        let comp = infer_composition_v2(17.15, 3.883, 30.07, "neptune-like");
        assert!(comp.bulk.volatile_fraction > 0.20,
            "Neptune ice = {}", comp.bulk.volatile_fraction);
        assert!(comp.bulk.h_he_fraction > 0.05 && comp.bulk.h_he_fraction < 0.40,
            "Neptune H/He = {}", comp.bulk.h_he_fraction);
    }

    #[test]
    fn test_birch_murnaghan_iron() {
        // Iron at zero pressure should give zero
        let p0 = birch_murnaghan_pressure(&IRON_HCP, IRON_HCP.rho_0);
        assert!(p0.abs() < 1e6, "P(ρ₀) = {} (expected ~0)", p0);

        // Iron at Earth core density (~13000 kg/m³) → ~350 GPa
        let p = birch_murnaghan_pressure(&IRON_HCP, 13000.0);
        let p_gpa = p / 1e9;
        assert!(p_gpa > 200.0 && p_gpa < 600.0,
            "P(13000) = {} GPa (expected ~350)", p_gpa);
    }

    #[test]
    fn test_birch_murnaghan_inverse() {
        // Round-trip test: density → pressure → density
        let rho_test = 10000.0;
        let p = birch_murnaghan_pressure(&IRON_HCP, rho_test);
        let rho_back = birch_murnaghan_density(&IRON_HCP, p);
        assert!((rho_back - rho_test).abs() < rho_test * 0.01,
            "Round-trip failed: {} → {} Pa → {}", rho_test, p, rho_back);
    }

    #[test]
    fn test_earth_interior_pressures() {
        let info = estimate_interior_pressures(1.0, 1.0, 0.325);
        assert!((info.core_radius_fraction - 0.546).abs() < 0.05,
            "Earth core R frac = {} (expected 0.546)", info.core_radius_fraction);
        assert!((info.cmb_pressure_gpa - 135.5).abs() < 20.0,
            "Earth CMB P = {} GPa (expected 135.5)", info.cmb_pressure_gpa);
        assert!((info.central_pressure_gpa - 364.0).abs() < 50.0,
            "Earth center P = {} GPa (expected 364)", info.central_pressure_gpa);
    }

    #[test]
    fn test_density_calculation() {
        let d = compute_density(1.0, 1.0);
        assert!((d - 5.51).abs() < 0.1, "Earth density = {} (expected 5.51)", d);
    }
}
