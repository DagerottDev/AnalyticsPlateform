"""Order API safety and payload-routing coverage."""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.config import Settings
from app.core.security import create_access_token


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
