"""Tests for the live-basket persistence layer."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.live_basket_store import (
    close_basket,
    create_basket,
    load_open_baskets,
    update_legs,
)


def _leg(symbol: str = "NFO:NIFTY24JULCE") -> dict:
    return {
        "symbol": symbol, "quantity": 50, "side": "Buy", "entry_price": 150.0,
        "product_type": "INTRADAY", "target": None, "protective_stop_order_id": None,
        "status": "Open", "exit_price": None, "close_reason": None,
    }


@pytest.mark.asyncio
async def test_create_and_load_open_baskets(db_session: AsyncSession):
    await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[_leg()],
        combined_stop_loss=5000, combined_take_profit=None,
    )

    open_baskets = await load_open_baskets(db_session)

    assert len(open_baskets) == 1
    assert open_baskets[0].status == "Open"
    assert open_baskets[0].legs[0]["symbol"] == "NFO:NIFTY24JULCE"


@pytest.mark.asyncio
async def test_update_legs_persists_mutated_leg_status(db_session: AsyncSession):
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[_leg()],
        combined_stop_loss=None, combined_take_profit=None,
    )

    legs = basket.legs
    legs[0]["status"] = "Closed"
    legs[0]["exit_price"] = 250.0
    await update_legs(db_session, basket.id, legs)

    reloaded = await load_open_baskets(db_session)
    # Still "Open" at the basket level (only the leg changed) — reload directly to check.
    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.legs[0]["status"] == "Closed"
    assert refreshed.legs[0]["exit_price"] == 250.0
    assert reloaded[0].id == basket.id  # basket itself still Open


@pytest.mark.asyncio
async def test_close_basket_marks_closed_with_reason(db_session: AsyncSession):
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[_leg()],
        combined_stop_loss=None, combined_take_profit=None,
    )

    await close_basket(db_session, basket.id, reason="Combined stop-loss hit")

    open_baskets = await load_open_baskets(db_session)
    assert open_baskets == []
    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.status == "Closed"
    assert refreshed.close_reason == "Combined stop-loss hit"
    assert refreshed.closed_at is not None


@pytest.mark.asyncio
async def test_close_basket_is_idempotent_for_unknown_or_already_closed(db_session: AsyncSession):
    basket = await create_basket(
        db_session, owner_id="TEST_CLIENT_001", legs=[_leg()],
        combined_stop_loss=None, combined_take_profit=None,
    )
    await close_basket(db_session, basket.id, reason="first")
    await close_basket(db_session, basket.id, reason="second")
    await close_basket(db_session, "does-not-exist", reason="noop")

    refreshed = await db_session.get(type(basket), basket.id)
    assert refreshed.close_reason == "first"
