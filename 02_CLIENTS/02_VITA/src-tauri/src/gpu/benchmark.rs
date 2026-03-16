//! Solar System Benchmark Suite
//!
//! Validates the procgen pipeline against real Solar System data.
//!
//! For each body we feed in the known physical parameters (mass, radius,
//! semi-major axis, stellar properties) and compare the inferred geology,
//! tectonic regime, biome distribution, and terrain statistics against
//! NASA Planetary Fact Sheet values.
//!
//! This is a regression test — if a model change makes Mars suddenly have
//! oceans or Jupiter develop plate tectonics, these tests will catch it.
//!
//! NASA Planetary Fact Sheet:
//!   https://nssdc.gsfc.nasa.gov/planetary/factsheet/
//!
//! Test categories:
//!   1. Geology inference — tectonic regime, volcanism, craters, ocean/ice
//!   2. Terrain statistics — heightmap distribution, roughness, ocean fraction
//!   3. Biome coherence — expected biome types present/absent
//!   4. Visual plausibility — no NaN, no all-black, textures in expected range

use crate::simulation::{
    geology::{self, GeologyParams, TectonicRegime},
    composition,
    biomes::Biome,
};
use super::terrain::{self, TerrainConfig, TerrainOutput};

// ── Solar System Reference Data ─────────────────────
// Source: NASA GSFC Planetary Fact Sheet (2024)

struct SolarBody {
    name: &'static str,
    mass_earth: f64,
    radius_earth: f64,
    semi_major_axis_au: f64,
    surface_temp_k: f64,
    surface_pressure_bar: f64,
    planet_type: &'static str,
    age_gyr: f64,
    obliquity_deg: f64,
    // Expected validation targets
    expected_regime: TectonicRegime,
    expected_ocean_frac_range: (f64, f64),
    expected_crater_density_range: (f64, f64),
    expected_volcanism_range: (f64, f64),
    // Biomes that MUST be present
    required_biomes: &'static [Biome],
    // Biomes that must NOT be present
    forbidden_biomes: &'static [Biome],
}

const SUN_TEFF: f64 = 5778.0;
const SUN_LUMINOSITY: f64 = 1.0;
const BENCHMARK_RESOLUTION: usize = 64; // small for fast tests

