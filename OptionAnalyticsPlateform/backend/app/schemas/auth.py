"""Pydantic request/response schemas for authentication endpoints.

These schemas define the API contract for all auth-related operations.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Request body for POST /api/v1/auth/login.

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
    payload: dict | None = None


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
