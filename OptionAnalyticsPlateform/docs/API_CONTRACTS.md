# API Contracts

Frontend/backend interface definitions.

---

## Base URL
`http://localhost:8000/api/v1`

## Authentication

### POST `/auth/login`
Authenticate with Broker API credentials.

**Request:**
```json
{
  "api_key": "string (required)",
  "host": "string (default: http://127.0.0.1:5000)",
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
    "broker_name": "fyers",
    "connected_at": "2024-01-01T00:00:00+00:00"
  }
}
```

**Errors:** `401` (invalid credentials), `503` (Broker API unreachable), `422` (validation)

---

### GET `/auth/me`
Get current user profile. Requires Bearer token.

**Response (200):**
```json
{
  "client_id": "ABC123",
  "broker_name": "Zerodha",
  "trading_mode": "paper",
  "broker_name": "fyers",
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
