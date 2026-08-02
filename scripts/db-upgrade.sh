#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repo_root}/docker/docker-compose.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start the local Postgres service." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then retry." >&2
  exit 1
fi

echo "Starting the local Postgres service..."
docker compose -f "$compose_file" up -d postgres

echo "Waiting for Postgres to become ready..."
attempt=1
max_attempts="${DB_READY_MAX_ATTEMPTS:-30}"
while ! docker compose -f "$compose_file" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Postgres did not become ready after ${max_attempts} attempts." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "Applying Alembic migrations..."
cd "$repo_root/backend"
if [ -x .venv/bin/alembic ]; then
  .venv/bin/alembic upgrade head
elif command -v poetry >/dev/null 2>&1; then
  poetry run alembic upgrade head
else
  echo "No backend virtualenv or Poetry installation found." >&2
  echo "Create backend/.venv or install Poetry, then retry." >&2
  exit 1
fi

echo "Database is up to date."
