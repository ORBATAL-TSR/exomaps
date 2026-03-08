# ExoMaps Desktop — Build & Distribution Guide

## Overview

The desktop client is a **Tauri 2** app (Rust + WebView) that supports two game modes:

| Mode | Storage | Server Required | Encryption |
|------|---------|-----------------|------------|
| **Single-Player** | Local SQLite (encrypted AES-256-GCM) | No | ✅ |
| **Multiplayer** | Flask gateway API → PostgreSQL | Yes | TLS |

---

## Quick Start (Development)

```bash
cd 02_CLIENTS/02_DESKTOP

# Install JS dependencies
npm install

# Run in dev mode (hot-reload frontend + Rust rebuild)
npm run tauri:dev
```

## Building for Release

### Local build (current OS)

```bash
cd 02_CLIENTS/02_DESKTOP
npm run tauri:build
```

Output artifacts will be in `src-tauri/target/release/bundle/`:

| Platform | Path | Format |
|----------|------|--------|
| Windows | `bundle/nsis/ExoMaps Desktop_x.y.z_x64-setup.exe` | NSIS installer (portable) |
| macOS | `bundle/dmg/ExoMaps Desktop_x.y.z_aarch64.dmg` | Disk image |
| Linux | `bundle/deb/exomaps-desktop_x.y.z_amd64.deb` | Debian package |
| Linux | `bundle/appimage/exomaps-desktop_x.y.z_amd64.AppImage` | Portable AppImage |

### Debug build (with DevTools)

```bash
npm run tauri:build:debug
```

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/desktop-release.yml`) handles cross-platform builds automatically.

### Triggering a release

1. Tag your commit:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. The workflow builds on all 4 targets:
   - `ubuntu-22.04` → Linux x64 (.deb, .AppImage)
   - `windows-latest` → Windows x64 (.exe NSIS)
   - `macos-latest` → macOS ARM64 (.dmg)
   - `macos-13` → macOS Intel (.dmg)

3. Artifacts are uploaded to a **draft GitHub Release**.

4. Review and publish the release on GitHub.

### Manual builds (no release)

Use the `workflow_dispatch` trigger in GitHub Actions → "Run workflow" button. Artifacts are available as downloadable build artifacts (7-day retention).

### Pre-release tags

Tags containing `alpha`, `beta`, or `rc` are automatically marked as pre-releases:
```bash
git tag v0.2.0-alpha.1
git push origin v0.2.0-alpha.1
```

---

## Platform Requirements

### Build Host Requirements

| Platform | Requirements |
|----------|-------------|
| **Linux** | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf` |
| **Windows** | Visual Studio Build Tools 2022+, WebView2 Runtime |
| **macOS** | Xcode Command Line Tools, macOS 10.15+ SDK |

### End-User Requirements

| Platform | Requirements |
|----------|-------------|
| **Windows 10+** | WebView2 (auto-installed by NSIS) |
| **macOS 10.15+** | Catalina or newer |
| **Ubuntu 22.04+** | `libwebkit2gtk-4.1-0`, `libgtk-3-0` |

---

## Single-Player Architecture

### Data storage

All single-player data is stored in the OS-appropriate app data directory:

| OS | Path |
|----|------|
| Linux | `~/.local/share/exomaps/` |
| macOS | `~/Library/Application Support/exomaps/` |
| Windows | `%APPDATA%/exomaps/` |

Files:
- `savegame.key` — 32-byte AES-256 encryption key (auto-generated)
- `savegame.db` — Encrypted campaign state (SQLite)
- `cache.db` — Offline world state cache (SQLite)
- `generations.db` — Planet texture generation cache (SQLite)

### Encryption

- Algorithm: AES-256-GCM (via `aes-gcm` Rust crate)
- Key: Random 32-byte key, generated on first launch, stored locally
- Each encrypted field: `[12-byte nonce | ciphertext | 16-byte auth tag]`
- Saves are tied to the machine (key doesn't travel with the save file)
- Purpose: Anti-tamper for game state integrity, not security from the user

### Tauri IPC Commands

| Command | Description |
|---------|-------------|
| `sg_create_campaign` | Create a new local campaign |
| `sg_list_campaigns` | List saved campaigns |
| `sg_get_campaign_state` | Decrypt and load campaign state |
| `sg_save_campaign_state` | Encrypt and save campaign state |
| `sg_delete_campaign` | Delete campaign + all children |
| `sg_explore_system` | Mark system explored (fog-of-war) |
| `sg_get_explored_systems` | Get explored systems for campaign |
| `sg_create_faction` | Create faction in campaign |
| `sg_list_factions` | List factions in campaign |
| `sg_save_simulation` | Save simulation snapshot |
| `sg_load_simulation` | Load simulation snapshot |
| `sg_get_game_mode` | Query available modes + version |

---

## Versioning

Version is defined in two places (keep in sync):
- `src-tauri/tauri.conf.json` → `"version": "x.y.z"` (bundle version)
- `src-tauri/Cargo.toml` → `version = "x.y.z"` (Rust crate version)
- Git tags: `vx.y.z` (triggers CI/CD release)

The CI/CD workflow uses the git tag as the release name.
