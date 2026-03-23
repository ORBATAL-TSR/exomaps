//! Generation store — persistent cache for V2 planet texture generations.
//!
//! Each generation is keyed by (system_id, planet_index) and stores:
//!   - All texture blobs (albedo, heightmap, normal, PBR, atmosphere LUT)
//!   - The input parameters that produced them (for reproducibility)
//!   - A generation seed (so you can re-roll or pin interesting results)
//!   - Timestamp + render time metrics
//!   - User overrides (custom params that differ from catalog defaults)
//!
//! The store also maintains a history ring — up to N generations per planet
//! so you can compare different seeds or parameter variants.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::gpu::renderer::PlanetGenResultV2;
use crate::{AtmosphereSummary, BulkComposition, PlanetGenRequest};

static STORE: once_cell::sync::Lazy<Mutex<Option<Connection>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

/// Maximum number of generation history entries per planet.
const MAX_HISTORY_PER_PLANET: usize = 10;

// ── Data types ─────────────────────────────────────

/// A stored generation record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationRecord {
    pub id: i64,
    pub system_id: String,
    pub planet_index: usize,
    pub seed: u32,
    pub resolution: u32,
    pub planet_type: String,
    pub mass_earth: f64,
    pub radius_earth: f64,
    pub semi_major_axis_au: f64,
    pub eccentricity: f64,
    pub star_teff: f64,
    pub star_luminosity: f64,
    pub temperature_k: f64,
    pub in_habitable_zone: bool,
    pub ocean_level: f64,
    pub render_time_ms: f64,
    pub created_at: String,
    pub is_favorite: bool,
    pub label: Option<String>,
}

/// User parameter overrides for a planet (stored separately from catalog data).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlanetOverrides {
    pub mass_earth: Option<f64>,
    pub radius_earth: Option<f64>,
    pub semi_major_axis_au: Option<f64>,
    pub eccentricity: Option<f64>,
    pub planet_type: Option<String>,
    pub temperature_k: Option<f64>,
    pub in_habitable_zone: Option<bool>,
    pub seed: Option<u32>,
    pub texture_resolution: Option<u32>,
    pub label: Option<String>,
}

/// Full cached generation with texture data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedGeneration {
    pub record: GenerationRecord,
    pub result: PlanetGenResultV2,
}

/// Summary of cache stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_generations: usize,
    pub total_planets: usize,
    pub total_systems: usize,
    pub cache_size_bytes: u64,
}

// ── Initialize ─────────────────────────────────────

/// Initialize the generation store. Creates tables if needed.
pub fn initialize() -> Result<(), Box<dyn std::error::Error>> {
    let path = store_db_path();
    log::info!("Initializing generation store at: {}", path.display());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&path)?;

    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS generations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            system_id       TEXT NOT NULL,
            planet_index    INTEGER NOT NULL,
            seed            INTEGER NOT NULL,
            resolution      INTEGER NOT NULL,
            planet_type     TEXT NOT NULL,
            mass_earth      REAL NOT NULL,
            radius_earth    REAL NOT NULL,
            sma_au          REAL NOT NULL,
            eccentricity    REAL NOT NULL,
            star_teff       REAL NOT NULL,
            star_luminosity REAL NOT NULL,
            temperature_k   REAL NOT NULL,
            in_hz           INTEGER NOT NULL,
            ocean_level     REAL NOT NULL,
            render_time_ms  REAL NOT NULL,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            is_favorite     INTEGER NOT NULL DEFAULT 0,
            label           TEXT,

            -- Texture blobs (Base64 PNG)
            albedo_b64      TEXT NOT NULL,
            heightmap_b64   TEXT NOT NULL,
            normal_b64      TEXT NOT NULL,
            pbr_b64         TEXT NOT NULL,
            atmos_lut_b64   TEXT NOT NULL,

            -- Composition + atmosphere JSON
            composition_json TEXT NOT NULL,
            atmosphere_json  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_gen_planet
            ON generations(system_id, planet_index);
        CREATE INDEX IF NOT EXISTS idx_gen_favorite
            ON generations(is_favorite) WHERE is_favorite = 1;

        -- User parameter overrides per planet
        CREATE TABLE IF NOT EXISTS planet_overrides (
            system_id    TEXT NOT NULL,
            planet_index INTEGER NOT NULL,
            overrides_json TEXT NOT NULL,
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (system_id, planet_index)
        );
        ",
    )?;

    if let Ok(mut db) = STORE.lock() {
        *db = Some(conn);
    }

    Ok(())
}

