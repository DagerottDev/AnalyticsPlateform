# API Contracts

Frontend/backend interface definitions.

---

## Base URL
`http://localhost:8000/api/v1`

## Authentication

Fyers is the only supported broker, and only one broker session is active at a
time (see `app/services/session_manager.py`). No passwords are stored —
authentication is delegated to Fyers' own OAuth/TOTP flows.

### POST `/auth/login`
Authenticate with Fyers via OAuth redirect (`auth_code`) or headless TOTP
auto-login (`client_id` + `totp_secret` + `pin`) — provide exactly one method.

**Request:**
```json
{
  "app_id": "string (Fyers App ID, e.g. 'XXXXXXXXX-100')",
  "api_secret": "string (Fyers App Secret Key)",
  "redirect_uri": "string (default: http://127.0.0.1:3000)",
  "trading_mode": "paper | live (default: paper)",

  "auth_code": "string (OAuth redirect flow)",

  "client_id": "string (Headless TOTP flow, e.g. 'YR02352')",
  "totp_secret": "string (Headless TOTP flow, Base32)",
  "pin": "string (Headless TOTP flow, 4-digit)"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 28800,
  "user": {
    "client_id": "ABC123",
    "broker_name": "Fyers",
    "trading_mode": "paper",
    "account_name": "Default",
    "connected_at": "2024-01-01T00:00:00+00:00"
  }
}
```

**Errors:** `401` (invalid credentials), `503` (broker API unreachable), `422` (validation)

---

### POST `/auth/auto-login`
Silent login using the TOTP credentials saved (encrypted, in the
`broker_credentials` DB table) from the last successful `/auth/login` call
made with `client_id` + `totp_secret` + `pin`, so the frontend can skip the
manual login form on subsequent startups. No request body. Same response
shape as `/auth/login`. Returns `503` if no TOTP login has ever succeeded.

---

### POST `/auth/logout`
Logout. Requires Bearer token. Client should discard token.

**Response (200):**
```json
{
  "message": "Successfully logged out",
  "client_id": "ABC123"
}
```

---

## User settings

Settings are non-sensitive UI and analytics defaults owned by the authenticated
broker client. Alert-delivery secrets remain on `/alerts/delivery-settings`.

### GET `/settings`

Returns the normalized settings document and `persisted`; a client with no
saved profile receives defaults with `persisted: false`.

### PUT `/settings`

Replaces the full typed settings document. Fields use camelCase and include
appearance/general/notifications/chart, option-chain, Greek-workspace, replay,
analytics, strategy, and alert defaults. Unknown fields, invalid enums,
indicator bounds, duplicate metrics, invalid symbols, and watchlists longer
than twenty entries return `422`.

### DELETE `/settings`

Deletes only the generic settings profile and returns defaults. It does not
delete encrypted alert-delivery channels, broker credentials, sessions, or
orders.

---

## Market Data

Requires Bearer token and an active broker session (established via `/auth/login`).

### GET `/market/instruments/{symbol}`
Active option instruments for an underlying symbol (e.g. `NIFTY`).

**Response (200):**
```json
{
  "instruments": [
    {
      "trading_symbol": "NIFTY24JUL22000CE",
      "symbol": "NIFTY",
      "instrument_type": "OPTIDX",
      "expiry": "25-Jul-2024",
      "strike": 22000.0,
      "option_type": "CE",
      "exchange": "NFO",
      "oi": 125000,
      "oi_change": 4200,
      "oi_change_percent": 3.48
    }
  ]
}
```

Malformed broker instrument rows are omitted rather than returned to the client.

**Errors:** `401` (no active broker session), `503` (broker unavailable)

### GET `/market/expiries/{symbol}`
Sorted list of available expiry dates for a symbol.

**Response (200):**
```json
{
  "expiries": ["25-Jul-2024", "01-Aug-2024"]
}
```

Quote rows are normalized and malformed broker rows are omitted. Fyers live
ticks and quote snapshots do not carry option open interest, so their
`open_interest` value is `0`; option-chain `instrument.oi` is the current
snapshot source used by Dealer Flow when live OI is unavailable.

### GET `/market/quotes?symbols=NIFTY,NIFTY24JUL22000CE`
Live REST price quotes for a comma-separated list of symbols.

**Response (200):**
```json
{
  "quotes": [
    {
      "symbol": "NIFTY",
      "trading_symbol": "NIFTY",
      "last_price": 22050.5,
      "volume": 0,
      "open_interest": 0,
      "change": 12.3,
      "change_percent": 0.056,
      "timestamp": 1721800000
    }
  ]
}
```

### GET `/market/history?symbol=NIFTY&range_from=2026-07-20&range_to=2026-07-20&resolution=1`
Real historical OHLCV candles pulled live from the broker (not the DB-backed
`/historical/ohlcv` below) — used by Replay Mode. `symbol` accepts either a
bare UI symbol (`NIFTY`) or an already Fyers-qualified trading symbol.

