//! wgpu renderer for procedural planet texture generation.
//!
//! Pipeline:
//!   1. Initialize wgpu adapter + device (once at startup)
//!   2. For each planet generation request:
//!      a. Run noise + heightmap compute shader
//!      b. Run albedo compute shader (composition → color)
//!      c. Run atmosphere LUT compute shader
//!      d. Read back textures as PNG-encoded Base64 strings
//!
//! Falls back to CPU generation if GPU is unavailable.

use std::sync::OnceLock;
use tokio::sync::Mutex;

use super::compute;
use super::terrain;
use super::GpuInfo;
use crate::{AtmosphereSummary, BulkComposition, PlanetGenRequest, PlanetGenResult};

/// Global GPU state — initialized once at startup
static GPU_STATE: OnceLock<Mutex<Option<GpuState>>> = OnceLock::new();

struct GpuState {
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    info: GpuInfo,
}

/// Initialize the GPU adapter and device. Called once during Tauri setup.
/// Also initializes the native planet render pipeline.
pub async fn initialize_gpu() -> Result<GpuInfo, Box<dyn std::error::Error + Send + Sync>> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or("No suitable GPU adapter found")?;

    let adapter_info = adapter.get_info();
    let limits = adapter.limits();

    // Device for compute/texture generation
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("ExoMaps Planet Generator"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            ..Default::default()
        }, None)
        .await?;

    // Second device for the native render pipeline
    let (render_device, render_queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("ExoMaps Planet Renderer"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            ..Default::default()
        }, None)
        .await?;

    let info = GpuInfo {
        name: adapter_info.name.clone(),
        backend: format!("{:?}", adapter_info.backend),
        device_type: format!("{:?}", adapter_info.device_type),
        driver: adapter_info.driver.clone(),
        features: vec![], // Could enumerate features here
        max_texture_size: limits.max_texture_dimension_2d,
        max_compute_workgroup_size: [
            limits.max_compute_workgroup_size_x,
            limits.max_compute_workgroup_size_y,
            limits.max_compute_workgroup_size_z,
        ],
    };

    let state = GpuState {
        adapter,
        device,
        queue,
        info: info.clone(),
    };

    let _ = GPU_STATE.set(Mutex::new(Some(state)));

    // Initialize native render pipeline on the second device
    if let Err(e) = super::planet_render::initialize(render_device, render_queue).await {
        log::warn!("Native planet renderer init failed: {} — will use fallback", e);
    }

    Ok(info)
}

/// Get GPU adapter info (after initialization).
pub async fn get_adapter_info() -> Result<GpuInfo, Box<dyn std::error::Error + Send + Sync>> {
    let mutex = GPU_STATE.get().ok_or("GPU not initialized")?;
    let guard = mutex.lock().await;
    let state = guard.as_ref().ok_or("GPU state is None")?;
    Ok(state.info.clone())
}

/// Generate procedural planet textures using GPU compute shaders.
///
/// This is the main entry point called from the IPC command.
/// Returns Base64-encoded PNG textures for albedo, heightmap,
/// normal map, and atmosphere LUT.
pub async fn generate_planet_textures(
    request: &PlanetGenRequest,
    composition: &BulkComposition,
    atmosphere: &AtmosphereSummary,
) -> Result<PlanetGenResult, Box<dyn std::error::Error + Send + Sync>> {
    let start = std::time::Instant::now();
    let resolution = request.texture_resolution.min(4096).max(256);

    let mutex = GPU_STATE.get().ok_or("GPU not initialized")?;
    let guard = mutex.lock().await;
    let state = guard.as_ref().ok_or("GPU state is None")?;

    // ── Step 1: Generate heightmap via compute shader ──
    let heightmap_data = compute::generate_heightmap(
        &state.device,
        &state.queue,
        resolution,
        request.planet_index as u32,
        composition,
        &request.planet_type,
    )
    .await?;

    // ── Step 2: Generate albedo from heightmap + composition ──
    let albedo_data = compute::generate_albedo(
        &state.device,
        &state.queue,
        resolution,
        &heightmap_data,
        composition,
        atmosphere,
        &request.planet_type,
        request.in_habitable_zone,
    )
    .await?;

    // ── Step 3: Generate normal map from heightmap ──
    let normal_data = compute::generate_normals(
        &state.device,
        &state.queue,
        resolution,
        &heightmap_data,
    )
    .await?;

    // ── Step 4: Generate atmosphere LUT ──
    let atmosphere_data = compute::generate_atmosphere_lut(
        &state.device,
        &state.queue,
        256, // LUT is always 256x256
        atmosphere,
    )
    .await?;

    // ── Encode to PNG + Base64 ──
    let albedo_b64 = encode_rgba_to_b64_png(&albedo_data, resolution, resolution);
    let heightmap_b64 = encode_rgba_to_b64_png(&heightmap_data, resolution, resolution);
    let normal_b64 = encode_rgba_to_b64_png(&normal_data, resolution, resolution);
    let atmosphere_b64 = encode_rgba_to_b64_png(&atmosphere_data, 256, 256);

    let elapsed = start.elapsed();

    Ok(PlanetGenResult {
        albedo_texture_b64: albedo_b64,
        heightmap_texture_b64: heightmap_b64,
        normal_texture_b64: normal_b64,
        atmosphere_lut_b64: atmosphere_b64,
        composition: composition.clone(),
        atmosphere: atmosphere.clone(),
        render_time_ms: elapsed.as_secs_f64() * 1000.0,
    })
}

