//! ExoMaps Desktop — Tauri application entry point.
//!
//! Bootstrap the Tauri runtime with:
//!   - WebView frontend (React, reusing web client components)
//!   - Native GPU sidecar (wgpu) for procedural planet generation
//!   - SQLite offline cache for world state
//!   - IPC commands bridging WebView ↔ native Rust

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod gpu;
mod simulation;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::OnceLock;

// ── Global AppHandle for event emission ─────────────
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Emit a typed event to the WebView via the Tauri event bus.
fn emit_event(event: &str, payload: impl Serialize + Clone) {
    if let Some(handle) = APP_HANDLE.get() {
        if let Err(e) = handle.emit(event, payload) {
            log::warn!("Failed to emit event '{}': {}", event, e);
        }
    }
}

// ── Event payloads ──────────────────────────────────

#[derive(Debug, Clone, Serialize)]
struct GenerationStartedEvent {
    system_id: String,
    planet_index: usize,
    resolution: u32,
}

#[derive(Debug, Clone, Serialize)]
struct GenerationCompleteEvent {
    system_id: String,
    planet_index: usize,
    render_time_ms: f64,
    from_cache: bool,
}

#[derive(Debug, Clone, Serialize)]
struct GenerationErrorEvent {
    system_id: String,
    planet_index: usize,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
struct ViewportReadyEvent {
    planet_key: String,
    resolution: u32,
}

// ── IPC data types ──────────────────────────────────

/// Request to generate a procedural planet texture set
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanetGenRequest {
    pub system_id: String,
    pub planet_index: usize,
    pub mass_earth: f64,
    pub radius_earth: f64,
    pub semi_major_axis_au: f64,
    pub eccentricity: f64,
    pub star_teff: f64,
    pub star_luminosity: f64,
    pub planet_type: String,
    pub temperature_k: f64,
    pub in_habitable_zone: bool,
    pub texture_resolution: u32,
}

/// Result from planet generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanetGenResult {
    pub albedo_texture_b64: String,
    pub heightmap_texture_b64: String,
    pub normal_texture_b64: String,
    pub atmosphere_lut_b64: String,
    pub composition: BulkComposition,
    pub atmosphere: AtmosphereSummary,
    pub render_time_ms: f64,
}

/// Bulk composition derived from planet parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkComposition {
    pub iron_fraction: f64,
    pub silicate_fraction: f64,
    pub volatile_fraction: f64,
    pub h_he_fraction: f64,
}

/// Summary of atmospheric properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphereSummary {
    pub surface_pressure_bar: f64,
    pub scale_height_km: f64,
    pub equilibrium_temp_k: f64,
    pub surface_temp_k: f64,
    pub dominant_gas: String,
    pub rayleigh_color: [f32; 3],
}

/// System cache entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedSystem {
    pub main_id: String,
    pub data_json: String,
    pub fetched_at: String,
}

// ── IPC Commands ────────────────────────────────────

/// Generate a procedural planet using the native GPU pipeline.
/// Called from the WebView via `invoke('generate_planet', { request })`.
#[tauri::command]
async fn generate_planet(request: PlanetGenRequest) -> Result<PlanetGenResult, String> {
    log::info!(
        "Generating planet: {} #{} ({}x{})",
        request.system_id,
        request.planet_index,
        request.texture_resolution,
        request.texture_resolution
    );

    // Step 1: Infer bulk composition from mass + orbital params
    let composition = simulation::composition::infer_composition(
        request.mass_earth,
        request.radius_earth,
        request.semi_major_axis_au,
        &request.planet_type,
    );

    // Step 2: Model atmosphere from composition + stellar context
    let atmosphere = simulation::atmosphere::model_atmosphere(
        request.mass_earth,
        request.radius_earth,
        request.semi_major_axis_au,
        request.star_luminosity,
        request.star_teff,
        &composition,
        &request.planet_type,
    );

    // Step 3: Generate textures via GPU compute
    let textures = gpu::renderer::generate_planet_textures(
        &request,
        &composition,
        &atmosphere,
    )
    .await
    .map_err(|e| format!("GPU generation failed: {}", e))?;

    Ok(textures)
}

