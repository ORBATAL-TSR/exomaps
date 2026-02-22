#!/usr/bin/env bash
# ── LAUNCH.sh ── Prune old processes, rebuild client, start server ──
# Usage:  bash LAUNCH.sh [--skip-build]
#
# This script:
#   1. Kills any existing Flask / React dev processes
#   2. Loads environment from .env (never hardcoded)
#   3. Rebuilds the React client (unless --skip-build)
#   4. Starts Flask on port 5000 (serves API + SPA)
#   5. Verifies health
#
# Credentials are loaded ONLY from .env — see .env.example for template.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_BUILD=false
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=true

# ── Colors ────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; NC='\033[0m'

header() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()   { echo -e "  ${RED}✗${NC} $1"; }

# ── 1. Prune ──────────────────────────────────────────────
header "1/5  Pruning old processes"

# Kill Flask
if pgrep -f "python3.*app\.py" > /dev/null 2>&1; then
    pkill -f "python3.*app\.py" 2>/dev/null || true
    sleep 1
    ok "Killed old Flask process(es)"
else
    ok "No Flask processes running"
fi

# Kill React dev server if running
if pgrep -f "react-scripts start" > /dev/null 2>&1; then
    pkill -f "react-scripts start" 2>/dev/null || true
    sleep 1
    ok "Killed old React dev server"
else
    ok "No React dev server running"
fi

# Verify ports are free
if ss -ltnp 2>/dev/null | grep -q ':5000 '; then
    fail "Port 5000 still in use — kill the process manually"
    ss -ltnp | grep ':5000 '
    exit 1
fi
ok "Port 5000 is free"

# ── 2. Environment ───────────────────────────────────────
header "2/5  Loading environment"

ENV_FILE=""
for candidate in "$ROOT_DIR/.env" "$ROOT_DIR/04_INFRA/.env"; do
    if [ -f "$candidate" ]; then
        ENV_FILE="$candidate"
        break
    fi
done

if [ -n "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    ok "Loaded from $ENV_FILE"
else
    warn "No .env file found — using current environment"
    warn "Copy .env.example → .env and fill in passwords"
fi

# ── 3. Build React client ────────────────────────────────
header "3/5  React client"

CLIENT_DIR="$ROOT_DIR/02_CLIENTS/01_WEB"
BUILD_DIR="$CLIENT_DIR/build"

if [ "$SKIP_BUILD" = true ]; then
    if [ -d "$BUILD_DIR" ]; then
        ok "Skipping build (--skip-build), existing build found"
    else
        fail "No build/ directory and --skip-build specified. Run without --skip-build."
        exit 1
    fi
else
    cd "$CLIENT_DIR"

    if [ ! -d "node_modules" ]; then
        echo "  Installing npm dependencies..."
        npm install --legacy-peer-deps --silent 2>&1 | tail -3
        ok "npm install complete"
    fi

    echo "  Building production bundle..."
    npm run build --silent 2>&1 | tail -5
    ok "React build complete → $BUILD_DIR"
    cd "$ROOT_DIR"
fi

# ── 4. Start Flask ───────────────────────────────────────
header "4/5  Starting Flask server"

GATEWAY="$ROOT_DIR/01_SERVICES/01_GATEWAY/app.py"
LOG_FILE="/tmp/exomaps_flask.log"

cd "$ROOT_DIR"
nohup python3 -u "$GATEWAY" > "$LOG_FILE" 2>&1 &
FLASK_PID=$!
echo "$FLASK_PID" > /tmp/exomaps_flask.pid

ok "Flask started (PID $FLASK_PID, log: $LOG_FILE)"

# ── 5. Health check ──────────────────────────────────────
header "5/5  Verifying health"

echo "  Waiting for server..."
for i in $(seq 1 15); do
    if curl -sf http://localhost:5000/api/health > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Test endpoints
PASS=0; TOTAL=0

check() {
    local label="$1" url="$2"
    TOTAL=$((TOTAL + 1))
    HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        ok "$label → 200"
        PASS=$((PASS + 1))
    else
        fail "$label → $HTTP_CODE"
    fi
}

check "SPA root"          "http://localhost:5000/"
check "Client route"      "http://localhost:5000/starmap"
check "API health"        "http://localhost:5000/api/health"
check "Star systems"      "http://localhost:5000/api/world/systems/full"

# Summary
echo ""
if [ "$PASS" -eq "$TOTAL" ]; then
    echo -e "${GREEN}═══════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ExoMaps is live — $PASS/$TOTAL checks passed${NC}"
    echo -e "${GREEN}  http://localhost:5000/${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════${NC}"
else
    echo -e "${RED}═══════════════════════════════════════════${NC}"
    echo -e "${RED}  $PASS/$TOTAL checks passed — review log:${NC}"
    echo -e "${RED}  tail -50 $LOG_FILE${NC}"
    echo -e "${RED}═══════════════════════════════════════════${NC}"
    exit 1
fi
