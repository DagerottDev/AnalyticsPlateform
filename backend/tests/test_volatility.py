"""Tests for the volatility router's real-OHLCV-based historical vol computation."""

from datetime import UTC, datetime, timedelta
from math import log, sqrt
from statistics import pstdev
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.api.v1.volatility import (
    IV_RISK_PREMIUM,
    RV_WINDOW_DAYS,
    TRADING_DAYS_PER_YEAR,
    _compute_vol_series,
)


def _closes(prices: list[float], start: datetime | None = None) -> list[tuple[datetime, float]]:
    start = start or datetime(2024, 1, 1, tzinfo=UTC)
    return [(start + timedelta(days=i), price) for i, price in enumerate(prices)]


def _candles(prices: list[float], start: datetime | None = None) -> list[dict]:
    """Shape matches FyersService.get_historical_data()'s return rows."""
    start = start or datetime(2024, 1, 1, tzinfo=UTC)
    return [
        {
            "timestamp": start + timedelta(days=i),
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": 1000,
            "open_interest": 0,
        }
        for i, price in enumerate(prices)
    ]


class TestComputeVolSeries:
    def test_too_few_points_returns_empty(self):
        closes = _closes([100.0] * (RV_WINDOW_DAYS))  # one short of the +2 minimum
        assert _compute_vol_series(closes) == []

    def test_flat_prices_have_zero_realized_vol(self):
        closes = _closes([100.0] * (RV_WINDOW_DAYS + 5))
        series = _compute_vol_series(closes)
        assert len(series) > 0
        assert all(point["rv"] == 0.0 for point in series)

    def test_realized_vol_responds_to_real_price_swings(self):
        """A window of genuinely volatile closes must score higher RV than a flat one —
        proves this is derived from the actual input series, not fabricated noise."""
        flat = [100.0] * RV_WINDOW_DAYS
        volatile = [100.0, 110.0, 95.0, 115.0, 90.0, 120.0, 85.0, 118.0, 92.0, 112.0] * 2
        closes = _closes(flat + volatile[: RV_WINDOW_DAYS + 2])

        series = _compute_vol_series(closes)
        assert series[-1]["rv"] > series[0]["rv"]

    def test_first_point_iv_is_exact_risk_premium_multiple_of_rv(self):
        """Before any smoothing accumulates, iv == rv * (1 + IV_RISK_PREMIUM) exactly."""
        prices = [100.0, 102.0, 99.0, 103.0, 101.0] * 5
        closes = _closes(prices[: RV_WINDOW_DAYS + 2])

        series = _compute_vol_series(closes)
        assert series[0]["iv"] == round(series[0]["rv"] * (1 + IV_RISK_PREMIUM), 4)

    def test_dates_align_to_the_window_end(self):
        prices = [100.0 + i for i in range(RV_WINDOW_DAYS + 3)]
        start = datetime(2024, 3, 1, tzinfo=UTC)
        closes = _closes(prices, start=start)

        series = _compute_vol_series(closes)
        assert series[0]["date"] == (start + timedelta(days=RV_WINDOW_DAYS)).strftime("%Y-%m-%d")
        assert series[-1]["date"] == (start + timedelta(days=len(prices) - 1)).strftime("%Y-%m-%d")

    def test_matches_independent_manual_calculation(self):
        """Recompute annualized stdev of log returns by hand and compare, to lock in the formula."""
        prices = ([100.0, 101.5, 99.0, 103.0, 97.5, 105.0, 100.0] * 4)[: RV_WINDOW_DAYS + 2]
        closes = _closes(prices)

        series = _compute_vol_series(closes)

        log_returns = [log(prices[i] / prices[i - 1]) for i in range(1, len(prices))]
        expected_rv = pstdev(log_returns[-RV_WINDOW_DAYS:]) * sqrt(TRADING_DAYS_PER_YEAR)
        assert series[-1]["rv"] == round(expected_rv, 4)


class TestVolatilityRouter:
    @pytest.mark.asyncio
    async def test_historical_requires_active_broker_session(
        self, app: FastAPI, client: AsyncClient, access_token: str
    ):
        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/NIFTY/historical", headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"] == "Active broker session not found"

    @pytest.mark.asyncio
    async def test_metrics_requires_active_broker_session(
        self, app: FastAPI, client: AsyncClient, access_token: str
    ):
        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/NIFTY/metrics", headers=headers)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_historical_returns_real_data_derived_series(
        self, app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
    ):
        prices = [100.0 + (i % 7) - 3 for i in range(80)]
        active_broker_session.get_historical_data.return_value = _candles(prices)

        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/NIFTY/historical?days=252", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) > 0
        for point in data:
            assert set(point.keys()) == {"date", "iv", "rv"}
            assert point["iv"] >= 0
            assert point["rv"] >= 0

    @pytest.mark.asyncio
    async def test_metrics_returns_rank_and_percentile(
        self, app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
    ):
        prices = [100.0 + (i % 11) - 5 for i in range(300)]
        active_broker_session.get_historical_data.return_value = _candles(prices)

        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/NIFTY/metrics", headers=headers)

        assert response.status_code == 200
        data = response.json()
        assert data["symbol"] == "NIFTY"
        assert 0 <= data["iv_rank"] <= 100
        assert 0 <= data["iv_percentile"] <= 100
        assert data["data_points"] > 0

    @pytest.mark.asyncio
    async def test_metrics_404_when_not_enough_history(
        self, app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
    ):
        active_broker_session.get_historical_data.return_value = _candles([100.0, 101.0, 99.0])

        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/NIFTY/metrics", headers=headers)

        assert response.status_code == 404
