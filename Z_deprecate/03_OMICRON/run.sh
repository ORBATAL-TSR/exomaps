#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

MODE="${1:-dev}"

case "$MODE" in
  dev|"")
    echo "→ building debug..."
    cargo build
    echo "→ launching..."
    RUST_LOG=warn ./target/debug/omicron
    ;;
  release|rel)
    echo "→ building release..."
    cargo build --release
    echo "→ launching..."
    RUST_LOG=warn ./target/release/omicron
    ;;
  check)
    cargo check
    ;;
  *)
    echo "usage: ./run.sh [dev|release|check]"
    exit 1
    ;;
esac
