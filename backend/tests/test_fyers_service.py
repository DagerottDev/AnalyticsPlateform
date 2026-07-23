"""Tests for FyersService's real (non-stub) broker API integrations."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import BrokerConnectionError
from app.models.user import TradingMode
from app.services.fyers_service import FyersService, from_fyers_ws_symbol, to_fyers_ws_symbol


def _make_service() -> FyersService:
    with patch("app.services.fyers_service.fyersModel.FyersModel"):
        return FyersService(
            app_id="TESTAPP-100",
            access_token="real-looking-token",  # noqa: S106 - not a real credential
            trading_mode=TradingMode.PAPER,
        )


@pytest.mark.asyncio
async def test_get_historical_data_parses_candles() -> None:
    """A successful Fyers `history()` response maps candles to MarketData-shaped rows."""
    service = _make_service()
    service.client.history = MagicMock(
        return_value={
            "s": "ok",
            "candles": [
                [1700000000, 100.0, 105.0, 99.0, 104.0, 1234],
                [1700000060, 104.0, 106.0, 103.5, 105.5, 987],
            ],
        }
    )

    rows = await service.get_historical_data(
        "NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "1"
    )

    assert len(rows) == 2
    assert rows[0]["open"] == 100.0
    assert rows[0]["high"] == 105.0
    assert rows[0]["low"] == 99.0
    assert rows[0]["close"] == 104.0
    assert rows[0]["volume"] == 1234
    assert rows[0]["open_interest"] == 0
    assert rows[0]["timestamp"].timestamp() == 1700000000

    service.client.history.assert_called_once_with(
        {
            "symbol": "NSE:NIFTY50-INDEX",
            "resolution": "1",
            "date_format": 1,
            "range_from": "2023-11-15",
            "range_to": "2023-11-15",
            "cont_flag": 0,
        }
    )


@pytest.mark.asyncio
async def test_get_historical_data_no_data_returns_empty_list() -> None:
    """Fyers' 'no_data' status is a legitimate empty result, not an error."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "no_data"})

    rows = await service.get_historical_data("NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "1")

    assert rows == []


@pytest.mark.asyncio
async def test_get_historical_data_error_raises_broker_connection_error() -> None:
    """A genuine Fyers error status raises, rather than silently returning []."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "error", "message": "Invalid symbol"})

    with pytest.raises(BrokerConnectionError):
        await service.get_historical_data("NSE:BADSYM-EQ", "2023-11-15", "2023-11-15", "1")


def _expiry_discovery_response(*expiries: tuple[str, str]) -> dict[str, Any]:
    return {
        "s": "ok",
        "data": {"expiryData": [{"date": date, "expiry": ts} for date, ts in expiries]},
    }


def _chain_response(*rows: dict[str, Any]) -> dict[str, Any]:
    return {"s": "ok", "data": {"optionsChain": list(rows)}}


@pytest.mark.asyncio
async def test_get_instruments_parses_option_chain_across_expiries() -> None:
    """A successful multi-expiry response is flattened into CE/PE instruments,
    skipping the underlying/index row (empty option_type)."""
    service = _make_service()
    near_expiry = ("10-Jul-2025", "1752105000")
    far_expiry = ("17-Jul-2025", "1752709800")
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(near_expiry, far_expiry),
            _chain_response(
                {"symbol": "NSE:NIFTY50-INDEX", "option_type": "", "strike_price": -1},
                {"symbol": "NSE:NIFTY25071017500CE", "option_type": "CE", "strike_price": 17500},
                {"symbol": "NSE:NIFTY25071017500PE", "option_type": "PE", "strike_price": 17500},
            ),
            _chain_response(
                {"symbol": "NSE:NIFTY25071717500CE", "option_type": "CE", "strike_price": 17500},
                {"symbol": "NSE:NIFTY25071717500PE", "option_type": "PE", "strike_price": 17500},
            ),
        ]
    )

    instruments = await service.get_instruments("NIFTY")

    assert len(instruments) == 4
    assert {i["expiry"] for i in instruments} == {"09-Jul-2025", "16-Jul-2025"}
    assert all(i["exchange"] == "NFO" and i["instrument_type"] == "OPTIDX" for i in instruments)
    assert all(i["option_type"] in ("CE", "PE") for i in instruments)

    discovery_call = service.client.optionchain.call_args_list[0].args[0]
    assert discovery_call == {"symbol": "NSE:NIFTY50-INDEX", "strikecount": 1, "timestamp": ""}


@pytest.mark.asyncio
async def test_get_instruments_parses_oi_change_fields() -> None:
    """oi/oich/oichp from Fyers' optionchain rows are passed through so the
    frontend can classify long/short buildup; missing on the index row is fine."""
    service = _make_service()
    near_expiry = ("10-Jul-2025", "1752105000")
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(near_expiry),
            _chain_response(
                {"symbol": "NSE:NIFTY50-INDEX", "option_type": "", "strike_price": -1},
                {
                    "symbol": "NSE:NIFTY25071017500CE",
                    "option_type": "CE",
                    "strike_price": 17500,
                    "oi": 125000,
                    "oich": 15000,
                    "oichp": 13.6,
                },
            ),
        ]
    )

    instruments = await service.get_instruments("NIFTY")

    ce = next(i for i in instruments if i["option_type"] == "CE")
    assert ce["oi"] == 125000
    assert ce["oi_change"] == 15000
    assert ce["oi_change_percent"] == 13.6


@pytest.mark.asyncio
async def test_get_instruments_maps_equity_symbols_to_nse_eq() -> None:
    """Non-index symbols are treated as NSE equities, not exchange indices."""
    service = _make_service()
    reliance_row = {"symbol": "NSE:RELIANCE25073000CE", "option_type": "CE", "strike_price": 3000}
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(("31-Jul-2025", "1753905000")),
            _chain_response(reliance_row),
        ]
    )

    instruments = await service.get_instruments("reliance")

    assert instruments[0]["instrument_type"] == "OPTSTK"
    discovery_call = service.client.optionchain.call_args_list[0].args[0]
    assert discovery_call["symbol"] == "NSE:RELIANCE-EQ"


@pytest.mark.asyncio
async def test_get_instruments_raises_when_expiry_discovery_fails() -> None:
    """A Fyers error on the initial (expiry-discovery) call surfaces, rather
    than silently returning an empty instrument list."""
    service = _make_service()
    service.client.optionchain = MagicMock(return_value={"s": "error", "message": "Invalid symbol"})

    with pytest.raises(BrokerConnectionError):
        await service.get_instruments("NIFTY")


@pytest.mark.asyncio
async def test_get_instruments_skips_an_expiry_that_fails() -> None:
    """One bad expiry's chain call doesn't fail the whole request."""
    service = _make_service()
    near_expiry = ("10-Jul-2025", "1752105000")
    far_expiry = ("17-Jul-2025", "1752709800")
    far_row = {"symbol": "NSE:NIFTY25071717500CE", "option_type": "CE", "strike_price": 17500}
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(near_expiry, far_expiry),
            {"s": "error", "message": "temporary issue"},
            _chain_response(far_row),
        ]
    )

    instruments = await service.get_instruments("NIFTY")

    assert len(instruments) == 1
    assert instruments[0]["expiry"] == "16-Jul-2025"


@pytest.mark.asyncio
async def test_get_instruments_caches_within_ttl() -> None:
    """Back-to-back calls for the same symbol (expiries + instruments on
    page load) don't double the number of Fyers API calls."""
    service = _make_service()
    near_row = {"symbol": "NSE:NIFTY25071017500CE", "option_type": "CE", "strike_price": 17500}
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(("10-Jul-2025", "1752105000")),
            _chain_response(near_row),
        ]
    )

    first = await service.get_instruments("NIFTY")
    second = await service.get_instruments("NIFTY")

    assert first == second
    assert service.client.optionchain.call_count == 2  # not 4


