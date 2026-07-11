"""Tests for the health check endpoint."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check_returns_200(client: AsyncClient) -> None:
    """Health endpoint should return 200 with status info."""
    response = await client.get("/api/v1/health")
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert "environment" in data


@pytest.mark.asyncio
async def test_health_check_contains_version(client: AsyncClient) -> None:
    """Health endpoint should include the application version."""
    response = await client.get("/api/v1/health")
    data = response.json()
    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_health_check_contains_environment(client: AsyncClient) -> None:
    """Health endpoint should include the current environment."""
    response = await client.get("/api/v1/health")
    data = response.json()
    assert data["environment"] in ["development", "staging", "production"]
