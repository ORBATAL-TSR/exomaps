//! GPU compute shaders for procedural planet texture generation.
//!
//! Four compute passes:
//!   1. Heightmap — multi-octave noise from planet seed + surface params
//!   2. Albedo — color mapping from heightmap + composition + biome rules
//!   3. Normals — Sobel-filter normal map from heightmap
//!   4. Atmosphere LUT — scattering lookup table for atmosphere shell
//!
//! Each pass runs a compute shader on the GPU and reads back the result
//! as a byte buffer. Currently uses placeholder CPU implementations
//! while the wgpu compute pipeline is being developed.

use crate::{AtmosphereSummary, BulkComposition};

// ── Noise utilities (CPU fallback while compute shaders are WIP) ──

use noise::{NoiseFn, Perlin};

fn seed_from_index(index: u32) -> u32 {
    // Deterministic seed from planet index
    index.wrapping_mul(2654435761)
}

/// Generate a heightmap texture (RGBA, R=height, GBA unused for now).
///
/// Uses multi-octave Perlin noise shaped by planet type.
pub async fn generate_heightmap(
    _device: &wgpu::Device,
    _queue: &wgpu::Queue,
    resolution: u32,
    planet_index: u32,
    composition: &BulkComposition,
    planet_type: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let seed = seed_from_index(planet_index);
    let perlin = Perlin::new(seed);
    let size = resolution as usize;
    let mut data = vec![0u8; size * size * 4];

    // Noise parameters vary by planet type
    let (octaves, persistence, lacunarity, base_freq) = match planet_type {
        "sub-earth" | "rocky" => (6, 0.55, 2.1, 4.0),
        "super-earth" => (5, 0.50, 2.0, 3.0),
        "neptune-like" | "gas-giant" | "super-jupiter" => (4, 0.45, 2.2, 2.0),
        _ => (5, 0.50, 2.0, 3.5),
    };

    // Additional crater density for small rocky bodies
    let crater_intensity = if composition.volatile_fraction < 0.1 && composition.h_he_fraction < 0.01 {
        0.3
    } else {
        0.0
    };

    for y in 0..size {
        for x in 0..size {
            // Convert to spherical UV
            let u = x as f64 / size as f64;
            let v = y as f64 / size as f64;
            let theta = u * 2.0 * std::f64::consts::PI;
            let phi = v * std::f64::consts::PI;

            // 3D point on unit sphere (avoids seam artifacts)
            let sx = phi.sin() * theta.cos();
            let sy = phi.sin() * theta.sin();
            let sz = phi.cos();

            // Multi-octave noise
            let mut value = 0.0;
            let mut amplitude = 1.0;
            let mut freq = base_freq;
            let mut max_amp = 0.0;

            for _ in 0..octaves {
                value += amplitude * perlin.get([sx * freq, sy * freq, sz * freq]);
                max_amp += amplitude;
                amplitude *= persistence;
                freq *= lacunarity;
            }
            value = (value / max_amp + 1.0) * 0.5; // normalize to [0, 1]

            // Crater overlay for rocky bodies
            if crater_intensity > 0.0 {
                let crater_noise = perlin.get([sx * 12.0, sy * 12.0, sz * 12.0 + 100.0]);
                if crater_noise > 0.6 {
                    let depth = (crater_noise - 0.6) * 2.5;
                    value -= depth * crater_intensity;
                }
            }

            let height = (value.clamp(0.0, 1.0) * 255.0) as u8;
            let idx = (y * size + x) * 4;
            data[idx] = height;     // R = height
            data[idx + 1] = height; // G = height (greyscale preview)
            data[idx + 2] = height; // B = height
            data[idx + 3] = 255;    // A = opaque
        }
    }

    Ok(data)
}

