//! 10-stage world generation pipeline.
//!
//! Orchestrates the full generation of a `WorldBody` from stellar context
//! + orbital parameters, invoking every simulation module in the correct
//! causal order:
//!
//!   Stage 1 — System context (stellar parameters, HZ bounds)
//!   Stage 2 — Body origin & formation history
//!   Stage 3 — Bulk composition (EOS solver)
//!   Stage 4 — Mass / radius → interior structure
//!   Stage 5 — Thermal & atmospheric evolution
//!   Stage 6 — Surface state (geology + climate)
//!   Stage 7 — Multi-axis classification (10 axes)
//!   Stage 8 — Moon system generation
//!   Stage 9 — Render profile assembly
//!   Stage 10 — Colonization assessment
//!
//! Each stage reads outputs from previous stages and writes into the
//! mutable `WorldBody` scaffold.  The pipeline is deterministic for a
//! given seed.

use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

use super::classification::{
    BodyClass, ClassificationBundle, ClassificationInput, DynamicalClass,
};
use super::world_body::*;
use super::formation_history;
use super::moon_generator;
use super::render_profile_builder;
use super::colonization_profile;

// ═══════════════════════════════════════════════════════
// Pipeline Input
// ═══════════════════════════════════════════════════════

/// Everything needed to kick off world generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldGenInput {
    /// Unique star system identifier (e.g. "HD_219134")
    pub system_id: String,
    /// Index of this body in the system (0 = innermost)
    pub body_index: usize,
    /// Master seed (drives all RNG)
    pub seed: u64,

    // ── Stellar context ──
    pub star_teff_k: f64,
    pub star_luminosity_solar: f64,
    pub star_mass_solar: f64,
    pub star_spectral_type: String,
    pub star_age_gyr: f64,
    pub star_activity_level: f64,
    pub star_distance_pc: f64,
    /// Stellar metallicity [Fe/H] relative to solar (solar = 0.0).
    /// Drives iron core fraction, volatile delivery, and giant planet probability.
    /// Source: exoplanet catalog or GAIA GSP-Phot. Defaults to 0.0 if unavailable.
    /// Range: roughly -2.5 (metal-poor) to +0.5 (metal-rich).
    #[serde(default)]   // 0.0 = solar metallicity when field absent in JSON
    pub star_metallicity_feh: f64,

    // ── Orbital elements ──
    pub sma_au: f64,
    pub eccentricity: f64,
    pub inclination_deg: f64,
    pub obliquity_deg: f64,

    // ── Body hints (from catalog or user) ──
    pub mass_earth: Option<f64>,
    pub radius_earth: Option<f64>,
    pub planet_type_hint: Option<String>,
    pub body_class_hint: Option<BodyClass>,
    pub dynamical_class_hint: Option<DynamicalClass>,

    // ── Moon generation control ──
    pub generate_moons: bool,
    pub max_moons: usize,
}

/// Pipeline output — the completed world body + metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldGenResult {
    pub body: WorldBody,
    pub moons: Vec<WorldBody>,
    pub pipeline_time_ms: f64,
    pub stages_completed: Vec<String>,
}

// ═══════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════

const M_EARTH_KG: f64 = 5.972e24;
const R_EARTH_M: f64 = 6.371e6;
const G: f64 = 6.67430e-11;
const SIGMA_SB: f64 = 5.670374419e-8;
const L_SUN: f64 = 3.828e26;
const AU_M: f64 = 1.495978707e11;
const PI: f64 = std::f64::consts::PI;

// ═══════════════════════════════════════════════════════
// Main Pipeline Entry
// ═══════════════════════════════════════════════════════

