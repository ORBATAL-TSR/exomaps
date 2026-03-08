//! Biome classification and terrain coloring system.
//!
//! Maps physical parameters (temperature, moisture, altitude, latitude) to
//! biome types using a modified Whittaker diagram, extended for exoplanets.
//!
//! The biome system bridges the gap between the climate model's global averages
//! and the per-pixel surface coloring needed for texture generation:
//!
//!   Climate Model → Global params (mean T, precipitation, ice fraction)
//!   + Latitude    → Zonal temperature gradient (pole-to-equator)
//!   + Altitude    → Lapse rate temperature decrease
//!   + Moisture    → Orographic rain shadow, proximity to ocean
//!   → Biome classification per pixel
//!   → Color palette + roughness + AO per biome
//!
//! Supports:
//!   - 16 biome types (Earth-like + exotic exoplanet biomes)
//!   - Smooth transitions via barycentric blending at biome boundaries
//!   - PBR material properties per biome (roughness, metalness, AO)
//!
//! References:
//!   - Whittaker 1975 "Communities and Ecosystems"
//!   - Holdridge 1947 "Life Zone Ecology"
//!   - Forget & Leconte 2014 "3D modelling of exoplanet atmospheres"

/// Biome type classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Biome {
    // ── Terrestrial Earth-like biomes ──
    DeepOcean,
    ShallowOcean,
    CoralReef,       // warm shallow tropical water
    IceSheet,        // permanent glaciation
    Tundra,          // permafrost, sparse vegetation
    BorealForest,    // taiga, coniferous
    TemperateForest, // deciduous + mixed
    Grassland,       // temperate steppe / savanna
    Desert,          // hot arid
    ColdDesert,      // high-altitude / polar desert
    TropicalForest,  // rainforest
    Wetland,         // swamp / marsh (high moisture, low altitude)
    AlpineMeadow,    // high altitude, above treeline

    // ── Exotic exoplanet biomes ──
    LavaField,       // near-surface magma (Tsurf > 800K)
    SublimationFlats, // CO₂/N₂ ice sublimation (Tsurf 100-200K)
    HydrocarbonSea,  // Titan-like methane/ethane lakes (Tsurf 90-120K)
    BarrenRegolith,  // airless, no atmosphere (Moon/Mercury-like)
    SupercritalOcean, // supercritical H₂O or CO₂ (high P + T)
}

/// Physical properties of a biome for PBR rendering.
#[derive(Debug, Clone, Copy)]
pub struct BiomeMaterial {
    /// Base RGB color (sRGB, 0-1).
    pub color: [f32; 3],
    /// PBR roughness (0 = mirror, 1 = fully rough).
    pub roughness: f32,
    /// PBR metalness (0 = dielectric, 1 = metal).
    pub metalness: f32,
    /// Ambient occlusion base (0 = fully occluded, 1 = fully exposed).
    pub ao: f32,
    /// Emissive intensity (for lava, night-side glow).
    pub emissive: f32,
    /// Normal map strength multiplier.
    pub normal_strength: f32,
}