/// Decode cached base64 PNG textures to RGBA and send to the native viewport.
fn send_textures_to_viewport(
    planet_key: &str,
    result: &gpu::renderer::PlanetGenResultV2,
    resolution: u32,
) {
    use base64::Engine;
    let decode_png = |b64: &str| -> Option<Vec<u8>> {
        let png = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
        let img = image::load_from_memory(&png).ok()?;
        Some(img.to_rgba8().into_raw())
    };

    let albedo = decode_png(&result.albedo_texture_b64);
    let heightmap = decode_png(&result.heightmap_texture_b64);
    let normal = decode_png(&result.normal_texture_b64);
    let pbr = decode_png(&result.pbr_texture_b64);

    if let (Some(a), Some(h), Some(n), Some(p)) = (albedo, heightmap, normal, pbr) {
        gpu::planet_viewport::ensure_running();
        let _ = gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::UploadTextures {
            planet_key: planet_key.to_string(),
            albedo: a,
            heightmap: h,
            normal: n,
            pbr: p,
            resolution,
        });
    } else {
        log::warn!("[Viewport] Failed to decode textures for {}", planet_key);
    }
}

/// Generate a procedural planet using the V2 unified terrain pipeline.
/// Checks cache first — if a generation exists with matching params, returns it instantly.
/// Otherwise generates fresh and caches the result.
#[tauri::command]
async fn generate_planet_v2(
    request: PlanetGenRequest,
) -> Result<gpu::renderer::PlanetGenResultV2, String> {
    // Check cache first — extract needed data before any .await
    let cache_hit: Option<(gpu::renderer::PlanetGenResultV2, u32)> = {
        if let Ok(Some(cached)) = cache::generation_store::get_latest(
            &request.system_id,
            request.planet_index,
        ) {
            let rec = &cached.record;
            if (rec.mass_earth - request.mass_earth).abs() < 0.001
                && (rec.radius_earth - request.radius_earth).abs() < 0.001
                && rec.planet_type == request.planet_type
                && rec.resolution == request.texture_resolution
            {
                log::info!(
                    "Cache HIT for {} #{} (gen #{}, {:.0}ms original)",
                    request.system_id, request.planet_index, rec.id, rec.render_time_ms,
                );
                Some((cached.result, request.texture_resolution))
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((result, resolution)) = cache_hit {
        // Send cached textures to native viewport
        let planet_key = format!("{}_{}", request.system_id, request.planet_index);
        send_textures_to_viewport(&planet_key, &result, resolution);
        emit_event("generation:complete", GenerationCompleteEvent {
            system_id: request.system_id.clone(),
            planet_index: request.planet_index,
            render_time_ms: result.render_time_ms,
            from_cache: true,
        });
        emit_event("viewport:ready", ViewportReadyEvent {
            planet_key,
            resolution,
        });
        return Ok(result);
    }

    log::info!(
        "Generating planet V2: {} #{} ({}x{})",
        request.system_id,
        request.planet_index,
        request.texture_resolution,
        request.texture_resolution
    );

    emit_event("generation:started", GenerationStartedEvent {
        system_id: request.system_id.clone(),
        planet_index: request.planet_index,
        resolution: request.texture_resolution,
    });

    let composition = simulation::composition::infer_composition(
        request.mass_earth,
        request.radius_earth,
        request.semi_major_axis_au,
        &request.planet_type,
    );

    let atmosphere = simulation::atmosphere::model_atmosphere(
        request.mass_earth,
        request.radius_earth,
        request.semi_major_axis_au,
        request.star_luminosity,
        request.star_teff,
        &composition,
        &request.planet_type,
    );

    let geology = simulation::geology::infer_geology(
        request.mass_earth,
        request.radius_earth,
        atmosphere.surface_temp_k,
        atmosphere.surface_pressure_bar,
        &composition,
        &request.planet_type,
        4.6,
    );

    let seed = request.planet_index as u32;

    let result = gpu::renderer::generate_planet_textures_v2(
        &request,
        &composition,
        &atmosphere,
        &geology,
    )
    .await
    .map_err(|e| format!("V2 terrain generation failed: {}", e))?;

    // Cache the result
    if let Err(e) = cache::generation_store::store_generation(&request, seed, &result) {
        log::warn!("Failed to cache generation: {}", e);
    }

    // Send textures to native viewport
    let planet_key = format!("{}_{}", request.system_id, request.planet_index);
    send_textures_to_viewport(&planet_key, &result, request.texture_resolution);

    emit_event("generation:complete", GenerationCompleteEvent {
        system_id: request.system_id.clone(),
        planet_index: request.planet_index,
        render_time_ms: result.render_time_ms,
        from_cache: false,
    });
    emit_event("viewport:ready", ViewportReadyEvent {
        planet_key,
        resolution: request.texture_resolution,
    });

    Ok(result)
}

/// Regenerate a planet with a new seed or modified parameters.
/// Always generates fresh (ignores cache) and stores as a new history entry.
#[tauri::command]
async fn regenerate_planet(
    request: PlanetGenRequest,
    seed_override: Option<u32>,
) -> Result<gpu::renderer::PlanetGenResultV2, String> {
    let seed = seed_override.unwrap_or_else(|| {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u32)
            .unwrap_or(42)
    });

    log::info!(
        "Regenerating planet: {} #{} (seed={}, {}x{})",
        request.system_id, request.planet_index, seed,
        request.texture_resolution, request.texture_resolution,
    );

    emit_event("generation:started", GenerationStartedEvent {
        system_id: request.system_id.clone(),
        planet_index: request.planet_index,
        resolution: request.texture_resolution,
    });

    // Apply overrides if they exist
    let mut req = request.clone();
    if let Ok(Some(overrides)) = cache::generation_store::get_overrides(
        &req.system_id, req.planet_index,
    ) {
        if let Some(m) = overrides.mass_earth { req.mass_earth = m; }
        if let Some(r) = overrides.radius_earth { req.radius_earth = r; }
        if let Some(a) = overrides.semi_major_axis_au { req.semi_major_axis_au = a; }
        if let Some(e) = overrides.eccentricity { req.eccentricity = e; }
        if let Some(t) = overrides.planet_type { req.planet_type = t; }
        if let Some(t) = overrides.temperature_k { req.temperature_k = t; }
        if let Some(h) = overrides.in_habitable_zone { req.in_habitable_zone = h; }
        if let Some(res) = overrides.texture_resolution { req.texture_resolution = res; }
    }

    let composition = simulation::composition::infer_composition(
        req.mass_earth, req.radius_earth, req.semi_major_axis_au, &req.planet_type,
    );
    let atmosphere = simulation::atmosphere::model_atmosphere(
        req.mass_earth, req.radius_earth, req.semi_major_axis_au,
        req.star_luminosity, req.star_teff, &composition, &req.planet_type,
    );
    let geology = simulation::geology::infer_geology(
        req.mass_earth, req.radius_earth,
        atmosphere.surface_temp_k, atmosphere.surface_pressure_bar,
        &composition, &req.planet_type, 4.6,
    );

    // Override the terrain seed
    let mut terrain_req = req.clone();
    // The terrain pipeline uses planet_index * golden_ratio as seed —
    // we override by temporarily changing planet_index to encode our seed
    terrain_req.planet_index = seed as usize;

    let result = gpu::renderer::generate_planet_textures_v2(
        &terrain_req, &composition, &atmosphere, &geology,
    )
    .await
    .map_err(|e| format!("Regeneration failed: {}", e))?;

    // Store with original system_id/planet_index but new seed
    if let Err(e) = cache::generation_store::store_generation(&req, seed, &result) {
        log::warn!("Failed to cache regeneration: {}", e);
    }

    // Send textures to native viewport
    let planet_key = format!("{}_{}", req.system_id, req.planet_index);
    send_textures_to_viewport(&planet_key, &result, req.texture_resolution);

    emit_event("generation:complete", GenerationCompleteEvent {
        system_id: req.system_id.clone(),
        planet_index: req.planet_index,
        render_time_ms: result.render_time_ms,
        from_cache: false,
    });
    emit_event("viewport:ready", ViewportReadyEvent {
        planet_key,
        resolution: req.texture_resolution,
    });

    Ok(result)
}

/// Get the latest cached generation for a planet (instant, no GPU work).
#[tauri::command]
fn get_cached_generation(
    system_id: String,
    planet_index: usize,
) -> Result<Option<cache::generation_store::CachedGeneration>, String> {
    cache::generation_store::get_latest(&system_id, planet_index)
        .map_err(|e| format!("Cache read failed: {}", e))
}

/// Load a specific historical generation by ID.
#[tauri::command]
fn load_generation(
    generation_id: i64,
) -> Result<Option<cache::generation_store::CachedGeneration>, String> {
    cache::generation_store::get_by_id(generation_id)
        .map_err(|e| format!("Failed to load generation: {}", e))
}

/// List all generation history for a planet.
#[tauri::command]
fn list_generation_history(
    system_id: String,
    planet_index: usize,
) -> Result<Vec<cache::generation_store::GenerationRecord>, String> {
    cache::generation_store::list_history(&system_id, planet_index)
        .map_err(|e| format!("Failed to list history: {}", e))
}

/// Toggle favorite status on a generation.
#[tauri::command]
fn toggle_generation_favorite(
    generation_id: i64,
) -> Result<bool, String> {
    cache::generation_store::toggle_favorite(generation_id)
        .map_err(|e| format!("Failed to toggle favorite: {}", e))
}

/// Set a label on a generation.
#[tauri::command]
fn label_generation(
    generation_id: i64,
    label: Option<String>,
) -> Result<(), String> {
    cache::generation_store::set_label(generation_id, label.as_deref())
        .map_err(|e| format!("Failed to set label: {}", e))
}

/// Delete a specific generation from history.
#[tauri::command]
fn delete_generation(
    generation_id: i64,
) -> Result<(), String> {
    cache::generation_store::delete_generation(generation_id)
        .map_err(|e| format!("Failed to delete: {}", e))
}

/// Save user parameter overrides for a planet.
#[tauri::command]
fn save_planet_overrides(
    system_id: String,
    planet_index: usize,
    overrides: cache::generation_store::PlanetOverrides,
) -> Result<(), String> {
    cache::generation_store::save_overrides(&system_id, planet_index, &overrides)
        .map_err(|e| format!("Failed to save overrides: {}", e))
}

/// Get user parameter overrides for a planet.
#[tauri::command]
fn get_planet_overrides(
    system_id: String,
    planet_index: usize,
) -> Result<Option<cache::generation_store::PlanetOverrides>, String> {
    cache::generation_store::get_overrides(&system_id, planet_index)
        .map_err(|e| format!("Failed to get overrides: {}", e))
}

/// Reset planet to catalog defaults (clear overrides).
#[tauri::command]
fn clear_planet_overrides(
    system_id: String,
    planet_index: usize,
) -> Result<(), String> {
    cache::generation_store::clear_overrides(&system_id, planet_index)
        .map_err(|e| format!("Failed to clear overrides: {}", e))
}

/// Get generation cache statistics.
#[tauri::command]
fn get_cache_stats() -> Result<cache::generation_store::CacheStats, String> {
    cache::generation_store::get_stats()
        .map_err(|e| format!("Failed to get stats: {}", e))
}

/// Clear all cached generations for a system.
#[tauri::command]
fn clear_system_cache(
    system_id: String,
) -> Result<usize, String> {
    cache::generation_store::clear_system(&system_id)
        .map_err(|e| format!("Failed to clear: {}", e))
}

/// Compute geological parameters for a planet.
#[tauri::command]
fn compute_geology(
    mass_earth: f64,
    radius_earth: f64,
    surface_temp_k: f64,
    surface_pressure_bar: f64,
    planet_type: String,
    age_gyr: f64,
) -> simulation::geology::GeologyParams {
    let composition = simulation::composition::infer_composition(
        mass_earth, radius_earth, 1.0, &planet_type,
    );
    simulation::geology::infer_geology(
        mass_earth,
        radius_earth,
        surface_temp_k,
        surface_pressure_bar,
        &composition,
        &planet_type,
        age_gyr,
    )
}

/// Get GPU adapter info to display in the desktop client's about panel.
#[tauri::command]
async fn get_gpu_info() -> Result<gpu::GpuInfo, String> {
    gpu::renderer::get_adapter_info()
        .await
        .map_err(|e| format!("Failed to get GPU info: {}", e))
}

/// Open (or focus) the native planet viewport window.
/// The viewport renders at 60fps using wgpu Vulkan — no WebGL, no canvas, no IPC per frame.
/// In overlay mode, the viewport is positioned by sync_viewport_position.
#[tauri::command]
fn open_planet_viewport(
    planet_key: String,
    star_teff: f64,
    star_luminosity: f64,
    ocean_level: f32,
    atmosphere_color: [f32; 3],
    atmosphere_thickness: f32,
) -> Result<(), String> {
    gpu::planet_viewport::ensure_running();
    gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::UpdateParams {
        star_teff,
        star_luminosity,
        ocean_level,
        atmosphere_color,
        atmosphere_thickness,
    })?;
    gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::SetTitle(
        format!("ExoMaps — {}", planet_key),
    ))?;
    // Don't call Focus here — the viewport will be shown when positioned via Reposition.
    // This keeps it hidden until the JS side reports its screen position.
    Ok(())
}

