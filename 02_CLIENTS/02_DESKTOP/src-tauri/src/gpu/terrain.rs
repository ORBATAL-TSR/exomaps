//! Unified terrain generation pipeline.
//!
//! Integrates all simulation modules into a single coherent heightmap:
//!
//!   Geology → global parameters (regime, volcanism, craters...)
//!   Tectonics → plate-driven large-scale features (if mobile/episodic lid)
//!   Noise → multi-domain terrain detail (fBm, ridged multifractal, domain warping)
//!   Craters → impact basin overlay (for stagnant lid bodies)
//!   Erosion → hydraulic + thermal post-processing
//!   Biomes → per-pixel classification from terrain + climate
//!
//! Output: heightmap (f64), biome map, PBR material map (albedo, roughness, metalness, AO, emissive)
//!
//! The pipeline is resolution-independent and deterministic from a seed.

use noise::{NoiseFn, Perlin};

use super::super::simulation::geology::{GeologyParams, TectonicRegime};
use super::super::simulation::tectonics;
use super::super::simulation::biomes;
use super::simd_kernels::SphericalLUT;

// ── Terrain generation parameters ───────────────────

/// Full terrain configuration, derived from geology + planet properties.
#[derive(Debug, Clone)]
pub struct TerrainConfig {
    pub seed: u32,
    pub resolution: usize,
    pub planet_type: String,
    pub geology: GeologyParams,
    pub mass_earth: f64,
    pub radius_earth: f64,
    pub surface_temp_k: f64,
    pub surface_pressure_bar: f64,
    pub star_teff_k: f64,
    pub obliquity_deg: f64,
    pub age_gyr: f64,
    pub in_habitable_zone: bool,
    pub global_precipitation: f64, // 0-1, from climate model
}

/// Complete terrain output — all textures + metadata.
pub struct TerrainOutput {
    /// Heightmap as f64 values in [0, 1], row-major (width × height).
    pub heightmap: Vec<f64>,
    /// RGBA albedo texture (u8), row-major, sRGB.
    pub albedo: Vec<u8>,
    /// RGBA normal map (u8), tangent-space, row-major.
    pub normals: Vec<u8>,
    /// RGBA roughness map (u8), R=roughness, G=metalness, B=AO, A=emissive.
    pub pbr_map: Vec<u8>,
    /// Biome classification per pixel.
    pub biome_ids: Vec<u8>,
    /// Ocean level threshold used.
    pub ocean_level: f64,
    /// Total generation time in ms.
    pub generation_time_ms: f64,
}

// ── Main pipeline entry point ───────────────────────