// ── Store / Retrieve ───────────────────────────────

/// Store a generation result in the cache.
/// Returns the new generation ID.
pub fn store_generation(
    request: &PlanetGenRequest,
    seed: u32,
    result: &PlanetGenResultV2,
) -> Result<i64, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let comp_json = serde_json::to_string(&result.composition)?;
    let atmos_json = serde_json::to_string(&result.atmosphere)?;

    conn.execute(
        "INSERT INTO generations (
            system_id, planet_index, seed, resolution, planet_type,
            mass_earth, radius_earth, sma_au, eccentricity,
            star_teff, star_luminosity, temperature_k, in_hz,
            ocean_level, render_time_ms,
            albedo_b64, heightmap_b64, normal_b64, pbr_b64, atmos_lut_b64,
            composition_json, atmosphere_json
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13,
            ?14, ?15,
            ?16, ?17, ?18, ?19, ?20,
            ?21, ?22
        )",
        params![
            request.system_id,
            request.planet_index as i64,
            seed as i64,
            request.texture_resolution as i64,
            request.planet_type,
            request.mass_earth,
            request.radius_earth,
            request.semi_major_axis_au,
            request.eccentricity,
            request.star_teff,
            request.star_luminosity,
            request.temperature_k,
            request.in_habitable_zone as i64,
            result.ocean_level,
            result.render_time_ms,
            result.albedo_texture_b64,
            result.heightmap_texture_b64,
            result.normal_texture_b64,
            result.pbr_texture_b64,
            result.atmosphere_lut_b64,
            comp_json,
            atmos_json,
        ],
    )?;

    let id = conn.last_insert_rowid();

    // Prune old entries (keep only MAX_HISTORY_PER_PLANET non-favorite entries)
    prune_history(conn, &request.system_id, request.planet_index)?;

    log::info!(
        "Stored generation #{} for {} planet {} (seed={}, {:.0}ms)",
        id, request.system_id, request.planet_index, seed, result.render_time_ms
    );

    Ok(id)
}

