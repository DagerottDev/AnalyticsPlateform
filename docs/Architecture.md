# Architecture

## Frontend

- Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS.
- Zustand owns local auth, alert, replay, and UI state. Settings keep a versioned local fallback for startup and sync a validated profile to the authenticated broker client through the shared API client.
- Lightweight Charts renders OHLCV views; Recharts renders Dealer Flow and volatility views.
- A browser WebSocket connects to the backend market-stream proxy. REST quote seeding and polling provide a resilience fallback.

## Backend

- FastAPI with Pydantic v2 request/response schemas and SQLAlchemy 2 async mappings.
- Connected Fyers or Dhan sessions remain server-side; the browser receives only the application JWT and normalized market data.
- The backend validates and normalizes broker payloads at API boundaries, persists journals/alerts/snapshots, and runs alert/backfill background loops.

## Analytics and storage

- TypeScript handles interactive chart, strategy, replay, and Dealer Flow calculations; Python handles server-side Greeks, volatility, alert evaluation, and persistence jobs.
- PostgreSQL with TimescaleDB stores historical OHLCV, daily volatility snapshots, and the
  F&O IV-universe snapshots consumed by the screener. A bounded background worker refreshes
  current-day ATM-IV rows and, when the broker supports option candles (currently Fyers),
  seeds prior true ATM-IV observations. A separate broker-independent participant worker reads
  official NSE HTTPS archive reports, persists daily OI/volume snapshots, and records retry state
  without fabricating intraday values. Redis supports token revocation and is provisioned through
  Docker Compose.

## Deployment

- Docker Compose provides PostgreSQL, Redis, backend, and frontend services locally.
- GitHub Actions runs frontend lint/type/test/build checks and backend Ruff, Mypy, and Pytest checks.
