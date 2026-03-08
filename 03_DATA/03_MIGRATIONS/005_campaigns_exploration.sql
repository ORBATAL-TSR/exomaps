-- ============================================================
-- Migration 005: Campaigns & Exploration (Fog-of-War)
-- ============================================================
-- Implements per-campaign exploration tracking.  A star system
-- does NOT exist for a campaign until a player "explores" it.
-- Desktop clients generate content on exploration; the server
-- stores the canonical state so web clients can view explored
-- territory.
-- ============================================================

-- ── Campaign ────────────────────────────────────────
-- One row per game instance / save-file.
CREATE TABLE IF NOT EXISTS app_simulation.campaign (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    owner_id        UUID,                     -- future: auth user FK
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    seed            BIGINT NOT NULL DEFAULT (floor(random() * 2147483647)::bigint),
    settings_json   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- difficulty, rules, mods
    status          TEXT NOT NULL DEFAULT 'active'         -- active | paused | archived
        CHECK (status IN ('active', 'paused', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_campaign_owner   ON app_simulation.campaign (owner_id);
CREATE INDEX IF NOT EXISTS idx_campaign_status  ON app_simulation.campaign (status);

-- ── Exploration ─────────────────────────────────────
-- One row per system explored in a campaign.
-- The "fog of war" lifts when this row is inserted.
CREATE TABLE IF NOT EXISTS app_simulation.exploration (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES app_simulation.campaign(id) ON DELETE CASCADE,
    system_main_id  TEXT NOT NULL,             -- FK to dm_galaxy.star_systems.main_id
    explored_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    explored_by     TEXT,                      -- faction / player ship name
    scan_level      INT NOT NULL DEFAULT 1     -- 1 = basic, 2 = detailed, 3 = deep survey
        CHECK (scan_level BETWEEN 1 AND 3),
    notes           TEXT,
    UNIQUE (campaign_id, system_main_id)
);

CREATE INDEX IF NOT EXISTS idx_exploration_campaign ON app_simulation.exploration (campaign_id);
CREATE INDEX IF NOT EXISTS idx_exploration_system   ON app_simulation.exploration (system_main_id);

-- ── Explored Planet ─────────────────────────────────
-- Stores baked/generated planet data per exploration.
-- Links to the procedural generation output so web clients
-- can display pre-rendered assets without a GPU.
CREATE TABLE IF NOT EXISTS app_simulation.explored_planet (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exploration_id  UUID NOT NULL REFERENCES app_simulation.exploration(id) ON DELETE CASCADE,
    planet_index    INT NOT NULL,
    planet_key      TEXT NOT NULL,             -- "{system_main_id}_{planet_index}"
    generation_seed BIGINT,
    scan_level      INT NOT NULL DEFAULT 1
        CHECK (scan_level BETWEEN 1 AND 3),
    -- Baked textures (stored as paths to S3/minio or inline base64 for small maps)
    albedo_url      TEXT,
    heightmap_url   TEXT,
    normal_url      TEXT,
    pbr_url         TEXT,
    thumbnail_url   TEXT,                      -- 128x128 preview for web map markers
    -- Cached science summary (denormalized for fast web display)
    summary_json    JSONB,                     -- composition, atmosphere, geology snapshot
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exploration_id, planet_index)
);

CREATE INDEX IF NOT EXISTS idx_explored_planet_exploration
    ON app_simulation.explored_planet (exploration_id);
CREATE INDEX IF NOT EXISTS idx_explored_planet_key
    ON app_simulation.explored_planet (planet_key);

-- ── Campaign Faction (stub) ─────────────────────────
-- Placeholder for faction ownership / territory tracking.
CREATE TABLE IF NOT EXISTS app_simulation.campaign_faction (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES app_simulation.campaign(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#4d9fff',  -- hex color for map display
    home_system_id  TEXT,                              -- starting system
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, name)
);

-- ── Views ───────────────────────────────────────────

-- Fog-of-war map: only explored systems for a given campaign
CREATE OR REPLACE VIEW app_simulation.v_campaign_map AS
SELECT
    e.campaign_id,
    e.system_main_id,
    e.explored_at,
    e.explored_by,
    e.scan_level,
    s.x, s.y, s.z,
    s.distance_ly,
    s.spectral_class,
    s.teff,
    s.luminosity,
    s.planet_count,
    s.confidence
FROM app_simulation.exploration e
JOIN dm_galaxy.star_systems s ON s.main_id = e.system_main_id;

-- Campaign summary stats
CREATE OR REPLACE VIEW app_simulation.v_campaign_summary AS
SELECT
    c.id AS campaign_id,
    c.name,
    c.status,
    c.created_at,
    COUNT(DISTINCT e.system_main_id) AS systems_explored,
    COUNT(DISTINCT ep.id) AS planets_surveyed,
    COUNT(DISTINCT cf.id) AS factions
FROM app_simulation.campaign c
LEFT JOIN app_simulation.exploration e ON e.campaign_id = c.id
LEFT JOIN app_simulation.explored_planet ep ON ep.exploration_id = e.id
LEFT JOIN app_simulation.campaign_faction cf ON cf.campaign_id = c.id
GROUP BY c.id, c.name, c.status, c.created_at;
