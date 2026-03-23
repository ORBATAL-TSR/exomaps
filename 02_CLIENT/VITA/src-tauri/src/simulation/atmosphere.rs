//! Atmospheric modeling — backward-compatible wrapper.
//!
//! Delegates to `atmosphere_v2` which implements the full
//! radiative-convective equilibrium solver.

use crate::{AtmosphereSummary, BulkComposition};

/// Model the atmosphere of a planet from its physical context.
/// Delegates to the v2 radiative-convective solver.
pub fn model_atmosphere(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    star_luminosity: f64,
    star_teff: f64,
    _composition: &BulkComposition,
    planet_type: &str,
) -> AtmosphereSummary {
    super::atmosphere_v2::model_atmosphere(
        mass_earth,
        radius_earth,
        sma_au,
        star_luminosity,
        star_teff,
        _composition,
        planet_type,
    )
}
