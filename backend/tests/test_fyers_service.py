"""Tests for FyersService's real (non-stub) broker API integrations."""

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import BrokerAuthError, BrokerConnectionError, BrokerRateLimitError
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
async def test_history_request_starts_are_paced_per_broker_session() -> None:
    """A Greek workspace must not burst history calls and starve live quotes."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "no_data"})

    # Start just inside the pacing window so the first request must wait.  Do
    # not patch the module-level ``time.monotonic`` function: the ``time``
    # module is shared with asyncio and pytest internals.
    service._next_history_request_at = (
        time.monotonic() + FyersService._HISTORY_REQUEST_MIN_INTERVAL_SECONDS
    )
    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()) as sleep:
        await service.get_historical_data("NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "1")
        await service.get_historical_data("NSE:NIFTY26JUL23000PE", "2023-11-15", "2023-11-15", "1")

    assert sleep.await_count >= 1
    assert max(float(call.args[0]) for call in sleep.await_args_list) >= (
        FyersService._HISTORY_REQUEST_MIN_INTERVAL_SECONDS - 0.01
    )


@pytest.mark.asyncio
async def test_get_historical_data_retries_a_transient_rate_limit() -> None:
    """The history API is rate-limited too; one 429 should not fail the chart."""
    service = _make_service()
    service.client.history = MagicMock(
        side_effect=[
            {"s": "error", "code": 429, "message": "request limit reached"},
            {"s": "ok", "candles": [[1700000000, 100.0, 105.0, 99.0, 104.0, 1234]]},
        ]
    )

    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()):
        rows = await service.get_historical_data(
            "NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "D"
        )

    assert len(rows) == 1
    assert service.client.history.call_count == 2


@pytest.mark.asyncio
async def test_get_historical_data_error_raises_broker_connection_error() -> None:
    """A genuine Fyers error status raises, rather than silently returning []."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "error", "message": "Invalid symbol"})

    with pytest.raises(BrokerConnectionError):
        await service.get_historical_data("NSE:BADSYM-EQ", "2023-11-15", "2023-11-15", "1")


@pytest.mark.asyncio
async def test_fyers_invalid_token_is_typed_as_auth_error() -> None:
    """Fyers -15 must stop callers retrying the same dead session."""
    service = _make_service()
    service.client.get_profile = MagicMock(
        return_value={
            "s": "error",
            "code": -15,
            "message": "Please provide valid token",
        }
    )

    with pytest.raises(BrokerAuthError, match="invalid or expired"):
        await service.get_profile()


@pytest.mark.asyncio
async def test_option_chain_invalid_token_is_not_wrapped_or_retried() -> None:
    """An invalid option-chain token fails once and is surfaced as auth."""
    service = _make_service()
    service.client.optionchain = MagicMock(
        return_value={
            "s": "error",
            "code": -15,
            "message": "Please provide valid token",
        }
    )

    with pytest.raises(BrokerAuthError, match="option chain"):
        await service.get_instruments("NIFTY")
    service.client.optionchain.assert_called_once()


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
    chain_call = service.client.optionchain.call_args_list[1].args[0]
    assert chain_call["strikecount"] == 50


@pytest.mark.asyncio
async def test_nearest_expiry_instruments_use_one_wide_chain_request() -> None:
    service = _make_service()
    service.client.optionchain = MagicMock(
        return_value={
            "s": "ok",
            "data": {
                "expiryData": [{"date": "10-Jul-2025", "expiry": "1752105000"}],
                "optionsChain": [
                    {"symbol": "NSE:NIFTY50-INDEX", "option_type": "", "strike_price": -1},
                    {
                        "symbol": "NSE:NIFTY25071017500CE",
                        "option_type": "CE",
                        "strike_price": 17500,
                    },
                    {
                        "symbol": "NSE:NIFTY25071017500PE",
                        "option_type": "PE",
                        "strike_price": 17500,
                    },
                ],
            },
        }
    )

    instruments = await service.get_nearest_expiry_instruments("NIFTY")

    assert {item["option_type"] for item in instruments} == {"CE", "PE"}
    service.client.optionchain.assert_called_once_with(
        {"symbol": "NSE:NIFTY50-INDEX", "strikecount": 50, "timestamp": ""}
    )


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
async def test_get_instruments_uses_current_united_spirits_symbol() -> None:
    """The retired MCDOWELL-N alias is rejected by the Fyers option chain."""
    service = _make_service()
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(("31-Jul-2025", "1753905000")),
            _chain_response(
                {"symbol": "NSE:UNITDSPR2507301400CE", "option_type": "CE", "strike_price": 1400}
            ),
        ]
    )

    await service.get_instruments("UNITDSPR")

    discovery_call = service.client.optionchain.call_args_list[0].args[0]
    assert discovery_call["symbol"] == "NSE:UNITDSPR-EQ"


