import asyncio
import time
from datetime import UTC, date, datetime, timedelta
from math import log, sqrt
from statistics import pstdev
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.data.nse_fo_symbols import NSE_FO_SYMBOLS
from app.db.session import get_db
from app.models.volatility_snapshot import DailyVolatilitySnapshot
from app.schemas.volatility import IvUniverseResponse, IvUniverseStatus, IvUniverseSymbol
from app.services.atm_iv import compute_atm_iv
from app.services.fno_symbol_store import fno_symbol_store
from app.services.fo_iv_universe_store import load_latest_snapshot_per_symbol
from app.services.fyers_service import to_fyers_ws_symbol
from app.services.greeks import calculate_greeks, calculate_implied_volatility
from app.services.iv_stats import iv_percentile, iv_rank
from app.services.lot_size_store import lot_size_store
from app.services.option_math import DEFAULT_RISK_FREE_RATE, time_to_expiry
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
DEFAULT_RELATIVE_VALUE_SYMBOLS = ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX")
MAX_RELATIVE_VALUE_SYMBOLS = 6
IV_UNIVERSE_STALE_AFTER = timedelta(hours=2)

# Daily candles do not change meaningfully more than once per trading day.
# Keeping a short server-side cache avoids each Volatility page load issuing
# duplicate 1-year history calls to Fyers, whose history API is rate-limited.
_DAILY_CLOSES_CACHE_TTL_SECONDS = 15 * 60
_daily_closes_cache: dict[tuple[int, str, int], tuple[float, list[tuple[datetime, float]]]] = {}
_daily_closes_locks: dict[tuple[int, str, int], asyncio.Lock] = {}
_daily_snapshot_locks: dict[tuple[str, date], asyncio.Lock] = {}


async def _iv_universe_symbols(current_user: dict[str, Any]) -> dict[str, str]:
    """Use the live Fyers option universe when that broker is active."""
    service = session_manager.get_session(current_user["sub"])
    if getattr(service, "supports_live_fno_symbol_master", False) is True:
        return await fno_symbol_store.get(NSE_FO_SYMBOLS)
    return NSE_FO_SYMBOLS


async def _compute_live_atm_iv(symbol: str, current_user: dict[str, Any]) -> float | None:
    """Calculate current ATM IV from the nearest-expiry CE/PE quote pair."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        return None
    result = await compute_atm_iv(service, symbol)
    return result[0] if result is not None else None


def _contract_quote_price(quotes: list[dict[str, Any]], trading_symbol: str) -> float | None:
    """Return a positive price while tolerating Fyers' alternate quote keys."""
    for quote in quotes:
        quote_symbol = str(quote.get("trading_symbol") or quote.get("symbol") or "")
        if quote_symbol == trading_symbol:
            price = quote.get("last_price") or quote.get("lp")
            return float(price) if isinstance(price, int | float) and price > 0 else None
    return None