/// Get the latest cached generation for a planet (if any).
pub fn get_latest(
    system_id: &str,
    planet_index: usize,
) -> Result<Option<CachedGeneration>, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT * FROM generations
         WHERE system_id = ?1 AND planet_index = ?2
         ORDER BY id DESC LIMIT 1",
    )?;

    match stmt.query_row(params![system_id, planet_index as i64], |row| {
        row_to_cached_generation(row)
    }) {
        Ok(gen) => Ok(Some(gen)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

/// Get a specific generation by ID.
pub fn get_by_id(
    gen_id: i64,
) -> Result<Option<CachedGeneration>, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let mut stmt = conn.prepare("SELECT * FROM generations WHERE id = ?1")?;

    match stmt.query_row(params![gen_id], |row| row_to_cached_generation(row)) {
        Ok(gen) => Ok(Some(gen)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

/// List generation history for a planet (newest first).
pub fn list_history(
    system_id: &str,
    planet_index: usize,
) -> Result<Vec<GenerationRecord>, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT id, system_id, planet_index, seed, resolution, planet_type,
                mass_earth, radius_earth, sma_au, eccentricity,
                star_teff, star_luminosity, temperature_k, in_hz,
                ocean_level, render_time_ms, created_at, is_favorite, label
         FROM generations
         WHERE system_id = ?1 AND planet_index = ?2
         ORDER BY id DESC",
    )?;

    let records = stmt.query_map(params![system_id, planet_index as i64], |row| {
        Ok(GenerationRecord {
            id: row.get(0)?,
            system_id: row.get(1)?,
            planet_index: row.get::<_, i64>(2)? as usize,
            seed: row.get::<_, i64>(3)? as u32,
            resolution: row.get::<_, i64>(4)? as u32,
            planet_type: row.get(5)?,
            mass_earth: row.get(6)?,
            radius_earth: row.get(7)?,
            semi_major_axis_au: row.get(8)?,
            eccentricity: row.get(9)?,
            star_teff: row.get(10)?,
            star_luminosity: row.get(11)?,
            temperature_k: row.get(12)?,
            in_habitable_zone: row.get::<_, i64>(13)? != 0,
            ocean_level: row.get(14)?,
            render_time_ms: row.get(15)?,
            created_at: row.get(16)?,
            is_favorite: row.get::<_, i64>(17)? != 0,
            label: row.get(18)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();

    Ok(records)
}

/// Toggle favorite status on a generation.
pub fn toggle_favorite(gen_id: i64) -> Result<bool, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let current: i64 = conn.query_row(
        "SELECT is_favorite FROM generations WHERE id = ?1",
        params![gen_id],
        |row| row.get(0),
    )?;

    let new_val = if current == 0 { 1i64 } else { 0i64 };
    conn.execute(
        "UPDATE generations SET is_favorite = ?1 WHERE id = ?2",
        params![new_val, gen_id],
    )?;

    Ok(new_val != 0)
}

/// Set a label on a generation.
pub fn set_label(gen_id: i64, label: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    conn.execute(
        "UPDATE generations SET label = ?1 WHERE id = ?2",
        params![label, gen_id],
    )?;

    Ok(())
}

/// Delete a specific generation.
pub fn delete_generation(gen_id: i64) -> Result<(), Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    conn.execute("DELETE FROM generations WHERE id = ?1", params![gen_id])?;
    Ok(())
}

/// Clear all generations for a system.
pub fn clear_system(system_id: &str) -> Result<usize, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let count = conn.execute(
        "DELETE FROM generations WHERE system_id = ?1",
        params![system_id],
    )?;

    Ok(count)
}

// ── Overrides ──────────────────────────────────────

/// Store user parameter overrides for a planet.
pub fn save_overrides(
    system_id: &str,
    planet_index: usize,
    overrides: &PlanetOverrides,
) -> Result<(), Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let json = serde_json::to_string(overrides)?;
    conn.execute(
        "INSERT OR REPLACE INTO planet_overrides (system_id, planet_index, overrides_json, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))",
        params![system_id, planet_index as i64, json],
    )?;

    Ok(())
}

/// Get user parameter overrides for a planet.
pub fn get_overrides(
    system_id: &str,
    planet_index: usize,
) -> Result<Option<PlanetOverrides>, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT overrides_json FROM planet_overrides WHERE system_id = ?1 AND planet_index = ?2",
    )?;

    match stmt.query_row(params![system_id, planet_index as i64], |row| {
        row.get::<_, String>(0)
    }) {
        Ok(json) => Ok(Some(serde_json::from_str(&json)?)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

/// Clear overrides for a planet (revert to catalog defaults).
pub fn clear_overrides(
    system_id: &str,
    planet_index: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    conn.execute(
        "DELETE FROM planet_overrides WHERE system_id = ?1 AND planet_index = ?2",
        params![system_id, planet_index as i64],
    )?;

    Ok(())
}

/// Get cache statistics.
pub fn get_stats() -> Result<CacheStats, Box<dyn std::error::Error>> {
    let guard = STORE.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Store not initialized")?;

    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM generations", [], |r| r.get(0),
    )?;

    let planets: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT system_id || '_' || planet_index) FROM generations",
        [], |r| r.get(0),
    )?;

    let systems: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT system_id) FROM generations", [], |r| r.get(0),
    )?;

    // Estimate size from DB file
    let path = store_db_path();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    Ok(CacheStats {
        total_generations: total as usize,
        total_planets: planets as usize,
        total_systems: systems as usize,
        cache_size_bytes: size,
    })
}

// ── Internal helpers ───────────────────────────────

