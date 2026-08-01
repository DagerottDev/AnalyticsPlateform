"""Shared pytest fixtures for backend tests.

Provides test client, mock settings, and auth helpers.
"""

import time
from collections.abc import AsyncGenerator
from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.user import TradingMode
from app.services.lot_size_store import lot_size_store
from app.services.session_manager import session_manager
from app.services.token_blocklist import TokenBlocklist, get_token_blocklist

_TEST_LOT_SIZES = {
    "NIFTY": 65,
    "BANKNIFTY": 30,
    "FINNIFTY": 60,
    "MIDCPNIFTY": 120,
    "SENSEX": 20,
}


@pytest.fixture(autouse=True)
def _seed_lot_size_cache() -> None:
    """Pre-populate the lot size cache so tests never hit the real Fyers
    symbol-master URLs over the network; test_lot_size_store.py covers the
    fetch/parse behavior itself against a mocked transport."""
    previous_sizes, previous_fetched_at = lot_size_store._lot_sizes, lot_size_store._fetched_at
    lot_size_store._lot_sizes = dict(_TEST_LOT_SIZES)
    lot_size_store._fetched_at = time.monotonic()
    yield
    lot_size_store._lot_sizes, lot_size_store._fetched_at = previous_sizes, previous_fetched_at


class FakeTokenBlocklist(TokenBlocklist):
    """In-memory stand-in for RedisTokenBlocklist — the test suite shouldn't
    require a real Redis instance just to exercise the revocation flow."""

    def __init__(self) -> None:
        self.revoked: set[str] = set()

    async def revoke(self, jti: str, expires_at: datetime) -> None:
        self.revoked.add(jti)

    async def is_revoked(self, jti: str) -> bool:
        return jti in self.revoked


def get_test_settings() -> Settings:
    """Create test-specific settings."""
    return Settings(
        app_env="development",
        app_debug=True,
        jwt_secret="test-secret-key-for-testing-only",
        jwt_expiry_minutes=60,
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/test_db",
        cors_origins="http://localhost:3000",
        # Fixed test-only Fernet key so the login/logout flow exercises
        # encrypt/decrypt end-to-end instead of silently no-op'ing.
        broker_token_encryption_key="RE3Kurb2aXAoc60-vTry1BwGmXSpTT7RQeTkewOGVTg=",
    )


@pytest.fixture
def test_settings() -> Settings:
    """Provide test settings fixture."""
    return get_test_settings()


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """In-memory SQLite DB standing in for Postgres in tests that touch
    broker-session persistence, so they don't require a live Postgres
    instance. Real deployments use Postgres (see app.db.session)."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def token_blocklist() -> FakeTokenBlocklist:
    """In-memory JWT revocation blocklist for tests — see FakeTokenBlocklist."""
    return FakeTokenBlocklist()


@pytest.fixture
def app(
    test_settings: Settings, db_session: AsyncSession, token_blocklist: FakeTokenBlocklist
) -> FastAPI:
    """Provide an isolated FastAPI app with test-specific dependencies."""
    test_app = create_app(test_settings)
    test_app.dependency_overrides[get_settings] = lambda: test_settings

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    test_app.dependency_overrides[get_db] = _override_get_db
    test_app.dependency_overrides[get_token_blocklist] = lambda: token_blocklist
    yield test_app
    test_app.dependency_overrides.clear()


@pytest.fixture
async def client(app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def valid_token(test_settings: Settings) -> str:
    """Create a valid JWT token for testing authenticated endpoints."""
    return create_access_token(
        data={
            "sub": "TEST_CLIENT_001",
            "broker": "TestBroker",
            "trading_mode": "paper",
            "account_name": "Default",
            "connected_at": "2024-01-01T00:00:00+00:00",
        },
        settings=test_settings,
    )


@pytest.fixture
def auth_headers(valid_token: str) -> dict[str, str]:
    """Create Authorization headers with a valid JWT token."""
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def access_token(valid_token: str) -> str:
    """Alias for valid_token, for tests that expect an `access_token` fixture."""
    return valid_token


@pytest.fixture
def mock_broker_service() -> AsyncMock:
    """Create a mock broker service that simulates a successful connection."""
    mock = AsyncMock()
    mock.get_profile.return_value = AsyncMock(
        client_id="TEST_CLIENT_001",
        broker_name="TestBroker",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
        funds={"available": 1000000},
        connected_at="2024-01-01T00:00:00+00:00",
        to_jwt_payload=lambda: {
            "sub": "TEST_CLIENT_001",
            "broker": "TestBroker",
            "trading_mode": "paper",
            "account_name": "Default",
            "connected_at": "2024-01-01T00:00:00+00:00",
        },
    )
    mock.close.return_value = None
    return mock


@pytest.fixture
async def active_broker_session() -> AsyncGenerator[AsyncMock, None]:
    """Register a mock broker session for TEST_CLIENT_001 in the session manager.

    Endpoints under /market and /historical look up the caller's broker
    session via `session_manager`, which is only populated by a real
    /auth/login call. Tests that craft a JWT directly need to seed a
    session themselves.
    """
    mock = AsyncMock()
    mock.get_instruments.return_value = [
        {
            "trading_symbol": "NIFTY24JUL22000CE",
            "symbol": "NIFTY",
            "instrument_type": "OPTIDX",
            "expiry": "25-Jul-2024",
            "strike": 22000.0,
            "option_type": "CE",
            "exchange": "NFO",
        }
    ]
    await session_manager.set_session("TEST_CLIENT_001", mock)
    yield mock
    await session_manager.remove_session("TEST_CLIENT_001")