/// Generate complete terrain for a planet.
///
/// This is the master pipeline that replaces the old per-pass system.
/// Everything is generated in a single coherent pass to ensure consistency
/// between heightmap, biomes, and textures.
pub fn generate_terrain(config: &TerrainConfig) -> TerrainOutput {
    let start = std::time::Instant::now();
    let size = config.resolution;
    let total = size * size;
    let lut = SphericalLUT::new(size);

    // ── Phase 1: Base heightmap from noise ──
    let mut heightmap = generate_base_noise(config, &lut);

    // ── Phase 2: Tectonic features (if applicable) ──
    if matches!(config.geology.tectonic_regime, TectonicRegime::MobileLid | TectonicRegime::Episodic) {
        apply_tectonics(&mut heightmap, config);
    }

    // ── Phase 3: Crater overlay (for stagnant lid) ──
    if matches!(config.geology.tectonic_regime, TectonicRegime::StagnantLid)
        && config.geology.crater_density > 0.1
    {
        apply_craters(&mut heightmap, config, &lut);
    }

    // ── Phase 4: Volcanic features ──
    if config.geology.volcanism_level > 0.15 {
        apply_volcanism(&mut heightmap, config, &lut);
    }

    // ── Phase 5: Thermal erosion ──
    apply_thermal_erosion(&mut heightmap, size, 3);

    // ── Phase 6: Normalize heightmap ──
    normalize_heightmap(&mut heightmap);

    // ── Phase 7: Determine ocean level ──
    // Apply seed-dependent perturbation to ocean fraction for visual variety.
    // Different seeds shift the ocean fraction ±15%, clamped to valid range.
    let seed_frac = {
        let v = config.seed.wrapping_mul(2654435761).wrapping_add(777);
        (v as f64 / u32::MAX as f64) * 2.0 - 1.0 // -1 to +1
    };
    let perturbed_ocean = (config.geology.ocean_fraction + seed_frac * 0.15).clamp(0.0, 0.9);
    let ocean_level = compute_ocean_level(&heightmap, perturbed_ocean);

    // ── Phase 8: Biome classification ──
    let (biome_map, biome_materials) = biomes::generate_biome_map(
        &heightmap,
        size,
        size,
        config.surface_temp_k,
        config.global_precipitation,
        ocean_level,
        config.surface_pressure_bar,
        config.star_teff_k,
        config.obliquity_deg,
        config.geology.mountain_height_km,
    );

    // ── Phase 9: Albedo from biome materials ──
    let albedo = generate_albedo_from_biomes(
        &heightmap, &biome_materials, &biome_map, size, ocean_level, config, &lut,
    );

    // ── Phase 10: PBR material map ──
    let pbr_map = generate_pbr_map(&biome_materials, total);

    // ── Phase 11: Normal map ──
    let mut normals = vec![0u8; total * 4];
    super::simd_kernels::sobel_normals_batch(&heightmap, size, 2.5, &mut normals);

    // ── Phase 12: Biome ID map ──
    let biome_ids = biome_map.iter().map(|b| *b as u8).collect();

    // ── Phase 13: Convert heightmap to RGBA u8 ──
    // (for backward compat — the f64 heightmap is the real output)

    let elapsed = start.elapsed();

    TerrainOutput {
        heightmap,
        albedo,
        normals,
        pbr_map,
        biome_ids,
        ocean_level,
        generation_time_ms: elapsed.as_secs_f64() * 1000.0,
    }
}

// ── Phase 1: Multi-domain noise ─────────────────────

fn generate_base_noise(config: &TerrainConfig, lut: &SphericalLUT) -> Vec<f64> {
    let size = config.resolution;
    let total = size * size;
    let mut heightmap = vec![0.0_f64; total];

    let perlin = Perlin::new(config.seed);
    let perlin_warp = Perlin::new(config.seed.wrapping_add(1000));

    // Noise parameters vary by planet type and geology
    let (base_octaves, base_freq, persistence) = match config.planet_type.as_str() {
        "sub-earth" | "rocky" => (7, 5.0, 0.58),
        "super-earth" => (6, 4.0, 0.52),
        _ => (5, 3.0, 0.50),
    };

    let roughness_amp = config.geology.tectonic_roughness;

    for row in 0..size {
        for col in 0..size {
            let (sx, sy, sz) = lut.sphere_point(col, row);

            // Domain warping: distort coordinates for organic-looking terrain
            let warp_strength = 0.6 * roughness_amp;
            let wx = perlin_warp.get([sx * 2.0, sy * 2.0, sz * 2.0]) * warp_strength;
            let wy = perlin_warp.get([sx * 2.0 + 17.1, sy * 2.0 + 31.4, sz * 2.0 + 47.2]) * warp_strength;
            let wz = perlin_warp.get([sx * 2.0 + 59.8, sy * 2.0 + 71.3, sz * 2.0 + 89.1]) * warp_strength;

            let wsx = sx + wx;
            let wsy = sy + wy;
            let wsz = sz + wz;

            // Layer 1: Continental-scale features (low frequency fBm)
            let continental = fbm(
                &perlin, wsx, wsy, wsz,
                4, base_freq * 0.3, 0.55,
            ) * 0.4;

            // Layer 2: Regional detail (medium frequency fBm)
            let regional = fbm(
                &perlin, wsx, wsy, wsz,
                base_octaves as u32, base_freq, persistence,
            ) * 0.35 * roughness_amp;

            // Layer 3: Ridged multifractal for mountain ridges
            let ridged = ridged_multifractal(
                &perlin, wsx, wsy, wsz,
                5, base_freq * 1.5, 0.52,
                config.seed,
            ) * 0.25 * roughness_amp;

            heightmap[row * size + col] = continental + regional + ridged;
        }
    }

    heightmap
}

