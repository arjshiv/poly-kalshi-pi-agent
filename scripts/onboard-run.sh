#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="${1:-config/local.yaml}"

pnpm dev supervise --config "$CONFIG"
pnpm dev check --config "$CONFIG"
pnpm dev run --config "$CONFIG"
