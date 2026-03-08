//! Shared memory bridge between WebView and native GPU renderer.
//!
//! Provides mechanisms for transferring large texture buffers between
//! the Rust GPU pipeline and the JavaScript WebView without
//! serializing through JSON.
//!
//! Currently uses Base64 encoding over IPC. Future optimization:
//! - SharedArrayBuffer via custom protocol
//! - Memory-mapped file for zero-copy texture sharing
//! - Tauri asset protocol for streaming textures

use std::collections::HashMap;
use std::sync::Mutex;

static TEXTURE_CACHE: once_cell::sync::Lazy<Mutex<HashMap<String, Vec<u8>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

/// Store a texture buffer in the shared cache.
/// Key format: "{system_id}_{planet_index}_{texture_type}"
pub fn store_texture(key: &str, data: Vec<u8>) {
    if let Ok(mut cache) = TEXTURE_CACHE.lock() {
        cache.insert(key.to_string(), data);
    }
}

/// Retrieve a texture buffer from the shared cache.
pub fn get_texture(key: &str) -> Option<Vec<u8>> {
    TEXTURE_CACHE.lock().ok()?.get(key).cloned()
}

/// Remove a texture from cache (after WebView has consumed it).
pub fn evict_texture(key: &str) {
    if let Ok(mut cache) = TEXTURE_CACHE.lock() {
        cache.remove(key);
    }
}

/// Clear all cached textures.
pub fn clear_cache() {
    if let Ok(mut cache) = TEXTURE_CACHE.lock() {
        cache.clear();
    }
}

/// Get total memory usage of cached textures (bytes).
pub fn cache_size_bytes() -> usize {
    TEXTURE_CACHE
        .lock()
        .map(|cache| cache.values().map(|v| v.len()).sum())
        .unwrap_or(0)
}

/// List all cached texture keys.
pub fn cached_keys() -> Vec<String> {
    TEXTURE_CACHE
        .lock()
        .map(|cache| cache.keys().cloned().collect())
        .unwrap_or_default()
}
