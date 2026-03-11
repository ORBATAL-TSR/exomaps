//! Colonization profile assessment.
//!
//! Evaluates a `WorldBody` for colonization suitability, determining:
//!   - Recommended settlement strategy  
//!   - Available resources
//!   - Environmental hazards
//!   - Difficulty rating
//!   - Population capacity

use super::classification::*;
use super::world_body::*;

// ═══════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════

/// Assess colonization viability of a world body.
pub fn assess_colonization(body: &WorldBody) -> ColonizationProfile {
    let strategies = rank_strategies(body);
    let primary = strategies.first()
        .map(|s| s.strategy)
        .unwrap_or(ColonizationStrategy::None);
    let resources = assess_resources(body);
    let hazards = assess_hazards(body);
    let difficulty = compute_difficulty(body, &hazards);
    let max_pop = estimate_population(body, &primary);

    ColonizationProfile {
        primary_strategy: primary,
        viable_strategies: strategies,
        resources,
        hazards,
        difficulty,
        max_population: max_pop,
    }
}

// ═══════════════════════════════════════════════════════
// Strategy Ranking
// ═══════════════════════════════════════════════════════

fn rank_strategies(body: &WorldBody) -> Vec<ColonizationStrategyRanked> {
    let mut strats = Vec::new();
    let cls = &body.classification;
    let temp = body.surface.surface_temp_k;
    let pressure = body.atmosphere.as_ref()
        .map(|a| a.surface_pressure_bar)
        .unwrap_or(0.0);
    let gravity = body.physical.surface_gravity_m_s2;

    // Surface Open — only for genuinely Earth-like conditions
    if matches!(cls.habitability_class,
        HabitabilityClass::OptimallyHabitable | HabitabilityClass::Habitable)
        && temp > 250.0 && temp < 320.0
        && pressure > 0.3 && pressure < 3.0
        && gravity < 15.0
    {
        let suit = habitability_score(temp, pressure, gravity);
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::SurfaceOpen,
            suitability: suit,
            notes: "Breathable or near-breathable atmosphere".into(),
        });
    }

    // Surface Dome — habitable with protection
    if temp > 150.0 && temp < 500.0 && gravity < 20.0
        && body.physical.mass_earth > 0.01
    {
        let suit: f64 = 0.4 + 0.2 * (1.0 - (temp - 288.0).abs() / 200.0).max(0.0);
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::SurfaceDome,
            suitability: suit.clamp(0.1, 0.85),
            notes: "Pressurized dome settlement on solid surface".into(),
        });
    }

    // Subterranean — solid body with reasonable gravity
    if body.physical.mass_earth > 0.001 && gravity < 25.0
        && !matches!(cls.mass_class, MassClass::GasGiant | MassClass::SuperJovian | MassClass::NeptuneMass | MassClass::SubNeptune)
    {
        let suit: f64 = 0.4 + if body.subsurface.is_some() { 0.2 } else { 0.0 };
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::Subterranean,
            suitability: suit.clamp(0.1, 0.7),
            notes: "Subsurface settlement, radiation-protected".into(),
        });
    }

    // Lava Tube — volcanic bodies with tubes
    if let Some(ref sub) = body.subsurface {
        if sub.features.iter().any(|f| matches!(f.feature_type, SubsurfaceType::LavaTube)) {
            strats.push(ColonizationStrategyRanked {
                strategy: ColonizationStrategy::LavaTube,
                suitability: 0.6,
                notes: "Natural lava tube habitat, shielded from radiation".into(),
            });
        }
    }

    // Sub-Ice — icy moons with subsurface ocean
    if matches!(cls.hydrosphere_class, HydrosphereClass::SubsurfaceOcean)
        || (body.surface.ice_fraction > 0.5 && body.physical.volatile_fraction > 0.2)
    {
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::SubIce,
            suitability: 0.35,
            notes: "Under-ice habitat, access to liquid water".into(),
        });
    }

    // Floating — thick atmosphere (Venus high-altitude analog)
    if pressure > 10.0 && temp > 200.0
        && matches!(cls.mass_class,
            MassClass::SubTerran | MassClass::Terran | MassClass::SuperTerran | MassClass::SubNeptune)
    {
        // Find altitude with ~1 bar, 300K
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::Floating,
            suitability: 0.25,
            notes: "Cloud-city at temperate altitude layer".into(),
        });
    }

    // Gas giant -> floating at 1-bar level
    if matches!(cls.mass_class, MassClass::GasGiant | MassClass::SuperJovian | MassClass::NeptuneMass | MassClass::SubNeptune) {
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::Floating,
            suitability: 0.15,
            notes: "Floating platform at ~1 bar pressure level".into(),
        });
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::Orbital,
            suitability: 0.3,
            notes: "Orbital station harvesting atmospheric resources".into(),
        });
    }

    // Submarine — ocean worlds
    if body.surface.ocean_fraction > 0.5 && temp > 260.0 && temp < 400.0 {
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::Submarine,
            suitability: 0.3,
            notes: "Submarine habitat in global ocean".into(),
        });
    }

    // Orbital — always viable as fallback
    if body.physical.mass_earth > 0.001 {
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::Orbital,
            suitability: 0.2,
            notes: "Orbital station with surface mining excursions".into(),
        });
    }

    // Sort by suitability descending
    strats.sort_by(|a, b| b.suitability.partial_cmp(&a.suitability).unwrap());

    if strats.is_empty() {
        strats.push(ColonizationStrategyRanked {
            strategy: ColonizationStrategy::None,
            suitability: 0.0,
            notes: "No viable colonization strategy identified".into(),
        });
    }

    strats
}