/// fBm (fractional Brownian motion) noise evaluation.
fn fbm(
    perlin: &Perlin,
    x: f64, y: f64, z: f64,
    octaves: u32,
    base_freq: f64,
    persistence: f64,
) -> f64 {
    let mut value = 0.0;
    let mut amp = 1.0;
    let mut freq = base_freq;
    let mut max_amp = 0.0;

    for _ in 0..octaves {
        value += amp * perlin.get([x * freq, y * freq, z * freq]);
        max_amp += amp;
        amp *= persistence;
        freq *= 2.0;
    }

    (value / max_amp + 1.0) * 0.5
}

/// Ridged multifractal noise — creates sharp ridge-like features.
/// Great for mountain ranges, fault scarps, canyon walls.
fn ridged_multifractal(
    perlin: &Perlin,
    x: f64, y: f64, z: f64,
    octaves: u32,
    base_freq: f64,
    persistence: f64,
    seed: u32,
) -> f64 {
    let offset_perlin = Perlin::new(seed.wrapping_add(777));
    let mut value = 0.0;
    let mut amp = 1.0;
    let mut freq = base_freq;
    let mut max_amp = 0.0;
    let mut prev = 1.0_f64;

    for i in 0..octaves {
        // Use alternating seeds per octave for variety
        let noise_val = if i % 2 == 0 {
            perlin.get([x * freq, y * freq, z * freq])
        } else {
            offset_perlin.get([x * freq, y * freq, z * freq])
        };

        // Ridge operation: fold the noise
        let ridged = 1.0 - noise_val.abs();
        let ridged_sq = ridged * ridged;

        // Weight by previous octave for detail at ridge crests
        let weighted = ridged_sq * prev;
        prev = ridged_sq;

        value += weighted * amp;
        max_amp += amp;
        amp *= persistence;
        freq *= 2.2; // slightly higher lacunarity for ridged
    }

    value / max_amp
}

// ── Phase 2: Tectonic features ──────────────────────

fn apply_tectonics(heightmap: &mut [f64], config: &TerrainConfig) {
    let size = config.resolution;
    let num_plates = tectonics::estimate_plate_count(config.mass_earth, config.geology.tectonic_roughness);
    let continental_frac = tectonics::estimate_continental_fraction(config.mass_earth, config.geology.ocean_fraction);

    // Tectonics uses equirectangular (width=2*height), so pass 2*size as resolution
    // This gives a map of (2*size) × size, matching equirectangular convention.
    // We then sample it into our square heightmap.
    let tect_res = size * 2;
    let model = tectonics::generate_tectonic_model(
        config.seed as u64,
        num_plates,
        continental_frac,
        tect_res,
        config.geology.tectonic_roughness,
        config.geology.volcanism_level,
    );

    let tectonic_hm = tectonics::tectonic_heightmap(&model);
    let tw = model.map_width;
    let th = model.map_height;

    // Blend tectonic features with existing noise heightmap
    let tectonic_weight = match config.geology.tectonic_regime {
        TectonicRegime::MobileLid => 0.40,  // strong plate-driven features
        TectonicRegime::Episodic => 0.25,   // moderate
        _ => 0.0,
    };

    let noise_weight = 1.0 - tectonic_weight;

    // Resample tectonic heightmap (tw × th) into our square (size × size) map
    for row in 0..size {
        let ty = (row as f64 / size as f64 * th as f64).min((th - 1) as f64) as usize;
        for col in 0..size {
            let tx = (col as f64 / size as f64 * tw as f64).min((tw - 1) as f64) as usize;
            let tect_val = tectonic_hm[ty * tw + tx];
            let idx = row * size + col;
            heightmap[idx] = heightmap[idx] * noise_weight + tect_val * tectonic_weight;
        }
    }
}

// ── Phase 3: Impact craters ─────────────────────────

