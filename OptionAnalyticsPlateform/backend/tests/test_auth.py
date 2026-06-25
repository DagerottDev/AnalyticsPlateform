"""Tests for authentication endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.config import Settings
from app.core.security import create_access_token


@pytest.mark.asyncio
async def test_login_success(
    client: AsyncClient,
    mock_openalgo_service: AsyncMock,
) -> None:
    """Login should return JWT token on successful OpenAlgo connection."""
    with patch(
        "app.api.v1.auth.OpenAlgoService",
        return_value=mock_openalgo_service,
    ):
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "api_key": "test-api-key",
                "host": "http://localhost:5000",
                "trading_mode": "paper",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "expires_in" in data
    assert data["user"]["client_id"] == "TEST_CLIENT_001"
    assert data["user"]["broker_name"] == "TestBroker"
    assert data["user"]["trading_mode"] == "paper"


@pytest.mark.asyncio
async def test_login_invalid_trading_mode(client: AsyncClient) -> None:
    """Login should reject invalid trading mode values."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "api_key": "test-api-key",
            "host": "http://localhost:5000",
            "trading_mode": "invalid",
        },
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_login_missing_api_key(client: AsyncClient) -> None:
    """Login should reject requests without an API key."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "host": "http://localhost:5000",
            "trading_mode": "paper",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_me_authenticated(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_settings: Settings,
) -> None:
    """GET /me should return user profile when authenticated."""
    with patch("app.core.security.get_settings", return_value=test_settings):
        response = await client.get(
            "/api/v1/auth/me",
            headers=auth_headers,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["client_id"] == "TEST_CLIENT_001"
    assert data["broker_name"] == "TestBroker"


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient) -> None:
    """GET /me should return 403 without authentication."""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_verify_valid_token(
    client: AsyncClient,
    valid_token: str,
    test_settings: Settings,
) -> None:
    """Token verification should return valid=True for good tokens."""
    with patch("app.api.v1.auth.get_settings", return_value=test_settings):
        response = await client.post(
            "/api/v1/auth/verify",
            json={"token": valid_token},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["payload"] is not None


@pytest.mark.asyncio
async def test_verify_invalid_token(client: AsyncClient) -> None:
    """Token verification should return valid=False for bad tokens."""
    response = await client.post(
        "/api/v1/auth/verify",
        json={"token": "invalid.token.here"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False


@pytest.mark.asyncio
async def test_logout_authenticated(
    client: AsyncClient,
    auth_headers: dict[str, str],
    test_settings: Settings,
) -> None:
    """Logout should succeed when authenticated."""
    with patch("app.core.security.get_settings", return_value=test_settings):
        response = await client.post(
            "/api/v1/auth/logout",
            headers=auth_headers,
        )

    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Successfully logged out"


@pytest.mark.asyncio
async def test_logout_unauthenticated(client: AsyncClient) -> None:
    """Logout should fail without authentication."""
    response = await client.post("/api/v1/auth/logout")
    assert response.status_code == 403
