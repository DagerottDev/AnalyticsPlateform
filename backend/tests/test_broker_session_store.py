"""Tests for persisting the active broker session across process restarts."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BrokerAuthError
from app.models.user import TradingMode
from app.services.broker_session_store import (
    clear_broker_session,
    load_broker_session,
    restore_broker_session,
    save_broker_session,
)
from app.services.session_manager import session_manager
from tests.conftest import get_test_settings


@pytest.mark.asyncio
async def test_save_and_load_roundtrip(db_session: AsyncSession) -> None:
    settings = get_test_settings()
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )

    record = await load_broker_session(db_session)
    assert record is not None
    assert record.client_id == "CLIENT_A"
    assert record.app_id == "APP-100"
    assert record.trading_mode == "paper"


@pytest.mark.asyncio
async def test_access_token_is_encrypted_at_rest(db_session: AsyncSession) -> None:
    """The whole point of encrypting: the raw column value should never
    equal the plaintext token when a key is configured."""
    settings = get_test_settings()
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="super-secret-fyers-token",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )

    record = await load_broker_session(db_session)
    assert record is not None
    assert record.access_token != "super-secret-fyers-token"


@pytest.mark.asyncio
async def test_access_token_stored_plaintext_without_a_configured_key(
    db_session: AsyncSession,
) -> None:
    """Without BROKER_TOKEN_ENCRYPTION_KEY set, saving/restoring still works
    (degraded, not broken) — matches the pre-encryption behavior."""
    settings = get_test_settings().model_copy(update={"broker_token_encryption_key": None})
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )

    record = await load_broker_session(db_session)
    assert record is not None
    assert record.access_token == "token-a"


@pytest.mark.asyncio
async def test_save_replaces_any_prior_session(db_session: AsyncSession) -> None:
    settings = get_test_settings()
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_B",
        app_id="APP-100",
        access_token="token-b",
        trading_mode=TradingMode.LIVE,
        account_name="Default",
    )

    record = await load_broker_session(db_session)
    assert record is not None
    assert record.client_id == "CLIENT_B"


@pytest.mark.asyncio
async def test_load_returns_none_when_nothing_saved(db_session: AsyncSession) -> None:
    assert await load_broker_session(db_session) is None


@pytest.mark.asyncio
async def test_clear_removes_the_session(db_session: AsyncSession) -> None:
    settings = get_test_settings()
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )
    await clear_broker_session(db_session)
    assert await load_broker_session(db_session) is None


@pytest.mark.asyncio
async def test_restore_is_a_noop_when_nothing_persisted(db_session: AsyncSession) -> None:
    settings = get_test_settings()
    await restore_broker_session(db_session, settings)
    assert session_manager.get_session("CLIENT_A") is None


@pytest.mark.asyncio
async def test_restore_reconstructs_a_fresh_session_and_decrypts_the_token(
    db_session: AsyncSession,
) -> None:
    settings = get_test_settings().model_copy(update={"broker_token_cache_ttl_seconds": 3600})
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )

    try:
        with patch("app.services.broker_session_store.FyersService") as mock_fyers_service:
            mock_fyers_service.return_value = AsyncMock()
            await restore_broker_session(db_session, settings)
            mock_fyers_service.assert_called_once_with(
                app_id="APP-100",
                access_token="token-a",  # decrypted back to the original plaintext
                trading_mode=TradingMode.PAPER,
                account_name="Default",
            )
            assert session_manager.get_session("CLIENT_A") is mock_fyers_service.return_value
    finally:
        await session_manager.clear()


@pytest.mark.asyncio
async def test_restore_discards_a_stale_session(db_session: AsyncSession) -> None:
    """A persisted token older than the configured TTL is dropped rather
    than restored — the frontend's existing 401 -> auto-login recovery (or
    the manual login form) takes over instead of handing back a broker
    connection that's almost certainly already dead."""
    settings = get_test_settings().model_copy(update={"broker_token_cache_ttl_seconds": 60})
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )
    # Backdate connected_at past the TTL window.
    record = await load_broker_session(db_session)
    assert record is not None
    record.connected_at = datetime.now(UTC) - timedelta(seconds=120)
    await db_session.commit()

    with patch("app.services.broker_session_store.FyersService") as mock_fyers_service:
        await restore_broker_session(db_session, settings)
        mock_fyers_service.assert_not_called()

    assert session_manager.get_session("CLIENT_A") is None
    assert await load_broker_session(db_session) is None


@pytest.mark.asyncio
async def test_restore_discards_a_persisted_session_rejected_by_the_broker(
    db_session: AsyncSession,
) -> None:
    """A revoked token is cleared before scheduler jobs can hammer Fyers."""
    settings = get_test_settings().model_copy(update={"broker_token_cache_ttl_seconds": 3600})
    await save_broker_session(
        db_session,
        settings,
        client_id="CLIENT_A",
        app_id="APP-100",
        access_token="token-a",
        trading_mode=TradingMode.PAPER,
        account_name="Default",
    )

    service = AsyncMock()
    service.get_profile.side_effect = BrokerAuthError("Fyers session token is invalid or expired")
    service.close.return_value = None
    try:
        with patch(
            "app.services.broker_session_store.FyersService", return_value=service
        ) as mock_fyers_service:
            await restore_broker_session(db_session, settings)
            mock_fyers_service.assert_called_once()

        assert session_manager.get_session("CLIENT_A") is None
        assert await load_broker_session(db_session) is None
        service.close.assert_awaited_once()
    finally:
        await session_manager.clear()