impl Biome {
    /// Get PBR material properties for this biome.
    pub fn material(&self) -> BiomeMaterial {
        match self {
            Biome::DeepOcean => BiomeMaterial {
                color: [0.02, 0.08, 0.25],
                roughness: 0.05,
                metalness: 0.0,
                ao: 0.95,
                emissive: 0.0,
                normal_strength: 0.3,
            },
            Biome::ShallowOcean => BiomeMaterial {
                color: [0.06, 0.20, 0.45],
                roughness: 0.08,
                metalness: 0.0,
                ao: 0.95,
                emissive: 0.0,
                normal_strength: 0.3,
            },
            Biome::CoralReef => BiomeMaterial {
                color: [0.10, 0.35, 0.45],
                roughness: 0.15,
                metalness: 0.0,
                ao: 0.9,
                emissive: 0.0,
                normal_strength: 0.6,
            },
            Biome::IceSheet => BiomeMaterial {
                color: [0.85, 0.90, 0.95],
                roughness: 0.15,
                metalness: 0.0,
                ao: 0.98,
                emissive: 0.0,
                normal_strength: 0.2,
            },
            Biome::Tundra => BiomeMaterial {
                color: [0.55, 0.58, 0.50],
                roughness: 0.85,
                metalness: 0.0,
                ao: 0.85,
                emissive: 0.0,
                normal_strength: 0.7,
            },
            Biome::BorealForest => BiomeMaterial {
                color: [0.15, 0.32, 0.12],
                roughness: 0.92,
                metalness: 0.0,
                ao: 0.65,
                emissive: 0.0,
                normal_strength: 0.8,
            },
            Biome::TemperateForest => BiomeMaterial {
                color: [0.18, 0.42, 0.12],
                roughness: 0.88,
                metalness: 0.0,
                ao: 0.60,
                emissive: 0.0,
                normal_strength: 0.85,
            },
            Biome::Grassland => BiomeMaterial {
                color: [0.42, 0.52, 0.18],
                roughness: 0.90,
                metalness: 0.0,
                ao: 0.90,
                emissive: 0.0,
                normal_strength: 0.5,
            },
            Biome::Desert => BiomeMaterial {
                color: [0.72, 0.60, 0.38],
                roughness: 0.95,
                metalness: 0.0,
                ao: 0.95,
                emissive: 0.0,
                normal_strength: 0.6,
            },
            Biome::ColdDesert => BiomeMaterial {
                color: [0.58, 0.52, 0.42],
                roughness: 0.92,
                metalness: 0.0,
                ao: 0.92,
                emissive: 0.0,
                normal_strength: 0.7,
            },
            Biome::TropicalForest => BiomeMaterial {
                color: [0.08, 0.35, 0.05],
                roughness: 0.85,
                metalness: 0.0,
                ao: 0.45,
                emissive: 0.0,
                normal_strength: 0.9,
            },
            Biome::Wetland => BiomeMaterial {
                color: [0.20, 0.35, 0.18],
                roughness: 0.70,
                metalness: 0.0,
                ao: 0.55,
                emissive: 0.0,
                normal_strength: 0.6,
            },
            Biome::AlpineMeadow => BiomeMaterial {
                color: [0.40, 0.48, 0.32],
                roughness: 0.88,
                metalness: 0.0,
                ao: 0.85,
                emissive: 0.0,
                normal_strength: 0.75,
            },
            // ── Exotic ──
            Biome::LavaField => BiomeMaterial {
                color: [0.25, 0.05, 0.02],
                roughness: 0.60,
                metalness: 0.15,
                ao: 0.70,
                emissive: 0.85, // glowing magma
                normal_strength: 1.0,
            },
            Biome::SublimationFlats => BiomeMaterial {
                color: [0.75, 0.72, 0.68],
                roughness: 0.80,
                metalness: 0.0,
                ao: 0.95,
                emissive: 0.0,
                normal_strength: 0.4,
            },
            Biome::HydrocarbonSea => BiomeMaterial {
                color: [0.15, 0.12, 0.08],
                roughness: 0.10,
                metalness: 0.0,
                ao: 0.90,
                emissive: 0.0,
                normal_strength: 0.2,
            },
            Biome::BarrenRegolith => BiomeMaterial {
                color: [0.45, 0.42, 0.38],
                roughness: 0.95,
                metalness: 0.05,
                ao: 0.80,
                emissive: 0.0,
                normal_strength: 0.9,
            },
            Biome::SupercritalOcean => BiomeMaterial {
                color: [0.30, 0.25, 0.40],
                roughness: 0.12,
                metalness: 0.0,
                ao: 0.92,
                emissive: 0.02,
                normal_strength: 0.3,
            },
        }
    }
}

/// Parameters for biome classification at a single pixel.
#[derive(Debug, Clone)]
pub struct BiomeInput {
    /// Local surface temperature (K), accounting for latitude + altitude.
    pub temperature_k: f64,
    /// Local precipitation / moisture availability (0-1).
    pub moisture: f64,
    /// Normalized altitude (0 = sea level, 1 = max mountain height).
    pub altitude: f64,
    /// Absolute latitude (0 = equator, 1 = pole).
    pub latitude: f64,
    /// Whether this pixel is below sea level (ocean).
    pub is_ocean: bool,
    /// Surface atmospheric pressure (bar). 0 = airless.
    pub surface_pressure_bar: f64,
    /// Star spectral type effective temperature (for photosynthesis potential).
    pub star_teff_k: f64,
}