fn apply_craters(heightmap: &mut [f64], config: &TerrainConfig, lut: &SphericalLUT) {
    let size = config.resolution;
    let density = config.geology.crater_density;

    // Number of craters scales with density and resolution
    let num_large = (density * 8.0) as usize + 1;
    let num_medium = (density * 25.0) as usize;
    let num_small = (density * 100.0) as usize;

    // Generate crater centers using golden ratio spiral
    let all_craters = generate_crater_positions(
        config.seed,
        num_large + num_medium + num_small,
    );

    for (i, (cx, cy, cz)) in all_craters.iter().enumerate() {
        let (radius, depth, rim_height) = if i < num_large {
            (0.15 + 0.10 * pseudo_random(config.seed, i as u32), 0.08, 0.03)
        } else if i < num_large + num_medium {
            (0.05 + 0.05 * pseudo_random(config.seed, i as u32 + 1000), 0.04, 0.015)
        } else {
            (0.01 + 0.02 * pseudo_random(config.seed, i as u32 + 2000), 0.02, 0.008)
        };

        for row in 0..size {
            for col in 0..size {
                let (sx, sy, sz) = lut.sphere_point(col, row);

                // Great-circle distance on unit sphere
                let dot = (sx * cx + sy * cy + sz * cz).clamp(-1.0, 1.0);
                let dist = dot.acos(); // angular distance

                if dist < radius * 2.0 {
                    let r = dist / radius;
                    let crater_profile = crater_shape(r, depth, rim_height);
                    heightmap[row * size + col] += crater_profile;
                }
            }
        }
    }
}

/// Realistic crater profile function.
/// Based on Pike 1977 crater morphology.
fn crater_shape(r: f64, depth: f64, rim_height: f64) -> f64 {
    if r > 2.0 { return 0.0; }

    if r < 0.8 {
        // Bowl interior: parabolic
        -depth * (1.0 - (r / 0.8).powi(2))
    } else if r < 1.0 {
        // Inner wall: steep rise to rim
        let t = (r - 0.8) / 0.2;
        -depth * (1.0 - t) + rim_height * t * t
    } else if r < 1.3 {
        // Rim crest + outer wall
        let t = (r - 1.0) / 0.3;
        rim_height * (1.0 - t * t)
    } else {
        // Ejecta blanket: gentle fade
        let t = (r - 1.3) / 0.7;
        rim_height * 0.1 * (1.0 - t).max(0.0)
    }
}

fn generate_crater_positions(seed: u32, count: usize) -> Vec<(f64, f64, f64)> {
    let golden_ratio = (1.0 + 5.0_f64.sqrt()) / 2.0;
    let mut positions = Vec::with_capacity(count);

    for i in 0..count {
        let theta = 2.0 * std::f64::consts::PI * (i as f64) / golden_ratio;
        let phi = ((1.0 - 2.0 * (i as f64 + 0.5) / count as f64)).acos();

        // Add jitter for naturalistic variation
        let jx = pseudo_random(seed, i as u32 * 3) * 0.3;
        let jy = pseudo_random(seed, i as u32 * 3 + 1) * 0.3;

        let phi_j = phi + jx * 0.2;
        let theta_j = theta + jy * 0.3;

        positions.push((
            phi_j.sin() * theta_j.cos(),
            phi_j.sin() * theta_j.sin(),
            phi_j.cos(),
        ));
    }

    positions
}

// ── Phase 4: Volcanic features ──────────────────────

fn apply_volcanism(heightmap: &mut [f64], config: &TerrainConfig, lut: &SphericalLUT) {
    let size = config.resolution;
    let volcanism = config.geology.volcanism_level;
    let perlin = Perlin::new(config.seed.wrapping_add(3000));

    // Number of volcanic peaks
    let num_volcanoes = (volcanism * 12.0) as usize + 1;

    // Shield volcanoes (Olympus Mons / Mauna Kea type)
    let positions = generate_crater_positions(config.seed.wrapping_add(4000), num_volcanoes);

    for (i, (cx, cy, cz)) in positions.iter().enumerate() {
        let size_factor = 0.5 + 0.5 * pseudo_random(config.seed, i as u32 + 5000);
        let radius = 0.08 * size_factor * volcanism;
        let peak_height = 0.12 * size_factor * volcanism;

        for row in 0..size {
            for col in 0..size {
                let (sx, sy, sz) = lut.sphere_point(col, row);
                let dot = (sx * cx + sy * cy + sz * cz).clamp(-1.0, 1.0);
                let dist = dot.acos();

                if dist < radius * 3.0 {
                    let r = dist / radius;
                    let profile = volcano_profile(r, peak_height);

                    // Add noise for irregular flanks
                    let noise = perlin.get([sx * 20.0, sy * 20.0, sz * 20.0]) * 0.01;
                    heightmap[row * size + col] += profile + noise * profile.abs();
                }
            }
        }
    }
}

