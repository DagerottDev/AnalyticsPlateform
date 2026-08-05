"""Optional historical ATM-IV seeding for the F&O universe screener.

Fyers exposes daily candles for exchange-qualified option symbols.  We use
those candles only when the active broker explicitly advertises option-history
support, selecting the nearest currently listed expiry and closest paired CE/
PE strike for each historical underlying close.  Brokers that expose only
current option quotes return an empty seed instead of being queried with an
incorrect chart payload.
"""

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from math import isfinite
from typing import Any, cast
from zoneinfo import ZoneInfo

from app.core.exceptions import BrokerAuthError
from app.services.fyers_service import to_fyers_ws_symbol
from app.services.greeks import calculate_implied_volatility
from app.services.option_math import DEFAULT_RISK_FREE_RATE, OptionType, time_to_expiry

IST = ZoneInfo("Asia/Kolkata")
FNO_CAS_EFFECTIVE_DATE = date(2026, 8, 3)


@dataclass(frozen=True)
class HistoricalIvObservation:
    """One daily ATM-IV observation reconstructed from broker candles."""

    snapshot_date: date
    atm_iv: float
    spot: float


@dataclass(frozen=True)
class _OptionContract:
    trading_symbol: str
    expiry: date
    strike: float
    option_type: str


def _candle_date(value: object) -> date | None:
    """Normalize Fyers datetime/epoch candle timestamps to an IST date."""
    if isinstance(value, datetime):
        timestamp = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    elif isinstance(value, int | float):
        timestamp = datetime.fromtimestamp(value, tz=UTC)
    else:
        return None
    return timestamp.astimezone(IST).date()


def _positive_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if isfinite(number) and number > 0 else None


def _parse_contracts(instruments: list[dict[str, Any]]) -> list[_OptionContract]:
    contracts: list[_OptionContract] = []
    for raw in instruments:
        option_type = str(raw.get("option_type") or "").upper()
        trading_symbol = str(raw.get("trading_symbol") or "").strip()
        strike = _positive_float(raw.get("strike"))
        expiry_value = raw.get("expiry")
        if option_type not in {"CE", "PE"} or not trading_symbol or strike is None:
            continue
        try:
            expiry = datetime.strptime(str(expiry_value), "%d-%b-%Y").date()
        except (TypeError, ValueError):
            continue
        contracts.append(
            _OptionContract(
                trading_symbol=trading_symbol,
                expiry=expiry,
                strike=strike,
                option_type=option_type,
            )
        )
    return contracts


def _market_close_at(session_date: date) -> datetime:
    close_minute = 40 if session_date >= FNO_CAS_EFFECTIVE_DATE else 30
    return datetime.combine(session_date, time(15, close_minute), tzinfo=IST)


def _daily_close_map(candles: list[dict[str, Any]]) -> dict[date, float]:
    closes: dict[date, float] = {}
    for candle in candles:
        candle_date = _candle_date(candle.get("timestamp"))
        close = _positive_float(candle.get("close"))
        if candle_date is not None and close is not None:
            closes[candle_date] = close
    return closes


def _select_daily_contracts(
    contracts: list[_OptionContract],
    spot_by_date: Mapping[date, float],
    *,
    today: date,
) -> dict[date, tuple[_OptionContract, _OptionContract]]:
    """Choose a paired CE/PE at the nearest available expiry for each date."""
    selections: dict[date, tuple[_OptionContract, _OptionContract]] = {}
    for session_date, spot in sorted(spot_by_date.items()):
        if session_date >= today:
            continue
        eligible = [contract for contract in contracts if contract.expiry >= session_date]
        if not eligible:
            continue
        nearest_expiry = min(contract.expiry for contract in eligible)
        pairs: dict[float, dict[str, _OptionContract]] = {}
        for contract in eligible:
            if contract.expiry == nearest_expiry:
                pairs.setdefault(contract.strike, {})[contract.option_type] = contract
        paired_strikes = [
            strike for strike, pair in pairs.items() if "CE" in pair and "PE" in pair
        ]
        if not paired_strikes:
            continue
        strike = min(paired_strikes, key=lambda value: abs(value - spot))
        pair = pairs[strike]
        selections[session_date] = (pair["CE"], pair["PE"])
    return selections


async def seed_historical_atm_iv(
    service: Any,
    symbol: str,
    *,
    today: date,
    lookback_days: int,
    request_delay_seconds: float = 0.0,
) -> list[HistoricalIvObservation]:
    """Reconstruct prior daily ATM IV values for one symbol when supported.

    A missing option history response is treated as an unavailable seed for
    that contract, while authentication errors are propagated so the caller
    can invalidate the broker session.  The function never fabricates IV from
    realized volatility; an empty list means no true option-history seed was
    available.
    """
    if getattr(service, "supports_historical_options", False) is not True:
        return []

    from_date = today - timedelta(days=lookback_days)
    end_date = today - timedelta(days=1)
    try:
        underlying_candles = await service.get_historical_data(
            to_fyers_ws_symbol(symbol),
            from_date.isoformat(),
            end_date.isoformat(),
            "D",
        )
        instruments = await service.get_instruments(symbol)
    except BrokerAuthError:
        raise
    except Exception:
        return []

    spot_by_date = _daily_close_map(underlying_candles)
    contracts = _parse_contracts(instruments)
    selections = _select_daily_contracts(contracts, spot_by_date, today=today)
    if not selections:
        return []

    option_symbols = sorted(
        {
            contract.trading_symbol
            for pair in selections.values()
            for contract in pair
        }
    )
    option_closes: dict[str, dict[date, float]] = {}
    for index, trading_symbol in enumerate(option_symbols):
        if index and request_delay_seconds > 0:
            await asyncio.sleep(request_delay_seconds)
        try:
            candles = await service.get_historical_data(
                trading_symbol,
                from_date.isoformat(),
                end_date.isoformat(),
                "D",
            )
        except BrokerAuthError:
            raise
        except Exception:
            continue
        closes = _daily_close_map(candles)
        if closes:
            option_closes[trading_symbol] = closes

    observations: list[HistoricalIvObservation] = []
    for session_date, (call, put) in selections.items():
        spot = spot_by_date[session_date]
        call_price = option_closes.get(call.trading_symbol, {}).get(session_date)
        put_price = option_closes.get(put.trading_symbol, {}).get(session_date)
        if call_price is None or put_price is None:
            continue
        expiry_at = datetime.combine(call.expiry, datetime.min.time(), tzinfo=UTC)
        maturity = time_to_expiry(expiry_at, at=_market_close_at(session_date))
        ivs = [
            calculate_implied_volatility(
                cast(OptionType, option_type),
                spot,
                call.strike,
                maturity,
                DEFAULT_RISK_FREE_RATE,
                price,
            )
            for option_type, price in (("CE", call_price), ("PE", put_price))
        ]
        valid_ivs = [iv for iv in ivs if isfinite(iv) and iv > 0]
        if not valid_ivs:
            continue
        observations.append(
            HistoricalIvObservation(
                snapshot_date=session_date,
                atm_iv=sum(valid_ivs) / len(valid_ivs),
                spot=spot,
            )
        )
    return observations
