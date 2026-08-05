"""Option-chain-adjacent utility math shared across services that price or
analyze options from a spot price: time-to-expiry, nearest-strike (ATM)
lookup, and the default spot/risk-free-rate fallbacks. Direct port of
frontend/src/lib/optionMath.ts — keep the two in sync.
"""

from datetime import UTC, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

OptionType = Literal["CE", "PE"]

# Risk-free rate used across payoff/Greeks/IV calculations for Indian markets.
DEFAULT_RISK_FREE_RATE = 0.10
IST = ZoneInfo("Asia/Kolkata")
FNO_CAS_EFFECTIVE_DATE = "2026-08-03"


def time_to_expiry(expiry: datetime | None, at: datetime | None = None) -> float:
    """Time-to-expiry (years) for an option, from `expiry` to `at` (defaults
    to now). Pegs to NSE F&O close (15:30 IST before 03-Aug-2026, 15:40 IST
    after) and floors at a small positive
    value so downstream Black-Scholes math never divides by / multiplies a
    zero T.
    """
    if expiry is None:
        return 0.0001
    at = at or datetime.now(UTC)
    expiry_date = expiry.astimezone(IST).date()
    close_minute = 40 if expiry_date.isoformat() >= FNO_CAS_EFFECTIVE_DATE else 30
    exp_at_close = datetime.combine(expiry_date, time(15, close_minute), tzinfo=IST)
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    at = at.astimezone(IST)
    diff_days = (exp_at_close - at) / timedelta(days=1)
    return max(diff_days / 365, 0.0001)


def nearest_strike_to(strikes: list[float], target: float) -> float:
    """The strike in `strikes` closest to `target` (e.g. the current spot price)."""
    if not strikes:
        return target
    return min(strikes, key=lambda s: abs(s - target))


def default_spot_fallback(symbol: str) -> float:
    """Fallback spot price used before a live tick has arrived for a symbol."""
    normalized = symbol.upper()
    if normalized == "NIFTY":
        return 22000.0
    if normalized == "SENSEX":
        return 80000.0
    return 48000.0
