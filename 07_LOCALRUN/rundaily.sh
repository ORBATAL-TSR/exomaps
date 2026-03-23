#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ExoMaps — rundaily.sh
#
# Run once to install everything. After that, the server:
#   - Starts automatically on every OS boot (systemd)
#   - Is checked and relaunched every 15 minutes if it crashed (cron watchdog)
#   - Can be manually restarted: sudo systemctl restart exomaps-lan
#
# Usage: ./rundaily.sh   (will re-exec with sudo if needed)
# ─────────────────────────────────────────────────────────────────────────────

# Resolve absolute path BEFORE any sudo re-exec (relative paths break after exec)
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
SERVICE_NAME="exomaps-lan"

# ── Must run as root ──────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "→ Re-running with sudo..."
  exec sudo bash "$SCRIPT_PATH" "$@"
fi

# Now running as root — safe to use set -e
set -euo pipefail

CURRENT_USER="${SUDO_USER:-$(logname 2>/dev/null || whoami)}"

echo "→ Installing ExoMaps LAN server as a system service"
echo "  Script dir : $SCRIPT_DIR"
echo "  Run as     : $CURRENT_USER"

# ── 1. Write systemd unit ─────────────────────────────────────────────────
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Write to temp file first, then atomic move — avoids partial-write issues
TMP_UNIT=$(mktemp)
cat > "$TMP_UNIT" << EOF
[Unit]
Description=ExoMaps LAN Server (Caddy + Gunicorn)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/run.sh
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

mv "$TMP_UNIT" "$UNIT_FILE"
chmod 644 "$UNIT_FILE"
echo "→ Wrote $UNIT_FILE"

# ── 2. Reload, enable, start ──────────────────────────────────────────────
systemctl daemon-reload
echo "→ daemon-reload complete"

systemctl enable "$SERVICE_NAME"
echo "→ Service enabled (will start on boot)"

# Use 'start' not 'restart' — restart fails if unit was never started before
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl start "$SERVICE_NAME"
echo "→ Service started"

# ── 3. Cron watchdog ──────────────────────────────────────────────────────
CRON_MARKER="# exomaps-lan watchdog"
CRON_JOB="*/15 * * * * systemctl is-active --quiet ${SERVICE_NAME} || systemctl start ${SERVICE_NAME} ${CRON_MARKER}"

( crontab -l 2>/dev/null | grep -v "$CRON_MARKER"; echo "$CRON_JOB" ) | crontab -
echo "→ Cron watchdog installed (every 15 min)"

# ── 4. Status ─────────────────────────────────────────────────────────────
sleep 2
echo ""

if systemctl is-active --quiet "$SERVICE_NAME"; then
  LAN_IP=""
  [[ -f "$SCRIPT_DIR/.env" ]] && LAN_IP=$(grep -E "^LAN_IP=" "$SCRIPT_DIR/.env" | cut -d= -f2) || true
  LAN_IP="${LAN_IP:-$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || echo "your-server-ip")}"

  echo "┌──────────────────────────────────────────────────────────────────┐"
  echo "│  ✓ ExoMaps LAN server is running                                │"
  echo "│                                                                  │"
  echo "│  https://exomaps.local   (if hosts/dnsmasq configured)          │"
  echo "│  https://$LAN_IP                                               │"
  echo "│                                                                  │"
  echo "│  sudo systemctl status ${SERVICE_NAME}                          │"
  echo "│  sudo systemctl restart ${SERVICE_NAME}                         │"
  echo "│  sudo journalctl -u ${SERVICE_NAME} -f                          │"
  echo "└──────────────────────────────────────────────────────────────────┘"
else
  echo "✗ Service failed to start. Diagnose:"
  echo "  sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
  systemctl status "$SERVICE_NAME" --no-pager || true
  exit 1
fi
