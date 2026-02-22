-- Phase 03 — System Completion Inference Migration
-- ===========================================================
-- Adds tables for inferred planets, belts, and world build manifest
-- Tracks inference runs and confidence tiers for visualization

-- 1. World Build Manifest (tracks all phases for reproducibility)
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.world_builds (
    build_id SERIAL PRIMARY KEY,
    build_name TEXT NOT NULL UNIQUE,
    description TEXT,
    
    -- Phase lineage
    phase01_run_id TEXT,
    phase02_run_id TEXT,
    phase03_run_id TEXT,
    
    -- Source metadata
    phase01_timestamp TIMESTAMP,
    phase02_timestamp TIMESTAMP,
    phase03_timestamp TIMESTAMP,
    
    -- Reproducibility seeds
    phase03_seed INT,
    phase04_seed INT,
    
    -- Manifest stats
    stars_count INT,
    nearby_stars_count INT,
    inferred_planets_count INT,
    inferred_belts_count INT,
    total_systems INT,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_world_builds_status ON stg_data.world_builds(status);
CREATE INDEX idx_world_builds_created ON stg_data.world_builds(created_at DESC);


-- 2. Inferred Planets Table
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.inferred_planets (
    inferred_planet_id SERIAL PRIMARY KEY,
    planet_uuid TEXT UNIQUE,
    
    -- System reference
    main_id TEXT NOT NULL,
    build_id INT,
    
    -- Orbital parameters
    semi_major_axis_au NUMERIC(12, 6) NOT NULL,
    orbital_period_days NUMERIC(12, 2) NOT NULL,
    eccentricity NUMERIC(4, 3) DEFAULT 0.0,
    inclination_deg NUMERIC(6, 2) DEFAULT 0.0,
    
    -- Physical parameters (inferred)
    planet_type TEXT CHECK (planet_type IN ('rocky', 'terrestrial-habitable', 'super-earth', 'sub-neptune', 'gas-giant', 'ice-giant')),
    inferred_mass_earth NUMERIC(12, 6),
    inferred_radius_earth NUMERIC(12, 6),
    inferred_density_g_cm3 NUMERIC(8, 4),
    
    -- Derived properties
    equilibrium_temp_k INT,
    habitable BOOLEAN GENERATED ALWAYS AS (
        CASE WHEN planet_type = 'terrestrial-habitable' THEN TRUE ELSE FALSE END
    ) STORED,
    
    -- Confidence and metadata
    confidence TEXT CHECK (confidence IN ('very-low', 'low', 'medium', 'high', 'very-high')),
    inference_method TEXT,
    inference_seed INT,
    inference_version TEXT,
    
    -- Quality flags
    orbital_valid BOOLEAN DEFAULT TRUE,
    stable BOOLEAN DEFAULT TRUE,
    
    -- Timestamps
    inferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    CONSTRAINT fk_inferred_planets_system
        FOREIGN KEY (main_id) REFERENCES dm_galaxy.stars(main_id),
    CONSTRAINT fk_inferred_planets_build
        FOREIGN KEY (build_id) REFERENCES stg_data.world_builds(build_id)
);

CREATE INDEX idx_inferred_planets_main_id ON dm_galaxy.inferred_planets(main_id);
CREATE INDEX idx_inferred_planets_build_id ON dm_galaxy.inferred_planets(build_id);
CREATE INDEX idx_inferred_planets_habitable ON dm_galaxy.inferred_planets(habitable);
CREATE INDEX idx_inferred_planets_confidence ON dm_galaxy.inferred_planets(confidence);


-- 3. Inferred Belts Table
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.inferred_belts (
    inferred_belt_id SERIAL PRIMARY KEY,
    belt_uuid TEXT UNIQUE,
    
    -- System reference
    main_id TEXT NOT NULL,
    build_id INT,
    
    -- Belt definition
    belt_type TEXT CHECK (belt_type IN ('asteroid-rocky', 'kuiper-icy', 'debris', 'dust-debris')),
    inner_radius_au NUMERIC(12, 6) NOT NULL,
    outer_radius_au NUMERIC(12, 6) NOT NULL,
    estimated_mass_earth_masses NUMERIC(12, 6),
    
    -- Properties
    composition TEXT,  -- 'rocky', 'icy', 'mixed', 'dust'
    optical_depth NUMERIC(8, 6),  -- How opaque/visible
    
    -- Confidence and metadata
    confidence TEXT CHECK (confidence IN ('very-low', 'low', 'medium', 'high', 'very-high')),
    inference_method TEXT,
    inference_seed INT,
    inference_version TEXT,
    
    -- Quality flags
    radius_valid BOOLEAN DEFAULT TRUE,
    stable BOOLEAN DEFAULT TRUE,
    
    -- Timestamps
    inferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    CONSTRAINT fk_inferred_belts_system
        FOREIGN KEY (main_id) REFERENCES dm_galaxy.stars(main_id),
    CONSTRAINT fk_inferred_belts_build
        FOREIGN KEY (build_id) REFERENCES stg_data.world_builds(build_id)
);

CREATE INDEX idx_inferred_belts_main_id ON dm_galaxy.inferred_belts(main_id);
CREATE INDEX idx_inferred_belts_build_id ON dm_galaxy.inferred_belts(build_id);
CREATE INDEX idx_inferred_belts_belt_type ON dm_galaxy.inferred_belts(belt_type);
CREATE INDEX idx_inferred_belts_confidence ON dm_galaxy.inferred_belts(confidence);


-- 4. Phase 03 Inference Results Summary
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase03_inference_results (
    result_id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    build_id INT,
    
    -- Input
    phase02_run_id TEXT,
    stars_processed INT,
    
    -- Output
    planets_inferred INT DEFAULT 0,
    belts_inferred INT DEFAULT 0,
    systems_with_planets INT DEFAULT 0,
    systems_with_belts INT DEFAULT 0,
    
    -- Statistics
    planets_by_type JSONB,  -- {rocky: N, gas_giant: N, ...}
    belts_by_type JSONB,    -- {asteroid: N, kuiper: N, ...}
    habitable_planets_count INT DEFAULT 0,
    avg_planets_per_system NUMERIC(5, 2),
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    error_message TEXT,
    inference_seed INT,
    inference_version TEXT,
    
    -- Timestamps
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    CONSTRAINT fk_phase03_results_build
        FOREIGN KEY (build_id) REFERENCES stg_data.world_builds(build_id)
);

CREATE INDEX idx_phase03_results_run_id ON stg_data.phase03_inference_results(run_id);
CREATE INDEX idx_phase03_results_status ON stg_data.phase03_inference_results(status);


-- 5. System Population Summary (for simulation)
-- ====================================================
CREATE TABLE IF NOT EXISTS dm_galaxy.system_attributes (
    system_id SERIAL PRIMARY KEY,
    main_id TEXT UNIQUE,
    build_id INT,
    
    -- System composition
    star_count INT DEFAULT 1,
    observed_planets INT DEFAULT 0,
    observed_belts INT DEFAULT 0,
    inferred_planets INT DEFAULT 0,
    inferred_belts INT DEFAULT 0,
    total_observed_habitable INT DEFAULT 0,
    total_inferred_habitable INT DEFAULT 0,
    
    -- Simulation attributes
    exploration_priority NUMERIC(5, 2) DEFAULT 0.5,  -- 0.0–1.0 score
    resource_potential NUMERIC(5, 2) DEFAULT 0.5,    -- 0.0–1.0 subjective score
    stability_score NUMERIC(5, 2) DEFAULT 0.5,       -- 0.0–1.0 orbital stability
    colonization_difficulty TEXT DEFAULT 'unknown',  -- easy, moderate, hard, extreme
    scientific_interest NUMERIC(5, 2) DEFAULT 0.5,
    
    -- Metadata
    is_starting_system BOOLEAN DEFAULT FALSE,
    is_neighbor_to_start INT DEFAULT NULL,  -- distance in jumps if nearby
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    CONSTRAINT fk_system_attributes_star
        FOREIGN KEY (main_id) REFERENCES dm_galaxy.stars(main_id),
    CONSTRAINT fk_system_attributes_build
        FOREIGN KEY (build_id) REFERENCES stg_data.world_builds(build_id)
);

CREATE INDEX idx_system_attributes_main_id ON dm_galaxy.system_attributes(main_id);
CREATE INDEX idx_system_attributes_build_id ON dm_galaxy.system_attributes(build_id);
CREATE INDEX idx_system_attributes_exploration_priority ON dm_galaxy.system_attributes(exploration_priority DESC);
CREATE INDEX idx_system_attributes_resource_potential ON dm_galaxy.system_attributes(resource_potential DESC);


-- 6. Inference configuration and rules
-- ====================================================
CREATE TABLE IF NOT EXISTS stg_data.phase03_rules (
    rule_id TEXT PRIMARY KEY,
    rule_name TEXT UNIQUE NOT NULL,
    description TEXT,
    
    -- Configuration
    spectral_class TEXT,
    planet_probability NUMERIC(5, 3),
    avg_planets_count NUMERIC(5, 2),
    belt_probability NUMERIC(5, 3),
    
    -- Orbital constraints
    min_planet_spacing_au NUMERIC(8, 4) DEFAULT 0.15,
    habitable_zone_inner_au NUMERIC(8, 4) DEFAULT 0.95,
    habitable_zone_outer_au NUMERIC(8, 4) DEFAULT 1.37,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stg_data.phase03_rules
    (rule_id, rule_name, description, spectral_class, planet_probability, avg_planets_count, belt_probability)
VALUES
    ('f_class', 'F-class Stars', 'F-type main sequence stars', 'F', 0.15, 2.5, 0.25),
    ('g_class', 'G-class Stars (Sun-like)', 'G-type main sequence stars', 'G', 0.10, 2.0, 0.30),
    ('k_class', 'K-class Stars', 'K-type main sequence stars', 'K', 0.08, 1.8, 0.25),
    ('m_class', 'M-class Stars (Red Dwarfs)', 'M-type main sequence stars', 'M', 0.12, 2.2, 0.20),
    ('o_class', 'O-class Stars (Massive)', 'O-type massive stars', 'O', 0.02, 0.5, 0.10),
    ('b_class', 'B-class Stars', 'B-type main sequence stars', 'B', 0.03, 0.8, 0.15),
    ('a_class', 'A-class Stars', 'A-type main sequence stars', 'A', 0.05, 1.2, 0.20)
ON CONFLICT (rule_id) DO NOTHING;


-- ====================================================
-- Phase 03 migration complete
-- ====================================================
