#!/bin/bash
set -e

# OpenClaw Relay Server Deployment Script
# Usage: ./deploy.sh <device-token>
#
# This script deploys the Relay Server to the remote server.
# It assumes:
# - SSH access to root@47.89.181.91 with SSH key configured
# - Docker and Docker Compose installed on the server

DEVICE_TOKEN="${1:-}"
RELAY_DIR="/opt/openclaw-relay"
GITHUB_REPO="https://github.com/chxdongcool-commits/cherome_siderbarV1.0.git"

echo "=== OpenClaw Relay Server Deployment ==="

if [ -z "$DEVICE_TOKEN" ]; then
  echo "Usage: $0 <device-token>"
  echo ""
  echo "ERROR: DEVICE_TOKEN is required"
  echo "If you don't have a device token, run the pairing flow first:"
  echo "  docker run --rm -it openclaw-relay node dist/main.js"
  exit 1
fi

echo "Step 1: Connecting to server..."

ssh -o StrictHostKeyChecking=no root@47.89.181.91 << 'ENDSSH'
  set -e

  RELAY_DIR="/opt/openclaw-relay"
  DEVICE_TOKEN="$1"

  echo "Step 2: Creating directory structure..."
  mkdir -p "$RELAY_DIR"

  echo "Step 3: Cloning/updating repository..."
  if [ -d "$RELAY_DIR/.git" ]; then
    cd "$RELAY_DIR"
    git pull origin main
  else
    git clone https://github.com/chxdongcool-commits/cherome_siderbarV1.0.git "$RELAY_DIR"
    cd "$RELAY_DIR"
  fi

  echo "Step 4: Building Docker image..."
  cd "$RELAY_DIR/relay-server"
  docker build -t openclaw-relay .

  echo "Step 5: Creating config file..."
  cat > "$RELAY_DIR/relay-server/config.yaml" << 'EOFCONFIG'
gateway:
  host: 127.0.0.1
  port: 18789
pairing:
  apiBase: http://127.0.0.1:18789
relay:
  host: 0.0.0.0
  port: 18791
  tls:
    enabled: false
heartbeat:
  extIntervalMs: 30000
  extTimeoutMs: 60000
  gwIntervalMs: 15000
  gwTimeoutMs: 45000
EOFCONFIG

  echo "Step 6: Stopping existing container..."
  cd "$RELAY_DIR/relay-server"
  docker compose down || true

  echo "Step 7: Starting new container with device token..."
  DEVICE_TOKEN="$DEVICE_TOKEN" docker compose up -d

  echo "Step 8: Checking container health..."
  sleep 5
  docker logs openclaw-relay --tail 50

  echo ""
  echo "=== Deployment Complete ==="
  echo "Relay server running on port 18791"
  echo "Health check: http://47.89.181.91:18791/health"
ENDSSH

echo ""
echo "=== Deployment Complete ==="
echo "Next steps:"
echo "1. Configure Nginx to forward WSS from port 18790 to 18791"
echo "2. Or use TLS directly on port 18791"
echo ""
echo "To check logs: ssh root@47.89.181.91 'docker logs -f openclaw-relay'"