@pytest.mark.asyncio
async def test_get_instruments_maps_sensex_to_bse_and_preserves_bfo_exchange() -> None:
    """SENSEX is a BSE index derivative, not an NSE equity fallback."""
    service = _make_service()
    sensex_row = {
        "symbol": "BFO:SENSEX25JUL80000CE",
        "option_type": "CE",
        "strike_price": 80000,
    }
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(("31-Jul-2025", "1753905000")),
            _chain_response(sensex_row),
        ]
    )

    instruments = await service.get_instruments("sensex")

    assert instruments[0]["instrument_type"] == "OPTIDX"
    assert instruments[0]["exchange"] == "BFO"
    discovery_call = service.client.optionchain.call_args_list[0].args[0]
    assert discovery_call["symbol"] == "BSE:SENSEX-INDEX"


@pytest.mark.asyncio
async def test_get_instruments_raises_when_expiry_discovery_fails() -> None:
    """A Fyers error on the initial (expiry-discovery) call surfaces, rather
    than silently returning an empty instrument list."""
    service = _make_service()
    service.client.optionchain = MagicMock(return_value={"s": "error", "message": "Invalid symbol"})

    with pytest.raises(BrokerConnectionError):
        await service.get_instruments("NIFTY")


@pytest.mark.asyncio
async def test_get_instruments_treats_no_expiry_as_empty_universe() -> None:
    """A valid equity with no active F&O contract should not log as an outage."""
    service = _make_service()
    service.client.optionchain = MagicMock(
        return_value={
            "s": "error",
            "code": -470,
            "data": {},
            "message": "There are no expiry contracts.",
        }
    )

    assert await service.get_instruments("WHIRLPOOL") == []
    assert await service.get_instruments("WHIRLPOOL") == []
    service.client.optionchain.assert_called_once()


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
async def test_get_instruments_retries_transient_bad_request_then_succeeds() -> None:
    """Fyers' intermittent -99 response must not turn a valid chain into a 503."""
    service = _make_service()
    near_row = {"symbol": "NSE:NIFTY25071017500CE", "option_type": "CE", "strike_price": 17500}
    service.client.optionchain = MagicMock(
        side_effect=[
            {"s": "error", "code": -99, "message": "Bad request"},
            _expiry_discovery_response(("10-Jul-2025", "1752105000")),
            _chain_response(near_row),
        ]
    )

    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()):
        instruments = await service.get_instruments("NIFTY")

    assert len(instruments) == 1
    assert service.client.optionchain.call_count == 3