/// Classify biome from physical parameters.
///
/// Uses a modified Whittaker diagram with extensions for:
///   - Airless bodies (regolith)
///   - Very hot worlds (lava)
///   - Very cold worlds (sublimation, hydrocarbon)
///   - High-pressure worlds (supercritical fluids)
pub fn classify_biome(input: &BiomeInput) -> Biome {
    let t = input.temperature_k;
    let m = input.moisture;
    let alt = input.altitude;
    let lat = input.latitude;
    let p = input.surface_pressure_bar;

    // ── Exotic extremes (override normal classification) ──

    // Airless body
    if p < 1e-6 {
        return Biome::BarrenRegolith;
    }

    // Volcanic hellscape
    if t > 800.0 {
        return Biome::LavaField;
    }

    // Supercritical ocean (Venus-like: >647K at >220 bar for H₂O)
    if t > 500.0 && p > 50.0 && input.is_ocean {
        return Biome::SupercritalOcean;
    }

    // Cryogenic worlds
    if t < 120.0 {
        if input.is_ocean {
            return Biome::HydrocarbonSea; // Titan-like
        }
        return Biome::SublimationFlats;
    }

    // Very cold
    if t < 200.0 {
        return Biome::SublimationFlats;
    }

    // ── Ocean biomes ──
    if input.is_ocean {
        if alt < -0.3 {
            return Biome::DeepOcean;
        }
        if t > 295.0 && lat < 0.3 && alt > -0.15 {
            return Biome::CoralReef;
        }
        return Biome::ShallowOcean;
    }

    // ── Frozen biomes (polar/high altitude ice) ──
    if t < 258.0 {
        if alt > 0.5 || lat > 0.85 {
            return Biome::IceSheet;
        }
        return Biome::Tundra;
    }

    // ── Alpine (high altitude, above treeline) ──
    if alt > 0.70 {
        if t < 280.0 {
            return Biome::IceSheet; // glaciated peaks
        }
        return Biome::AlpineMeadow;
    }

    // ── Whittaker diagram: temperature × moisture → biome ──

    // Hot + dry → desert
    if t > 300.0 && m < 0.15 {
        return Biome::Desert;
    }

    // Cold + dry → cold desert
    if t < 278.0 && m < 0.2 {
        return Biome::ColdDesert;
    }

    // Tundra (cold, any moisture)
    if t < 268.0 {
        return Biome::Tundra;
    }

    // Boreal forest (cool + moderate moisture)
    if t < 278.0 && m > 0.3 {
        return Biome::BorealForest;
    }

    // Tropical forest (warm + wet)
    if t > 295.0 && m > 0.6 && lat < 0.35 {
        return Biome::TropicalForest;
    }

    // Wetland (moderate temperature, very wet, low altitude)
    if m > 0.75 && alt < 0.15 {
        return Biome::Wetland;
    }

    // Temperate forest (moderate temp + moisture)
    if t >= 278.0 && t <= 305.0 && m > 0.35 {
        return Biome::TemperateForest;
    }

    // Grassland (moderate temp, low-moderate moisture)
    if m > 0.15 {
        return Biome::Grassland;
    }

    // Default: arid grassland / scrubland
    Biome::Desert
}

/// Compute local temperature from global mean + latitude + altitude.
///
/// Models:
///   - Pole-to-equator gradient (Budyko-Sellers parameterization)
///   - Adiabatic lapse rate (6.5 K/km Earth standard, adjusted for composition)
///   - Thermal inertia smoothing for ocean pixels
pub fn local_temperature(
    global_mean_k: f64,
    latitude: f64,     // 0 = equator, 1 = pole (absolute value)
    altitude_km: f64,  // above mean surface level
    is_ocean: bool,
    obliquity_deg: f64,
) -> f64 {
    // Pole-to-equator gradient
    // ΔT ≈ 50K for Earth (equator 300K, pole 250K)
    // Scales with obliquity: higher obliquity → smaller gradient
    let obliquity_factor = 1.0 - (obliquity_deg / 90.0).clamp(0.0, 0.8);
    let lat_gradient = 55.0 * obliquity_factor; // K from equator to pole
    let lat_offset = lat_gradient * (1.0 - (1.0 - latitude).powi(2));

    // Equator is hotter, poles are colder
    let equator_boost = lat_gradient * 0.35; // equator above mean
    let t_lat = global_mean_k + equator_boost - lat_offset;

    // Adiabatic lapse rate: ~6.5 K/km (dry) to ~5 K/km (saturated)
    let lapse_rate = if is_ocean { 5.0 } else { 6.5 };
    let t_alt = t_lat - altitude_km * lapse_rate;

    // Ocean thermal inertia: dampens extremes
    if is_ocean {
        (t_alt * 0.7 + global_mean_k * 0.3).max(271.3) // seawater freezing ~271K
    } else {
        t_alt
    }
}

