"""Pydantic request/response schemas for authentication endpoints.

These schemas define the API contract for Fyers and Dhan authentication.
Only one broker session is active at a time (see app.services.session_manager).
"""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class LoginRequest(BaseModel):
    """Request body for POST /api/v1/auth/login.

    Fyers supports OAuth and TOTP login. Dhan supports the documented Client
    ID plus short-lived access-token authentication flow.
    """

    broker: str = Field(default="fyers", pattern="^(fyers|dhan)$")
    app_id: str | None = Field(default=None, description="Fyers App ID")
    api_secret: str | None = Field(default=None, description="Fyers App Secret Key")
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

    # Dhan manual access-token flow
    access_token: str | None = Field(default=None, description="Dhan access token")

    @model_validator(mode="after")
    def _require_one_auth_method(self) -> "LoginRequest":
        if self.broker == "dhan":
            if not self.client_id or not self.access_token:
                raise ValueError("Dhan login requires 'client_id' and 'access_token'.")
            return self

        has_oauth = bool(self.auth_code)
        has_totp = bool(self.client_id and self.totp_secret and self.pin)
        if not self.app_id or not self.api_secret:
            raise ValueError("Fyers login requires 'app_id' and 'api_secret'.")
        if has_oauth == has_totp:
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