@pytest.mark.asyncio
async def test_option_chain_request_starts_are_paced_per_broker_session() -> None:
    """Concurrent screens must share one option-chain request cadence."""
    service = _make_service()
    service.client.optionchain = MagicMock(
        return_value={
            "s": "error",
            "code": -470,
            "message": "There are no expiry contracts.",
        }
    )

    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()) as sleep:
        await service._fetch_option_chain("NIFTY", strikecount=1)
        await service._fetch_option_chain("BANKNIFTY", strikecount=1)

    assert service.client.optionchain.call_count == 2
    assert sleep.await_count == 1
    assert (
        sleep.await_args.args[0]
        >= FyersService._OPTION_CHAIN_REQUEST_MIN_INTERVAL_SECONDS - 0.01
    )


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
async def test_get_instruments_serves_stale_cache_when_refresh_is_rate_limited() -> None:
    """A temporary broker quota hit must not blank an already loaded chain."""
    service = _make_service()
    near_row = {"symbol": "NSE:NIFTY25071017500CE", "option_type": "CE", "strike_price": 17500}
    service.client.optionchain = MagicMock(
        side_effect=[
            _expiry_discovery_response(("10-Jul-2025", "1752105000")),
            _chain_response(near_row),
        ]
    )
    cached = await service.get_instruments("NIFTY")
    service._instruments_cache["NIFTY"] = (
        time.monotonic() - service._INSTRUMENTS_CACHE_TTL_SECONDS - 1.0, cached
    )
    service.client.optionchain = MagicMock(
        return_value={"s": "error", "code": 429, "message": "request limit reached"}
    )

    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()):
        assert await service.get_instruments("NIFTY") == cached

    assert service.client.optionchain.call_count == FyersService._MAX_FETCH_RETRIES


@pytest.mark.asyncio
async def test_persistent_rate_limit_uses_typed_error_without_cached_instruments() -> None:
    service = _make_service()
    service.client.optionchain = MagicMock(
        return_value={"s": "error", "code": 429, "message": "request limit reached"}
    )

    with (
        patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()),
        pytest.raises(BrokerRateLimitError) as raised,
    ):
        await service.get_instruments("NIFTY")

    assert raised.value.retry_after == FyersService._INSTRUMENTS_RATE_LIMIT_COOLDOWN_SECONDS

    with (
        patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()),
        pytest.raises(BrokerRateLimitError),
    ):
        await service.get_instruments("NIFTY")
    # There is no local cooldown gate anymore — only Fyers decides. A
    # follow-up request must actually ask the broker again rather than being
    # rejected locally from a cached "still cooling down" timer.
    assert service.client.optionchain.call_count == 2 * FyersService._MAX_FETCH_RETRIES


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


@pytest.mark.asyncio
async def test_get_quotes_accepts_fyers_string_cmd_payload() -> None:
    """The common Fyers v3 quote response stores ``cmd`` as a symbol string.

    It is not an OHLC mapping. The parser must still return the quote instead
    of throwing while attempting ``cmd.get(...)`` and losing the entire batch.
    """
    service = _make_service()
    service.client.quotes = MagicMock(
        return_value={
            "s": "ok",
            "d": [{
                "v": {
                    "cmd": "NSE:NIFTY50-INDEX",
                    "lp": 24_550.5,
                    "ch": 50.25,
                    "chp": 0.21,
                    "volume": 123,
                },
            }],
        }
    )

    quotes = await service.get_quotes(["NIFTY"])

    assert len(quotes) == 1
    assert quotes[0]["trading_symbol"] == "NIFTY"
    assert quotes[0]["last_price"] == 24_550.5
    assert quotes[0]["volume"] == 123


@pytest.mark.asyncio
async def test_get_quotes_retries_a_rate_limited_batch() -> None:
    """A transient /quotes 429 must not freeze the live option chain."""
    service = _make_service()
    service.client.quotes = MagicMock(
        side_effect=[
            {"s": "error", "code": 429, "message": "request limit reached"},
            {"s": "ok", "d": [{"n": "NSE:NIFTY50-INDEX", "v": {"lp": 24_550.0}}]},
        ]
    )

    with patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()):
        quotes = await service.get_quotes(["NIFTY"])

    assert service.client.quotes.call_count == 2
    assert quotes[0]["trading_symbol"] == "NIFTY"


@pytest.mark.asyncio
async def test_get_quotes_batches_large_option_chain_requests() -> None:
    """A large chain must not fail as one oversized Fyers quote request."""
    service = _make_service()
    symbols = [
        f"NSE:NIFTY26JUL{22000 + index}CE"
        for index in range(FyersService._QUOTE_BATCH_SIZE + 1)
    ]

    def quote_response(payload: dict[str, str]) -> dict[str, Any]:
        requested = payload["symbols"].split(",")
        return {
            "s": "ok",
            "d": [{"n": symbol, "v": {"lp": 100.0}} for symbol in requested],
        }

    service.client.quotes = MagicMock(side_effect=quote_response)

    quotes = await service.get_quotes(symbols)

    assert service.client.quotes.call_count == 2
    assert [
        len(call.args[0]["symbols"].split(",")) for call in service.client.quotes.call_args_list
    ] == [FyersService._QUOTE_BATCH_SIZE, 1]
    assert len(quotes) == len(symbols)


