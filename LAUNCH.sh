#!/usr/bin/env bash
# ── LAUNCH.sh ── Start ExoMaps (Flask API + VITA client) ──────────────────
#
# Usage:
#   bash LAUNCH.sh                  # build VITA + start Flask
#   bash LAUNCH.sh --skip-build     # skip npm build, use existing dist/
#   bash LAUNCH.sh --lan            # also start Caddy/Gunicorn LAN server
#
# For LAN clients: use --lan (requires 07_LOCALRUN/setup.sh run once first)
# For local dev:   omit --lan (uses vite preview on :1420)
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$ROOT_DIR/02_CLIENT/VITA"
GATEWAY="$ROOT_DIR/01_SERVICES/01_GATEWAY/app.py"
LOCALRUN_DIR="$ROOT_DIR/07_LOCALRUN"
LOG_FLASK="/tmp/exomaps_flask.log"
LOG_PREVIEW="/tmp/exomaps_preview.log"

SKIP_BUILD=false
LAN_MODE=false
for arg in "$@"; do
  [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true
  [[ "$arg" == "--lan" ]]        && LAN_MODE=true
done

# ── Colors ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; NC='\033[0m'
header() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()   { echo -e "  ${RED}✗${NC} $1"; }

# ── 1. Prune old processes ────────────────────────────────────────────────
header "1/5  Pruning old processes"

pkill -f "python3.*app\.py"     2>/dev/null && ok "Killed old Flask" || ok "No Flask running"
pkill -f "vite preview"         2>/dev/null && ok "Killed old vite preview" || true
pkill -f "caddy run"            2>/dev/null && ok "Killed old Caddy" || true
pkill -f "gunicorn.*app:app"    2>/dev/null && ok "Killed old Gunicorn" || true

sleep 0.5

if ss -ltnp 2>/dev/null | grep -q ':5000 '; then
  fail "Port 5000 still in use — kill the process manually"
  exit 1
fi
ok "Port 5000 free"

# ── 2. Environment ────────────────────────────────────────────────────────
header "2/5  Loading environment"

for candidate in "$ROOT_DIR/.env" "$ROOT_DIR/04_INFRA/.env"; do
  if [[ -f "$candidate" ]]; then
    set -a; source "$candidate"; set +a
    ok "Loaded $candidate"; break
  fi
done

# ── 3. Build VITA client ──────────────────────────────────────────────────
header "3/5  VITA client"

DIST_DIR="$CLIENT_DIR/dist"

if [[ "$SKIP_BUILD" == true ]]; then
  if [[ -d "$DIST_DIR" ]]; then
    ok "Skipping build (--skip-build), using existing dist/"
  else
    fail "No dist/ found and --skip-build set. Run without --skip-build first."
    exit 1
  fi
else
  cd "$CLIENT_DIR"
  if [[ ! -d "node_modules" ]]; then
    echo "  Installing npm deps..."
    npm install --silent 2>&1 | tail -3
    ok "npm install done"
  fi
  echo "  Building production bundle..."
  npm run build 2>&1 | tail -5
  ok "VITA build complete → $DIST_DIR"
  cd "$ROOT_DIR"
fi

# ── 4. Start Flask ────────────────────────────────────────────────────────
header "4/5  Starting Flask"

nohup python3 -u "$GATEWAY" > "$LOG_FLASK" 2>&1 &
FLASK_PID=$!
echo "$FLASK_PID" > /tmp/exomaps_flask.pid
ok "Flask started (PID $FLASK_PID, log: $LOG_FLASK)"

# ── 5. Start client server ────────────────────────────────────────────────
header "5/5  Starting client server"

if [[ "$LAN_MODE" == true ]]; then
  if [[ ! -f "$LOCALRUN_DIR/certs/exomaps.crt" ]]; then
    fail "No TLS cert — run 07_LOCALRUN/setup.sh first"
    exit 1
  fi
  "$LOCALRUN_DIR/run.sh" &
  ok "LAN server started (Caddy + Gunicorn) — see 07_LOCALRUN/run.sh output"
else
  # Must cd into CLIENT_DIR — vite preview resolves outDir relative to cwd
  nohup bash -c "cd '$CLIENT_DIR' && ./node_modules/.bin/vite preview --host --port 1420" \
    > "$LOG_PREVIEW" 2>&1 &
  PREVIEW_PID=$!
  ok "vite preview started (PID $PREVIEW_PID, log: $LOG_PREVIEW)"
fi

# ── Health check ──────────────────────────────────────────────────────────
echo "  Waiting for Flask..."
for i in $(seq 1 15); do
  curl -sf http://localhost:5000/api/health > /dev/null 2>&1 && break
  sleep 1
done

PASS=0; TOTAL=0
check() {
  local label="$1" url="$2"; TOTAL=$((TOTAL+1))
  HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  [[ "$HTTP" == "200" ]] && { ok "$label → 200"; PASS=$((PASS+1)); } || fail "$label → $HTTP"
}

check "API health"    "http://localhost:5000/api/health"
check "Star systems"  "http://localhost:5000/api/world/systems/full"

# Summary
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || echo "localhost")
echo ""
if [[ "$PASS" -eq "$TOTAL" ]]; then
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ExoMaps is live — $PASS/$TOTAL checks passed${NC}"
  if [[ "$LAN_MODE" == true ]]; then
    echo -e "${GREEN}  https://$LAN_IP   (LAN — Caddy/HTTP2)${NC}"
    echo -e "${GREEN}  https://exomaps.local   (if hosts entry configured)${NC}"
  else
    echo -e "${GREEN}  https://$LAN_IP:1420   (vite preview — HTTPS)${NC}"
  fi
  echo -e "${GREEN}  API: http://localhost:5000${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
else
  echo -e "${RED}  $PASS/$TOTAL checks passed — review logs:${NC}"
  echo -e "${RED}  tail -50 $LOG_FLASK${NC}"
  exit 1
fi