fn habitability_score(temp: f64, pressure: f64, gravity: f64) -> f64 {
    let t_score = 1.0 - ((temp - 288.0) / 40.0).abs().min(1.0);
    let p_score = 1.0 - ((pressure - 1.0) / 2.0).abs().min(1.0);
    let g_score = 1.0 - ((gravity - 9.81) / 10.0).abs().min(1.0);
    (t_score * 0.4 + p_score * 0.3 + g_score * 0.3).clamp(0.0, 1.0)
}

// ═══════════════════════════════════════════════════════
// Resource Assessment
// ═══════════════════════════════════════════════════════

fn assess_resources(body: &WorldBody) -> Vec<Resource> {
    let mut res = Vec::new();

    // Water
    let water_abundance = if body.surface.ocean_fraction > 0.5 {
        ResourceAbundance::Abundant
    } else if body.physical.volatile_fraction > 0.2 {
        ResourceAbundance::High
    } else if body.surface.ice_fraction > 0.1 || body.physical.volatile_fraction > 0.05 {
        ResourceAbundance::Moderate
    } else if body.physical.volatile_fraction > 0.01 {
        ResourceAbundance::Low
    } else {
        ResourceAbundance::Trace
    };
    res.push(Resource {
        name: "Water".into(),
        resource_type: ResourceType::Water,
        abundance: water_abundance,
        accessibility: if body.surface.ocean_fraction > 0.1 { 0.9 } else { 0.3 },
    });

    // Metals
    let metal_abundance = if body.physical.iron_fraction > 0.4 {
        ResourceAbundance::Abundant
    } else if body.physical.iron_fraction > 0.2 {
        ResourceAbundance::High
    } else if body.physical.iron_fraction > 0.1 {
        ResourceAbundance::Moderate
    } else {
        ResourceAbundance::Low
    };
    res.push(Resource {
        name: "Metals (Fe, Ni, Al)".into(),
        resource_type: ResourceType::Metals,
        abundance: metal_abundance,
        accessibility: if body.surface.volcanism_level > 0.3 { 0.7 } else { 0.4 },
    });

    // Silicates
    if body.physical.silicate_fraction > 0.2 {
        res.push(Resource {
            name: "Silicon minerals".into(),
            resource_type: ResourceType::SiliconMinerals,
            abundance: if body.physical.silicate_fraction > 0.5 {
                ResourceAbundance::Abundant
            } else {
                ResourceAbundance::High
            },
            accessibility: 0.6,
        });
    }

    // Volatiles (N₂, CO₂, NH₃)
    if body.physical.volatile_fraction > 0.1 {
        res.push(Resource {
            name: "Volatiles".into(),
            resource_type: ResourceType::Volatiles,
            abundance: if body.physical.volatile_fraction > 0.3 {
                ResourceAbundance::Abundant
            } else {
                ResourceAbundance::Moderate
            },
            accessibility: 0.5,
        });
    }

    // Helium-3 (gas giants)
    if body.physical.h_he_fraction > 0.2 {
        res.push(Resource {
            name: "Helium-3".into(),
            resource_type: ResourceType::Helium3,
            abundance: ResourceAbundance::Abundant,
            accessibility: 0.2, // hard to extract from deep atmosphere
        });
    }

    // Deuterium (ocean worlds)
    if body.surface.ocean_fraction > 0.3 {
        res.push(Resource {
            name: "Deuterium".into(),
            resource_type: ResourceType::Deuterium,
            abundance: ResourceAbundance::Moderate,
            accessibility: 0.7,
        });
    }

    // Energy (geothermal, stellar)
    let energy_abundance = if body.surface.volcanism_level > 0.3 {
        ResourceAbundance::Abundant // geothermal
    } else if body.star.luminosity_solar > 0.5 && body.orbit.sma_au < 2.0 {
        ResourceAbundance::High // solar
    } else {
        ResourceAbundance::Moderate
    };
    res.push(Resource {
        name: "Energy".into(),
        resource_type: ResourceType::Energy,
        abundance: energy_abundance,
        accessibility: 0.8,
    });

    // Regolith (surface mining)
    if body.physical.mass_earth > 0.001
        && !matches!(body.classification.mass_class,
            MassClass::GasGiant | MassClass::SuperJovian | MassClass::NeptuneMass | MassClass::SubNeptune)
    {
        res.push(Resource {
            name: "Regolith".into(),
            resource_type: ResourceType::Regolith,
            abundance: ResourceAbundance::Abundant,
            accessibility: if body.physical.surface_gravity_m_s2 < 5.0 { 0.8 } else { 0.4 },
        });
    }

    res
}