def test_to_fyers_ws_symbol_maps_bare_index_alias() -> None:
    """A bare underlying alias (what the UI subscribes for the underlying's
    own price) must be exchange-qualified before reaching Fyers — a bare
    'NIFTY' is rejected by Fyers' websocket subscribe with 'Please provide
    a valid symbol'."""
    assert to_fyers_ws_symbol("NIFTY") == "NSE:NIFTY50-INDEX"
    assert to_fyers_ws_symbol("nifty") == "NSE:NIFTY50-INDEX"


def test_to_fyers_ws_symbol_maps_sensex_to_bse_index() -> None:
    assert to_fyers_ws_symbol("SENSEX") == "BSE:SENSEX-INDEX"
    assert from_fyers_ws_symbol("BSE:SENSEX-INDEX") == "SENSEX"


def test_to_fyers_ws_symbol_maps_bare_equity_alias() -> None:
    assert to_fyers_ws_symbol("RELIANCE") == "NSE:RELIANCE-EQ"


def test_to_fyers_ws_symbol_maps_renamed_equity_aliases() -> None:
    assert to_fyers_ws_symbol("TATAMOTORS") == "NSE:TMPV-EQ"
    assert to_fyers_ws_symbol("LTIM") == "NSE:LTM-EQ"
    assert to_fyers_ws_symbol("ZOMATO") == "NSE:ETERNAL-EQ"


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


@pytest.mark.asyncio
async def test_get_positions_normalizes_rows_and_derives_side() -> None:
    service = _make_service()
    service.client.positions = MagicMock(
        return_value={
            "s": "ok",
            "netPositions": [
                {
                    "symbol": "NSE:SBIN-EQ",
                    "netQty": 1,
                    "netAvg": 190.6,
                    "productType": "INTRADAY",
                    "ltp": 193.1,
                    "realized_profit": 0.0,
                    "unrealized_profit": 2.5,
                    "pl": 2.5,
                },
                {
                    "symbol": "NSE:TCS-EQ",
                    "netQty": -2,
                    "netAvg": 3500.0,
                    "productType": "CNC",
                    "ltp": 3480.0,
                    "realized_profit": 10.0,
                    "unrealized_profit": 40.0,
                    "pl": 50.0,
                },
                {
                    "symbol": "NSE:INFY-EQ",
                    "netQty": 0,
                    "netAvg": 0.0,
                    "productType": "INTRADAY",
                    "ltp": 1500.0,
                    "realized_profit": 5.0,
                    "unrealized_profit": 0.0,
                    "pl": 5.0,
                },
            ],
        }
    )

    positions = await service.get_positions()

    assert len(positions) == 3  # net-zero rows are returned, not dropped
    assert positions[0]["symbol"] == "SBIN"
    assert positions[0]["side"] == "Buy"
    assert positions[1]["symbol"] == "TCS"
    assert positions[1]["side"] == "Sell"
    assert positions[2]["side"] == "Flat"


@pytest.mark.asyncio
async def test_get_positions_raises_on_error_response() -> None:
    service = _make_service()
    service.client.positions = MagicMock(return_value={"s": "error", "message": "bad token"})

    with pytest.raises(BrokerConnectionError):
        await service.get_positions()


@pytest.mark.asyncio
async def test_get_holdings_normalizes_rows() -> None:
    service = _make_service()
    service.client.holdings = MagicMock(
        return_value={
            "s": "ok",
            "holdings": [
                {
                    "symbol": "NSE:SBIN-EQ",
                    "holdingType": "HLD",
                    "quantity": 10,
                    "costPrice": 190.0,
                    "ltp": 193.0,
                    "marketVal": 1930.0,
                    "pl": 30.0,
                }
            ],
        }
    )

    holdings = await service.get_holdings()

    assert len(holdings) == 1
    assert holdings[0]["symbol"] == "SBIN"
    assert holdings[0]["quantity"] == 10
    assert holdings[0]["market_value"] == 1930.0