/// Encode RGBA u8 buffer to PNG then Base64.
fn encode_rgba_to_b64_png(data: &[u8], width: u32, height: u32) -> String {
    use image::{ImageBuffer, Rgba};
    use std::io::Cursor;

    let img: ImageBuffer<Rgba<u8>, _> = ImageBuffer::from_raw(width, height, data.to_vec())
        .unwrap_or_else(|| ImageBuffer::new(width, height));

    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .unwrap_or_default();

    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(buf.into_inner())
}

/// V2 terrain pipeline result — includes PBR map + biome data.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlanetGenResultV2 {
    pub albedo_texture_b64: String,
    pub heightmap_texture_b64: String,
    pub normal_texture_b64: String,
    pub pbr_texture_b64: String,
    pub atmosphere_lut_b64: String,
    pub ocean_level: f64,
    pub composition: BulkComposition,
    pub atmosphere: AtmosphereSummary,
    pub render_time_ms: f64,
}

/// Generate procedural planet textures using the V2 terrain pipeline.
///
/// This uses the unified terrain system with:
///   - Tectonic plate generation (Voronoi + JFA)
///   - Multi-domain noise (fBm + ridged multifractal + domain warping)
///   - Impact crater overlay
///   - Volcanic features
///   - Thermal erosion
///   - Biome-driven coloring + PBR materials
///   - Gas giant band structure
pub async fn generate_planet_textures_v2(
    request: &PlanetGenRequest,
    composition: &BulkComposition,
    atmosphere: &AtmosphereSummary,
    geology: &crate::simulation::geology::GeologyParams,
) -> Result<PlanetGenResultV2, Box<dyn std::error::Error + Send + Sync>> {
    let resolution = request.texture_resolution.min(4096).max(256) as usize;

    // Build terrain config from all simulation inputs
    // Build a robust seed from both system name and planet index
    // This ensures different planets in the same system AND same-index
    // planets in different systems all look distinct.
    let system_hash = {
        let mut h: u32 = 5381;
        for b in request.system_id.bytes() {
            h = h.wrapping_mul(33).wrapping_add(b as u32);
        }
        h
    };
    let seed = system_hash
        .wrapping_add((request.planet_index as u32).wrapping_mul(2654435761));

    // Seed-dependent parameter perturbation — ensures planets with identical
    // physical parameters (e.g. all defaulting to 1.0 Me) still look distinct.
    // Uses a simple hash-based pseudo-random: fract(seed * golden_ratio).
    let seed_frac = |offset: u32| -> f64 {
        let v = seed.wrapping_add(offset).wrapping_mul(2654435761);
        (v as f64 / u32::MAX as f64)
    };

    // Vary obliquity ±35° around 23° — changes ice cap size and climate bands
    let obliquity = 5.0 + seed_frac(100) * 40.0;
    // Vary age 1-8 Gyr — affects tectonic regime, crater density
    let age = 1.0 + seed_frac(200) * 7.0;
    // Vary precipitation ±40% — changes biome distribution
    let precip_mult = 0.6 + seed_frac(300) * 0.8;

    let terrain_config = terrain::TerrainConfig {
        seed,
        resolution,
        planet_type: request.planet_type.clone(),
        geology: geology.clone(),
        mass_earth: request.mass_earth,
        radius_earth: request.radius_earth,
        surface_temp_k: atmosphere.surface_temp_k,
        surface_pressure_bar: atmosphere.surface_pressure_bar,
        star_teff_k: request.star_teff,
        obliquity_deg: obliquity,
        age_gyr: age,
        in_habitable_zone: request.in_habitable_zone,
        global_precipitation: (estimate_precipitation(atmosphere, &request.planet_type) * precip_mult).clamp(0.0, 1.0),
    };

    // Run the appropriate pipeline
    let terrain_output = if matches!(
        request.planet_type.as_str(),
        "gas-giant" | "super-jupiter" | "neptune-like"
    ) {
        terrain::generate_gas_giant_bands(&terrain_config)
    } else {
        terrain::generate_terrain(&terrain_config)
    };

    // Generate atmosphere LUT (kept from V1 — runs separately)
    let mutex = GPU_STATE.get().ok_or("GPU not initialized")?;
    let guard = mutex.lock().await;
    let state = guard.as_ref().ok_or("GPU state is None")?;

    let atmosphere_data = compute::generate_atmosphere_lut(
        &state.device,
        &state.queue,
        256,
        atmosphere,
    )
    .await?;

    // Encode all textures to PNG → Base64
    let res = resolution as u32;
    let heightmap_rgba = terrain::heightmap_to_rgba(&terrain_output.heightmap, resolution);

    // Upload raw RGBA textures to the native renderer (keep them on GPU)
    let planet_key = format!("{}_{}", request.system_id, request.planet_index);
    if let Err(e) = super::planet_render::upload_textures(
        &planet_key,
        &terrain_output.albedo,
        &heightmap_rgba,
        &terrain_output.normals,
        &terrain_output.pbr_map,
        res,
    ).await {
        log::warn!("Failed to upload textures to native renderer: {}", e);
    } else {
        log::info!("[NativeRenderer] Textures uploaded for {} ({}x{})", planet_key, res, res);
    }

    let albedo_b64 = encode_rgba_to_b64_png(&terrain_output.albedo, res, res);
    let heightmap_b64 = encode_rgba_to_b64_png(&heightmap_rgba, res, res);
    let normal_b64 = encode_rgba_to_b64_png(&terrain_output.normals, res, res);
    let pbr_b64 = encode_rgba_to_b64_png(&terrain_output.pbr_map, res, res);
    let atmosphere_b64 = encode_rgba_to_b64_png(&atmosphere_data, 256, 256);

    Ok(PlanetGenResultV2 {
        albedo_texture_b64: albedo_b64,
        heightmap_texture_b64: heightmap_b64,
        normal_texture_b64: normal_b64,
        pbr_texture_b64: pbr_b64,
        atmosphere_lut_b64: atmosphere_b64,
        ocean_level: terrain_output.ocean_level,
        composition: composition.clone(),
        atmosphere: atmosphere.clone(),
        render_time_ms: terrain_output.generation_time_ms,
    })
}

/// Estimate precipitation from atmosphere properties (simple parameterization).
fn estimate_precipitation(atmosphere: &AtmosphereSummary, planet_type: &str) -> f64 {
    if matches!(planet_type, "gas-giant" | "super-jupiter" | "neptune-like") {
        return 0.0;
    }

    // Water worlds with thick atmospheres + moderate temperatures → more rain
    let temp_factor = if atmosphere.surface_temp_k > 273.0 && atmosphere.surface_temp_k < 373.0 {
        0.7
    } else if atmosphere.surface_temp_k > 200.0 && atmosphere.surface_temp_k < 500.0 {
        0.3
    } else {
        0.05
    };

    let pressure_factor = (atmosphere.surface_pressure_bar / 1.0).sqrt().clamp(0.1, 1.5);

    (temp_factor * pressure_factor).clamp(0.0, 1.0)
}
