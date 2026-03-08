//! Geological regime inference for procedural planet surfaces.
//!
//! Determines tectonic style, volcanism level, crater density,
//! and ocean/ice coverage from bulk composition and thermal state.
//!
//! Used to parameterize the heightmap generator for realistic
//! surface features.

use crate::BulkComposition;
use serde::{Deserialize, Serialize};

/// Tectonic regime classification
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum TectonicRegime {
    /// Single rigid shell (Mars, Moon, Mercury)
    StagnantLid,
    /// Active plate tectonics (Earth)
    MobileLid,
    /// Intermittent recycling (Venus-like)
    Episodic,
    /// No solid surface (gas/ice giants)
    None,
}

/// Geological parameters for surface generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeologyParams {
    pub tectonic_regime: TectonicRegime,
    pub volcanism_level: f64,       // 0-1
    pub crater_density: f64,        // 0-1
    pub ocean_fraction: f64,        // 0-1
    pub ice_fraction: f64,          // 0-1
    pub mountain_height_km: f64,    // max elevation
    pub tectonic_roughness: f64,    // 0-1, affects terrain noise amplitude
}

/// Infer geological parameters from composition and thermal state.
///
/// # Arguments
/// * `mass_earth` — planet mass in Earth masses
/// * `radius_earth` — planet radius in Earth radii
/// * `surface_temp_k` — surface temperature in Kelvin
/// * `surface_pressure_bar` — surface atmospheric pressure
/// * `composition` — bulk composition from the composition module
/// * `planet_type` — classification string
/// * `age_gyr` — estimated system age in Gyr (default ~4.6)
pub fn infer_geology(
    mass_earth: f64,
    radius_earth: f64,
    surface_temp_k: f64,
    surface_pressure_bar: f64,
    composition: &BulkComposition,
    planet_type: &str,
    age_gyr: f64,
) -> GeologyParams {
    // Gas/ice giants: no solid surface
    if matches!(planet_type, "gas-giant" | "super-jupiter" | "neptune-like") {
        return GeologyParams {
            tectonic_regime: TectonicRegime::None,
            volcanism_level: 0.0,
            crater_density: 0.0,
            ocean_fraction: 0.0,
            ice_fraction: 0.0,
            mountain_height_km: 0.0,
            tectonic_roughness: 0.3, // cloud band texture variation
        };
    }

    // ── Tectonic regime ──
    let tectonic_regime = infer_tectonic_regime(mass_earth, age_gyr, surface_temp_k);

    // ── Volcanism ──
    // Higher for younger, more massive planets with iron cores.
    // Thick atmospheres act as thermal blankets (Venus effect),
    // raising mantle temperature and increasing volcanism.
    // Episodic lid regimes imply catastrophic resurfacing events.
    let heat_flow = (mass_earth.powf(0.7)) / (age_gyr + 0.5);
    let thermal_blanket = if surface_temp_k > 500.0 {
        // Venus-like: thick atmosphere traps heat, boosting mantle convection
        ((surface_temp_k - 500.0) / 500.0).clamp(0.0, 0.3)
    } else {
        0.0
    };
    let regime_boost = match tectonic_regime {
        TectonicRegime::Episodic => 0.15,  // catastrophic overturn cycles
        TectonicRegime::MobileLid => 0.05, // steady-state subduction
        _ => 0.0,
    };
    let volcanism_level = (heat_flow * 0.15
        + composition.iron_fraction * 0.3
        + thermal_blanket
        + regime_boost)
        .clamp(0.0, 1.0);

    // ── Crater density ──
    // Inversely proportional to atmosphere thickness + volcanism (resurfacing)
    let atm_shield = (surface_pressure_bar.log10() + 2.0).clamp(0.0, 4.0) / 4.0;
    let resurfacing = volcanism_level * 0.5
        + if tectonic_regime == TectonicRegime::MobileLid {
            0.3
        } else {
            0.0
        };
    let crater_density = (1.0 - atm_shield * 0.6 - resurfacing).clamp(0.0, 1.0);

    // ── Ocean fraction ──
    // Earth's water is only ~0.023% by mass — undetectable in Zeng M-R curves.
    // We infer ocean presence from thermodynamic stability (T, P) and assume
    // volatile delivery for rocky planets in the liquid-water stability region.
    // The volatile_fraction from composition scales the amount, but even a
    // trace volatile budget allows oceans at the right temperature/pressure.
    let ocean_fraction = if surface_temp_k > 273.0
        && surface_temp_k < 373.0
        && surface_pressure_bar > 0.01
    {
        // Liquid water thermodynamically stable on the surface.
        // Base: assume standard volatile delivery for rocky planets
        // (cometary + asteroid bombardment delivers ~0.01-0.1% H₂O by mass).
        let base_ocean = if composition.volatile_fraction > 0.1 {
            // Detected bulk water → scale directly
            (composition.volatile_fraction * 2.0).clamp(0.3, 0.85)
        } else if composition.volatile_fraction > 0.005 {
            // Trace water detected
            (composition.volatile_fraction * 5.0 + 0.2).clamp(0.2, 0.7)
        } else {
            // Below detection limit but conditions allow liquid water:
            // assume standard rocky-planet volatile delivery (Earth analog)
            0.5
        };
        // Atmospheric pressure boosts water retention
        let pressure_factor = (surface_pressure_bar / 1.0).min(1.5);
        (base_ocean * pressure_factor.sqrt()).clamp(0.0, 0.85)
    } else if surface_temp_k > 373.0 && surface_temp_k < 600.0
        && surface_pressure_bar > 0.01
    {
        // Near-boiling / supercritical: minimal surface liquid if any volatiles
        // Requires some atmospheric pressure to retain liquid
        if composition.volatile_fraction > 0.05 { 0.1 } else { 0.02 }
    } else {
        0.0
    };

    // ── Ice fraction ──
    let ice_fraction = if surface_temp_k < 273.0 && composition.volatile_fraction > 0.05 {
        (composition.volatile_fraction * 1.5).clamp(0.0, 0.90)
    } else if surface_temp_k < 300.0 && ocean_fraction > 0.0 {
        // Polar ice caps on temperate worlds
        ((300.0 - surface_temp_k) / 100.0 * 0.15).clamp(0.0, 0.20)
    } else {
        0.0
    };

    // ── Mountain height ──
    // Scales with surface gravity (inversely) and tectonic activity
    let g_surface = 9.81 * mass_earth / (radius_earth * radius_earth);
    let base_height = match tectonic_regime {
        TectonicRegime::MobileLid => 12.0,  // Earth-like
        TectonicRegime::Episodic => 15.0,   // Venus has tall mountains
        TectonicRegime::StagnantLid => 25.0, // Mars: Olympus Mons
        TectonicRegime::None => 0.0,
    };
    let mountain_height_km = base_height * (9.81 / g_surface);

    // ── Terrain roughness ──
    let tectonic_roughness = match tectonic_regime {
        TectonicRegime::MobileLid => 0.7,
        TectonicRegime::Episodic => 0.5,
        TectonicRegime::StagnantLid => 0.4 + crater_density * 0.3,
        TectonicRegime::None => 0.2,
    };

    GeologyParams {
        tectonic_regime,
        volcanism_level,
        crater_density,
        ocean_fraction,
        ice_fraction,
        mountain_height_km,
        tectonic_roughness,
    }
}

