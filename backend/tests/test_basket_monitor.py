"""Tests for the live-basket monitor loop (per-leg target + combined SL/TP)."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.services import basket_monitor
from app.services.live_basket_store import create_basket, load_open_baskets
from app.services.order_reconciliation import exit_order_tag
from app.services.session_manager import session_manager


def _leg(
    symbol: str, *, entry: float, target: float | None = None, stop_id: str | None = None
) -> dict:
    return {
        "symbol": symbol, "quantity": 50, "side": "Buy", "entry_price": entry,
        "product_type": "INTRADAY", "target": target, "protective_stop_order_id": stop_id,
        "status": "Open", "exit_price": None, "close_reason": None,
        # Every leg placed via place_basket_order has one — see
        # api/v1/orders.py's persisted_legs construction.
        "entry_order_id": f"entry-{symbol}",
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
    service.place_order.return_value = {"id": "exit-a", "message": "Order placed"}
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
    # Tagged so _reconcile_exiting_legs could find this exact attempt in
    # the broker's order book if the call above had raised ambiguously.
    assert exit_order["order_tag"] == exit_order_tag("entry-NFO:A")
    service.cancel_order.assert_awaited_once_with("stop-1")

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Closed"
    assert refreshed.legs[0]["close_reason"] == "Target hit"
    assert refreshed.legs[0]["exit_order_id"] == "exit-a"
    assert refreshed.legs[1]["status"] == "Open"
    assert refreshed.status == "Open"  # basket stays open, one leg remains


@pytest.mark.asyncio
async def test_ambiguous_exit_failure_leaves_the_leg_exiting_not_open_or_closed(
    test_settings: Settings, db_session: AsyncSession
):
    """place_order raising for an exit attempt is ambiguous — it may have
    actually reached the broker before failing. The leg must not be left
    "Open" (a plain retry next tick would just call _exit_leg again
    blindly against the same still-true target, risking a double-exit) nor
    wrongly reported "Closed"."""
    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 160.0}]
    service.place_order.side_effect = TimeoutError("no response from broker")
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[_leg("NFO:A", entry=100.0, target=50.0)],  # pnl = 60 >= 50 -> hits
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Exiting"
    assert refreshed.status == "Open"  # not closed while a leg is unresolved


@pytest.mark.asyncio
async def test_reconcile_exiting_leg_closes_when_the_exit_is_found_in_the_order_book(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    leg = _leg("NFO:A", entry=100.0)
    leg["status"] = "Exiting"
    service.get_orders.return_value = [
        {"id": "real-exit-1", "order_tag": exit_order_tag(leg["entry_order_id"])}
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[leg],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Closed"
    assert refreshed.legs[0]["exit_order_id"] == "real-exit-1"
    assert refreshed.status == "Closed"  # nothing else active — basket closes too
    service.get_quotes.assert_not_awaited()  # nothing "Open" left to evaluate


@pytest.mark.asyncio
async def test_reconcile_exiting_leg_gets_one_bounded_retry_when_not_found(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_orders.return_value = []  # not found (yet)
    # No target/target_price set, so the leg flipped back to "Open" isn't
    # re-evaluated as a fresh exit attempt within this same tick — keeps
    # this test isolated to the reconciliation transition itself.
    leg = _leg("NFO:A", entry=100.0)
    leg["status"] = "Exiting"
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 105.0}]
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[leg],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Open"  # bounced back for one retry
    assert refreshed.legs[0]["exit_reconcile_misses"] == 1
    assert refreshed.status == "Open"
    service.place_order.assert_not_awaited()  # no target set — no fresh exit attempt this tick


@pytest.mark.asyncio
async def test_exiting_leg_reaches_needs_review_after_two_consecutive_misses(
    test_settings: Settings, db_session: AsyncSession
):
    """Regression test for a real bug caught while writing this: the exit
    attempt (_attempt_exit_leg) must NOT reset exit_reconcile_misses back
    to 0 every time it retries, or the miss count could never accumulate
    past 1 — a leg whose exit keeps failing ambiguously would flip
    Exiting -> Open -> Exiting forever instead of ever reaching
    "NeedsReview" and stopping."""
    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 160.0}]
    service.get_orders.return_value = []  # never shows up in the order book
    service.place_order.side_effect = TimeoutError("no response from broker")
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[_leg("NFO:A", entry=100.0, target=50.0)],  # pnl = 60 >= 50 -> hits, every tick
        combined_stop_loss=None, combined_take_profit=None,
    )

    # Tick 1: target hit -> attempt exit -> place_order raises -> "Exiting".
    await basket_monitor.run_basket_monitor(test_settings)
    refreshed = await db_session.get(type(basket), basket.id, populate_existing=True)
    assert refreshed.legs[0]["status"] == "Exiting"

    # Tick 2: reconcile misses once (order book still empty) -> "Open" ->
    # same tick, target still hit -> attempt exit again -> raises -> "Exiting" again.
    await basket_monitor.run_basket_monitor(test_settings)
    refreshed = await db_session.get(type(basket), basket.id, populate_existing=True)
    assert refreshed.legs[0]["status"] == "Exiting"
    assert refreshed.legs[0]["exit_reconcile_misses"] == 1

    # Tick 3: reconcile misses a second time -> NeedsReview, stops retrying.
    await basket_monitor.run_basket_monitor(test_settings)
    refreshed = await db_session.get(type(basket), basket.id, populate_existing=True)
    assert refreshed.legs[0]["status"] == "NeedsReview"
    assert refreshed.legs[0]["exit_reconcile_misses"] == 2
    assert refreshed.status == "Open"  # still not silently closed/abandoned

    # Tick 4: NeedsReview is untouched — no further exit attempts.
    call_count_before = service.place_order.await_count
    await basket_monitor.run_basket_monitor(test_settings)
    assert service.place_order.await_count == call_count_before


@pytest.mark.asyncio
async def test_combined_close_keeps_the_basket_open_when_a_leg_exit_is_ambiguous(
    test_settings: Settings, db_session: AsyncSession
):
    """The combined stop-loss/target close must not mark the whole basket
    Closed while one of its legs failed to exit ambiguously — that would
    stop load_open_baskets from ever surfacing it again, orphaning the
    unresolved leg."""
    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NFO:A", "last_price": 40.0},
        {"trading_symbol": "NFO:B", "last_price": 40.0},
    ]
    call_count = 0

    async def _place_order(order: dict) -> dict:
        nonlocal call_count
        call_count += 1
        if order["symbol"] == "NFO:A":
            raise TimeoutError("no response from broker")
        return {"id": f"exit-{call_count}", "message": "Order placed"}

    service.place_order.side_effect = _place_order
    await session_manager.set_session("TEST_CLIENT_001", service)
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001",
        legs=[
            _leg("NFO:A", entry=100.0),  # pnl = -60 * 50 = -3000
            _leg("NFO:B", entry=100.0),  # pnl = -60 * 50 = -3000, combined = -6000
        ],
        combined_stop_loss=5000, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Exiting"  # ambiguous — not silently Closed
    assert refreshed.legs[1]["status"] == "Closed"
    assert refreshed.status == "Open"  # basket stays open until leg A resolves


@pytest.mark.asyncio
async def test_target_price_exits_buy_and_sell_legs_with_side_aware_comparison(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NFO:BUY", "last_price": 160.0},
        {"trading_symbol": "NFO:SELL", "last_price": 80.0},
    ]
    service.place_order.return_value = {"id": "exit-1", "message": "Order placed"}
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
    service.place_order.return_value = {"id": "exit-1", "message": "Order placed"}
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
    service.place_order.return_value = {"id": "exit-1", "message": "Order placed"}
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
async def test_retries_arming_protective_stop_after_an_earlier_attempt_failed(
    test_settings: Settings, db_session: AsyncSession
):
    """A leg can reach "Open" with its protective stop still unarmed if the
    one placement attempt in _reconcile_pending_entries raised (transient
    broker/network hiccup). It must not be left unprotected forever — the
    next monitor tick should retry."""
    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 105.0}]
    service.place_order.return_value = {"id": "stop-retry-1"}
    await session_manager.set_session("TEST_CLIENT_001", service)
    leg = _leg("NFO:A", entry=100.0)
    leg["stop_loss"] = 90.0  # armed but never actually placed — simulates the prior failure
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[leg],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    service.place_order.assert_awaited_once()
    stop_order = service.place_order.await_args.args[0]
    assert stop_order["symbol"] == "NFO:A"
    assert stop_order["order_type"] == "STOP"
    assert stop_order["stop_price"] == 90.0
    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["protective_stop_order_id"] == "stop-retry-1"


@pytest.mark.asyncio
async def test_does_not_reattempt_a_protective_stop_that_is_already_armed(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NFO:A", "last_price": 105.0}]
    await session_manager.set_session("TEST_CLIENT_001", service)
    leg = _leg("NFO:A", entry=100.0, stop_id="stop-1")
    leg["stop_loss"] = 90.0
    await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[leg],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await basket_monitor.run_basket_monitor(test_settings)

    service.place_order.assert_not_awaited()


@pytest.mark.asyncio
async def test_loop_catches_a_failure_before_the_per_basket_try_except(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
):
    """run_basket_monitor only guards the per-basket body (see the
    try/except around _process_basket inside it) — a failure in the setup
    around it (session_manager, load_open_baskets, the DB session itself)
    used to propagate straight out of basket_monitor_loop's while loop and
    kill the task permanently, silently ending all target/stop-loss
    enforcement for every open basket for the rest of the process's life.
    It must be caught and logged instead of raising out of the loop."""
    stop_event = asyncio.Event()
    calls = {"count": 0}

    async def _boom(settings: Settings) -> None:
        calls["count"] += 1
        stop_event.set()  # stop the loop right after this (failing) tick
        raise RuntimeError("DB connection reset")

    monkeypatch.setattr(basket_monitor, "run_basket_monitor", _boom)

    # Must not raise — the exception is expected to be caught and logged
    # inside the loop, not propagate out of basket_monitor_loop itself.
    await basket_monitor.basket_monitor_loop(test_settings, stop_event)

    assert calls["count"] == 1


@pytest.mark.asyncio
async def test_one_basket_failing_does_not_block_the_rest(
    test_settings: Settings, db_session: AsyncSession
):
    service = AsyncMock()
    service.get_quotes.side_effect = [
        RuntimeError("broker hiccup"),
        [{"trading_symbol": "NFO:B", "last_price": 300.0}],
    ]
    service.place_order.return_value = {"id": "exit-1", "message": "Order placed"}
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
