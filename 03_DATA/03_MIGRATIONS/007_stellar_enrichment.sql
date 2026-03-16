-- Migration 007 — Stellar Enrichment & Inference Classification
-- ==============================================================
-- 1. Extends dm_galaxy.stars with all physical/astrometric columns
--    that coordinate_transforms.py and the inference engine need.
--    Previously these columns were missing entirely; Phase 01 ingest
--    only wrote to stg_data.*_raw tables.
--
-- 2. Extends dm_galaxy.inferred_planets with:
--    - Stellar metallicity context ([Fe/H])
--    - Physical composition fractions
--    - All 10-axis classification labels (from VITA pipeline)
--    - Tidal heating flux
--    - Habitable-zone bounds and membership flag
--    - Render profile hook (post-exploration)
--
-- 3. Adds a GAIA DR3 staging table for parallax/astrophysical parameter
--    upserts from the GAIA ingest script.
--
-- References:
--   - Kopparapu et al. (2013) — HZ effective flux coefficients
--   - Fischer & Valenti (2005) — planet–metallicity correlation
--   - GAIA DR3 column names: gaiaedr3.gaia_source

-- ─────────────────────────────────────────────────────────────
-- 1. Extend dm_galaxy.stars
-- ─────────────────────────────────────────────────────────────

-- Astrometry (what coordinate_transforms.py reads)
ALTER TABLE dm_galaxy.stars
    ADD COLUMN IF NOT EXISTS parallax_mas            NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS parallax_error_mas      NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS pm_ra_cosdec_mas_yr     NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS pm_dec_mas_yr           NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS pm_ra_error_mas_yr      NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS pm_dec_error_mas_yr     NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS radial_velocity_km_s    NUMERIC(10, 4),
    ADD COLUMN IF NOT EXISTS radial_velocity_error_km_s NUMERIC(10, 4);

-- Stellar classification & photometry
ALTER TABLE dm_galaxy.stars
    ADD COLUMN IF NOT EXISTS spectral_type           TEXT,
    ADD COLUMN IF NOT EXISTS magnitude_v             NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS magnitude_i             NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS magnitude_j             NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS magnitude_h             NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS magnitude_k             NUMERIC(6, 3);

-- Physical properties (what WorldGenInput needs)
ALTER TABLE dm_galaxy.stars
    ADD COLUMN IF NOT EXISTS luminosity_solar        NUMERIC(14, 8),
    ADD COLUMN IF NOT EXISTS temperature_k           NUMERIC(8, 2),
    ADD COLUMN IF NOT EXISTS star_mass_solar         NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS star_mass_error_solar   NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS star_radius_solar       NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS star_radius_error_solar NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS star_age_gyr            NUMERIC(8, 3),
    ADD COLUMN IF NOT EXISTS star_age_gyr_error      NUMERIC(8, 3),
    ADD COLUMN IF NOT EXISTS magnetic_field_detected BOOLEAN DEFAULT FALSE;

-- Metallicity — the critical missing link
-- [Fe/H] relative to solar (log scale); solar = 0.0
-- Range: roughly -2.5 (very metal-poor) to +0.5 (metal-rich)
ALTER TABLE dm_galaxy.stars
    ADD COLUMN IF NOT EXISTS metallicity_feh         NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS metallicity_feh_error   NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS metallicity_source      TEXT;  -- 'exoplanet_catalog', 'gaia_gspphot', 'spectroscopy', 'inferred'

-- GAIA DR3 crossmatch results
ALTER TABLE dm_galaxy.stars
    ADD COLUMN IF NOT EXISTS gaia_source_id          BIGINT,
    ADD COLUMN IF NOT EXISTS gaia_dr                 TEXT DEFAULT 'none',   -- 'DR2', 'DR3', 'none'
    ADD COLUMN IF NOT EXISTS gaia_parallax_mas       NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS gaia_parallax_error_mas NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS gaia_teff_k             NUMERIC(8, 2),
    ADD COLUMN IF NOT EXISTS gaia_mh_gspphot         NUMERIC(6, 3),         -- [M/H] from GSP-Phot
    ADD COLUMN IF NOT EXISTS gaia_radius_solar       NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS gaia_luminosity_solar   NUMERIC(14, 8);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_stars_spectral_type
    ON dm_galaxy.stars (spectral_type);
