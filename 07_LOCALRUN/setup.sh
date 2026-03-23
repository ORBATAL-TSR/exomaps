#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ExoMaps LAN Setup — run once per machine to install dependencies and
# generate TLS certs trusted by LAN clients.
#
# What this does:
#   1. Detects your LAN IP
#   2. Installs mkcert (local CA tool) if not present
#   3. Installs the mkcert root CA into the local trust store
#   4. Generates a cert valid for: LAN IP + exomaps.local + localhost
#   5. Installs Caddy (HTTP/2 reverse proxy) if not present
#   6. Installs gunicorn + gevent if not present
#
# After running this, distribute the CA root to LAN clients:
#   see: output of `mkcert -CAROOT`
#   copy rootCA.pem to each client and add to browser/OS trust store
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
mkdir -p "$CERTS_DIR"

# ── 1. Detect LAN IP ──────────────────────────────────────────────────────
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || \
         hostname -I 2>/dev/null | awk '{print $1}')
if [[ -z "$LAN_IP" ]]; then
  echo "ERROR: Could not detect LAN IP. Set LAN_IP manually in run.sh."
  exit 1
fi
echo "→ Detected LAN IP: $LAN_IP"

# Save for run.sh to pick up
echo "LAN_IP=$LAN_IP" > "$SCRIPT_DIR/.env"

# ── 2. Install mkcert ─────────────────────────────────────────────────────
if ! command -v mkcert &>/dev/null; then
  echo "→ Installing mkcert..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y libnss3-tools
    # Download latest mkcert binary
    MKCERT_VERSION=$(curl -s https://api.github.com/repos/FiloSottile/mkcert/releases/latest \
      | grep '"tag_name"' | cut -d'"' -f4)
    curl -Lo /tmp/mkcert "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-amd64"
    chmod +x /tmp/mkcert
    sudo mv /tmp/mkcert /usr/local/bin/mkcert
  elif command -v brew &>/dev/null; then
    brew install mkcert nss
  else
    echo "ERROR: Cannot install mkcert automatically. Install manually: https://github.com/FiloSottile/mkcert"
    exit 1
  fi
fi
echo "→ mkcert: $(mkcert --version)"

# ── 3. Install root CA into local trust store ─────────────────────────────
echo "→ Installing local CA (you may be prompted for sudo)..."
mkcert -install

CA_ROOT=$(mkcert -CAROOT)
echo ""
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│  CA root: $CA_ROOT/rootCA.pem"
echo "│"
echo "│  Distribute rootCA.pem to each LAN client machine and import"
echo "│  it into the OS/browser trust store:"
echo "│    Windows: double-click → Install Certificate → Trusted Root CAs"
echo "│    macOS:   sudo security add-trusted-cert -d -r trustRoot \\"
echo "│               -k /Library/Keychains/System.keychain rootCA.pem"
echo "│    Linux:   sudo cp rootCA.pem /usr/local/share/ca-certificates/exomaps.crt"
echo "│             sudo update-ca-certificates"
echo "│    Chrome:  Settings → Privacy → Certificates → Import (if OS trust"
echo "│             store doesn't propagate automatically)"
echo "└─────────────────────────────────────────────────────────────────┘"
echo ""

# ── 4. Generate cert for LAN IP + hostnames ───────────────────────────────
echo "→ Generating TLS cert for: $LAN_IP, exomaps.local, localhost..."
mkcert \
  -cert-file "$CERTS_DIR/exomaps.crt" \
  -key-file  "$CERTS_DIR/exomaps.key" \
  "$LAN_IP" \
  "exomaps.local" \
  "localhost" \
  "127.0.0.1"

echo "→ Certs written to $CERTS_DIR/"

# ── 5. Install Caddy ──────────────────────────────────────────────────────
if ! command -v caddy &>/dev/null; then
  echo "→ Installing Caddy..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update && sudo apt-get install -y caddy
  elif command -v brew &>/dev/null; then
    brew install caddy
  else
    echo "ERROR: Cannot install Caddy automatically. Install from https://caddyserver.com/docs/install"
    exit 1
  fi
fi
echo "→ Caddy: $(caddy version)"

# ── 6. Install gunicorn + gthread worker ─────────────────────────────────
GATEWAY_DIR="$SCRIPT_DIR/../01_SERVICES/01_GATEWAY"
if [[ -f "$GATEWAY_DIR/requirements.txt" ]]; then
  echo "→ Installing Python deps (gunicorn, gevent)..."
  pip install --quiet gunicorn gevent -r "$GATEWAY_DIR/requirements.txt"
else
  pip install --quiet gunicorn gevent
fi

echo ""
echo "✓ Setup complete. Run ./run.sh to start the LAN server."
