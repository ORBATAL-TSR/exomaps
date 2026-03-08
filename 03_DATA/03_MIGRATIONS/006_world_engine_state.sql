-- ============================================================
-- Migration 006: World Engine — Simulation State per Campaign
-- ============================================================
-- Persists the simulation tick state so the World Engine can
-- resume campaigns across server restarts.  Each campaign has
-- at most one active simulation run.
-- ============================================================

-- ── Simulation Run ──────────────────────────────────
-- One active run per campaign.  Contains the engine seed,
-- current tick, and pointer to the latest snapshot.
CREATE TABLE IF NOT EXISTS app_simulation.simulation_run (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES app_simulation.campaign(id) ON DELETE CASCADE,
    seed            BIGINT NOT NULL,
    model_version   TEXT NOT NULL DEFAULT '0.1.0',
    starting_system TEXT NOT NULL DEFAULT 'Sol',
    current_tick    INT NOT NULL DEFAULT 0,
    simulated_year  NUMERIC(8,2) NOT NULL DEFAULT 0.0,
    state           TEXT NOT NULL DEFAULT 'idle'
        CHECK (state IN ('idle', 'running', 'paused', 'completed', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id)   -- one active run per campaign
);

CREATE INDEX IF NOT EXISTS idx_simrun_campaign ON app_simulation.simulation_run (campaign_id);
CREATE INDEX IF NOT EXISTS idx_simrun_state    ON app_simulation.simulation_run (state);

-- ── Settlement ──────────────────────────────────────
-- One row per settled star system in a campaign's simulation.
-- This is the authoritative world state the engine ticks against.
CREATE TABLE IF NOT EXISTS app_simulation.settlement (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES app_simulation.simulation_run(id) ON DELETE CASCADE,
    system_main_id  TEXT NOT NULL,
    population      BIGINT NOT NULL DEFAULT 0,
    tech_level      INT NOT NULL DEFAULT 0,
    faction         TEXT NOT NULL DEFAULT 'Independent',
    -- Economy snapshot
    raw_production          INT NOT NULL DEFAULT 0,
    processed_production    INT NOT NULL DEFAULT 0,
    agricultural_production INT NOT NULL DEFAULT 0,
    trade_surplus           INT NOT NULL DEFAULT 0,
    unemployment_pressure   NUMERIC(5,4) NOT NULL DEFAULT 0.0,
    average_wealth          NUMERIC(12,4) NOT NULL DEFAULT 0.0,
    -- Politics snapshot
    internal_cohesion          NUMERIC(5,4) NOT NULL DEFAULT 0.7,
    alignment_with_homeworld   NUMERIC(5,4) NOT NULL DEFAULT 0.9,
    neighbor_tensions_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    has_independence_movement  BOOLEAN NOT NULL DEFAULT false,
    government_type            TEXT NOT NULL DEFAULT 'civilian',
    -- Metadata
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, system_main_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_run     ON app_simulation.settlement (run_id);
CREATE INDEX IF NOT EXISTS idx_settlement_system  ON app_simulation.settlement (system_main_id);
CREATE INDEX IF NOT EXISTS idx_settlement_faction ON app_simulation.settlement (faction);

-- ── Simulation Event Log ────────────────────────────
-- Append-only log of discrete events produced each tick.
CREATE TABLE IF NOT EXISTS app_simulation.simulation_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES app_simulation.simulation_run(id) ON DELETE CASCADE,
    tick            INT NOT NULL,
    event_type      TEXT NOT NULL,
    location        TEXT,                      -- system_main_id
    description     TEXT,
    impact_json     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simevent_run      ON app_simulation.simulation_event (run_id);
CREATE INDEX IF NOT EXISTS idx_simevent_tick     ON app_simulation.simulation_event (run_id, tick);
CREATE INDEX IF NOT EXISTS idx_simevent_type     ON app_simulation.simulation_event (event_type);
CREATE INDEX IF NOT EXISTS idx_simevent_location ON app_simulation.simulation_event (location);

-- ── Snapshot (periodic checkpoint) ──────────────────
-- Full serialized state at a tick for fast restore / replays.
CREATE TABLE IF NOT EXISTS app_simulation.simulation_snapshot (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES app_simulation.simulation_run(id) ON DELETE CASCADE,
    tick            INT NOT NULL,
    simulated_year  NUMERIC(8,2) NOT NULL,
    state_json      JSONB NOT NULL,            -- full settlements + metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, tick)
);

CREATE INDEX IF NOT EXISTS idx_simsnap_run ON app_simulation.simulation_snapshot (run_id);

-- ── Convenience views ───────────────────────────────

-- Campaign simulation overview
CREATE OR REPLACE VIEW app_simulation.v_campaign_simulation AS
SELECT
    sr.campaign_id,
    c.name AS campaign_name,
    sr.id AS run_id,
    sr.state AS sim_state,
    sr.current_tick,
    sr.simulated_year,
    sr.seed,
    sr.model_version,
    COUNT(DISTINCT s.system_main_id) AS systems_settled,
    COALESCE(SUM(s.population), 0) AS total_population,
    COUNT(DISTINCT s.faction) AS faction_count,
    sr.updated_at AS last_tick_at
FROM app_simulation.simulation_run sr
JOIN app_simulation.campaign c ON c.id = sr.campaign_id
LEFT JOIN app_simulation.settlement s ON s.run_id = sr.id
GROUP BY sr.campaign_id, c.name, sr.id, sr.state, sr.current_tick,
         sr.simulated_year, sr.seed, sr.model_version, sr.updated_at;