async def _relative_value_summary(
    symbol: str, current_user: dict[str, Any], db: AsyncSession
) -> dict[str, Any]:
    """Build a compact, nearest-expiry IV/skew/GEX snapshot for one underlying.

    It deliberately uses only four option quotes (ATM CE/PE and 2%-OTM CE/PE)
    per symbol. This keeps a multi-symbol comparison below the broker's rate
    limits while the full nearest-expiry chain's OI is still used for GEX.
    """
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")

    instruments = await service.get_instruments(symbol)
    today = datetime.now(UTC).date()
    contracts_with_expiry: list[tuple[date, dict[str, Any]]] = []
    for contract in instruments:
        if contract.get("option_type") not in ("CE", "PE") or not contract.get("strike"):
            continue
        try:
            expiry_date = datetime.strptime(str(contract["expiry"]), "%d-%b-%Y").date()
        except (KeyError, TypeError, ValueError):
            continue
        if expiry_date >= today:
            contracts_with_expiry.append((expiry_date, contract))
    if not contracts_with_expiry:
        raise ValueError("No active option contracts were returned")

    nearest_expiry = min(item[0] for item in contracts_with_expiry)
    contracts = [item[1] for item in contracts_with_expiry if item[0] == nearest_expiry]
    underlying_quotes = await service.get_quotes([symbol])
    if not underlying_quotes:
        raise ValueError("No underlying quote was returned")
    underlying_quote = underlying_quotes[0]
    spot = float(underlying_quote.get("last_price") or 0)
    if spot <= 0:
        raise ValueError("Underlying quote has no valid last price")

    def nearest_contract(option_type: str, target_strike: float) -> dict[str, Any]:
        candidates = [
            contract for contract in contracts if contract.get("option_type") == option_type
        ]
        if not candidates:
            raise ValueError(f"No {option_type} contracts were returned")
        return min(candidates, key=lambda contract: abs(float(contract["strike"]) - target_strike))

    atm_ce = nearest_contract("CE", spot)
    atm_pe = nearest_contract("PE", spot)
    otm_ce = nearest_contract("CE", spot * 1.02)
    otm_pe = nearest_contract("PE", spot * 0.98)
    quoted_contracts = [atm_ce, atm_pe, otm_ce, otm_pe]
    option_quotes = await service.get_quotes(
        [str(contract["trading_symbol"]) for contract in quoted_contracts]
    )
    maturity = time_to_expiry(datetime.combine(nearest_expiry, datetime.min.time(), tzinfo=UTC))

    def iv_for(contract: dict[str, Any]) -> float | None:
        price = _contract_quote_price(option_quotes, str(contract["trading_symbol"]))
        if price is None:
            return None
        iv = calculate_implied_volatility(
            contract["option_type"],
            spot,
            float(contract["strike"]),
            maturity,
            DEFAULT_RISK_FREE_RATE,
            price,
        )
        return iv if iv > 0 else None

    atm_ivs = [iv for iv in (iv_for(atm_ce), iv_for(atm_pe)) if iv is not None]
    if not atm_ivs:
        raise ValueError("Unable to derive an ATM implied volatility")
    atm_iv = sum(atm_ivs) / len(atm_ivs)
    call_iv = iv_for(otm_ce)
    put_iv = iv_for(otm_pe)
    skew = (put_iv - call_iv) if put_iv is not None and call_iv is not None else None

    # A full-chain OI total with the observed ATM volatility produces a
    # comparable gamma proxy without spending one quote request per strike.
    lot_size = await lot_size_store.get(symbol)
    if lot_size is None:
        raise ValueError(f"Unable to resolve a lot size for {symbol}")

    net_gex = 0.0
    for contract in contracts:
        option_type = contract["option_type"]
        strike = float(contract["strike"])
        oi = float(contract.get("oi") or 0)
        gamma = calculate_greeks(
            option_type, spot, strike, maturity, DEFAULT_RISK_FREE_RATE, atm_iv
        ).gamma
        net_gex += gamma * oi * lot_size * spot * (1 if option_type == "CE" else -1)

    snapshots = await load_daily_snapshots(db, symbol=symbol, from_date=date.min)
    iv_observations = [snapshot.atm_iv for snapshot in snapshots]
    computed_iv_rank = (
        iv_rank(iv_observations, atm_iv) if len(iv_observations) >= 2 else None
    )

    return {
        "symbol": symbol,
        "spot": round(spot, 2),
        "change_percent": float(underlying_quote.get("change_percent") or 0),
        "expiry": nearest_expiry.isoformat(),
        "atm_iv": round(atm_iv, 6),
        "put_iv": round(put_iv, 6) if put_iv is not None else None,
        "call_iv": round(call_iv, 6) if call_iv is not None else None,
        "skew": round(skew, 6) if skew is not None else None,
        "net_gex": round(net_gex, 2),
        "iv_rank": round(computed_iv_rank, 2) if computed_iv_rank is not None else None,
        "gex_model": "nearest-expiry OI, ATM-IV gamma proxy",
    }