**Response (200):**
```json
{
  "candles": [
    {
      "timestamp": "2026-07-20T03:45:00+00:00",
      "open": 22000.0,
      "high": 22010.0,
      "low": 21990.0,
      "close": 22005.0,
      "volume": 1000,
      "open_interest": 0
    }
  ]
}
```

### GET `/market/open-interest/history?symbol=NIFTY&expiry=28-Aug-2026`
Owner-scoped aggregate Call/Put OI snapshots for one expiry's latest recorded
IST session. During regular market hours, requesting an expiry also captures
its current point. `scheduled_tracking` is true for the nearest expiry of a
configured tracked underlying; other expiries begin history on first view.

**Response (200):**
```json
{
  "symbol": "NIFTY",
  "expiry": "28-Aug-2026",
  "session_date": "2026-08-03",
  "baseline": "broker prior-close OI",
  "scheduled_tracking": true,
  "points": [{
    "timestamp": "2026-08-03T04:45:00Z",
    "total_call_oi": 125000,
    "total_put_oi": 140000,
    "total_call_change": 4200,
    "total_put_change": -1800
  }]
}
```

### WS `/market/ws?token={jwt}`
Proxies live Fyers ticks to the browser. The JWT is passed as a query param
since the browser WebSocket API can't set an Authorization header.

Client → server: `{"action": "subscribe" | "unsubscribe", "symbols": [...]}`
Server → client: `{"type": "tick", "data": {...}}`,
`{"type": "info", "message": "..."}`, or recoverable
`{"type": "error", "message": "..."}`. The backend shares one Fyers
stream per broker session and seeds/polls REST quotes when live ticks are not
available.

---

## Historical Data

Requires Bearer token.

### GET `/historical/ohlcv/{symbol}?limit=1000`
Retrieve stored historical OHLCV candles for a symbol from the database
(populated separately; see `app/models/market_data.py`).

**Response (200):**
```json
[
  {
    "timestamp": "2024-07-01T09:15:00+00:00",
    "trading_symbol": "NIFTY24JUL22000CE",
    "open": 100.0,
    "high": 105.0,
    "low": 98.0,
    "close": 102.0,
    "volume": 1200,
    "open_interest": 45000
  }
]
```

---

## Volatility

No authentication required (mock data generator, not yet backed by real broker/history data).

### GET `/volatility/{symbol}/historical?days=252`
Timeseries of implied vs. realized volatility.

**Response (200):**
```json
[
  { "date": "2024-01-02", "iv": 0.152, "rv": 0.138 }
]
```

### GET `/volatility/{symbol}/metrics`
Current IV Rank (IVR) and IV Percentile (IVP), derived from the 1Y historical series.

**Response (200):**
```json
{
  "symbol": "NIFTY",
  "current_iv": 0.16,
  "iv_rank": 42.3,
  "iv_percentile": 55.1,
  "min_iv": 0.08,
  "max_iv": 0.32,
  "data_points": 252
}
```

---

## Basket orders

### POST `/orders/basket`

Live-only multi-leg market entry. Each leg accepts `stop_loss` and
`target_price` as option premium prices. `combined_stop_loss` and
`combined_take_profit` are positive ₹ P&L thresholds for the entire basket.
The response reports `PendingEntry` after broker acceptance; the server arms
the protective stop only after it confirms a fill. The former per-leg
`take_profit` field remains accepted only as a legacy ₹ P&L target.

---

## GTT orders

### `POST /orders/gtt`

Creates a single conditional option-entry order. It accepts `symbol`, `quantity`,
`side`, `product_type`, `execution_type` (`MARKET` or `LIMIT`), `trigger_price`,
`limit_price`, and timezone-aware `expires_at`. The trigger lifetime is separate
from the exchange order's DAY validity after triggering. `GET /orders/gtt` lists
the authenticated owner's records and `DELETE /orders/gtt/{id}` cancels a pending
record.

Fyers GTTs are evaluated by the server while the active owner session is present;
Dhan uses a native Forever Order and the platform cancels it at `expires_at`.

---

## Analysis workspace URLs

`/chain/analysis` and `/chain/premium-analysis` accept `symbol`, `expiry`, and
fixed broker contracts in `contracts` (comma-separated). They also accept an
optional validated `dynamic` parameter for rolling option descriptors:
`CE:ATM:0`, `CE:OTM:1` through `CE:OTM:5`, `CE:ITM:1` through `CE:ITM:5`,
and the corresponding `PE` values. Invalid descriptors are ignored. Dynamic
descriptors resolve to the active expiry's strike ladder on each historical
underlying candle and current live spot tick.

---

## Health

### GET `/health`

**Response (200):**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "environment": "development"
}
```
