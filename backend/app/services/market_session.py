"""Date-aware NSE regular-session timing for cash and equity derivatives."""

from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

MarketSegment = Literal["fno", "cash"]
IST = ZoneInfo("Asia/Kolkata")
FNO_CAS_EFFECTIVE_DATE = "2026-08-03"


def is_fno_symbol(symbol: str) -> bool:
    normalized = symbol.strip().upper()
    return not (normalized.startswith("NSE:") and normalized.endswith("-EQ"))


def fno_close_minutes(now: datetime) -> int:
    local = now.astimezone(IST)
    date_key = local.strftime("%Y-%m-%d")
    return 15 * 60 + (40 if date_key >= FNO_CAS_EFFECTIVE_DATE else 30)


def is_regular_market_open(
    now: datetime | None = None, segment: MarketSegment = "fno"
) -> bool:
    local = (now or datetime.now(UTC)).astimezone(IST)
    if local.weekday() >= 5:
        return False
    minutes = local.hour * 60 + local.minute
    close = fno_close_minutes(local) if segment == "fno" else 15 * 60 + 30
    return 9 * 60 + 15 <= minutes < close
