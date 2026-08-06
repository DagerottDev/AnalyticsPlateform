"""Contract tests for the Dhan BrokerService adapter."""

import asyncio
import json

import httpx
import pytest

from app.core.exceptions import BrokerConnectionError
from app.models.user import TradingMode
from app.services.dhan_service import DhanService


@pytest.mark.asyncio
async def test_dhan_profile_validates_through_funds() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["access-token"] == "dhan-token"
        assert request.headers["client-id"] == "1100000001"
        assert request.url.path == "/v2/fundlimit"
        return httpx.Response(200, json={"availabelBalance": 1000})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", TradingMode.PAPER, http_client=client)
    profile = await service.get_profile()

    assert profile.client_id == "1100000001"
    assert profile.broker_name == "Dhan"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_quotes_support_bare_nifty_index_alias() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v2/marketfeed/ltp"
        assert json.loads(request.content) == {"IDX_I": [13]}
        return httpx.Response(
            200,
            json={"data": {"IDX_I": {"13": {"last_price": 22123.45}}}},
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    quotes = await service.get_quotes(["NIFTY"])

    assert quotes[0]["symbol"] == "NIFTY"
    assert quotes[0]["trading_symbol"] == "NIFTY"
    assert quotes[0]["last_price"] == 22123.45
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_orders_are_normalized_and_placed_with_security_reference() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {
                        "orderId": "123",
                        "tradingSymbol": "RELIANCE",
                        "transactionType": "BUY",
                        "orderType": "LIMIT",
                        "productType": "CNC",
                        "quantity": 2,
                        "filledQty": 1,
                        "price": 1500,
                        "orderStatus": "PENDING",
                    }
                ],
            )
        return httpx.Response(200, json={"orderId": "456", "remarks": "Order placed"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    orders = await service.get_orders()
    result = await service.place_order(
        {
            "symbol": "NSE_EQ:2885",
            "quantity": 2,
            "side": "Buy",
            "order_type": "LIMIT",
            "product_type": "CNC",
            "limit_price": 1500,
            "stop_price": 0,
            "validity": "DAY",
            "disclosed_quantity": 0,
            "offline_order": False,
            "take_profit": 0,
            "stop_loss": 0,
        }
    )

    assert orders[0]["id"] == "123"
    assert orders[0]["side"] == "Buy"
    assert result == {"id": "456", "message": "Order placed"}
    payload = json.loads(requests[1].content)
    assert payload["exchangeSegment"] == "NSE_EQ"
    assert payload["securityId"] == "2885"
    assert payload["transactionType"] == "BUY"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_orders_surfaces_the_correlation_id_for_reconciliation() -> None:
    """order_reconciliation.find_order_by_tag searches this field — a
    caller that tagged an ambiguous placement needs it echoed back here to
    find out what actually happened at the broker."""
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {"orderId": "1", "tradingSymbol": "A", "correlationId": "gtt-abc123"},
                {"orderId": "2", "tradingSymbol": "B"},  # no correlationId on this one
            ],
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    orders = await service.get_orders()

    assert orders[0]["order_tag"] == "gtt-abc123"
    assert orders[1]["order_tag"] is None
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_place_order_forwards_order_tag_as_correlation_id() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"orderId": "456", "remarks": "Order placed"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    await service.place_order(
        {
            "symbol": "NSE_EQ:2885", "quantity": 2, "side": "Buy", "order_type": "LIMIT",
            "product_type": "CNC", "limit_price": 1500, "stop_price": 0, "validity": "DAY",
            "disclosed_quantity": 0, "offline_order": False, "take_profit": 0, "stop_loss": 0,
            "order_tag": "exit-entry-order-1",
        }
    )

    payload = json.loads(requests[0].content)
    assert payload["correlationId"] == "exit-entry-order-1"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_place_gtt_order_uses_the_caller_supplied_tag_over_security_id() -> None:
    """Regression test: the old correlationId was derived from security_id
    alone, so two GTTs on the same instrument would collide on the same
    tag. A caller-supplied order_tag (the GTT record's own id) must win."""
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"orderId": "789", "remarks": "GTT submitted"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    await service.place_gtt_order(
        {
            "symbol": "NSE_EQ:2885", "side": "Buy", "product_type": "CNC",
            "execution_type": "LIMIT", "trigger_price": 1500, "limit_price": 1490,
            "quantity": 2, "order_tag": "gtt-record-id-1",
        }
    )

    payload = json.loads(requests[0].content)
    assert payload["correlationId"] == "gtt-record-id-1"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_place_gtt_order_falls_back_to_security_id_without_a_tag() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"orderId": "789", "remarks": "GTT submitted"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    await service.place_gtt_order(
        {
            "symbol": "NSE_EQ:2885", "side": "Buy", "product_type": "CNC",
            "execution_type": "LIMIT", "trigger_price": 1500, "limit_price": 1490,
            "quantity": 2,
        }
    )

    payload = json.loads(requests[0].content)
    assert payload["correlationId"] == "gtt-2885"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_place_order_raises_on_a_broker_rejection() -> None:
    """Dhan can report an RMS/margin/validation rejection with a 2xx HTTP
    status and no orderId in the body — _request only raises for
    HTTP-level errors, so this response would otherwise flow straight
    through as a "successful" placement (returning id=None without ever
    raising), which POST /api/v1/orders would then report to the caller as
    HTTP 201 Created."""
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"remarks": "RMS:Insufficient funds", "orderId": ""})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    with pytest.raises(BrokerConnectionError, match="Insufficient funds"):
        await service.place_order(
            {
                "symbol": "NSE_EQ:2885", "quantity": 2, "side": "Buy", "order_type": "LIMIT",
                "product_type": "CNC", "limit_price": 1500, "stop_price": 0, "validity": "DAY",
                "disclosed_quantity": 0, "offline_order": False, "take_profit": 0, "stop_loss": 0,
            }
        )
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_place_gtt_order_raises_on_a_broker_rejection() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"remarks": "RMS:Invalid trigger price"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    with pytest.raises(BrokerConnectionError, match="Invalid trigger price"):
        await service.place_gtt_order(
            {
                "symbol": "NSE_EQ:2885", "quantity": 2, "side": "Buy",
                "product_type": "CNC", "execution_type": "LIMIT",
                "trigger_price": 1500, "limit_price": 1490,
            }
        )
    await client.aclose()


