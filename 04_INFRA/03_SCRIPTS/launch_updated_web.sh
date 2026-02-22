#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${DBUSER:?DBUSER is required}"
: "${DBPASS:?DBPASS is required}"
: "${DBNAME:?DBNAME is required}"
: "${DBHOST:=127.0.0.1}"
: "${DBPORT:=5432}"
: "${PORT:=5000}"

echo "Launching updated web app on http://127.0.0.1:${PORT}"
python "$ROOT_DIR/src/app/app.py"
