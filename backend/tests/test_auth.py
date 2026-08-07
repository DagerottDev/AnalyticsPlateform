"""Tests for authentication endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, decode_token
from app.models.user import TradingMode
from app.services.broker_credentials_store import load_broker_credentials, save_broker_credentials
from app.services.broker_session_store import save_broker_session
from app.services.session_manager import session_manager
from tests.conftest import FakeTokenBlocklist, get_test_settings


@pytest.mark.asyncio
async def test_login_oauth_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
    db_session: AsyncSession,
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

    # OAuth logins have no TOTP secret/pin to reuse for headless auto-login —
    # nothing should be persisted to broker_credentials.
    assert await load_broker_credentials(db_session, get_test_settings()) is None


@pytest.mark.asyncio
async def test_login_totp_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
    db_session: AsyncSession,
) -> None:
    """Login via headless TOTP auto-login should return JWT token, and persist
    the credentials used (encrypted) as the new source of truth for auto-login."""
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

    creds = await load_broker_credentials(db_session, get_test_settings())
    assert creds is not None
    assert creds.client_id == "test-client"
    assert creds.totp_secret == "test-totp-secret"
    assert creds.pin == "1234"


@pytest.mark.asyncio
async def test_login_dhan_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
) -> None:
    """Dhan accepts its Client ID and access token without Fyers fields."""
    with patch("app.api.v1.auth.DhanService", return_value=mock_broker_service) as dhan_service:
        response = await client.post(
            "/api/v1/auth/login",
            json={
                "broker": "dhan",
                "client_id": "1100000001",
                "access_token": "dhan-access-token",
                "trading_mode": "paper",
            },
        )

    assert response.status_code == 200
    dhan_service.assert_called_once_with(
        client_id="1100000001",
        access_token="dhan-access-token",
        trading_mode=TradingMode.PAPER,
    )


@pytest.mark.asyncio
async def test_auto_login_not_configured(client: AsyncClient) -> None:
    """Auto-login should 503 when no TOTP login has ever succeeded (nothing
    persisted in broker_credentials yet)."""
    response = await client.post("/api/v1/auth/auto-login")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_auto_login_success(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
    db_session: AsyncSession,
) -> None:
    """Auto-login should return a JWT using credentials persisted in the DB
    from a prior successful TOTP login."""
    await save_broker_credentials(
        db_session,
        get_test_settings(),
        app_id="test-app-id-100",
        api_secret="test-api-secret",
        client_id="test-client",
        totp_secret="test-totp-secret",
        pin="1234",
        redirect_uri="http://127.0.0.1:3000",
        trading_mode=TradingMode.PAPER.value,
    )

    with (
        patch("app.api.v1.auth.FyersService", return_value=mock_broker_service),
        patch(
            "app.api.v1.auth.get_fyers_access_token_headless",
            return_value="test-headless-access-token",
        ) as mock_headless,
    ):
        response = await client.post("/api/v1/auth/auto-login")

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["client_id"] == "TEST_CLIENT_001"
    mock_headless.assert_called_once_with(
        client_id="test-client",
        totp_secret="test-totp-secret",
        pin="1234",
        app_id="test-app-id-100",
        app_secret="test-api-secret",
        redirect_uri="http://127.0.0.1:3000",
        ttl_seconds=get_test_settings().broker_token_cache_ttl_seconds,
    )


@pytest.mark.asyncio
async def test_auto_login_reuses_the_active_persisted_session(
    client: AsyncClient,
    mock_broker_service: AsyncMock,
    db_session: AsyncSession,
) -> None:
    await save_broker_session(
        db_session,
        get_test_settings(),
        client_id="TEST_CLIENT_001",
        app_id="test-app-id-100",
        access_token="already-active-token",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )
    await session_manager.set_session("TEST_CLIENT_001", mock_broker_service)

    with patch("app.api.v1.auth.get_fyers_access_token_headless") as headless_login:
        response = await client.post("/api/v1/auth/auto-login")

    assert response.status_code == 200
    assert response.json()["user"]["client_id"] == "TEST_CLIENT_001"
    headless_login.assert_not_called()
    mock_broker_service.close.assert_not_awaited()
    await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_session_status_reuses_active_service_without_replacing_it(
    client: AsyncClient,
    auth_headers: dict[str, str],
    mock_broker_service: AsyncMock,
) -> None:
    await session_manager.set_session("TEST_CLIENT_001", mock_broker_service)

    response = await client.get("/api/v1/auth/session", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["active"] is True
    mock_broker_service.close.assert_not_awaited()
    await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_session_status_reports_a_missing_broker_service(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    await session_manager.clear()

    response = await client.get("/api/v1/auth/session", headers=auth_headers)

    assert response.status_code == 401
    assert response.json()["detail"] == "Active broker session not found"


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


@pytest.mark.asyncio
async def test_logout_revokes_the_token_for_future_requests(
    client: AsyncClient,
    auth_headers: dict[str, str],
    token_blocklist: FakeTokenBlocklist,
) -> None:
    """The actual gap this feature closes: reusing a token after logout must
    now be rejected, not just discarded client-side."""
    logout_response = await client.post("/api/v1/auth/logout", headers=auth_headers)
    assert logout_response.status_code == 200
    assert len(token_blocklist.revoked) == 1

    # Same still-unexpired, still-signature-valid token, reused after logout.
    reused_response = await client.get("/api/v1/portfolio/funds", headers=auth_headers)
    assert reused_response.status_code == 401
    assert reused_response.json()["detail"] == "Token has been revoked"


@pytest.mark.asyncio
async def test_logout_does_not_revoke_other_sessions_token(
    client: AsyncClient,
    token_blocklist: FakeTokenBlocklist,
) -> None:
    """Two independently-issued tokens for the same user must have distinct
    jtis — logging out of one session must not silently revoke the other."""
    settings = get_test_settings()
    token_a = create_access_token(
        data={"sub": "TEST_CLIENT_001", "broker": "TestBroker"}, settings=settings
    )
    token_b = create_access_token(
        data={"sub": "TEST_CLIENT_001", "broker": "TestBroker"}, settings=settings
    )
    assert decode_token(token_a, settings)["jti"] != decode_token(token_b, settings)["jti"]

    await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token_a}"})

    still_valid = await client.get(
        "/api/v1/portfolio/funds", headers={"Authorization": f"Bearer {token_b}"}
    )
    # 401 here would be "no active broker session", not "revoked" — the
    # session-manager check happens inside the endpoint, after
    # get_current_user has already accepted the token.
    assert still_valid.json().get("detail") != "Token has been revoked"


def test_create_access_token_assigns_a_unique_jti() -> None:
    settings = get_test_settings()
    token_a = create_access_token(data={"sub": "X"}, settings=settings)
    token_b = create_access_token(data={"sub": "X"}, settings=settings)
    jti_a = decode_token(token_a, settings)["jti"]
    jti_b = decode_token(token_b, settings)["jti"]
    assert jti_a and jti_b and jti_a != jti_b