// ═══════════════════════════════════════════════════════
// Hazard Assessment
// ═══════════════════════════════════════════════════════

fn assess_hazards(body: &WorldBody) -> Vec<Hazard> {
    let mut hazards = Vec::new();

    // Radiation
    if !body.physical.has_magnetic_field {
        let sev = if body.star.is_flare_star { 0.9 } else { 0.5 };
        hazards.push(Hazard {
            name: "Unshielded radiation".into(),
            hazard_type: HazardType::Radiation,
            severity: sev,
            description: "No global magnetic field; surface exposed to stellar wind and cosmic rays".into(),
        });
    }

    // Stellar flares
    if body.star.is_flare_star {
        hazards.push(Hazard {
            name: "Stellar flare events".into(),
            hazard_type: HazardType::SolarFlares,
            severity: 0.7,
            description: "Frequent high-energy flares from M-dwarf host star".into(),
        });
    }

    // Temperature extremes
    let temp = body.surface.surface_temp_k;
    if temp > 400.0 {
        hazards.push(Hazard {
            name: "Extreme heat".into(),
            hazard_type: HazardType::ExtremeTemperature,
            severity: ((temp - 400.0) / 600.0).clamp(0.3, 1.0),
            description: format!("Surface temperature: {:.0} K", temp),
        });
    } else if temp < 200.0 {
        hazards.push(Hazard {
            name: "Extreme cold".into(),
            hazard_type: HazardType::ExtremeTemperature,
            severity: ((200.0 - temp) / 200.0).clamp(0.3, 1.0),
            description: format!("Surface temperature: {:.0} K", temp),
        });
    }

    // High gravity
    let g = body.physical.surface_gravity_m_s2;
    if g > 15.0 {
        hazards.push(Hazard {
            name: "High gravity".into(),
            hazard_type: HazardType::HighGravity,
            severity: ((g - 15.0) / 30.0).clamp(0.3, 1.0),
            description: format!("Surface gravity: {:.1} m/s²", g),
        });
    } else if g < 1.0 && body.physical.mass_earth > 0.001 {
        hazards.push(Hazard {
            name: "Low gravity".into(),
            hazard_type: HazardType::LowGravity,
            severity: ((1.0 - g) / 1.0).clamp(0.1, 0.5),
            description: format!("Surface gravity: {:.2} m/s²", g),
        });
    }

    // Toxic atmosphere
    let pressure = body.atmosphere.as_ref()
        .map(|a| a.surface_pressure_bar)
        .unwrap_or(0.0);
    if pressure > 0.01
        && !matches!(body.classification.habitability_class,
            HabitabilityClass::OptimallyHabitable | HabitabilityClass::Habitable)
    {
        hazards.push(Hazard {
            name: "Unbreathable atmosphere".into(),
            hazard_type: HazardType::ToxicAtmosphere,
            severity: 0.5,
            description: "Atmosphere composition not suitable for human respiration".into(),
        });
    }

    // High pressure
    if pressure > 10.0 {
        hazards.push(Hazard {
            name: "Crushing atmospheric pressure".into(),
            hazard_type: HazardType::HighPressure,
            severity: (pressure / 100.0).clamp(0.3, 1.0),
            description: format!("Surface pressure: {:.1} bar", pressure),
        });
    }

    // Volcanism
    if body.surface.volcanism_level > 0.5 {
        hazards.push(Hazard {
            name: "Active volcanism".into(),
            hazard_type: HazardType::Volcanism,
            severity: body.surface.volcanism_level,
            description: "Frequent volcanic eruptions and lava flows".into(),
        });
    }

    // Seismicity (plate tectonics)
    if matches!(body.classification.tectonic_class,
        TectonicClass::PlateTectonics | TectonicClass::EpisodicOverturn)
    {
        hazards.push(Hazard {
            name: "Seismic activity".into(),
            hazard_type: HazardType::Seismicity,
            severity: 0.3,
            description: "Active tectonics produce regular seismic events".into(),
        });
    }

    // Meteorite bombardment (no atmosphere + high crater density)
    if body.atmosphere.is_none() && body.surface.crater_density > 0.5 {
        hazards.push(Hazard {
            name: "Meteorite impacts".into(),
            hazard_type: HazardType::Meteorites,
            severity: 0.4,
            description: "No atmospheric shielding from micrometeorites".into(),
        });
    }

    // Tidal stress (close to parent for moons)
    if matches!(body.classification.body_class, BodyClass::Moon)
        && body.orbit.eccentricity > 0.01
    {
        hazards.push(Hazard {
            name: "Tidal flexing".into(),
            hazard_type: HazardType::TidalStress,
            severity: (body.orbit.eccentricity * 5.0).clamp(0.1, 0.7),
            description: "Orbital eccentricity causes tidal heating and surface stress".into(),
        });
    }

    // Dust (Mars-like: thin atmosphere + desert)
    if pressure > 0.001 && pressure < 0.1 && body.surface.desert_fraction > 0.8 {
        hazards.push(Hazard {
            name: "Dust storms".into(),
            hazard_type: HazardType::Dust,
            severity: 0.3,
            description: "Regular dust storms reduce visibility and coat equipment".into(),
        });
    }

    // Acidic (sulfuric acid clouds)
    if let Some(ref atm) = body.atmosphere {
        if atm.cloud_decks.iter().any(|c| matches!(c.cloud_type, CloudType::SulfuricAcid)) {
            hazards.push(Hazard {
                name: "Corrosive atmosphere".into(),
                hazard_type: HazardType::Acidic,
                severity: 0.8,
                description: "Sulfuric acid cloud layers corrode all exposed materials".into(),
            });
        }
    }

    hazards
}