/// Sync the viewport overlay position to match a div's screen rectangle.
/// Called from the WebView with the div's absolute screen position.
#[tauri::command]
fn sync_viewport_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::Reposition {
        x,
        y,
        width,
        height,
    })
}

/// Hide the native planet viewport (keeps thread alive for reuse).
#[tauri::command]
fn close_planet_viewport() -> Result<(), String> {
    gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::Hide)
}

/// Show a previously hidden viewport (e.g. when main window regains focus).
#[tauri::command]
fn show_planet_viewport() -> Result<(), String> {
    gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::Focus)
}

/// Hide viewport temporarily (e.g. when main window loses focus to another app).
#[tauri::command]
fn hide_planet_viewport() -> Result<(), String> {
    gpu::planet_viewport::send(gpu::planet_viewport::ViewportCommand::Hide)
}

/// Fetch a system from the server API and cache it locally.
#[tauri::command]
async fn fetch_and_cache_system(
    main_id: String,
    api_base: String,
) -> Result<String, String> {
    let url = format!("{}/system/{}", api_base, urlencoding::encode(&main_id));
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    cache::world_state::cache_system(&main_id, &body)
        .map_err(|e| format!("Cache write failed: {}", e))?;

    Ok(body)
}

/// Retrieve a cached system (for offline use).
#[tauri::command]
fn get_cached_system(main_id: String) -> Result<Option<CachedSystem>, String> {
    cache::world_state::get_cached(&main_id)
        .map_err(|e| format!("Cache read failed: {}", e))
}

