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

There is no `users`/`accounts` table. `POST /auth/login` validates the connected Fyers or
Dhan account and issues a JWT. `SessionManager` keeps the live, non-serializable broker client
in memory, keyed by `client_id`.

`broker_sessions` stores the one active session's reconstructable data (broker, client ID, app
ID, encrypted access token, mode, account name, and connection time) so startup can restore it.
`broker_credentials` stores encrypted Fyers TOTP credentials for optional auto-login. The live
client itself is always rebuilt in memory; neither table represents a multi-user account system.
