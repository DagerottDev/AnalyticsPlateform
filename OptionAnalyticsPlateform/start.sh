#!/bin/bash

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

echo "🚀 Spinning up infrastructure (PostgreSQL, TimescaleDB, Redis)..."
echo "🚀 Building Backend & Frontend containers..."
echo ""

# Run the docker-compose stack
docker compose -f docker/docker-compose.yml up --build

# Once user hits Ctrl+C to stop
echo ""
echo "🛑 Platform stopped."