/// Determine tectonic regime from mass, age, and temperature.
fn infer_tectonic_regime(mass_earth: f64, age_gyr: f64, surface_temp_k: f64) -> TectonicRegime {
    // Very small bodies: always stagnant lid
    if mass_earth < 0.3 {
        return TectonicRegime::StagnantLid;
    }

    // Large rocky planets with moderate age: mobile lid (plate tectonics)
    // Earth-like conditions: 0.5-5 M⊕, age 1-10 Gyr
    if mass_earth >= 0.5 && mass_earth <= 5.0 && age_gyr >= 1.0 {
        // Venus case: similar mass to Earth but episodic due to thick atmosphere
        if surface_temp_k > 600.0 {
            return TectonicRegime::Episodic;
        }
        return TectonicRegime::MobileLid;
    }

    // Very massive super-earths: may have stagnant lid due to high pressure
    if mass_earth > 5.0 {
        return TectonicRegime::StagnantLid;
    }

    // Young planets: not yet developed tectonics
    if age_gyr < 1.0 {
        return TectonicRegime::StagnantLid;
    }

    TectonicRegime::StagnantLid
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_earth_geology() {
        let comp = BulkComposition {
            iron_fraction: 0.28,
            silicate_fraction: 0.50,
            volatile_fraction: 0.20,
            h_he_fraction: 0.02,
        };
        let geo = infer_geology(1.0, 1.0, 288.0, 1.0, &comp, "super-earth", 4.6);
        assert_eq!(geo.tectonic_regime, TectonicRegime::MobileLid);
        assert!(geo.ocean_fraction > 0.2);
        assert!(geo.volcanism_level > 0.0);
    }

    #[test]
    fn test_mars_geology() {
        let comp = BulkComposition {
            iron_fraction: 0.22,
            silicate_fraction: 0.65,
            volatile_fraction: 0.10,
            h_he_fraction: 0.0,
        };
        let geo = infer_geology(0.107, 0.532, 210.0, 0.006, &comp, "rocky", 4.6);
        assert_eq!(geo.tectonic_regime, TectonicRegime::StagnantLid);
        assert!(geo.crater_density > 0.5);
    }

    #[test]
    fn test_gas_giant_geology() {
        let comp = BulkComposition {
            iron_fraction: 0.02,
            silicate_fraction: 0.08,
            volatile_fraction: 0.15,
            h_he_fraction: 0.75,
        };
        let geo = infer_geology(318.0, 11.2, 165.0, 10000.0, &comp, "gas-giant", 4.6);
        assert_eq!(geo.tectonic_regime, TectonicRegime::None);
    }
}
