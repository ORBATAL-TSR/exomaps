#!/usr/bin/env bash
# Intelligent phase runner wrapper
# Auto-detects services and configures environment
# Usage: bash scripts/run_phase.sh <phase_num> [args...]

set -euo pipefail

phase_num=${1:-}
shift || true
other_args=("$@")

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "$phase_num" ]; then
    echo "Usage: bash scripts/run_phase.sh <1|2|3|4> [args...]"
    exit 1
fi

PHASE_FILE="$ROOT_DIR/scripts/run_phase${phase_num}_pipeline.sh"

if [ ! -f "$PHASE_FILE" ]; then
    echo "Error: $PHASE_FILE not found"
    exit 1
fi

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  EXOMAPS PHASE $phase_num — Auto-Configuring Environment       ║"
echo "╚════════════════════════════════════════════════════════════╝"

# Step 1: Auto-detect services
echo ""
echo "[1/3] Auto-detecting available services..."
python3 -c "
import sys
sys.path.insert(0, '$ROOT_DIR/dbs')

try:
    from service_discovery import ServiceDiscovery
    from config_manager import ConfigManager
    
    # Discover services
    sd = ServiceDiscovery(verbose=True)
    cm = ConfigManager()
    
    # Print detected configuration
    print()
    print('Detected Configuration:')
    print('  POSTGRES_HOST: ' + cm.get('POSTGRES_HOST'))
    print('  POSTGRES_PORT: ' + cm.get('POSTGRES_PORT'))
    print('  REDIS_HOST:    ' + cm.get('REDIS_HOST'))
    
except Exception as e:
    print(f'Warning: {e}', file=sys.stderr)
    sys.exit(0)  # Don't fail on detection issues
"

# Step 2: Export detected environment
echo ""
echo "[2/3] Loading environment variables..."
if [ -f "$ROOT_DIR/.env.auto" ]; then
    # Use auto-detected environment
    export $(cat "$ROOT_DIR/.env.auto" | grep -v '^#' | xargs)
    echo "  ✓ Loaded from .env.auto"
elif [ -f "$ROOT_DIR/.env" ]; then
    # Fallback to manual environment
    export $(cat "$ROOT_DIR/.env" | grep -v '^#' | xargs)
    echo "  ✓ Loaded from .env"
else
    # Use builtin defaults
    export POSTGRES_USER=postgres
    export POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-}
    export POSTGRES_DB=exomaps
    export POSTGRES_HOST=127.0.0.1
    export POSTGRES_PORT=5432
    export APPUSER=appuser
    export APPPASS=${APPPASS:-}
    echo "  ⚠ Using built-in defaults"
fi

# Step 3: Run the phase script
echo ""
echo "[3/3] Executing Phase $phase_num..."
echo ""
bash "$PHASE_FILE" "${other_args[@]}"
