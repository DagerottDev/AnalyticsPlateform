#!/bin/bash

set -euo pipefail

MITMWEB_ENABLED="${MITMWEB_ENABLED:-1}"
MITMWEB_PROXY_PORT="${MITMWEB_PROXY_PORT:-8080}"
MITMWEB_WEB_PORT="${MITMWEB_WEB_PORT:-8081}"
MITMWEB_PID=""

stop_mitmweb() {
  if [[ -n "$MITMWEB_PID" ]] && kill -0 "$MITMWEB_PID" 2>/dev/null; then
    kill "$MITMWEB_PID" 2>/dev/null || true
    wait "$MITMWEB_PID" 2>/dev/null || true
  fi
}

trap stop_mitmweb EXIT INT TERM

echo "=============================================="
echo " Starting Option Analytics Platform"
echo "=============================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running."
  echo "Please start Docker Desktop or the Docker daemon and try again."
  exit 1
fi

echo "🚀 Spinning up the local development stack..."
echo "⚡ Frontend and backend changes will hot-reload at http://localhost:3001"
echo ""

if [[ "$MITMWEB_ENABLED" == "1" ]]; then
  if ! command -v mitmweb >/dev/null 2>&1; then
    echo "❌ mitmweb is required for API tracing but was not found."
    echo "Install it with: pipx install mitmproxy"
    echo "Or start without tracing: MITMWEB_ENABLED=0 ./start.sh"
    exit 1
  fi

  echo "🔎 Starting mitmweb API proxy..."
  echo "   Proxy: http://localhost:${MITMWEB_PROXY_PORT} → http://localhost:8001"
  echo "   UI:    http://localhost:${MITMWEB_WEB_PORT}"
  mitmweb \
    --mode "reverse:http://127.0.0.1:8001" \
    --listen-host 127.0.0.1 \
    --listen-port "$MITMWEB_PROXY_PORT" \
    --web-host 127.0.0.1 \
    --web-port "$MITMWEB_WEB_PORT" &
  MITMWEB_PID=$!
  # Compose forwards this into the Next.js client, so both REST and WebSocket
  # calls pass through mitmweb rather than connecting to the backend directly.
  export NEXT_PUBLIC_API_URL="http://localhost:${MITMWEB_PROXY_PORT}"
  echo ""
fi

# Run the docker-compose stack. --build keeps the migration-aware backend
# entrypoint in sync when the Dockerfile or its scripts change.
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up --build

# Once user hits Ctrl+C to stop
echo ""
echo "🛑 Platform stopped."