/// Generate a complete `WorldBody` from input parameters through the
/// 10-stage pipeline.  Deterministic for a given seed.
pub fn generate_world(input: &WorldGenInput) -> WorldGenResult {
    let t0 = std::time::Instant::now();
    let mut stages: Vec<String> = Vec::with_capacity(10);

    let body_class = input.body_class_hint.unwrap_or(BodyClass::Planet);

    // Create scaffold
    let mut body = WorldBody::scaffold(
        &input.system_id,
        input.body_index,
        input.seed,
        body_class,
    );

    // Master RNG
    let mut rng = ChaCha8Rng::seed_from_u64(input.seed);

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 1 — System Context
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_1_system_context(input, &mut body);
    stages.push("system_context".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 2 — Formation History (origin)
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_2_formation(&mut body, &mut rng);
    stages.push("formation_history".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 3 — Bulk Composition
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_3_composition(input, &mut body, &mut rng);
    stages.push("bulk_composition".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 4 — Mass / Radius / Interior
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_4_interior(input, &mut body);
    stages.push("interior_structure".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 5 — Thermal / Atmosphere
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_5_atmosphere(input, &mut body, &mut rng);
    stages.push("atmosphere".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 6 — Surface State (geology + climate)
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_6_surface(input, &mut body, &mut rng);
    stages.push("surface_state".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 7 — Classification (10-axis)
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_7_classification(&mut body);
    stages.push("classification".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 8 — Moon System
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    let moons = if input.generate_moons {
        stage_8_moons(input, &body, &mut rng)
    } else {
        vec![]
    };
    stages.push("moon_system".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 9 — Render Profile
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_9_render(&mut body);
    stages.push("render_profile".into());

    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    // Stage 10 — Colonization Assessment
    // ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    stage_10_colonization(&mut body);
    stages.push("colonization".into());

    // Record moon IDs
    body.children = moons.iter().map(|m| m.id.clone()).collect();

    let elapsed = t0.elapsed();
    WorldGenResult {
        body,
        moons,
        pipeline_time_ms: elapsed.as_secs_f64() * 1000.0,
        stages_completed: stages,
    }
}

// ═══════════════════════════════════════════════════════
// Stage 1 — System Context
// ═══════════════════════════════════════════════════════

fn stage_1_system_context(input: &WorldGenInput, body: &mut WorldBody) {
    // Populate star context
    body.star = StarContext {
        teff_k: input.star_teff_k,
        luminosity_solar: input.star_luminosity_solar,
        mass_solar: input.star_mass_solar,
        spectral_type: input.star_spectral_type.clone(),
        age_gyr: input.star_age_gyr,
        activity_level: input.star_activity_level,
        xuv_fraction: estimate_xuv_fraction(input.star_teff_k, input.star_age_gyr),
        is_flare_star: input.star_teff_k < 3500.0 && input.star_activity_level > 0.5,
        distance_pc: input.star_distance_pc,
    };

    // Populate orbital elements
    let period_days = kepler_period(input.sma_au, input.star_mass_solar);
    let rotation_hours = estimate_rotation(input.sma_au, input.eccentricity, period_days);
    let is_tidally_locked = is_tidal_lock_likely(
        input.sma_au, input.star_mass_solar, input.star_age_gyr,
    );
    let hill_r = hill_radius(input.sma_au, body.physical.mass_earth, input.star_mass_solar);
    let roche_r = roche_limit(body.physical.radius_earth, body.physical.density_kg_m3, 3000.0);

    body.orbit = OrbitalElements {
        sma_au: input.sma_au,
        eccentricity: input.eccentricity,
        inclination_deg: input.inclination_deg,
        longitude_ascending_deg: 0.0,
        argument_periapsis_deg: 0.0,
        period_days,
        true_anomaly_deg: 0.0,
        obliquity_deg: input.obliquity_deg,
        rotation_period_hours: if is_tidally_locked {
            period_days * 24.0
        } else {
            rotation_hours
        },
        is_tidally_locked,
        hill_radius_au: hill_r,
        roche_limit_au: roche_r,
    };

    // Set body age from star age (with small scatter)
    body.physical.age_gyr = input.star_age_gyr;
    body.formation.age_gyr = input.star_age_gyr;
}

// ═══════════════════════════════════════════════════════
// Stage 2 — Formation History
// ═══════════════════════════════════════════════════════

fn stage_2_formation(body: &mut WorldBody, rng: &mut ChaCha8Rng) {
    body.formation = formation_history::generate_formation(
        &body.classification.body_class,
        body.orbit.sma_au,
        body.physical.mass_earth,
        body.star.teff_k,
        body.star.age_gyr,
        rng,
    );
}

// ═══════════════════════════════════════════════════════
// Stage 3 — Bulk Composition
// ═══════════════════════════════════════════════════════

fn stage_3_composition(
    input: &WorldGenInput,
    body: &mut WorldBody,
    rng: &mut ChaCha8Rng,
) {
    use rand::Rng;

    // Use provided mass or estimate from radius/type
    let mass = input.mass_earth.unwrap_or_else(|| {
        estimate_mass_from_context(input.sma_au, input.star_mass_solar, rng)
    });
    let radius = input.radius_earth.unwrap_or_else(|| {
        estimate_radius_from_mass(mass)
    });

    // Run the EOS composition solver — metallicity modifies iron core fraction
    // and volatile delivery via the Fischer & Valenti (2005) [Fe/H] law.
    let planet_type = input.planet_type_hint
        .as_deref()
        .unwrap_or("terrestrial");
    let comp = super::composition_v2::infer_composition_with_metallicity(
        mass, radius, input.sma_au, planet_type,
        input.star_metallicity_feh,
    );

    // Apply formation pathway modifiers
    let (iron_mod, vol_mod) = formation_composition_modifier(&body.formation.pathway);
    let iron = (comp.iron_fraction * iron_mod).clamp(0.0, 0.95);
    let volatile = (comp.volatile_fraction * vol_mod).clamp(0.0, 0.95);
    let silicate = (1.0 - iron - volatile - comp.h_he_fraction).max(0.0);

    body.physical.mass_earth = mass;
    body.physical.radius_earth = radius;
    body.physical.iron_fraction = iron;
    body.physical.silicate_fraction = silicate;
    body.physical.volatile_fraction = volatile;
    body.physical.h_he_fraction = comp.h_he_fraction;

    // Derived quantities
    let volume_ratio = radius.powi(3);
    body.physical.density_kg_m3 = (mass / volume_ratio) * 5514.0; // relative to Earth
    body.physical.surface_gravity_m_s2 = 9.81 * mass / radius.powi(2);
    body.physical.escape_velocity_km_s =
        11.186 * (mass / radius).sqrt();

    // Magnetic field estimate (mass + iron fraction + rotation)
    let rot_factor = if body.orbit.is_tidally_locked { 0.2 } else { 1.0 };
    let field_strength = 50.0 * iron * mass.powf(0.6) * rot_factor
        * (1.0 / (body.physical.age_gyr / 4.6 + 0.1));
    body.physical.magnetic_field_ut = field_strength;
    body.physical.has_magnetic_field = field_strength > 5.0;

    // Albedo from composition
    body.physical.bond_albedo = estimate_albedo(iron, silicate, volatile, comp.h_he_fraction);
}

// ═══════════════════════════════════════════════════════
// Stage 4 — Interior Structure
// ═══════════════════════════════════════════════════════

fn stage_4_interior(input: &WorldGenInput, body: &mut WorldBody) {
    // Run the 4-layer interior solver
    let interior_input = super::interior::InteriorInput {
        mass_earth: body.physical.mass_earth,
        radius_earth: body.physical.radius_earth,
        core_mass_fraction: body.physical.iron_fraction,
        mantle_mass_fraction: body.physical.silicate_fraction,
        water_mass_fraction: body.physical.volatile_fraction,
        envelope_mass_fraction: body.physical.h_he_fraction,
    };
    let profile = super::interior::solve_interior(&interior_input);

    // Convert the radial profile into cross-section layers
    let mut layers = Vec::new();
    let total_r = body.physical.radius_earth * R_EARTH_M / 1000.0; // km

    let central_temp = profile.summary.central_temperature_k;
    let central_pres = profile.summary.central_pressure_gpa;
    let cmb_pres = profile.summary.cmb_pressure_gpa;

    // Iron core
    if body.physical.iron_fraction > 0.01 {
        let core_r = total_r * body.physical.iron_fraction.powf(0.35);
        let inner_core_r = core_r * 0.4;

        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::InnerCore,
            name: "Inner Core".to_string(),
            inner_radius_km: 0.0,
            outer_radius_km: inner_core_r,
            inner_temp_k: central_temp,
            outer_temp_k: central_temp * 0.95,
            inner_pressure_gpa: central_pres,
            outer_pressure_gpa: central_pres * 0.85,
            density_kg_m3: profile.summary.central_density_kg_m3,
            material: "ε-Fe (hcp)".to_string(),
            color: [0.8, 0.7, 0.4, 1.0],
            is_convecting: false,
            is_liquid: false,
        });

        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::OuterCore,
            name: "Outer Core".to_string(),
            inner_radius_km: inner_core_r,
            outer_radius_km: core_r,
            inner_temp_k: central_temp * 0.95,
            outer_temp_k: central_temp * 0.8,
            inner_pressure_gpa: central_pres * 0.85,
            outer_pressure_gpa: cmb_pres,
            density_kg_m3: profile.summary.central_density_kg_m3 * 0.85,
            material: "Fe-Ni liquid".to_string(),
            color: [0.9, 0.6, 0.2, 1.0],
            is_convecting: true,
            is_liquid: true,
        });
    }

    // Silicate mantle
    if body.physical.silicate_fraction > 0.01 {
        let mantle_base = layers.last()
            .map(|l| l.outer_radius_km)
            .unwrap_or(0.0);
        let mantle_top = total_r * (1.0 - body.physical.volatile_fraction.powf(0.3) * 0.15);
        let mid = (mantle_base + mantle_top) / 2.0;

        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::LowerMantle,
            name: "Lower Mantle".to_string(),
            inner_radius_km: mantle_base,
            outer_radius_km: mid,
            inner_temp_k: 4000.0,
            outer_temp_k: 3000.0,
            inner_pressure_gpa: cmb_pres * 0.5,
            outer_pressure_gpa: 25.0,
            density_kg_m3: 5000.0,
            material: "MgSiO₃ post-perovskite".to_string(),
            color: [0.6, 0.25, 0.1, 1.0],
            is_convecting: true,
            is_liquid: false,
        });

        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::UpperMantle,
            name: "Upper Mantle".to_string(),
            inner_radius_km: mid,
            outer_radius_km: mantle_top,
            inner_temp_k: 3000.0,
            outer_temp_k: 1500.0,
            inner_pressure_gpa: 25.0,
            outer_pressure_gpa: 1.0,
            density_kg_m3: 3800.0,
            material: "MgSiO₃ perovskite + olivine".to_string(),
            color: [0.7, 0.35, 0.15, 1.0],
            is_convecting: true,
            is_liquid: false,
        });
    }

    // Water/ice layer
    if body.physical.volatile_fraction > 0.05 {
        let base = layers.last()
            .map(|l| l.outer_radius_km)
            .unwrap_or(0.0);
        let ice_top = total_r * 0.97;

        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::HighPressureIce,
            name: "High Pressure Ice".to_string(),
            inner_radius_km: base,
            outer_radius_km: ice_top,
            inner_temp_k: 800.0,
            outer_temp_k: 300.0,
            inner_pressure_gpa: 5.0,
            outer_pressure_gpa: 0.1,
            density_kg_m3: 1500.0,
            material: "Ice VII / X".to_string(),
            color: [0.6, 0.7, 0.9, 0.8],
            is_convecting: false,
            is_liquid: false,
        });
    }

    // Crust
    let crust_base = layers.last()
        .map(|l| l.outer_radius_km)
        .unwrap_or(0.0);
    if crust_base < total_r {
        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::Crust,
            name: "Crust".to_string(),
            inner_radius_km: crust_base,
            outer_radius_km: total_r,
            inner_temp_k: 1000.0,
            outer_temp_k: body.surface.surface_temp_k.max(200.0),
            inner_pressure_gpa: 0.5,
            outer_pressure_gpa: 0.001,
            density_kg_m3: 2800.0,
            material: "Silicate crust".to_string(),
            color: [0.5, 0.4, 0.35, 1.0],
            is_convecting: false,
            is_liquid: false,
        });
    }

    // Gas giants: add H/He envelope + metallic hydrogen
    if body.physical.h_he_fraction > 0.1 {
        let metallic_h_top = total_r * 0.6;

        // Metallic hydrogen zone (deep interior of gas giants)
        if body.physical.mass_earth > 50.0 {
            layers.push(InteriorLayer {
                layer_type: InteriorLayerType::MetallicHydrogen,
                name: "Metallic Hydrogen".to_string(),
                inner_radius_km: layers.last()
                    .map(|l| l.outer_radius_km)
                    .unwrap_or(0.0),
                outer_radius_km: metallic_h_top,
                inner_temp_k: 20000.0,
                outer_temp_k: 10000.0,
                inner_pressure_gpa: 300.0,
                outer_pressure_gpa: 100.0,
                density_kg_m3: 1300.0,
                material: "Metallic hydrogen".to_string(),
                color: [0.5, 0.5, 0.6, 0.9],
                is_convecting: true,
                is_liquid: true,
            });
        }

        layers.push(InteriorLayer {
            layer_type: InteriorLayerType::MolecularHydrogen,
            name: "H₂/He Envelope".to_string(),
            inner_radius_km: total_r * 0.7,
            outer_radius_km: total_r,
            inner_temp_k: 2000.0,
            outer_temp_k: 200.0,
            inner_pressure_gpa: 1.0,
            outer_pressure_gpa: 0.0001,
            density_kg_m3: 100.0,
            material: "H₂/He gas envelope".to_string(),
            color: [0.85, 0.8, 0.7, 0.4],
            is_convecting: true,
            is_liquid: false,
        });
    }

    body.interior = Some(InteriorCrossSection {
        layers,
        central_pressure_gpa: central_pres,
        central_temperature_k: central_temp,
        converged: true,
    });
}

