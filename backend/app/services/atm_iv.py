"""Live ATM implied-volatility computation from a broker's option chain."""

from datetime import UTC, date, datetime
from typing import Any

from app.services.greeks import calculate_implied_volatility
from app.services.option_math import DEFAULT_RISK_FREE_RATE, nearest_strike_to, time_to_expiry


async def compute_atm_iv(service: Any, symbol: str) -> tuple[float, float] | None:
    """Calculate current ATM IV and spot from the nearest-expiry CE/PE quote pair.

    Returns ``(atm_iv, spot)``, or ``None`` if the chain/quotes were unavailable.
    """
    instruments = await service.get_nearest_expiry_instruments(symbol)
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
    if not ivs:
        return None
    return sum(ivs) / len(ivs), spot