@pytest.mark.asyncio
async def test_get_holdings_raises_on_error_response() -> None:
    service = _make_service()
    service.client.holdings = MagicMock(return_value={"s": "error"})

    with pytest.raises(BrokerConnectionError):
        await service.get_holdings()


@pytest.mark.asyncio
async def test_get_funds_returns_raw_fund_limit_rows() -> None:
    service = _make_service()
    service.client.funds = MagicMock(
        return_value={
            "s": "ok",
            "fund_limit": [{"id": 1, "title": "Total Balance", "equityAmount": 100000.0}],
        }
    )

    funds = await service.get_funds()

    assert funds == {"fund_limit": [{"id": 1, "title": "Total Balance", "equityAmount": 100000.0}]}


@pytest.mark.asyncio
async def test_get_funds_raises_on_error_response() -> None:
    service = _make_service()
    service.client.funds = MagicMock(return_value={"s": "error"})

    with pytest.raises(BrokerConnectionError):
        await service.get_funds()


def _order(symbol: str, side: str = "Buy") -> dict[str, Any]:
    return {
        "symbol": symbol,
        "quantity": 50,
        "side": side,
        "order_type": "MARKET",
        "product_type": "INTRADAY",
        "limit_price": 0,
        "stop_price": 0,
        "validity": "DAY",
        "disclosed_quantity": 0,
        "offline_order": False,
        "stop_loss": 0,
        "take_profit": 0,
    }


@pytest.mark.asyncio
async def test_get_orders_surfaces_the_order_tag_for_reconciliation() -> None:
    """order_reconciliation.find_order_by_tag searches this field — a
    caller that tagged an ambiguous placement needs it echoed back here to
    find out what actually happened at the broker."""
    service = _make_service()
    service.client.orderbook = MagicMock(
        return_value={
            "s": "ok",
            "orderBook": [
                {"id": "1", "symbol": "NFO:A", "orderTag": "gtt-abc123"},
                {"id": "2", "symbol": "NFO:B"},  # no tag on this one
            ],
        }
    )

    orders = await service.get_orders()

    assert orders[0]["order_tag"] == "gtt-abc123"
    assert orders[1]["order_tag"] is None


@pytest.mark.asyncio
async def test_place_order_forwards_order_tag_to_the_broker() -> None:
    service = _make_service()
    service.client.place_order = MagicMock(return_value={"s": "ok", "id": "1", "message": "ok"})

    await service.place_order({**_order("NFO:A"), "order_tag": "gtt-abc123"})

    submitted = service.client.place_order.call_args.args[0]
    assert submitted["orderTag"] == "gtt-abc123"


@pytest.mark.asyncio
async def test_place_basket_orders_maps_each_leg_result_in_order() -> None:
    service = _make_service()
    service.client.place_basket_orders = MagicMock(
        return_value={
            "s": "ok",
            "data": [
                {"s": "ok", "id": "111", "message": "Order submitted"},
                {"s": "error", "message": "RMS:Insufficient funds"},
            ],
        }
    )

    results = await service.place_basket_orders(
        [_order("NFO:NIFTY24JULCE"), _order("NFO:NIFTY24JULPE", "Sell")]
    )

    assert results[0] == {"id": "111", "message": "Order submitted"}
    assert results[1]["id"] is None
    assert "RMS" in results[1]["message"]
    submitted = service.client.place_basket_orders.call_args.args[0]
    assert len(submitted) == 2
    assert submitted[0]["symbol"] == "NFO:NIFTY24JULCE"
    assert submitted[1]["side"] == -1


@pytest.mark.asyncio
async def test_place_basket_orders_rejects_more_than_ten_legs() -> None:
    service = _make_service()
    service.client.place_basket_orders = MagicMock()

    with pytest.raises(BrokerConnectionError):
        await service.place_basket_orders([_order(f"NFO:LEG{i}") for i in range(11)])
    service.client.place_basket_orders.assert_not_called()


