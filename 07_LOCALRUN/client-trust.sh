#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ExoMaps — Install LAN root CA on a client machine
#
# Copy rootCA.pem from the server machine and run this script.
# After running, Chrome/Firefox on this machine will trust exomaps.local
# with a green padlock (no certificate warnings).
#
# Usage:
#   1. On server: scp $(mkcert -CAROOT)/rootCA.pem user@client-machine:~/
#   2. On client: bash client-trust.sh ~/rootCA.pem
#
# Or copy rootCA.pem manually and run with the path as argument.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
CA_FILE="${1:-rootCA.pem}"

if [[ ! -f "$CA_FILE" ]]; then
  echo "ERROR: CA file not found: $CA_FILE"
  echo "Usage: $0 /path/to/rootCA.pem"
  exit 1
fi

echo "→ Installing ExoMaps local CA from: $CA_FILE"

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain "$CA_FILE"
  echo "✓ Installed in macOS System Keychain. Chrome and Safari trust it immediately."

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux — system store
  sudo mkdir -p /usr/local/share/ca-certificates
  sudo cp "$CA_FILE" /usr/local/share/ca-certificates/exomaps-lan.crt
  sudo update-ca-certificates
  echo "✓ Installed in Linux system CA store."
  echo "  Chrome on Linux uses the NSS store — also installing there..."
  if command -v certutil &>/dev/null; then
    for PROFILE in ~/.pki/nssdb ~/.mozilla/firefox/*.default* ~/.mozilla/firefox/*.default-release*; do
      [[ -d "$PROFILE" ]] && certutil -A -n "ExoMaps LAN" -t "CT,," -i "$CA_FILE" -d "sql:$PROFILE" 2>/dev/null && echo "  → $PROFILE"
    done
  else
    echo "  (certutil not found — install libnss3-tools to also trust in Chrome/Firefox NSS)"
  fi

else
  echo "Windows detected (or unknown OS)."
  echo "Manually import $CA_FILE:"
  echo "  1. Double-click rootCA.pem"
  echo "  2. Install Certificate → Local Machine → Trusted Root Certification Authorities"
  echo "  3. Restart Chrome"
fi

echo ""
echo "Add to /etc/hosts for hostname resolution (if not using dnsmasq):"
echo "  echo '$(grep LAN_IP "$(dirname "$0")/.env" 2>/dev/null | cut -d= -f2 || echo "SERVER_IP")  exomaps.local' | sudo tee -a /etc/hosts"