fn prune_history(
    conn: &Connection,
    system_id: &str,
    planet_index: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    // Count non-favorite entries
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM generations
         WHERE system_id = ?1 AND planet_index = ?2 AND is_favorite = 0",
        params![system_id, planet_index as i64],
        |r| r.get(0),
    )?;

    if count as usize > MAX_HISTORY_PER_PLANET {
        let to_delete = count as usize - MAX_HISTORY_PER_PLANET;
        conn.execute(
            "DELETE FROM generations WHERE id IN (
                SELECT id FROM generations
                WHERE system_id = ?1 AND planet_index = ?2 AND is_favorite = 0
                ORDER BY id ASC LIMIT ?3
            )",
            params![system_id, planet_index as i64, to_delete as i64],
        )?;
    }

    Ok(())
}

fn row_to_cached_generation(
    row: &rusqlite::Row,
) -> Result<CachedGeneration, rusqlite::Error> {
    // Column indices match CREATE TABLE order:
    // 0:id, 1:system_id, 2:planet_index, 3:seed, 4:resolution, 5:planet_type,
    // 6:mass_earth, 7:radius_earth, 8:sma_au, 9:eccentricity,
    // 10:star_teff, 11:star_luminosity, 12:temperature_k, 13:in_hz,
    // 14:ocean_level, 15:render_time_ms, 16:created_at, 17:is_favorite, 18:label,
    // 19:albedo_b64, 20:heightmap_b64, 21:normal_b64, 22:pbr_b64,
    // 23:atmos_lut_b64, 24:composition_json, 25:atmosphere_json

    let comp_json: String = row.get(24)?;
    let atmos_json: String = row.get(25)?;

    let composition: BulkComposition = serde_json::from_str(&comp_json)
        .unwrap_or(BulkComposition {
            iron_fraction: 0.3,
            silicate_fraction: 0.5,
            volatile_fraction: 0.15,
            h_he_fraction: 0.05,
        });

    let atmosphere: AtmosphereSummary = serde_json::from_str(&atmos_json)
        .unwrap_or(AtmosphereSummary {
            surface_pressure_bar: 1.0,
            scale_height_km: 8.5,
            equilibrium_temp_k: 255.0,
            surface_temp_k: 288.0,
            dominant_gas: "N2".to_string(),
            rayleigh_color: [0.3, 0.5, 0.9],
        });

    Ok(CachedGeneration {
        record: GenerationRecord {
            id: row.get(0)?,
            system_id: row.get(1)?,
            planet_index: row.get::<_, i64>(2)? as usize,
            seed: row.get::<_, i64>(3)? as u32,
            resolution: row.get::<_, i64>(4)? as u32,
            planet_type: row.get(5)?,
            mass_earth: row.get(6)?,
            radius_earth: row.get(7)?,
            semi_major_axis_au: row.get(8)?,
            eccentricity: row.get(9)?,
            star_teff: row.get(10)?,
            star_luminosity: row.get(11)?,
            temperature_k: row.get(12)?,
            in_habitable_zone: row.get::<_, i64>(13)? != 0,
            ocean_level: row.get(14)?,
            render_time_ms: row.get(15)?,
            created_at: row.get(16)?,
            is_favorite: row.get::<_, i64>(17)? != 0,
            label: row.get(18)?,
        },
        result: PlanetGenResultV2 {
            albedo_texture_b64: row.get(19)?,
            heightmap_texture_b64: row.get(20)?,
            normal_texture_b64: row.get(21)?,
            pbr_texture_b64: row.get(22)?,
            atmosphere_lut_b64: row.get(23)?,
            ocean_level: row.get(14)?,
            composition,
            atmosphere,
            render_time_ms: row.get(15)?,
        },
    })
}

fn store_db_path() -> std::path::PathBuf {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| std::path::PathBuf::from(h).join(".local").join("share"))
            })
            .unwrap_or_default()
            .join("exomaps")
            .join("generations.db")
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| {
                std::path::PathBuf::from(h)
                    .join("Library")
                    .join("Application Support")
            })
            .unwrap_or_default()
            .join("exomaps")
            .join("generations.db")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
            .join("exomaps")
            .join("generations.db")
    }
}
