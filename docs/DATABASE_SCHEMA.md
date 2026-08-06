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

## `user_preferences`

One non-sensitive, versioned settings document per authenticated broker client.
`settings` is JSON storage only; the FastAPI/Pydantic settings schema is the
strict validation and normalization boundary. It contains UI defaults,
watchlist/layout preferences, replay configuration, and calculation assumptions
but never credentials, delivery secrets, orders, or broker tokens.

| Column | Type | Notes |
|---|---|---|
| `owner_id` | `varchar(50)` | Primary key; JWT broker-client subject |
| `schema_version` | `int` | Settings document version |
| `settings` | `json` | Validated normalized preferences |
| `updated_at` | `timestamptz` | Last full-profile save |

## `fo_iv_universe_snapshots`

One persisted ATM implied-volatility observation per F&O symbol and trading day. The
scheduled IV-universe worker refreshes the current-day row after its configured freshness
interval and computes rank/percentile from prior observations. Optional historical seeding
uses true daily option candles when the connected broker supports them; it never substitutes
realized volatility while labeling a row as ATM IV.

| Column | Type | Notes |
|---|---|---|
| `symbol` | `varchar(50)` | Part of composite primary key; normalized uppercase underlying |
| `snapshot_date` | `date` | Part of composite primary key |
| `atm_iv` | `float` | Decimal IV, e.g. `0.18` means 18% |
| `spot` | `float` | Underlying close/spot used for the observation; nullable |
| `iv_rank` | `float` | 0–100 rank against prior observations; nullable while building |
| `iv_percentile` | `float` | 0–100 percentile against prior observations; nullable while building |
| `updated_at` | `timestamptz` | Last current-day refresh or seed write |

Migration: `0011_create_fo_iv_universe_snapshots.py`.

**Indexes:**
- composite primary key `(symbol, snapshot_date)`
- `ix_fo_iv_universe_snapshot_symbol_date` for symbol history and latest-row lookup

## NSE participant snapshots

`nse_participant_snapshots` stores one normalized official NSE participant report per
`(trade_date, participant_type)`. `nse_participant_import_state` stores the independent importer
cursor and retry status; it is intentionally separate from broker sessions and user preferences.

| Table | Key columns | Notes |
|---|---|---|
| `nse_participant_snapshots` | `trade_date`, `participant_type` | OI and volume long/short metrics for Client, DII, FII/FPI, and Proprietary categories; updated on retry-safe upsert |
| `nse_participant_import_state` | `source` | Latest successful date, attempt/success timestamps, backfill target/completion, and bounded `last_error` |

Migration: `0016_nse_participant_data.py`.
