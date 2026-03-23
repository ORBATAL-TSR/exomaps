//! Savegame module — encrypted local persistence for single-player mode.
//!
//! Stores campaign state, explored systems, factions, and simulation snapshots
//! in an AES-256-GCM encrypted SQLite database. Saves are tied to the machine
//! via a locally-generated encryption key (anti-tamper for leaderboards).
//!
//! ## Storage layout
//!
//! ```text
//! <app_data>/exomaps/
//!   savegame.key        ← 32-byte random key (generated on first run)
//!   savegame.db         ← SQLite with encrypted JSON blobs
//!   cache.db            ← world state cache (existing)
//!   generations.db      ← planet texture cache (existing)
//! ```

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

static SAVE_DB: once_cell::sync::Lazy<Mutex<Option<Connection>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

static ENCRYPTION_KEY: once_cell::sync::Lazy<Mutex<Option<[u8; 32]>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

// ── Public data types ──────────────────────────────

/// A saved campaign summary (returned to the frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCampaign {
    pub id: String,
    pub name: String,
    pub seed: i64,
    pub status: String,
    pub current_tick: i64,
    pub created_at: String,
    pub updated_at: String,
    pub explored_count: i64,
    pub faction_count: i64,
}

/// Full campaign state for save/load.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CampaignState {
    pub settings: serde_json::Value,
    pub game_state: serde_json::Value,
}

/// An explored system record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExploredSystem {
    pub system_main_id: String,
    pub scan_level: i32,
    pub explored_by: Option<String>,
    pub explored_at: String,
    pub notes: Option<String>,
}

/// Explore response (mirrors server API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExploreResult {
    pub system_main_id: String,
    pub scan_level: i32,
    pub newly_explored: bool,
}

/// A faction record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFaction {
    pub id: String,
    pub campaign_id: String,
    pub name: String,
    pub color: Option<String>,
    pub home_system: Option<String>,
    pub state: serde_json::Value,
    pub created_at: String,
}

/// Simulation snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationSnapshot {
    pub campaign_id: String,
    pub tick: i64,
    pub state: serde_json::Value,
    pub updated_at: String,
}

// ── Initialization ─────────────────────────────────

