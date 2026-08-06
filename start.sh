#!/bin/bash

set -euo pipefail

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

# Run the docker-compose stack. --build keeps the migration-aware backend
# entrypoint in sync when the Dockerfile or its scripts change.
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up --build

# Once user hits Ctrl+C to stop
echo ""
echo "🛑 Platform stopped."
