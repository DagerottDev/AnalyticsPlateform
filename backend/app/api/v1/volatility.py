from datetime import UTC, datetime, timedelta
from math import log, sqrt
from statistics import pstdev
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user
from app.services.fyers_service import to_fyers_ws_symbol
from app.services.session_manager import session_manager

router = APIRouter(prefix="/volatility", tags=["Volatility"])

TRADING_DAYS_PER_YEAR = 252
RV_WINDOW_DAYS = 20  # Rolling window for realized vol, the standard "20D RV" convention.

# There's no persisted historical option-chain to solve real historical IV
# from yet (see the "iv-snapshot-storage" roadmap item, which starts
# accumulating real daily IV snapshots going forward). Until that exists,
# IV here is a smoothed multiple of the real realized vol below rather than
# a market-quoted number — smoothed because implied vol reacts less noisily
# than realized vol day-to-day, multiplied up because IV structurally runs
# above RV (the variance risk premium).
IV_RISK_PREMIUM = 0.12
IV_SMOOTHING_ALPHA = 0.15


async def _fetch_daily_closes(
    symbol: str, current_user: dict[str, Any], calendar_days: int
) -> list[tuple[datetime, float]]:
    """Real daily closes for `symbol`, pulled live from the broker (same path as /market/history)."""  # noqa: E501
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    fyers_symbol = to_fyers_ws_symbol(symbol.upper())
    to_date = datetime.now(UTC)
    from_date = to_date - timedelta(days=calendar_days)

    candles = await service.get_historical_data(
        fyers_symbol, from_date.strftime("%Y-%m-%d"), to_date.strftime("%Y-%m-%d"), "D"
    )
    return [(c["timestamp"], c["close"]) for c in candles if c.get("close")]


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
) -> list[dict[str, Any]]:
    """Timeseries of realized (and IV-proxy) volatility, computed from real daily OHLCV history."""
    # Fetch extra calendar days to cover weekends/holidays plus the rolling window's warm-up.
    calendar_days = int((days + RV_WINDOW_DAYS) * 1.6) + 10
    closes = await _fetch_daily_closes(symbol, current_user, calendar_days)
    series = _compute_vol_series(closes)
    return series[-days:]


@router.get("/{symbol}/metrics")
async def get_volatility_metrics(
    symbol: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Current IV Rank (IVR) and IV Percentile (IVP), derived from the same real-OHLCV-based series."""  # noqa: E501
    calendar_days = int((TRADING_DAYS_PER_YEAR + RV_WINDOW_DAYS) * 1.6) + 10
    closes = await _fetch_daily_closes(symbol, current_user, calendar_days)
    data = _compute_vol_series(closes)
    if not data:
        raise HTTPException(status_code=404, detail="No historical data found")

    ivs = [d["iv"] for d in data]
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
