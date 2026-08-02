#!/bin/sh

set -eu

# Migrations run once when the API container starts. Compose already waits for
# Postgres' health check, but the retry loop also covers a database that is
# recovering or restarting after a volume upgrade.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-30}"
  retry_delay="${MIGRATION_RETRY_DELAY_SECONDS:-2}"
  attempt=1

  while :; do
    echo "[oap] Applying database migrations (attempt ${attempt}/${max_attempts})..."
    if alembic -c /app/alembic.ini upgrade head; then
      break
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "[oap] Database migrations failed after ${max_attempts} attempts." >&2
      echo "[oap] Check DATABASE_URL and ensure the Postgres service is reachable." >&2
      exit 1
    fi

    attempt=$((attempt + 1))
    sleep "$retry_delay"
  done
fi

exec "$@"
