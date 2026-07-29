import asyncio
import time
from datetime import UTC, date, datetime, timedelta
from math import log, sqrt
from statistics import pstdev
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.volatility_snapshot import DailyVolatilitySnapshot
from app.services.fyers_service import to_fyers_ws_symbol
from app.services.greeks import calculate_implied_volatility
from app.services.option_math import DEFAULT_RISK_FREE_RATE, nearest_strike_to, time_to_expiry
from app.services.session_manager import session_manager
from app.services.volatility_snapshot_store import (
    get_or_create_daily_snapshot,
    load_daily_snapshots,
)

router = APIRouter(prefix="/volatility", tags=["Volatility"])

TRADING_DAYS_PER_YEAR = 252
RV_WINDOW_DAYS = 20  # Rolling window for realized vol, the standard "20D RV" convention.

# Before a live ATM quote has been captured, the historical curve uses this
# realized-volatility proxy. Daily persisted ATM-IV snapshots override it as
# real observations accumulate from the day this feature is deployed.
IV_RISK_PREMIUM = 0.12
IV_SMOOTHING_ALPHA = 0.15

# Daily candles do not change meaningfully more than once per trading day.
# Keeping a short server-side cache avoids each Volatility page load issuing
# duplicate 1-year history calls to Fyers, whose history API is rate-limited.
_DAILY_CLOSES_CACHE_TTL_SECONDS = 15 * 60
_daily_closes_cache: dict[tuple[int, str, int], tuple[float, list[tuple[datetime, float]]]] = {}
_daily_closes_locks: dict[tuple[int, str, int], asyncio.Lock] = {}
_daily_snapshot_locks: dict[tuple[str, date], asyncio.Lock] = {}