@pytest.mark.asyncio
async def test_place_basket_orders_raises_on_response_shape_mismatch() -> None:
    """Never silently claim legs succeeded when the response can't be
    matched 1:1 to what was sent."""
    service = _make_service()
    service.client.place_basket_orders = MagicMock(return_value={"s": "ok", "data": [{"id": "1"}]})

    with pytest.raises(BrokerConnectionError):
        await service.place_basket_orders([_order("NFO:A"), _order("NFO:B")])


@pytest.mark.asyncio
async def test_place_basket_orders_empty_input_is_a_noop() -> None:
    service = _make_service()
    service.client.place_basket_orders = MagicMock()

    assert await service.place_basket_orders([]) == []
    service.client.place_basket_orders.assert_not_called()


# ── get_profile ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_profile_prefers_the_display_name_over_the_account_name() -> None:
    service = _make_service()
    service.client.get_profile = MagicMock(
        return_value={"s": "ok", "data": {"fy_id": "YR02352", "name": "Vijay Sharma"}}
    )

    profile = await service.get_profile()

    assert profile.client_id == "YR02352"
    assert profile.account_name == "Vijay Sharma"
    assert profile.broker_name == "Fyers"


@pytest.mark.asyncio
async def test_get_profile_falls_back_to_the_account_name_when_no_broker_name_is_returned() -> None:
    """Fallback order is name -> display_name -> fy_id -> account_name; only
    an empty response for all three of the broker's own fields reaches the
    last resort."""
    service = _make_service()
    service.client.get_profile = MagicMock(return_value={"s": "ok", "data": {}})
    service.account_name = "My Fyers"

    profile = await service.get_profile()

    assert profile.client_id == "unknown"
    assert profile.account_name == "My Fyers"


@pytest.mark.asyncio
async def test_get_profile_raises_on_a_non_ok_non_auth_response() -> None:
    service = _make_service()
    service.client.get_profile = MagicMock(return_value={"s": "error", "message": "server error"})

    with pytest.raises(BrokerConnectionError):
        await service.get_profile()


@pytest.mark.asyncio
async def test_get_profile_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.get_profile = MagicMock(side_effect=RuntimeError("connection reset"))

    with pytest.raises(BrokerConnectionError, match="connection reset"):
        await service.get_profile()


# ── get_market_stream ────────────────────────────────────────────────────


def test_get_market_stream_returns_the_same_instance_on_repeat_calls() -> None:
    service = _make_service()

    first = service.get_market_stream()
    second = service.get_market_stream()

    assert first is second
    assert first._app_id == service.app_id


# ── get_quotes edge cases ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_quotes_returns_empty_list_for_no_symbols() -> None:
    service = _make_service()
    service.client.quotes = MagicMock()

    assert await service.get_quotes([]) == []
    service.client.quotes.assert_not_called()


@pytest.mark.asyncio
async def test_get_quotes_gives_up_after_a_non_retryable_error() -> None:
    service = _make_service()
    service.client.quotes = MagicMock(return_value={"s": "error", "code": 500})

    quotes = await service.get_quotes(["NIFTY"])

    assert quotes == []
    service.client.quotes.assert_called_once()


@pytest.mark.asyncio
async def test_get_quotes_gives_up_after_exhausting_429_retries() -> None:
    service = _make_service()
    service.client.quotes = MagicMock(return_value={"s": "error", "code": 429})

    with (
        patch("app.services.fyers_service.asyncio.sleep", new=AsyncMock()),
        pytest.raises(BrokerRateLimitError),
    ):
        await service.get_quotes(["NIFTY"])

    assert service.client.quotes.call_count == FyersService._MAX_QUOTE_FETCH_RETRIES


@pytest.mark.asyncio
async def test_get_quotes_skips_a_row_whose_value_is_not_a_mapping() -> None:
    service = _make_service()
    service.client.quotes = MagicMock(
        return_value={
            "s": "ok",
            "d": [
                {"n": "NSE:BROKEN-EQ", "v": "not-a-dict"},
                {"n": "NSE:RELIANCE-EQ", "v": {"lp": 1300.0}},
            ],
        }
    )

    quotes = await service.get_quotes(["RELIANCE"])

    assert len(quotes) == 1
    assert quotes[0]["trading_symbol"] == "RELIANCE"