/// Shield volcano profile (Hawaiian / Olympus Mons type).
fn volcano_profile(r: f64, peak_height: f64) -> f64 {
    if r > 3.0 { return 0.0; }

    if r < 0.15 {
        // Caldera (summit crater)
        peak_height * (0.85 + 0.15 * (r / 0.15).powi(2))
    } else if r < 1.0 {
        // Main edifice: gentle exponential slope
        peak_height * (-(r - 0.15) * 1.5).exp()
    } else {
        // Distal apron: very gentle
        peak_height * (-1.5_f64).exp() * (-(r - 1.0) * 0.5).exp()
    }
}

// ── Phase 5: Thermal erosion ────────────────────────

/// Simple thermal erosion: smooths steep slopes.
/// Based on Musgrave et al. 1989 "The Synthesis and Rendering of Eroded Fractal Terrains"
fn apply_thermal_erosion(heightmap: &mut [f64], size: usize, iterations: u32) {
    let talus_angle = 0.04; // max height difference before material flows

    for _ in 0..iterations {
        let snapshot = heightmap.to_vec();

        for row in 1..size - 1 {
            for col in 1..size - 1 {
                let idx = row * size + col;
                let h = snapshot[idx];

                // Check 4 neighbors
                let neighbors = [
                    (row - 1) * size + col,
                    (row + 1) * size + col,
                    row * size + col - 1,
                    row * size + col + 1,
                ];

                let mut max_diff = 0.0_f64;
                let mut max_neighbor = idx;
                let mut _total_excess = 0.0;
                let mut n_exceed = 0u32;

                for &ni in &neighbors {
                    let diff = h - snapshot[ni];
                    if diff > talus_angle {
                        _total_excess += diff - talus_angle;
                        n_exceed += 1;
                        if diff > max_diff {
                            max_diff = diff;
                            max_neighbor = ni;
                        }
                    }
                }

                if n_exceed > 0 {
                    // Move material to steepest downhill neighbor
                    let transfer = (max_diff - talus_angle) * 0.4;
                    heightmap[idx] -= transfer;
                    heightmap[max_neighbor] += transfer;
                }
            }
        }
    }
}

// ── Phase 6: Normalization ──────────────────────────

fn normalize_heightmap(heightmap: &mut [f64]) {
    let min = heightmap.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = heightmap.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let range = max - min;

    if range > 1e-10 {
        let inv = 1.0 / range;
        for h in heightmap.iter_mut() {
            *h = (*h - min) * inv;
        }
    }
}

// ── Phase 7: Ocean level calculation ────────────────

