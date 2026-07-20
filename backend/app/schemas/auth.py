"""Pydantic request/response schemas for authentication endpoints.

These schemas define the API contract for all auth-related operations.
Fyers is the only supported broker, and only one broker session is active
at a time (see app.services.session_manager).
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class LoginRequest(BaseModel):
    """Request body for POST /api/v1/auth/login.

    Supports exactly two Fyers authentication methods:
      - OAuth redirect: provide `auth_code` (from the browser redirect).
      - Headless TOTP auto-login: provide `client_id`, `totp_secret`, `pin`.

    Manual access-token paste is intentionally not supported — every login
    goes through one of Fyers' own auth flows so tokens are never
    hand-copied or persisted outside this exchange.
    """

    app_id: str = Field(..., description="Fyers App ID, e.g. 'XXXXXXXXX-100'")
    api_secret: str = Field(..., description="Fyers App Secret Key")
    redirect_uri: str = Field(
        default="http://127.0.0.1:3000",
        description="Redirect URI registered in the Fyers developer dashboard",
    )
    trading_mode: str = Field(
        default="paper",
        pattern="^(paper|live)$",
        description="Trading mode: 'paper' or 'live'",
    )

    # OAuth redirect flow
    auth_code: str | None = Field(
        default=None,
        description="Authorization code JWT from the Fyers OAuth redirect",
    )

    # Headless TOTP auto-login flow
    client_id: str | None = Field(
        default=None, description="Fyers Client ID / User ID, e.g. 'YR02352'"
    )
    totp_secret: str | None = Field(default=None, description="TOTP secret (Base32)")
    pin: str | None = Field(default=None, description="4-digit Fyers security PIN")

    @model_validator(mode="after")
    def _require_one_auth_method(self) -> "LoginRequest":
        has_oauth = bool(self.auth_code)
        has_totp = bool(self.client_id and self.totp_secret and self.pin)
        if has_oauth == has_totp:
            # Neither provided, or both provided — ambiguous either way.
            raise ValueError(
                "Provide either 'auth_code' (OAuth) or 'client_id' + "
                "'totp_secret' + 'pin' (TOTP auto-login), not both."
            )
        return self


class LoginResponse(BaseModel):
    """Response body for successful login.

    Attributes:
        access_token: JWT access token for subsequent requests.
        token_type: Token type (always 'bearer').
        expires_in: Token expiry time in seconds.
        user: User profile information.
    """

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Token expiry in seconds")
    user: "UserProfileResponse"


class UserProfileResponse(BaseModel):
    """User profile in API responses.

    Attributes:
        client_id: Broker client ID.
        broker_name: Connected broker name (always "Fyers").
        trading_mode: Current trading mode.
        account_name: Associated account name.
        connected_at: Connection timestamp.
    """

    client_id: str
    broker_name: str
    trading_mode: str
    account_name: str
    connected_at: datetime


class TokenVerifyRequest(BaseModel):
    """Request body for POST /api/v1/auth/verify.

    Attributes:
        token: JWT token to verify.
    """

    token: str = Field(..., min_length=1, description="JWT token to verify")


class TokenVerifyResponse(BaseModel):
    """Response body for token verification.

    Attributes:
        valid: Whether the token is valid.
        payload: Decoded token payload (only if valid).
    """

    valid: bool
    payload: dict[str, Any] | None = None


class AuthErrorResponse(BaseModel):
    """Standard error response for auth failures.

    Attributes:
        detail: Human-readable error message.
        error_type: Machine-readable error classification.
    """

    detail: str
    error_type: str = "auth_error"


class HealthResponse(BaseModel):
    """Health check response.

    Attributes:
        status: Service status ('healthy' or 'unhealthy').
        version: Application version string.
        environment: Current environment name.
    """

    status: str = "healthy"
    version: str
    environment: str