/// List all cached system IDs.
#[tauri::command]
fn list_cached_systems() -> Result<Vec<String>, String> {
    cache::world_state::list_cached()
        .map_err(|e| format!("Cache list failed: {}", e))
}

/// Compute bulk composition for a planet (without full texture gen).
#[tauri::command]
fn compute_composition(
    mass_earth: f64,
    radius_earth: f64,
    semi_major_axis_au: f64,
    planet_type: String,
) -> BulkComposition {
    simulation::composition::infer_composition(
        mass_earth,
        radius_earth,
        semi_major_axis_au,
        &planet_type,
    )
}

/// Compute atmospheric model for a planet.
#[tauri::command]
fn compute_atmosphere(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    star_luminosity: f64,
    star_teff: f64,
    planet_type: String,
) -> AtmosphereSummary {
    let composition = simulation::composition::infer_composition(
        mass_earth, radius_earth, sma_au, &planet_type,
    );
    simulation::atmosphere::model_atmosphere(
        mass_earth,
        radius_earth,
        sma_au,
        star_luminosity,
        star_teff,
        &composition,
        &planet_type,
    )
}

/// Get the full model manifest — lists all registered scientific models
/// with their metadata, citations, applicability domains, and validation targets.
#[tauri::command]
fn get_model_manifest() -> serde_json::Value {
    simulation::model_registry::manifest()
}

