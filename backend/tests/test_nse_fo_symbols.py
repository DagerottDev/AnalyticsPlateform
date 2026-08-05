"""Regression coverage for current broker-facing F&O underlying symbols."""

from app.data.nse_fo_symbols import NSE_FO_SYMBOLS


def test_united_spirits_uses_its_current_nse_symbol() -> None:
    assert NSE_FO_SYMBOLS["UNITDSPR"] == "United Spirits"
    assert "MCDOWELL-N" not in NSE_FO_SYMBOLS


def test_current_renamed_fyers_underlyings_are_used() -> None:
    assert NSE_FO_SYMBOLS["TMPV"] == "Tata Motors Passenger Vehicles"
    assert NSE_FO_SYMBOLS["LTM"] == "LTIMindtree"
    assert NSE_FO_SYMBOLS["ETERNAL"] == "Eternal"
    assert "TATAMOTORS" not in NSE_FO_SYMBOLS
    assert "LTIM" not in NSE_FO_SYMBOLS
    assert "ZOMATO" not in NSE_FO_SYMBOLS
