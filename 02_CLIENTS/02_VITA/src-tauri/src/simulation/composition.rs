//! Bulk composition inference — backward-compatible wrapper.
//!
//! Delegates to `composition_v2` which uses EOS-based mass-radius
//! interpolation (Zeng et al. 2019, Birch-Murnaghan EOS).

use crate::BulkComposition;

/// Infer bulk composition from observable planet parameters.
/// Delegates to the v2 EOS-based solver.
pub fn infer_composition(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    planet_type: &str,
) -> BulkComposition {
    super::composition_v2::infer_composition(mass_earth, radius_earth, sma_au, planet_type)
}
