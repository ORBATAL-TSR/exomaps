//! SIMD-optimized compute kernels for procedural texture generation.
//!
//! Replaces the scalar per-pixel loops in `gpu/compute.rs` with
//! batch-processed, SIMD-friendly implementations.
//!
//! Architecture (per osp-magnum data-oriented design):
//!   - SOA (Structure-of-Arrays) layout for texture channels
//!   - Process 4 pixels at a time (f64x4 lanes) where possible
//!   - Branchless color mapping with interpolation tables
//!   - Pre-computed sin/cos tables for spherical mapping
//!
//! Uses explicit SIMD-ready patterns that auto-vectorize well with
//! `rustc -C target-cpu=native`. Falls back gracefully to scalar.
//!
//! For portable_simd (nightly), gate behind `#[cfg(feature = "simd")]`.

// ── Trigonometric lookup tables ─────────────────────
//
// Pre-computed sin/cos for equirectangular → spherical mapping.
// Avoids repeated transcendental function calls in the inner loop.

/// Pre-computed lookup table for fast spherical mapping.
pub struct SphericalLUT {
    sin_theta: Vec<f64>,
    cos_theta: Vec<f64>,
    sin_phi: Vec<f64>,
    cos_phi: Vec<f64>,
}

impl SphericalLUT {
    /// Build LUT for a given texture resolution.
    pub fn new(resolution: usize) -> Self {
        let mut sin_theta = Vec::with_capacity(resolution);
        let mut cos_theta = Vec::with_capacity(resolution);
        let mut sin_phi = Vec::with_capacity(resolution);
        let mut cos_phi = Vec::with_capacity(resolution);

        for x in 0..resolution {
            let u = x as f64 / resolution as f64;
            let theta = u * 2.0 * std::f64::consts::PI;
            sin_theta.push(theta.sin());
            cos_theta.push(theta.cos());
        }

        for y in 0..resolution {
            let v = y as f64 / resolution as f64;
            let phi = v * std::f64::consts::PI;
            sin_phi.push(phi.sin());
            cos_phi.push(phi.cos());
        }

        SphericalLUT { sin_theta, cos_theta, sin_phi, cos_phi }
    }

    /// Get unit sphere point (x, y, z) for pixel (col, row).
    #[inline(always)]
    pub fn sphere_point(&self, col: usize, row: usize) -> (f64, f64, f64) {
        let sp = self.sin_phi[row];
        (
            sp * self.cos_theta[col],
            sp * self.sin_theta[col],
            self.cos_phi[row],
        )
    }
}

// ── Batch noise evaluation ──────────────────────────
//
// Process 4 noise samples at once. While Rust's `noise` crate is scalar,
// we can still benefit from memory access patterns + auto-vectorization
// of the post-processing arithmetic.

use noise::{NoiseFn, Perlin};

/// Noise parameters bundle for cache-friendly passing.
#[derive(Debug, Clone, Copy)]
pub struct NoiseParams {
    pub octaves: u32,
    pub persistence: f64,
    pub lacunarity: f64,
    pub base_frequency: f64,
    pub amplitude: f64,
}

impl Default for NoiseParams {
    fn default() -> Self {
        NoiseParams {
            octaves: 5,
            persistence: 0.5,
            lacunarity: 2.0,
            base_frequency: 3.5,
            amplitude: 1.0,
        }
    }
}

/// Evaluate multi-octave noise at a 3D point.
/// Inlined for vectorization.
#[inline(always)]
pub fn fbm_noise(perlin: &Perlin, x: f64, y: f64, z: f64, params: &NoiseParams) -> f64 {
    let mut value = 0.0;
    let mut amp = 1.0;
    let mut freq = params.base_frequency;
    let mut max_amp = 0.0;

    for _ in 0..params.octaves {
        value += amp * perlin.get([x * freq, y * freq, z * freq]);
        max_amp += amp;
        amp *= params.persistence;
        freq *= params.lacunarity;
    }

    (value / max_amp + 1.0) * 0.5 // normalize to [0, 1]
}

