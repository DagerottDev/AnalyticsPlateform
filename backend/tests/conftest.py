"""Shared pytest fixtures for backend tests.

Provides test client, mock settings, and auth helpers.
"""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.core.security import create_access_token
from app.main import app as fastapi_app
from app.models.user import TradingMode
from app.services.session_manager import session_manager


def get_test_settings() -> Settings:
    """Create test-specific settings."""
    return Settings(
        app_env="development",
        app_debug=True,
        jwt_secret="test-secret-key-for-testing-only",
        jwt_expiry_minutes=60,
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/test_db",
        redis_url="redis://localhost:6379/1",
        cors_origins="http://localhost:3000",
    )


@pytest.fixture
def test_settings() -> Settings:
    """Provide test settings fixture."""
    return get_test_settings()


@pytest.fixture
def app(test_settings: Settings) -> FastAPI:
    """Provide the FastAPI app with settings overridden for the test."""
    fastapi_app.dependency_overrides[get_settings] = lambda: test_settings
    yield fastapi_app
    fastapi_app.dependency_overrides.pop(get_settings, None)


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
    mock.verify_connection.return_value = True
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
