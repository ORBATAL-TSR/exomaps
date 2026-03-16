//! SQLite-backed offline cache for world state.
//!
//! Stores fetched system data locally so the desktop client can
//! operate without a network connection. Cached data includes:
//!   - Full system JSON responses from the API
//!   - Timestamp of last fetch (for staleness checks)
//!   - Generated texture hashes (to avoid re-generation)

use rusqlite::{Connection, params};
use std::sync::Mutex;

use crate::CachedSystem;

static DB: once_cell::sync::Lazy<Mutex<Option<Connection>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

/// Initialize the SQLite cache database.
/// Creates tables if they don't exist.
pub fn initialize_cache() -> Result<(), Box<dyn std::error::Error>> {
    let path = cache_db_path();
    log::info!("Initializing cache at: {}", path.display());

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&path)?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS systems (
            main_id     TEXT PRIMARY KEY,
            data_json   TEXT NOT NULL,
            fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS textures (
            texture_key TEXT PRIMARY KEY,
            system_id   TEXT NOT NULL,
            planet_idx  INTEGER NOT NULL,
            texture_type TEXT NOT NULL,
            data_b64    TEXT NOT NULL,
            generated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (system_id) REFERENCES systems(main_id)
        );

        CREATE INDEX IF NOT EXISTS idx_textures_system ON textures(system_id);
        ",
    )?;

    if let Ok(mut db) = DB.lock() {
        *db = Some(conn);
    }

    Ok(())
}

/// Store a system's JSON response in the cache.
pub fn cache_system(main_id: &str, data_json: &str) -> Result<(), Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    conn.execute(
        "INSERT OR REPLACE INTO systems (main_id, data_json, fetched_at) VALUES (?1, ?2, datetime('now'))",
        params![main_id, data_json],
    )?;

    Ok(())
}

/// Retrieve a cached system.
pub fn get_cached(main_id: &str) -> Result<Option<CachedSystem>, Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT main_id, data_json, fetched_at FROM systems WHERE main_id = ?1",
    )?;

    let result = stmt.query_row(params![main_id], |row| {
        Ok(CachedSystem {
            main_id: row.get(0)?,
            data_json: row.get(1)?,
            fetched_at: row.get(2)?,
        })
    });

    match result {
        Ok(system) => Ok(Some(system)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

/// List all cached system main_ids.
pub fn list_cached() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    let mut stmt = conn.prepare("SELECT main_id FROM systems ORDER BY fetched_at DESC")?;
    let ids = stmt.query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ids)
}

/// Delete a cached system and its textures.
pub fn evict_system(main_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    conn.execute("DELETE FROM textures WHERE system_id = ?1", params![main_id])?;
    conn.execute("DELETE FROM systems WHERE main_id = ?1", params![main_id])?;

    Ok(())
}

/// Get the total number of cached systems.
pub fn cached_count() -> Result<usize, Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM systems", [], |row| row.get(0))?;
    Ok(count as usize)
}

/// Store a generated texture in the cache.
pub fn cache_texture(
    system_id: &str,
    planet_idx: usize,
    texture_type: &str,
    data_b64: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    let key = format!("{}_{}_{}", system_id, planet_idx, texture_type);
    conn.execute(
        "INSERT OR REPLACE INTO textures (texture_key, system_id, planet_idx, texture_type, data_b64, generated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        params![key, system_id, planet_idx as i64, texture_type, data_b64],
    )?;

    Ok(())
}

/// Retrieve a cached texture.
pub fn get_cached_texture(
    system_id: &str,
    planet_idx: usize,
    texture_type: &str,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let guard = DB.lock().map_err(|e| format!("Lock error: {}", e))?;
    let conn = guard.as_ref().ok_or("Cache not initialized")?;

    let key = format!("{}_{}_{}", system_id, planet_idx, texture_type);
    let mut stmt = conn.prepare("SELECT data_b64 FROM textures WHERE texture_key = ?1")?;

    match stmt.query_row(params![key], |row| row.get::<_, String>(0)) {
        Ok(data) => Ok(Some(data)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

/// Get the platform-appropriate cache database path.
fn cache_db_path() -> std::path::PathBuf {
    // Use XDG data directory on Linux, AppData on Windows, Library on macOS
    if let Some(data_dir) = dirs_next() {
        data_dir.join("exomaps").join("cache.db")
    } else {
        std::path::PathBuf::from("exomaps_cache.db")
    }
}

/// Cross-platform data directory.
fn dirs_next() -> Option<std::path::PathBuf> {
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
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| std::path::PathBuf::from(h).join("Library").join("Application Support"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(std::path::PathBuf::from)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        None
    }
}