def _leg(symbol: str = "NSE_EQ:2885") -> dict:
    return {
        "symbol": symbol,
        "quantity": 1,
        "side": "Buy",
        "order_type": "MARKET",
        "product_type": "INTRADAY",
        "limit_price": 0,
        "stop_price": 0,
        "validity": "DAY",
        "disclosed_quantity": 0,
        "offline_order": False,
        "take_profit": 0,
        "stop_loss": 0,
    }


@pytest.mark.asyncio
async def test_dhan_basket_orders_are_placed_sequentially_with_per_leg_isolation() -> None:
    """Dhan has no bulk endpoint, so each leg is its own request; one leg
    failing must not stop the rest, and results stay 1:1 with the input."""
    call_count = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            return httpx.Response(400, json={"remarks": "RMS:Insufficient funds"})
        return httpx.Response(200, json={"orderId": f"leg-{call_count}", "remarks": "Order placed"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    results = await service.place_basket_orders(
        [_leg("NSE_EQ:1"), _leg("NSE_EQ:2"), _leg("NSE_EQ:3")]
    )

    assert call_count == 3
    assert results[0]["id"] == "leg-1"
    assert results[1]["id"] is None
    assert "RMS" in results[1]["message"]
    assert results[2]["id"] == "leg-3"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_multi_order_margin_uses_a_single_hedged_basket_request() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v2/margincalculator/multi"
        assert request.headers["access-token"] == "dhan-token"
        assert json.loads(request.content) == {
            "dhanClientId": "1100000001",
            "includePosition": True,
            "includeOrder": True,
            "scripList": [
                {
                    "exchangeSegment": "NSE_FNO",
                    "transactionType": "BUY",
                    "quantity": 50,
                    "productType": "INTRADAY",
                    "securityId": "26009",
                    "price": 0.0,
                    "triggerPrice": 0.0,
                },
                {
                    "exchangeSegment": "NSE_FNO",
                    "transactionType": "SELL",
                    "quantity": 50,
                    "productType": "INTRADAY",
                    "securityId": "26010",
                    "price": 0.0,
                    "triggerPrice": 0.0,
                },
            ],
        }
        return httpx.Response(
            200,
            json={"totalMargin": 1250.5, "spanMargin": 800, "exposure": 300.5},
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    result = await service.get_margin(
        [
            {"symbol": "NSE_FNO:26009", "quantity": 50, "side": "Buy", "product_type": "INTRADAY"},
            {"symbol": "NSE_FNO:26010", "quantity": 50, "side": "Sell", "product_type": "INTRADAY"},
        ]
    )

    assert result["totalMargin"] == 1250.5
    await client.aclose()


# ── DhanPollingMarketStream ─────────────────────────────────────────────────
# Dhan has no websocket in this adapter yet, so /market/ws is served by
# polling get_quotes() on a timer and fanning results out to listeners —
# previously entirely untested.


@pytest.mark.asyncio
async def test_dhan_market_stream_polls_and_dispatches_quotes_to_subscribed_listeners() -> None:
    from app.services.dhan_service import DhanPollingMarketStream

    async def fetch_quotes(symbols: list[str]) -> list[dict]:
        return [{"symbol": symbol, "last_price": 100.0} for symbol in symbols]

    stream = DhanPollingMarketStream(fetch_quotes, interval_seconds=0.01)
    received: list[dict] = []
    stream.add_listener(received.append)
    stream.subscribe(["NIFTY"])
    stream.bind_loop()
    try:
        for _ in range(50):
            if received:
                break
            await asyncio.sleep(0.01)
        assert received
        assert received[0] == {"symbol": "NIFTY", "last_price": 100.0}
    finally:
        stream.close()


@pytest.mark.asyncio
async def test_dhan_market_stream_never_polls_with_no_subscribed_symbols() -> None:
    from app.services.dhan_service import DhanPollingMarketStream

    calls = 0

    async def fetch_quotes(symbols: list[str]) -> list[dict]:
        nonlocal calls
        calls += 1
        return []

    stream = DhanPollingMarketStream(fetch_quotes, interval_seconds=0.01)
    stream.bind_loop()
    try:
        await asyncio.sleep(0.05)
        assert calls == 0  # nothing subscribed -> the fetcher is never called
    finally:
        stream.close()


@pytest.mark.asyncio
async def test_dhan_market_stream_unsubscribe_stops_further_quotes_for_that_symbol() -> None:
    from app.services.dhan_service import DhanPollingMarketStream

    fetched_batches: list[list[str]] = []

    async def fetch_quotes(symbols: list[str]) -> list[dict]:
        fetched_batches.append(list(symbols))
        return []

    stream = DhanPollingMarketStream(fetch_quotes, interval_seconds=0.01)
    stream.subscribe(["NIFTY", "BANKNIFTY"])
    stream.unsubscribe(["BANKNIFTY"])
    stream.bind_loop()
    try:
        for _ in range(50):
            if fetched_batches:
                break
            await asyncio.sleep(0.01)
        assert fetched_batches
        assert fetched_batches[0] == ["NIFTY"]
    finally:
        stream.close()


@pytest.mark.asyncio
async def test_dhan_market_stream_a_quote_fetcher_error_does_not_kill_the_poll_loop() -> None:
    """The same REST endpoint also serves the normal quote route — a
    transient failure there must not permanently end the browser feed."""
    from app.services.dhan_service import DhanPollingMarketStream

    attempts = 0

    async def flaky_fetch(symbols: list[str]) -> list[dict]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("Dhan quote endpoint timed out")
        return [{"symbol": symbols[0], "last_price": 1.0}]

    stream = DhanPollingMarketStream(flaky_fetch, interval_seconds=0.01)
    received: list[dict] = []
    stream.add_listener(received.append)
    stream.subscribe(["NIFTY"])
    stream.bind_loop()
    try:
        for _ in range(100):
            if received:
                break
            await asyncio.sleep(0.01)
        assert received  # recovered after the first attempt raised
        assert attempts >= 2
    finally:
        stream.close()


@pytest.mark.asyncio
async def test_dhan_market_stream_close_cancels_the_task_and_clears_listeners_and_symbols() -> None:
    from app.services.dhan_service import DhanPollingMarketStream

    async def fetch_quotes(symbols: list[str]) -> list[dict]:
        return []

    stream = DhanPollingMarketStream(fetch_quotes, interval_seconds=0.01)
    stream.add_listener(lambda _q: None)
    stream.subscribe(["NIFTY"])
    stream.bind_loop()
    task = stream._task
    assert task is not None

    stream.close()

    assert task.cancelled() or task.cancel()  # cancellation was requested
    assert stream._listeners == set()
    assert stream._symbols == set()
    assert stream._task is None


@pytest.mark.asyncio
async def test_dhan_market_stream_remove_listener_stops_future_dispatch() -> None:
    from app.services.dhan_service import DhanPollingMarketStream

    async def fetch_quotes(symbols: list[str]) -> list[dict]:
        return [{"symbol": symbols[0], "last_price": 1.0}]

    stream = DhanPollingMarketStream(fetch_quotes, interval_seconds=0.01)
    received: list[dict] = []

    def listener(quote: dict) -> None:
        received.append(quote)

    stream.add_listener(listener)
    stream.remove_listener(listener)
    stream.subscribe(["NIFTY"])
    stream.bind_loop()
    try:
        await asyncio.sleep(0.05)
        assert received == []
    finally:
        stream.close()


# ── _request error handling ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_request_wraps_a_transport_failure_as_broker_connection_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    with pytest.raises(BrokerConnectionError):
        await service.get_funds()
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_request_falls_back_to_response_text_on_a_non_json_body() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="<html>Bad Gateway</html>")

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    with pytest.raises(BrokerConnectionError, match="Bad Gateway"):
        await service.get_funds()
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_request_raises_broker_auth_error_on_401() -> None:
    from app.core.exceptions import BrokerAuthError

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Invalid access token"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    with pytest.raises(BrokerAuthError, match="Invalid access token"):
        await service.get_funds()
    await client.aclose()


# ── _security_ref / get_quotes error paths ──────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_security_ref_rejects_a_symbol_missing_the_segment_prefix() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    with pytest.raises(BrokerConnectionError, match="EXCHANGE_SEGMENT:SECURITY_ID"):
        await service.get_historical_data("26009", "2026-01-01", "2026-01-02", "D")
    await service._client.aclose()


@pytest.mark.asyncio
async def test_dhan_quotes_returns_empty_list_for_no_symbols() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    assert await service.get_quotes([]) == []
    await service._client.aclose()


@pytest.mark.asyncio
async def test_dhan_quotes_rejects_an_unsupported_bare_symbol() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    with pytest.raises(BrokerConnectionError, match="unsupported"):
        await service.get_quotes(["SENSEX"])  # not NIFTY, no exchange prefix
    await service._client.aclose()


@pytest.mark.asyncio
async def test_dhan_quotes_rejects_a_non_numeric_security_id() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    with pytest.raises(BrokerConnectionError, match="Invalid Dhan security ID"):
        await service.get_quotes(["NSE_EQ:not-a-number"])
    await service._client.aclose()


# ── get_instruments / get_expiries ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_get_instruments_parses_the_nifty_option_chain() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/optionchain/expirylist":
            return httpx.Response(200, json={"data": ["2026-08-06"]})
        assert request.url.path == "/v2/optionchain"
        return httpx.Response(
            200,
            json={
                "data": {
                    "oc": {
                        "25000": {
                            "ce": {"security_id": "111", "oi": 500, "previous_oi": 400},
                            "pe": {"security_id": "112", "oi": 300, "previous_oi": 300},
                        }
                    }
                }
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    instruments = await service.get_instruments("NIFTY")

    assert len(instruments) == 2
    ce = next(i for i in instruments if i["option_type"] == "CE")
    assert ce["trading_symbol"] == "NSE_FNO:111"
    assert ce["strike"] == 25000.0
    assert ce["expiry"] == "06-Aug-2026"
    assert ce["oi_change"] == 100.0
    pe = next(i for i in instruments if i["option_type"] == "PE")
    assert pe["trading_symbol"] == "NSE_FNO:112"
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_instruments_returns_empty_for_an_unsupported_underlying() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    assert await service.get_instruments("SENSEX") == []
    await service._client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_instruments_skips_an_unparseable_expiry_date() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/optionchain/expirylist":
            return httpx.Response(200, json={"data": ["not-a-date"]})
        raise AssertionError("must not fetch the option chain for an unparseable expiry")

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    assert await service.get_instruments("NIFTY") == []
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_expiries_parses_dates_and_skips_malformed_ones() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": ["2026-08-06", "not-a-date", "2026-08-13"]})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    expiries = await service.get_expiries("NIFTY")

    assert expiries == ["06-Aug-2026", "13-Aug-2026"]
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_expiries_returns_empty_for_an_unsupported_underlying() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    assert await service.get_expiries("SENSEX") == []
    await service._client.aclose()


# ── get_historical_data ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_get_historical_data_zips_the_ohlcv_series_by_index() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/charts/historical"
        return httpx.Response(
            200,
            json={
                "timestamp": [1000, 2000],
                "open": [100, 101],
                "high": [105, 106],
                "low": [99, 100],
                "close": [104, 105],
                "volume": [10, 20],
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    candles = await service.get_historical_data("NSE_EQ:11536", "2026-01-01", "2026-01-02", "D")

    assert candles == [
        {"timestamp": 1000, "open": 100, "high": 105, "low": 99, "close": 104, "volume": 10},
        {"timestamp": 2000, "open": 101, "high": 106, "low": 100, "close": 105, "volume": 20},
    ]
    await client.aclose()


# ── get_margin edge cases ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_get_margin_returns_empty_dict_for_no_orders() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    assert await service.get_margin([]) == {}
    await service._client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_margin_raises_on_a_non_dict_response() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[1, 2, 3])

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    with pytest.raises(BrokerConnectionError, match="invalid response"):
        await service.get_margin(
            [{"symbol": "NSE_EQ:1", "side": "Buy", "quantity": 1, "product_type": "INTRADAY"}]
        )
    await client.aclose()


# ── get_positions / get_holdings ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_get_positions_derives_side_from_the_quantity_sign() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [
                    {"tradingSymbol": "LONG", "netQty": 50, "netAvg": 100, "ltp": 110},
                    {"tradingSymbol": "SHORT", "netQty": -25, "netAvg": 200, "ltp": 190},
                    {"tradingSymbol": "FLAT", "netQty": 0, "netAvg": 0, "ltp": 0},
                ]
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    positions = await service.get_positions()

    assert [p["side"] for p in positions] == ["Buy", "Sell", "Flat"]
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_get_holdings_parses_rows() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "tradingSymbol": "RELIANCE",
                        "totalQty": 10,
                        "avgCostPrice": 2500,
                        "ltp": 2600,
                        "unrealizedProfit": 1000,
                    }
                ]
            },
        )

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    holdings = await service.get_holdings()

    assert holdings == [
        {
            "trading_symbol": "RELIANCE",
            "symbol": ":",
            "holding_type": "CNC",
            "quantity": 10.0,
            "avg_price": 2500.0,
            "last_price": 2600.0,
            "market_value": 0.0,
            "pnl": 1000.0,
        }
    ]
    await client.aclose()


