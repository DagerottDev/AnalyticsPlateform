import pytest
from httpx import AsyncClient
from fastapi import FastAPI

@pytest.mark.asyncio
async def test_get_instruments(app: FastAPI, client: AsyncClient, access_token: str):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/market/instruments/NIFTY", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "instruments" in data
    assert len(data["instruments"]) > 0

@pytest.mark.asyncio
async def test_get_expiries(app: FastAPI, client: AsyncClient, access_token: str):
    headers = {"Authorization": f"Bearer {access_token}"}
    response = await client.get("/api/v1/market/expiries/NIFTY", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "expiries" in data
    assert len(data["expiries"]) > 0
