from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.exceptions import BrokerConnectionError


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
