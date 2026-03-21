#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="hypercanvas"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

# -- Pre-requisite checks --
MISSING=()

command -v bun &>/dev/null      || MISSING+=("bun (https://bun.sh)")
command -v sudo &>/dev/null     || MISSING+=("sudo")
command -v systemctl &>/dev/null || MISSING+=("systemctl (systemd)")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Missing prerequisites:"
  for dep in "${MISSING[@]}"; do
    echo "  - $dep"
  done
  exit 1
fi

echo "All prerequisites met."
echo ""

# Generate .env with auth token if not present
ENV_FILE="${SCRIPT_DIR}/.env"
if [ ! -f "$ENV_FILE" ] || ! grep -q '^AUTH_TOKEN=' "$ENV_FILE"; then
  AUTH_TOKEN=$(openssl rand -hex 32)
  echo "AUTH_TOKEN=${AUTH_TOKEN}" >> "$ENV_FILE"
  echo "Generated password: ${AUTH_TOKEN}"
  echo "Saved to: ${ENV_FILE}"
else
  AUTH_TOKEN=$(grep '^AUTH_TOKEN=' "$ENV_FILE" | cut -d= -f2)
  echo "Using existing password from ${ENV_FILE}"
fi
echo ""

echo "Installing ${SERVICE_NAME} service..."
echo "  Dir:  ${SCRIPT_DIR}"
echo "  User: $(whoami)"

sudo tee "$SERVICE_PATH" > /dev/null <<EOF
[Unit]
Description=Hypercanvas
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/start.sh
Restart=always
RestartSec=5
Environment=PORT=7888

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

echo ""
echo "Done! Check status with: sudo systemctl status ${SERVICE_NAME}"
echo ""
echo "Password: ${AUTH_TOKEN}"