@pytest.mark.asyncio
async def test_get_instruments_deduplicates_concurrent_calls_for_same_symbol() -> None:
    """Two callers requesting the same symbol at the same time (e.g. the
    /instruments and /expiries endpoints firing together on page load) share
    one fetch instead of each independently bursting calls at Fyers."""
    service = _make_service()
    near_row = {"symbol": "NSE:NIFTY25071017500CE", "option_type": "CE", "strike_price": 17500}
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(("10-Jul-2025", "1752105000")),
            _chain_response(near_row),
        ]
    )

    first, second = await asyncio.gather(
        service.get_instruments("NIFTY"), service.get_instruments("NIFTY")
    )

    assert first == second
    assert service.client.optionchain.call_count == 2  # not 4 — no duplicate fetch


@pytest.mark.asyncio
async def test_get_instruments_retries_on_rate_limit_then_succeeds() -> None:
    """A transient 429 from Fyers is retried with backoff rather than
    failing the whole request."""
    service = _make_service()
    near_row = {"symbol": "NSE:NIFTY25071017500CE", "option_type": "CE", "strike_price": 17500}
    rate_limited = {"s": "error", "code": 429, "message": "request limit reached"}
    service.client.optionchain = MagicMock(
        side_effect=[
            rate_limited,
            _expiry_discovery_response(("10-Jul-2025", "1752105000")),
            _chain_response(near_row),
        ]
    )

    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()):
        instruments = await service.get_instruments("NIFTY")

    assert len(instruments) == 1
    assert service.client.optionchain.call_count == 3


