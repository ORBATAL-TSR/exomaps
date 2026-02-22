CREATE SCHEMA IF NOT EXISTS stg_data;
CREATE SCHEMA IF NOT EXISTS dm_galaxy;
CREATE SCHEMA IF NOT EXISTS app_simulation;

CREATE TABLE IF NOT EXISTS stg_data.ingest_runs (
	run_id UUID PRIMARY KEY,
	run_name TEXT NOT NULL,
	status TEXT NOT NULL,
	started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	finished_at TIMESTAMPTZ,
	notes TEXT
);

CREATE TABLE IF NOT EXISTS stg_data.source_manifest (
	source_manifest_id BIGSERIAL PRIMARY KEY,
	run_id UUID NOT NULL REFERENCES stg_data.ingest_runs(run_id) ON DELETE CASCADE,
	source_name TEXT NOT NULL,
	file_name TEXT NOT NULL,
	file_path TEXT NOT NULL,
	file_checksum_sha256 TEXT NOT NULL,
	source_release_date DATE,
	adapter_version TEXT NOT NULL,
	row_count INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL,
	ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_source_manifest_run_id
	ON stg_data.source_manifest (run_id);

CREATE TABLE IF NOT EXISTS stg_data.validation_summary (
	validation_summary_id BIGSERIAL PRIMARY KEY,
	run_id UUID NOT NULL REFERENCES stg_data.ingest_runs(run_id) ON DELETE CASCADE,
	source_name TEXT NOT NULL,
	total_rows INTEGER NOT NULL,
	accepted_rows INTEGER NOT NULL,
	quarantined_rows INTEGER NOT NULL,
	warning_count INTEGER NOT NULL DEFAULT 0,
	fail_count INTEGER NOT NULL DEFAULT 0,
	gate_status TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_validation_summary_run_id
	ON stg_data.validation_summary (run_id);

CREATE TABLE IF NOT EXISTS stg_data.validation_quarantine (
	quarantine_id BIGSERIAL PRIMARY KEY,
	run_id UUID NOT NULL REFERENCES stg_data.ingest_runs(run_id) ON DELETE CASCADE,
	source_name TEXT NOT NULL,
	source_table TEXT NOT NULL,
	row_number INTEGER,
	error_code TEXT NOT NULL,
	error_detail TEXT NOT NULL,
	raw_record JSONB NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validation_quarantine_run_id
	ON stg_data.validation_quarantine (run_id);

CREATE TABLE IF NOT EXISTS dm_galaxy.stars (
	star_id BIGSERIAL PRIMARY KEY,
	canonical_name TEXT NOT NULL,
	source_name TEXT NOT NULL,
	source_object_id TEXT,
	ra_deg DOUBLE PRECISION,
	dec_deg DOUBLE PRECISION,
	distance_ly DOUBLE PRECISION,
	x_ly DOUBLE PRECISION,
	y_ly DOUBLE PRECISION,
	z_ly DOUBLE PRECISION,
	confidence_tier TEXT NOT NULL DEFAULT 'candidate',
	provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (source_name, source_object_id)
);

CREATE INDEX IF NOT EXISTS idx_stars_distance_ly
	ON dm_galaxy.stars (distance_ly);

CREATE TABLE IF NOT EXISTS dm_galaxy.planets (
	planet_id BIGSERIAL PRIMARY KEY,
	star_id BIGINT REFERENCES dm_galaxy.stars(star_id) ON DELETE SET NULL,
	canonical_name TEXT NOT NULL,
	source_name TEXT NOT NULL,
	source_object_id TEXT,
	planet_status TEXT,
	orbital_period_days DOUBLE PRECISION,
	semi_major_axis_au DOUBLE PRECISION,
	radius_rearth DOUBLE PRECISION,
	mass_mjup DOUBLE PRECISION,
	confidence_tier TEXT NOT NULL DEFAULT 'candidate',
	provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (source_name, source_object_id)
);

CREATE TABLE IF NOT EXISTS dm_galaxy.belts (
	belt_id BIGSERIAL PRIMARY KEY,
	star_id BIGINT REFERENCES dm_galaxy.stars(star_id) ON DELETE CASCADE,
	belt_name TEXT NOT NULL,
	belt_type TEXT NOT NULL,
	inner_radius_au DOUBLE PRECISION,
	outer_radius_au DOUBLE PRECISION,
	confidence_tier TEXT NOT NULL DEFAULT 'inferred',
	provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_simulation.system_state (
	system_state_id BIGSERIAL PRIMARY KEY,
	star_id BIGINT REFERENCES dm_galaxy.stars(star_id) ON DELETE CASCADE,
	simulation_epoch BIGINT NOT NULL DEFAULT 0,
	polity_id TEXT,
	colony_population BIGINT NOT NULL DEFAULT 0,
	economic_output NUMERIC(18, 4) NOT NULL DEFAULT 0,
	metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (star_id, simulation_epoch)
);
