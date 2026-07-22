"""Tests for authentication endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from tests.conftest import get_test_settings


@pytest.mark.asyncio
async def test_login_oauth_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
) -> None:
    """Login via OAuth auth_code should return JWT token on successful broker connection."""
    with (
        patch(
            "app.api.v1.auth.FyersService",
            return_value=mock_broker_service,
        ),
        patch("app.api.v1.auth.fyersModel.SessionModel") as mock_session_model,
    ):
        mock_session_model.return_value.generate_token.return_value = {
            "s": "ok",
            "access_token": "test-oauth-access-token",
        }
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "app_id": "test-app-id-100",
                "api_secret": "test-api-secret",
                "redirect_uri": "http://127.0.0.1:3000",
                "auth_code": "test-auth-code",
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
            return_value="test-headless-access-token",
        ),
    ):
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "app_id": "test-app-id-100",
                "api_secret": "test-api-secret",
                "client_id": "test-client",
                "totp_secret": "test-totp-secret",
                "pin": "1234",
                "trading_mode": "paper",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["client_id"] == "TEST_CLIENT_001"


@pytest.mark.asyncio
async def test_auto_login_not_configured(client: AsyncClient) -> None:
    """Auto-login should 503 when no server-side Fyers credentials are set."""
    response = await client.post("/api/v1/auth/auto-login")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_auto_login_success(
    app: FastAPI,
    mock_broker_service: AsyncMock,
) -> None:
    """Auto-login should return a JWT using server-configured credentials."""
    auto_login_settings = get_test_settings().model_copy(
        update={
            "fyers_app_id": "test-app-id-100",
            "fyers_api_secret": "test-api-secret",
            "fyers_client_id": "test-client",
            "fyers_totp_secret": "test-totp-secret",
            "fyers_pin": "1234",
        }
    )
    app.dependency_overrides[get_settings] = lambda: auto_login_settings

    try:
        with (
            patch("app.api.v1.auth.FyersService", return_value=mock_broker_service),
            patch(
                "app.api.v1.auth.get_fyers_access_token_headless",
                return_value="test-headless-access-token",
            ),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                response = await ac.post("/api/v1/auth/auto-login")
    finally:
        app.dependency_overrides[get_settings] = lambda: get_test_settings()

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
            "app_id": "test-app-id-100",
            "api_secret": "test-api-secret",
            "auth_code": "test-auth-code",
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
            "app_id": "test-app-id-100",
            "api_secret": "test-api-secret",
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
            "app_id": "test-app-id-100",
            "api_secret": "test-api-secret",
            "auth_code": "test-auth-code",
            "client_id": "test-client",
            "totp_secret": "test-totp-secret",
            "pin": "1234",
            "trading_mode": "paper",
        },
    )
    assert response.status_code == 422


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
