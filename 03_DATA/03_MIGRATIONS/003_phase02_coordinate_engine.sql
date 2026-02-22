-- Phase 02 — Coordinate Engine Migration
-- ===========================================================
-- Adds XYZ coordinate schema for transformed ICRS→Cartesian transformations
-- Creates validation and confidence tables for proximity queries

-- 1. Transform rules definition (idempotent upsert)
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


-- 2. Transformed stars table (XYZ coordinates)
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
    is_nearby BOOLEAN GENERATED ALWAYS AS (distance_ly <= 100.0) STORED,
    
    -- Metadata
    run_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    CONSTRAINT fk_stars_xyz_main_id 
        FOREIGN KEY (main_id) REFERENCES dm_galaxy.stars(main_id) 
        ON DELETE CASCADE
);

CREATE INDEX idx_stars_xyz_distance_ly ON dm_galaxy.stars_xyz(distance_ly);
CREATE INDEX idx_stars_xyz_is_nearby ON dm_galaxy.stars_xyz(is_nearby);
CREATE INDEX idx_stars_xyz_run_id ON dm_galaxy.stars_xyz(run_id);
CREATE INDEX idx_stars_xyz_sanity_pass ON dm_galaxy.stars_xyz(sanity_pass);


-- 3. Nearby neighborhood (materialized view for fast queries)
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.nearby_stars (
    nearby_id SERIAL PRIMARY KEY,
    main_id TEXT UNIQUE,
    x_pc NUMERIC(12, 6),
    y_pc NUMERIC(12, 6),
    z_pc NUMERIC(12, 6),
    distance_ly NUMERIC(12, 6),
    parallax_mas NUMERIC(10, 4),
    uncertainty_pc NUMERIC(12, 6),
    spectral_type TEXT,
    magnitude_v NUMERIC(6, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_nearby_stars_xyz
        FOREIGN KEY (main_id) REFERENCES dm_galaxy.stars_xyz(main_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_nearby_stars_distance_ly ON dm_galaxy.nearby_stars(distance_ly);
CREATE INDEX idx_nearby_stars_spectral_type ON dm_galaxy.nearby_stars(spectral_type);


-- 4. Phase 02 edge shell (100–110 LY context, optional)
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.edge_stars (
    edge_id SERIAL PRIMARY KEY,
    main_id TEXT UNIQUE,
    x_pc NUMERIC(12, 6),
    y_pc NUMERIC(12, 6),
    z_pc NUMERIC(12, 6),
    distance_ly NUMERIC(12, 6),
    parallax_mas NUMERIC(10, 4),
    uncertainty_pc NUMERIC(12, 6),
    spectral_type TEXT,
    magnitude_v NUMERIC(6, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_edge_stars_xyz
        FOREIGN KEY (main_id) REFERENCES dm_galaxy.stars_xyz(main_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_edge_stars_distance_ly ON dm_galaxy.edge_stars(distance_ly);


-- 5. Phase 02 validation results
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase02_validation_results (
    result_id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    validation_rule TEXT NOT NULL,
    total_count INT,
    passed_count INT,
    failed_count INT,
    gate_status TEXT CHECK (gate_status IN ('pass', 'warn', 'fail')),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_phase02_validation_run
        FOREIGN KEY (run_id) REFERENCES stg_data.ingest_runs(run_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_phase02_validation_run_id ON stg_data.phase02_validation_results(run_id);
CREATE INDEX idx_phase02_validation_gate_status ON stg_data.phase02_validation_results(gate_status);


-- 6. Phase 02 manifest
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase02_manifest (
    manifest_id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    
    -- Inputs
    phase01_run_id TEXT,
    stars_loaded INT,
    stars_with_parallax INT,
    
    -- Outputs
    transformed_count INT,
    passed_sanity INT,
    failed_sanity INT,
    nearby_count INT,
    edge_count INT,
    
    -- Summary
    mean_distance_ly NUMERIC(10, 2),
    max_distance_ly NUMERIC(10, 2),
    max_uncertainty_pc NUMERIC(12, 6),
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    CONSTRAINT fk_phase02_manifest_run
        FOREIGN KEY (run_id) REFERENCES stg_data.ingest_runs(run_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_phase02_manifest_run_id ON stg_data.phase02_manifest(run_id);
CREATE INDEX idx_phase02_manifest_status ON stg_data.phase02_manifest(status);


-- 7. Seed transforms (reference sanity check rules)
-- ====================================================
INSERT INTO stg_data.phase02_transform_rules
    (rule_id, rule_name, description, frame, epoch, distance_cutoff_ly, parallax_min_error_mas)
VALUES
    ('sanity_finite_coords', 'Finite Coordinates', 
     'Check that X/Y/Z are finite (not NaN or Inf)', 'ICRS', 'J2000.0', 100.0, 0.2),
    ('sanity_distance_bounds', 'Distance Within Bounds',
     'Distance < 1000 pc for primary, < 1100 pc for edge', 'ICRS', 'J2000.0', 110.0, 0.5),
    ('sanity_parallax_reverse', 'Parallax Round-Trip',
     'Reverse parallax from distance should match input ± 0.1 mas', 'ICRS', 'J2000.0', 100.0, 0.2),
    ('nearby_cutoff', 'Nearby Neighborhood Filter',
     'Distance <= 100 LY counts as nearby', 'ICRS', 'J2000.0', 100.0, 0.2)
ON CONFLICT (rule_id) DO NOTHING;

-- ====================================================
-- Phase 02 migration complete
-- ====================================================
