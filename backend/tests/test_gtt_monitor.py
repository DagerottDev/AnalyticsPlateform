"""Session-boundary tests for the server-hosted Fyers GTT monitor."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.config import Settings
from app.services import gtt_monitor
from app.services.order_reconciliation import gtt_order_tag
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
    monkeypatch.setattr(gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "pending_for_owner", AsyncMock(return_value=[order]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "finish", AsyncMock())
    monkeypatch.setattr(gtt_monitor, "is_regular_market_open", lambda **_: False)

    await gtt_monitor.run_gtt_monitor(test_settings)

    service.get_quotes.assert_not_awaited()
    service.place_order.assert_not_awaited()
    gtt_monitor.gtt_store.finish.assert_not_awaited()


def _fyers_order(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = dict(
        id="gtt-1",
        expires_at=datetime.now(UTC) + timedelta(days=1),
        broker_name="fyers",
        symbol="NFO:NIFTY26AUG25000CE",
        trigger_price=100.0,
        side="Buy",
        quantity=50,
        execution_type="MARKET",
        product_type="INTRADAY",
        limit_price=0,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.mark.asyncio
async def test_hit_trigger_places_a_live_order_using_the_atomically_claimed_record(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = AsyncMock()
    service.get_quotes.return_value = [{"last_price": 150.0}]  # >= 100 trigger -> hit
    service.place_order.return_value = {"id": "native-order-1"}
    await session_manager.set_session("TEST_CLIENT_001", service)
    order = _fyers_order()
    claimed = _fyers_order(status="Triggered")
    monkeypatch.setattr(gtt_monitor, "async_session_maker", lambda: _SessionContext())
    monkeypatch.setattr(gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "pending_for_owner", AsyncMock(return_value=[order]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", AsyncMock(return_value=claimed))
    finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "finish", finish_mock)
    monkeypatch.setattr(gtt_monitor, "is_regular_market_open", lambda **_: True)

    await gtt_monitor.run_gtt_monitor(test_settings)

    service.place_order.assert_awaited_once()
    submitted = service.place_order.await_args.args[0]
    assert submitted["symbol"] == order.symbol
    assert submitted["side"] == "Buy"
    # Tagged so _reconcile_unknown_gtt_orders could find this exact attempt
    # in the broker's order book if this call had raised ambiguously.
    assert submitted["order_tag"] == gtt_order_tag(claimed.id)
    # The final "Placed" write must use the freshly-claimed record, not the
    # (possibly stale) one pending_for_owner() originally returned.
    finish_mock.assert_awaited_once()
    _db_arg, finished_record, finished_status = finish_mock.await_args.args
    assert finished_record is claimed
    assert finished_status == "Placed"
    assert finish_mock.await_args.kwargs.get("execution_order_id") == "native-order-1"


@pytest.mark.asyncio
async def test_ambiguous_placement_failure_marks_unknown_not_failed(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """place_order raising *after* the Pending -> Triggered claim already
    succeeded means the broker call was actually reached — its outcome is
    ambiguous (it may have gone through, e.g. on a response timeout), so
    this must not be reported as a clean "Failed"."""
    service = AsyncMock()
    service.get_quotes.return_value = [{"last_price": 150.0}]
    service.place_order.side_effect = TimeoutError("no response from broker")
    await session_manager.set_session("TEST_CLIENT_001", service)
    order = _fyers_order()
    claimed = _fyers_order(status="Triggered")
    monkeypatch.setattr(gtt_monitor, "async_session_maker", lambda: _SessionContext())
    monkeypatch.setattr(gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "pending_for_owner", AsyncMock(return_value=[order]))
    try_finish_mock = AsyncMock(return_value=claimed)
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", try_finish_mock)
    finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "finish", finish_mock)
    monkeypatch.setattr(gtt_monitor, "is_regular_market_open", lambda **_: True)

    await gtt_monitor.run_gtt_monitor(test_settings)

    finish_mock.assert_not_awaited()  # not the blunt "Failed" path
    # try_finish called twice: once for the Pending -> Triggered claim,
    # again for the Triggered -> Unknown transition after the ambiguous failure.
    assert try_finish_mock.await_count == 2
    second_call = try_finish_mock.await_args_list[1]
    assert second_call.kwargs["from_status"] == "Triggered"
    assert second_call.kwargs["status"] == "Unknown"


@pytest.mark.asyncio
async def test_preflight_failure_before_any_broker_call_marks_failed_directly(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure before the broker was ever reached (e.g. get_quotes) is
    unambiguous — no live order could exist, so "Failed" is safe."""
    service = AsyncMock()
    service.get_quotes.side_effect = RuntimeError("quote service unavailable")
    await session_manager.set_session("TEST_CLIENT_001", service)
    order = _fyers_order()
    monkeypatch.setattr(gtt_monitor, "async_session_maker", lambda: _SessionContext())
    monkeypatch.setattr(gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "pending_for_owner", AsyncMock(return_value=[order]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", AsyncMock())
    finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "finish", finish_mock)
    monkeypatch.setattr(gtt_monitor, "is_regular_market_open", lambda **_: True)

    await gtt_monitor.run_gtt_monitor(test_settings)

    service.place_order.assert_not_awaited()
    finish_mock.assert_awaited_once()
    _db_arg, finished_record, finished_status = finish_mock.await_args.args
    assert finished_record is order
    assert finished_status == "Failed"


def _unknown_order(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = dict(
        id="gtt-unknown-1",
        triggered_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    values.update(overrides)
    return SimpleNamespace(**values)


async def _reconcile(module, service, *, owner_id: str = "TEST_CLIENT_001", settings=None) -> None:
    """Short alias for _reconcile_unknown_gtt_orders — db is never actually
    touched directly in these tests (only via the mocked gtt_store calls),
    so a bare sentinel object stands in for the real AsyncSession."""
    await module._reconcile_unknown_gtt_orders(service, object(), owner_id, settings or Settings())


@pytest.mark.asyncio
async def test_reconcile_unknown_adopts_the_real_order_id_when_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = AsyncMock()
    service.get_orders.return_value = [
        {"id": "real-order-99", "order_tag": gtt_order_tag("gtt-unknown-1")},
    ]
    record = _unknown_order()
    monkeypatch.setattr(
        gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[record])
    )
    try_finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", try_finish_mock)

    await _reconcile(gtt_monitor, service)

    try_finish_mock.assert_awaited_once()
    call = try_finish_mock.await_args
    assert call.args[1] == "gtt-unknown-1"
    assert call.kwargs["from_status"] == "Unknown"
    assert call.kwargs["status"] == "Placed"
    assert call.kwargs["execution_order_id"] == "real-order-99"


@pytest.mark.asyncio
async def test_reconcile_unknown_leaves_it_alone_within_the_timeout_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = AsyncMock()
    service.get_orders.return_value = []  # not found in the order book (yet)
    record = _unknown_order(triggered_at=datetime.now(UTC))  # just triggered
    monkeypatch.setattr(
        gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[record])
    )
    try_finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", try_finish_mock)
    settings = Settings(order_reconciliation_timeout_seconds=120.0)

    await _reconcile(gtt_monitor, service, settings=settings)

    try_finish_mock.assert_not_awaited()  # still within the window — left "Unknown"


@pytest.mark.asyncio
async def test_reconcile_unknown_marks_failed_after_the_timeout_window_elapses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = AsyncMock()
    service.get_orders.return_value = []  # never showed up
    record = _unknown_order(triggered_at=datetime.now(UTC) - timedelta(seconds=999))
    monkeypatch.setattr(
        gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[record])
    )
    try_finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", try_finish_mock)
    settings = Settings(order_reconciliation_timeout_seconds=120.0)

    await _reconcile(gtt_monitor, service, settings=settings)

    try_finish_mock.assert_awaited_once()
    call = try_finish_mock.await_args
    assert call.args[1] == "gtt-unknown-1"
    assert call.kwargs["from_status"] == "Unknown"
    assert call.kwargs["status"] == "Failed"