@pytest.mark.asyncio
async def test_get_instruments_gives_up_after_max_retries_on_persistent_rate_limit() -> None:
    """A persistent 429 (not just a one-off blip) still surfaces as an
    error after exhausting retries, rather than retrying forever."""
    service = _make_service()
    service.client.optionchain = MagicMock(
        return_value={"s": "error", "code": 429, "message": "request limit reached"}
    )

    with (
        patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()),
        pytest.raises(BrokerConnectionError),
    ):
        await service.get_instruments("NIFTY")

    assert service.client.optionchain.call_count == FyersService._MAX_FETCH_RETRIES


@pytest.mark.asyncio
async def test_get_quotes_does_not_double_prefix_already_qualified_symbols() -> None:
    """Regression test: get_quotes used to run every symbol through
    _to_fyers_symbol unconditionally, which double-wrapped an
    already-exchange-qualified option trading symbol into
    "NSE:NSE:...-EQ" — rejected by Fyers with 'Please provide a valid
    symbol'. Bare underlying aliases still need the NSE:...-EQ mapping;
    already-qualified symbols must pass through untouched."""
    service = _make_service()
    service.client.quotes = MagicMock(
        return_value={
            "s": "ok",
            "d": [
                {"n": "NSE:RELIANCE-EQ", "v": {"lp": 1300.0}, "s": "ok"},
                {"n": "NSE:NIFTY26JUL23000PE", "v": {"lp": 50.0}, "s": "ok"},
            ],
        }
    )

    await service.get_quotes(["RELIANCE", "NSE:NIFTY26JUL23000PE"])

    service.client.quotes.assert_called_once_with(
        {"symbols": "NSE:RELIANCE-EQ,NSE:NIFTY26JUL23000PE"}
    )


def test_to_fyers_ws_symbol_maps_bare_index_alias() -> None:
    """A bare underlying alias (what the UI subscribes for the underlying's
    own price) must be exchange-qualified before reaching Fyers — a bare
    'NIFTY' is rejected by Fyers' websocket subscribe with 'Please provide
    a valid symbol'."""
    assert to_fyers_ws_symbol("NIFTY") == "NSE:NIFTY50-INDEX"
    assert to_fyers_ws_symbol("nifty") == "NSE:NIFTY50-INDEX"


def test_to_fyers_ws_symbol_maps_bare_equity_alias() -> None:
    assert to_fyers_ws_symbol("RELIANCE") == "NSE:RELIANCE-EQ"


def test_to_fyers_ws_symbol_passes_through_already_qualified_trading_symbols() -> None:
    """An option contract's trading_symbol is already exchange-qualified —
    re-mapping it would double-prefix it into something invalid."""
    assert to_fyers_ws_symbol("NSE:NIFTY2681823200PE") == "NSE:NIFTY2681823200PE"


def test_from_fyers_ws_symbol_reverses_index_alias() -> None:
    assert from_fyers_ws_symbol("NSE:NIFTY50-INDEX") == "NIFTY"


def test_from_fyers_ws_symbol_reverses_equity_alias() -> None:
    assert from_fyers_ws_symbol("NSE:RELIANCE-EQ") == "RELIANCE"


def test_from_fyers_ws_symbol_passes_through_option_trading_symbols() -> None:
    """An option contract tick's symbol is exactly what the frontend
    subscribed with (its trading_symbol) — it must not be rewritten."""
    assert from_fyers_ws_symbol("NSE:NIFTY2681823200PE") == "NSE:NIFTY2681823200PE"