/// Compute detailed composition with interior structure info.
#[tauri::command]
fn compute_detailed_composition(
    mass_earth: f64,
    radius_earth: f64,
    semi_major_axis_au: f64,
    planet_type: String,
) -> simulation::composition_v2::DetailedComposition {
    simulation::composition_v2::infer_composition_v2(
        mass_earth,
        radius_earth,
        semi_major_axis_au,
        &planet_type,
    )
}

/// Compute full atmospheric profile with radiative-convective model.
#[tauri::command]
fn compute_atmosphere_v2(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    star_luminosity: f64,
    star_teff: f64,
    planet_type: String,
) -> simulation::atmosphere_v2::AtmosphericProfile {
    let input = simulation::atmosphere_v2::AtmosphereInput {
        mass_earth,
        radius_earth,
        semi_major_axis_au: sma_au,
        star_luminosity_lsun: star_luminosity,
        star_teff_k: star_teff,
        planet_type,
        surface_pressure_bar: None,
        composition: simulation::atmosphere_v2::AtmosphereComposition { species: vec![] },
        bond_albedo: None,
    };
    simulation::atmosphere_v2::solve_atmosphere(&input)
}

/// Compute interior structure profile.
#[tauri::command]
fn compute_interior(
    mass_earth: f64,
    radius_earth: f64,
    planet_type: String,
) -> simulation::interior::InteriorProfile {
    let comp = simulation::composition_v2::infer_composition_v2(
        mass_earth, radius_earth, 1.0, &planet_type,
    );
    let input = simulation::interior::InteriorInput {
        mass_earth,
        radius_earth,
        core_mass_fraction: comp.core_mass_fraction,
        mantle_mass_fraction: comp.mantle_mass_fraction,
        water_mass_fraction: comp.water_mass_fraction,
        envelope_mass_fraction: comp.envelope_mass_fraction,
    };
    simulation::interior::solve_interior(&input)
}

