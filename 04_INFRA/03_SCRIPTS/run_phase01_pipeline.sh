#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${APPUSER:=appuser}"
: "${APPPASS:=${APPPASS:-}}"
: "${POSTGRES_HOST:=127.0.0.1}"
: "${POSTGRES_PORT:=5432}"

DATA_DIR="${1:-$ROOT_DIR/data}"

echo "[1/3] Initializing DB schemas + migrations"
python "$ROOT_DIR/dbs/database.py"

echo "[2/3] Running Phase 01 ingestion on $DATA_DIR"
INGEST_OUTPUT=$(python "$ROOT_DIR/dbs/fetch_db/process_rest_csv.py" --data-dir "$DATA_DIR")
echo "$INGEST_OUTPUT"
RUN_ID=$(echo "$INGEST_OUTPUT" | sed -n 's/.*run_id=//p' | tail -1)

if [[ -z "$RUN_ID" ]]; then
  echo "Could not parse run_id from ingestion output" >&2
  exit 1
fi

echo "[3/3] Running reference validation checks for run_id=$RUN_ID"
python "$ROOT_DIR/dbs/fetch_db/reference_checks.py" --run-id "$RUN_ID"

echo "Phase 01 complete. run_id=$RUN_ID"
