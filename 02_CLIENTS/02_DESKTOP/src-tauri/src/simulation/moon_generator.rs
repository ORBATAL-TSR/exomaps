//! Moon system generator.
//!
//! Generates realistic satellite systems around planets, constrained by:
//!   - Hill sphere stability (prograde moons within ~0.5 R_Hill)
//!   - Roche limit (no moons inside tidal disruption radius)
//!   - Mass budget (total moon mass ∝ planet mass)
//!   - Orbital spacing (mutual Hill radii, MMR placement)
//!   - Body class inference (regular vs irregular satellites)
//!
//! Each generated moon is a full `WorldBody` run through stages 1–7
//! of the pipeline (no recursive moon generation).
//!
//! References:
//!   - Canup & Ward (2006) — gas-starved disk model for regular satellites
//!   - Nesvorný et al. (2003) — irregular satellite capture
//!   - Heller & Barnes (2013) — habitable exomoons

use rand::Rng;
use rand_chacha::ChaCha8Rng;
use rand::SeedableRng;

use super::classification::{
    BodyClass, DynamicalClass, ClassificationBundle, ClassificationInput,
};
use super::world_body::*;
use super::world_gen_pipeline::WorldGenInput;
use super::formation_history;

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const M_EARTH_KG: f64 = 5.972e24;
const M_SUN_KG: f64 = 1.989e30;
const AU_M: f64 = 1.495978707e11;
const R_EARTH_M: f64 = 6.371e6;

/// Maximum total moon mass as fraction of parent mass.
/// Canup & Ward (2006): ~1e-4 for regular satellites around gas giants.
const REGULAR_MOON_MASS_RATIO: f64 = 1.0e-4;

/// Irregular satellites: individually smaller, wider distribution
const IRREGULAR_MOON_MAX_MASS: f64 = 0.001; // M_Earth

// ═══════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════

/// Generate a moon system for the given parent body.
pub fn generate_moons(
    parent_input: &WorldGenInput,
    parent: &WorldBody,
    rng: &mut ChaCha8Rng,
) -> Vec<WorldBody> {
    let hill_au = parent.orbit.hill_radius_au;
    let roche_au = parent.orbit.roche_limit_au;

    // No moons for very small bodies or rogue bodies with tiny Hill spheres
    if hill_au < 1e-5 || parent.physical.mass_earth < 0.01 {
        return vec![];
    }

    // Determine number of moons based on parent mass
    let (n_regular, n_irregular) = moon_count(parent, rng);
    let max_moons = parent_input.max_moons.min(20);
    let total = (n_regular + n_irregular).min(max_moons);

    if total == 0 {
        return vec![];
    }

    let mut moons = Vec::with_capacity(total);

    // ── Regular satellites ──
    // Formed in situ from circumplanetary disk.
    // Packed between Roche limit and ~0.05 Hill radii for gas giants,
    // or within ~0.2 Hill for rocky planets.
    let regular_outer = if parent.physical.h_he_fraction > 0.3 {
        hill_au * 0.05 // Galilean-like
    } else {
        hill_au * 0.2  // Earth-Moon like
    };

    let mass_budget = parent.physical.mass_earth * REGULAR_MOON_MASS_RATIO;
    let mut remaining_mass = mass_budget;

    for i in 0..n_regular.min(max_moons) {
        if remaining_mass < 1e-6 {
            break;
        }

        let frac = (i as f64 + 1.0) / (n_regular as f64 + 1.0);
        let moon_sma_au = roche_au + frac * (regular_outer - roche_au);

        // Mass distribution: largest moon gets ~40%, rest shared
        let moon_mass = if i == 0 && n_regular > 1 {
            remaining_mass * rng.gen_range(0.3..0.5)
        } else {
            remaining_mass * rng.gen_range(0.1..0.3)
        };
        let moon_mass = moon_mass.min(remaining_mass);
        remaining_mass -= moon_mass;

        let moon = build_moon(
            parent_input,
            parent,
            i,
            moon_sma_au,
            moon_mass,
            DynamicalClass::Regular,
            rng,
        );
        moons.push(moon);
    }

    // ── Irregular satellites ──
    // Captured objects on distant, often eccentric/inclined orbits.
    let irregular_inner = regular_outer * 2.0;
    let irregular_outer = hill_au * 0.5; // prograde stability limit

    for i in 0..n_irregular.min(max_moons.saturating_sub(moons.len())) {
        let frac = (i as f64 + 1.0) / (n_irregular as f64 + 1.0);
        let moon_sma_au = irregular_inner + frac * (irregular_outer - irregular_inner);
        let moon_mass = rng.gen_range(1e-6..IRREGULAR_MOON_MAX_MASS);

        let dyn_class = if rng.gen_bool(0.3) {
            DynamicalClass::Retrograde
        } else {
            DynamicalClass::Irregular
        };

        let moon = build_moon(
            parent_input,
            parent,
            n_regular + i,
            moon_sma_au,
            moon_mass,
            dyn_class,
            rng,
        );
        moons.push(moon);
    }

    moons
}