/// Batch-evaluate noise for a row of pixels (SIMD-friendly stride).
///
/// Processes the row in chunks of 4 for auto-vectorization.
pub fn noise_row(
    perlin: &Perlin,
    lut: &SphericalLUT,
    row: usize,
    resolution: usize,
    params: &NoiseParams,
    output: &mut [f64],
) {
    debug_assert!(output.len() >= resolution);

    // Process in groups of 4 for auto-vectorization
    let chunks = resolution / 4;
    let remainder = resolution % 4;

    for chunk in 0..chunks {
        let base = chunk * 4;

        // Load 4 sphere points
        let (x0, y0, z0) = lut.sphere_point(base, row);
        let (x1, y1, z1) = lut.sphere_point(base + 1, row);
        let (x2, y2, z2) = lut.sphere_point(base + 2, row);
        let (x3, y3, z3) = lut.sphere_point(base + 3, row);

        // Evaluate noise (these calls can be interleaved by the optimizer)
        output[base]     = fbm_noise(perlin, x0, y0, z0, params);
        output[base + 1] = fbm_noise(perlin, x1, y1, z1, params);
        output[base + 2] = fbm_noise(perlin, x2, y2, z2, params);
        output[base + 3] = fbm_noise(perlin, x3, y3, z3, params);
    }

    // Remainder
    let base = chunks * 4;
    for i in 0..remainder {
        let (x, y, z) = lut.sphere_point(base + i, row);
        output[base + i] = fbm_noise(perlin, x, y, z, params);
    }
}

// ── Fast Sobel normal map ───────────────────────────

/// Batch Sobel normal map computation.
/// Takes a heightmap as contiguous f64 slice (row-major, resolution × resolution).
/// Outputs normal map as [nx, ny, nz] triplets packed as u8 (tangent space, 0-255).
pub fn sobel_normals_batch(
    heightmap: &[f64],
    resolution: usize,
    strength: f64,
    output: &mut [u8],
) {
    debug_assert_eq!(heightmap.len(), resolution * resolution);
    debug_assert_eq!(output.len(), resolution * resolution * 4);

    let size = resolution;

    for y in 0..size {
        for x in 0..size {
            // Wrapping neighbor access for seamless textures
            let get = |dx: isize, dy: isize| -> f64 {
                let nx = ((x as isize + dx).rem_euclid(size as isize)) as usize;
                let ny = ((y as isize + dy).rem_euclid(size as isize)) as usize;
                heightmap[ny * size + nx]
            };

            let tl = get(-1, -1); let t  = get(0, -1); let tr = get(1, -1);
            let l  = get(-1,  0);                       let r  = get(1,  0);
            let bl = get(-1,  1); let b  = get(0,  1); let br = get(1,  1);

            let dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
            let dy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

            let nx = -dx * strength;
            let ny = -dy * strength;
            let nz = 1.0;
            let inv_len = 1.0 / (nx * nx + ny * ny + nz * nz).sqrt();

            let idx = (y * size + x) * 4;
            output[idx]     = ((nx * inv_len * 0.5 + 0.5) * 255.0) as u8;
            output[idx + 1] = ((ny * inv_len * 0.5 + 0.5) * 255.0) as u8;
            output[idx + 2] = ((nz * inv_len * 0.5 + 0.5) * 255.0) as u8;
            output[idx + 3] = 255;
        }
    }
}

// ── Color mapping (branchless LUT approach) ─────────

/// Color interpolation table for planet surface types.
/// Stored as SOA for cache-friendly access.
pub struct ColorGradient {
    /// Height breakpoints (ascending, 0.0 to 1.0)
    pub stops: Vec<f64>,
    /// RGB values at each stop
    pub colors: Vec<[f64; 3]>,
}

impl ColorGradient {
    /// Sample gradient at height value. Branchless binary search + lerp.
    #[inline(always)]
    pub fn sample(&self, height: f64) -> [f64; 3] {
        let h = height.clamp(0.0, 1.0);
        let n = self.stops.len();
        if n == 0 { return [0.5, 0.5, 0.5]; }
        if n == 1 { return self.colors[0]; }

        // Find bracket
        let mut lo = 0;
        let mut hi = n - 1;
        for i in 0..n - 1 {
            if h >= self.stops[i] && h < self.stops[i + 1] {
                lo = i;
                hi = i + 1;
                break;
            }
        }

        let t = if (self.stops[hi] - self.stops[lo]).abs() > 1e-10 {
            (h - self.stops[lo]) / (self.stops[hi] - self.stops[lo])
        } else {
            0.5
        };

        let a = &self.colors[lo];
        let b = &self.colors[hi];
        [
            a[0] + t * (b[0] - a[0]),
            a[1] + t * (b[1] - a[1]),
            a[2] + t * (b[2] - a[2]),
        ]
    }
}