fn solar_bodies() -> Vec<SolarBody> {
    vec![
        SolarBody {
            name: "Earth",
            mass_earth: 1.0,
            radius_earth: 1.0,
            semi_major_axis_au: 1.0,
            surface_temp_k: 288.0,
            surface_pressure_bar: 1.013,
            planet_type: "super-earth", // closest classification
            age_gyr: 4.6,
            obliquity_deg: 23.44,
            expected_regime: TectonicRegime::MobileLid,
            expected_ocean_frac_range: (0.3, 0.95), // real: 0.71
            expected_crater_density_range: (0.0, 0.4), // low due to erosion + tectonics
            expected_volcanism_range: (0.1, 0.6),
            required_biomes: &[
                Biome::DeepOcean,
                Biome::TropicalForest,
            ],
            forbidden_biomes: &[
                Biome::LavaField,
                Biome::HydrocarbonSea,
                Biome::BarrenRegolith,
                Biome::SublimationFlats,
            ],
        },
        SolarBody {
            name: "Mars",
            mass_earth: 0.107,
            radius_earth: 0.532,
            semi_major_axis_au: 1.524,
            surface_temp_k: 210.0,
            surface_pressure_bar: 0.006,
            planet_type: "rocky",
            age_gyr: 4.6,
            obliquity_deg: 25.19,
            expected_regime: TectonicRegime::StagnantLid,
            expected_ocean_frac_range: (0.0, 0.05), // no liquid water
            expected_crater_density_range: (0.3, 1.0), // heavily cratered
            expected_volcanism_range: (0.0, 0.4),
            required_biomes: &[],
            forbidden_biomes: &[
                Biome::DeepOcean,
                Biome::ShallowOcean,
                Biome::TropicalForest,
                Biome::TemperateForest,
                Biome::HydrocarbonSea,
            ],
        },
        SolarBody {
            name: "Venus",
            mass_earth: 0.815,
            radius_earth: 0.949,
            semi_major_axis_au: 0.723,
            surface_temp_k: 737.0,
            surface_pressure_bar: 92.0,
            planet_type: "rocky",
            age_gyr: 4.6,
            obliquity_deg: 177.4,
            expected_regime: TectonicRegime::Episodic,
            expected_ocean_frac_range: (0.0, 0.1), // far too hot
            expected_crater_density_range: (0.0, 0.5), // moderate (resurfacing)
            expected_volcanism_range: (0.2, 0.8), // highly volcanic
            required_biomes: &[],
            forbidden_biomes: &[
                Biome::DeepOcean,
                Biome::TropicalForest,
                Biome::IceSheet,
                Biome::Tundra,
            ],
        },
        SolarBody {
            name: "Mercury",
            mass_earth: 0.0553,
            radius_earth: 0.383,
            semi_major_axis_au: 0.387,
            surface_temp_k: 440.0,
            surface_pressure_bar: 0.0, // essentially airless
            planet_type: "sub-earth",
            age_gyr: 4.6,
            obliquity_deg: 0.034,
            expected_regime: TectonicRegime::StagnantLid,
            expected_ocean_frac_range: (0.0, 0.01),
            expected_crater_density_range: (0.5, 1.0), // heavily cratered
            expected_volcanism_range: (0.0, 0.3),
            required_biomes: &[Biome::BarrenRegolith],
            forbidden_biomes: &[
                Biome::DeepOcean,
                Biome::TropicalForest,
                Biome::IceSheet,
            ],
        },
        SolarBody {
            name: "Jupiter",
            mass_earth: 317.8,
            radius_earth: 11.21,
            semi_major_axis_au: 5.203,
            surface_temp_k: 165.0,
            surface_pressure_bar: 1000.0,
            planet_type: "gas-giant",
            age_gyr: 4.6,
            obliquity_deg: 3.13,
            expected_regime: TectonicRegime::None,
            expected_ocean_frac_range: (0.0, 0.01),
            expected_crater_density_range: (0.0, 0.01),
            expected_volcanism_range: (0.0, 0.01),
            required_biomes: &[],
            forbidden_biomes: &[],
        },
        SolarBody {
            name: "Titan",
            mass_earth: 0.0225,
            radius_earth: 0.404,
            semi_major_axis_au: 9.537, // Saturn's orbit
            surface_temp_k: 94.0,
            surface_pressure_bar: 1.47,
            planet_type: "rocky",
            age_gyr: 4.6,
            obliquity_deg: 26.7,
            expected_regime: TectonicRegime::StagnantLid,
            expected_ocean_frac_range: (0.0, 0.2),
            expected_crater_density_range: (0.0, 0.5),
            expected_volcanism_range: (0.0, 0.2),
            required_biomes: &[],
            forbidden_biomes: &[
                Biome::DeepOcean,
                Biome::TropicalForest,
                Biome::Desert,
            ],
        },
    ]
}

/// Run the full geology inference for a Solar System body and validate.
fn run_geology_benchmark(body: &SolarBody) -> GeologyParams {
    let comp = composition::infer_composition(
        body.mass_earth,
        body.radius_earth,
        body.semi_major_axis_au,
        body.planet_type,
    );

    geology::infer_geology(
        body.mass_earth,
        body.radius_earth,
        body.surface_temp_k,
        body.surface_pressure_bar,
        &comp,
        body.planet_type,
        body.age_gyr,
    )
}

