from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_historical_ohlcv(app: FastAPI, client: AsyncClient, access_token: str):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/historical/ohlcv/NIFTY24JUL22000CE", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Could be empty depending on DB state, but should be a valid list


@pytest.mark.asyncio
async def test_get_historical_ohlcv_accepts_date_range(
    app: FastAPI, client: AsyncClient, access_token: str
):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get(
        "/api/v1/historical/ohlcv/NIFTY24JUL22000CE",
        params={
            "start": datetime(2026, 1, 1, tzinfo=UTC).isoformat(),
            "end": datetime(2026, 1, 31, tzinfo=UTC).isoformat(),
            "limit": 50,
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)