// ═══════════════════════════════════════════════════════
// Moon Count Heuristic
// ═══════════════════════════════════════════════════════

fn moon_count(parent: &WorldBody, rng: &mut ChaCha8Rng) -> (usize, usize) {
    let mass = parent.physical.mass_earth;

    if mass > 100.0 {
        // Jupiter / Saturn class
        let regular = rng.gen_range(3..7);
        let irregular = rng.gen_range(2..8);
        (regular, irregular)
    } else if mass > 10.0 {
        // Neptune / Uranus class
        let regular = rng.gen_range(1..4);
        let irregular = rng.gen_range(1..5);
        (regular, irregular)
    } else if mass > 0.5 {
        // Earth / super-Earth class
        let regular = if rng.gen_bool(0.6) { 1 } else { 0 };
        let irregular = if rng.gen_bool(0.2) { 1 } else { 0 };
        (regular, irregular)
    } else if mass > 0.01 {
        // Mars-class
        let regular = if rng.gen_bool(0.3) { rng.gen_range(0..3) } else { 0 };
        (regular, 0)
    } else {
        (0, 0)
    }
}

// ═══════════════════════════════════════════════════════
// Moon Builder
// ═══════════════════════════════════════════════════════

fn build_moon(
    parent_input: &WorldGenInput,
    parent: &WorldBody,
    moon_index: usize,
    sma_au: f64,
    mass_earth: f64,
    dyn_class: DynamicalClass,
    rng: &mut ChaCha8Rng,
) -> WorldBody {
    let moon_seed = parent_input.seed.wrapping_add(1000 + moon_index as u64);
    let mut moon_rng = ChaCha8Rng::seed_from_u64(moon_seed);

    // Scaffold
    let mut moon = WorldBody::scaffold(
        &parent_input.system_id,
        parent_input.body_index * 100 + moon_index + 1,
        moon_seed,
        BodyClass::Moon,
    );

    moon.name = format!("{} {}", parent.name, roman_numeral(moon_index + 1));

    // Star context (inherited from parent)
    moon.star = parent.star.clone();

    // Orbital elements (around parent, not star — but stored in same struct)
    let ecc = match dyn_class {
        DynamicalClass::Regular => rng.gen_range(0.0..0.05),
        DynamicalClass::Irregular => rng.gen_range(0.1..0.5),
        DynamicalClass::Retrograde => rng.gen_range(0.1..0.6),
        _ => rng.gen_range(0.0..0.1),
    };
    let inc = match dyn_class {
        DynamicalClass::Regular => rng.gen_range(0.0..5.0),
        DynamicalClass::Irregular => rng.gen_range(20.0..60.0),
        DynamicalClass::Retrograde => rng.gen_range(140.0..180.0),
        _ => rng.gen_range(0.0..15.0),
    };

    // Period around parent (Kepler)
    let parent_mass_kg = parent.physical.mass_earth * M_EARTH_KG;
    let sma_m = sma_au * AU_M;
    let period_s = 2.0 * std::f64::consts::PI
        * (sma_m.powi(3) / (6.67430e-11 * parent_mass_kg)).sqrt();
    let period_days = period_s / 86400.0;

    // Most regular moons are tidally locked
    let is_locked = matches!(dyn_class, DynamicalClass::Regular);

    moon.orbit = OrbitalElements {
        sma_au,
        eccentricity: ecc,
        inclination_deg: inc,
        longitude_ascending_deg: rng.gen_range(0.0..360.0),
        argument_periapsis_deg: rng.gen_range(0.0..360.0),
        period_days,
        true_anomaly_deg: rng.gen_range(0.0..360.0),
        obliquity_deg: if is_locked { 0.0 } else { rng.gen_range(0.0..30.0) },
        rotation_period_hours: if is_locked { period_days * 24.0 } else { rng.gen_range(5.0..100.0) },
        is_tidally_locked: is_locked,
        hill_radius_au: 0.0, // negligible for moons
        roche_limit_au: 0.0,
    };

    // Physical properties
    let radius = estimate_moon_radius(mass_earth);
    let vol = radius.powi(3);
    let density = (mass_earth / vol) * 5514.0;

    // Composition depends on formation location
    let (iron_frac, sil_frac, vol_frac) = if sma_au < parent.orbit.hill_radius_au * 0.02 {
        // Inner: more rocky (Io-like)
        (0.15 + rng.gen_range(0.0..0.1), 0.65, 0.05)
    } else if sma_au < parent.orbit.hill_radius_au * 0.1 {
        // Middle: mixed (Europa/Ganymede)
        (0.08, 0.40, 0.45 + rng.gen_range(0.0..0.1))
    } else {
        // Outer: icy (Callisto/Titan)
        (0.05, 0.25, 0.65 + rng.gen_range(0.0..0.1))
    };

    // Tidal heating (proximity to parent)
    let tidal_heating = if is_locked && sma_au < parent.orbit.hill_radius_au * 0.05 {
        // Io-like intense tidal heating
        ecc * parent.physical.mass_earth * 0.5 / (sma_au * 1000.0).powi(3)
    } else {
        0.0
    };

    moon.physical = PhysicalProperties {
        mass_earth,
        radius_earth: radius,
        density_kg_m3: density,
        surface_gravity_m_s2: 9.81 * mass_earth / radius.powi(2),
        escape_velocity_km_s: 11.186 * (mass_earth / radius).sqrt(),
        bond_albedo: if vol_frac > 0.3 { 0.5 + rng.gen_range(0.0..0.3) } else { 0.1 + rng.gen_range(0.0..0.2) },
        age_gyr: parent.physical.age_gyr,
        iron_fraction: iron_frac,
        silicate_fraction: sil_frac,
        volatile_fraction: vol_frac,
        h_he_fraction: 0.0, // moons don't retain H/He
        magnetic_field_ut: if mass_earth > 0.01 && iron_frac > 0.1 { rng.gen_range(0.0..5.0) } else { 0.0 },
        has_magnetic_field: mass_earth > 0.01 && iron_frac > 0.15 && rng.gen_bool(0.2),
    };

    // Formation history
    moon.formation = formation_history::generate_formation(
        &BodyClass::Moon,
        sma_au,
        mass_earth,
        parent.star.teff_k,
        parent.physical.age_gyr,
        &mut moon_rng,
    );

    // Equilibrium temperature (from star, not parent — simplified)
    let stellar_flux = parent.star.luminosity_solar * 3.828e26
        / (4.0 * std::f64::consts::PI * (parent.orbit.sma_au * AU_M).powi(2));
    let t_eq = (stellar_flux * (1.0 - moon.physical.bond_albedo)
        / (4.0 * 5.670374419e-8))
        .powf(0.25);

    // Add tidal heating contribution
    let t_surface = (t_eq.powi(4) + tidal_heating * 1e12).powf(0.25);
    moon.surface.surface_temp_k = t_surface;

    // Thin atmosphere for larger moons
    if mass_earth > 0.01 && moon.physical.escape_velocity_km_s > 1.0 {
        let pressure = (mass_earth * 0.1).min(1.5);
        if pressure > 0.001 {
            let mag_shield: f64 = if moon.physical.has_magnetic_field { 0.8 } else { 0.0 };
            // Basic atmosphere column
            moon.atmosphere = Some(AtmosphereProfile {
                surface_pressure_bar: pressure,
                surface_temp_k: t_surface,
                equilibrium_temp_k: t_eq,
                scale_height_km: 15.0,
                mean_molecular_weight: 28.0,
                dominant_gas: "N2".into(),
                greenhouse_factor: 1.0,
                column: vec![],
                cloud_decks: vec![],
                circulation: AtmosphericCirculation {
                    pattern: CirculationPattern::HadleyCell,
                    wind_bands: vec![],
                    hadley_cells: 1,
                    max_wind_speed_m_s: 5.0,
                },
                rayleigh_color: [0.3, 0.4, 0.6],
                escape: AtmosphericEscape {
                    jeans_parameter: 10.0,
                    mass_loss_rate_kg_s: 0.0,
                    xuv_escape_rate_kg_s: 0.0,
                    cumulative_loss_earth_masses: 0.0,
                    hydrodynamic_escape: false,
                    retention_fraction: 0.9,
                    magnetic_shielding: mag_shield,
                },
                optical: AtmosphereOptics {
                    rayleigh_beta: pressure * 0.01,
                    mie_beta: 0.001,
                    absorption_beta: 0.0005,
                    optical_depth_zenith: pressure * 0.5,
                    sunset_color: [0.8, 0.5, 0.2],
                    zenith_color: [0.3, 0.4, 0.6],
                    horizon_color: [0.5, 0.5, 0.6],
                },
            });
        }
    }

    // Run classification on the moon
    let pressure = moon.atmosphere.as_ref()
        .map(|a| a.surface_pressure_bar)
        .unwrap_or(0.0);

    let geo_input = crate::BulkComposition {
        iron_fraction: moon.physical.iron_fraction,
        silicate_fraction: moon.physical.silicate_fraction,
        volatile_fraction: moon.physical.volatile_fraction,
        h_he_fraction: 0.0,
    };
    let geology = super::geology::infer_geology(
        mass_earth, radius, t_surface, pressure, &geo_input, "moon", parent.physical.age_gyr,
    );

    moon.surface.volcanism_level = geology.volcanism_level;
    moon.surface.crater_density = geology.crater_density;
    moon.surface.tectonic_roughness = geology.tectonic_roughness;
    moon.surface.mountain_height_km = geology.mountain_height_km;

    // Ice / ocean fractions for icy moons
    if vol_frac > 0.3 && t_surface < 273.0 {
        moon.surface.ice_fraction = rng.gen_range(0.5..0.95);
        moon.surface.desert_fraction = 1.0 - moon.surface.ice_fraction;
    }

    // Classification
    let class_input = ClassificationInput {
        body_class: BodyClass::Moon,
        dynamical_class: if is_locked { DynamicalClass::TidallyLocked } else { dyn_class },
        mass_earth,
        radius_earth: radius,
        surface_temp_k: t_surface,
        surface_pressure_bar: pressure,
        iron_fraction: iron_frac,
        silicate_fraction: sil_frac,
        volatile_fraction: vol_frac,
        h_he_fraction: 0.0,
        ocean_fraction: moon.surface.ocean_fraction,
        ice_fraction: moon.surface.ice_fraction,
        tectonic_regime: geology.tectonic_regime,
        volcanism_level: geology.volcanism_level,
        in_habitable_zone: false, // moons inherit parent HZ
        is_atmosphere_stripped: moon.atmosphere.is_none() && mass_earth > 0.01,
        is_runaway_greenhouse: false,
        tidal_heating_w_m2: tidal_heating,
        has_magnetic_field: moon.physical.has_magnetic_field,
        eccentricity: ecc,
        age_gyr: parent.physical.age_gyr,
        star_teff: parent.star.teff_k,
    };
    moon.classification = ClassificationBundle::classify(&class_input);

    // Build render profile
    moon.render = super::render_profile_builder::build_render_profile(&moon);

    moon
}