CREATE INDEX IF NOT EXISTS idx_stars_metallicity_feh
    ON dm_galaxy.stars (metallicity_feh);
CREATE INDEX IF NOT EXISTS idx_stars_temperature_k
    ON dm_galaxy.stars (temperature_k);
CREATE INDEX IF NOT EXISTS idx_stars_gaia_source_id
    ON dm_galaxy.stars (gaia_source_id);

-- ─────────────────────────────────────────────────────────────
-- 2. Extend dm_galaxy.inferred_planets
-- ─────────────────────────────────────────────────────────────

-- Stellar metallicity context (denormalised for fast inference queries)
ALTER TABLE dm_galaxy.inferred_planets
    ADD COLUMN IF NOT EXISTS star_metallicity_feh    NUMERIC(6, 3),
    ADD COLUMN IF NOT EXISTS star_temperature_k      NUMERIC(8, 2),
    ADD COLUMN IF NOT EXISTS star_luminosity_solar   NUMERIC(14, 8),
    ADD COLUMN IF NOT EXISTS star_mass_solar         NUMERIC(8, 4),
    ADD COLUMN IF NOT EXISTS star_age_gyr            NUMERIC(8, 3);

-- Habitable zone bounds (Kopparapu 2013 conservative estimates)
-- Populated by inference_engine.py from stellar luminosity
ALTER TABLE dm_galaxy.inferred_planets
    ADD COLUMN IF NOT EXISTS hz_inner_au             NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS hz_outer_au             NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS in_hz                   BOOLEAN DEFAULT FALSE;

-- Physical composition fractions (from EOS inference or heuristic)
ALTER TABLE dm_galaxy.inferred_planets
    ADD COLUMN IF NOT EXISTS iron_fraction           NUMERIC(5, 3),
    ADD COLUMN IF NOT EXISTS silicate_fraction       NUMERIC(5, 3),
    ADD COLUMN IF NOT EXISTS volatile_fraction       NUMERIC(5, 3),
    ADD COLUMN IF NOT EXISTS h_he_fraction           NUMERIC(5, 3),
    ADD COLUMN IF NOT EXISTS bond_albedo             NUMERIC(5, 3),
    ADD COLUMN IF NOT EXISTS mean_density_g_cm3      NUMERIC(8, 4);

-- Tidal heating (from VITA pipeline, written back on exploration)
ALTER TABLE dm_galaxy.inferred_planets
    ADD COLUMN IF NOT EXISTS tidal_heating_w_m2      NUMERIC(12, 6);

-- 10-axis classification labels (serialised from VITA WorldBody)
-- Written back to DB after the first VITA exploration of the system
ALTER TABLE dm_galaxy.inferred_planets
    ADD COLUMN IF NOT EXISTS mass_class              TEXT,
    ADD COLUMN IF NOT EXISTS composition_class       TEXT,
    ADD COLUMN IF NOT EXISTS atmosphere_class        TEXT,
    ADD COLUMN IF NOT EXISTS thermal_class           TEXT,
    ADD COLUMN IF NOT EXISTS hydrosphere_class       TEXT,
    ADD COLUMN IF NOT EXISTS tectonic_class          TEXT,
    ADD COLUMN IF NOT EXISTS habitability_class      TEXT,
    ADD COLUMN IF NOT EXISTS dynamical_class         TEXT,
    ADD COLUMN IF NOT EXISTS special_tags            TEXT[];   -- array of SpecialTag strings

-- Render profile hook (set after VITA generates the render profile)
ALTER TABLE dm_galaxy.inferred_planets
    ADD COLUMN IF NOT EXISTS render_terrain_algorithm TEXT,
    ADD COLUMN IF NOT EXISTS render_profile_json      JSONB;

-- Indexes for gameplay queries
CREATE INDEX IF NOT EXISTS idx_inferred_planets_hydrosphere
    ON dm_galaxy.inferred_planets (hydrosphere_class);
CREATE INDEX IF NOT EXISTS idx_inferred_planets_habitability
    ON dm_galaxy.inferred_planets (habitability_class);