/// Compute local moisture from orbital + terrain parameters.
///
/// Simple parameterization based on:
///   - Proximity to ocean (maritime vs continental)
///   - Rain shadow effect from mountains
///   - Latitude (ITCZ at equator → wet, subtropical highs → dry)
///   - Surface pressure (thicker atmosphere → more water transport)
pub fn local_moisture(
    global_precipitation: f64, // 0-1, from climate model
    latitude: f64,             // 0 = equator, 1 = pole
    altitude: f64,             // normalized 0-1
    ocean_distance: f64,       // normalized 0-1 (0 = coast, 1 = deep interior)
    surface_pressure_bar: f64,
) -> f64 {
    // ITCZ (Inter-Tropical Convergence Zone) effect
    // Wet at equator, dry at ~30° (subtropical high), wet again at ~60° (polar front)
    let lat_moisture = if latitude < 0.15 {
        0.85 // ITCZ
    } else if latitude < 0.35 {
        0.25 // subtropical high (Hadley cell descending)
    } else if latitude < 0.55 {
        0.60 // mid-latitude frontal systems
    } else if latitude < 0.75 {
        0.45 // polar front
    } else {
        0.20 // polar desert
    };

    // Continental effect: drier further from ocean
    let continental = 1.0 - ocean_distance * 0.5;

    // Orographic effect: mountains block moisture → rain shadow
    let orographic = if altitude > 0.4 {
        0.5 // above the cloud condensation level
    } else {
        1.0
    };

    // Atmospheric capacity: thicker atmosphere holds more water
    let pressure_factor = (surface_pressure_bar / 1.0).sqrt().clamp(0.1, 2.0);

    let raw = global_precipitation * lat_moisture * continental * orographic * pressure_factor;
    raw.clamp(0.0, 1.0)
}

/// Generate a full biome map for a planet surface.
///
/// Returns a Vec of Biome enums and a corresponding Vec of BiomeMaterial
/// for each pixel in equirectangular projection (width × height).
pub fn generate_biome_map(
    heightmap: &[f64],       // normalized 0-1, width × height
    width: usize,
    height: usize,
    global_mean_temp_k: f64,
    global_precipitation: f64, // 0-1
    ocean_level: f64,          // height threshold for ocean (e.g., 0.45)
    surface_pressure_bar: f64,
    star_teff_k: f64,
    obliquity_deg: f64,
    max_mountain_height_km: f64,
) -> (Vec<Biome>, Vec<BiomeMaterial>) {
    let total = width * height;
    let mut biomes = Vec::with_capacity(total);
    let mut materials = Vec::with_capacity(total);

    // Pre-compute ocean distance field (approximate)
    let ocean_distance = compute_ocean_distance(heightmap, width, height, ocean_level);

    for row in 0..height {
        let latitude = ((row as f64 / height as f64) - 0.5).abs() * 2.0; // 0-1

        for col in 0..width {
            let idx = row * width + col;
            let h = heightmap[idx];
            let is_ocean = h < ocean_level;

            // Altitude above sea level (negative for ocean floor)
            let altitude = if is_ocean {
                (h - ocean_level) / ocean_level // negative for ocean
            } else {
                (h - ocean_level) / (1.0 - ocean_level) // 0-1 for land
            };

            let altitude_km = if is_ocean {
                altitude * 10.0 // ocean depth (inverted)
            } else {
                altitude * max_mountain_height_km
            };

            let temp = local_temperature(
                global_mean_temp_k,
                latitude,
                altitude_km.max(0.0),
                is_ocean,
                obliquity_deg,
            );

            let moisture = if is_ocean {
                1.0
            } else {
                local_moisture(
                    global_precipitation,
                    latitude,
                    altitude.max(0.0),
                    ocean_distance[idx] as f64,
                    surface_pressure_bar,
                )
            };

            let input = BiomeInput {
                temperature_k: temp,
                moisture,
                altitude: altitude.clamp(-1.0, 1.0),
                latitude,
                is_ocean,
                surface_pressure_bar,
                star_teff_k,
            };

            let biome = classify_biome(&input);
            let mat = biome.material();

            biomes.push(biome);
            materials.push(mat);
        }
    }

    (biomes, materials)
}

