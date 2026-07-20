"""Tests for authentication endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_oauth_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
) -> None:
    """Login via OAuth auth_code should return JWT token on successful broker connection."""
    with patch(
        "app.api.v1.auth.FyersService",
        return_value=mock_broker_service,
    ):
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "app_id": "mock-app-id-100",
                "api_secret": "mock-secret",
                "redirect_uri": "http://127.0.0.1:3001",
                "auth_code": "mock",
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
async def test_login_totp_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
) -> None:
    """Login via headless TOTP auto-login should return JWT token."""
    with (
        patch(
            "app.api.v1.auth.FyersService",
            return_value=mock_broker_service,
        ),
        patch(
            "app.api.v1.auth.get_fyers_access_token_headless",
            return_value="mock_fyers_access_token_12345",
        ),
    ):
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "app_id": "mock-app-id-100",
                "api_secret": "mock-secret",
                "client_id": "mock",
                "totp_secret": "mock-totp-secret",
                "pin": "1234",
                "trading_mode": "paper",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["client_id"] == "TEST_CLIENT_001"


@pytest.mark.asyncio
async def test_login_invalid_trading_mode(client: AsyncClient) -> None:
    """Login should reject invalid trading mode values."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "app_id": "mock-app-id-100",
            "api_secret": "mock-secret",
            "auth_code": "mock",
            "trading_mode": "invalid",
        },
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_login_requires_one_auth_method(client: AsyncClient) -> None:
    """Login should reject requests with neither auth_code nor TOTP fields."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "app_id": "mock-app-id-100",
            "api_secret": "mock-secret",
            "trading_mode": "paper",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_login_rejects_both_auth_methods(client: AsyncClient) -> None:
    """Login should reject requests providing both auth_code and TOTP fields."""
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "app_id": "mock-app-id-100",
            "api_secret": "mock-secret",
            "auth_code": "mock",
            "client_id": "mock",
            "totp_secret": "mock-totp-secret",
            "pin": "1234",
            "trading_mode": "paper",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_me_authenticated(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    """GET /me should return user profile when authenticated."""
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
) -> None:
    """Token verification should return valid=True for good tokens."""
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
) -> None:
    """Logout should succeed when authenticated."""
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
