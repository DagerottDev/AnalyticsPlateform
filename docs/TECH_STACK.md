# Locked Tech Stack

## Frontend (`frontend/`)
- Next.js 15 (App Router) + React 19 + TypeScript 5.7
- Tailwind CSS 4
- Zustand 5 — client state (auth, alerts, replay)
- Axios — API client with JWT interceptor
- lightweight-charts 4 — candlestick/volume charting
- Recharts 2 — GEX/vanna/charm/IV surface charts
- Vitest 2 — unit tests

## Backend (`backend/`)
- FastAPI + Uvicorn, Python 3.12+
- Pydantic v2 / pydantic-settings — schemas & config
- SQLAlchemy 2 (async) + asyncpg + Alembic — ORM & migrations
- PostgreSQL 16 + TimescaleDB extension — historical OHLCV storage
- Redis — reserved for session cache / pub-sub (not yet wired into any endpoint)
- python-jose — JWT issuance/verification
- Native broker SDKs: `fyers-apiv3`, `kiteconnect` (Zerodha) — no third-party broker gateway
- Poetry — dependency management
- Ruff + Mypy (strict) — lint/type-check gates in CI
- Pytest + pytest-asyncio — test suite

## Infrastructure
- Docker Compose (`docker/docker-compose.yml`) — postgres, redis, backend, frontend services
- GitHub Actions (`.github/workflows/ci.yml`) — lint, typecheck, test, and docker-build gates for both frontend and backend
