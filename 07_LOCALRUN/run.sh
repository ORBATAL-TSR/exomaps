#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ExoMaps LAN Server — start everything
#
# Starts:
#   1. Gunicorn  — multi-threaded Flask gateway on localhost:5000
#   2. Caddy     — HTTPS/HTTP2 reverse proxy on LAN_IP:443
#
# Prerequisites:
#   - Run setup.sh once first
#   - VITA client built: cd ../02_CLIENT/VITA && npm run build
#
# Access:
#   https://exomaps.local        (if dnsmasq / hosts entry configured)
#   https://192.168.1.77         (direct IP — cert covers this too)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load LAN_IP from setup output
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
else
  LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I | awk '{print $1}')
fi

CERTS_DIR="$SCRIPT_DIR/certs"
DIST_DIR="$SCRIPT_DIR/../02_CLIENT/VITA/dist"
GATEWAY_DIR="$SCRIPT_DIR/../01_SERVICES/01_GATEWAY"

# ── Preflight checks ──────────────────────────────────────────────────────
if [[ ! -f "$CERTS_DIR/exomaps.crt" ]]; then
  echo "ERROR: No TLS cert found. Run setup.sh first."
  exit 1
fi

if [[ ! -d "$DIST_DIR" ]]; then
  echo "ERROR: No dist/ build found. Run: cd ../02_CLIENT/VITA && npm run build"
  exit 1
fi

# ── Trap: kill all children on Ctrl+C ────────────────────────────────────
cleanup() {
  echo ""
  echo "→ Shutting down..."
  kill 0
}
trap cleanup INT TERM

# ── 1. Gunicorn (Flask gateway) ───────────────────────────────────────────
echo "→ Starting Gunicorn (Flask) on localhost:5000..."
cd "$GATEWAY_DIR"
gunicorn \
  --config "$SCRIPT_DIR/gunicorn.conf.py" \
  "app:app" \
  &
GUNICORN_PID=$!
echo "  PID: $GUNICORN_PID"

# Give Gunicorn a moment to bind
sleep 1

# ── 2. Caddy (HTTPS/HTTP2 reverse proxy + static files) ──────────────────
echo "→ Starting Caddy on $LAN_IP:443..."
LAN_IP="$LAN_IP" caddy run \
  --config "$SCRIPT_DIR/Caddyfile" \
  --envfile "$SCRIPT_DIR/.env" \
  --adapter caddyfile \
  &
CADDY_PID=$!
echo "  PID: $CADDY_PID"

sleep 1

echo ""
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│  ExoMaps LAN Server running                                      │"
echo "│                                                                  │"
echo "│  https://exomaps.local       (if hosts/dnsmasq configured)      │"
echo "│  https://$LAN_IP            (direct IP)                        │"
echo "│                                                                  │"
echo "│  Gunicorn PID: $GUNICORN_PID   Caddy PID: $CADDY_PID            │"
echo "│  Press Ctrl+C to stop.                                           │"
echo "└──────────────────────────────────────────────────────────────────┘"

wait
