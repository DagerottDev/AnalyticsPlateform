"""Persistence and scheduler tests for server-side alerts."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.alert import AlertRecord, AlertTriggerRecord
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
