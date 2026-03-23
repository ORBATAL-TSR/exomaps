#!/usr/bin/env bash
# ── launch-chrome.sh ── Open Chrome with GL/Vulkan ANGLE backend ───────────
#
# Purpose: Avoid D3D11/ANGLE WebGL context loss on Windows.
#   D3D11 can trigger a device-lost event when two WebGL contexts exist even
#   briefly (e.g. during star-map → orrery transitions). Using OpenGL or
#   Vulkan as the ANGLE backend bypasses this limitation entirely.
#
# Usage (run from ExoMaps root after LAUNCH.sh):
#   bash launch-chrome.sh              # auto-selects best backend
#   bash launch-chrome.sh --gl        # force OpenGL backend
#   bash launch-chrome.sh --vulkan    # force Vulkan backend
#   bash launch-chrome.sh --d3d11    # fallback to default (for debugging)
#
# Works on: Linux (Chromium/Chrome), macOS (Chrome), Windows (Chrome)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

URL="http://localhost:1420"
ANGLE_BACKEND="gl"  # default: OpenGL (most stable across platforms)

for arg in "$@"; do
  [[ "$arg" == "--gl" ]]     && ANGLE_BACKEND="gl"
  [[ "$arg" == "--vulkan" ]] && ANGLE_BACKEND="vulkan"
  [[ "$arg" == "--d3d11" ]]  && ANGLE_BACKEND="d3d11"
  [[ "$arg" == "--swiftshader" ]] && ANGLE_BACKEND="swiftshader"
done

# Common Chrome flags for WebGL stability:
#   --use-angle=gl          — use OpenGL backend instead of D3D11
#   --use-gl=angle          — ensure ANGLE is used (not native GL)
#   --disable-gpu-sandbox   — (optional) helps on some Linux setups
#   --enable-unsafe-webgpu  — (optional) enable WebGPU if experimenting
CHROME_FLAGS=(
  "--use-angle=${ANGLE_BACKEND}"
  "--use-gl=angle"
  "--disable-gpu-vsync"
  "--disable-frame-rate-limit"
  "--enable-features=Vulkan"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-translate"
  "--disable-extensions"
)

GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
echo -e "${BLUE}━━━ ExoMaps Chrome Launcher ━━━${NC}"
echo -e "  ANGLE backend : ${GREEN}${ANGLE_BACKEND}${NC}"
echo -e "  URL           : ${GREEN}${URL}${NC}"
echo ""

# Detect Chrome executable
CHROME=""
for candidate in \
  "google-chrome" \
  "google-chrome-stable" \
  "chromium" \
  "chromium-browser" \
  "/usr/bin/google-chrome" \
  "/usr/bin/chromium-browser" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
  if command -v "$candidate" &>/dev/null 2>&1 || [[ -f "$candidate" ]]; then
    CHROME="$candidate"
    break
  fi
done

if [[ -z "$CHROME" ]]; then
  echo "ERROR: Chrome/Chromium not found. Install Chrome or set CHROME env var."
  echo "  Set: export CHROME=/path/to/chrome"
  exit 1
fi

echo -e "  Chrome        : ${GREEN}${CHROME}${NC}"
echo ""

exec "$CHROME" "${CHROME_FLAGS[@]}" "$URL"