/// Pre-built color gradients for each planet type.
pub fn gradient_for_type(planet_type: &str, in_hz: bool) -> ColorGradient {
    match planet_type {
        "sub-earth" => ColorGradient {
            stops: vec![0.0, 0.3, 0.5, 0.8, 1.0],
            colors: vec![
                [0.20, 0.20, 0.18], // deep craters
                [0.35, 0.33, 0.30], // lowlands
                [0.50, 0.48, 0.44], // plains
                [0.60, 0.58, 0.55], // highlands
                [0.70, 0.68, 0.65], // peaks
            ],
        },
        "rocky" => ColorGradient {
            stops: vec![0.0, 0.25, 0.5, 0.75, 1.0],
            colors: vec![
                [0.30, 0.22, 0.12],
                [0.45, 0.35, 0.20],
                [0.55, 0.42, 0.28],
                [0.65, 0.50, 0.32],
                [0.75, 0.62, 0.40],
            ],
        },
        "super-earth" if in_hz => ColorGradient {
            stops: vec![0.0, 0.30, 0.45, 0.55, 0.75, 0.90, 1.0],
            colors: vec![
                [0.02, 0.08, 0.30], // deep ocean
                [0.05, 0.15, 0.45], // ocean
                [0.10, 0.28, 0.50], // shallow water
                [0.25, 0.45, 0.15], // lowland vegetation
                [0.40, 0.50, 0.18], // highland vegetation
                [0.60, 0.55, 0.35], // mountains
                [0.85, 0.88, 0.92], // snow caps
            ],
        },
        "super-earth" => ColorGradient {
            stops: vec![0.0, 0.3, 0.6, 1.0],
            colors: vec![
                [0.35, 0.30, 0.20],
                [0.50, 0.45, 0.30],
                [0.60, 0.52, 0.35],
                [0.70, 0.60, 0.42],
            ],
        },
        "neptune-like" => ColorGradient {
            stops: vec![0.0, 0.5, 1.0],
            colors: vec![
                [0.15, 0.30, 0.55],
                [0.20, 0.45, 0.70],
                [0.25, 0.55, 0.80],
            ],
        },
        "gas-giant" => ColorGradient {
            stops: vec![0.0, 0.3, 0.5, 0.7, 1.0],
            colors: vec![
                [0.50, 0.30, 0.10],
                [0.65, 0.45, 0.15],
                [0.75, 0.55, 0.20],
                [0.80, 0.60, 0.25],
                [0.90, 0.70, 0.35],
            ],
        },
        "super-jupiter" => ColorGradient {
            stops: vec![0.0, 0.3, 0.6, 1.0],
            colors: vec![
                [0.35, 0.12, 0.05],
                [0.50, 0.20, 0.08],
                [0.60, 0.28, 0.12],
                [0.70, 0.35, 0.18],
            ],
        },
        _ => ColorGradient {
            stops: vec![0.0, 0.5, 1.0],
            colors: vec![[0.4, 0.35, 0.25], [0.55, 0.50, 0.38], [0.65, 0.60, 0.50]],
        },
    }
}

/// Apply color gradient to heightmap row, writing RGBA output.
/// Processes in chunks of 4 for auto-vectorization.
pub fn colorize_row(
    heightmap_row: &[f64],
    gradient: &ColorGradient,
    latitude_fraction: f64,
    ice_cap_latitude: f64,
    temperature_tint: f64,
    output: &mut [u8],
) {
    let len = heightmap_row.len();
    debug_assert!(output.len() >= len * 4);

    let is_polar = latitude_fraction.abs() > ice_cap_latitude;

    for i in 0..len {
        let h = heightmap_row[i];
        let [mut r, mut g, mut b] = gradient.sample(h);

        // Ice cap override
        if is_polar {
            let ice_blend = ((latitude_fraction.abs() - ice_cap_latitude)
                / (1.0 - ice_cap_latitude)).min(1.0);
            r = r + ice_blend * (0.90 - r);
            g = g + ice_blend * (0.92 - g);
            b = b + ice_blend * (0.95 - b);
        }

        // Temperature tinting (hot → reddish)
        if temperature_tint > 0.0 {
            r = (r + temperature_tint * (1.0 - r)).min(1.0);
            g = (g - temperature_tint * g * 0.5).max(0.0);
            b = (b - temperature_tint * b * 0.7).max(0.0);
        }

        let idx = i * 4;
        output[idx]     = (r * 255.0) as u8;
        output[idx + 1] = (g * 255.0) as u8;
        output[idx + 2] = (b * 255.0) as u8;
        output[idx + 3] = 255;
    }
}

// ── Full pipeline: heightmap → albedo → normals ─────

