from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.config import Settings
from app.core.exceptions import BrokerConnectionError
from app.core.security import create_access_token


def _live_headers(settings: Settings) -> dict[str, str]:
    token = create_access_token(
        data={"sub": "TEST_CLIENT_001", "broker": "Fyers", "trading_mode": "live"},
        settings=settings,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_get_instruments_broker_connection_error_returns_503(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    """The globally-registered exception handler should turn a
    BrokerConnectionError raised deep in the service layer into a 503 with
    the structured error body, without the router needing its own try/except."""
    active_broker_session.get_instruments.side_effect = BrokerConnectionError("Fyers is down")
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/market/instruments/NIFTY", headers=headers)
    assert response.status_code == 503
    data = response.json()
    assert data["detail"] == "Fyers is down"
    assert data["error_type"] == "broker_connection_error"


@pytest.mark.asyncio
async def test_get_instruments(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/market/instruments/NIFTY", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "instruments" in data
    assert len(data["instruments"]) > 0
    # Sourced live from the broker symbol master (see conftest's
    # _seed_lot_size_cache), not a hardcoded per-symbol guess.
    assert all(i["lot_size"] == 65 for i in data["instruments"])

@pytest.mark.asyncio
async def test_get_expiries(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/market/expiries/NIFTY", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "expiries" in data
    assert len(data["expiries"]) > 0


@pytest.mark.asyncio
async def test_quotes_filters_malformed_broker_rows(
    client: AsyncClient, access_token: str, active_broker_session: AsyncMock
) -> None:
    active_broker_session.get_quotes.return_value = [
        {
            "symbol": "NIFTY",
            "trading_symbol": "NIFTY",
            "last_price": 22000,
            "timestamp": 1_785_296_700,
        },
        {"trading_symbol": "BROKEN"},
    ]

    response = await client.get(
        "/api/v1/market/quotes?symbols=NIFTY,BROKEN",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "quotes": [
            {
                "symbol": "NIFTY",
                "trading_symbol": "NIFTY",
                "last_price": 22000.0,
                "volume": 0,
                "open_interest": 0,
                "timestamp": 1_785_296_700,
                "change": 0.0,
                "change_percent": 0.0,
                "open_price": None,
                "high_price": None,
                "low_price": None,
                "prev_close_price": None,
                "ask": None,
                "bid": None,
                "atp": None,
            }
        ]
    }


@pytest.mark.asyncio
async def test_margin_normalizes_nested_string_amounts_and_orders_buys_first(
    client: AsyncClient,
    active_broker_session: AsyncMock,
    test_settings: Settings,
) -> None:
    active_broker_session.get_margin.return_value = {
        "summary": {
            "margin_required": "1,250.50",
            "margin_avail": "9,500",
            "span_margin": "800",
            "exposureMargin": "300.50",
            "net_premium": "150",
        }
    }

    response = await client.post(
        "/api/v1/market/margin",
        headers=_live_headers(test_settings),
        json={
            "legs": [
                {"symbol": "NFO:SHORT", "quantity": 50, "side": "Sell", "product_type": "INTRADAY"},
                {"symbol": "NFO:LONG", "quantity": 50, "side": "Buy", "product_type": "INTRADAY"},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "total_margin": 1250.5,
        "available_margin": 9500.0,
        "span_margin": 800.0,
        "exposure_margin": 300.5,
        "premium": 150.0,
        "raw": active_broker_session.get_margin.return_value,
    }
    margin_orders = active_broker_session.get_margin.await_args.args[0]
    assert [order["side"] for order in margin_orders] == ["Buy", "Sell"]
