from datetime import UTC, datetime

from app.services.market_session import is_fno_symbol, is_regular_market_open


def test_cas_extension_keeps_fno_open_at_1535_but_cash_closed() -> None:
    at_1535_ist = datetime(2026, 8, 3, 10, 5, tzinfo=UTC)
    assert is_regular_market_open(at_1535_ist, "fno")
    assert not is_regular_market_open(at_1535_ist, "cash")
    assert not is_regular_market_open(datetime(2026, 8, 3, 10, 10, tzinfo=UTC), "fno")


def test_pre_effective_fno_close_and_symbol_classification() -> None:
    assert not is_regular_market_open(datetime(2026, 7, 31, 10, 5, tzinfo=UTC), "fno")
    assert is_fno_symbol("NFO:NIFTY26AUG22000CE")
    assert is_fno_symbol("NSE_FNO:12345")
    assert not is_fno_symbol("NSE:SBIN-EQ")
