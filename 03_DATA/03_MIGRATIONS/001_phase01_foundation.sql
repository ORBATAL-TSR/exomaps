CREATE TABLE IF NOT EXISTS stg_data.connector_contracts (
    connector_contract_id BIGSERIAL PRIMARY KEY,
    source_name TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    required_columns JSONB NOT NULL,
    numeric_bounds JSONB NOT NULL DEFAULT '{}'::jsonb,
    unique_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    null_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_name, contract_version)
);

CREATE TABLE IF NOT EXISTS stg_data.pipeline_gate_config (
    gate_config_id BIGSERIAL PRIMARY KEY,
    source_name TEXT NOT NULL,
    gate_name TEXT NOT NULL,
    threshold_value DOUBLE PRECISION,
    threshold_mode TEXT NOT NULL,
    severity TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_name, gate_name)
);