@router.get("/compare")
async def compare_relative_value(
    symbols: str = Query(default=",".join(DEFAULT_RELATIVE_VALUE_SYMBOLS)),
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Compare nearest-expiry IV, skew and GEX across a small symbol basket.

    Partial results are intentional: one unavailable chain should not hide the
    other instruments, particularly while Fyers is rate-limiting an exchange.
    """
    requested_symbols = list(dict.fromkeys(
        item.strip().upper() for item in symbols.split(",") if item.strip()
    ))
    if not requested_symbols:
        raise HTTPException(status_code=422, detail="At least one symbol is required")
    if len(requested_symbols) > MAX_RELATIVE_VALUE_SYMBOLS:
        raise HTTPException(
            status_code=422, detail=f"Compare at most {MAX_RELATIVE_VALUE_SYMBOLS} symbols"
        )

    comparisons: list[dict[str, Any]] = []
    for symbol in requested_symbols:
        try:
            comparisons.append(await _relative_value_summary(symbol, current_user, db))
        except HTTPException:
            raise
        except Exception as exc:
            comparisons.append({"symbol": symbol, "error": str(exc)})
    return {"comparisons": comparisons, "generated_at": datetime.now(UTC).isoformat()}


@router.get("/universe", response_model=IvUniverseResponse)
async def get_iv_universe(
    current_user: dict[str, Any] = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IvUniverseResponse:
    """ATM IV / IV Rank / IV Percentile for every NSE F&O stock.

    Reads only the scheduled backfill's snapshot table; the current Fyers
    symbol master is cached separately, so no option-chain calls are made on
    this path.
    """
    snapshots = await load_latest_snapshot_per_symbol(db)
    by_symbol = {snapshot.symbol: snapshot for snapshot in snapshots}
    symbols: list[IvUniverseSymbol] = []
    generated_at = datetime.now(UTC)
    fno_symbols = await _iv_universe_symbols(current_user)
    for symbol, company_name in fno_symbols.items():
        snapshot = by_symbol.get(symbol)
        updated_at = snapshot.updated_at if snapshot is not None else None
        if updated_at is not None and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        status: IvUniverseStatus
        if snapshot is None:
            status = "building"
        elif updated_at is not None and generated_at - updated_at > IV_UNIVERSE_STALE_AFTER:
            status = "stale"
        elif snapshot.iv_rank is not None and snapshot.iv_percentile is not None:
            status = "ready"
        else:
            status = "building"
        symbols.append(
            IvUniverseSymbol(
                symbol=symbol,
                company_name=company_name,
                spot=snapshot.spot if snapshot else None,
                atm_iv=snapshot.atm_iv if snapshot else None,
                iv_rank=snapshot.iv_rank if snapshot else None,
                iv_percentile=snapshot.iv_percentile if snapshot else None,
                snapshot_date=snapshot.snapshot_date if snapshot else None,
                updated_at=updated_at,
                status=status,
            )
        )
    return IvUniverseResponse(symbols=symbols, generated_at=generated_at)


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
    if len(snapshots) >= 2:
        historical_ivs = [snapshot.atm_iv for snapshot in snapshots[:-1]]
        current_iv = snapshots[-1].atm_iv
    else:
        historical_ivs = [point["iv"] for point in data[:-1]]
        current_iv = data[-1]["iv"]
    all_ivs = [*historical_ivs, current_iv]

    return {
        "symbol": symbol,
        "current_iv": current_iv,
        "iv_rank": iv_rank(historical_ivs, current_iv),
        "iv_percentile": iv_percentile(historical_ivs, current_iv),
        "min_iv": min(all_ivs),
        "max_iv": max(all_ivs),
        "data_points": len(all_ivs),
    }
