"""Session-boundary tests for the server-hosted Fyers GTT monitor."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.services import gtt_monitor
from app.services.session_manager import session_manager


class _SessionContext:
    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(self, *exc_info: object) -> None:
        return None


@pytest.fixture(autouse=True)
async def _clear_broker_session() -> None:
    yield
    await session_manager.clear()


@pytest.mark.asyncio
async def test_fyers_gtt_does_not_evaluate_or_submit_after_fno_close(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = AsyncMock()
    await session_manager.set_session("TEST_CLIENT_001", service)
    order = SimpleNamespace(
        expires_at=datetime.now(UTC) + timedelta(days=1),
        broker_name="fyers",
        symbol="NFO:NIFTY26AUG25000CE",
        trigger_price=100.0,
        side="Buy",
    )
    monkeypatch.setattr(gtt_monitor, "async_session_maker", lambda: _SessionContext())
    monkeypatch.setattr(gtt_monitor.gtt_store, "pending_for_owner", AsyncMock(return_value=[order]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "finish", AsyncMock())
    monkeypatch.setattr(gtt_monitor, "is_regular_market_open", lambda **_: False)

    await gtt_monitor.run_gtt_monitor(test_settings)

    service.get_quotes.assert_not_awaited()
    service.place_order.assert_not_awaited()
    gtt_monitor.gtt_store.finish.assert_not_awaited()