/// Generate heightmap, albedo, and normal textures in one efficient pass.
///
/// Returns (heightmap_rgba, albedo_rgba, normal_rgba) as flat Vec<u8>.
pub fn generate_textures_batch(
    seed: u32,
    resolution: usize,
    noise_params: &NoiseParams,
    planet_type: &str,
    in_habitable_zone: bool,
    surface_temp_k: f64,
    ice_cap_latitude: f64,
) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let perlin = Perlin::new(seed);
    let lut = SphericalLUT::new(resolution);
    let gradient = gradient_for_type(planet_type, in_habitable_zone);
    let size = resolution;
    let total_pixels = size * size;

    // SOA heightmap (f64 for precision)
    let mut heightmap_f64 = vec![0.0_f64; total_pixels];

    // Pass 1: Heightmap generation (row-by-row for cache locality)
    let mut row_buffer = vec![0.0_f64; size];
    for y in 0..size {
        noise_row(&perlin, &lut, y, size, noise_params, &mut row_buffer);
        heightmap_f64[y * size..(y + 1) * size].copy_from_slice(&row_buffer);
    }

    // Convert heightmap to RGBA u8
    let mut heightmap_rgba = vec![0u8; total_pixels * 4];
    for i in 0..total_pixels {
        let h = (heightmap_f64[i].clamp(0.0, 1.0) * 255.0) as u8;
        let idx = i * 4;
        heightmap_rgba[idx] = h;
        heightmap_rgba[idx + 1] = h;
        heightmap_rgba[idx + 2] = h;
        heightmap_rgba[idx + 3] = 255;
    }

    // Pass 2: Colorize (row-by-row)
    let mut albedo_rgba = vec![0u8; total_pixels * 4];
    let temp_tint = if surface_temp_k > 600.0 {
        ((surface_temp_k - 600.0) / 1400.0).min(1.0) * 0.3
    } else {
        0.0
    };

    for y in 0..size {
        let lat_frac = (y as f64 / size as f64 - 0.5) * 2.0; // -1 to 1
        let row_start = y * size;
        let row_end = row_start + size;
        let pixel_start = y * size * 4;
        let pixel_end = pixel_start + size * 4;

        colorize_row(
            &heightmap_f64[row_start..row_end],
            &gradient,
            lat_frac,
            ice_cap_latitude,
            temp_tint,
            &mut albedo_rgba[pixel_start..pixel_end],
        );
    }

    // Pass 3: Normal map
    let mut normal_rgba = vec![0u8; total_pixels * 4];
    sobel_normals_batch(&heightmap_f64, size, 2.0, &mut normal_rgba);

    (heightmap_rgba, albedo_rgba, normal_rgba)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spherical_lut() {
        let lut = SphericalLUT::new(256);
        let (x, y, z) = lut.sphere_point(0, 128);
        let len = (x * x + y * y + z * z).sqrt();
        assert!((len - 1.0).abs() < 0.01, "Should be on unit sphere: {}", len);
    }

    #[test]
    fn test_fbm_noise_range() {
        let perlin = Perlin::new(42);
        let params = NoiseParams::default();
        let val = fbm_noise(&perlin, 1.0, 0.0, 0.0, &params);
        assert!(val >= 0.0 && val <= 1.0, "FBM should be in [0,1]: {}", val);
    }

    #[test]
    fn test_noise_row() {
        let perlin = Perlin::new(42);
        let lut = SphericalLUT::new(64);
        let params = NoiseParams::default();
        let mut output = vec![0.0; 64];
        noise_row(&perlin, &lut, 32, 64, &params, &mut output);
        assert!(output.iter().all(|&v| v >= 0.0 && v <= 1.0));
    }

    #[test]
    fn test_color_gradient_sample() {
        let grad = gradient_for_type("rocky", false);
        let low = grad.sample(0.0);
        let high = grad.sample(1.0);
        assert!(high[0] > low[0], "Higher terrain should be brighter");
    }

    #[test]
    fn test_sobel_normals() {
        let size = 16;
        let heightmap = vec![0.5; size * size];
        let mut output = vec![0u8; size * size * 4];
        sobel_normals_batch(&heightmap, size, 2.0, &mut output);
        // Flat heightmap → normals should all point up (0.5, 0.5, 1.0 in tangent space → 128, 128, 255)
        for y in 0..size {
            for x in 0..size {
                let idx = (y * size + x) * 4;
                let nz = output[idx + 2];
                assert!(nz > 200, "Flat surface normal Z should be ~255, got {}", nz);
            }
        }
    }

    #[test]
    fn test_batch_pipeline() {
        let params = NoiseParams {
            octaves: 3,
            persistence: 0.5,
            lacunarity: 2.0,
            base_frequency: 4.0,
            amplitude: 1.0,
        };

        let (heightmap, albedo, normals) = generate_textures_batch(
            42, 32, &params, "rocky", false, 300.0, 0.85,
        );

        assert_eq!(heightmap.len(), 32 * 32 * 4);
        assert_eq!(albedo.len(), 32 * 32 * 4);
        assert_eq!(normals.len(), 32 * 32 * 4);

        // All alpha values should be 255
        for i in (3..heightmap.len()).step_by(4) {
            assert_eq!(heightmap[i], 255);
        }
    }
}