/// Compute global climate equilibrium state.
#[tauri::command]
fn compute_climate(
    mass_earth: f64,
    radius_earth: f64,
    sma_au: f64,
    eccentricity: f64,
    star_luminosity: f64,
    star_teff: f64,
    planet_type: String,
) -> simulation::climate::ClimateState {
    // Get atmosphere for greenhouse opacity
    let atm = simulation::atmosphere_v2::solve_atmosphere(
        &simulation::atmosphere_v2::AtmosphereInput {
            mass_earth,
            radius_earth,
            semi_major_axis_au: sma_au,
            star_luminosity_lsun: star_luminosity,
            star_teff_k: star_teff,
            planet_type: planet_type.clone(),
            surface_pressure_bar: None,
            composition: simulation::atmosphere_v2::AtmosphereComposition { species: vec![] },
            bond_albedo: None,
        },
    );

    let input = simulation::climate::ClimateInput {
        mass_earth,
        radius_earth,
        semi_major_axis_au: sma_au,
        eccentricity,
        obliquity_deg: 23.44,        // default Earth-like
        rotation_period_hours: 24.0,  // default Earth-like
        star_luminosity_lsun: star_luminosity,
        star_teff_k: star_teff,
        surface_pressure_bar: atm.summary.surface_pressure_bar,
        bond_albedo_base: atm.summary.bond_albedo,
        greenhouse_opacity: atm.total_ir_optical_depth,
        planet_type,
    };
    simulation::climate::solve_climate(&input)
}

// ── Savegame IPC commands (single-player mode) ──────