/// Estimate moon radius from mass (rocky/icy scaling).
fn estimate_moon_radius(mass_earth: f64) -> f64 {
    if mass_earth < 0.001 {
        // Very small: irregular shape
        mass_earth.powf(0.33)
    } else {
        // Rocky/icy moon: R ∝ M^0.27 (similar to rocky planets)
        mass_earth.powf(0.27)
    }
}

/// Convert index to Roman numeral (I–XX).
fn roman_numeral(n: usize) -> &'static str {
    match n {
        1 => "I", 2 => "II", 3 => "III", 4 => "IV", 5 => "V",
        6 => "VI", 7 => "VII", 8 => "VIII", 9 => "IX", 10 => "X",
        11 => "XI", 12 => "XII", 13 => "XIII", 14 => "XIV", 15 => "XV",
        16 => "XVI", 17 => "XVII", 18 => "XVIII", 19 => "XIX", 20 => "XX",
        _ => "?",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_parent() -> (WorldGenInput, WorldBody) {
        let input = WorldGenInput {
            system_id: "TEST_SYS".into(),
            body_index: 0,
            seed: 42,
            star_teff_k: 5778.0,
            star_luminosity_solar: 1.0,
            star_mass_solar: 1.0,
            star_spectral_type: "G2V".into(),
            star_age_gyr: 4.6,
            star_activity_level: 0.3,
            star_distance_pc: 10.0,
            sma_au: 5.2,
            eccentricity: 0.048,
            inclination_deg: 1.3,
            obliquity_deg: 3.1,
            mass_earth: Some(318.0),
            radius_earth: Some(11.2),
            planet_type_hint: Some("gas-giant".into()),
            body_class_hint: Some(BodyClass::Planet),
            dynamical_class_hint: None,
            generate_moons: true,
            max_moons: 10,
        };

        let mut body = WorldBody::scaffold("TEST_SYS", 0, 42, BodyClass::Planet);
        body.physical.mass_earth = 318.0;
        body.physical.radius_earth = 11.2;
        body.physical.h_he_fraction = 0.85;
        body.physical.density_kg_m3 = 1326.0;
        body.orbit.hill_radius_au = 0.355;
        body.orbit.roche_limit_au = 0.001;
        body.orbit.sma_au = 5.2;
        body.star.teff_k = 5778.0;
        body.star.luminosity_solar = 1.0;

        (input, body)
    }

    #[test]
    fn test_jupiter_like_moons() {
        let (input, parent) = test_parent();
        let mut rng = ChaCha8Rng::seed_from_u64(42);
        let moons = generate_moons(&input, &parent, &mut rng);

        assert!(!moons.is_empty(), "Jupiter-like planet should have moons");
        assert!(moons.len() <= 10, "Should respect max_moons");

        for moon in &moons {
            assert!(matches!(moon.classification.body_class, BodyClass::Moon));
            assert!(moon.physical.mass_earth < parent.physical.mass_earth);
        }
    }

    #[test]
    fn test_small_body_no_moons() {
        let input = WorldGenInput {
            system_id: "TINY".into(),
            body_index: 0,
            seed: 1,
            star_teff_k: 5778.0,
            star_luminosity_solar: 1.0,
            star_mass_solar: 1.0,
            star_spectral_type: "G2V".into(),
            star_age_gyr: 4.6,
            star_activity_level: 0.3,
            star_distance_pc: 10.0,
            sma_au: 2.5,
            eccentricity: 0.1,
            inclination_deg: 5.0,
            obliquity_deg: 10.0,
            mass_earth: Some(0.001),
            radius_earth: Some(0.08),
            planet_type_hint: Some("asteroid".into()),
            body_class_hint: Some(BodyClass::DwarfPlanet),
            dynamical_class_hint: None,
            generate_moons: true,
            max_moons: 5,
        };

        let mut body = WorldBody::scaffold("TINY", 0, 1, BodyClass::DwarfPlanet);
        body.physical.mass_earth = 0.001;
        body.orbit.hill_radius_au = 1e-6;

        let mut rng = ChaCha8Rng::seed_from_u64(1);
        let moons = generate_moons(&input, &body, &mut rng);
        assert!(moons.is_empty(), "Tiny body should have no moons");
    }
}