@pytest.mark.asyncio
async def test_get_quotes_skips_a_row_with_no_usable_last_price() -> None:
    service = _make_service()
    service.client.quotes = MagicMock(
        return_value={
            "s": "ok",
            "d": [
                {"n": "NSE:NOPRICE-EQ", "v": {"lp": None}},
                {"n": "NSE:RELIANCE-EQ", "v": {"lp": 1300.0}},
            ],
        }
    )

    quotes = await service.get_quotes(["RELIANCE"])

    assert len(quotes) == 1
    assert quotes[0]["trading_symbol"] == "RELIANCE"


@pytest.mark.asyncio
async def test_get_quotes_derives_change_and_change_percent_when_the_broker_omits_them() -> None:
    """Some Fyers quote responses omit ch/chp outright; derive them from
    last_price vs prev_close rather than silently reporting 0 change."""
    service = _make_service()
    service.client.quotes = MagicMock(
        return_value={
            "s": "ok",
            "d": [{"n": "NSE:RELIANCE-EQ", "v": {"lp": 1300.0, "prev_close_price": 1250.0}}],
        }
    )

    quotes = await service.get_quotes(["RELIANCE"])

    assert quotes[0]["change"] == 50.0
    assert quotes[0]["change_percent"] == pytest.approx(4.0)


# ── get_historical_data range chunking ──────────────────────────────────


@pytest.mark.asyncio
async def test_get_historical_data_splits_a_multi_year_range_into_366_day_chunks() -> None:
    """Fyers rejects a single daily-candle request spanning >366 days —
    a 2-year range must be split and the results merged back together."""
    service = _make_service()
    requested_ranges: list[tuple[str, str]] = []

    def history_response(payload: dict[str, Any]) -> dict[str, Any]:
        requested_ranges.append((payload["range_from"], payload["range_to"]))
        return {"s": "ok", "candles": [[1700000000, 1, 2, 0, 1, 10]]}

    service.client.history = MagicMock(side_effect=history_response)

    candles = await service.get_historical_data(
        "NSE:NIFTY50-INDEX", "2023-01-01", "2025-01-01", "D"
    )

    assert len(requested_ranges) == 2  # 731-day span split into two <=366-day chunks
    assert len(candles) == 2  # one candle merged back from each chunk
    # Chunks must be contiguous, not overlapping or gapped.
    assert requested_ranges[0][1] < requested_ranges[1][0]


@pytest.mark.asyncio
async def test_get_historical_data_does_not_chunk_a_short_range() -> None:
    service = _make_service()
    service.client.history = MagicMock(
        return_value={"s": "ok", "candles": [[1700000000, 1, 2, 0, 1, 10]]}
    )

    await service.get_historical_data("NSE:NIFTY50-INDEX", "2023-01-01", "2023-01-31", "D")

    service.client.history.assert_called_once()


@pytest.mark.asyncio
async def test_get_historical_data_returns_empty_for_a_no_data_response() -> None:
    """'no_data' (e.g. a market holiday) is a legitimate empty result, not
    an error worth retrying or raising."""
    service = _make_service()
    service.client.history = MagicMock(return_value={"s": "no_data"})

    candles = await service.get_historical_data(
        "NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "D"
    )

    assert candles == []


@pytest.mark.asyncio
async def test_get_historical_data_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.history = MagicMock(side_effect=RuntimeError("timed out"))

    with pytest.raises(BrokerConnectionError, match="timed out"):
        await service.get_historical_data("NSE:NIFTY50-INDEX", "2023-11-15", "2023-11-15", "D")


# ── get_margin ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_margin_returns_empty_dict_for_no_orders() -> None:
    service = _make_service()
    service.client.service = MagicMock()

    assert await service.get_margin([]) == {}
    service.client.service.post_call.assert_not_called()