fn compute_ocean_level(heightmap: &[f64], target_ocean_fraction: f64) -> f64 {
    if target_ocean_fraction <= 0.01 {
        return 0.0; // no ocean
    }

    // Binary search for the height threshold that gives the target ocean fraction
    let mut lo = 0.0_f64;
    let mut hi = 1.0_f64;
    let total = heightmap.len() as f64;

    for _ in 0..32 {
        let mid = (lo + hi) * 0.5;
        let ocean_count = heightmap.iter().filter(|&&h| h < mid).count() as f64;
        let fraction = ocean_count / total;

        if fraction < target_ocean_fraction {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    (lo + hi) * 0.5
}

// ── Phase 9: Biome-driven albedo ────────────────────

fn generate_albedo_from_biomes(
    heightmap: &[f64],
    materials: &[biomes::BiomeMaterial],
    _biome_map: &[biomes::Biome],
    size: usize,
    ocean_level: f64,
    config: &TerrainConfig,
    lut: &SphericalLUT,
) -> Vec<u8> {
    let total = size * size;
    let mut albedo = vec![0u8; total * 4];
    let perlin = Perlin::new(config.seed.wrapping_add(9000));

    // Seed-dependent hue/saturation shift for visual variety between planets.
    // This rotates the color palette slightly so two planets at the same temperature
    // don't have identical coloring. Range: ±12% per channel.
    let hue_r = {
        let v = config.seed.wrapping_mul(48271).wrapping_add(111);
        (v as f32 / u32::MAX as f32) * 0.24 - 0.12
    };
    let hue_g = {
        let v = config.seed.wrapping_mul(16807).wrapping_add(222);
        (v as f32 / u32::MAX as f32) * 0.24 - 0.12
    };
    let hue_b = {
        let v = config.seed.wrapping_mul(69621).wrapping_add(333);
        (v as f32 / u32::MAX as f32) * 0.24 - 0.12
    };

    for row in 0..size {
        for col in 0..size {
            let idx = row * size + col;
            let mat = &materials[idx];
            let h = heightmap[idx];
            let (sx, sy, sz) = lut.sphere_point(col, row);

            // Base color from biome + seed-dependent hue shift
            let mut r = (mat.color[0] + hue_r).clamp(0.0, 1.0);
            let mut g = (mat.color[1] + hue_g).clamp(0.0, 1.0);
            let mut b = (mat.color[2] + hue_b).clamp(0.0, 1.0);

            // Add noise variation within biome for visual richness
            let detail_noise = perlin.get([sx * 30.0, sy * 30.0, sz * 30.0]) as f32 * 0.08;
            r = (r + detail_noise).clamp(0.0, 1.0);
            g = (g + detail_noise * 0.8).clamp(0.0, 1.0);
            b = (b + detail_noise * 0.6).clamp(0.0, 1.0);

            // Height-based shading (darker in valleys, lighter on ridges)
            let shade = 0.85 + 0.15 * h as f32;
            r *= shade;
            g *= shade;
            b *= shade;

            // Ocean depth color modulation
            if h < ocean_level {
                let depth = ((ocean_level - h) / ocean_level) as f32;
                r *= 1.0 - depth * 0.5;
                g *= 1.0 - depth * 0.3;
                b *= 1.0 - depth * 0.1;
            }

            // Hot planet temperature tinting
            if config.surface_temp_k > 600.0 {
                let hot = (((config.surface_temp_k - 600.0) / 1400.0).min(1.0) * 0.3) as f32;
                r = (r + hot * (1.0 - r)).min(1.0);
                g = (g - hot * g * 0.4).max(0.0);
                b = (b - hot * b * 0.6).max(0.0);
            }

            let pidx = idx * 4;
            albedo[pidx]     = (r * 255.0) as u8;
            albedo[pidx + 1] = (g * 255.0) as u8;
            albedo[pidx + 2] = (b * 255.0) as u8;
            albedo[pidx + 3] = 255;
        }
    }

    albedo
}

// ── Phase 10: PBR material map ──────────────────────

fn generate_pbr_map(materials: &[biomes::BiomeMaterial], total: usize) -> Vec<u8> {
    let mut pbr = vec![0u8; total * 4];

    for i in 0..total {
        let mat = &materials[i];
        let idx = i * 4;
        pbr[idx]     = (mat.roughness * 255.0) as u8;
        pbr[idx + 1] = (mat.metalness * 255.0) as u8;
        pbr[idx + 2] = (mat.ao * 255.0) as u8;
        pbr[idx + 3] = (mat.emissive * 255.0) as u8;
    }

    pbr
}

// ── Gas giant terrain (band structure) ──────────────

/// Generate gas giant cloud bands instead of terrain.
/// Uses latitude-dependent zonal flow + storm vortices.
pub fn generate_gas_giant_bands(config: &TerrainConfig) -> TerrainOutput {
    let start = std::time::Instant::now();
    let size = config.resolution;
    let total = size * size;
    let lut = SphericalLUT::new(size);
    let perlin = Perlin::new(config.seed);
    let perlin2 = Perlin::new(config.seed.wrapping_add(100));

    let mut heightmap = vec![0.5_f64; total]; // uniform for gas giants
    let mut albedo = vec![0u8; total * 4];

    // Band parameters by type
    let (band_count, base_hue, contrast) = match config.planet_type.as_str() {
        "gas-giant" => (18.0, [0.65, 0.45, 0.18], 0.40),
        "super-jupiter" => (14.0, [0.50, 0.22, 0.08], 0.35),
        "neptune-like" => (10.0, [0.15, 0.35, 0.65], 0.25),
        _ => (12.0, [0.50, 0.40, 0.30], 0.30),
    };

    for row in 0..size {
        let lat = (row as f64 / size as f64 - 0.5) * std::f64::consts::PI;

        // Zonal wind speed pattern (alternating bands)
        let zonal = (lat * band_count).sin();
        let band_brightness = 0.5 + zonal * 0.5; // 0-1

        for col in 0..size {
            let idx = row * size + col;
            let (sx, sy, sz) = lut.sphere_point(col, row);

            // Turbulence at band edges
            let turbulence = perlin.get([sx * 8.0, sy * 8.0, sz * 8.0]) * 0.15;

            // Storm vortices (Great Red Spot style)
            let storm = perlin2.get([sx * 3.0, sy * 3.0, sz * 3.0]);
            let storm_contrib = if storm > 0.7 { (storm - 0.7) * 1.5 } else { 0.0 };

            let brightness = (band_brightness + turbulence + storm_contrib * 0.2).clamp(0.0, 1.0);

            // Color varies between bands
            let band_color = if zonal > 0.0 {
                // Bright zones
                [
                    base_hue[0] + contrast * 0.5,
                    base_hue[1] + contrast * 0.4,
                    base_hue[2] + contrast * 0.3,
                ]
            } else {
                // Dark belts
                [
                    base_hue[0] - contrast * 0.3,
                    base_hue[1] - contrast * 0.2,
                    base_hue[2] - contrast * 0.1,
                ]
            };

            let r = (band_color[0] * brightness + turbulence * 0.1).clamp(0.0, 1.0);
            let g = (band_color[1] * brightness + turbulence * 0.05).clamp(0.0, 1.0);
            let b = (band_color[2] * brightness).clamp(0.0, 1.0);

            heightmap[idx] = brightness;

            let pidx = idx * 4;
            albedo[pidx]     = (r * 255.0) as u8;
            albedo[pidx + 1] = (g * 255.0) as u8;
            albedo[pidx + 2] = (b * 255.0) as u8;
            albedo[pidx + 3] = 255;
        }
    }

    // Normal map from "height" (cloud tops)
    let mut normals = vec![0u8; total * 4];
    super::simd_kernels::sobel_normals_batch(&heightmap, size, 1.0, &mut normals);

    // PBR: gas giants are smooth, non-metallic
    let mut pbr_map = vec![0u8; total * 4];
    for i in 0..total {
        let idx = i * 4;
        pbr_map[idx]     = 180; // roughness ~0.7
        pbr_map[idx + 1] = 0;   // metalness 0
        pbr_map[idx + 2] = 240; // AO ~0.94
        pbr_map[idx + 3] = 0;   // emissive 0
    }

    let elapsed = start.elapsed();

    TerrainOutput {
        heightmap,
        albedo,
        normals,
        pbr_map,
        biome_ids: vec![0; total],
        ocean_level: 0.0,
        generation_time_ms: elapsed.as_secs_f64() * 1000.0,
    }
}

// ── Utility ─────────────────────────────────────────

/// Deterministic pseudo-random value from seed + index. Returns [0, 1].
fn pseudo_random(seed: u32, index: u32) -> f64 {
    let hash = seed
        .wrapping_mul(2654435761)
        .wrapping_add(index.wrapping_mul(2246822519));
    let hash = hash ^ (hash >> 16);
    let hash = hash.wrapping_mul(0x45d9f3b);
    let hash = hash ^ (hash >> 16);
    (hash & 0x00FFFFFF) as f64 / 16777215.0
}

// ── Public convenience: heightmap to RGBA u8 ────────

pub fn heightmap_to_rgba(heightmap: &[f64], size: usize) -> Vec<u8> {
    let total = size * size;
    let mut data = vec![0u8; total * 4];
    for i in 0..total {
        let h = (heightmap[i].clamp(0.0, 1.0) * 255.0) as u8;
        let idx = i * 4;
        data[idx] = h;
        data[idx + 1] = h;
        data[idx + 2] = h;
        data[idx + 3] = 255;
    }
    data
}

#[cfg(test)]
mod tests {
    use super::*;


    fn earth_config() -> TerrainConfig {
        TerrainConfig {
            seed: 42,
            resolution: 64,
            planet_type: "super-earth".to_string(),
            geology: GeologyParams {
                tectonic_regime: TectonicRegime::MobileLid,
                volcanism_level: 0.3,
                crater_density: 0.1,
                ocean_fraction: 0.71,
                ice_fraction: 0.03,
                mountain_height_km: 8.848,
                tectonic_roughness: 0.7,
            },
            mass_earth: 1.0,
            radius_earth: 1.0,
            surface_temp_k: 288.0,
            surface_pressure_bar: 1.0,
            star_teff_k: 5778.0,
            obliquity_deg: 23.44,
            age_gyr: 4.6,
            in_habitable_zone: true,
            global_precipitation: 0.6,
        }
    }

    #[test]
    fn test_terrain_pipeline_earth() {
        let config = earth_config();
        let output = generate_terrain(&config);

        assert_eq!(output.heightmap.len(), 64 * 64);
        assert_eq!(output.albedo.len(), 64 * 64 * 4);
        assert_eq!(output.normals.len(), 64 * 64 * 4);
        assert_eq!(output.pbr_map.len(), 64 * 64 * 4);
        assert_eq!(output.biome_ids.len(), 64 * 64);

        // Heightmap should be normalized to [0, 1]
        assert!(output.heightmap.iter().all(|&h| h >= 0.0 && h <= 1.0));

        // Ocean level should be set for Earth-like planets
        assert!(output.ocean_level > 0.3, "Earth should have significant ocean level");
    }

    #[test]
    fn test_terrain_pipeline_mars() {
        let config = TerrainConfig {
            seed: 7,
            resolution: 32,
            planet_type: "rocky".to_string(),
            geology: GeologyParams {
                tectonic_regime: TectonicRegime::StagnantLid,
                volcanism_level: 0.15,
                crater_density: 0.7,
                ocean_fraction: 0.0,
                ice_fraction: 0.05,
                mountain_height_km: 21.9,
                tectonic_roughness: 0.55,
            },
            mass_earth: 0.107,
            radius_earth: 0.532,
            surface_temp_k: 210.0,
            surface_pressure_bar: 0.006,
            star_teff_k: 5778.0,
            obliquity_deg: 25.19,
            age_gyr: 4.6,
            in_habitable_zone: false,
            global_precipitation: 0.0,
        };
        let output = generate_terrain(&config);
        assert!(output.ocean_level < 0.01, "Mars should have no ocean");
    }

    #[test]
    fn test_gas_giant_bands() {
        let config = TerrainConfig {
            seed: 12,
            resolution: 32,
            planet_type: "gas-giant".to_string(),
            geology: GeologyParams {
                tectonic_regime: TectonicRegime::None,
                volcanism_level: 0.0,
                crater_density: 0.0,
                ocean_fraction: 0.0,
                ice_fraction: 0.0,
                mountain_height_km: 0.0,
                tectonic_roughness: 0.3,
            },
            mass_earth: 318.0,
            radius_earth: 11.2,
            surface_temp_k: 165.0,
            surface_pressure_bar: 1000.0,
            star_teff_k: 5778.0,
            obliquity_deg: 3.13,
            age_gyr: 4.6,
            in_habitable_zone: false,
            global_precipitation: 0.0,
        };
        let output = generate_gas_giant_bands(&config);
        assert_eq!(output.albedo.len(), 32 * 32 * 4);
    }

    #[test]
    fn test_ocean_level_binary_search() {
        let heightmap: Vec<f64> = (0..1000).map(|i| i as f64 / 999.0).collect();
        let level = compute_ocean_level(&heightmap, 0.5);
        assert!((level - 0.5).abs() < 0.02, "50% ocean should give level ~0.5, got {}", level);
    }

    #[test]
    fn test_determinism() {
        let config = earth_config();
        let out1 = generate_terrain(&config);
        let out2 = generate_terrain(&config);
        assert_eq!(out1.heightmap, out2.heightmap, "Same seed must produce identical terrain");
    }

    #[test]
    fn test_crater_shape() {
        // Center should be deepest
        let center = crater_shape(0.0, 0.1, 0.03);
        assert!(center < 0.0, "Crater center should be below surface");

        // Rim should be highest
        let rim = crater_shape(1.0, 0.1, 0.03);
        assert!(rim >= 0.0, "Crater rim should be above surface");

        // Far away should be zero
        let far = crater_shape(2.5, 0.1, 0.03);
        assert!((far - 0.0).abs() < 1e-10, "Far from crater should be flat");
    }
}
