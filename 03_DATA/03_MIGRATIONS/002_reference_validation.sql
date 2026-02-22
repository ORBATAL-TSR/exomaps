CREATE TABLE IF NOT EXISTS stg_data.reference_validation_rules (
    reference_rule_id BIGSERIAL PRIMARY KEY,
    rule_key TEXT NOT NULL UNIQUE,
    rule_name TEXT NOT NULL,
    description TEXT NOT NULL,
    expected_value DOUBLE PRECISION NOT NULL,
    tolerance DOUBLE PRECISION NOT NULL,
    units TEXT NOT NULL,
    matcher JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stg_data.reference_validation_results (
    reference_result_id BIGSERIAL PRIMARY KEY,
    run_id UUID,
    rule_key TEXT NOT NULL,
    source_table TEXT,
    source_main_id TEXT,
    observed_value DOUBLE PRECISION,
    expected_value DOUBLE PRECISION,
    absolute_error DOUBLE PRECISION,
    tolerance DOUBLE PRECISION,
    status TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reference_validation_results_run_id
    ON stg_data.reference_validation_results (run_id);

CREATE INDEX IF NOT EXISTS idx_reference_validation_results_status
    ON stg_data.reference_validation_results (status);