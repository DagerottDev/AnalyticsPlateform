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
    log_level: str = "INFO"
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0

    # JWT
    jwt_secret: str = "change-this-to-a-secure-random-string-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 480  # 8 hours

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/option_analytics"

    # Backs the JWT revocation blocklist (see app.services.token_blocklist) so
    # logout can actually invalidate a token instead of relying on the client
    # to discard it. localhost:6380 matches docker-compose's host-exposed port.
    redis_url: str = "redis://localhost:6380/0"

    # CORS
    cors_origins: str = "http://localhost:3001"

    # How often the /market/ws proxy re-polls REST quotes for subscribed
    # symbols as a resilience fallback (see market_ws's poller()). Fyers'
    # quotes endpoint rate-limits aggressively per app, so this shouldn't be
    # pushed much below a few seconds, especially with several tickers/pages
    # open concurrently, each holding their own subscription.
    market_quote_poll_interval_seconds: float = 3.0

    # API protection before requests can reach Fyers. Values are per client
    # IP per fixed window. Broker-heavy routes still have a guard, but the
    # previous 30-request budget was too small for normal option-chain and
    # Greek-workspace navigation (one screen can legitimately make several
    # instruments, expiries, history, and portfolio calls).
    # Quote snapshots have their own higher budget: they are lightweight and
    # power time-sensitive UI recovery, unlike history/chain broker reads.
    api_rate_limit_enabled: bool = True
    api_rate_limit_window_seconds: float = 60.0
    api_rate_limit_default_requests: int = 120
    api_rate_limit_broker_requests: int = 120
    api_rate_limit_quote_requests: int = 120
    api_rate_limit_auth_requests: int = 10

    # Daily OHLCV persistence. The job starts on application startup and
    # re-runs at this interval, using a small overlap to update the latest
    # candle without duplicating rows.
    market_data_backfill_enabled: bool = True
    market_data_backfill_symbols: str = "NIFTY,BANKNIFTY"
    market_data_backfill_interval_seconds: float = 3600.0
    market_data_backfill_initial_lookback_days: int = 365
    market_data_backfill_overlap_days: int = 7

    # Expiry-level Call/Put OI history is broker-snapshot data rather than
    # historical candles. Capture only the nearest expiry for the existing
    # tracked underlyings to stay within option-chain broker limits.
    open_interest_snapshot_enabled: bool = True
    open_interest_snapshot_interval_seconds: float = 30.0
    open_interest_snapshot_retention_trading_days: int = 30

    # Durable alerts are evaluated by the API process even while no browser
    # tab is open. Keep this comfortably above a broker quote burst interval.
    alert_evaluation_enabled: bool = True
    alert_evaluation_interval_seconds: float = 15.0

    # Daily ATM-IV/IV-Rank/IV-Percentile persistence across every NSE F&O
    # stock, powering the IV screener. Run after the extended F&O session
    # closes (15:40 IST) so interactive option chains and live quote fallback
    # retain broker capacity during market hours.
    iv_universe_backfill_enabled: bool = True
    iv_universe_backfill_hour_ist: int = 16
    iv_universe_backfill_minute_ist: int = 0
    iv_universe_backfill_retry_seconds: float = 300.0
    # Retained for environment-file compatibility; the scheduler is now
    # wall-clock based rather than interval based.
    iv_universe_backfill_interval_seconds: float = 1800.0
    iv_universe_backfill_symbol_delay_seconds: float = 0.35
    iv_universe_snapshot_refresh_interval_seconds: float = 24 * 60 * 60
    # Fyers can provide daily candles for exchange-qualified option symbols.
    # The optional seed fills prior ATM-IV observations so rank/percentile do
    # not need to wait a full month after first deployment. It is capped per
    # cycle to keep history calls below broker limits; brokers without option
    # history safely skip this path.
    iv_universe_historical_seed_enabled: bool = True
    iv_universe_historical_seed_lookback_days: int = 60
    iv_universe_historical_seed_symbols_per_cycle: int = 12

    # NSE publishes F&O participant-wise OI and volume after the trading day.
    # This collector is exchange-data based and never uses broker APIs.
    participant_data_enabled: bool = True
    participant_data_poll_interval_seconds: float = 1800.0
    participant_data_history_days: int = 366
    participant_data_backfill_batch_size: int = 8
    participant_data_request_delay_seconds: float = 0.5

    # Watches open live basket orders for per-leg targets and combined
    # stop-loss/target (see app.services.basket_monitor). Unlike the
    # read-only jobs above, this actively exits real positions, so it polls
    # much more frequently — it is the only thing enforcing those exits, so
    # if this job or the process itself is down, they simply will not fire.
    basket_monitor_enabled: bool = True
    basket_monitor_interval_seconds: float = 10.0

    # How long an "Unknown" GTT order (broker call raised, but may have
    # actually been accepted — see order_reconciliation.py) is retried
    # against the broker's order book before giving up and marking it
    # "Failed" for real. Tagged placements should show up in the order book
    # within seconds of actually succeeding, so this is generous headroom
    # for a slow broker response, not an expectation it normally takes this long.
    order_reconciliation_timeout_seconds: float = 120.0

    alert_smtp_host: str | None = None
    alert_smtp_port: int = 587
    alert_smtp_username: str | None = None
    alert_smtp_password: str | None = None
    alert_smtp_from: str | None = None
    alert_smtp_starttls: bool = True

    # Broker auto-login
    # Fyers access tokens are valid ~24h; caching avoids re-hitting the
    # internal Vagator login endpoints on every /auto-login call, which is
    # what triggers Cloudflare's rate limiting on repeated automated logins.
    broker_token_cache_ttl_seconds: int = 82800  # 23 hours

    # Encrypts the broker access token before it's persisted to the
    # broker_sessions table (see app.core.crypto). A urlsafe-base64 Fernet
    # key — generate one with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # Left unset, the token is stored in plaintext (with a startup warning).
    broker_token_encryption_key: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        """Parse comma-separated CORS origins into a list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.app_env == "development"

    @property
    def market_data_backfill_symbol_list(self) -> list[str]:
        """Configured UI symbols for scheduled daily-candle persistence."""
        return [
            symbol.strip().upper()
            for symbol in self.market_data_backfill_symbols.split(",")
            if symbol.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings singleton."""
    return Settings()
