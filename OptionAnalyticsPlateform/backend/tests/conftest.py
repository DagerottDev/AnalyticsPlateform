"""Shared pytest fixtures for backend tests.

Provides test client, mock settings, and auth helpers.
"""

from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.core.security import create_access_token
from app.main import app


def get_test_settings() -> Settings:
    """Create test-specific settings."""
    return Settings(
        app_env="development",
        app_debug=True,
        jwt_secret="test-secret-key-for-testing-only",
        jwt_expiry_minutes=60,
        openalgo_host="http://localhost:5000",
        openalgo_api_key="test-api-key",
        database_url="postgresql+asyncpg://postgres:postgres@localhost:5432/test_db",
        redis_url="redis://localhost:6379/1",
        cors_origins="http://localhost:3000",
    )


@pytest.fixture
def test_settings() -> Settings:
    """Provide test settings fixture."""
    return get_test_settings()


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
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
            "openalgo_host": "http://localhost:5000",
            "connected_at": "2024-01-01T00:00:00+00:00",
        },
        settings=test_settings,
    )


@pytest.fixture
def auth_headers(valid_token: str) -> dict[str, str]:
    """Create Authorization headers with a valid JWT token."""
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def mock_openalgo_service() -> AsyncMock:
    """Create a mock OpenAlgo service that simulates successful connections."""
    mock = AsyncMock()
    mock.verify_connection.return_value = True
    mock.get_profile.return_value = AsyncMock(
        client_id="TEST_CLIENT_001",
        broker_name="TestBroker",
        trading_mode="paper",
        openalgo_host="http://localhost:5000",
        funds={"available": 1000000},
        connected_at="2024-01-01T00:00:00+00:00",
        to_jwt_payload=lambda: {
            "sub": "TEST_CLIENT_001",
            "broker": "TestBroker",
            "trading_mode": "paper",
            "openalgo_host": "http://localhost:5000",
            "connected_at": "2024-01-01T00:00:00+00:00",
        },
    )
    mock.close.return_value = None
    return mock