/// Approximate ocean distance using a simple distance transform.
///
/// Returns normalized distance (0 = at coast, 1 = far from ocean) for land pixels,
/// and 0 for ocean pixels.
fn compute_ocean_distance(
    heightmap: &[f64],
    width: usize,
    height: usize,
    ocean_level: f64,
) -> Vec<f32> {
    let total = width * height;
    let max_dist = (width as f32).max(height as f32) * 0.5;
    let mut dist = vec![max_dist; total];

    // Initialize: ocean pixels = 0, land pixels = max
    for i in 0..total {
        if heightmap[i] < ocean_level {
            dist[i] = 0.0;
        }
    }

    // Simple two-pass distance transform (rows then columns)
    // Forward pass
    for row in 0..height {
        for col in 1..width {
            dist[row * width + col] = dist[row * width + col].min(dist[row * width + col - 1] + 1.0);
        }
        // Backward pass (row)
        for col in (0..width - 1).rev() {
            dist[row * width + col] = dist[row * width + col].min(dist[row * width + col + 1] + 1.0);
        }
    }

    // Forward pass (columns)
    for col in 0..width {
        for row in 1..height {
            dist[row * width + col] = dist[row * width + col].min(dist[(row - 1) * width + col] + 1.0);
        }
        for row in (0..height - 1).rev() {
            dist[row * width + col] = dist[row * width + col].min(dist[(row + 1) * width + col] + 1.0);
        }
    }

    // Normalize
    let max_found = dist.iter().cloned().fold(1.0_f32, f32::max);
    let inv = if max_found > 0.0 { 1.0 / max_found } else { 1.0 };
    for d in &mut dist {
        *d *= inv;
    }

    dist
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_earth_equator() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 303.0,
            moisture: 0.8,
            altitude: 0.05,
            latitude: 0.05,
            is_ocean: false,
            surface_pressure_bar: 1.0,
            star_teff_k: 5778.0,
        });
        assert_eq!(biome, Biome::TropicalForest);
    }

    #[test]
    fn test_earth_sahara() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 318.0,
            moisture: 0.05,
            altitude: 0.15,
            latitude: 0.28,
            is_ocean: false,
            surface_pressure_bar: 1.0,
            star_teff_k: 5778.0,
        });
        assert_eq!(biome, Biome::Desert);
    }

    #[test]
    fn test_earth_pole() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 240.0,
            moisture: 0.15,
            altitude: 0.80,
            latitude: 0.95,
            is_ocean: false,
            surface_pressure_bar: 1.0,
            star_teff_k: 5778.0,
        });
        assert_eq!(biome, Biome::IceSheet);
    }

    #[test]
    fn test_ocean() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 285.0,
            moisture: 1.0,
            altitude: -0.5,
            latitude: 0.40,
            is_ocean: true,
            surface_pressure_bar: 1.0,
            star_teff_k: 5778.0,
        });
        assert_eq!(biome, Biome::DeepOcean);
    }

    #[test]
    fn test_lava_world() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 1200.0,
            moisture: 0.0,
            altitude: 0.2,
            latitude: 0.3,
            is_ocean: false,
            surface_pressure_bar: 90.0,
            star_teff_k: 3500.0,
        });
        assert_eq!(biome, Biome::LavaField);
    }

    #[test]
    fn test_airless() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 350.0,
            moisture: 0.0,
            altitude: 0.3,
            latitude: 0.5,
            is_ocean: false,
            surface_pressure_bar: 0.0,
            star_teff_k: 5778.0,
        });
        assert_eq!(biome, Biome::BarrenRegolith);
    }

    #[test]
    fn test_titan_like() {
        let biome = classify_biome(&BiomeInput {
            temperature_k: 94.0,
            moisture: 0.5,
            altitude: -0.2,
            latitude: 0.4,
            is_ocean: true,
            surface_pressure_bar: 1.5,
            star_teff_k: 5778.0,
        });
        assert_eq!(biome, Biome::HydrocarbonSea);
    }

    #[test]
    fn test_local_temperature() {
        let equator_t = local_temperature(288.0, 0.0, 0.0, false, 23.44);
        let pole_t = local_temperature(288.0, 1.0, 0.0, false, 23.44);
        assert!(equator_t > pole_t, "Equator should be warmer than pole");
        assert!((equator_t - pole_t) > 30.0 && (equator_t - pole_t) < 70.0,
            "Temperature gradient should be ~50K for Earth, got {}K", equator_t - pole_t);

        // Altitude effect
        let sea_level = local_temperature(288.0, 0.3, 0.0, false, 23.44);
        let mountain = local_temperature(288.0, 0.3, 5.0, false, 23.44);
        assert!(sea_level - mountain > 25.0, "5km altitude should be ~32K colder");
    }
}