#[tauri::command]
fn sg_create_campaign(
    name: String,
    seed: i64,
    settings: serde_json::Value,
) -> Result<String, String> {
    cache::savegame::create_campaign(&name, seed, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_list_campaigns(status: Option<String>) -> Result<Vec<cache::savegame::SavedCampaign>, String> {
    cache::savegame::list_campaigns(status.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_get_campaign_state(
    campaign_id: String,
) -> Result<Option<cache::savegame::CampaignState>, String> {
    cache::savegame::get_campaign_state(&campaign_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_save_campaign_state(
    campaign_id: String,
    tick: i64,
    state: serde_json::Value,
) -> Result<(), String> {
    cache::savegame::save_campaign_state(&campaign_id, tick, &state).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_delete_campaign(campaign_id: String) -> Result<(), String> {
    cache::savegame::delete_campaign(&campaign_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_explore_system(
    campaign_id: String,
    system_main_id: String,
    scan_level: Option<i32>,
    explored_by: Option<String>,
    notes: Option<String>,
) -> Result<cache::savegame::ExploreResult, String> {
    cache::savegame::explore_system(
        &campaign_id,
        &system_main_id,
        scan_level.unwrap_or(1),
        explored_by.as_deref(),
        notes.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_get_explored_systems(
    campaign_id: String,
) -> Result<Vec<cache::savegame::ExploredSystem>, String> {
    cache::savegame::get_explored_systems(&campaign_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_create_faction(
    campaign_id: String,
    name: String,
    color: Option<String>,
    home_system: Option<String>,
    initial_state: serde_json::Value,
) -> Result<String, String> {
    cache::savegame::create_faction(
        &campaign_id,
        &name,
        color.as_deref(),
        home_system.as_deref(),
        &initial_state,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_list_factions(
    campaign_id: String,
) -> Result<Vec<cache::savegame::SavedFaction>, String> {
    cache::savegame::list_factions(&campaign_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_save_simulation(
    campaign_id: String,
    tick: i64,
    state: serde_json::Value,
) -> Result<(), String> {
    cache::savegame::save_simulation_state(&campaign_id, tick, &state).map_err(|e| e.to_string())
}

#[tauri::command]
fn sg_load_simulation(
    campaign_id: String,
) -> Result<Option<cache::savegame::SimulationSnapshot>, String> {
    cache::savegame::load_simulation_state(&campaign_id).map_err(|e| e.to_string())
}

/// Returns the available game mode capabilities.
#[tauri::command]
fn sg_get_game_mode() -> serde_json::Value {
    serde_json::json!({
        "singleplayer_available": true,
        "multiplayer_available": true,
        "savegame_encryption": "AES-256-GCM",
        "version": env!("CARGO_PKG_VERSION"),
    })
}

// ── Application entry ───────────────────────────────

fn main() {
    // ── WebKit2GTK workaround ──────────────────────────
    // On NVIDIA + Linux, the DMA-BUF renderer in WebKit2GTK fails to allocate
    // GBM buffers (DRM_IOCTL_MODE_CREATE_DUMB → Permission denied), resulting
    // in a blank white/black WebView. Disabling the DMA-BUF renderer forces
    // WebKit to use the shared-memory fallback compositor.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    env_logger::init();
    log::info!("ExoMaps Desktop starting...");

    // Initialize model registry
    simulation::model_registry::registry();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            generate_planet,
            generate_planet_v2,
            regenerate_planet,
            get_cached_generation,
            load_generation,
            list_generation_history,
            toggle_generation_favorite,
            label_generation,
            delete_generation,
            save_planet_overrides,
            get_planet_overrides,
            clear_planet_overrides,
            get_cache_stats,
            clear_system_cache,
            get_gpu_info,
            open_planet_viewport,
            close_planet_viewport,
            show_planet_viewport,
            hide_planet_viewport,
            sync_viewport_position,
            fetch_and_cache_system,
            get_cached_system,
            list_cached_systems,
            compute_composition,
            compute_atmosphere,
            compute_geology,
            get_model_manifest,
            compute_detailed_composition,
            compute_atmosphere_v2,
            compute_interior,
            compute_climate,
            // ── Savegame (single-player) ──
            sg_create_campaign,
            sg_list_campaigns,
            sg_get_campaign_state,
            sg_save_campaign_state,
            sg_delete_campaign,
            sg_explore_system,
            sg_get_explored_systems,
            sg_create_faction,
            sg_list_factions,
            sg_save_simulation,
            sg_load_simulation,
            sg_get_game_mode,
        ])
        .setup(|app| {
            log::info!("Tauri setup complete");

            // Store AppHandle globally for event emission from any thread
            let _ = APP_HANDLE.set(app.handle().clone());

            // Initialize GPU adapter on startup
            let _handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match gpu::renderer::initialize_gpu().await {
                    Ok(info) => log::info!("GPU initialized: {} ({})", info.name, info.backend),
                    Err(e) => log::warn!("GPU initialization failed: {} — will use CPU fallback", e),
                }
            });

            // Initialize SQLite cache
            if let Err(e) = cache::world_state::initialize_cache() {
                log::warn!("Cache initialization failed: {} — offline mode unavailable", e);
            }

            // Initialize generation store
            if let Err(e) = cache::generation_store::initialize() {
                log::warn!("Generation store init failed: {} — caching unavailable", e);
            }

            // Initialize savegame store (single-player mode)
            if let Err(e) = cache::savegame::initialize() {
                log::warn!("Savegame store init failed: {} — single-player unavailable", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ExoMaps Desktop");
}