// ═══════════════════════════════════════════════════════
// Difficulty & Population
// ═══════════════════════════════════════════════════════

fn compute_difficulty(body: &WorldBody, hazards: &[Hazard]) -> f64 {
    let hazard_score: f64 = hazards.iter().map(|h| h.severity).sum::<f64>()
        / (hazards.len() as f64 + 1.0);

    let habitability_modifier = match body.classification.habitability_class {
        HabitabilityClass::OptimallyHabitable => 0.0,
        HabitabilityClass::Habitable => 0.1,
        HabitabilityClass::ConditionallyHabitable => 0.3,
        HabitabilityClass::SubsurfaceHabitable => 0.5,
        HabitabilityClass::Sterile => 0.85,
        HabitabilityClass::Extremophile => 0.65,
        HabitabilityClass::Prebiotic => 0.6,
    };

    ((hazard_score + habitability_modifier) / 2.0).clamp(0.0, 1.0)
}

fn estimate_population(body: &WorldBody, strategy: &ColonizationStrategy) -> u64 {
    let base = match strategy {
        ColonizationStrategy::SurfaceOpen => 10_000_000_000_u64, // billions
        ColonizationStrategy::SurfaceDome => 100_000_000,     // hundreds of millions
        ColonizationStrategy::Subterranean => 50_000_000,
        ColonizationStrategy::LavaTube => 10_000_000,
        ColonizationStrategy::SubIce => 5_000_000,
        ColonizationStrategy::Floating => 1_000_000,
        ColonizationStrategy::Orbital => 500_000,
        ColonizationStrategy::Submarine => 2_000_000,
        ColonizationStrategy::None => 0,
    };

    // Scale by surface area and gravity
    let area_factor = body.physical.radius_earth.powi(2);
    let gravity_penalty = if body.physical.surface_gravity_m_s2 > 15.0 {
        0.1
    } else {
        1.0
    };

    (base as f64 * area_factor * gravity_penalty) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::classification::*;

    #[test]
    fn test_earth_like_colonization() {
        let mut body = WorldBody::scaffold("TEST", 0, 42, BodyClass::Planet);
        body.physical.mass_earth = 1.0;
        body.physical.radius_earth = 1.0;
        body.physical.surface_gravity_m_s2 = 9.81;
        body.physical.has_magnetic_field = true;
        body.physical.iron_fraction = 0.32;
        body.physical.silicate_fraction = 0.50;
        body.physical.volatile_fraction = 0.15;
        body.surface.surface_temp_k = 288.0;
        body.surface.ocean_fraction = 0.71;
        body.classification.habitability_class = HabitabilityClass::OptimallyHabitable;
        body.atmosphere = Some(AtmosphereProfile {
            surface_pressure_bar: 1.013,
            surface_temp_k: 288.0,
            equilibrium_temp_k: 255.0,
            scale_height_km: 8.5,
            mean_molecular_weight: 29.0,
            dominant_gas: "N2".into(),
            greenhouse_factor: 1.15,
            column: vec![],
            cloud_decks: vec![],
            circulation: AtmosphericCirculation {
                pattern: CirculationPattern::HadleyCell,
                wind_bands: vec![],
                hadley_cells: 3, max_wind_speed_m_s: 50.0,
            },
            rayleigh_color: [0.4, 0.6, 0.95],
            escape: AtmosphericEscape {
                jeans_parameter: 200.0,
                mass_loss_rate_kg_s: 0.0,
                xuv_escape_rate_kg_s: 0.0,
                cumulative_loss_earth_masses: 0.0,
                hydrodynamic_escape: false,
                retention_fraction: 1.0,
                magnetic_shielding: 0.95,
            },
            optical: AtmosphereOptics {
                rayleigh_beta: 0.01,
                mie_beta: 0.002,
                absorption_beta: 0.001,
                optical_depth_zenith: 0.35,
                sunset_color: [0.95, 0.5, 0.2],
                zenith_color: [0.4, 0.6, 0.95],
                horizon_color: [0.7, 0.8, 0.95],
            },
        });

        let profile = assess_colonization(&body);
        assert!(matches!(profile.primary_strategy, ColonizationStrategy::SurfaceOpen));
        assert!(profile.difficulty < 0.3);
        assert!(profile.max_population > 1_000_000);
    }
}
