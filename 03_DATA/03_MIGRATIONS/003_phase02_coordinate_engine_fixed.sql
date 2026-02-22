-- Phase 02 — Coordinate Engine Migration (Fixed)
-- ===========================================================
-- Adds XYZ coordinate schema for transformed ICRS→Cartesian transformations
-- Creates validation and confidence tables for proximity queries

-- 1. Ensure dm_galaxy.stars exists with main_id column
-- ====================================================
-- The stars table must exist already from create_schemas.sql
-- Verify it has main_id if not, we'll need to alter it
ALTER TABLE IF EXISTS dm_galaxy.stars ADD COLUMN IF NOT EXISTS main_id TEXT UNIQUE;

-- 2. Transform rules definition (idempotent upsert)
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase02_transform_rules (
    rule_id TEXT PRIMARY KEY,
    rule_name TEXT NOT NULL UNIQUE,
    description TEXT,
    frame TEXT DEFAULT 'ICRS',
    epoch TEXT DEFAULT 'J2000.0',
    distance_cutoff_ly NUMERIC(10, 2) DEFAULT 100.0,
    parallax_min_error_mas NUMERIC(10, 4) DEFAULT 0.2,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stg_data.phase02_transform_rules
    (rule_id, rule_name, description, frame, epoch, distance_cutoff_ly, parallax_min_error_mas)
VALUES
    ('phase02_primary', 'Primary Transform (ICRS → XYZ)', 
     'Standard ICRS J2000.0 frame conversion with parsec output', 'ICRS', 'J2000.0', 100.0, 0.2),
    ('phase02_edge', 'Edge Shell (100–110 LY)',
     'Optional context stars beyond primary cutoff for visual continuity', 'ICRS', 'J2000.0', 110.0, 0.5)
ON CONFLICT DO NOTHING;

-- 3. Transformed stars table (XYZ coordinates)
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.stars_xyz (
    xyz_id SERIAL PRIMARY KEY,
    main_id TEXT NOT NULL UNIQUE,
    
    -- Cartesian coordinates (parsecs, ICRS frame)
    x_pc NUMERIC(12, 6) NOT NULL,
    y_pc NUMERIC(12, 6) NOT NULL,
    z_pc NUMERIC(12, 6) NOT NULL,
    distance_pc NUMERIC(12, 6) GENERATED ALWAYS AS (
        SQRT(x_pc::NUMERIC * x_pc::NUMERIC + 
             y_pc::NUMERIC * y_pc::NUMERIC + 
             z_pc::NUMERIC * z_pc::NUMERIC)
    ) STORED,
    distance_ly NUMERIC(12, 6) GENERATED ALWAYS AS (
        SQRT(x_pc::NUMERIC * x_pc::NUMERIC + 
             y_pc::NUMERIC * y_pc::NUMERIC + 
             z_pc::NUMERIC * z_pc::NUMERIC) * 3.26156
    ) STORED,
    
    -- Input astrometry (for reference)
    parallax_mas NUMERIC(10, 4) NOT NULL,
    
    -- Uncertainty bounds
    uncertainty_pc NUMERIC(12, 6),
    
    -- Quality flags
    sanity_pass BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    run_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stars_xyz_distance_ly ON dm_galaxy.stars_xyz(distance_ly);
CREATE INDEX IF NOT EXISTS idx_stars_xyz_is_nearby ON dm_galaxy.stars_xyz(is_nearby);
CREATE INDEX IF NOT EXISTS idx_stars_xyz_run_id ON dm_galaxy.stars_xyz(run_id);
CREATE INDEX IF NOT EXISTS idx_stars_xyz_sanity_pass ON dm_galaxy.stars_xyz(sanity_pass);

-- 4. Nearby neighborhood (materialized view for fast queries)
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.nearby_stars (
    nearby_id SERIAL PRIMARY KEY,
    main_id TEXT NOT NULL UNIQUE,
    distance_ly NUMERIC(12, 6),
    x_pc NUMERIC(12, 6),
    y_pc NUMERIC(12, 6),
    z_pc NUMERIC(12, 6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nearby_stars_distance ON dm_galaxy.nearby_stars(distance_ly);

-- 5. Edge stars context (100–110 LY shell for visual continuation)
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.edge_stars (
    edge_id SERIAL PRIMARY KEY,
    main_id TEXT NOT NULL UNIQUE,
    distance_ly NUMERIC(12, 6),
    x_pc NUMERIC(12, 6),
    y_pc NUMERIC(12, 6),
    z_pc NUMERIC(12, 6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_edge_stars_distance ON dm_galaxy.edge_stars(distance_ly);

-- 6. Phase 02 validation results
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase02_validation_results (
    validation_id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    rule_applied TEXT NOT NULL,
    sanity_pass_count INTEGER DEFAULT 0,
    sanity_fail_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_phase02_validation_run ON stg_data.phase02_validation_results(run_id);

-- 7. Phase 02 manifest
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase02_manifest (
    manifest_id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    transform_rule_applied TEXT NOT NULL,
    stars_processed INTEGER DEFAULT 0,
    stars_valid_xyz INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_phase02_manifest_run ON stg_data.phase02_manifest(run_id);

-- Sample reference data for transform rules (optional bootstrapping)
INSERT INTO stg_data.phase02_transform_rules 
    (rule_id, rule_name, frame, epoch, distance_cutoff_ly, parallax_min_error_mas)
VALUES
    ('rule_primary_100ly', 'Primary Stellar Census (< 100 LY)', 'ICRS', 'J2000.0', 100.0, 0.2),
    ('rule_edge_110ly', 'Edge Context (100–110 LY)', 'ICRS', 'J2000.0', 110.0, 0.5),
    ('rule_extended_150ly', 'Extended Survey (< 150 LY)', 'ICRS', 'J2000.0', 150.0, 1.0)
ON CONFLICT DO NOTHING;