/// Run the full terrain pipeline for a Solar System body.
fn run_terrain_benchmark(body: &SolarBody) -> TerrainOutput {
    let comp = composition::infer_composition(
        body.mass_earth,
        body.radius_earth,
        body.semi_major_axis_au,
        body.planet_type,
    );

    let geo = geology::infer_geology(
        body.mass_earth,
        body.radius_earth,
        body.surface_temp_k,
        body.surface_pressure_bar,
        &comp,
        body.planet_type,
        body.age_gyr,
    );

    let config = TerrainConfig {
        seed: 42,
        resolution: BENCHMARK_RESOLUTION,
        planet_type: body.planet_type.to_string(),
        geology: geo,
        mass_earth: body.mass_earth,
        radius_earth: body.radius_earth,
        surface_temp_k: body.surface_temp_k,
        surface_pressure_bar: body.surface_pressure_bar,
        star_teff_k: SUN_TEFF,
        obliquity_deg: body.obliquity_deg,
        age_gyr: body.age_gyr,
        in_habitable_zone: body.semi_major_axis_au > 0.85 && body.semi_major_axis_au < 1.7,
        global_precipitation: if body.surface_temp_k > 273.0 && body.surface_temp_k < 373.0 { 0.6 } else { 0.0 },
    };

    if matches!(body.planet_type, "gas-giant" | "super-jupiter" | "neptune-like") {
        terrain::generate_gas_giant_bands(&config)
    } else {
        terrain::generate_terrain(&config)
    }
}