@pytest.mark.asyncio
async def test_reconcile_unknown_survives_a_broker_order_book_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_orders() itself failing must not crash the monitor cycle, and
    must not resolve the record either way — try again next tick."""
    service = AsyncMock()
    service.get_orders.side_effect = RuntimeError("broker unreachable")
    record = _unknown_order()
    monkeypatch.setattr(
        gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[record])
    )
    try_finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", try_finish_mock)

    await _reconcile(gtt_monitor, service)

    try_finish_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_reconcile_unknown_is_a_noop_when_nothing_is_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[]))

    await _reconcile(gtt_monitor, service)

    service.get_orders.assert_not_awaited()


@pytest.mark.asyncio
async def test_does_not_place_a_live_order_when_the_atomic_trigger_claim_loses_the_race(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the row is no longer "Pending" by the time the atomic Pending ->
    Triggered claim runs — most likely because the user cancelled it
    moments ago via the API, in a different session/request — a live order
    must not be placed for it. The old plain read-then-write version of
    this overwrote that cancellation and triggered anyway (see gtt_store.
    try_finish's docstring)."""
    service = AsyncMock()
    service.get_quotes.return_value = [{"last_price": 150.0}]  # would hit, if evaluated
    await session_manager.set_session("TEST_CLIENT_001", service)
    order = _fyers_order()
    monkeypatch.setattr(gtt_monitor, "async_session_maker", lambda: _SessionContext())
    monkeypatch.setattr(gtt_monitor.gtt_store, "unknown_for_owner", AsyncMock(return_value=[]))
    monkeypatch.setattr(gtt_monitor.gtt_store, "pending_for_owner", AsyncMock(return_value=[order]))
    # Simulates losing the race: someone else already changed the row.
    monkeypatch.setattr(gtt_monitor.gtt_store, "try_finish", AsyncMock(return_value=None))
    finish_mock = AsyncMock()
    monkeypatch.setattr(gtt_monitor.gtt_store, "finish", finish_mock)
    monkeypatch.setattr(gtt_monitor, "is_regular_market_open", lambda **_: True)

    await gtt_monitor.run_gtt_monitor(test_settings)

    service.place_order.assert_not_awaited()
    finish_mock.assert_not_awaited()  # no "Placed"/"Failed" write either — not our order to finish


@pytest.mark.asyncio
async def test_loop_catches_a_failure_before_the_per_order_try_except(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
):
    """run_gtt_monitor only guards the per-order body (see the try/except
    inside it) — a failure in the setup around it (session_manager,
    gtt_store.pending_for_owner, the DB connection itself) used to
    propagate straight out of gtt_monitor_loop's while loop and kill the
    task permanently, silently ending all GTT triggering/expiry for the
    rest of the process's life. It must be caught and logged instead of
    raising out of the loop."""
    stop_event = asyncio.Event()
    calls = {"count": 0}

    async def _boom(settings: Settings) -> None:
        calls["count"] += 1
        stop_event.set()  # stop the loop right after this (failing) tick
        raise RuntimeError("DB connection reset")

    monkeypatch.setattr(gtt_monitor, "run_gtt_monitor", _boom)

    # Must not raise — the exception is expected to be caught and logged
    # inside the loop, not propagate out of gtt_monitor_loop itself.
    await gtt_monitor.gtt_monitor_loop(test_settings, stop_event)

    assert calls["count"] == 1
