"""Rate-limiter behavior at the HTTP boundary."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.middleware.rate_limit import RateLimitMiddleware


@pytest.mark.asyncio
async def test_rate_limit_returns_429_and_retry_headers() -> None:
    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        settings=Settings(
            api_rate_limit_window_seconds=60,
            api_rate_limit_default_requests=2,
            api_rate_limit_broker_requests=1,
            api_rate_limit_auth_requests=1,
        ),
    )

    @app.get("/api/v1/example")
    async def example() -> dict[str, bool]:
        return {"ok": True}

    transport = ASGITransport(app=app, client=("198.51.100.1", 50000))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.get("/api/v1/example")
        second = await client.get("/api/v1/example")
        blocked = await client.get("/api/v1/example")

    assert first.status_code == second.status_code == 200
    assert first.headers["x-ratelimit-remaining"] == "1"
    assert blocked.status_code == 429
    assert blocked.json()["error_type"] == "rate_limit_exceeded"
    assert int(blocked.headers["retry-after"]) > 0


@pytest.mark.asyncio
async def test_broker_bucket_is_stricter_and_health_is_exempt() -> None:
    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        settings=Settings(api_rate_limit_broker_requests=1, api_rate_limit_default_requests=1),
    )

    @app.get("/api/v1/market/quotes")
    async def quotes() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/v1/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    transport = ASGITransport(app=app, client=("198.51.100.2", 50000))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/api/v1/market/quotes")).status_code == 200
        assert (await client.get("/api/v1/market/quotes")).status_code == 429
        assert (await client.get("/api/v1/health")).status_code == 200
        assert (await client.get("/api/v1/health")).status_code == 200
