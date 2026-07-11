# API Contracts

Frontend/backend interface definitions.

---

## Base URL
`http://localhost:8000/api/v1`

## Authentication

### POST `/auth/login`
Authenticate with native broker credentials (Fyers or Zerodha). No passwords —
the broker's own API validates the credentials.

**Request:**
```json
{
  "broker_name": "fyers | zerodha (required)",
  "app_id": "string (Fyers app/client ID, optional)",
  "api_key": "string (Zerodha API key, optional)",
  "api_secret": "string (optional, currently unused)",
  "access_token": "string (broker access token, optional)",
  "trading_mode": "paper | live (default: paper)"
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
    "broker_name": "Zerodha",
    "trading_mode": "paper",
    "account_name": "Default",
    "connected_at": "2024-01-01T00:00:00+00:00"
  }
}
```

**Errors:** `400` (unsupported broker), `401` (invalid credentials), `503` (broker API unreachable), `422` (validation)

---

### GET `/auth/me`
Get current user profile. Requires Bearer token.

**Response (200):**
```json
{
  "client_id": "ABC123",
  "broker_name": "Zerodha",
  "trading_mode": "paper",
  "account_name": "Default",
  "connected_at": "2024-01-01T00:00:00+00:00"
}
```

---

### POST `/auth/verify`
Verify a JWT token.

**Request:**
```json
{
  "token": "eyJhbGci..."
}
```

**Response (200):**
```json
{
  "valid": true,
  "payload": { "sub": "ABC123", "broker": "Zerodha", ... }
}
```

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
      "exchange": "NFO"
    }
  ]
}
```

**Errors:** `401` (no active broker session), `500`

### GET `/market/expiries/{symbol}`
Sorted list of available expiry dates for a symbol.

**Response (200):**
```json
{
  "expiries": ["25-Jul-2024", "01-Aug-2024"]
}
```

---

## Historical Data

Requires Bearer token.

### POST `/historical/backfill`
Trigger a background job to backfill OHLCV data for a symbol into the database.

**Request:**
```json
{
  "symbol": "NIFTY24JUL22000CE",
  "from_date": "2024-07-01",
  "to_date": "2024-07-05",
  "resolution": "1"
}
```

**Response (200):**
```json
{
  "message": "Backfill job started for NIFTY24JUL22000CE from 2024-07-01 to 2024-07-05",
  "records_inserted": 0
}
```

### GET `/historical/ohlcv/{symbol}?limit=1000`
Retrieve stored historical OHLCV candles for a symbol.

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