CREATE INDEX IF NOT EXISTS idx_inferred_planets_tectonic
    ON dm_galaxy.inferred_planets (tectonic_class);
CREATE INDEX IF NOT EXISTS idx_inferred_planets_in_hz
    ON dm_galaxy.inferred_planets (in_hz);
CREATE INDEX IF NOT EXISTS idx_inferred_planets_metallicity
    ON dm_galaxy.inferred_planets (star_metallicity_feh);

-- ─────────────────────────────────────────────────────────────
-- 3. GAIA DR3 staging table
-- ─────────────────────────────────────────────────────────────
-- The gaia.py ingest script writes raw DR3 rows here.
-- The promote_to_galaxy.py promotion step then merges these into
-- dm_galaxy.stars via coordinate crossmatch.

CREATE TABLE IF NOT EXISTS stg_data.gaia_dr3_raw (
    gaia_raw_id         BIGSERIAL PRIMARY KEY,
    ingest_run_id       TEXT,
    ingest_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- GAIA identifiers
    source_id           BIGINT NOT NULL UNIQUE,
    designation         TEXT,

    -- Astrometry (from gaia_source)
    ra_deg              DOUBLE PRECISION,
    dec_deg             DOUBLE PRECISION,
    parallax_mas        DOUBLE PRECISION,
    parallax_error_mas  DOUBLE PRECISION,
    pm_ra_cosdec_mas_yr DOUBLE PRECISION,
    pm_dec_mas_yr       DOUBLE PRECISION,
    pm_ra_error_mas_yr  DOUBLE PRECISION,
    pm_dec_error_mas_yr DOUBLE PRECISION,
    radial_velocity_km_s       DOUBLE PRECISION,
    radial_velocity_error_km_s DOUBLE PRECISION,

    -- Photometry
    phot_g_mean_mag     DOUBLE PRECISION,
    phot_bp_mean_mag    DOUBLE PRECISION,
    phot_rp_mean_mag    DOUBLE PRECISION,

    -- Astrophysical parameters (from gaia_source GSP-Phot / FLAME)
    teff_gspphot        DOUBLE PRECISION,   -- effective temperature [K]
    teff_gspphot_lower  DOUBLE PRECISION,
    teff_gspphot_upper  DOUBLE PRECISION,
    logg_gspphot        DOUBLE PRECISION,   -- log(g) [dex]
    mh_gspphot          DOUBLE PRECISION,   -- [M/H] metallicity [dex]
    mh_gspphot_lower    DOUBLE PRECISION,
    mh_gspphot_upper    DOUBLE PRECISION,
    azero_gspphot       DOUBLE PRECISION,   -- extinction A₀ [mag]
    radius_gspphot      DOUBLE PRECISION,   -- stellar radius [R☉]
    radius_gspphot_lower DOUBLE PRECISION,
    radius_gspphot_upper DOUBLE PRECISION,
    lum_flame           DOUBLE PRECISION,   -- luminosity from FLAME [L☉]
    lum_flame_lower     DOUBLE PRECISION,
    lum_flame_upper     DOUBLE PRECISION,
    age_flame           DOUBLE PRECISION,   -- age from FLAME [Gyr]
    age_flame_lower     DOUBLE PRECISION,
    age_flame_upper     DOUBLE PRECISION,
    mass_flame          DOUBLE PRECISION,   -- mass from FLAME [M☉]
    mass_flame_lower    DOUBLE PRECISION,
    mass_flame_upper    DOUBLE PRECISION,

    -- Crossmatch result (filled by promotion step)
    matched_main_id     TEXT,
    match_separation_arcsec DOUBLE PRECISION,
    match_status        TEXT DEFAULT 'pending'   -- 'matched', 'new', 'ambiguous', 'pending'
);

CREATE INDEX IF NOT EXISTS idx_gaia_dr3_raw_source_id
    ON stg_data.gaia_dr3_raw (source_id);
CREATE INDEX IF NOT EXISTS idx_gaia_dr3_raw_match_status
    ON stg_data.gaia_dr3_raw (match_status);
CREATE INDEX IF NOT EXISTS idx_gaia_dr3_raw_coords
    ON stg_data.gaia_dr3_raw (ra_deg, dec_deg);
