"""Regression checks for the audited authentication, egress and logging boundaries."""

import logging
import socket
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import httpcore
import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import Settings
from app.core.security import create_access_token, decode_token
from app.db.session import engine
from app.models.user import TradingMode, UserProfile
from app.services import alert_delivery, fyers_headless
from app.services.broker_credentials_store import save_broker_credentials
from app.services.broker_session_store import load_broker_session, save_broker_session
from app.services.session_manager import session_manager
from app.services.token_cache import TokenCache
from tests.conftest import FakeTokenBlocklist, get_test_settings


def headers(**claims: str) -> dict[str, str]:
    payload = {"sub": "TEST_CLIENT_001", "broker": "Fyers", "trading_mode": "paper"}
    payload.update(claims)
    return {"Authorization": "Bearer " + create_access_token(payload, get_test_settings())}


@pytest.mark.asyncio
async def test_recovery_requires_nonrevoked_unexpired_authentication(
    client: httpx.AsyncClient, token_blocklist: FakeTokenBlocklist
) -> None:
    expired = create_access_token(
        {"sub": "TEST_CLIENT_001"}, get_test_settings(), timedelta(seconds=-5)
    )
    revoked = headers()["Authorization"].removeprefix("Bearer ")
    token_blocklist.revoked.add(decode_token(revoked, get_test_settings())["jti"])
    with patch("app.api.v1.auth.load_broker_session") as load:
        for credential, expected in [(None, 403), ("bogus", 401), (expired, 401), (revoked, 401)]:
            request_headers = {"Authorization": f"Bearer {credential}"} if credential else {}
            response = await client.post("/api/v1/auth/auto-login", headers=request_headers)
            assert response.status_code == expected
        load.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [{"sub": "OTHER"}, {"broker": "Dhan"}, {"trading_mode": "live"}])
async def test_recovery_cannot_cross_owner_broker_or_mode(
    client: httpx.AsyncClient, db_session: AsyncSession, claims: dict[str, str]
) -> None:
    await save_broker_session(
        db_session,
        get_test_settings(),
        client_id="TEST_CLIENT_001",
        app_id="app",
        access_token="fixture-token",
        trading_mode=TradingMode.PAPER,
        account_name="Test",
    )
    with patch("app.api.v1.auth.get_fyers_access_token_headless") as login:
        response = await client.post("/api/v1/auth/auto-login", headers=headers(**claims))
        assert response.status_code == 403
        login.assert_not_called()


@pytest.mark.asyncio
async def test_wrong_recovered_profile_does_not_replace_existing_session(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await save_broker_credentials(
        db_session,
        get_test_settings(),
        app_id="app",
        api_secret="fixture-secret",
        client_id="TEST_CLIENT_001",
        totp_secret="fixture-seed",
        pin="1234",
        redirect_uri="https://example.com",
        trading_mode="paper",
    )
    original = AsyncMock()
    await session_manager.set_session("TEST_CLIENT_001", original)
    replacement = AsyncMock()
    replacement.get_profile.return_value = UserProfile("OTHER", "Fyers", TradingMode.PAPER)
    try:
        with (
            patch("app.api.v1.auth.get_fyers_access_token_headless", return_value="fixture-token"),
            patch("app.api.v1.auth.FyersService", return_value=replacement),
        ):
            response = await client.post("/api/v1/auth/auto-login", headers=headers())
        assert response.status_code == 403
        assert session_manager.get_session("TEST_CLIENT_001") is original
        assert await load_broker_session(db_session) is None
        replacement.close.assert_awaited_once()
        original.close.assert_not_awaited()
    finally:
        await session_manager.clear()


@pytest.mark.asyncio
async def test_old_live_token_cannot_trade_against_a_reconnected_paper_service(
    client: httpx.AsyncClient, active_broker_session: AsyncMock
) -> None:
    active_broker_session.trading_mode = TradingMode.PAPER
    response = await client.post(
        "/api/v1/orders",
        headers=headers(trading_mode="live"),
        json={"symbol": "NSE:SBIN-EQ", "quantity": 1, "side": "Buy", "order_type": "MARKET"},
    )
    assert response.status_code == 403
    active_broker_session.place_order.assert_not_awaited()


@pytest.mark.asyncio
async def test_old_account_logout_preserves_other_accounts_persisted_session(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    await save_broker_session(
        db_session,
        get_test_settings(),
        client_id="OTHER",
        app_id="app",
        access_token="fixture-token",
        trading_mode=TradingMode.PAPER,
        account_name="Other",
    )
    response = await client.post("/api/v1/auth/logout", headers=headers())
    assert response.status_code == 200
    record = await load_broker_session(db_session)
    assert record is not None and record.client_id == "OTHER"


@pytest.mark.asyncio
@pytest.mark.parametrize("index", range(6))
async def test_cached_broker_token_requires_all_original_credentials(
    monkeypatch: pytest.MonkeyPatch, index: int
) -> None:
    credentials = ["client", "seed", "1234", "app", "secret", "https://example.com"]
    monkeypatch.setattr(fyers_headless, "broker_token_cache", TokenCache())
    calls = []

    def authenticate(*args: str) -> str:
        calls.append(args)
        if list(args) != credentials:
            raise fyers_headless.BrokerAuthError("Invalid credentials")
        return "fixture-broker-token"

    monkeypatch.setattr(fyers_headless, "_headless_login_sync", authenticate)
    assert (
        await fyers_headless.get_fyers_access_token_headless(*credentials) == "fixture-broker-token"
    )
    assert (
        await fyers_headless.get_fyers_access_token_headless(*credentials) == "fixture-broker-token"
    )
    changed = credentials.copy()
    changed[index] += "-wrong"
    with pytest.raises(fyers_headless.BrokerAuthError):
        await fyers_headless.get_fyers_access_token_headless(*changed)
    assert len(calls) == 2


@pytest.mark.parametrize(
    "secret", ["", "short", "change-this-to-a-secure-random-string-in-production"]
)
def test_signing_secret_cannot_use_shipped_defaults(secret: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, jwt_secret=secret)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "0.0.0.0", "224.0.0.1"],
)
async def test_delivery_rejects_nonpublic_dns_answers(
    monkeypatch: pytest.MonkeyPatch, address: str
) -> None:
    dns = AsyncMock(return_value=[(socket.AF_INET, 1, 6, "", (address, 443))])
    monkeypatch.setattr(alert_delivery.asyncio.get_running_loop(), "getaddrinfo", dns)
    with patch.object(alert_delivery.httpx, "AsyncClient") as client:
        with pytest.raises(ValueError):
            await alert_delivery._post_json("https://hooks.example.com/secret", {})
        client.assert_not_called()


