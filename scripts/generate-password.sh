#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

TOKEN=$(openssl rand -hex 32)

if [ -f "$ENV_FILE" ]; then
  # Replace existing AUTH_TOKEN or append
  if grep -q '^AUTH_TOKEN=' "$ENV_FILE"; then
    sed -i "s/^AUTH_TOKEN=.*/AUTH_TOKEN=${TOKEN}/" "$ENV_FILE"
  else
    echo "AUTH_TOKEN=${TOKEN}" >> "$ENV_FILE"
  fi
else
  echo "AUTH_TOKEN=${TOKEN}" > "$ENV_FILE"
fi

echo "Password: ${TOKEN}"
echo "Saved to: ${ENV_FILE}"