// ═══════════════════════════════════════════════════════
// Stage 5 — Atmosphere
// ═══════════════════════════════════════════════════════

fn stage_5_atmosphere(
    input: &WorldGenInput,
    body: &mut WorldBody,
    rng: &mut ChaCha8Rng,
) {
    use rand::Rng;

    // Equilibrium temperature
    let stellar_flux = body.star.luminosity_solar * L_SUN
        / (4.0 * PI * (body.orbit.sma_au * AU_M).powi(2));
    let t_eq = (stellar_flux * (1.0 - body.physical.bond_albedo)
        / (4.0 * SIGMA_SB))
        .powf(0.25);

    // Decide if body retains atmosphere
    let escape_param = body.physical.escape_velocity_km_s / (t_eq / 1000.0);
    let has_atmosphere = escape_param > 2.0 || body.physical.h_he_fraction > 0.05;

    if !has_atmosphere {
        body.surface.surface_temp_k = t_eq;
        body.atmosphere = None;
        return;
    }

    // Estimate surface pressure (empirical)
    let base_pressure = if body.physical.h_he_fraction > 0.3 {
        1000.0 // gas giant deep atmosphere
    } else if body.physical.volatile_fraction > 0.3 {
        10.0 + rng.gen_range(0.0..50.0) // ocean world
    } else {
        let mass_factor = body.physical.mass_earth.powf(0.8);
        let age_factor = (1.0 / (body.physical.age_gyr + 0.5)).min(2.0);
        (mass_factor * age_factor * 2.0).clamp(0.001, 200.0)
    };

    // Greenhouse effect (simplified)
    let greenhouse_factor = 1.0 + (base_pressure.ln().max(0.0) * 0.12);
    let surface_temp = t_eq * greenhouse_factor;
    body.surface.surface_temp_k = surface_temp;

    // Build vertical column
    let n_layers = 16;
    let mut column = Vec::with_capacity(n_layers);
    let scale_height_km = (R_EARTH_M * body.physical.radius_earth / 1000.0)
        * surface_temp / (body.physical.surface_gravity_m_s2 * 29.0 / 8.314 * 1000.0);
    let scale_h = scale_height_km.max(5.0).min(500.0);

    for i in 0..n_layers {
        let frac = i as f64 / (n_layers - 1) as f64;
        let alt_km = frac * scale_h * 6.0; // up to ~6 scale heights
        let pressure = base_pressure * (-alt_km / scale_h).exp();
        let temp = surface_temp * (1.0 - 0.3 * frac).max(0.15);
        let density = pressure * 100000.0 / (287.0 * temp); // ideal gas approx

        let region = if frac < 0.15 {
            AtmosphereRegion::Troposphere
        } else if frac < 0.35 {
            AtmosphereRegion::Troposphere
        } else if frac < 0.6 {
            AtmosphereRegion::Stratosphere
        } else if frac < 0.85 {
            AtmosphereRegion::Mesosphere
        } else {
            AtmosphereRegion::Thermosphere
        };

        column.push(AtmosphereColumnLayer {
            altitude_km: alt_km,
            pressure_bar: pressure,
            temperature_k: temp,
            density_kg_m3: density,
            region,
            mixing_ratios: vec![],
        });
    }

    // Cloud decks
    let cloud_decks = infer_cloud_decks(surface_temp, base_pressure, body);

    // Circulation patterns
    let circulation = infer_circulation(body);

    // Atmospheric escape
    let jeans_param = body.physical.escape_velocity_km_s.powi(2)
        * 1e6 / (2.0 * 1.381e-23 / (29.0 * 1.66e-27) * surface_temp);
    let xuv_flux = body.star.xuv_fraction * stellar_flux;
    let mass_loss = xuv_flux * PI * (body.physical.radius_earth * R_EARTH_M).powi(2)
        / (body.physical.surface_gravity_m_s2 * body.physical.radius_earth * R_EARTH_M);

    let retention = if mass_loss > 0.0 {
        let remaining_gyr = (base_pressure * 1e5 * 4.0 * PI * (body.physical.radius_earth * R_EARTH_M).powi(2)
            / (body.physical.surface_gravity_m_s2 * mass_loss * 3.156e7 * 1e9)).min(100.0);
        (remaining_gyr / 100.0).clamp(0.0, 1.0)
    } else {
        1.0
    };

    let mag_shield: f64 = if body.physical.has_magnetic_field {
        (body.physical.magnetic_field_ut / 50.0).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let escape = AtmosphericEscape {
        jeans_parameter: jeans_param,
        mass_loss_rate_kg_s: mass_loss.max(0.0),
        xuv_escape_rate_kg_s: (xuv_flux * PI * (body.physical.radius_earth * R_EARTH_M).powi(2)
            / (body.physical.surface_gravity_m_s2 * body.physical.radius_earth * R_EARTH_M)).max(0.0),
        cumulative_loss_earth_masses: mass_loss.max(0.0) * body.physical.age_gyr * 3.156e16 / M_EARTH_KG,
        hydrodynamic_escape: xuv_flux > 0.01 && jeans_param < 25.0,
        retention_fraction: retention,
        magnetic_shielding: mag_shield,
    };

    // Optical properties
    let optical = infer_atmosphere_optics(surface_temp, base_pressure, body);

    // Infer dominant gas
    let dominant_gas = if body.physical.h_he_fraction > 0.5 {
        "H2".to_string()
    } else if surface_temp > 500.0 && base_pressure > 10.0 {
        "CO2".to_string()
    } else {
        "N2".to_string()
    };

    body.atmosphere = Some(AtmosphereProfile {
        surface_pressure_bar: base_pressure,
        surface_temp_k: surface_temp,
        equilibrium_temp_k: t_eq,
        scale_height_km: scale_h,
        mean_molecular_weight: 29.0,
        dominant_gas,
        greenhouse_factor,
        column,
        cloud_decks,
        circulation,
        rayleigh_color: optical.zenith_color,
        escape,
        optical,
    });
}

// ═══════════════════════════════════════════════════════
// Stage 6 — Surface State
// ═══════════════════════════════════════════════════════

fn stage_6_surface(
    input: &WorldGenInput,
    body: &mut WorldBody,
    rng: &mut ChaCha8Rng,
) {
    use rand::Rng;

    let temp = body.surface.surface_temp_k;
    let pressure = body.atmosphere.as_ref()
        .map(|a| a.surface_pressure_bar)
        .unwrap_or(0.0);

    // Run geology inference
    let comp = crate::BulkComposition {
        iron_fraction: body.physical.iron_fraction,
        silicate_fraction: body.physical.silicate_fraction,
        volatile_fraction: body.physical.volatile_fraction,
        h_he_fraction: body.physical.h_he_fraction,
    };
    let geology = super::geology::infer_geology(
        body.physical.mass_earth,
        body.physical.radius_earth,
        temp,
        pressure,
        &comp,
        input.planet_type_hint.as_deref().unwrap_or("terrestrial"),
        body.physical.age_gyr,
    );

    // Ocean fraction: liquid water possible?
    let ocean = if temp > 273.0 && temp < 647.0 && pressure > 0.006
        && body.physical.volatile_fraction > 0.01
    {
        let base = body.physical.volatile_fraction * 2.0;
        (base * rng.gen_range(0.5..1.5)).clamp(0.0, 0.95)
    } else {
        0.0
    };

    // Ice fraction
    let ice = if temp < 273.0 && body.physical.volatile_fraction > 0.01 {
        let base = body.physical.volatile_fraction * 1.5;
        (base * rng.gen_range(0.3..1.2)).clamp(0.0, 0.95 - ocean)
    } else {
        0.0
    };

    // Vegetation (very speculative — only for habitable worlds)
    let vegetation = if temp > 260.0 && temp < 340.0 && ocean > 0.1 && pressure > 0.01 {
        rng.gen_range(0.0..0.4) * (1.0 - ocean - ice)
    } else {
        0.0
    };

    let desert = (1.0 - ocean - ice - vegetation).max(0.0);

    // Surface materials
    let materials = infer_surface_materials(body, ocean, ice, rng);

    // Subsurface
    let subsurface = infer_subsurface(body, &geology, rng);

    body.surface = SurfaceState {
        surface_temp_k: temp,
        ocean_fraction: ocean,
        ice_fraction: ice,
        desert_fraction: desert,
        vegetation_fraction: vegetation,
        volcanism_level: geology.volcanism_level,
        crater_density: geology.crater_density,
        mountain_height_km: geology.mountain_height_km,
        tectonic_roughness: geology.tectonic_roughness,
        materials,
    };

    body.subsurface = subsurface;
}

// ═══════════════════════════════════════════════════════
// Stage 7 — Classification
// ═══════════════════════════════════════════════════════

fn stage_7_classification(body: &mut WorldBody) {
    let pressure = body.atmosphere.as_ref()
        .map(|a| a.surface_pressure_bar)
        .unwrap_or(0.0);

    let geology = super::geology::infer_geology(
        body.physical.mass_earth,
        body.physical.radius_earth,
        body.surface.surface_temp_k,
        pressure,
        &crate::BulkComposition {
            iron_fraction: body.physical.iron_fraction,
            silicate_fraction: body.physical.silicate_fraction,
            volatile_fraction: body.physical.volatile_fraction,
            h_he_fraction: body.physical.h_he_fraction,
        },
        "terrestrial",
        body.physical.age_gyr,
    );

    // Check HZ status
    let hz_inner = hz_boundary_au(body.star.teff_k, body.star.luminosity_solar, 1.0385);
    let hz_outer = hz_boundary_au(body.star.teff_k, body.star.luminosity_solar, 0.3507);
    let in_hz = body.orbit.sma_au >= hz_inner && body.orbit.sma_au <= hz_outer;

    let input = ClassificationInput {
        body_class: body.classification.body_class,
        dynamical_class: if body.orbit.is_tidally_locked {
            DynamicalClass::TidallyLocked
        } else {
            body.classification.dynamical_class
        },
        mass_earth: body.physical.mass_earth,
        radius_earth: body.physical.radius_earth,
        surface_temp_k: body.surface.surface_temp_k,
        surface_pressure_bar: pressure,
        iron_fraction: body.physical.iron_fraction,
        silicate_fraction: body.physical.silicate_fraction,
        volatile_fraction: body.physical.volatile_fraction,
        h_he_fraction: body.physical.h_he_fraction,
        ocean_fraction: body.surface.ocean_fraction,
        ice_fraction: body.surface.ice_fraction,
        tectonic_regime: geology.tectonic_regime,
        volcanism_level: body.surface.volcanism_level,
        in_habitable_zone: in_hz,
        is_atmosphere_stripped: body.atmosphere.is_none()
            && body.physical.mass_earth > 0.1,
        is_runaway_greenhouse: body.surface.surface_temp_k > 600.0
            && pressure > 50.0,
        tidal_heating_w_m2: 0.0, // TODO: compute properly
        has_magnetic_field: body.physical.has_magnetic_field,
        eccentricity: body.orbit.eccentricity,
        age_gyr: body.physical.age_gyr,
        star_teff: body.star.teff_k,
    };

    body.classification = ClassificationBundle::classify(&input);
}

// ═══════════════════════════════════════════════════════
// Stage 8 — Moon System
// ═══════════════════════════════════════════════════════

fn stage_8_moons(
    input: &WorldGenInput,
    parent: &WorldBody,
    rng: &mut ChaCha8Rng,
) -> Vec<WorldBody> {
    moon_generator::generate_moons(input, parent, rng)
}

// ═══════════════════════════════════════════════════════
// Stage 9 — Render Profile
// ═══════════════════════════════════════════════════════

fn stage_9_render(body: &mut WorldBody) {
    body.render = render_profile_builder::build_render_profile(body);
}

// ═══════════════════════════════════════════════════════
// Stage 10 — Colonization
// ═══════════════════════════════════════════════════════

fn stage_10_colonization(body: &mut WorldBody) {
    body.colonization = Some(colonization_profile::assess_colonization(body));
}

// ═══════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════

/// Kepler's third law → orbital period in days.
fn kepler_period(sma_au: f64, star_mass_solar: f64) -> f64 {
    365.25 * (sma_au.powi(3) / star_mass_solar).sqrt()
}

/// Estimate rotation period from orbital parameters.
fn estimate_rotation(sma_au: f64, ecc: f64, period_days: f64) -> f64 {
    // Rough scaling: closer planets rotate slower (tidal braking)
    let base = 24.0; // Earth-like default
    if sma_au < 0.1 {
        period_days * 24.0 // synchronous
    } else if sma_au < 0.5 {
        base * (sma_au / 0.5).powf(0.5) * (1.0 + ecc)
    } else {
        base * (1.0 + ecc * 0.3)
    }
}

/// Tidal locking timescale estimate.
fn is_tidal_lock_likely(sma_au: f64, star_mass_solar: f64, age_gyr: f64) -> bool {
    // Simplified Gladman et al. timescale
    let lock_time = 0.16 * (sma_au / 0.05).powf(6.0) / star_mass_solar.powi(2);
    lock_time < age_gyr
}

/// Hill radius in AU.
fn hill_radius(sma_au: f64, mass_earth: f64, star_mass_solar: f64) -> f64 {
    let mass_ratio = mass_earth * M_EARTH_KG / (star_mass_solar * 1.989e30);
    sma_au * (mass_ratio / 3.0).powf(1.0 / 3.0)
}

/// Roche limit in AU (approximate).
fn roche_limit(radius_earth: f64, density_primary: f64, density_secondary: f64) -> f64 {
    let r_m = radius_earth * R_EARTH_M;
    let roche_m = 2.456 * r_m * (density_primary / density_secondary).powf(1.0 / 3.0);
    roche_m / AU_M
}

/// Estimate XUV fraction from stellar effective temperature and age.
fn estimate_xuv_fraction(teff: f64, age_gyr: f64) -> f64 {
    let type_factor = if teff < 3500.0 {
        1e-3 // M-dwarf: high XUV
    } else if teff < 5000.0 {
        3e-4 // K-dwarf
    } else {
        1e-6 // G/F-dwarf
    };
    // XUV decreases with age (Ribas et al. 2005)
    type_factor / (age_gyr / 0.1 + 1.0).powf(1.23)
}

/// HZ boundary in AU for a given stellar flux coefficient.
fn hz_boundary_au(teff: f64, luminosity_solar: f64, s_sun: f64) -> f64 {
    let a = 1.2456e-4;
    let b = 1.4612e-8;
    let dt = teff - 5780.0;
    let s_eff = s_sun + a * dt + b * dt * dt;
    (luminosity_solar / s_eff).sqrt()
}

/// Estimate mass from semi-major axis + stellar mass (when no mass provided).
fn estimate_mass_from_context(
    sma_au: f64,
    star_mass_solar: f64,
    rng: &mut ChaCha8Rng,
) -> f64 {
    use rand::Rng;
    if sma_au < 0.1 {
        // Hot zone: typically rocky, 0.5–5 M⊕
        rng.gen_range(0.5..5.0)
    } else if sma_au < 1.5 {
        // Temperate zone: 0.1–10 M⊕
        rng.gen_range(0.1..10.0)
    } else if sma_au < 5.0 {
        // Cold zone: ice giants or gas giants
        rng.gen_range(5.0..100.0) * star_mass_solar
    } else {
        // Outer system: gas giants
        rng.gen_range(50.0..500.0)
    }
}

/// Mass-radius relationship (empirical).
fn estimate_radius_from_mass(mass_earth: f64) -> f64 {
    if mass_earth < 2.0 {
        mass_earth.powf(0.27) // rocky: R ∝ M^0.27
    } else if mass_earth < 20.0 {
        mass_earth.powf(0.55) // volatile-rich: R ∝ M^0.55
    } else {
        // Gas giant: radius saturates near Jupiter
        11.2 * (mass_earth / 318.0).powf(0.06)
    }
}

/// Formation pathway → composition modifiers.
fn formation_composition_modifier(pathway: &FormationPathway) -> (f64, f64) {
    match pathway {
        FormationPathway::CoreAccretion => (1.0, 1.0),
        FormationPathway::DiskInstability => (0.8, 0.6),
        FormationPathway::GiantImpact => (1.3, 0.7),  // iron enriched
        FormationPathway::Capture => (0.9, 1.2),       // volatile enriched
        FormationPathway::Fission => (1.1, 0.9),
        FormationPathway::CoAccretion => (1.0, 1.0),
        FormationPathway::Ejected => (0.95, 1.1),
    }
}

/// Estimate bond albedo from composition fractions.
fn estimate_albedo(iron: f64, silicate: f64, volatile: f64, h_he: f64) -> f64 {
    let base = 0.1 * iron + 0.2 * silicate + 0.5 * volatile + 0.3 * h_he;
    base.clamp(0.05, 0.8)
}

/// Infer cloud deck composition from temperature and pressure.
fn infer_cloud_decks(
    surface_temp: f64,
    surface_pressure: f64,
    body: &WorldBody,
) -> Vec<CloudDeck> {
    let mut clouds = Vec::new();

    // Water clouds (200–370 K, sufficient pressure)
    if surface_temp > 200.0 && surface_temp < 370.0 && surface_pressure > 0.01
        && body.physical.volatile_fraction > 0.01
    {
        clouds.push(CloudDeck {
            cloud_type: CloudType::WaterIce,
            base_altitude_km: 5.0,
            top_altitude_km: 12.0,
            optical_depth: 8.0,
            coverage: 0.5,
            particle_size_um: 10.0,
            albedo: 0.7,
            color: [1.0, 1.0, 1.0, 0.6],
        });
    }

    // CO₂ clouds (very cold, >0.5 bar CO₂)
    if surface_temp < 200.0 && surface_pressure > 0.5 {
        clouds.push(CloudDeck {
            cloud_type: CloudType::CO2Ice,
            base_altitude_km: 20.0,
            top_altitude_km: 40.0,
            optical_depth: 2.0,
            coverage: 0.3,
            particle_size_um: 50.0,
            albedo: 0.6,
            color: [0.9, 0.9, 0.95, 0.4],
        });
    }

    // Sulfuric acid clouds (Venus-like: hot + thick atmosphere)
    if surface_temp > 400.0 && surface_pressure > 30.0 {
        clouds.push(CloudDeck {
            cloud_type: CloudType::SulfuricAcid,
            base_altitude_km: 45.0,
            top_altitude_km: 70.0,
            optical_depth: 30.0,
            coverage: 1.0,
            particle_size_um: 2.0,
            albedo: 0.85,
            color: [0.95, 0.9, 0.7, 0.95],
        });
    }

    // Ammonia clouds (gas giants, 100–200K at cloud level)
    if body.physical.h_he_fraction > 0.3 && surface_temp > 80.0 {
        clouds.push(CloudDeck {
            cloud_type: CloudType::Ammonia,
            base_altitude_km: 30.0,
            top_altitude_km: 50.0,
            optical_depth: 5.0,
            coverage: 0.8,
            particle_size_um: 20.0,
            albedo: 0.6,
            color: [0.9, 0.85, 0.7, 0.7],
        });
    }

    // Silicate clouds (ultra-hot: >2000K, lava worlds / hot jupiters)
    if surface_temp > 2000.0 {
        clouds.push(CloudDeck {
            cloud_type: CloudType::SilicateDust,
            base_altitude_km: 0.5,
            top_altitude_km: 5.0,
            optical_depth: 15.0,
            coverage: 0.6,
            particle_size_um: 0.5,
            albedo: 0.25,
            color: [0.6, 0.3, 0.15, 0.8],
        });
    }

    // Iron clouds (extremely hot >2500K)
    if surface_temp > 2500.0 {
        clouds.push(CloudDeck {
            cloud_type: CloudType::IronDroplets,
            base_altitude_km: 2.0,
            top_altitude_km: 8.0,
            optical_depth: 10.0,
            coverage: 0.4,
            particle_size_um: 0.3,
            albedo: 0.15,
            color: [0.35, 0.25, 0.2, 0.7],
        });
    }

    // Hydrocarbon haze (Titan-like: cold + substantial atmosphere + carbon)
    if surface_temp < 200.0 && surface_pressure > 0.5
        && body.physical.volatile_fraction > 0.1
    {
        clouds.push(CloudDeck {
            cloud_type: CloudType::TholinHaze,
            base_altitude_km: 100.0,
            top_altitude_km: 300.0,
            optical_depth: 4.0,
            coverage: 0.9,
            particle_size_um: 0.1,
            albedo: 0.35,
            color: [0.85, 0.6, 0.2, 0.8],
        });
    }

    clouds
}

/// Infer atmospheric circulation patterns.
fn infer_circulation(body: &WorldBody) -> AtmosphericCirculation {
    let rotation = body.orbit.rotation_period_hours;

    // Number of Hadley cells: fast rotators have more cells
    let n_cells = if body.orbit.is_tidally_locked {
        1 // Substellar-to-antistellar
    } else if rotation < 10.0 {
        6 // Very fast: many narrow cells (Jupiter-like)
    } else if rotation < 30.0 {
        3 // Earth-like: Hadley + Ferrel + Polar
    } else {
        2 // Slow rotator: extended Hadley
    };

    let pattern = if body.orbit.is_tidally_locked {
        CirculationPattern::SubstellarAntistellar
    } else if body.physical.h_he_fraction > 0.3 {
        CirculationPattern::BandedZonal
    } else if body.atmosphere.as_ref().map(|a| a.surface_pressure_bar).unwrap_or(0.0) > 50.0 {
        CirculationPattern::SuperRotation
    } else {
        CirculationPattern::HadleyCell
    };

    let band_width = 180.0 / n_cells as f64;
    let wind_bands = (0..n_cells).map(|i| {
        let lat_center = -90.0 + band_width * (i as f64 + 0.5);
        let speed = if body.physical.h_he_fraction > 0.3 {
            100.0 + 200.0 * (i as f64 / n_cells as f64)
        } else {
            10.0 + 30.0 * (1.0 - (i as f64 / n_cells as f64).abs())
        };
        let albedo_off = if i % 2 == 0 { 0.02 } else { -0.02 };
        WindBand {
            latitude_deg: lat_center,
            width_deg: band_width,
            wind_speed_m_s: speed,
            albedo_offset: albedo_off,
        }
    }).collect();

    AtmosphericCirculation {
        pattern,
        wind_bands,
        hadley_cells: n_cells as u32,
        max_wind_speed_m_s: if body.physical.h_he_fraction > 0.3 { 400.0 } else { 60.0 },
    }
}

/// Infer atmospheric optical properties.
fn infer_atmosphere_optics(
    surface_temp: f64,
    surface_pressure: f64,
    body: &WorldBody,
) -> AtmosphereOptics {
    // Rayleigh scattering → blue sky for N₂/O₂ dominated atmospheres
    // Red for thick CO₂, orange for dust-laden
    let (zenith, sunset, horizon) = if body.physical.h_he_fraction > 0.3 {
        // Gas giant: brownish/amber
        ([0.7_f32, 0.5, 0.3], [0.8_f32, 0.3, 0.1], [0.6_f32, 0.4, 0.2])
    } else if surface_temp > 500.0 && surface_pressure > 30.0 {
        // Venus-like: orange/yellow
        ([0.9_f32, 0.7, 0.3], [0.9_f32, 0.4, 0.1], [0.8_f32, 0.6, 0.2])
    } else if surface_temp < 200.0 && body.physical.volatile_fraction > 0.2 {
        // Titan-like: orange haze
        ([0.85_f32, 0.6, 0.2], [0.9_f32, 0.5, 0.1], [0.7_f32, 0.5, 0.15])
    } else if surface_pressure > 0.1 && surface_pressure < 5.0 {
        // Earth-like: blue sky
        ([0.4_f32, 0.6, 0.95], [0.95_f32, 0.5, 0.2], [0.7_f32, 0.8, 0.95])
    } else if surface_pressure > 0.001 {
        // Mars-like: butterscotch
        ([0.75_f32, 0.6, 0.4], [0.6_f32, 0.3, 0.1], [0.7_f32, 0.5, 0.3])
    } else {
        // Near-vacuum: black sky
        ([0.0_f32, 0.0, 0.0], [0.0_f32, 0.0, 0.0], [0.0_f32, 0.0, 0.0])
    };

    AtmosphereOptics {
        rayleigh_beta: surface_pressure * 0.0116, // scaled from Earth
        mie_beta: surface_pressure * 0.002,
        absorption_beta: 0.001,
        optical_depth_zenith: (surface_pressure * 0.35).clamp(0.0, 50.0),
        sunset_color: sunset,
        zenith_color: zenith,
        horizon_color: horizon,
    }
}

/// Infer surface materials from world body state.
fn infer_surface_materials(
    body: &WorldBody,
    ocean: f64,
    ice: f64,
    rng: &mut ChaCha8Rng,
) -> Vec<SurfaceMaterial> {
    use rand::Rng;
    let mut mats = Vec::new();

    if body.physical.iron_fraction > 0.3 {
        mats.push(SurfaceMaterial {
            name: "Iron regolith".to_string(),
            coverage_fraction: body.physical.iron_fraction * 0.5,
            color: [0.4, 0.3, 0.25],
            roughness: 0.7,
            metalness: 0.8,
            emissive: 0.0,
        });
    }

    if body.physical.silicate_fraction > 0.2 {
        mats.push(SurfaceMaterial {
            name: "Basalt".to_string(),
            coverage_fraction: body.physical.silicate_fraction * 0.6,
            color: [0.35, 0.3, 0.3],
            roughness: 0.6,
            metalness: 0.1,
            emissive: 0.0,
        });
    }

    if ocean > 0.05 {
        mats.push(SurfaceMaterial {
            name: "Liquid water".to_string(),
            coverage_fraction: ocean,
            color: [0.05, 0.15, 0.35],
            roughness: 0.05,
            metalness: 0.0,
            emissive: 0.0,
        });
    }

    if ice > 0.05 {
        mats.push(SurfaceMaterial {
            name: "Water ice".to_string(),
            coverage_fraction: ice,
            color: [0.85, 0.9, 0.95],
            roughness: 0.15,
            metalness: 0.0,
            emissive: 0.0,
        });
    }

    if body.physical.volatile_fraction > 0.2 && body.surface.surface_temp_k < 100.0 {
        mats.push(SurfaceMaterial {
            name: "Nitrogen ice".to_string(),
            coverage_fraction: rng.gen_range(0.1..0.4),
            color: [0.9, 0.85, 0.75],
            roughness: 0.1,
            metalness: 0.0,
            emissive: 0.0,
        });
    }

    if body.surface.surface_temp_k > 1500.0 && body.surface.volcanism_level > 0.3 {
        mats.push(SurfaceMaterial {
            name: "Molten silicate".to_string(),
            coverage_fraction: rng.gen_range(0.2..0.6),
            color: [0.9, 0.3, 0.05],
            roughness: 0.1,
            metalness: 0.2,
            emissive: 0.8,
        });
    }

    // Ensure coverage sums to ~1
    let total: f64 = mats.iter().map(|m| m.coverage_fraction).sum();
    if total > 0.0 && total != 1.0 {
        for m in &mut mats {
            m.coverage_fraction /= total;
        }
    }

    if mats.is_empty() {
        mats.push(SurfaceMaterial {
            name: "Generic regolith".to_string(),
            coverage_fraction: 1.0,
            color: [0.5, 0.45, 0.4],
            roughness: 0.8,
            metalness: 0.1,
            emissive: 0.0,
        });
    }

    mats
}

/// Infer subsurface features.
fn infer_subsurface(
    body: &WorldBody,
    geology: &super::geology::GeologyParams,
    rng: &mut ChaCha8Rng,
) -> Option<SubsurfaceNetwork> {
    use rand::Rng;

    let mut features = Vec::new();

    // Lava tubes (volcanic bodies)
    if geology.volcanism_level > 0.2 && body.surface.surface_temp_k < 1500.0 {
        let depth = rng.gen_range(0.01..0.5);
        features.push(SubsurfaceFeature {
            feature_type: SubsurfaceType::LavaTube,
            description: "Collapsed lava tube network from past volcanism".into(),
            depth_min_km: depth,
            depth_max_km: depth + rng.gen_range(0.05..0.3),
            extent_km: rng.gen_range(1.0..50.0),
            temperature_k: body.surface.surface_temp_k + 100.0,
            pressure_bar: 0.0,
            habitable: body.surface.surface_temp_k < 400.0,
            colony_suitability: 0.6,
        });
    }

    // Ice caverns (icy bodies)
    if body.surface.ice_fraction > 0.3 || body.physical.volatile_fraction > 0.3 {
        let depth = rng.gen_range(0.1..5.0);
        features.push(SubsurfaceFeature {
            feature_type: SubsurfaceType::IceCavern,
            description: "Ice caverns from sublimation or tidal flexing".into(),
            depth_min_km: depth,
            depth_max_km: depth + rng.gen_range(0.5..3.0),
            extent_km: rng.gen_range(0.5..20.0),
            temperature_k: body.surface.surface_temp_k - 10.0,
            pressure_bar: depth * 0.3,
            habitable: false,
            colony_suitability: 0.3,
        });
    }

    // Brine pockets (subsurface ocean candidates)
    if body.physical.volatile_fraction > 0.15 && body.surface.surface_temp_k < 300.0 {
        let depth = rng.gen_range(1.0..50.0);
        features.push(SubsurfaceFeature {
            feature_type: SubsurfaceType::BrinePocket,
            description: "Pressurized brine reservoir beneath ice shell".into(),
            depth_min_km: depth,
            depth_max_km: depth + rng.gen_range(5.0..30.0),
            extent_km: rng.gen_range(5.0..200.0),
            temperature_k: 273.0 + rng.gen_range(-20.0..50.0_f64),
            pressure_bar: depth * 10.0,
            habitable: true,
            colony_suitability: 0.35,
        });
    }

    // Geothermal cavities (tectonically active)
    if matches!(geology.tectonic_regime, super::geology::TectonicRegime::MobileLid)
        || matches!(geology.tectonic_regime, super::geology::TectonicRegime::Episodic)
    {
        let depth = rng.gen_range(0.5..10.0);
        features.push(SubsurfaceFeature {
            feature_type: SubsurfaceType::GeothermalCavity,
            description: "Geothermally heated subsurface chamber".into(),
            depth_min_km: depth,
            depth_max_km: depth + rng.gen_range(0.1..2.0),
            extent_km: rng.gen_range(0.1..5.0),
            temperature_k: body.surface.surface_temp_k + rng.gen_range(100.0..500.0),
            pressure_bar: depth * 30.0,
            habitable: false,
            colony_suitability: 0.15,
        });
    }

    if features.is_empty() {
        None
    } else {
        let avg_depth = features.iter().map(|f| (f.depth_min_km + f.depth_max_km) / 2.0).sum::<f64>()
            / features.len() as f64;
        let total_vol = features.iter().map(|f| {
            let thickness = f.depth_max_km - f.depth_min_km;
            f.extent_km.powi(2) * thickness * 0.1
        }).sum::<f64>();

        let stability = if geology.volcanism_level > 0.5 {
            SubsurfaceStability::Active
        } else if geology.volcanism_level > 0.2 {
            SubsurfaceStability::Moderate
        } else {
            SubsurfaceStability::Stable
        };

        Some(SubsurfaceNetwork {
            features,
            total_volume_km3: total_vol,
            average_depth_km: avg_depth,
            stability,
        })
    }
}