/// Generate albedo (color) texture from heightmap + composition.
pub async fn generate_albedo(
    _device: &wgpu::Device,
    _queue: &wgpu::Queue,
    resolution: u32,
    heightmap: &[u8],
    _composition: &BulkComposition,
    atmosphere: &AtmosphereSummary,
    planet_type: &str,
    in_habitable_zone: bool,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let size = resolution as usize;
    let mut data = vec![0u8; size * size * 4];

    for y in 0..size {
        for x in 0..size {
            let idx = (y * size + x) * 4;
            let height = heightmap[idx] as f64 / 255.0;
            let v = y as f64 / size as f64; // latitude proxy

            let (r, g, b) = match planet_type {
                "sub-earth" => {
                    // Grey cratered surface
                    let grey = 0.4 + height * 0.3;
                    (grey, grey * 0.97, grey * 0.94)
                }
                "rocky" => {
                    // Brown-tan terrain
                    let r = 0.45 + height * 0.35;
                    let g = 0.35 + height * 0.25;
                    let b = 0.20 + height * 0.15;
                    (r, g, b)
                }
                "super-earth" if in_habitable_zone => {
                    // Earth-like: ocean + land + ice caps
                    let lat = (v - 0.5).abs() * 2.0;
                    if lat > 0.85 {
                        // Polar ice
                        (0.85, 0.90, 0.95)
                    } else if height > 0.45 {
                        // Land (green-brown)
                        let land = (height - 0.45) / 0.55;
                        (0.25 + land * 0.3, 0.45 + land * 0.15, 0.15 + land * 0.1)
                    } else {
                        // Ocean
                        let depth = height / 0.45;
                        (0.05 + depth * 0.1, 0.15 + depth * 0.2, 0.45 + depth * 0.2)
                    }
                }
                "super-earth" => {
                    // Dry super-earth: olive-tan
                    (0.50 + height * 0.22, 0.45 + height * 0.17, 0.30 + height * 0.10)
                }
                "neptune-like" => {
                    // Ice-blue banded
                    let band = ((v * 18.0).sin() * 0.5 + 0.5) * 0.3;
                    (0.15 + band * 0.2, 0.30 + band * 0.3 + height * 0.1, 0.55 + band * 0.3)
                }
                "gas-giant" => {
                    // Jupiter-like amber-red banded
                    let band = ((v * 22.0).sin() * 0.5 + 0.5) * 0.4;
                    (0.55 + band * 0.35, 0.35 + band * 0.30 + height * 0.05, 0.12 + band * 0.20)
                }
                "super-jupiter" => {
                    // Deep crimson-brown banded
                    let band = ((v * 16.0).sin() * 0.5 + 0.5) * 0.35;
                    (0.45 + band * 0.40, 0.18 + band * 0.15 + height * 0.05, 0.08 + band * 0.10)
                }
                _ => {
                    // Default rocky
                    (0.5 + height * 0.2, 0.4 + height * 0.2, 0.3 + height * 0.15)
                }
            };

            // Temperature tinting
            let hot_factor = if atmosphere.surface_temp_k > 600.0 {
                ((atmosphere.surface_temp_k - 600.0) / 1400.0).min(1.0) * 0.3
            } else {
                0.0
            };

            data[idx] = ((r + hot_factor * (1.0 - r)).min(1.0) * 255.0) as u8;
            data[idx + 1] = ((g - hot_factor * g * 0.5).max(0.0) * 255.0) as u8;
            data[idx + 2] = ((b - hot_factor * b * 0.7).max(0.0) * 255.0) as u8;
            data[idx + 3] = 255;
        }
    }

    Ok(data)
}

/// Generate a normal map from a heightmap using Sobel filtering.
pub async fn generate_normals(
    _device: &wgpu::Device,
    _queue: &wgpu::Queue,
    resolution: u32,
    heightmap: &[u8],
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let size = resolution as usize;
    let mut data = vec![0u8; size * size * 4];
    let strength = 2.0;

    for y in 0..size {
        for x in 0..size {
            // Sample neighbors (wrap for seamless)
            let get_h = |dx: isize, dy: isize| -> f64 {
                let nx = ((x as isize + dx).rem_euclid(size as isize)) as usize;
                let ny = ((y as isize + dy).rem_euclid(size as isize)) as usize;
                heightmap[(ny * size + nx) * 4] as f64 / 255.0
            };

            // Sobel filter
            let tl = get_h(-1, -1);
            let t  = get_h( 0, -1);
            let tr = get_h( 1, -1);
            let l  = get_h(-1,  0);
            let r  = get_h( 1,  0);
            let bl = get_h(-1,  1);
            let b  = get_h( 0,  1);
            let br = get_h( 1,  1);

            let dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
            let dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

            // Normal in tangent space
            let nx = -dx * strength;
            let ny = -dy * strength;
            let nz = 1.0;
            let len = (nx * nx + ny * ny + nz * nz).sqrt();

            let idx = (y * size + x) * 4;
            data[idx]     = ((nx / len * 0.5 + 0.5) * 255.0) as u8;
            data[idx + 1] = ((ny / len * 0.5 + 0.5) * 255.0) as u8;
            data[idx + 2] = ((nz / len * 0.5 + 0.5) * 255.0) as u8;
            data[idx + 3] = 255;
        }
    }

    Ok(data)
}

/// Generate an atmosphere scattering LUT.
/// 
/// Rows = view angle (0° = zenith, 180° = nadir)
/// Cols = sun angle (0° = overhead, 90° = horizon)
/// RGB = scattered light color for Rayleigh + Mie
pub async fn generate_atmosphere_lut(
    _device: &wgpu::Device,
    _queue: &wgpu::Queue,
    resolution: u32,
    atmosphere: &AtmosphereSummary,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let size = resolution as usize;
    let mut data = vec![0u8; size * size * 4];

    let ray_color = atmosphere.rayleigh_color;

    for y in 0..size {
        for x in 0..size {
            let view_angle = y as f64 / size as f64 * std::f64::consts::PI;
            let sun_angle = x as f64 / size as f64 * std::f64::consts::FRAC_PI_2;

            // Simple Rayleigh scattering approximation
            let cos_theta = (view_angle - sun_angle).cos();
            let phase = 0.75 * (1.0 + cos_theta * cos_theta);

            // Optical depth approximation
            let zenith_optical_depth = atmosphere.surface_pressure_bar * 0.1;
            let airmass = 1.0 / (view_angle.cos().abs() + 0.01);
            let extinction = (-zenith_optical_depth * airmass).exp();

            let scatter = phase * (1.0 - extinction);

            let idx = (y * size + x) * 4;
            data[idx]     = ((ray_color[0] as f64 * scatter).min(1.0) * 255.0) as u8;
            data[idx + 1] = ((ray_color[1] as f64 * scatter).min(1.0) * 255.0) as u8;
            data[idx + 2] = ((ray_color[2] as f64 * scatter).min(1.0) * 255.0) as u8;
            data[idx + 3] = ((scatter * 2.0).min(0.85) * 255.0) as u8;
        }
    }

    Ok(data)
}
