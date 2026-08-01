"""Order API safety and payload-routing coverage."""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.security import create_access_token
from app.models.live_basket import LiveBasketRecord


def live_headers(settings: Settings) -> dict[str, str]:
    token = create_access_token(
        data={"sub": "TEST_CLIENT_001", "broker": "Fyers", "trading_mode": "live"},
        settings=settings,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_place_order_rejects_paper_mode(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    response = await client.post(
        "/api/v1/orders",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"symbol": "NSE:SBIN-EQ", "quantity": 1, "side": "Buy", "order_type": "MARKET"},
    )
    assert response.status_code == 403
    active_broker_session.place_order.assert_not_awaited()


@pytest.mark.asyncio
async def test_place_order_validates_and_routes_live_order(
    client: AsyncClient, active_broker_session: AsyncMock, test_settings: Settings
):
    active_broker_session.place_order.return_value = {"id": "12345", "message": "Order placed"}
    response = await client.post(
        "/api/v1/orders",
        headers=live_headers(test_settings),
        json={
            "symbol": "NSE:SBIN-EQ", "quantity": 2, "side": "Buy", "order_type": "LIMIT",
            "limit_price": 612.5, "product_type": "INTRADAY", "order_tag": "manual-sbin",
        },
    )
    assert response.status_code == 201
    assert response.json() == {"id": "12345", "message": "Order placed"}
    active_broker_session.place_order.assert_awaited_once_with({
        "symbol": "NSE:SBIN-EQ", "quantity": 2, "side": "Buy", "order_type": "LIMIT",
        "limit_price": 612.5, "stop_price": 0, "product_type": "INTRADAY", "validity": "DAY",
        "disclosed_quantity": 0, "offline_order": False, "stop_loss": 0, "take_profit": 0,
        "order_tag": "manual-sbin",
    })


@pytest.mark.asyncio
async def test_place_order_routes_sell_with_stop_and_target(
    client: AsyncClient, active_broker_session: AsyncMock, test_settings: Settings
):
    active_broker_session.place_order.return_value = {"id": "sell-123", "message": "Order placed"}
    response = await client.post(
        "/api/v1/orders",
        headers=live_headers(test_settings),
        json={
            "symbol": "NFO:NIFTY26AUG25000CE",
            "quantity": 65,
            "side": "Sell",
            "order_type": "MARKET",
            "product_type": "INTRADAY",
            "stop_loss": 145.0,
            "take_profit": 75.0,
        },
    )

    assert response.status_code == 201
    active_broker_session.place_order.assert_awaited_once_with({
        "symbol": "NFO:NIFTY26AUG25000CE",
        "quantity": 65,
        "side": "Sell",
        "order_type": "MARKET",
        "product_type": "INTRADAY",
        "limit_price": 0,
        "stop_price": 0,
        "validity": "DAY",
        "disclosed_quantity": 0,
        "offline_order": False,
        "stop_loss": 145.0,
        "take_profit": 75.0,
        "order_tag": None,
    })


@pytest.mark.asyncio
async def test_modify_and_cancel_route_live_actions(
    client: AsyncClient, active_broker_session: AsyncMock, test_settings: Settings
):
    active_broker_session.modify_order.return_value = {"id": "12345", "message": "Order modified"}
    active_broker_session.cancel_order.return_value = {"id": "12345", "message": "Order cancelled"}
    headers = live_headers(test_settings)
    modify = await client.patch(
        "/api/v1/orders/12345", headers=headers,
        json={"quantity": 2, "order_type": "STOP_LIMIT", "limit_price": 610, "stop_price": 611},
    )
    cancel = await client.delete("/api/v1/orders/12345", headers=headers)
    assert modify.status_code == 200
    assert cancel.status_code == 200
    active_broker_session.modify_order.assert_awaited_once()
    active_broker_session.cancel_order.assert_awaited_once_with("12345")


@pytest.mark.asyncio
async def test_get_orders_is_read_only_in_paper_mode(
    client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    active_broker_session.get_orders.return_value = [{
        "id": "12345", "trading_symbol": "NSE:SBIN-EQ", "side": "Buy", "order_type": "LIMIT",
        "product_type": "INTRADAY", "quantity": 1, "status": "PENDING",
    }]
    response = await client.get(
        "/api/v1/orders", headers={"Authorization": f"Bearer {access_token}"}
    )
    assert response.status_code == 200
    assert response.json()["orders"][0]["id"] == "12345"


def _basket_leg(symbol: str, **overrides: object) -> dict:
    leg = {
        "symbol": symbol, "quantity": 50, "side": "Buy", "order_type": "MARKET",
        "product_type": "INTRADAY",
    }
    leg.update(overrides)
    return leg


@pytest.mark.asyncio
async def test_place_basket_order_rejects_paper_mode(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    response = await client.post(
        "/api/v1/orders/basket",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"legs": [_basket_leg("NFO:NIFTY24JULCE")]},
    )
    assert response.status_code == 403
    active_broker_session.place_basket_orders.assert_not_awaited()


@pytest.mark.asyncio
async def test_place_basket_order_persists_pending_entries_until_fill_confirmation(
    client: AsyncClient,
    active_broker_session: AsyncMock,
    test_settings: Settings,
    db_session: AsyncSession,
):
    active_broker_session.get_quotes.return_value = [
        {"trading_symbol": "NFO:NIFTY24JULCE", "last_price": 150.0},
        {"trading_symbol": "NFO:NIFTY24JULPE", "last_price": 140.0},
    ]
    active_broker_session.place_basket_orders.return_value = [
        {"id": "111", "message": "Order submitted"},
        {"id": "112", "message": "Order submitted"},
    ]

    response = await client.post(
        "/api/v1/orders/basket",
        headers=live_headers(test_settings),
        json={
            "legs": [
                _basket_leg("NFO:NIFTY24JULCE", stop_loss=100.0, take_profit=250.0),
                _basket_leg("NFO:NIFTY24JULPE", side="Sell"),
            ],
            "combined_stop_loss": 5000,
            "combined_take_profit": 10000,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["basket_id"] is not None
    assert [leg["id"] for leg in body["legs"]] == ["111", "112"]
    active_broker_session.place_basket_orders.assert_awaited_once()
    # An order id means submitted, not traded. A STOP must not be placed yet.
    active_broker_session.place_order.assert_not_awaited()

    basket = (await db_session.execute(select(LiveBasketRecord))).scalar_one()
    assert basket.status == "Open"
    assert basket.combined_stop_loss == 5000
    assert len(basket.legs) == 2
    assert basket.legs[0]["status"] == "PendingEntry"
    assert basket.legs[0]["entry_order_id"] == "111"
    assert basket.legs[0]["entry_price"] == 0.0
    assert basket.legs[0]["target"] == 250.0
    assert basket.legs[0]["protective_stop_order_id"] is None
    assert basket.legs[1]["protective_stop_order_id"] is None


@pytest.mark.asyncio
async def test_place_basket_order_reports_partial_failure_without_raising(
    client: AsyncClient,
    active_broker_session: AsyncMock,
    test_settings: Settings,
    db_session: AsyncSession,
):
    active_broker_session.get_quotes.return_value = []
    active_broker_session.place_basket_orders.return_value = [
        {"id": "111", "message": "Order submitted"},
        {"id": None, "message": "RMS:Insufficient funds"},
    ]

    response = await client.post(
        "/api/v1/orders/basket",
        headers=live_headers(test_settings),
        json={"legs": [_basket_leg("NFO:A"), _basket_leg("NFO:B")]},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["basket_id"] is not None  # at least one leg entered
    assert body["legs"][0]["id"] == "111"
    assert body["legs"][1]["id"] is None
    assert "RMS" in body["legs"][1]["message"]

    basket = (await db_session.execute(select(LiveBasketRecord))).scalar_one()
    assert basket.legs[0]["status"] == "PendingEntry"
    assert basket.legs[1]["status"] == "Failed"


@pytest.mark.asyncio
async def test_place_basket_order_submits_buys_before_sells(
    client: AsyncClient,
    active_broker_session: AsyncMock,
    test_settings: Settings,
) -> None:
    active_broker_session.place_basket_orders.return_value = [
        {"id": "buy-order", "message": "Order submitted"},
        {"id": "sell-order", "message": "Order submitted"},
    ]

    response = await client.post(
        "/api/v1/orders/basket",
        headers=live_headers(test_settings),
        json={
            "legs": [
                _basket_leg("NFO:SHORT", side="Sell"),
                _basket_leg("NFO:LONG", side="Buy"),
            ]
        },
    )

    assert response.status_code == 201
    submitted_orders = active_broker_session.place_basket_orders.await_args.args[0]
    assert [order["side"] for order in submitted_orders] == ["Buy", "Sell"]
    assert [order["symbol"] for order in submitted_orders] == ["NFO:LONG", "NFO:SHORT"]
    assert [leg["symbol"] for leg in response.json()["legs"]] == ["NFO:LONG", "NFO:SHORT"]


@pytest.mark.asyncio
async def test_place_basket_order_skips_persistence_when_every_leg_fails(
    client: AsyncClient,
    active_broker_session: AsyncMock,
    test_settings: Settings,
    db_session: AsyncSession,
):
    active_broker_session.get_quotes.return_value = []
    active_broker_session.place_basket_orders.return_value = [
        {"id": None, "message": "RMS:Insufficient funds"},
    ]

    response = await client.post(
        "/api/v1/orders/basket",
        headers=live_headers(test_settings),
        json={"legs": [_basket_leg("NFO:A")]},
    )

    assert response.status_code == 201
    assert response.json()["basket_id"] is None
    count = (await db_session.execute(select(LiveBasketRecord))).scalars().all()
    assert count == []