# ── cancel_gtt_order / modify_order / cancel_order ──────────────────────────


@pytest.mark.asyncio
async def test_dhan_cancel_gtt_order() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/v2/forever/orders/gtt-1"
        return httpx.Response(200, json={"remarks": "GTT cancelled"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    result = await service.cancel_gtt_order("gtt-1")

    assert result == {"id": "gtt-1", "message": "GTT cancelled"}
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_modify_order() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.url.path == "/v2/orders/order-1"
        assert json.loads(request.content) == {
            "quantity": 100,
            "orderType": "LIMIT",
            "price": 105.5,
            "triggerPrice": 0,
            "validity": "DAY",
        }
        return httpx.Response(200, json={"remarks": "Order modified"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    result = await service.modify_order(
        "order-1",
        {"quantity": 100, "order_type": "LIMIT", "limit_price": 105.5, "stop_price": 0},
    )

    assert result == {"id": "order-1", "message": "Order modified"}
    await client.aclose()


@pytest.mark.asyncio
async def test_dhan_cancel_order() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/v2/orders/order-1"
        return httpx.Response(200, json={"remarks": "Order cancelled"})

    client = httpx.AsyncClient(
        base_url="https://api.dhan.co/v2", transport=httpx.MockTransport(handler)
    )
    service = DhanService("1100000001", "dhan-token", http_client=client)

    result = await service.cancel_order("order-1")

    assert result == {"id": "order-1", "message": "Order cancelled"}
    await client.aclose()


# ── get_market_stream / close ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dhan_get_market_stream_returns_the_same_instance_on_repeat_calls() -> None:
    service = DhanService("1100000001", "dhan-token", http_client=httpx.AsyncClient())

    first = service.get_market_stream()
    second = service.get_market_stream()

    assert first is second
    await service.close()


@pytest.mark.asyncio
async def test_dhan_close_tears_down_the_market_stream_and_an_owned_client() -> None:
    service = DhanService("1100000001", "dhan-token")  # no http_client -> owns its own
    stream = service.get_market_stream()
    stream.bind_loop()

    await service.close()

    assert service._market_stream is None
    assert service._client.is_closed


@pytest.mark.asyncio
async def test_dhan_close_does_not_close_a_caller_supplied_client() -> None:
    client = httpx.AsyncClient()
    service = DhanService("1100000001", "dhan-token", http_client=client)

    await service.close()

    assert client.is_closed is False
    await client.aclose()