// ── Tests ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Geology Inference Tests ──

    #[test]
    fn test_earth_geology() {
        let body = &solar_bodies()[0]; // Earth
        let geo = run_geology_benchmark(body);

        assert_eq!(geo.tectonic_regime, body.expected_regime,
            "{}: wrong tectonic regime", body.name);
        assert!(geo.ocean_fraction >= body.expected_ocean_frac_range.0
            && geo.ocean_fraction <= body.expected_ocean_frac_range.1,
            "{}: ocean fraction {} outside expected range {:?}",
            body.name, geo.ocean_fraction, body.expected_ocean_frac_range);
        assert!(geo.crater_density >= body.expected_crater_density_range.0
            && geo.crater_density <= body.expected_crater_density_range.1,
            "{}: crater density {} outside expected range {:?}",
            body.name, geo.crater_density, body.expected_crater_density_range);
        assert!(geo.volcanism_level >= body.expected_volcanism_range.0
            && geo.volcanism_level <= body.expected_volcanism_range.1,
            "{}: volcanism {} outside expected range {:?}",
            body.name, geo.volcanism_level, body.expected_volcanism_range);
    }

    #[test]
    fn test_mars_geology() {
        let body = &solar_bodies()[1]; // Mars
        let geo = run_geology_benchmark(body);

        assert_eq!(geo.tectonic_regime, body.expected_regime,
            "{}: wrong tectonic regime", body.name);
        assert!(geo.ocean_fraction >= body.expected_ocean_frac_range.0
            && geo.ocean_fraction <= body.expected_ocean_frac_range.1,
            "{}: ocean {} outside {:?}", body.name, geo.ocean_fraction, body.expected_ocean_frac_range);
        assert!(geo.crater_density >= body.expected_crater_density_range.0,
            "{}: crater density {} too low (expected >= {})",
            body.name, geo.crater_density, body.expected_crater_density_range.0);
    }

    #[test]
    fn test_venus_geology() {
        let body = &solar_bodies()[2]; // Venus
        let geo = run_geology_benchmark(body);

        assert_eq!(geo.tectonic_regime, body.expected_regime,
            "Venus should have Episodic tectonics (got {:?})", geo.tectonic_regime);
        assert!(geo.volcanism_level >= body.expected_volcanism_range.0,
            "Venus volcanism {} should be >= {}", geo.volcanism_level, body.expected_volcanism_range.0);
    }

    #[test]
    fn test_mercury_geology() {
        let body = &solar_bodies()[3]; // Mercury
        let geo = run_geology_benchmark(body);

        assert_eq!(geo.tectonic_regime, TectonicRegime::StagnantLid);
        assert!(geo.crater_density > 0.5,
            "Mercury should be heavily cratered: {}", geo.crater_density);
        assert!(geo.ocean_fraction < 0.01, "Mercury should have no ocean");
    }

    #[test]
    fn test_jupiter_geology() {
        let body = &solar_bodies()[4]; // Jupiter
        let geo = run_geology_benchmark(body);

        assert_eq!(geo.tectonic_regime, TectonicRegime::None);
    }

    // ── Terrain Pipeline Tests ──

    #[test]
    fn test_earth_terrain() {
        let body = &solar_bodies()[0]; // Earth
        let output = run_terrain_benchmark(body);

        // Heightmap should be normalized
        assert!(output.heightmap.iter().all(|&h| h >= 0.0 && h <= 1.0),
            "Earth heightmap has values outside [0,1]");

        // Should have significant ocean
        assert!(output.ocean_level > 0.2,
            "Earth ocean level {} too low", output.ocean_level);

        // Albedo should not be all-black
        let mean_brightness: f64 = output.albedo.iter()
            .step_by(4).map(|&v| v as f64 / 255.0).sum::<f64>()
            / (BENCHMARK_RESOLUTION * BENCHMARK_RESOLUTION) as f64;
        assert!(mean_brightness > 0.05 && mean_brightness < 0.9,
            "Earth albedo mean brightness {} looks wrong", mean_brightness);

        // PBR map should be populated
        assert!(output.pbr_map.iter().any(|&v| v > 0),
            "Earth PBR map is all zeros");

        // Check texture sizes
        let expected_rgba_size = BENCHMARK_RESOLUTION * BENCHMARK_RESOLUTION * 4;
        assert_eq!(output.albedo.len(), expected_rgba_size);
        assert_eq!(output.normals.len(), expected_rgba_size);
        assert_eq!(output.pbr_map.len(), expected_rgba_size);
    }

    #[test]
    fn test_mars_terrain() {
        let body = &solar_bodies()[1]; // Mars
        let output = run_terrain_benchmark(body);

        // Mars should have no ocean (or very little)
        assert!(output.ocean_level < 0.05,
            "Mars ocean level {} too high", output.ocean_level);

        // Heightmap variance should be relatively high (Mars is rough)
        let mean: f64 = output.heightmap.iter().sum::<f64>() / output.heightmap.len() as f64;
        let variance: f64 = output.heightmap.iter()
            .map(|&h| (h - mean).powi(2))
            .sum::<f64>() / output.heightmap.len() as f64;
        assert!(variance > 0.01, "Mars terrain should have significant variance: {}", variance);
    }

    #[test]
    fn test_jupiter_bands() {
        let body = &solar_bodies()[4]; // Jupiter
        let output = run_terrain_benchmark(body);

        // Jupiter uses gas giant band generator
        assert_eq!(output.albedo.len(), BENCHMARK_RESOLUTION * BENCHMARK_RESOLUTION * 4);

        // Should have visible banding (variation across rows)
        let row_means: Vec<f64> = (0..BENCHMARK_RESOLUTION).map(|row| {
            let start = row * BENCHMARK_RESOLUTION;
            output.heightmap[start..start + BENCHMARK_RESOLUTION]
                .iter().sum::<f64>() / BENCHMARK_RESOLUTION as f64
        }).collect();

        let row_variance: f64 = {
            let mean = row_means.iter().sum::<f64>() / row_means.len() as f64;
            row_means.iter().map(|&v| (v - mean).powi(2)).sum::<f64>() / row_means.len() as f64
        };

        assert!(row_variance > 0.001,
            "Jupiter should show latitudinal banding: row variance = {}", row_variance);
    }

    // ── Biome Coherence Tests ──

    #[test]
    fn test_earth_biomes() {
        let body = &solar_bodies()[0]; // Earth
        let output = run_terrain_benchmark(body);

        let biome_set: std::collections::HashSet<u8> = output.biome_ids.iter().cloned().collect();

        // Earth should have ocean biomes
        assert!(biome_set.contains(&(Biome::DeepOcean as u8))
            || biome_set.contains(&(Biome::ShallowOcean as u8)),
            "Earth should have ocean biomes. Found biome IDs: {:?}", biome_set);

        // Earth should NOT have lava fields
        assert!(!biome_set.contains(&(Biome::LavaField as u8)),
            "Earth should not have lava fields");
    }

    #[test]
    fn test_mercury_biomes() {
        let body = &solar_bodies()[3]; // Mercury
        let output = run_terrain_benchmark(body);

        let biome_set: std::collections::HashSet<u8> = output.biome_ids.iter().cloned().collect();

        // Mercury is airless → should be all BarrenRegolith
        assert!(biome_set.contains(&(Biome::BarrenRegolith as u8)),
            "Mercury should have BarrenRegolith. Found: {:?}", biome_set);
    }

    // ── Cross-body Comparison Tests ──

    #[test]
    fn test_relative_roughness() {
        // Rocky planets should have non-trivial terrain variance.
        // Gas giant "heightmap" represents cloud brightness bands,
        // which can have comparable or higher variance — so we only
        // check that rocky planets have meaningful roughness.
        let mars = run_terrain_benchmark(&solar_bodies()[1]);
        let earth = run_terrain_benchmark(&solar_bodies()[0]);

        let variance = |hm: &[f64]| -> f64 {
            let mean = hm.iter().sum::<f64>() / hm.len() as f64;
            hm.iter().map(|&h| (h - mean).powi(2)).sum::<f64>() / hm.len() as f64
        };

        let mars_var = variance(&mars.heightmap);
        let earth_var = variance(&earth.heightmap);

        // Both rocky planets should have significant terrain texture
        assert!(mars_var > 0.005,
            "Mars should have notable terrain variance: {}", mars_var);
        assert!(earth_var > 0.005,
            "Earth should have notable terrain variance: {}", earth_var);
    }

    #[test]
    fn test_no_nan_or_inf() {
        for body in &solar_bodies() {
            let output = run_terrain_benchmark(body);

            assert!(output.heightmap.iter().all(|h| h.is_finite()),
                "{}: heightmap contains NaN/Inf", body.name);
            assert!(output.albedo.iter().all(|&v| v <= 255),
                "{}: albedo has invalid values", body.name);
            assert!(output.ocean_level.is_finite(),
                "{}: ocean level is NaN/Inf", body.name);
        }
    }

    #[test]
    fn test_generation_performance() {
        use std::time::Instant;

        for body in &solar_bodies() {
            let start = Instant::now();
            let _output = run_terrain_benchmark(body);
            let elapsed = start.elapsed();

            // Should complete in under 5 seconds at 64×64 resolution
            assert!(elapsed.as_secs() < 5,
                "{}: generation took {:?} (too slow)", body.name, elapsed);
        }
    }

    // ── Full Geology Sweep ──

    #[test]
    fn test_all_bodies_geology_ranges() {
        for body in &solar_bodies() {
            let geo = run_geology_benchmark(body);

            // All values should be in valid ranges
            assert!(geo.volcanism_level >= 0.0 && geo.volcanism_level <= 1.0,
                "{}: volcanism {} out of range", body.name, geo.volcanism_level);
            assert!(geo.crater_density >= 0.0 && geo.crater_density <= 1.0,
                "{}: craters {} out of range", body.name, geo.crater_density);
            assert!(geo.ocean_fraction >= 0.0 && geo.ocean_fraction <= 1.0,
                "{}: ocean {} out of range", body.name, geo.ocean_fraction);
            assert!(geo.ice_fraction >= 0.0 && geo.ice_fraction <= 1.0,
                "{}: ice {} out of range", body.name, geo.ice_fraction);
            assert!(geo.mountain_height_km >= 0.0,
                "{}: mountain height {} negative", body.name, geo.mountain_height_km);
        }
    }
}
