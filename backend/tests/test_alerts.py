"""Persistence and scheduler tests for server-side alerts."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.alert import AlertRecord, AlertTriggerRecord
from app.services import alert_evaluator
from app.services.alert_delivery import DeliveryEvent, _deliver_with_retry
from app.services.alert_evaluator import run_alert_evaluation
from app.services.session_manager import session_manager


def _payload() -> dict:
    return {
        "instrument": {
            "trading_symbol": "NIFTY",
            "symbol": "NIFTY",
            "instrument_type": "EQ",
            "exchange": "NSE",
        },
        "metric": "Price",
        "operator": ">=",
        "threshold": 22000,
        "cooldownMinutes": 5,
    }


@pytest.mark.asyncio
async def test_alert_delivery_retries_transient_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0

    async def operation() -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise TimeoutError("temporary outage")

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.services.alert_delivery.asyncio.sleep", no_sleep)
    event = DeliveryEvent("owner-1", "NIFTY", "Price", ">", 1, 2, datetime.now(UTC))
    await _deliver_with_retry("webhook", event, operation)
    assert attempts == 2


@pytest.mark.asyncio
async def test_alert_api_persists_user_alerts_and_trigger_history(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await client.post("/api/v1/alerts", json=_payload(), headers=auth_headers)
    assert created.status_code == 201
    alert = created.json()
    assert alert["status"] == "Active"
    assert alert["cooldownMinutes"] == 5

    listed = await client.get("/api/v1/alerts", headers=auth_headers)
    assert [row["id"] for row in listed.json()] == [alert["id"]]

    # The exact /events route must not be mistaken for the dynamic alert id.
    events = await client.get("/api/v1/alerts/events", headers=auth_headers)
    assert events.status_code == 200
    assert events.json() == []

    deleted = await client.delete(f"/api/v1/alerts/{alert['id']}", headers=auth_headers)
    assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_alert_api_accepts_higher_order_option_greek(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    payload = {
        "instrument": {
            "trading_symbol": "NSE:NIFTY26DEC22000CE",
            "symbol": "NIFTY",
            "instrument_type": "OPTIDX",
            "expiry": "31-Dec-2026",
            "strike": 22000,
            "option_type": "CE",
            "exchange": "NFO",
        },
        "metric": "Vanna",
        "operator": ">",
        "threshold": 0.01,
        "cooldownMinutes": 5,
    }
    created = await client.post("/api/v1/alerts", json=payload, headers=auth_headers)
    assert created.status_code == 201
    assert created.json()["metric"] == "Vanna"


@pytest.mark.asyncio
async def test_scheduler_records_trigger_and_snoozes_alert(db_session: AsyncSession) -> None:
    alert = AlertRecord(
        id="alert-1",
        owner_id="TEST_CLIENT_001",
        instrument={
            "trading_symbol": "NIFTY",
            "symbol": "NIFTY",
            "instrument_type": "EQ",
        },
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NIFTY", "last_price": 22100.0, "atp": 22050.0}
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            persisted = await check.get(AlertRecord, "alert-1")
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert persisted is not None
        assert persisted.status == "Snoozed"
        assert persisted.snoozed_until is not None
        assert len(events) == 1
        assert events[0].value == 22100.0
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_scheduler_disables_invalid_persisted_alert(db_session: AsyncSession) -> None:
    alert = AlertRecord(
        id="invalid-alert",
        owner_id="TEST_CLIENT_001",
        instrument={"trading_symbol": "NIFTY"},
        trading_symbol="NIFTY",
        metric="Not a metric",
        operator="?",
        threshold=22000,
        cooldown_minutes=0,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    assert db_session.bind is not None
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    assert await run_alert_evaluation(factory) == 0
    async with factory() as check:
        persisted = await check.get(AlertRecord, "invalid-alert")
    assert persisted is not None
    assert persisted.status == "Disabled"


@pytest.mark.asyncio
async def test_scheduler_isolates_a_runtime_crash_in_one_alert_from_the_rest(
    db_session: AsyncSession,
) -> None:
    """A malformed alert can pass _validate_persisted_alert's schema check
    (Instrument.strike has no positivity constraint) and still crash at
    evaluation time — e.g. strike=0 makes calculate_option_price's
    math.log(S/K) raise ZeroDivisionError once the quoted price is high
    enough to skip calculate_implied_volatility's early arbitrage-bounds
    return. That crash must not roll back or block every other alert
    evaluated in the same cycle (they share one uncommitted transaction),
    and must not keep recurring: the offending alert should end up
    Disabled rather than crashing every future cycle forever."""
    healthy = AlertRecord(
        id="healthy-alert",
        owner_id="TEST_CLIENT_001",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    poisoned = AlertRecord(
        id="poisoned-alert",
        owner_id="TEST_CLIENT_001",
        instrument={
            "trading_symbol": "NSE:NIFTY26DEC0CE",
            "symbol": "NIFTY",
            "instrument_type": "OPTIDX",
            "expiry": "31-Dec-2026",
            "strike": 0,
            "option_type": "CE",
            "exchange": "NFO",
        },
        trading_symbol="NSE:NIFTY26DEC0CE",
        metric="Delta",
        operator=">",
        threshold=0,
        cooldown_minutes=0,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add_all([healthy, poisoned])
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NIFTY", "last_price": 22100.0, "atp": 22050.0},
        # last_price > spot so calculate_implied_volatility's early
        # "market_price <= intrinsic" arbitrage guard does NOT short-circuit
        # before reaching the division that actually crashes.
        {"trading_symbol": "NSE:NIFTY26DEC0CE", "last_price": 30000.0},
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)

        # Must not raise, and the healthy alert must still fire despite the
        # other alert crashing during evaluation in the same batch/transaction.
        assert await run_alert_evaluation(factory) == 1

        async with factory() as check:
            healthy_row = await check.get(AlertRecord, "healthy-alert")
            poisoned_row = await check.get(AlertRecord, "poisoned-alert")
            events = (await check.scalars(select(AlertTriggerRecord))).all()

        assert healthy_row is not None and healthy_row.status == "Snoozed"
        assert len(events) == 1 and events[0].alert_id == "healthy-alert"
        # Disabled — not left "Active", which would make it (and the crash)
        # recur on every future cycle forever, since nothing else would ever
        # skip it. The `status == "Active"` filter in run_alert_evaluation
        # excludes "Disabled" records the same way it already does for a
        # schema-invalid alert (see test_scheduler_disables_invalid_
        # persisted_alert above).
        assert poisoned_row is not None and poisoned_row.status == "Disabled"
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_scheduler_evaluates_net_gex_from_chain_snapshot(db_session: AsyncSession) -> None:
    alert = AlertRecord(
        id="net-gex-1",
        owner_id="TEST_CLIENT_001",
        instrument={
            "trading_symbol": "NIFTY",
            "symbol": "NIFTY",
            "instrument_type": "EQ",
            "expiry": "31-Dec-2026",
        },
        trading_symbol="NIFTY",
        metric="Net GEX",
        operator=">",
        threshold=0,
        cooldown_minutes=0,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_instruments.return_value = [
        {
            "trading_symbol": "NSE:NIFTY26DEC22000CE",
            "expiry": "31-Dec-2026",
            "strike": 22000.0,
            "option_type": "CE",
            "oi": 100,
        }
    ]
    service.get_quotes.return_value = [
        {"trading_symbol": "NIFTY", "last_price": 22000.0},
        {"trading_symbol": "NSE:NIFTY26DEC22000CE", "last_price": 1000.0},
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert len(events) == 1
        assert events[0].metric == "Net GEX"
        assert events[0].value > 0
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


def _option_alert(**overrides: object) -> AlertRecord:
    defaults: dict[str, object] = dict(
        id="option-alert-1",
        owner_id="TEST_CLIENT_001",
        instrument={
            "trading_symbol": "NSE:NIFTY26DEC22000CE",
            "symbol": "NIFTY",
            "instrument_type": "OPTIDX",
            "expiry": "31-Dec-2026",
            "strike": 22000,
            "option_type": "CE",
            "exchange": "NFO",
        },
        trading_symbol="NSE:NIFTY26DEC22000CE",
        metric="IV",
        operator=">",
        threshold=0,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    defaults.update(overrides)
    return AlertRecord(**defaults)


def _option_quotes() -> list[dict]:
    return [
        {"trading_symbol": "NIFTY", "last_price": 22050.0},
        {"trading_symbol": "NSE:NIFTY26DEC22000CE", "last_price": 250.0, "open_interest": 5000},
    ]


@pytest.mark.asyncio
async def test_scheduler_evaluates_vwap_breakout(db_session: AsyncSession) -> None:
    alert = AlertRecord(
        id="vwap-1",
        owner_id="TEST_CLIENT_001",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="VWAP Breakout",
        operator=">",
        threshold=0,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = [
        {"trading_symbol": "NIFTY", "last_price": 22100.0, "atp": 22050.0}
    ]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert len(events) == 1
        assert events[0].value == pytest.approx(50.0)  # 22100 - 22050
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
@pytest.mark.parametrize("metric", ["IV", "Delta", "Gamma", "Theta", "Vega", "Color"])
async def test_scheduler_evaluates_greek_and_iv_metrics_for_a_single_option_alert(
    db_session: AsyncSession, metric: str
) -> None:
    """Covers the core per-option Greeks/IV branch (_value_for_alert's
    values dict) — previously untested for every metric except Net GEX."""
    alert = _option_alert(id=f"opt-{metric}", metric=metric, threshold=-1_000_000)
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = _option_quotes()
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert len(events) == 1
        assert events[0].metric == metric
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
@pytest.mark.parametrize("metric", ["Call GEX", "Put GEX"])
async def test_scheduler_evaluates_call_and_put_gex_metrics(
    db_session: AsyncSession, metric: str
) -> None:
    alert = _option_alert(
        id=f"opt-{metric}", metric=metric, threshold=-100_000_000,
        instrument={
            "trading_symbol": "NSE:NIFTY26DEC22000CE",
            "symbol": "NIFTY", "instrument_type": "OPTIDX", "expiry": "31-Dec-2026",
            "strike": 22000, "option_type": "CE" if metric == "Call GEX" else "PE",
            "exchange": "NFO",
        },
    )
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = _option_quotes()
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert len(events) == 1
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_scheduler_skips_owners_without_an_active_broker_session(
    db_session: AsyncSession,
) -> None:
    """No browser tab has logged this owner in since the process started —
    their alerts must be silently skipped this cycle, not crash the run."""
    alert = AlertRecord(
        id="no-session-alert",
        owner_id="OWNER_WITHOUT_SESSION",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=0,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    assert db_session.bind is not None
    factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)

    assert await run_alert_evaluation(factory) == 0  # must not raise


@pytest.mark.asyncio
async def test_scheduler_reactivates_a_snoozed_alert_once_its_snooze_expires(
    db_session: AsyncSession,
) -> None:
    alert = AlertRecord(
        id="snoozed-1",
        owner_id="TEST_CLIENT_001",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000,
        cooldown_minutes=5,
        status="Snoozed",
        snoozed_until=datetime.now(UTC) - timedelta(minutes=1),  # already elapsed
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NIFTY", "last_price": 22100.0}]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        # Reactivated to Active *and* re-evaluated in this same cycle.
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            persisted = await check.get(AlertRecord, "snoozed-1")
        assert persisted is not None
        assert persisted.status == "Snoozed"  # triggered again -> re-snoozed
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_scheduler_deletes_a_one_shot_zero_cooldown_alert_after_it_triggers(
    db_session: AsyncSession,
) -> None:
    alert = AlertRecord(
        id="one-shot-1",
        owner_id="TEST_CLIENT_001",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000,
        cooldown_minutes=0,  # one-shot, not re-armed
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add(alert)
    await db_session.commit()

    service = AsyncMock()
    service.get_quotes.return_value = [{"trading_symbol": "NIFTY", "last_price": 22100.0}]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
        assert await run_alert_evaluation(factory) == 1
        async with factory() as check:
            persisted = await check.get(AlertRecord, "one-shot-1")
        assert persisted is None  # deleted, not left around to re-trigger
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


@pytest.mark.asyncio
async def test_scheduler_isolates_a_quote_lookup_failure_to_just_that_owner(
    db_session: AsyncSession,
) -> None:
    """service.get_quotes raising for one owner must not stop a *different*
    owner's alerts (each with their own broker session) from being
    evaluated in the same cycle."""
    broken_owner_alert = AlertRecord(
        id="broken-owner-alert",
        owner_id="OWNER_BROKEN",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=0,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    healthy_owner_alert = AlertRecord(
        id="healthy-owner-alert",
        owner_id="OWNER_HEALTHY",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add_all([broken_owner_alert, healthy_owner_alert])
    await db_session.commit()

    broken_service = AsyncMock()
    broken_service.get_quotes.side_effect = RuntimeError("Fyers quote endpoint timed out")
    healthy_service = AsyncMock()
    healthy_service.get_quotes.return_value = [{"trading_symbol": "NIFTY", "last_price": 22100.0}]
    await session_manager.set_session("OWNER_BROKEN", broken_service)
    await session_manager.set_session("OWNER_HEALTHY", healthy_service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)

        assert await run_alert_evaluation(factory) == 1  # only the healthy owner's alert fired

        async with factory() as check:
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert len(events) == 1
        assert events[0].owner_id == "OWNER_HEALTHY"
    finally:
        await session_manager.remove_session("OWNER_BROKEN")
        await session_manager.remove_session("OWNER_HEALTHY")


@pytest.mark.asyncio
async def test_scheduler_isolates_a_net_gex_chain_lookup_failure_from_other_alerts(
    db_session: AsyncSession,
) -> None:
    net_gex_alert = AlertRecord(
        id="net-gex-broken",
        owner_id="TEST_CLIENT_001",
        instrument={
            "trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ",
            "expiry": "31-Dec-2026",
        },
        trading_symbol="NIFTY",
        metric="Net GEX",
        operator=">",
        threshold=-1_000_000,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    price_alert = AlertRecord(
        id="price-healthy",
        owner_id="TEST_CLIENT_001",
        instrument={"trading_symbol": "NIFTY", "symbol": "NIFTY", "instrument_type": "EQ"},
        trading_symbol="NIFTY",
        metric="Price",
        operator=">=",
        threshold=22000,
        cooldown_minutes=5,
        status="Active",
        created_at=datetime.now(UTC),
    )
    db_session.add_all([net_gex_alert, price_alert])
    await db_session.commit()

    service = AsyncMock()
    service.get_instruments.side_effect = RuntimeError("Fyers option chain request failed")
    service.get_quotes.return_value = [{"trading_symbol": "NIFTY", "last_price": 22100.0}]
    await session_manager.set_session("TEST_CLIENT_001", service)
    try:
        assert db_session.bind is not None
        factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)

        # The chain lookup failure must not crash quote evaluation for the
        # rest of this owner's alerts.
        assert await run_alert_evaluation(factory) == 1

        async with factory() as check:
            events = (await check.scalars(select(AlertTriggerRecord))).all()
        assert [e.alert_id for e in events] == ["price-healthy"]
    finally:
        await session_manager.remove_session("TEST_CLIENT_001")


class TestTimeToExpiryFallback:
    """_time_to_expiry falls back to a tiny positive value (rather than
    raising or returning 0, which would divide-by-zero downstream in
    Black-Scholes) for any expiry it can't parse."""

    def test_returns_the_fallback_for_a_non_string_expiry(self) -> None:
        assert alert_evaluator._time_to_expiry(None) == 0.0001
        assert alert_evaluator._time_to_expiry(12345) == 0.0001

    def test_returns_the_fallback_for_an_unparseable_string(self) -> None:
        assert alert_evaluator._time_to_expiry("not-a-date") == 0.0001

    def test_parses_each_supported_date_format(self) -> None:
        for expiry in ("31-Dec-2026", "2026-12-31", "2026-12-31T00:00:00.000Z"):
            assert alert_evaluator._time_to_expiry(expiry) > 0


@pytest.mark.asyncio
async def test_loop_runs_immediately_then_stops_on_the_stop_event(
    test_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    async def fake_run(*_a: object, **_k: object) -> int:
        nonlocal calls
        calls += 1
        stop_event.set()
        return 0

    monkeypatch.setattr(alert_evaluator, "run_alert_evaluation", fake_run)
    stop_event = asyncio.Event()

    await alert_evaluator.alert_evaluation_loop(test_settings, stop_event)

    assert calls == 1


@pytest.mark.asyncio
async def test_loop_survives_a_cycle_that_raises(
    test_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = test_settings.model_copy(update={"alert_evaluation_interval_seconds": 0.01})
    attempts = 0

    async def flaky_run(*_a: object, **_k: object) -> int:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("DB connection reset")
        stop_event.set()
        return 0

    monkeypatch.setattr(alert_evaluator, "run_alert_evaluation", flaky_run)
    stop_event = asyncio.Event()

    await alert_evaluator.alert_evaluation_loop(settings, stop_event)  # must not raise

    assert attempts == 2
