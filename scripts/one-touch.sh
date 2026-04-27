#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="${1:-config/local.yaml}"

pnpm install
pnpm dev onboard --config "$CONFIG"
pnpm dev check --config "$CONFIG"
pnpm dev write-pi-prompt --config "$CONFIG"

cat <<EOF

One-touch setup finished.

Next dry-run commands:
  pnpm dev once --config $CONFIG
  pnpm dev run --config $CONFIG
  pnpm dev clear-stop --config $CONFIG

Service install:
  pnpm dev install-service --target launchd --config $CONFIG
  pnpm dev install-service --target systemd --config $CONFIG
EOF
