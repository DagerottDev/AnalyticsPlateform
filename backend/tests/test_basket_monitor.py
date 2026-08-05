"""Tests for the live-basket monitor loop (per-leg target + combined SL/TP)."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.services import basket_monitor
from app.services.live_basket_store import create_basket, load_open_baskets
from app.services.session_manager import session_manager


def _leg(
    symbol: str, *, entry: float, target: float | None = None, stop_id: str | None = None
) -> dict:
    return {
        "symbol": symbol, "quantity": 50, "side": "Buy", "entry_price": entry,
        "product_type": "INTRADAY", "target": target, "protective_stop_order_id": stop_id,
        "status": "Open", "exit_price": None, "close_reason": None,
    }


class _FakeSessionContext:
    """Hands back the shared test db_session instead of opening a new engine
    connection, since the monitor opens its own sessions via
    ``async_session_maker()`` rather than taking one as an argument."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncSession:
        return self._session

    async def __aexit__(self, *exc_info) -> None:
        return None


@pytest.fixture(autouse=True)
def _patch_session_maker(db_session: AsyncSession, monkeypatch):
    monkeypatch.setattr(
        basket_monitor, "async_session_maker", lambda: _FakeSessionContext(db_session)
    )
    monkeypatch.setattr(basket_monitor, "is_regular_market_open", lambda **_: True)


@pytest.fixture(autouse=True)
async def _clear_broker_session():
    yield
    await session_manager.clear()


@pytest.mark.asyncio
async def test_skips_entirely_without_an_active_broker_session(
    test_settings: Settings, db_session: AsyncSession
):
    await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[_leg("NFO:A", entry=100.0)], combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    baskets = await load_open_baskets(db_session)
    assert baskets[0].legs[0]["status"] == "Open"  # untouched


@pytest.mark.asyncio
async def test_does_not_submit_fno_exits_after_market_close(
    test_settings: Settings, db_session: AsyncSession, monkeypatch
):
    service = AsyncMock()
    await session_manager.set_session("TEST_CLIENT_001", service)
    await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[_leg("NFO:A", entry=100.0, target=1.0)],
        combined_stop_loss=None, combined_take_profit=None,
    )
    monkeypatch.setattr(basket_monitor, "is_regular_market_open", lambda **_: False)

    await basket_monitor.run_basket_monitor(test_settings)

    service.get_quotes.assert_not_awaited()
    service.place_order.assert_not_awaited()


@pytest.mark.asyncio
async def test_per_leg_target_hit_exits_that_leg_and_cancels_its_stop(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NFO:A", "last_price": 160.0},
        {"trading_symbol": "NFO:B", "last_price": 105.0},
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[
            _leg("NFO:A", entry=100.0, target=50.0, stop_id="stop-1"),  # pnl = 60 >= 50 -> hits
            _leg("NFO:B", entry=100.0, target=500.0),  # pnl = 5 < 500 -> stays open
        ],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    service.place_order.assert_awaited_once()
    exit_order = service.place_order.await_args.args[0]
    assert exit_order["symbol"] == "NFO:A"
    assert exit_order["side"] == "Sell"
    assert exit_order["order_type"] == "MARKET"
    service.cancel_order.assert_awaited_once_with("stop-1")

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Closed"
    assert refreshed.legs[0]["close_reason"] == "Target hit"
    assert refreshed.legs[1]["status"] == "Open"
    assert refreshed.status == "Open"  # basket stays open, one leg remains


@pytest.mark.asyncio
async def test_target_price_exits_buy_and_sell_legs_with_side_aware_comparison(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NFO:BUY", "last_price": 160.0},
        {"trading_symbol": "NFO:SELL", "last_price": 80.0},
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    buy = _leg("NFO:BUY", entry=100.0)
    buy["target_price"] = 150.0
    sell = _leg("NFO:SELL", entry=100.0)
    sell["side"] = "Sell"
    sell["target_price"] = 90.0
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[buy, sell],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert [leg["status"] for leg in refreshed.legs] == ["Closed", "Closed"]
    assert all(leg["close_reason"] == "Target price hit" for leg in refreshed.legs)


@pytest.mark.asyncio
async def test_pending_entry_is_filled_then_protected_before_monitoring(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_orders.return_value = [{
        "id": "entry-1", "filled_quantity": 50, "remaining_quantity": 0,
        "average_price": 120.0, "status": "TRADED",
    }]
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 125.0}]
    service.place_order.return_value = {"id": "stop-1"}
    await session_manager.set_session("TEST_CLIENT_001", service)
    pending = _leg("NFO:A", entry=0.0)
    pending.update({
        "status": "PendingEntry", "quantity": 0, "requested_quantity": 50,
        "entry_order_id": "entry-1", "stop_loss": 100.0,
    })
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[pending],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Open"
    assert refreshed.legs[0]["quantity"] == 50
    assert refreshed.legs[0]["entry_price"] == 120.0
    assert refreshed.legs[0]["protective_stop_order_id"] == "stop-1"


@pytest.mark.asyncio
async def test_combined_stop_loss_exits_every_open_leg_and_closes_basket(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NFO:A", "last_price": 40.0},
        {"trading_symbol": "NFO:B", "last_price": 60.0},
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[
            _leg("NFO:A", entry=100.0),  # pnl = -60 * 50 = -3000
            _leg("NFO:B", entry=100.0),  # pnl = -40 * 50 = -2000, combined = -5000
        ],
        combined_stop_loss=5000, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    assert service.place_order.await_count == 2
    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.status == "Closed"
    assert refreshed.close_reason == "Combined stop-loss hit"
    assert all(leg["status"] == "Closed" for leg in refreshed.legs)


@pytest.mark.asyncio
async def test_combined_take_profit_closes_basket(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 300.0}]
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[_leg("NFO:A", entry=100.0)],  # pnl = 200 * 50 = 10000
        combined_stop_loss=None, combined_take_profit=10000,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.status == "Closed"
    assert refreshed.close_reason == "Combined target hit"


@pytest.mark.asyncio
async def test_basket_with_all_legs_already_closed_is_closed_without_a_quote_call(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    await session_manager.set_session("TEST_CLIENT_001", service)
    leg = _leg("NFO:A", entry=100.0)
    leg["status"] = "Closed"
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[leg],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    service.get_quotes.assert_not_awaited()
    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.status == "Closed"
    assert refreshed.close_reason == "All legs already closed"


@pytest.mark.asyncio
async def test_one_basket_failing_does_not_block_the_rest(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.side_effect = [
        RuntimeError("broker hiccup"),
        [{"trading_symbol": "NFO:B", "last_price": 300.0}],
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[_leg("NFO:A", entry=100.0)],
        combined_stop_loss=None, combined_take_profit=None,
    )
    healthy = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[_leg("NFO:B", entry=100.0)],
        combined_stop_loss=None, combined_take_profit=5000,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(healthy), healthy.id)
    # the healthy basket's combined take-profit (200*50=10000) still fired
    assert refreshed.status == "Closed"