@pytest.mark.asyncio
async def test_get_margin_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.service = MagicMock()
    service.client.service.post_call = MagicMock(side_effect=RuntimeError("network error"))

    with pytest.raises(BrokerConnectionError, match="network error"):
        await service.get_margin([_order("NFO:A")])


@pytest.mark.asyncio
async def test_get_margin_raises_on_a_non_ok_response() -> None:
    service = _make_service()
    service.client.service = MagicMock()
    service.client.service.post_call = MagicMock(return_value={"s": "error"})

    with pytest.raises(BrokerConnectionError):
        await service.get_margin([_order("NFO:A")])


# ── get_positions / get_holdings / get_funds transport failures ─────────


@pytest.mark.asyncio
async def test_get_positions_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.positions = MagicMock(side_effect=RuntimeError("network error"))

    with pytest.raises(BrokerConnectionError, match="network error"):
        await service.get_positions()


@pytest.mark.asyncio
async def test_get_holdings_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.holdings = MagicMock(side_effect=RuntimeError("network error"))

    with pytest.raises(BrokerConnectionError, match="network error"):
        await service.get_holdings()


@pytest.mark.asyncio
async def test_get_funds_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.funds = MagicMock(side_effect=RuntimeError("network error"))

    with pytest.raises(BrokerConnectionError, match="network error"):
        await service.get_funds()


@pytest.mark.asyncio
async def test_get_orders_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.orderbook = MagicMock(side_effect=RuntimeError("network error"))

    with pytest.raises(BrokerConnectionError, match="network error"):
        await service.get_orders()


# ── modify_order / cancel_order ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_modify_order_success() -> None:
    service = _make_service()
    service.client.modify_order = MagicMock(return_value={"s": "ok", "id": "order-1"})

    result = await service.modify_order(
        "order-1",
        {"quantity": 100, "order_type": "LIMIT", "limit_price": 105.5, "stop_price": 0},
    )

    assert result == {"id": "order-1", "message": "Order modified"}


@pytest.mark.asyncio
async def test_modify_order_raises_on_broker_rejection() -> None:
    service = _make_service()
    service.client.modify_order = MagicMock(return_value={"s": "error", "message": "bad price"})

    with pytest.raises(BrokerConnectionError):
        await service.modify_order(
            "order-1",
            {"quantity": 100, "order_type": "LIMIT", "limit_price": 105.5, "stop_price": 0},
        )


@pytest.mark.asyncio
async def test_modify_order_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.modify_order = MagicMock(side_effect=RuntimeError("timed out"))

    with pytest.raises(BrokerConnectionError, match="timed out"):
        await service.modify_order(
            "order-1",
            {"quantity": 100, "order_type": "LIMIT", "limit_price": 105.5, "stop_price": 0},
        )


@pytest.mark.asyncio
async def test_cancel_order_success() -> None:
    service = _make_service()
    service.client.cancel_order = MagicMock(return_value={"s": "ok", "id": "order-1"})

    result = await service.cancel_order("order-1")

    assert result == {"id": "order-1", "message": "Order cancelled"}


@pytest.mark.asyncio
async def test_cancel_order_raises_on_broker_rejection() -> None:
    service = _make_service()
    service.client.cancel_order = MagicMock(return_value={"s": "error"})

    with pytest.raises(BrokerConnectionError):
        await service.cancel_order("order-1")


@pytest.mark.asyncio
async def test_cancel_order_wraps_a_transport_exception() -> None:
    service = _make_service()
    service.client.cancel_order = MagicMock(side_effect=RuntimeError("timed out"))

    with pytest.raises(BrokerConnectionError, match="timed out"):
        await service.cancel_order("order-1")


# ── close ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_close_tears_down_the_market_stream_when_one_was_created() -> None:
    service = _make_service()
    stream = service.get_market_stream()
    stream.close = MagicMock()

    await service.close()

    stream.close.assert_called_once()
    assert service._market_stream is None


@pytest.mark.asyncio
async def test_close_is_a_noop_when_no_market_stream_was_ever_created() -> None:
    service = _make_service()

    await service.close()  # must not raise

    assert service._market_stream is None