/// Initialize the savegame subsystem: load or create encryption key, open DB.
pub fn initialize() -> Result<(), Box<dyn std::error::Error>> {
    let key = load_or_create_key()?;
    if let Ok(mut k) = ENCRYPTION_KEY.lock() {
        *k = Some(key);
    }

    let path = savegame_db_path();
    log::info!("Initializing savegame store at: {}", path.display());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS campaigns (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            seed         INTEGER NOT NULL,
            status       TEXT NOT NULL DEFAULT 'active',
            current_tick INTEGER NOT NULL DEFAULT 0,
            settings_enc BLOB NOT NULL,
            state_enc    BLOB NOT NULL,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS explored_systems (
            campaign_id     TEXT NOT NULL,
            system_main_id  TEXT NOT NULL,
            scan_level      INTEGER NOT NULL DEFAULT 1,
            explored_by     TEXT,
            explored_at     TEXT NOT NULL DEFAULT (datetime('now')),
            notes           TEXT,
            PRIMARY KEY (campaign_id, system_main_id),
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS factions (
            id          TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            name        TEXT NOT NULL,
            color       TEXT,
            home_system TEXT,
            state_enc   BLOB NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS simulation_state (
            campaign_id TEXT PRIMARY KEY,
            tick        INTEGER NOT NULL,
            state_enc   BLOB NOT NULL,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_explored_campaign
            ON explored_systems(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_factions_campaign
            ON factions(campaign_id);
        ",
    )?;

    if let Ok(mut db) = SAVE_DB.lock() {
        *db = Some(conn);
    }

    log::info!("Savegame store initialized successfully");
    Ok(())
}

// ── Campaign CRUD ──────────────────────────────────

/// Create a new single-player campaign. Returns the campaign ID.
pub fn create_campaign(
    name: &str,
    seed: i64,
    settings: &serde_json::Value,
) -> Result<String, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let id = generate_uuid();
    let settings_enc = encrypt_json(settings)?;
    let initial_state = serde_json::json!({
        "resources": {},
        "settlements": {},
        "fleets": {},
        "events": [],
    });
    let state_enc = encrypt_json(&initial_state)?;

    conn.execute(
        "INSERT INTO campaigns (id, name, seed, settings_enc, state_enc)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, seed, settings_enc, state_enc],
    )?;

    log::info!("Created single-player campaign '{}' (id={})", name, id);
    Ok(id)
}

/// List all saved campaigns.
pub fn list_campaigns(
    status_filter: Option<&str>,
) -> Result<Vec<SavedCampaign>, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let query = if let Some(status) = status_filter {
        format!(
            "SELECT c.id, c.name, c.seed, c.status, c.current_tick, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM explored_systems WHERE campaign_id = c.id) as explored_count,
                    (SELECT COUNT(*) FROM factions WHERE campaign_id = c.id) as faction_count
             FROM campaigns c
             WHERE c.status = '{}'
             ORDER BY c.updated_at DESC",
            status
        )
    } else {
        "SELECT c.id, c.name, c.seed, c.status, c.current_tick, c.created_at, c.updated_at,
                (SELECT COUNT(*) FROM explored_systems WHERE campaign_id = c.id) as explored_count,
                (SELECT COUNT(*) FROM factions WHERE campaign_id = c.id) as faction_count
         FROM campaigns c
         ORDER BY c.updated_at DESC"
            .to_string()
    };

    let mut stmt = conn.prepare(&query)?;
    let campaigns = stmt
        .query_map([], |row| {
            Ok(SavedCampaign {
                id: row.get(0)?,
                name: row.get(1)?,
                seed: row.get(2)?,
                status: row.get(3)?,
                current_tick: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                explored_count: row.get(7)?,
                faction_count: row.get(8)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(campaigns)
}

/// Get a campaign's full state (decrypted).
pub fn get_campaign_state(
    campaign_id: &str,
) -> Result<Option<CampaignState>, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT settings_enc, state_enc FROM campaigns WHERE id = ?1",
    )?;

    match stmt.query_row(params![campaign_id], |row| {
        let settings_enc: Vec<u8> = row.get(0)?;
        let state_enc: Vec<u8> = row.get(1)?;
        Ok((settings_enc, state_enc))
    }) {
        Ok((settings_enc, state_enc)) => {
            let settings = decrypt_json(&settings_enc)?;
            let game_state = decrypt_json(&state_enc)?;
            Ok(Some(CampaignState {
                settings,
                game_state,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

/// Save updated game state for a campaign.
pub fn save_campaign_state(
    campaign_id: &str,
    tick: i64,
    state: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let state_enc = encrypt_json(state)?;

    conn.execute(
        "UPDATE campaigns SET state_enc = ?1, current_tick = ?2,
                updated_at = datetime('now')
         WHERE id = ?3",
        params![state_enc, tick, campaign_id],
    )?;

    Ok(())
}

/// Delete a campaign and all associated data.
pub fn delete_campaign(campaign_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    // CASCADE should handle children, but be explicit
    conn.execute(
        "DELETE FROM simulation_state WHERE campaign_id = ?1",
        params![campaign_id],
    )?;
    conn.execute(
        "DELETE FROM factions WHERE campaign_id = ?1",
        params![campaign_id],
    )?;
    conn.execute(
        "DELETE FROM explored_systems WHERE campaign_id = ?1",
        params![campaign_id],
    )?;
    conn.execute(
        "DELETE FROM campaigns WHERE id = ?1",
        params![campaign_id],
    )?;

    log::info!("Deleted campaign {}", campaign_id);
    Ok(())
}

// ── Explored systems ───────────────────────────────

/// Mark a system as explored in a campaign.
pub fn explore_system(
    campaign_id: &str,
    system_main_id: &str,
    scan_level: i32,
    explored_by: Option<&str>,
    notes: Option<&str>,
) -> Result<ExploreResult, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    // Check if already explored
    let existing: Option<i32> = conn
        .query_row(
            "SELECT scan_level FROM explored_systems
             WHERE campaign_id = ?1 AND system_main_id = ?2",
            params![campaign_id, system_main_id],
            |row| row.get(0),
        )
        .ok();

    let newly_explored = existing.is_none();
    let effective_level = existing.map_or(scan_level, |prev| prev.max(scan_level));

    conn.execute(
        "INSERT OR REPLACE INTO explored_systems
            (campaign_id, system_main_id, scan_level, explored_by, notes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![campaign_id, system_main_id, effective_level, explored_by, notes],
    )?;

    Ok(ExploreResult {
        system_main_id: system_main_id.to_string(),
        scan_level: effective_level,
        newly_explored,
    })
}

/// Get all explored systems for a campaign.
pub fn get_explored_systems(
    campaign_id: &str,
) -> Result<Vec<ExploredSystem>, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT system_main_id, scan_level, explored_by, explored_at, notes
         FROM explored_systems WHERE campaign_id = ?1
         ORDER BY explored_at DESC",
    )?;

    let systems = stmt
        .query_map(params![campaign_id], |row| {
            Ok(ExploredSystem {
                system_main_id: row.get(0)?,
                scan_level: row.get(1)?,
                explored_by: row.get(2)?,
                explored_at: row.get(3)?,
                notes: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(systems)
}

// ── Factions ───────────────────────────────────────

/// Create a faction in a campaign.
pub fn create_faction(
    campaign_id: &str,
    name: &str,
    color: Option<&str>,
    home_system: Option<&str>,
    initial_state: &serde_json::Value,
) -> Result<String, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let id = generate_uuid();
    let state_enc = encrypt_json(initial_state)?;

    conn.execute(
        "INSERT INTO factions (id, campaign_id, name, color, home_system, state_enc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, campaign_id, name, color, home_system, state_enc],
    )?;

    Ok(id)
}

/// List factions for a campaign.
pub fn list_factions(
    campaign_id: &str,
) -> Result<Vec<SavedFaction>, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT id, campaign_id, name, color, home_system, state_enc, created_at
         FROM factions WHERE campaign_id = ?1
         ORDER BY created_at",
    )?;

    let factions = stmt
        .query_map(params![campaign_id], |row| {
            let state_enc: Vec<u8> = row.get(5)?;
            let state = decrypt_json(&state_enc).unwrap_or(serde_json::json!({}));
            Ok(SavedFaction {
                id: row.get(0)?,
                campaign_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                home_system: row.get(4)?,
                state,
                created_at: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(factions)
}

// ── Simulation state ───────────────────────────────

/// Save a simulation snapshot for a campaign.
pub fn save_simulation_state(
    campaign_id: &str,
    tick: i64,
    state: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let state_enc = encrypt_json(state)?;

    conn.execute(
        "INSERT OR REPLACE INTO simulation_state (campaign_id, tick, state_enc, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))",
        params![campaign_id, tick, state_enc],
    )?;

    Ok(())
}

/// Load the simulation snapshot for a campaign.
pub fn load_simulation_state(
    campaign_id: &str,
) -> Result<Option<SimulationSnapshot>, Box<dyn std::error::Error>> {
    let guard = SAVE_DB.lock().map_err(|e| format!("Lock: {}", e))?;
    let conn = guard.as_ref().ok_or("Savegame DB not initialized")?;

    let mut stmt = conn.prepare(
        "SELECT campaign_id, tick, state_enc, updated_at
         FROM simulation_state WHERE campaign_id = ?1",
    )?;

    match stmt.query_row(params![campaign_id], |row| {
        let state_enc: Vec<u8> = row.get(2)?;
        let state = decrypt_json(&state_enc).unwrap_or(serde_json::json!({}));
        Ok(SimulationSnapshot {
            campaign_id: row.get(0)?,
            tick: row.get(1)?,
            state,
            updated_at: row.get(3)?,
        })
    }) {
        Ok(snap) => Ok(Some(snap)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(Box::new(e)),
    }
}

// ── Encryption helpers ─────────────────────────────

/// Encrypt a JSON value → Vec<u8> (nonce || ciphertext).
fn encrypt_json(value: &serde_json::Value) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let key_guard = ENCRYPTION_KEY
        .lock()
        .map_err(|e| format!("Key lock: {}", e))?;
    let key_bytes = key_guard.as_ref().ok_or("Encryption key not loaded")?;

    let cipher = Aes256Gcm::new_from_slice(key_bytes)
        .map_err(|e| format!("Cipher init: {}", e))?;

    let plaintext = serde_json::to_vec(value)?;

    // Generate a random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("Encrypt: {}", e))?;

    // Prepend nonce to ciphertext: [12 bytes nonce | N bytes ciphertext]
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypt Vec<u8> (nonce || ciphertext) → JSON value.
fn decrypt_json(data: &[u8]) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if data.len() < 13 {
        return Err("Encrypted data too short".into());
    }

    let key_guard = ENCRYPTION_KEY
        .lock()
        .map_err(|e| format!("Key lock: {}", e))?;
    let key_bytes = key_guard.as_ref().ok_or("Encryption key not loaded")?;

    let cipher = Aes256Gcm::new_from_slice(key_bytes)
        .map_err(|e| format!("Cipher init: {}", e))?;

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decrypt failed (save may be corrupted or from another machine): {}", e))?;

    let value = serde_json::from_slice(&plaintext)?;
    Ok(value)
}

// ── Key management ─────────────────────────────────

/// Load the encryption key from disk, or generate a new one.
fn load_or_create_key() -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let key_path = savegame_key_path();

    if key_path.exists() {
        let bytes = std::fs::read(&key_path)?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            log::info!("Loaded savegame encryption key from {}", key_path.display());
            return Ok(key);
        }
        log::warn!("Invalid key file size ({}), regenerating", bytes.len());
    }

    // Generate a new random key
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);

    // Ensure parent dir exists
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(&key_path, &key)?;
    log::info!("Generated new savegame encryption key at {}", key_path.display());

    Ok(key)
}

// ── Path helpers ───────────────────────────────────

/// Simple UUID v4 generator using rand.
fn generate_uuid() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);

    // Set version 4 and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

fn data_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".local").join("share"))
            })
            .unwrap_or_default()
            .join("exomaps")
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
            .unwrap_or_default()
            .join("exomaps")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_default()
            .join("exomaps")
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        PathBuf::from("exomaps")
    }
}

fn savegame_db_path() -> PathBuf {
    data_dir().join("savegame.db")
}

fn savegame_key_path() -> PathBuf {
    data_dir().join("savegame.key")
}
