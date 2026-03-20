#!/usr/bin/env bash
set -euo pipefail

# Resolve to the directory this script lives in
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  bun install
fi

# Build frontend
echo "Building frontend..."
bun run build

# Load .env if present
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# Generate auth token if still not set
if [ -z "${AUTH_TOKEN:-}" ]; then
  export AUTH_TOKEN=$(openssl rand -hex 32)
  echo "AUTH_TOKEN=${AUTH_TOKEN}" > "${SCRIPT_DIR}/.env"
  echo "Generated password: ${AUTH_TOKEN}"
  echo "Saved to: ${SCRIPT_DIR}/.env"
fi

# Start server
echo "Starting hypercanvas on port ${PORT:-7888}..."
exec bun server/pty-server.ts