@pytest.mark.asyncio
async def test_delivery_rejects_mixed_dns_and_unsafe_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    dns = AsyncMock(return_value=[(2, 1, 6, "", (ip, 443)) for ip in ("8.8.8.8", "10.0.0.1")])
    monkeypatch.setattr(alert_delivery.asyncio.get_running_loop(), "getaddrinfo", dns)
    for url in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://[fe80::1%25en0]/",
        "https://hooks.example.com",
    ]:
        with pytest.raises(ValueError):
            await alert_delivery._post_json(url, {})


@pytest.mark.asyncio
async def test_delivery_connects_to_validated_ip_with_original_tls_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dns = AsyncMock(return_value=[(2, 1, 6, "", ("8.8.8.8", 443))])
    monkeypatch.setattr(alert_delivery.asyncio.get_running_loop(), "getaddrinfo", dns)
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")

    class Stream:
        request = b""
        sni = None
        response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"

        async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
            result, self.response = self.response, b""
            return result

        async def write(self, buffer: bytes, timeout: float | None = None) -> None:
            self.request += buffer

        async def aclose(self) -> None:
            pass

        async def start_tls(self, ssl_context: object, server_hostname: str, **kwargs: object):
            self.sni = server_hostname
            return self

        def get_extra_info(self, info: str) -> None:
            return None

    stream = Stream()
    connect = AsyncMock(return_value=stream)
    monkeypatch.setattr(httpcore._backends.auto.AutoBackend, "connect_tcp", connect)
    await alert_delivery._post_json("https://hooks.example.com/secret", {"ok": True})
    assert connect.call_args.kwargs["host"] == "8.8.8.8"
    assert stream.sni == "hooks.example.com"
    assert b"Host: hooks.example.com\r\n" in stream.request
    dns.assert_awaited_once()


@pytest.mark.asyncio
async def test_database_diagnostics_hide_sensitive_parameters(
    caplog: pytest.LogCaptureFixture,
) -> None:
    assert engine.sync_engine.hide_parameters
    db = create_async_engine(
        "sqlite+aiosqlite://", echo=True, hide_parameters=engine.sync_engine.hide_parameters
    )
    marker = "fixture-credential-must-not-appear"
    try:
        async with db.connect() as connection:
            await connection.execute(text("SELECT :secret"), {"secret": marker})
            with pytest.raises(DBAPIError) as error:
                await connection.execute(text("SELECT missing(:secret)"), {"secret": marker})
            assert marker not in str(error.value)
        assert marker not in caplog.text
    finally:
        await db.dispose()


@pytest.mark.asyncio
async def test_delivery_failure_logs_omit_exception_urls(caplog: pytest.LogCaptureFixture) -> None:
    from tests.test_alert_delivery import _event

    async def fail() -> None:
        response = httpx.Response(
            401, request=httpx.Request("POST", "https://example.com/botSECRET")
        )
        response.raise_for_status()

    with caplog.at_level(logging.WARNING):
        await alert_delivery._deliver_with_retry("telegram", _event(), fail)
    assert "alert_delivery.failed" in caplog.text
    assert "SECRET" not in caplog.text
    assert "https://" not in caplog.text
