"""Application configuration using Pydantic Settings.

Environment variables are loaded from .env files and system environment.
All settings are validated at startup.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    app_env: Literal["development", "staging", "production"] = "development"
    app_debug: bool = False
    app_title: str = "Option Analytics Platform"
    app_version: str = "0.1.0"

    # JWT
    jwt_secret: str = "change-this-to-a-secure-random-string-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 480  # 8 hours

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/option_analytics"

    # CORS
    cors_origins: str = "http://localhost:3001"

    # Broker auto-login
    # Fyers access tokens are valid ~24h; caching avoids re-hitting the
    # internal Vagator login endpoints on every /auto-login call, which is
    # what triggers Cloudflare's rate limiting on repeated automated logins.
    broker_token_cache_ttl_seconds: int = 82800  # 23 hours

    # Server-side Fyers credentials for silent auto-login (POST /auth/auto-login).
    # Optional — when unset, the frontend falls back to the manual login form.
    # Never exposed to the browser; kept server-side only, in backend/.env.
    fyers_app_id: str | None = None
    fyers_api_secret: str | None = None
    fyers_client_id: str | None = None
    fyers_totp_secret: str | None = None
    fyers_pin: str | None = None
    fyers_redirect_uri: str = "http://127.0.0.1:3000"
    fyers_trading_mode: Literal["paper", "live"] = "paper"

    @property
    def has_auto_login_credentials(self) -> bool:
        """Whether enough server-side Fyers credentials are configured for auto-login."""
        return bool(
            self.fyers_app_id
            and self.fyers_api_secret
            and self.fyers_client_id
            and self.fyers_totp_secret
            and self.fyers_pin
        )

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse comma-separated CORS origins into a list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.app_env == "development"


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings singleton."""
    return Settings()
