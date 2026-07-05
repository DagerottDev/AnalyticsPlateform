# Database Schema

PostgreSQL 16 with the TimescaleDB extension. Migrations are managed with Alembic
(`backend/alembic/versions/`).

## `market_data`

Historical OHLCV candles, one row per `(trading_symbol, timestamp)`. Converted to a
TimescaleDB hypertable partitioned on `timestamp` (see migration `0001_create_market_data`).

| Column | Type | Notes |
|---|---|---|
| `timestamp` | `timestamptz` | Part of composite primary key |
| `trading_symbol` | `varchar(50)` | Part of composite primary key |
| `open` | `float` | |
| `high` | `float` | |
| `low` | `float` | |
| `close` | `float` | |
| `volume` | `int` | |
| `open_interest` | `int` | |

**Indexes:**
- `ix_market_data_symbol_time` — unique, `(trading_symbol, timestamp)`
- `ix_market_data_timestamp` — `(timestamp)`
- `ix_market_data_trading_symbol` — `(trading_symbol)`

Rows are inserted via `POST /api/v1/historical/backfill` (background job, `INSERT ... ON
CONFLICT DO NOTHING`) and read via `GET /api/v1/historical/ohlcv/{symbol}`. No retention
policy is configured yet — this is a gap to revisit once volume grows.

## Broker sessions

There is no `users`/`accounts` table. Authentication is stateless: `POST /auth/login`
validates credentials directly against the broker's API (Fyers/Zerodha), issues a JWT, and
keeps the live broker client in an in-memory `SessionManager` (`app/services/session_manager.py`)
keyed by `client_id`. Restarting the backend drops all sessions — there is no persistence of
broker credentials or sessions in the database by design (single-account MVP).
