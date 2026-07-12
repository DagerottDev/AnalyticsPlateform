"""Pydantic request/response schemas for authentication endpoints.

These schemas define the API contract for all auth-related operations.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Request body for POST /api/v1/auth/login."""

    broker_name: str = Field(
        ...,
        description="Broker name (fyers or zerodha)",
    )
    app_id: str | None = Field(default=None, description="App ID / Client ID")
    api_key: str | None = Field(default=None, description="API Key")
    api_secret: str | None = Field(default=None, description="API Secret")
    access_token: str | None = Field(default=None, description="Access Token")
    trading_mode: str = Field(
        default="paper",
        pattern="^(paper|live)$",
        description="Trading mode: 'paper' or 'live'",
    )


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
        broker_name: Connected broker name.
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


class AutoLoginRequest(BaseModel):
    """Request body for POST /api/v1/auth/auto-login."""

    broker_name: str = Field(
        default="zerodha",
        pattern="^(zerodha|fyers)$",
        description="Broker name (zerodha or fyers)",
    )
    user_id: str = Field(..., description="Broker User ID")
    password: str | None = Field(default=None, description="Broker Password (required for Zerodha)")
    totp_secret: str = Field(..., description="TOTP Secret for 2FA")
    api_key: str = Field(..., description="Broker API Key / App ID")
    api_secret: str = Field(..., description="Broker API Secret")
    pin: str | None = Field(default=None, description="Security PIN (required for Fyers)")
    redirect_uri: str | None = Field(
        default="https://trade.fyers.in/",
        description="Fyers Redirect URI",
    )
    trading_mode: str = Field(
        default="paper",
        pattern="^(paper|live)$",
        description="Trading mode: 'paper' or 'live'",
    )


class ExchangeCodeRequest(BaseModel):
    """Request body for POST /api/v1/auth/exchange-code."""

    broker_name: str = Field(
        ...,
        pattern="^(zerodha|fyers)$",
        description="Broker name (zerodha or fyers)",
    )
    auth_code: str = Field(
        ...,
        min_length=1,
        description="Authorization code (Fyers) or Request token (Zerodha)",
    )
    api_key: str = Field(..., description="Broker API Key / App ID")
    api_secret: str = Field(..., description="Broker API Secret")
    redirect_uri: str = Field(
        default="http://localhost:3001",
        description="Redirect URI used during authorization",
    )
    trading_mode: str = Field(
        default="paper",
        pattern="^(paper|live)$",
        description="Trading mode: 'paper' or 'live'",
    )


