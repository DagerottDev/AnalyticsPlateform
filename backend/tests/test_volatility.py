"""Tests for the volatility router's real-OHLCV-based historical vol computation."""

import asyncio
from datetime import UTC, date, datetime, timedelta
from math import log, sqrt
from statistics import pstdev
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.volatility import (
    IV_RISK_PREMIUM,
    RV_WINDOW_DAYS,
    TRADING_DAYS_PER_YEAR,
    _compute_vol_series,
)
from app.models.volatility_snapshot import DailyVolatilitySnapshot
from app.services.fo_iv_universe_store import upsert_snapshot
from app.services.volatility_snapshot_store import get_or_create_daily_snapshot


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
    async def test_relative_value_compares_iv_skew_and_gex(
        self, app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
    ):
        active_broker_session.get_instruments.return_value = [
            {
                "trading_symbol": "NFO:NIFTY30DEC22000CE",
                "expiry": "30-Dec-2027",
                "strike": 22000.0,
                "option_type": "CE",
                "oi": 1000,
            },
            {
                "trading_symbol": "NFO:NIFTY30DEC22000PE",
                "expiry": "30-Dec-2027",
                "strike": 22000.0,
                "option_type": "PE",
                "oi": 1200,
            },
            {
                "trading_symbol": "NFO:NIFTY30DEC22500CE",
                "expiry": "30-Dec-2027",
                "strike": 22500.0,
                "option_type": "CE",
                "oi": 800,
            },
            {
                "trading_symbol": "NFO:NIFTY30DEC21500PE",
                "expiry": "30-Dec-2027",
                "strike": 21500.0,
                "option_type": "PE",
                "oi": 900,
            },
        ]
        active_broker_session.get_quotes.side_effect = [
            [{"trading_symbol": "NIFTY", "last_price": 22000.0, "change_percent": 0.4}],
            [
                {"trading_symbol": "NFO:NIFTY30DEC22000CE", "last_price": 1800.0},
                {"trading_symbol": "NFO:NIFTY30DEC22000PE", "last_price": 1700.0},
                {"trading_symbol": "NFO:NIFTY30DEC22500CE", "last_price": 1500.0},
                {"trading_symbol": "NFO:NIFTY30DEC21500PE", "last_price": 1450.0},
            ],
        ]

        response = await client.get(
            "/api/v1/volatility/compare?symbols=NIFTY",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        assert response.status_code == 200
        row = response.json()["comparisons"][0]
        assert row["symbol"] == "NIFTY"
        assert row["atm_iv"] > 0
        assert row["put_iv"] is not None
        assert row["call_iv"] is not None
        assert isinstance(row["net_gex"], float)
        assert row["iv_rank"] is None
        assert active_broker_session.get_instruments.await_count == 1
        assert active_broker_session.get_quotes.await_count == 2

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
    async def test_historical_and_metrics_share_one_broker_history_fetch(
        self, app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
    ):
        """The two historical-tab API calls must not double-hit Fyers."""
        active_broker_session.get_historical_data.return_value = _candles(
            [100.0 + (i % 11) - 5 for i in range(300)]
        )
        headers = {"Authorization": f"Bearer {access_token}"}

        historical, metrics = await asyncio.gather(
            client.get("/api/v1/volatility/NIFTY/historical", headers=headers),
            client.get("/api/v1/volatility/NIFTY/metrics", headers=headers),
        )

        assert historical.status_code == 200
        assert metrics.status_code == 200
        assert active_broker_session.get_historical_data.await_count == 1

    @pytest.mark.asyncio
    async def test_historical_captures_one_real_atm_iv_snapshot_per_day(
        self,
        app: FastAPI,
        client: AsyncClient,
        access_token: str,
        active_broker_session: AsyncMock,
        db_session: AsyncSession,
    ):
        active_broker_session.get_historical_data.return_value = _candles(
            [22000.0 + (i % 11) - 5 for i in range(300)]
        )
        active_broker_session.get_instruments.return_value = [
            {
                "trading_symbol": "NSE:NIFTY27DEC22000CE",
                "expiry": "30-Dec-2027",
                "strike": 22000.0,
                "option_type": "CE",
            },
            {
                "trading_symbol": "NSE:NIFTY27DEC22000PE",
                "expiry": "30-Dec-2027",
                "strike": 22000.0,
                "option_type": "PE",
            },
        ]
        active_broker_session.get_quotes.side_effect = [
            [{"trading_symbol": "NIFTY", "last_price": 22000.0}],
            [
                {"trading_symbol": "NSE:NIFTY27DEC22000CE", "last_price": 600.0},
                {"trading_symbol": "NSE:NIFTY27DEC22000PE", "last_price": 500.0},
            ],
        ]
        headers = {"Authorization": f"Bearer {access_token}"}

        first = await client.get("/api/v1/volatility/NIFTY/historical", headers=headers)
        second = await client.get("/api/v1/volatility/NIFTY/historical", headers=headers)

        snapshots = list((await db_session.execute(select(DailyVolatilitySnapshot))).scalars())
        assert first.status_code == 200
        assert second.status_code == 200
        assert len(snapshots) == 1
        assert snapshots[0].symbol == "NIFTY"
        assert snapshots[0].atm_iv > 0
        assert active_broker_session.get_instruments.await_count == 1

    @pytest.mark.asyncio
    async def test_universe_reads_only_the_db_and_needs_no_broker_session(
        self,
        app: FastAPI,
        client: AsyncClient,
        access_token: str,
        db_session: AsyncSession,
    ):
        """No active_broker_session fixture here on purpose: this endpoint must
        never depend on a live Fyers connection to respond."""
        await upsert_snapshot(
            db_session,
            symbol="RELIANCE",
            snapshot_date=date(2026, 7, 31),
            atm_iv=0.18,
            spot=2900.0,
            iv_rank=42.0,
            iv_percentile=55.0,
        )

        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/universe", headers=headers)

        assert response.status_code == 200
        rows = {row["symbol"]: row for row in response.json()["symbols"]}
        assert rows["RELIANCE"]["atm_iv"] == 0.18
        assert rows["RELIANCE"]["iv_rank"] == 42.0
        assert rows["RELIANCE"]["company_name"] == "Reliance Industries"
        assert rows["RELIANCE"]["status"] == "ready"
        assert rows["RELIANCE"]["events"] == []
        assert rows["RELIANCE"]["updated_at"] is not None
        assert response.json()["corporate_calendar"]["status"] == "ready"
        # A symbol the backfill job hasn't reached yet still appears, with nulls.
        assert rows["TCS"]["atm_iv"] is None
        assert rows["TCS"]["snapshot_date"] is None
        assert rows["TCS"]["status"] == "building"

    @pytest.mark.asyncio
    async def test_universe_marks_old_snapshots_stale(
        self, app: FastAPI, client: AsyncClient, access_token: str, db_session: AsyncSession
    ):
        snapshot = await upsert_snapshot(
            db_session,
            symbol="INFY",
            snapshot_date=date(2026, 7, 31),
            atm_iv=0.2,
            spot=1700.0,
            iv_rank=50.0,
            iv_percentile=50.0,
        )
        snapshot.updated_at = datetime.now(UTC) - timedelta(hours=3)
        await db_session.commit()

        response = await client.get(
            "/api/v1/volatility/universe",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        assert response.status_code == 200
        rows = {row["symbol"]: row for row in response.json()["symbols"]}
        assert rows["INFY"]["status"] == "stale"

    @pytest.mark.asyncio
    async def test_universe_validates_projection_days(
        self, app: FastAPI, client: AsyncClient, access_token: str
    ):
        response = await client.get(
            "/api/v1/volatility/universe?projection_days=61",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_metrics_404_when_not_enough_history(
        self, app: FastAPI, client: AsyncClient, access_token: str, active_broker_session: AsyncMock
    ):
        active_broker_session.get_historical_data.return_value = _candles([100.0, 101.0, 99.0])

        headers = {"Authorization": f"Bearer {access_token}"}
        response = await client.get("/api/v1/volatility/NIFTY/metrics", headers=headers)

        assert response.status_code == 404


@pytest.mark.asyncio
async def test_daily_snapshot_is_immutable_and_stores_capture_time_rank(
    db_session: AsyncSession,
):
    first = await get_or_create_daily_snapshot(
        db_session,
        symbol="NIFTY",
        snapshot_date=datetime(2026, 7, 28, tzinfo=UTC).date(),
        atm_iv=0.14,
        realized_volatility=0.12,
    )
    second = await get_or_create_daily_snapshot(
        db_session,
        symbol="NIFTY",
        snapshot_date=datetime(2026, 7, 29, tzinfo=UTC).date(),
        atm_iv=0.20,
        realized_volatility=0.13,
    )
    repeated = await get_or_create_daily_snapshot(
        db_session,
        symbol="NIFTY",
        snapshot_date=datetime(2026, 7, 29, tzinfo=UTC).date(),
        atm_iv=0.99,
        realized_volatility=0.99,
    )

    assert first.iv_rank == 0
    assert second.iv_rank == 100
    assert repeated.atm_iv == 0.20
