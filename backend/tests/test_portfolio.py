"""Tests for the /portfolio router — real broker positions/holdings/funds."""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.core.exceptions import BrokerConnectionError


@pytest.mark.asyncio
async def test_positions_requires_active_broker_session(
    app: FastAPI, client: AsyncClient, access_token: str
):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/positions", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == "Active broker session not found"


@pytest.mark.asyncio
async def test_holdings_requires_active_broker_session(
    app: FastAPI, client: AsyncClient, access_token: str
):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/holdings", headers=headers)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_funds_requires_active_broker_session(
    app: FastAPI, client: AsyncClient, access_token: str
):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/funds", headers=headers)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_positions_broker_connection_error_returns_503(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    active_broker_session.get_positions.side_effect = BrokerConnectionError("Fyers is down")
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/positions", headers=headers)
    assert response.status_code == 503
    assert response.json()["error_type"] == "broker_connection_error"


@pytest.mark.asyncio
async def test_positions_aggregates_across_rows(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    active_broker_session.get_positions.return_value = [
        {
            "trading_symbol": "NSE:SBIN-EQ",
            "symbol": "SBIN",
            "product_type": "INTRADAY",
            "quantity": 1,
            "side": "Buy",
            "avg_price": 190.6,
            "last_price": 193.1,
            "realized_pnl": 0.0,
            "unrealized_pnl": 2.5,
            "pnl": 2.5,
        },
        {
            "trading_symbol": "NSE:TCS-EQ",
            "symbol": "TCS",
            "product_type": "CNC",
            "quantity": -2,
            "side": "Sell",
            "avg_price": 3500.0,
            "last_price": 3480.0,
            "realized_pnl": 10.0,
            "unrealized_pnl": 40.0,
            "pnl": 50.0,
        },
    ]
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/positions", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["positions"]) == 2
    assert data["total_pnl"] == pytest.approx(52.5)
    assert data["total_realized_pnl"] == pytest.approx(10.0)
    assert data["total_unrealized_pnl"] == pytest.approx(42.5)


@pytest.mark.asyncio
async def test_holdings_aggregates_across_rows(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    active_broker_session.get_holdings.return_value = [
        {
            "trading_symbol": "NSE:SBIN-EQ",
            "symbol": "SBIN",
            "holding_type": "HLD",
            "quantity": 10,
            "avg_price": 190.0,
            "last_price": 193.0,
            "market_value": 1930.0,
            "pnl": 30.0,
        },
    ]
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/holdings", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert len(data["holdings"]) == 1
    assert data["total_market_value"] == pytest.approx(1930.0)
    assert data["total_pnl"] == pytest.approx(30.0)


@pytest.mark.asyncio
async def test_funds_matches_known_titles_tolerantly(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    active_broker_session.get_funds.return_value = {
        "fund_limit": [
            {"id": 1, "title": "Total Balance", "equityAmount": 100000.0},
            {"id": 2, "title": "Utilized Amount", "equityAmount": 25000.0},
            {"id": 5, "title": "Realised Profit and Loss", "equityAmount": 500.0},
            {"id": 6, "title": "Unrealized Profit and Loss", "equityAmount": -120.0},
            {"id": 10, "title": "Available Balance", "equityAmount": 75000.0},
        ]
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/funds", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["total_balance"] == pytest.approx(100000.0)
    assert data["available_balance"] == pytest.approx(75000.0)
    assert data["utilized_amount"] == pytest.approx(25000.0)
    assert data["realized_pnl"] == pytest.approx(500.0)
    assert data["unrealized_pnl"] == pytest.approx(-120.0)
    assert len(data["raw"]) == 5


@pytest.mark.asyncio
async def test_funds_handles_unrecognized_titles_gracefully(
    app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
):
    """If Fyers ever renames a title this doesn't recognize, the field comes
    back null rather than the request failing — raw always has the truth."""
    active_broker_session.get_funds.return_value = {
        "fund_limit": [{"id": 99, "title": "Some New Field", "equityAmount": 42.0}]
    }
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/portfolio/funds", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["total_balance"] is None
    assert data["available_balance"] is None
    assert len(data["raw"]) == 1
