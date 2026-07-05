import pytest
from fastapi import FastAPI
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_trigger_backfill(app: FastAPI, client: AsyncClient, access_token: str):
    headers = {"Authorization": f"Bearer {access_token}"}
    payload = {
        "symbol": "NIFTY24JUL22000CE",
        "from_date": "2024-07-01",
        "to_date": "2024-07-05",
        "resolution": "1"
    }
    response = await client.post("/api/v1/historical/backfill", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "started" in data["message"]

@pytest.mark.asyncio
async def test_get_historical_ohlcv(app: FastAPI, client: AsyncClient, access_token: str):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/historical/ohlcv/NIFTY24JUL22000CE", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Could be empty depending on DB state, but should be a valid list
