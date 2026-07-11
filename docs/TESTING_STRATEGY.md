# Testing Strategy

## Frontend (`frontend/`)
- **Vitest** — unit tests for pure logic: Greeks/Black-Scholes math (`lib/greeks.ts`), strategy
  payoff engine (`lib/strategy.ts`), dealer-flow exposure math, replay engine, alert engine,
  auth store. Run with `npm run test`; CI runs `npm run test -- --reporter=verbose`.
- **Playwright** (planned, not yet implemented) — end-to-end flows (login → option chain →
  strategy builder). No E2E harness exists in the repo today.

## Backend (`backend/`)
- **Pytest** (+ `pytest-asyncio`) — endpoint tests via `httpx.AsyncClient` against the FastAPI
  app (`tests/test_auth.py`, `test_health.py`, `test_market.py`, `test_historical.py`).
  Settings are overridden per-test via FastAPI's `app.dependency_overrides`, not by patching
  module attributes (patching a module-level `get_settings` reference has no effect on a
  `Depends(get_settings)` default already bound at import time).
  `tests/test_historical.py::test_get_historical_ohlcv` requires a live Postgres — it's
  provided by the `postgres` service in CI (`.github/workflows/ci.yml`) and is expected to
  fail locally unless `docker compose up postgres -d` has been run first.
- **Coverage** — `pytest --cov=app --cov-report=term-missing`, uploaded as a CI artifact.

## Not yet implemented
- Performance/load tests.
- Frontend E2E tests (Playwright).
- Contract tests between the documented `API_CONTRACTS.md` shapes and the actual
  Pydantic schemas (currently kept in sync by hand — verify manually when either changes).
