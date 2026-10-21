# Backend Dockerfile — Multi-stage build
# Stage 1: Install dependencies
FROM python:3.12-slim AS builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN pip install --no-cache-dir poetry==2.4.1

# Copy dependency files
COPY pyproject.toml poetry.lock* ./
COPY vendor/ ./vendor/

# Install dependencies (no dev dependencies in production)
RUN poetry config virtualenvs.in-project true && \
    poetry install --no-interaction --no-ansi --without dev --no-root

# Keep Alembic and its migration scripts in the image so the API can bring a
# fresh database to the current head before serving traffic.
COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini
COPY docker-entrypoint.sh /usr/local/bin/oap-entrypoint.sh
RUN chmod +x /usr/local/bin/oap-entrypoint.sh

# Development image. docker-compose.dev.yml bind-mounts the backend source
# and keeps this virtual environment in a named volume, allowing Uvicorn's
# reloader to restart only the API process after a Python save.
FROM builder AS development

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/oap-entrypoint.sh"]
CMD ["poetry", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/app/app"]

# Stage 2: Production image
FROM python:3.12-slim AS production

WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/alembic /app/alembic
COPY --from=builder /app/alembic.ini /app/alembic.ini
COPY --from=builder /usr/local/bin/oap-entrypoint.sh /usr/local/bin/oap-entrypoint.sh

# Copy application code
COPY app/ ./app/

# Set environment
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

# Expose port
EXPOSE 8000

# Apply migrations before starting the API process.
ENTRYPOINT ["/usr/local/bin/oap-entrypoint.sh"]

# Run with uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