async def _compute_live_atm_iv(symbol: str, current_user: dict[str, Any]) -> float | None:
    """Calculate current ATM IV from the nearest-expiry CE/PE quote pair."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        return None

    instruments = await service.get_instruments(symbol)
    today = datetime.now(UTC).date()
    dated_contracts: list[tuple[date, dict[str, Any]]] = []
    for instrument in instruments:
        expiry = instrument.get("expiry")
        if not expiry or instrument.get("option_type") not in ("CE", "PE"):
            continue
        try:
            expiry_date = datetime.strptime(expiry, "%d-%b-%Y").date()
        except ValueError:
            continue
        if expiry_date >= today and instrument.get("strike"):
            dated_contracts.append((expiry_date, instrument))
    if not dated_contracts:
        return None

    nearest_expiry = min(item[0] for item in dated_contracts)
    contracts = [item[1] for item in dated_contracts if item[0] == nearest_expiry]
    underlying_quotes = await service.get_quotes([symbol])
    if not underlying_quotes or underlying_quotes[0].get("last_price", 0) <= 0:
        return None
    spot = float(underlying_quotes[0]["last_price"])
    atm_strike = nearest_strike_to([float(item["strike"]) for item in contracts], spot)
    atm_contracts = [item for item in contracts if float(item["strike"]) == atm_strike]
    option_quotes = await service.get_quotes([item["trading_symbol"] for item in atm_contracts])
    prices = {
        str(item.get("trading_symbol")): float(item["last_price"])
        for item in option_quotes
        if item.get("last_price", 0) > 0
    }
    expiry_at = datetime.combine(nearest_expiry, datetime.min.time(), tzinfo=UTC)
    maturity = time_to_expiry(expiry_at)

    ivs: list[float] = []
    for contract in atm_contracts:
        price = prices.get(str(contract["trading_symbol"]))
        if price is None:
            continue
        iv = calculate_implied_volatility(
            contract["option_type"], spot, atm_strike, maturity, DEFAULT_RISK_FREE_RATE, price
        )
        if iv > 0:
            ivs.append(iv)
    return sum(ivs) / len(ivs) if ivs else None


async def _capture_daily_atm_iv(
    db: AsyncSession, symbol: str, current_user: dict[str, Any], series: list[dict[str, Any]]
) -> DailyVolatilitySnapshot | None:
    """Capture exactly one real ATM-IV observation for this symbol/day."""
    if not series:
        return None
    snapshot_date = datetime.now(UTC).date()
    normalized_symbol = symbol.upper()
    lock = _daily_snapshot_locks.setdefault((normalized_symbol, snapshot_date), asyncio.Lock())
    async with lock:
        existing = await db.get(DailyVolatilitySnapshot, (normalized_symbol, snapshot_date))
        if existing is not None:
            return existing
        try:
            atm_iv = await _compute_live_atm_iv(normalized_symbol, current_user)
        except Exception:
            # A snapshot enriches analytics but must never make the historical
            # curve unavailable if Fyers' option/quote endpoints are busy.
            return None
        if atm_iv is None:
            return None
        return await get_or_create_daily_snapshot(
            db,
            symbol=normalized_symbol,
            snapshot_date=snapshot_date,
            atm_iv=atm_iv,
            realized_volatility=float(series[-1]["rv"]),
        )


def _merge_snapshots(
    series: list[dict[str, Any]], snapshots: list[DailyVolatilitySnapshot]
) -> list[dict[str, Any]]:
    """Overlay persisted real ATM IV values onto the realized-vol proxy curve."""
    snapshot_by_date = {
        snapshot.snapshot_date.isoformat(): snapshot for snapshot in snapshots
    }
    merged = [
        {
            **point,
            "iv": snapshot_by_date[point["date"]].atm_iv,
            "rv": snapshot_by_date[point["date"]].realized_volatility,
        }
        if point["date"] in snapshot_by_date
        else point
        for point in series
    ]
    present_dates = {point["date"] for point in merged}
    for snapshot in snapshots:
        if snapshot.snapshot_date.isoformat() not in present_dates:
            merged.append(
                {
                    "date": snapshot.snapshot_date.isoformat(),
                    "iv": snapshot.atm_iv,
                    "rv": snapshot.realized_volatility,
                }
            )
    return sorted(merged, key=lambda point: point["date"])


async def _fetch_daily_closes(
    symbol: str, current_user: dict[str, Any], calendar_days: int
) -> list[tuple[datetime, float]]:
    """Real daily closes for `symbol`, pulled live from the broker (same path as /market/history)."""  # noqa: E501
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    cache_key = (id(service), symbol.upper(), calendar_days)
    cached = _daily_closes_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < _DAILY_CLOSES_CACHE_TTL_SECONDS:
        return cached[1]

    lock = _daily_closes_locks.setdefault(cache_key, asyncio.Lock())
    async with lock:
        # The other volatility endpoint may have populated the cache while
        # this request waited; share that result instead of hitting Fyers.
        cached = _daily_closes_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < _DAILY_CLOSES_CACHE_TTL_SECONDS:
            return cached[1]

        fyers_symbol = to_fyers_ws_symbol(symbol.upper())
        to_date = datetime.now(UTC)
        from_date = to_date - timedelta(days=calendar_days)
        candles = await service.get_historical_data(
            fyers_symbol, from_date.strftime("%Y-%m-%d"), to_date.strftime("%Y-%m-%d"), "D"
        )
        closes = [(c["timestamp"], c["close"]) for c in candles if c.get("close")]
        _daily_closes_cache[cache_key] = (time.monotonic(), closes)
        return closes


def _compute_vol_series(closes: list[tuple[datetime, float]]) -> list[dict[str, Any]]:
    """Rolling annualized realized vol from real closes, plus the IV proxy described above."""
    if len(closes) < RV_WINDOW_DAYS + 2:
        return []

    log_returns = [
        log(closes[i][1] / closes[i - 1][1])
        for i in range(1, len(closes))
        if closes[i - 1][1] > 0
    ]

    series: list[dict[str, Any]] = []
    smoothed_iv: float | None = None

    for i in range(RV_WINDOW_DAYS, len(log_returns) + 1):
        window = log_returns[i - RV_WINDOW_DAYS : i]
        rv = pstdev(window) * sqrt(TRADING_DAYS_PER_YEAR)
        proxy_iv = rv * (1 + IV_RISK_PREMIUM)
        smoothed_iv = (
            proxy_iv
            if smoothed_iv is None
            else IV_SMOOTHING_ALPHA * proxy_iv + (1 - IV_SMOOTHING_ALPHA) * smoothed_iv
        )

        # log_returns[i - 1] is the return realized on closes[i]'s date.
        date = closes[i][0]
        series.append(
            {
                "date": date.strftime("%Y-%m-%d"),
                "iv": round(smoothed_iv, 4),
                "rv": round(rv, 4),
            }
        )

    return series


@router.get("/{symbol}/historical")
async def get_historical_volatility(
    symbol: str,
    days: int = 252,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Realized-vol history overlaid with persisted daily ATM-IV observations."""
    # Fetch extra calendar days to cover weekends/holidays plus the rolling window's warm-up.
    calendar_days = int((days + RV_WINDOW_DAYS) * 1.6) + 10
    closes = await _fetch_daily_closes(symbol, current_user, calendar_days)
    series = _compute_vol_series(closes)
    await _capture_daily_atm_iv(db, symbol, current_user, series)
    snapshots = await load_daily_snapshots(
        db,
        symbol=symbol,
        from_date=datetime.now(UTC).date() - timedelta(days=calendar_days),
    )
    return _merge_snapshots(series, snapshots)[-days:]


@router.get("/{symbol}/metrics")
async def get_volatility_metrics(
    symbol: str,
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Current IV Rank/Percentile, using daily ATM-IV observations when available."""
    calendar_days = int((TRADING_DAYS_PER_YEAR + RV_WINDOW_DAYS) * 1.6) + 10
    closes = await _fetch_daily_closes(symbol, current_user, calendar_days)
    data = _compute_vol_series(closes)
    if not data:
        raise HTTPException(status_code=404, detail="No historical data found")

    await _capture_daily_atm_iv(db, symbol, current_user, data)
    snapshots = await load_daily_snapshots(db, symbol=symbol, from_date=date.min)
    ivs = (
        [snapshot.atm_iv for snapshot in snapshots]
        if len(snapshots) >= 2
        else [d["iv"] for d in data]
    )
    current_iv = ivs[-1]

    # IV Rank = (Current IV - Min IV) / (Max IV - Min IV) * 100
    min_iv = min(ivs)
    max_iv = max(ivs)
    ivr = ((current_iv - min_iv) / (max_iv - min_iv)) * 100 if max_iv > min_iv else 0

    # IV Percentile = Percentage of days where historical IV < Current IV
    days_below = sum(1 for iv in ivs if iv < current_iv)
    ivp = (days_below / len(ivs)) * 100

    return {
        "symbol": symbol,
        "current_iv": current_iv,
        "iv_rank": ivr,
        "iv_percentile": ivp,
        "min_iv": min_iv,
        "max_iv": max_iv,
        "data_points": len(ivs),
    }
